import { EmbedBuilder } from 'discord.js';
import botConfig from '../../config/bot.js';

import {
  buildSignal,
  detectLiveFractalLiquiditySweep,
} from './crtEngine.js';

import {
  getKlines,
  getSpotSymbols,
  getFuturesContracts,
  getConfiguredSymbols,
} from './mexcService.js';

import { isNewSignal } from './signalManager.js';

// ============================================================
// PDYN CRT SERVICE
// ============================================================
//
// PRIMARY PURPOSE:
//
//   Rachel T Fractal / CRT Confirmation
//
// The Rachel T Fractal confirmation is the PRIMARY signal.
//
// Supporting information:
//
//   • Market Structure
//   • STD Deviation
//   • Fractal Price
//   • Liquidity Sweep
//   • RSI
//
// The service DOES NOT calculate another CRT.
// The service DOES NOT calculate another liquidity sweep.
//
// crtEngine.js is responsible for generating:
//
//   • Rachel T fractal
//   • CRT confirmation
//   • Market structure
//   • STD deviation
//   • fractal price
//   • liquidity sweep
//   • RSI
//
// crtService.js only:
//
//   1. Gets MEXC candles
//   2. Removes the still-forming candle
//   3. Sends candles to crtEngine.js
//   4. Receives the confirmed signal
//   5. Displays the signal in Discord
//
// ============================================================

const CRT_CONFIG = botConfig.crt || {};

// ============================================================
// TIMEFRAMES
// ============================================================

const TIMEFRAMES =
  CRT_CONFIG.timeframes || {
    '5m': 5,
    '15m': 15,
    '30m': 30,
    '1h': 60,
    '4h': 240,
    '1d': 1440,
  };

// ============================================================
// DISCORD CHANNELS
// ============================================================

const CHANNELS =
  CRT_CONFIG.channels || {};

// ============================================================
// MARKETS
//
// Default remains spot,futures so the existing configuration
// continues to work.
//
// If bot.js contains:
//
// markets: 'futures'
//
// then only MEXC Futures will be scanned.
// ============================================================

const MARKET_TYPES =
  String(
    CRT_CONFIG.markets ||
      'spot,futures'
  )
    .split(',')
    .map((value) =>
      value.trim().toLowerCase()
    )
    .filter(Boolean);

// ============================================================
// SCAN INTERVAL
// ============================================================
//
// IMPORTANT:
//
// This is ONLY the MEXC candle detection polling interval.
//
// It is NOT the trading timeframe.
//
// The actual signal candle is determined by MEXC:
//
//   5m  -> MEXC 5-minute candle
//   15m -> MEXC 15-minute candle
//   30m -> MEXC 30-minute candle
//   1h  -> MEXC 1-hour candle
//   4h  -> MEXC 4-hour candle
//   1d  -> MEXC daily candle
//
// The poll simply checks frequently enough to detect when
// MEXC has closed a new candle.
//
// ============================================================

const SCAN_INTERVAL =
  Math.max(
    5000,
    Number(
      CRT_CONFIG.scanInterval ||
        5000
    )
  );

// Live liquidity is checked from the currently-forming MEXC candle.
// Keep this separate from the closed-candle signal scheduler.
const LIVE_LIQUIDITY_INTERVAL =
  Math.max(
    3000,
    Number(
      CRT_CONFIG.liveLiquidityInterval ||
        10000
    )
  );

// ============================================================
// KLINE LIMIT
//
// Rachel T fractal confirmation needs historical candles.
// 100 is a safe default.
// ============================================================

const KLINE_LIMIT =
  Math.max(
    50,
    Number(
      CRT_CONFIG.klineLimit ||
        100
    )
  );

// ============================================================
// MAX SYMBOLS
// ============================================================

const MAX_SYMBOLS =
  Math.max(
    1,
    Number(
      CRT_CONFIG.maxSymbolsPerMarket ||
        30
    )
  );

// ============================================================
// RSI
// ============================================================

const RSI_PERIOD =
  Number(
    CRT_CONFIG.rsi?.period ||
      14
  );

