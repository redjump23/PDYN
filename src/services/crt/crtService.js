import { EmbedBuilder } from 'discord.js';
import botConfig from '../../config/bot.js';
import { buildSignal } from './crtEngine.js';
import {
  getKlines,
  getSpotSymbols,
  getFuturesContracts,
  getConfiguredSymbols,
} from './mexcService.js';
import { isNewSignal } from './signalManager.js';

const CRT_CONFIG = botConfig.crt || {};

const TIMEFRAMES = CRT_CONFIG.timeframes || {
  '5m': 5,
  '15m': 15,
  '1h': 60,
  '4h': 240,
  '1d': 1440,
};

const CHANNELS = CRT_CONFIG.channels || {};

const MARKET_TYPES = String(
  CRT_CONFIG.markets || 'spot,futures'
)
  .split(',')
  .map((x) => x.trim())
  .filter(Boolean);

const SCAN_INTERVAL = Math.max(
  15000,
  Number(CRT_CONFIG.scanInterval || 30000)
);

const KLINE_LIMIT = Math.max(
  30,
  Number(CRT_CONFIG.klineLimit || 100)
);

const MAX_SYMBOLS = Math.max(
  1,
  Number(CRT_CONFIG.maxSymbolsPerMarket || 30)
);

const RSI_PERIOD = Number(
  CRT_CONFIG.rsi?.period || 14
);

const OVERSOLD = Number(
  CRT_CONFIG.rsi?.oversold || 30
);

const OVERBOUGHT = Number(
  CRT_CONFIG.rsi?.overbought || 70
);

const AUTO_SYMBOLS =
  CRT_CONFIG.autoSymbols !== false;

/*
 * Number of previous closed candles used
 * to identify previous liquidity.
 *
 * Keep this simple.
 */
const LIQUIDITY_LOOKBACK = Math.max(
  3,
  Number(CRT_CONFIG.liquidityLookback || 20)
);

let monitorStarted = false;
let scanRunning = false;
let cachedSymbols = new Map();
let lastSymbolRefresh = 0;

// ============================================================
// TIMEFRAME LABEL
// ============================================================

function timeframeLabel(tf) {
  return (
    {
      '5m': '5 MINUTES',
      '15m': '15 MINUTES',
      '1h': '1 HOUR',
      '4h': '4 HOURS',
      '1d': 'DAILY',
    }[tf] || tf
  );
}

// ============================================================
// PRICE FORMATTER
// ============================================================

function fmtPrice(value) {
  if (!Number.isFinite(Number(value))) {
    return 'N/A';
  }

  const price = Number(value);

  if (Math.abs(price) >= 1000) {
    return price.toLocaleString('en-US', {
      maximumFractionDigits: 2,
    });
  }

  if (Math.abs(price) >= 1) {
    return price.toLocaleString('en-US', {
      maximumFractionDigits: 5,
    });
  }

  return price.toLocaleString('en-US', {
    maximumSignificantDigits: 7,
  });
}

// ============================================================
// RSI DISPLAY
//
// OVERBOUGHT / OVERSOLD = BOLD
// NEUTRAL = NORMAL
// NO RSI NUMBER
// ============================================================

function formatRSIState(state) {
  const normalized = String(
    state || 'Neutral'
  ).toUpperCase();

  if (normalized === 'OVERBOUGHT') {
    return '**OVERBOUGHT**';
  }

  if (normalized === 'OVERSOLD') {
    return '**OVERSOLD**';
  }

  return 'Neutral';
}

// ============================================================
// MARKET STRUCTURE DISPLAY
// ============================================================

function formatMarketStructure(signal) {
  const structure =
    signal.marketStructure ||
    signal.structure ||
    signal.market_structure ||
    'N/A';

  return String(structure);
}

// ============================================================
// STD DEVIATION DISPLAY
// ============================================================

function formatStdDeviation(signal) {
  const value =
    signal.stdDeviation ??
    signal.stdDev ??
    signal.standardDeviation;

  if (!Number.isFinite(Number(value))) {
    return 'N/A';
  }

  return Number(value).toFixed(2);
}