const OVERSOLD =
  Number(
    CRT_CONFIG.rsi?.oversold ||
      30
  );

const OVERBOUGHT =
  Number(
    CRT_CONFIG.rsi?.overbought ||
      70
  );

// ============================================================
// SYMBOL MODE
// ============================================================

const AUTO_SYMBOLS =
  CRT_CONFIG.autoSymbols !== false;

// ============================================================
// STATE
// ============================================================

let monitorStarted = false;

let scanRunning = false;

let cachedSymbols =
  new Map();

let lastSymbolRefresh = 0;

// Prevent repeating the same live sweep for the same fractal during
// the same currently-forming candle.
const liveSweepSeen = new Map();

// ============================================================
// MEXC CLOSED CANDLE STATE
// ============================================================
//
// IMPORTANT:
//
// Each MEXC timeframe has its own candle identity.
//
// The bot does NOT construct candle boundaries from Manila time,
// server time, or local time.
//
// The MEXC candle openTime is the identity of the candle.
//
// Examples:
//
//   BTC 15m -> one processing event per MEXC 15m candle
//   BTC 1h  -> one processing event per MEXC 1h candle
//   BTC 4h  -> one processing event per MEXC 4h candle
//   BTC 1d  -> one processing event per MEXC daily candle
//
// The polling interval only checks whether a NEW MEXC closed
// candle is available.
//
// ============================================================

const lastProcessedCandle =
  new Map();

// ============================================================
// TIMEFRAME LABEL
// ============================================================

function timeframeLabel(
  timeframe
) {
  return (
    {
      '5m': '5 MINUTES',
      '15m': '15 MINUTES',
      '30m': '30 MINUTES',
      '1h': '1 HOUR',
      '4h': '4 HOURS',
      '1d': 'DAILY',
    }[timeframe] ||
    String(timeframe)
  );
}

// ============================================================
// PRICE FORMATTER
// ============================================================

function fmtPrice(
  value
) {
  const number =
    Number(value);

  if (
    !Number.isFinite(number)
  ) {
    return 'N/A';
  }

  if (
    Math.abs(number) >= 1000
  ) {
    return number.toLocaleString(
      'en-US',
      {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }
    );
  }

  if (
    Math.abs(number) >= 1
  ) {
    return number.toLocaleString(
      'en-US',
      {
        maximumFractionDigits: 5,
      }
    );
  }

  return number.toLocaleString(
    'en-US',
    {
      maximumSignificantDigits: 7,
    }
  );
}

// ============================================================
// NUMBER FORMATTER
// ============================================================

function fmtNumber(
  value,
  decimals = 2
) {
  const number =
    Number(value);

  if (
    !Number.isFinite(number)
  ) {
    return 'N/A';
  }

  return number.toFixed(
    decimals
  );
}

// ============================================================
// RSI DISPLAY
//
// No RSI number is displayed.
//
// OVERBOUGHT / OVERSOLD = BOLD
// NEUTRAL = NORMAL
// ============================================================

function formatRSIState(
  state
) {
  const normalized =
    String(
      state || 'Neutral'
    ).trim().toUpperCase();

  if (
    normalized ===
    'OVERBOUGHT'
  ) {
    return '**OVERBOUGHT**';
  }

  if (
    normalized ===
    'OVERSOLD'
  ) {
    return '**OVERSOLD**';
  }

  return 'Neutral';
}

// ============================================================
// MARKET STRUCTURE
//
// Accept multiple property names so the service remains
// compatible with crtEngine.js.
//
// Priority:
//
//   marketStructure
//   structure
//   market_structure
// ============================================================

function getMarketStructure(
  signal
) {
  const raw =
    signal?.marketStructure ??
    signal?.structure ??
    signal?.market_structure ??
    '';

  const normalized =
    String(raw)
      .trim()
      .toUpperCase();

  if (
    normalized ===
    'BULLISH'
  ) {
    return 'Bullish';
  }

  if (
    normalized ===
    'BEARISH'
  ) {
    return 'Bearish';
  }

  return 'N/A';
}