// ============================================================
// FRACTAL PRICE
//
// ONLY FRACTAL PRICE IS DISPLAYED.
// SIGNAL PRICE IS NOT DISPLAYED.
// ============================================================

function formatFractalPrice(signal) {
  const value =
    signal.fractalPrice ??
    signal.fractal?.price ??
    signal.parentHigh ??
    signal.parentLow;

  return fmtPrice(Number(value));
}

// ============================================================
// CONFIRMATION DISPLAY
// ============================================================

function formatConfirmation(signal) {
  if (
    signal.confirmed === false ||
    signal.confirmedCRT === false ||
    signal.crtConfirmed === false
  ) {
    return 'NOT CONFIRMED';
  }

  return '**CONFIRMED**';
}

// ============================================================
// SIMPLE LIQUIDITY SWEEP DETECTION
//
// TOP FRACTAL:
//
//   Fractal Price > previous liquidity high
//
// BOTTOM FRACTAL:
//
//   Fractal Price < previous liquidity low
//
// We intentionally keep this simple.
// No complicated liquidity zones.
//
// The previous liquidity is taken from the
// previous closed candles only.
// ============================================================

function detectLiquiditySweep(
  signal,
  candles
) {
  const fractalPrice = Number(
    signal.fractalPrice ??
    signal.fractal?.price ??
    signal.parentHigh ??
    signal.parentLow
  );

  if (!Number.isFinite(fractalPrice)) {
    return {
      swept: false,
      type: 'NONE',
      label: 'None',
      level: null,
    };
  }

  if (
    !Array.isArray(candles) ||
    candles.length < 3
  ) {
    return {
      swept: false,
      type: 'NONE',
      label: 'None',
      level: null,
    };
  }

  /*
   * Determine whether this is a top or bottom
   * fractal.
   *
   * We first use explicit fractal information
   * from crtEngine when available.
   */
  const explicitFractalType = String(
    signal.fractalType ??
    signal.fractal?.type ??
    signal.type ??
    ''
  ).toUpperCase();

  const structure = String(
    signal.marketStructure ||
    signal.structure ||
    signal.market_structure ||
    ''
  ).toUpperCase();

  const isTopFractal =
    explicitFractalType.includes('TOP') ||
    explicitFractalType.includes('HIGH') ||
    structure === 'BEARISH';

  const isBottomFractal =
    explicitFractalType.includes('BOTTOM') ||
    explicitFractalType.includes('LOW') ||
    structure === 'BULLISH';

  /*
   * Remove the latest candle from the liquidity
   * search so we don't compare against the same
   * candle that created the confirmation.
   */
  const previousCandles =
    candles.slice(
      0,
      -1
    );

  if (!previousCandles.length) {
    return {
      swept: false,
      type: 'NONE',
      label: 'None',
      level: null,
    };
  }

  /*
   * Only use the most recent liquidity lookback.
   */
  const liquidityCandles =
    previousCandles.slice(
      -LIQUIDITY_LOOKBACK
    );

  // ==========================================================
  // PREVIOUS HIGH LIQUIDITY
  // ==========================================================

  if (isTopFractal) {
    const previousHighs =
      liquidityCandles
        .map((c) => Number(c.high))
        .filter(Number.isFinite);

    if (previousHighs.length) {
      const previousHigh =
        Math.max(...previousHighs);

      if (
        fractalPrice >
        previousHigh
      ) {
        return {
          swept: true,
          type: 'HIGH',
          label:
            '**PREVIOUS HIGH SWEPT**',
          level: previousHigh,
        };
      }
    }
  }

  // ==========================================================
  // PREVIOUS LOW LIQUIDITY
  // ==========================================================

  if (isBottomFractal) {
    const previousLows =
      liquidityCandles
        .map((c) => Number(c.low))
        .filter(Number.isFinite);

    if (previousLows.length) {
      const previousLow =
        Math.min(...previousLows);

      if (
        fractalPrice <
        previousLow
      ) {
        return {
          swept: true,
          type: 'LOW',
          label:
            '**PREVIOUS LOW SWEPT**',
          level: previousLow,
        };
      }
    }
  }

  return {
    swept: false,
    type: 'NONE',
    label: 'None',
    level: null,
  };
}

// ============================================================
// SIGNAL COLOR
//
// BUY / SELL IS NOT DISPLAYED.
// Color is based on market structure.
// ============================================================

function signalColor(signal) {
  const structure = String(
    signal.marketStructure ||
    signal.structure ||
    signal.market_structure ||
    ''
  ).toUpperCase();

  if (structure === 'BULLISH') {
    return 0x57f287;
  }

  if (structure === 'BEARISH') {
    return 0xed4245;
  }

  return 0x5865f2;
}

// ============================================================
// CREATE FINAL CRT EMBED
//
// FINAL DISPLAY:
//
// 🟢 BTC
//
// PDYN CRT CONFIRMATION
//
// Source: MEXC Exchange
// Timeframe: 5 MINUTES
// Market Structure: Bullish
// STD Deviation: 1.82
// Fractal Price: 112,300.00
// Liquidity: PREVIOUS LOW SWEPT
// CONFIRM CRT Candle: CONFIRMED
// RSI: OVERSOLD
//
// ============================================================

function createSignalEmbed(signal) {
  const structure =
    formatMarketStructure(signal);

  const structureUpper =
    String(structure).toUpperCase();

  const emoji =
    structureUpper === 'BULLISH'
      ? '🟢'
      : structureUpper === 'BEARISH'
        ? '🔴'
        : '🟡';

  /*
   * Convert:
   *
   * BTC_USDT -> BTC
   * BTC-USDT -> BTC
   * BTCUSDT  -> BTC
   * BTC_USD  -> BTC
   * BTCUSD   -> BTC
   */
  const coin = String(
    signal.symbol || 'UNKNOWN'
  )
    .replace(/[-_]USDT$/i, '')
    .replace(/USDT$/i, '')
    .replace(/[-_]USD$/i, '')
    .replace(/USD$/i, '');

  const rsiState =
    formatRSIState(
      signal.rsiState
    );

  const liquidity =
    signal.liquiditySweep?.label ||
    'None';

  return new EmbedBuilder()

    // ========================================================
    // TITLE
    // ========================================================

    .setTitle(
      `${emoji} ${coin.toUpperCase()}`
    )

    // ========================================================
    // DESCRIPTION
    // ========================================================

    .setDescription(
      '**PDYN CRT CONFIRMATION**'
    )

    // ========================================================
    // CRT INFORMATION
    // ========================================================

    .addFields(
      {
        name: 'Source',
        value: '**MEXC Exchange**',
        inline: false,
      },

      {
        name: 'Timeframe',
        value:
          timeframeLabel(
            signal.timeframe
          ),
        inline: true,
      },

      {
        name: 'Market Structure',
        value: structure,
        inline: true,
      },

      {
        name: 'STD Deviation',
        value:
          formatStdDeviation(
            signal
          ),
        inline: true,
      },

      {
        name: 'Fractal Price',
        value:
          formatFractalPrice(
            signal
          ),
        inline: true,
      },

      {
        name: 'Liquidity',
        value: liquidity,
        inline: true,
      },

      {
        name: 'CONFIRM CRT Candle',
        value:
          formatConfirmation(
            signal
          ),
        inline: true,
      },

      {
        name: 'RSI',
        value: rsiState,
        inline: true,
      }
    )

    // ========================================================
    // COLOR
    // ========================================================

    .setColor(
      signalColor(signal)
    )

    // ========================================================
    // FOOTER
    // ========================================================

    .setFooter({
      text:
        'PDYN • CRT • MEXC Exchange',
    })

    // ========================================================
    // CANDLE TIME
    // ========================================================

    .setTimestamp(
      new Date(
        signal.candleTime
      )
    );
}

// ============================================================
// SEND SIGNAL
// ============================================================