// ============================================================
// STD DEVIATION
//
// Accept all names generated by crtEngine.js.
//
// Priority:
//
//   stdDeviation
//   stdDev
//   standardDeviation
// ============================================================

function getStdDeviation(
  signal
) {
  const value =
    signal?.stdDeviation ??
    signal?.stdDev ??
    signal?.standardDeviation;

  return fmtNumber(
    value,
    2
  );
}

// ============================================================
// FRACTAL TYPE
//
// Rachel T fractal is PRIMARY.
//
// Accept:
//
//   fractalType
//   fractal.type
//   type
// ============================================================

function getFractalType(
  signal
) {
  const raw =
    signal?.fractalType ??
    signal?.fractal?.type ??
    signal?.type ??
    '';

  const normalized =
    String(raw)
      .trim()
      .toUpperCase();

  if (
    normalized.includes(
      'TOP'
    ) ||
    normalized.includes(
      'HIGH'
    )
  ) {
    return 'TOP';
  }

  if (
    normalized.includes(
      'BOTTOM'
    ) ||
    normalized.includes(
      'LOW'
    )
  ) {
    return 'BOTTOM';
  }

  return 'N/A';
}

// ============================================================
// FRACTAL PRICE
//
// Rachel T fractal price is the price of the confirmed
// fractal itself.
//
// Priority:
//
//   fractalPrice
//   fractal.price
//
// parentHigh / parentLow are only fallback values.
// ============================================================

function getFractalPrice(
  signal
) {
  const value =
    signal?.fractalPrice ??
    signal?.fractal?.price ??
    (
      getFractalType(
        signal
      ) === 'TOP'
        ? signal?.parentHigh
        : signal?.parentLow
    );

  return fmtPrice(
    value
  );
}

// ============================================================
// LIQUIDITY SWEEP
//
// IMPORTANT:
//
// crtEngine.js is responsible for generating liquiditySweep.
//
// The service DOES NOT calculate another sweep.
//
// This prevents the service from overriding the engine's
// Rachel T fractal interpretation.
// ============================================================

function getLiquiditySweep(
  signal
) {
  const sweep =
    signal?.liquiditySweep;

  if (
    !sweep ||
    typeof sweep !==
      'object'
  ) {
    return 'None';
  }

  if (
    typeof sweep.label ===
      'string' &&
    sweep.label.trim()
  ) {
    return sweep.label;
  }

  if (
    sweep.swept === true
  ) {
    const type =
      String(
        sweep.type || ''
      ).toUpperCase();

    if (
      type === 'HIGH'
    ) {
      return '**PREVIOUS HIGH SWEPT**';
    }

    if (
      type === 'LOW'
    ) {
      return '**PREVIOUS LOW SWEPT**';
    }

    return '**LIQUIDITY SWEPT**';
  }

  return 'None';
}

// ============================================================
// CRT CONFIRMATION
//
// The signal only reaches this service after buildSignal()
// confirms the Rachel T fractal + CRT condition.
//
// Still support explicit confirmation fields for compatibility.
// ============================================================

function isConfirmedSignal(
  signal
) {
  if (
    signal?.confirmed ===
    false
  ) {
    return false;
  }

  if (
    signal?.confirmedCRT ===
    false
  ) {
    return false;
  }

  if (
    signal?.crtConfirmed ===
    false
  ) {
    return false;
  }

  return true;
}

// ============================================================
// CONFIRMATION DISPLAY
// ============================================================

function formatConfirmation(
  signal
) {
  return isConfirmedSignal(
    signal
  )
    ? '**CONFIRMED**'
    : 'NOT CONFIRMED';
}

// ============================================================
// STRUCTURE EMOJI
// ============================================================

function structureEmoji(
  signal
) {
  const structure =
    getMarketStructure(
      signal
    ).toUpperCase();

  if (
    structure ===
    'BULLISH'
  ) {
    return '🟢';
  }

  if (
    structure ===
    'BEARISH'
  ) {
    return '🔴';
  }

  return '🟡';
}

// ============================================================
// EMBED COLOR
//
// BULLISH = GREEN
// BEARISH = RED
// UNKNOWN = YELLOW
// ============================================================