async function sendSignal(
  client,
  signal
) {
  const channelId =
    CHANNELS[
      signal.timeframe
    ];

  if (!channelId) {
    console.warn(
      `[CRT] No Discord channel configured for ${signal.timeframe}`
    );
    return;
  }

  const channel =
    await client.channels.fetch(
      channelId
    );

  if (
    !channel ||
    typeof channel.send !==
      'function'
  ) {
    return;
  }

  const structure =
    String(
      signal.marketStructure ||
      signal.structure ||
      signal.market_structure ||
      ''
    ).toUpperCase();

  const emoji =
    structure === 'BULLISH'
      ? '🟢'
      : structure === 'BEARISH'
        ? '🔴'
        : '🟡';

  const coin = String(
    signal.symbol || 'UNKNOWN'
  )
    .replace(/[-_]USDT$/i, '')
    .replace(/USDT$/i, '')
    .replace(/[-_]USD$/i, '')
    .replace(/USD$/i, '');

  await channel.send({
    content:
      `${emoji} **${coin.toUpperCase()}**`,

    embeds: [
      createSignalEmbed(
        signal
      ),
    ],
  });
}

// ============================================================
// FILTER SYMBOLS
// ============================================================

function filterSymbols(
  symbols,
  market
) {
  const configured =
    getConfiguredSymbols(
      market
    );

  if (configured.length) {
    return configured.slice(
      0,
      MAX_SYMBOLS
    );
  }

  const quote =
    String(
      CRT_CONFIG.quoteAsset ||
        'USDT'
    ).toUpperCase();

  const filtered =
    symbols.filter((s) => {
      const symbol =
        typeof s === 'string'
          ? s
          : s.symbol;

      if (!symbol) {
        return false;
      }

      if (
        market ===
        'futures'
      ) {
        return (
          String(
            s.quoteCoin ||
              ''
          ).toUpperCase() ===
            quote ||
          symbol.endsWith(
            `_${quote}`
          )
        );
      }

      return symbol.endsWith(
        quote
      );
    });

  return filtered
    .slice(
      0,
      MAX_SYMBOLS
    )
    .map((s) =>
      typeof s === 'string'
        ? s
        : s.symbol
    );
}

// ============================================================
// REFRESH SYMBOLS
// ============================================================

async function refreshSymbols(
  force = false
) {
  const ttl =
    Number(
      CRT_CONFIG.symbolRefreshMs ||
        15 * 60 * 1000
    );

  if (
    !force &&
    Date.now() -
      lastSymbolRefresh <
      ttl &&
    cachedSymbols.size
  ) {
    return;
  }

  for (
    const market of
    MARKET_TYPES
  ) {
    try {
      if (
        market ===
        'futures'
      ) {
        const contracts =
          await getFuturesContracts();

        cachedSymbols.set(
          market,
          filterSymbols(
            contracts,
            market
          )
        );
      } else {
        const symbols =
          await getSpotSymbols();

        cachedSymbols.set(
          market,
          filterSymbols(
            symbols,
            market
          )
        );
      }

      console.log(
        `[CRT] ${market} symbols: ${
          cachedSymbols.get(
            market
          ) || []
        }`
      );
    } catch (error) {
      console.error(
        `[CRT] Failed to refresh ${market} symbols:`,
        error.message
      );
    }
  }

  lastSymbolRefresh =
    Date.now();
}

// ============================================================
// SCAN SYMBOL
// ============================================================