function signalColor(
  signal
) {
  const structure =
    getMarketStructure(
      signal
    ).toUpperCase();

  if (
    structure ===
    'BULLISH'
  ) {
    return 0x57f287;
  }

  if (
    structure ===
    'BEARISH'
  ) {
    return 0xed4245;
  }

  return 0xfee75c;
}

// ============================================================
// COIN SYMBOL FORMATTER
//
// Examples:
//
// BTC_USDT -> BTC
// BTC-USDT -> BTC
// BTCUSDT  -> BTC
// BTC_USD  -> BTC
// BTCUSD   -> BTC
//
// Also handles MEXC futures symbols such as:
//
// BTC_USDT
// ============================================================

function formatCoin(
  symbol
) {
  return String(
    symbol || 'UNKNOWN'
  )
    .replace(
      /[-_]USDT$/i,
      ''
    )
    .replace(
      /USDT$/i,
      ''
    )
    .replace(
      /[-_]USD$/i,
      ''
    )
    .replace(
      /USD$/i,
      ''
    )
    .replace(
      /[-_]$/g,
      ''
    )
    .toUpperCase();
}

// ============================================================
// CREATE CRT EMBED
//
// PRIMARY:
//
//   Rachel T CRT Confirmation
//
// SUPPORTING:
//
//   Market Structure
//   STD Deviation
//   Fractal Price
//   Liquidity
//   RSI
// ============================================================