async function scanSymbol(
  client,
  market,
  symbol,
  timeframe
) {
  try {
    const candles =
      await getKlines({
        market,
        symbol,
        timeframe,
        limit:
          KLINE_LIMIT,
      });

    // ========================================================
    // NEVER USE THE STILL-FORMING CANDLE
    // ========================================================

    const closed =
      candles.filter(
        (c) =>
          c.closed &&
          Number.isFinite(
            c.close
          )
      );

    if (
      closed.length <
      RSI_PERIOD + 2
    ) {
      return;
    }

    // ========================================================
    // BUILD CRT SIGNAL
    // ========================================================

    const signal =
      buildSignal({
        symbol,
        market,
        timeframe,
        candles: closed,

        rsiPeriod:
          RSI_PERIOD,

        oversold:
          OVERSOLD,

        overbought:
          OVERBOUGHT,

        crtOptions: {
          requireCloseInside:
            CRT_CONFIG
              .requireCloseInside !==
            false,

          useCloseDirection:
            CRT_CONFIG
              .useCloseDirection ===
            true,

          minBodyRatio:
            Number(
              CRT_CONFIG
                .minBodyRatio ||
                0
            ),
        },
      });

    if (!signal) {
      return;
    }

    // ========================================================
    // LIQUIDITY SWEEP
    //
    // Detect whether the confirmed fractal price
    // swept previous liquidity.
    // ========================================================

    signal.liquiditySweep =
      detectLiquiditySweep(
        signal,
        closed
      );

    // ========================================================
    // NEW SIGNAL CHECK
    // ========================================================

    if (
      !isNewSignal(
        signal.id
      )
    ) {
      return;
    }

    // ========================================================
    // SEND DISCORD ALERT
    // ========================================================

    await sendSignal(
      client,
      signal
    );

    // ========================================================
    // LOG
    // ========================================================

    console.log(
      `[CRT] CONFIRMED ${market}:${symbol} ${timeframe}` +
      ` | Structure=${signal.marketStructure || 'N/A'}` +
      ` | Fractal=${signal.fractalPrice || 'N/A'}` +
      ` | Liquidity=${signal.liquiditySweep?.label || 'None'}` +
      ` | RSI=${signal.rsiState || 'N/A'}`
    );
  } catch (error) {
    console.error(
      `[CRT] Scan failed ${market}:${symbol}:${timeframe}:`,
      error.message
    );
  }
}

// ============================================================
// SCAN ALL
// ============================================================

async function scanAll(
  client
) {
  if (scanRunning) {
    return;
  }

  scanRunning = true;

  try {
    await refreshSymbols();

    // ========================================================
    // SEQUENTIAL REQUESTS
    //
    // Intentional to stay well below MEXC rate limits.
    // ========================================================

    for (
      const timeframe of
      Object.keys(
        TIMEFRAMES
      )
    ) {
      for (
        const market of
        MARKET_TYPES
      ) {
        const symbols =
          cachedSymbols.get(
            market
          ) || [];

        for (
          const symbol of
          symbols
        ) {
          await scanSymbol(
            client,
            market,
            symbol,
            timeframe
          );
        }
      }
    }
  } finally {
    scanRunning = false;
  }
}

// ============================================================
// START CRT MONITOR
// ============================================================

export function startCRTMonitor(
  client
) {
  if (monitorStarted) {
    return;
  }

  if (
    CRT_CONFIG.enabled ===
      false ||
    CRT_CONFIG.autoAlerts ===
      false
  ) {
    console.log(
      '[CRT] Signal monitor disabled by configuration.'
    );

    return;
  }

  if (!client) {
    throw new Error(
      'Discord client is required for CRT monitor'
    );
  }

  monitorStarted = true;

  console.log(
    '[CRT] Signal monitor started.'
  );

  console.log(
    `[CRT] Markets: ${MARKET_TYPES.join(', ')}`
  );

  console.log(
    `[CRT] Timeframes: ${Object.keys(TIMEFRAMES).join(', ')}`
  );

  console.log(
    `[CRT] Scan interval: ${SCAN_INTERVAL}ms; max symbols/market: ${MAX_SYMBOLS}`
  );

  console.log(
    `[CRT] Liquidity lookback: ${LIQUIDITY_LOOKBACK} candles`
  );

  void scanAll(
    client
  );

  setInterval(
    () =>
      void scanAll(
        client
      ),
    SCAN_INTERVAL
  );
}

// ============================================================
// MANUAL SCAN
// ============================================================

export async function scanCRTNow(
  client
) {
  await scanAll(
    client
  );
}

// ============================================================
// CRT CONFIG
// ============================================================

export function getCRTConfig() {
  return {
    markets:
      MARKET_TYPES,

    timeframes:
      Object.keys(
        TIMEFRAMES
      ),

    scanInterval:
      SCAN_INTERVAL,

    maxSymbolsPerMarket:
      MAX_SYMBOLS,

    liquidityLookback:
      LIQUIDITY_LOOKBACK,

    rsi: {
      period:
        RSI_PERIOD,

      oversold:
        OVERSOLD,

      overbought:
        OVERBOUGHT,
    },
  };
}

// ============================================================
// SERVICE LOADED
// ============================================================

console.log(
  `[CRT] Service loaded • ${Object.keys(TIMEFRAMES).join(', ')}`
);