function createSignalEmbed(
  signal
) {
  const structure =
    getMarketStructure(
      signal
    );

  const emoji =
    structureEmoji(
      signal
    );

  const coin =
    formatCoin(
      signal.symbol
    );

  const rsi =
    formatRSIState(
      signal.rsiState
    );

  const stdDeviation =
    getStdDeviation(
      signal
    );

  const fractalPrice =
    getFractalPrice(
      signal
    );

  const fractalType =
    getFractalType(
      signal
    );

  const liquidity =
    getLiquiditySweep(
      signal
    );

  const confirmation =
    formatConfirmation(
      signal
    );

  return new EmbedBuilder()

    // ========================================================
    // TITLE
    // ========================================================

    .setTitle(
      `${emoji} ${coin}`
    )

    // ========================================================
    // DESCRIPTION
    // ========================================================

    .setDescription(
      '**PDYN CRT CONFIRMATION**'
    )

    // ========================================================
    // INFORMATION
    // ========================================================

    .addFields(

      {
        name:
          'Source',
        value:
          '**MEXC Exchange**',
        inline:
          false,
      },

      {
        name:
          'Timeframe',
        value:
          timeframeLabel(
            signal.timeframe
          ),
        inline:
          true,
      },

      {
        name:
          'Market Structure',
        value:
          structure,
        inline:
          true,
      },

      {
        name:
          'STD Deviation',
        value:
          stdDeviation,
        inline:
          true,
      },

      {
        name:
          'Fractal',
        value:
          fractalType,
        inline:
          true,
      },

      {
        name:
          'Fractal Price',
        value:
          fractalPrice,
        inline:
          true,
      },

      {
        name:
          'Liquidity',
        value:
          liquidity,
        inline:
          true,
      },

      {
        name:
          'CONFIRM CRT Candle',
        value:
          confirmation,
        inline:
          true,
      },

      {
        name:
          'RSI',
        value:
          rsi,
        inline:
          true,
      }

    )

    // ========================================================
    // COLOR
    // ========================================================

    .setColor(
      signalColor(
        signal
      )
    )

    // ========================================================
    // FOOTER
    // ========================================================

    .setFooter({
      text:
        'PDYN • Rachel T CRT • MEXC Exchange',
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
    console.warn(
      `[CRT] Invalid Discord channel for ${signal.timeframe}`
    );

    return;
  }

  const emoji =
    structureEmoji(
      signal
    );

  const coin =
    formatCoin(
      signal.symbol
    );

  await channel.send({
    content:
      `${emoji} **${coin}**`,

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

  if (
    Array.isArray(
      configured
    ) &&
    configured.length
  ) {
    return configured.slice(
      0,
      MAX_SYMBOLS
    );
  }

  if (
    !Array.isArray(symbols)
  ) {
    return [];
  }

  const quote =
    String(
      CRT_CONFIG.quoteAsset ||
        'USDT'
    ).toUpperCase();

  const filtered =
    symbols.filter(
      (item) => {
        const symbol =
          typeof item ===
          'string'
            ? item
            : item?.symbol;

        if (!symbol) {
          return false;
        }

        const normalized =
          String(
            symbol
          ).toUpperCase();

        // ----------------------------------------------------
        // MEXC FUTURES
        // ----------------------------------------------------

        if (
          market ===
          'futures'
        ) {
          const quoteCoin =
            String(
              item?.quoteCoin ||
                ''
            ).toUpperCase();

          return (
            quoteCoin ===
              quote ||
            normalized.endsWith(
              `_${quote}`
            ) ||
            normalized.endsWith(
              `${quote}`
            )
          );
        }

        // ----------------------------------------------------
        // MEXC SPOT
        // ----------------------------------------------------

        return (
          normalized.endsWith(
            quote
          ) ||
          normalized.endsWith(
            `_${quote}`
          )
        );
      }
    );

  return filtered
    .slice(
      0,
      MAX_SYMBOLS
    )
    .map(
      (item) =>
        typeof item ===
        'string'
          ? item
          : item.symbol
    )
    .filter(Boolean);
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
      } else if (
        market ===
        'spot'
      ) {
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
    } catch (
      error
    ) {
      console.error(
        `[CRT] Failed to refresh ${market} symbols:`,
        error?.message ||
          error
      );
    }
  }

  lastSymbolRefresh =
    Date.now();
}

// ============================================================
// SEND LIVE LIQUIDITY ALERT
// ============================================================

async function sendLiveLiquidityAlert(
  client,
  signal
) {
  const channelId =
    CHANNELS[
      signal.timeframe
    ];

  if (!channelId) {
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

  const sweep =
    signal.liveLiquiditySweep;

  const fractal =
    sweep?.fractal;

  const coin =
    formatCoin(
      signal.symbol
    );

  const type =
    String(
      sweep?.type ||
        ''
    ).toUpperCase();

  const currentPrice =
    sweep?.currentPrice;

  const level =
    sweep?.level;

  const fractalTime =
    fractal?.pivotTime
      ? new Date(
          fractal.pivotTime
        ).toISOString()
      : 'N/A';

  const candleTime =
    signal.liveCandleTime
      ? new Date(
          signal.liveCandleTime
        ).toISOString()
      : 'N/A';

  const embed =
    new EmbedBuilder()
      .setTitle(
        `🚨 ${coin}`
      )

      .setDescription(
        '**RACHEL_T LIQUIDITY SWEPT — CURRENT CANDLE RUNNING**'
      )

      .addFields(
        {
          name:
            'Source',

          value:
            '**MEXC Exchange**',

          inline:
            false,
        },

        {
          name:
            'Timeframe',

          value:
            timeframeLabel(
              signal.timeframe
            ),

          inline:
            true,
        },

        {
          name:
            'Liquidity',

          value:
            '**CURRENTLY SWEPT**',

          inline:
            true,
        },

        {
          name:
            'Fractal',

          value:
            fractal?.fractalType ||
            (
              type ===
              'HIGH'
                ? 'FILTERED TOP'
                : 'FILTERED BOTTOM'
            ),

          inline:
            true,
        },

        {
          name:
            'Fractal Price',

          value:
            fmtPrice(
              level
            ),

          inline:
            true,
        },

        {
          name:
            'Current Candle Price',

          value:
            fmtPrice(
              currentPrice
            ),

          inline:
            true,
        },

        {
          name:
            'Fractal Candle',

          value:
            fractalTime,

          inline:
            false,
        },

        {
          name:
            'Current Candle',

          value:
            candleTime,

          inline:
            false,
        }
      )

      .setColor(
        0xfee75c
      )

      .setFooter({
        text:
          'PDYN • Rachel T CRT • MEXC Exchange • LIVE',
      })

      .setTimestamp(
        new Date()
      );

  await channel.send({
    content:
      `🚨 **${coin} — LIQUIDITY SWEPT**`,

    embeds: [
      embed,
    ],
  });
}

// ============================================================
// LIVE LIQUIDITY SCAN
// ============================================================

async function scanLiveLiquiditySymbol(
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

    if (
      !Array.isArray(
        candles
      ) ||
      !candles.length
    ) {
      return;
    }

    const liveSweep =
      detectLiveFractalLiquiditySweep(
        candles
      );

    if (
      !liveSweep?.swept ||
      !liveSweep.fractal
    ) {
      return;
    }

    const liveCandleTime =
      candles[
        candles.length - 1
      ]?.openTime;

    const fractalPivotTime =
      liveSweep
        .fractal
        ?.pivotTime;

    const key = [
      market,
      symbol,
      timeframe,
      liveCandleTime,
      liveSweep.type,
      fractalPivotTime,
      liveSweep.level,
    ].join(':');

    if (
      liveSweepSeen.has(
        key
      )
    ) {
      return;
    }

    liveSweepSeen.set(
      key,
      Date.now()
    );

    // Keep memory bounded.
    if (
      liveSweepSeen.size >
      10000
    ) {
      const first =
        liveSweepSeen
          .keys()
          .next()
          .value;

      if (first) {
        liveSweepSeen.delete(
          first
        );
      }
    }

    await sendLiveLiquidityAlert(
      client,
      {
        symbol,
        market,
        timeframe,

        liveLiquiditySweep:
          liveSweep,

        liveCandleTime,
      }
    );

    console.log(
      `[CRT] LIVE LIQUIDITY SWEPT ${market}:${symbol}:${timeframe}` +
      ` | Type=${liveSweep.type}` +
      ` | Fractal=${liveSweep.fractal.fractalType}` +
      ` | Level=${fmtPrice(liveSweep.level)}`
    );
  } catch (
    error
  ) {
    console.error(
      `[CRT] Live liquidity scan failed ${market}:${symbol}:${timeframe}:`,
      error?.message ||
        error
    );
  }
}

async function scanLiveLiquidity(
  client
) {
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
        await scanLiveLiquiditySymbol(
          client,
          market,
          symbol,
          timeframe
        );
      }
    }
  }
}
// ============================================================
// SCAN SYMBOL
// ============================================================
//
// The service does NOT independently determine whether a CRT
// exists.
//
// crtEngine.js is the authority.
//
// If buildSignal() returns null:
//
//   No confirmed Rachel T CRT signal.
//
// Therefore nothing is sent to Discord.
//
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

    if (
      !Array.isArray(
        candles
      ) ||
      !candles.length
    ) {
      return;
    }

    // ========================================================
    // CLOSED CANDLES ONLY
    //
    // Never allow the currently-forming MEXC candle to become
    // the CRT confirmation candle.
    //
    // MEXC candle data is authoritative.
    //
    // ========================================================

    const closed =
      candles.filter(
        (candle) => {
          if (
            candle?.closed ===
            false
          ) {
            return false;
          }

          const close =
            Number(
              candle?.close
            );

          return Number.isFinite(
            close
          );
        }
      );

    if (
      !closed.length
    ) {
      return;
    }

    // ========================================================
    // MOST RECENT CLOSED MEXC CANDLE
    // ========================================================
    //
    // This is the candle that controls the current timeframe
    // processing event.
    //
    // We use the timestamp supplied by MEXC.
    //
    // We DO NOT calculate this using Manila time.
    //
    // ========================================================

    const latestClosed =
      closed[
        closed.length - 1
      ];

    const candleOpenTime =
      Number(
        latestClosed?.openTime ??
        latestClosed?.time ??
        latestClosed?.timestamp ??
        0
      );

    const candleCloseTime =
      Number(
        latestClosed?.closeTime ??
        latestClosed?.endTime ??
        0
      );

    if (
      !Number.isFinite(
        candleOpenTime
      ) ||
      candleOpenTime <= 0
    ) {
      console.warn(
        `[CRT] Missing MEXC candle openTime: ${market}:${symbol}:${timeframe}`
      );

      return;
    }

    // ========================================================
    // UNIQUE MEXC CANDLE KEY
    // ========================================================
    //
    // The timeframe is part of the key.
    //
    // Therefore:
    //
    // BTC 15m
    // BTC 1h
    // BTC 4h
    // BTC 1d
    //
    // are tracked independently.
    //
    // ========================================================

    const candleKey = [
      market,
      symbol,
      timeframe,
      candleOpenTime,
    ].join(':');

    // ========================================================
    // DO NOT PROCESS THE SAME MEXC CANDLE TWICE
    // ========================================================

    if (
      lastProcessedCandle.has(
        candleKey
      )
    ) {
      return;
    }

    // ========================================================
    // MINIMUM HISTORY
    // ========================================================
    //
    // Rachel T fractal + RSI + standard deviation require
    // historical candles.
    //
    // ========================================================

    const minimumCandles =
      Math.max(
        30,
        RSI_PERIOD + 10,
        7
      );

    if (
      closed.length <
      minimumCandles
    ) {
      return;
    }

    // ========================================================
    // BUILD RACHEL T CRT SIGNAL
    // ========================================================

    const signal =
      buildSignal({
        symbol,
        market,
        timeframe,

        candles:
          closed,

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

    // ========================================================
    // MARK THIS MEXC CANDLE AS PROCESSED
    // ========================================================
    //
    // A candle is marked after the engine has evaluated it,
    // regardless of whether it produced a signal.
    //
    // Otherwise a candle with no Rachel T confirmation would
    // be evaluated again every polling cycle.
    //
    // ========================================================

    lastProcessedCandle.set(
      candleKey,
      {
        openTime:
          candleOpenTime,

        closeTime:
          candleCloseTime,

        processedAt:
          Date.now(),
      }
    );

    // ========================================================
    // KEEP STATE BOUNDED
    // ========================================================

    if (
      lastProcessedCandle.size >
      20000
    ) {
      const first =
        lastProcessedCandle
          .keys()
          .next()
          .value;

      if (first) {
        lastProcessedCandle.delete(
          first
        );
      }
    }

    // ========================================================
    // NO CONFIRMED RACHEL T CRT
    //
    // This is expected most of the time.
    //
    // There is NO artificial signal limit here.
    //
    // If the engine confirms a valid Rachel T fractal/CRT,
    // the signal is allowed through.
    //
    // ========================================================

    if (!signal) {
      return;
    }

    // ========================================================
    // SAFETY
    //
    // The engine must return a confirmed signal.
    // ========================================================

    if (
      !isConfirmedSignal(
        signal
      )
    ) {
      return;
    }

    // ========================================================
    // SIGNAL ID
    //
    // Prevent duplicate Discord alerts.
    // ========================================================

    if (
      !signal.id
    ) {
      console.warn(
        `[CRT] Signal rejected because no signal.id was returned: ${market}:${symbol}:${timeframe}`
      );

      return;
    }

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
    // SEND DISCORD
    // ========================================================

    await sendSignal(
      client,
      signal
    );

    // ========================================================
    // LOG
    // ========================================================

    console.log(
      `[CRT] RACHEL T CONFIRMED ${market}:${symbol}:${timeframe}` +
      ` | Structure=${getMarketStructure(signal)}` +
      ` | Fractal=${getFractalType(signal)}` +
      ` | FractalPrice=${getFractalPrice(signal)}` +
      ` | STD=${getStdDeviation(signal)}` +
      ` | Liquidity=${getLiquiditySweep(signal)}` +
      ` | RSI=${signal.rsiState || 'Neutral'}`
    );
  } catch (
    error
  ) {
    console.error(
      `[CRT] Scan failed ${market}:${symbol}:${timeframe}:`,
      error?.message ||
        error
    );
  }
}

// ============================================================
// SCAN ALL
// ============================================================
//
// Runs every configured timeframe:
//
//   5m
//   15m
//   30m
//   1h
//   4h
//   1d
//
// Within each timeframe:
//
//   configured markets
//
// IMPORTANT:
//
// scanAll() may run every few seconds.
//
// That DOES NOT mean a signal is generated every few seconds.
//
// scanSymbol() uses the actual MEXC closed candle openTime
// and lastProcessedCandle to ensure each MEXC candle is
// evaluated only once.
//
// ============================================================

async function scanAll(
  client
) {
  if (
    scanRunning
  ) {
    return;
  }

  scanRunning =
    true;

  try {
    await refreshSymbols();

    const timeframes =
      Object.keys(
        TIMEFRAMES
      );

    for (
      const timeframe of
      timeframes
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
  } catch (
    error
  ) {
    console.error(
      '[CRT] scanAll failed:',
      error?.message ||
        error
    );
  } finally {
    scanRunning =
      false;
  }
}

// ============================================================
// START CRT MONITOR
// ============================================================

export function startCRTMonitor(
  client
) {
  if (
    monitorStarted
  ) {
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

  monitorStarted =
    true;

  console.log(
    '[CRT] Signal monitor started.'
  );

  console.log(
    '[CRT] PRIMARY SIGNAL: Rachel T Fractal + CRT Confirmation'
  );

  console.log(
    `[CRT] Markets: ${MARKET_TYPES.join(', ')}`
  );

  console.log(
    `[CRT] Timeframes: ${Object.keys(TIMEFRAMES).join(', ')}`
  );

  console.log(
    `[CRT] MEXC candle detection interval: ${SCAN_INTERVAL}ms; live liquidity interval: ${LIVE_LIQUIDITY_INTERVAL}ms; max symbols/market: ${MAX_SYMBOLS}`
  );

  console.log(
    `[CRT] Kline history: ${KLINE_LIMIT} candles`
  );

  console.log(
    `[CRT] Auto symbols: ${AUTO_SYMBOLS}`
  );

  // ==========================================================
  // INITIAL SCAN
  // ==========================================================

  void scanAll(
    client
  );

  // ==========================================================
  // MEXC CLOSED-CANDLE DETECTOR
  // ==========================================================
  //
  // This timer does NOT define the candle timeframe.
  //
  // MEXC defines the candle.
  //
  // The timer only asks:
  //
  // "Has MEXC produced a new closed candle?"
  //
  // scanSymbol() decides this from the MEXC candle's
  // openTime.
  //
  // ==========================================================

  setInterval(
    () =>
      void scanAll(
        client
      ),
    SCAN_INTERVAL
  );

  // ==========================================================
  // LIVE LIQUIDITY MONITOR
  // ==========================================================
  //
  // IMPORTANT:
  //
  // This is intentionally independent from the closed-candle
  // CRT detector.
  //
  // It reads the CURRENTLY RUNNING MEXC CANDLE.
  //
  // Therefore a fractal liquidity sweep can be detected before
  // the candle closes.
  //
  // ==========================================================

  setInterval(
    () =>
      void scanLiveLiquidity(
        client
      ),
    LIVE_LIQUIDITY_INTERVAL
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

    liveLiquidityInterval:
      LIVE_LIQUIDITY_INTERVAL,

    klineLimit:
      KLINE_LIMIT,

    maxSymbolsPerMarket:
      MAX_SYMBOLS,

    autoSymbols:
      AUTO_SYMBOLS,

    rsi: {
      period:
        RSI_PERIOD,

      oversold:
        OVERSOLD,

      overbought:
        OVERBOUGHT,
    },

    primarySignal:
      'RACHEL_T_FRACTAL_CRT',

    supportingData: [
      'MARKET_STRUCTURE',
      'STD_DEVIATION',
      'FRACTAL_PRICE',
      'LIQUIDITY_SWEEP',
      'RSI',
    ],
  };
}

// ============================================================
// SERVICE LOADED
// ============================================================

console.log(
  `[CRT] Service loaded • Rachel T Fractal PRIMARY • ${Object.keys(
    TIMEFRAMES
  ).join(', ')}`
);
