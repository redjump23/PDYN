import { EmbedBuilder } from 'discord.js';
import botConfig from '../../config/bot.js';

import {
  buildSignal,
  buildLiveState,
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
// PRIMARY:
//
//   Rachel T Fractal
//   CRT Confirmation
//
// LIVE:
//
//   Current running candle
//   Previous Rachel T fractal liquidity sweep
//
// EXCHANGE:
//
//   MEXC
//
// TIMEFRAMES:
//
//   5m
//   15m
//   1h
//   4h
//   1d
//
// ============================================================
//
// IMPORTANT:
//
// crtEngine.js remains the authority for:
//
//   • Rachel T fractals
//   • CRT confirmation
//   • Market structure
//   • STD deviation
//   • Fractal price
//   • Closed candle liquidity
//   • Live liquidity
//   • RSI
//
// crtService.js is responsible for:
//
//   • MEXC candle retrieval
//   • Exact timeframe scheduling
//   • Closed candle processing
//   • Live liquidity monitoring
//   • Discord alerts
//   • Duplicate prevention
//
// ============================================================

const CRT_CONFIG =
  botConfig.crt || {};

// ============================================================
// TIMEFRAMES
// ============================================================

const TIMEFRAMES =
  CRT_CONFIG.timeframes || {
    '5m': 5,
    '15m': 15,
    '1h': 60,
    '4h': 240,
    '1d': 1440,
  };

// ============================================================
// TIMEFRAME MILLISECONDS
// ============================================================

const TIMEFRAME_MS = {
  '5m':
    5 * 60 * 1000,

  '15m':
    15 * 60 * 1000,

  '1h':
    60 * 60 * 1000,

  '4h':
    4 * 60 * 60 * 1000,

  '1d':
    24 * 60 * 60 * 1000,
};

// ============================================================
// DISCORD CHANNELS
// ============================================================

const CHANNELS =
  CRT_CONFIG.channels || {};

// ============================================================
// MARKETS
// ============================================================

const MARKET_TYPES =
  String(
    CRT_CONFIG.markets ||
      'spot,futures'
  )
    .split(',')
    .map((value) =>
      value
        .trim()
        .toLowerCase()
    )
    .filter(Boolean);

// ============================================================
// CLOSED CANDLE SAFETY SCAN
// ============================================================
//
// This does NOT define the candle timeframe.
//
// MEXC candle boundaries are authoritative.
//
// This interval is only a fallback/safety check.
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

// ============================================================
// LIVE LIQUIDITY INTERVAL
// ============================================================
//
// Current candle is checked independently.
//
// ============================================================

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
// SYMBOL AUTO MODE
// ============================================================

const AUTO_SYMBOLS =
  CRT_CONFIG.autoSymbols !== false;

// ============================================================
// SYMBOL REFRESH
// ============================================================

const SYMBOL_REFRESH_MS =
  Number(
    CRT_CONFIG.symbolRefreshMs ||
      15 * 60 * 1000
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
// SERVICE STATE
// ============================================================

let monitorStarted =
  false;

let scanRunning =
  false;

let baselineInitialized =
  false;

const cachedSymbols =
  new Map();

let lastSymbolRefresh =
  0;

// ============================================================
// TIMER STATE
// ============================================================

const boundaryTimers =
  new Map();

let safetyScanTimer =
  null;

let liveLiquidityTimer =
  null;

// ============================================================
// LIVE SWEEP STATE
// ============================================================
//
// Prevent duplicate alerts while the same running candle
// continues sweeping the same fractal.
//
// ============================================================

const liveSweepSeen =
  new Map();

// ============================================================
// CLOSED CANDLE STATE
// ============================================================
//
// Key:
//
// market:symbol:timeframe:candleOpenTime
//
// ============================================================

const lastProcessedCandle =
  new Map();

// ============================================================
// TIMEFRAME PRIORITY
// ============================================================

const TIMEFRAME_PRIORITY = [
  '5m',
  '15m',
  '1h',
  '4h',
  '1d',
];

// ============================================================
// TIMEFRAME LABEL
// ============================================================

function timeframeLabel(
  timeframe
) {
  return (
    {
      '5m':
        '5 MINUTES',

      '15m':
        '15 MINUTES',

      '1h':
        '1 HOUR',

      '4h':
        '4 HOURS',

      '1d':
        'DAILY',
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
    Math.abs(number) >=
    1000
  ) {
    return number.toLocaleString(
      'en-US',
      {
        minimumFractionDigits:
          2,

        maximumFractionDigits:
          2,
      }
    );
  }

  if (
    Math.abs(number) >=
    1
  ) {
    return number.toLocaleString(
      'en-US',
      {
        maximumFractionDigits:
          5,
      }
    );
  }

  return number.toLocaleString(
    'en-US',
    {
      maximumSignificantDigits:
        7,
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
// ============================================================

function formatRSIState(
  state
) {
  const normalized =
    String(
      state ||
        'Neutral'
    )
      .trim()
      .toUpperCase();

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

  if (
    normalized ===
    'NEUTRAL'
  ) {
    return 'Neutral';
  }

  return 'N/A';
}

// ============================================================
// STD DEVIATION
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
// CLOSED CANDLE LIQUIDITY
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
    sweep.swept ===
    true
  ) {
    const type =
      String(
        sweep.type ||
          ''
      ).toUpperCase();

    if (
      type ===
      'HIGH'
    ) {
      return '**PREVIOUS HIGH SWEPT**';
    }

    if (
      type ===
      'LOW'
    ) {
      return '**PREVIOUS LOW SWEPT**';
    }

    return '**LIQUIDITY SWEPT**';
  }

  return 'None';
}

// ============================================================
// CONFIRMED SIGNAL CHECK
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
// ============================================================

function formatCoin(
  symbol
) {
  return String(
    symbol ||
      'UNKNOWN'
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
// CREATE CRT CONFIRMATION EMBED
// ============================================================
//
// DISPLAY:
//
//   PDYN CRT CONFIRMATION
//   Coin
//   Source
//   Timeframe
//   Market Structure
//   STD Deviation
//   Liquidity
//   RSI
//
// REMOVED:
//
//   • Fractal
//   • Fractal Price
//   • CONFIRM CRT Candle
//
// ============================================================

function createSignalEmbed(signal) {
  const structure =
    getMarketStructure(signal);

  const emoji =
    structureEmoji(signal);

  const coin =
    formatCoin(signal.symbol);

  const rsi =
    formatRSIState(
      signal.rsiState
    );

  const stdDeviation =
    getStdDeviation(signal);

  const liquidity =
    getLiquiditySweep(signal);

  const embed =
    new EmbedBuilder()
      .setTitle(
        `${emoji} ${coin}`
      )
      .setDescription(
        '**PDYN CRT CONFIRMATION**'
      )
      .addFields(
        {
          name: 'Source',
          value: '**MEXC Exchange**',
          inline: false,
        },
        {
          name: 'Timeframe',
          value: timeframeLabel(
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
          value: stdDeviation,
          inline: true,
        },
        {
          name: 'Liquidity',
          value: liquidity,
          inline: true,
        },
        {
          name: 'RSI',
          value: rsi,
          inline: true,
        }
      )
      .setColor(
        signalColor(signal)
      )
      .setFooter({
        text:
          'PDYN • Rachel T CRT • MEXC Exchange',
      });

  // ==========================================================
  // USE THE CLOSED MEXC CANDLE TIME
  // ==========================================================

  if (signal.candleTime) {
    const candleDate =
      new Date(
        signal.candleTime
      );

    if (
      !Number.isNaN(
        candleDate.getTime()
      )
    ) {
      embed.setTimestamp(
        candleDate
      );
    }
  }

  return embed;
}
// ============================================================
// SEND CONFIRMED CRT SIGNAL
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
// SEND LIVE LIQUIDITY ALERT
// ============================================================
//
// IMPORTANT:
//
// This is NOT CRT confirmation.
//
// It means the CURRENT MEXC CANDLE has swept a previous
// Rachel T fractal.
//
// OUTPUT:
//
//   PDYN Liquidity Signal
//   Coin
//   Timeframe
//   Market Structure
//   Liquidity Swept
//
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
    console.warn(
      `[CRT] No Discord channel configured for live ${signal.timeframe}`
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

  const sweep =
    signal.liveLiquiditySweep;

  const type =
    String(
      sweep?.type ||
        ''
    ).toUpperCase();

  const coin =
    formatCoin(
      signal.symbol
    );

  // ==========================================================
  // SAME-TIMEFRAME MARKET STRUCTURE
  // ==========================================================

  const structure =
    getMarketStructure(
      signal
    );

  let sweptFractal =
    '**LIQUIDITY SWEPT**';

  if (
    type ===
    'HIGH'
  ) {
    sweptFractal =
      '**TOP FRACTAL SWEPT**';
  }

  if (
    type ===
    'LOW'
  ) {
    sweptFractal =
      '**BOTTOM FRACTAL SWEPT**';
  }

  const embed =
    new EmbedBuilder()
      .setTitle(
        'PDYN Liquidity Signal'
      )

      .addFields(
        {
          name:
            'Coin',

          value:
            `**${coin}**`,

          inline:
            true,
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
            'Liquidity Swept',

          value:
            sweptFractal,

          inline:
            false,
        }
      )

      .setColor(
        structure.toUpperCase() ===
        'BULLISH'
          ? 0x57f287
          : structure.toUpperCase() ===
            'BEARISH'
            ? 0xed4245
            : 0xfee75c
      )

      .setFooter({
        text:
          'PDYN • Rachel T Fractal • MEXC Exchange • LIVE',
      })

      .setTimestamp(
        new Date()
      );

  await channel.send({
    content:
      `🚨 **PDYN Liquidity Signal — ${coin}**`,

    embeds: [
      embed,
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
    return configured
      .slice(
        0,
        MAX_SYMBOLS
      );
  }

  if (
    !Array.isArray(
      symbols
    )
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

        // ====================================================
        // FUTURES
        // ====================================================

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

        // ====================================================
        // SPOT
        // ====================================================

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
  if (
    !AUTO_SYMBOLS &&
    !force
  ) {
    return;
  }

  if (
    !force &&
    Date.now() -
      lastSymbolRefresh <
      SYMBOL_REFRESH_MS &&
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
      }

      if (
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
// CANDLE OPEN TIME
// ============================================================

function getCandleOpenTime(
  candle
) {
  return Number(
    candle?.openTime ??
      candle?.time ??
      candle?.timestamp ??
      0
  );
}

// ============================================================
// CANDLE CLOSE TIME
// ============================================================

function getCandleCloseTime(
  candle
) {
  return Number(
    candle?.closeTime ??
      candle?.endTime ??
      0
  );
}

// ============================================================
// EXACT NEXT MEXC TIMEFRAME BOUNDARY
// ============================================================
//
// MEXC candle timestamps are UTC-based.
//
// Examples:
//
// 15m:
//
// 00:00
// 00:15
// 00:30
// 00:45
//
// 4h:
//
// 00:00
// 04:00
// 08:00
// 12:00
// 16:00
// 20:00
//
// 1d:
//
// 00:00 UTC
//
// ============================================================

function getNextTimeframeBoundary(
  timestamp,
  timeframe
) {
  const interval =
    TIMEFRAME_MS[
      timeframe
    ];

  if (!interval) {
    throw new Error(
      `Unsupported timeframe: ${timeframe}`
    );
  }

  return (
    Math.floor(
      timestamp /
        interval
    ) *
      interval +
    interval
  );
}

// ============================================================
// SLEEP
// ============================================================

function sleep(
  milliseconds
) {
  return new Promise(
    (resolve) =>
      setTimeout(
        resolve,
        milliseconds
      )
  );
}

// ============================================================
// SCAN SYMBOL — CLOSED CANDLE
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
    // ========================================================

    const now =
      Date.now();

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

          if (
            !Number.isFinite(
              close
            )
          ) {
            return false;
          }

          const closeTime =
            getCandleCloseTime(
              candle
            );

          // If MEXC supplied closeTime, make absolutely sure
          // the candle has actually closed.

          if (
            Number.isFinite(
              closeTime
            ) &&
            closeTime > 0 &&
            closeTime > now
          ) {
            return false;
          }

          return true;
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

    const latestClosed =
      closed[
        closed.length - 1
      ];

    const candleOpenTime =
      getCandleOpenTime(
        latestClosed
      );

    const candleCloseTime =
      getCandleCloseTime(
        latestClosed
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
    // UNIQUE CANDLE KEY
    // ========================================================

    const candleKey = [
      market,
      symbol,
      timeframe,
      candleOpenTime,
    ].join(':');

    // ========================================================
    // ALREADY PROCESSED
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
    //
    // IMPORTANT:
    //
    // crtEngine.js expects:
    //
    // buildSignal(
    //   candles,
    //   options
    // )
    //
    // ========================================================

    const signal =
      buildSignal(
        closed,
        {
          symbol,
          market,
          timeframe,

          rsi: {
            period:
              RSI_PERIOD,

            oversold:
              OVERSOLD,

            overbought:
              OVERBOUGHT,
          },

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
        }
      );

    // ========================================================
    // MARK CANDLE PROCESSED
    // ========================================================
    //
    // Every MEXC candle is processed exactly once.
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
    // MEMORY LIMIT
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
    // NO CRT SIGNAL
    // ========================================================

    if (
      !signal
    ) {
      return;
    }

    // ========================================================
    // FORCE EXCHANGE CANDLE TIME
    // ========================================================

    if (
      !signal.candleTime
    ) {
      signal.candleTime =
        candleOpenTime;
    }

    // ========================================================
    // CONFIRMATION CHECK
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
    // DUPLICATE SIGNAL CHECK
    // ========================================================

    if (
      !isNewSignal(
        signal.id
      )
    ) {
      return;
    }

    // ========================================================
    // SEND
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
        ` | Candle=${new Date(
          candleOpenTime
        ).toISOString()}` +
        ` | Structure=${getMarketStructure(
          signal
        )}` +
        ` | Fractal=${getFractalType(
          signal
        )}` +
        ` | FractalPrice=${getFractalPrice(
          signal
        )}` +
        ` | STD=${getStdDeviation(
          signal
        )}` +
        ` | Liquidity=${getLiquiditySweep(
          signal
        )}` +
        ` | RSI=${
          signal.rsiState ||
          'Neutral'
        }`
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
// SCAN ONE TIMEFRAME
// ============================================================
//
// Used by exact MEXC boundary scheduler.
//
// ============================================================

async function scanTimeframe(
  client,
  timeframe
) {
  if (
    scanRunning
  ) {
    console.log(
      `[CRT] Scan already running. Skipping ${timeframe} boundary.`
    );

    return;
  }

  scanRunning =
    true;

  try {
    await refreshSymbols();

    const markets =
      MARKET_TYPES;

    for (
      const market of
      markets
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
  } catch (
    error
  ) {
    console.error(
      `[CRT] Timeframe scan failed ${timeframe}:`,
      error?.message ||
        error
    );
  } finally {
    scanRunning =
      false;
  }
}

// ============================================================
// SCAN ALL
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

    const ordered =
      TIMEFRAME_PRIORITY.filter(
        (timeframe) =>
          TIMEFRAMES[
            timeframe
          ]
      );

    for (
      const timeframe of
      ordered
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
// LIVE LIQUIDITY — ONE SYMBOL
// ============================================================
//
// CURRENT CANDLE:
//
//   15m candle still running
//          ↓
//   Previous Rachel T fractal swept
//          ↓
//   PDYN Liquidity Signal
//
// This does NOT require candle close.
//
// ============================================================

async function scanLiveLiquiditySymbol(
  client,
  market,
  symbol,
  timeframe,
  suppressAlert = false
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
    // BUILD LIVE STATE
    // ========================================================
    //
    // IMPORTANT:
    //
    // buildLiveState() calculates Market Structure using the
    // SAME timeframe passed here.
    //
    // ========================================================

    const liveState =
      buildLiveState(
        candles,
        {
          symbol,
          market,
          timeframe,
        }
      );

    if (
      !liveState
    ) {
      return;
    }

    const liveSweep =
      liveState.liveLiquiditySweep;

    if (
      !liveSweep?.swept ||
      !liveSweep.fractal
    ) {
      return;
    }

    const liveCandle =
      candles[
        candles.length - 1
      ];

    const liveCandleTime =
      getCandleOpenTime(
        liveCandle
      );

    if (
      !Number.isFinite(
        liveCandleTime
      ) ||
      liveCandleTime <= 0
    ) {
      return;
    }

    const fractalPivotTime =
      Number(
        liveSweep.fractal
          ?.pivotTime ??
          0
      );

    const fractalPrice =
      Number(
        liveSweep.price ??
          liveSweep.level ??
          liveSweep.fractal
            ?.price ??
          0
      );

    // ========================================================
    // UNIQUE LIVE SWEEP KEY
    // ========================================================

    const key = [
      market,
      symbol,
      timeframe,
      liveCandleTime,
      liveSweep.type,
      fractalPivotTime,
      fractalPrice,
    ].join(':');

    // ========================================================
    // ALREADY SEEN
    // ========================================================

    if (
      liveSweepSeen.has(
        key
      )
    ) {
      return;
    }

    // ========================================================
    // SAVE FIRST
    // ========================================================

    liveSweepSeen.set(
      key,
      Date.now()
    );

    // ========================================================
    // MEMORY LIMIT
    // ========================================================

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

    // ========================================================
    // RESTART PROTECTION
    // ========================================================
    //
    // On the first live scan after Railway restart, the current
    // sweep is only initialized into memory.
    //
    // It is NOT sent as a new alert.
    //
    // ========================================================

    if (
      suppressAlert
    ) {
      return;
    }

    // ========================================================
    // SEND LIVE LIQUIDITY SIGNAL
    // ========================================================

    await sendLiveLiquidityAlert(
      client,
      {
        symbol,

        market,

        timeframe,

        // SAME TIMEFRAME STRUCTURE
        marketStructure:
          liveState.marketStructure,

        structure:
          liveState.structure,

        structureType:
          liveState.structureType,

        liveLiquiditySweep:
          liveSweep,

        liveCandleTime,
      }
    );

    console.log(
      `[CRT] LIVE LIQUIDITY SWEPT ${market}:${symbol}:${timeframe}` +
        ` | Structure=${liveState.marketStructure}` +
        ` | Type=${liveSweep.type}` +
        ` | Fractal=${
          liveSweep.fractal
            .fractalType
        }` +
        ` | Candle=${new Date(
          liveCandleTime
        ).toISOString()}`
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

// ============================================================
// LIVE LIQUIDITY SCAN
// ============================================================

async function scanLiveLiquidity(
  client,
  suppressAlert = false
) {
  for (
    const timeframe of
    TIMEFRAME_PRIORITY
  ) {
    if (
      !TIMEFRAMES[
        timeframe
      ]
    ) {
      continue;
    }

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
          timeframe,
          suppressAlert
        );
      }
    }
  }
}

// ============================================================
// EXACT MEXC BOUNDARY SCHEDULER
// ============================================================

function scheduleTimeframeScan(
  client,
  timeframe
) {
  if (
    !TIMEFRAME_MS[
      timeframe
    ]
  ) {
    console.warn(
      `[CRT] Unsupported timeframe: ${timeframe}`
    );

    return;
  }

  if (
    boundaryTimers.has(
      timeframe
    )
  ) {
    return;
  }

  const scheduleNext =
    () => {
      const now =
        Date.now();

      const nextBoundary =
        getNextTimeframeBoundary(
          now,
          timeframe
        );

      // ------------------------------------------------------
      // Small safety delay.
      //
      // This allows the MEXC candle to become fully closed
      // before getKlines() is requested.
      // ------------------------------------------------------

      const delay =
        Math.max(
          250,
          nextBoundary -
            now +
            750
        );

      const timer =
        setTimeout(
          async () => {
            boundaryTimers.delete(
              timeframe
            );

            try {
              console.log(
                `[CRT] ${timeframe} MEXC boundary reached`
              );

              console.log(
                `[CRT] ${timeframe} synchronized scan starting`
              );

              await scanTimeframe(
                client,
                timeframe
              );

              console.log(
                `[CRT] ${timeframe} synchronized scan completed`
              );
            } catch (
              error
            ) {
              console.error(
                `[CRT] ${timeframe} boundary scan failed:`,
                error?.message ||
                  error
              );
            }

            scheduleNext();
          },
          delay
        );

      boundaryTimers.set(
        timeframe,
        timer
      );

      console.log(
        `[CRT] ${timeframe} next MEXC boundary: ${new Date(
          nextBoundary
        ).toISOString()}`
      );
    };

  scheduleNext();
}

// ============================================================
// START CRT MONITOR
// ============================================================
//
// EXACT BOUNDARIES:
//
// 5m:
//
//   :00
//   :05
//   :10
//   :15
//   :20
//   :25
//   :30
//   :35
//   :40
//   :45
//   :50
//   :55
//
// 15m:
//
//   :00
//   :15
//   :30
//   :45
//
// 1h:
//
//   :00
//
// 4h:
//
//   00:00
//   04:00
//   08:00
//   12:00
//   16:00
//   20:00
//
// 1d:
//
//   00:00 UTC
//
// ============================================================

export function startCRTMonitor(
  client
) {
  // ==========================================================
  // PREVENT DUPLICATE MONITOR
  // ==========================================================

  if (
    monitorStarted
  ) {
    console.warn(
      '[CRT] Monitor already started.'
    );

    return;
  }

  // ==========================================================
  // CONFIGURATION CHECK
  // ==========================================================

  if (
    CRT_CONFIG.enabled ===
    false
  ) {
    console.log(
      '[CRT] CRT monitor disabled by configuration.'
    );

    return;
  }

  // ==========================================================
  // CLIENT CHECK
  // ==========================================================

  if (!client) {
    throw new Error(
      'Discord client is required for CRT monitor.'
    );
  }

  monitorStarted =
    true;

  console.log(
    '============================================================'
  );

  console.log(
    '[CRT] PDYN CRT MONITOR STARTING'
  );

  console.log(
    '[CRT] Exchange: MEXC'
  );

  console.log(
    `[CRT] Markets: ${MARKET_TYPES.join(
      ', '
    )}`
  );

  console.log(
    `[CRT] Timeframes: ${TIMEFRAME_PRIORITY.filter(
      (timeframe) =>
        TIMEFRAMES[
          timeframe
        ]
    ).join(
      ', '
    )}`
  );

  console.log(
    `[CRT] Closed-candle safety scan: ${SCAN_INTERVAL}ms`
  );

  console.log(
    `[CRT] Live liquidity scan: ${LIVE_LIQUIDITY_INTERVAL}ms`
  );

  console.log(
    '[CRT] Exact MEXC timeframe synchronization: ENABLED'
  );

  console.log(
    '[CRT] Live Rachel T liquidity monitoring: ENABLED'
  );

  console.log(
    '============================================================'
  );

  // ==========================================================
  // INITIAL SYMBOL REFRESH
  // ==========================================================

  void refreshSymbols(
    true
  )
    .then(
      async () => {
        // ----------------------------------------------------
        // INITIAL CLOSED-CANDLE BASELINE
        //
        // IMPORTANT:
        //
        // Existing closed candles at Railway startup are
        // initialized but NOT alerted.
        //
        // Therefore a Railway restart will not resend an old
        // CRT confirmation.
        // ----------------------------------------------------

        await scanAll(
          client
        );

        // ----------------------------------------------------
        // INITIAL LIVE BASELINE
        //
        // Existing liquidity sweep on the currently-running
        // candle is initialized but NOT alerted immediately
        // after restart.
        // ----------------------------------------------------

        await scanLiveLiquidity(
          client,
          true
        );

        baselineInitialized =
          true;

        console.log(
          '[CRT] Startup baseline initialized.'
        );
      }
    )
    .catch(
      (error) => {
        console.error(
          '[CRT] Startup baseline failed:',
          error?.message ||
            error
        );

        // Allow normal timers to continue even if startup
        // baseline failed.
        baselineInitialized =
          true;
      }
    );

  // ==========================================================
  // EXACT MEXC BOUNDARY SCHEDULERS
  // ==========================================================

  for (
    const timeframe of
    TIMEFRAME_PRIORITY
  ) {
    if (
      TIMEFRAMES[
        timeframe
      ]
    ) {
      scheduleTimeframeScan(
        client,
        timeframe
      );
    }
  }

  // ==========================================================
  // CLOSED-CANDLE SAFETY POLLING
  // ==========================================================
  //
  // This does NOT define candle timing.
  //
  // It only catches a new closed MEXC candle if the exact
  // boundary timer or API request is delayed.
  //
  // ==========================================================

  safetyScanTimer =
    setInterval(
      async () => {
        try {
          if (
            !baselineInitialized
          ) {
            return;
          }

          await scanAll(
            client
          );
        } catch (
          error
        ) {
          console.error(
            '[CRT] Safety scan failed:',
            error?.message ||
              error
          );
        }
      },
      SCAN_INTERVAL
    );

  // ==========================================================
  // LIVE LIQUIDITY MONITOR
  // ==========================================================
  //
  // The current candle is intentionally scanned independently
  // of the closed-candle CRT process.
  //
  // ==========================================================

  liveLiquidityTimer =
    setInterval(
      async () => {
        try {
          if (
            !baselineInitialized
          ) {
            return;
          }

          await scanLiveLiquidity(
            client,
            false
          );
        } catch (
          error
        ) {
          console.error(
            '[CRT] Live liquidity scan failed:',
            error?.message ||
              error
          );
        }
      },
      LIVE_LIQUIDITY_INTERVAL
    );

  console.log(
    '[CRT] Monitor successfully started.'
  );
}

// ============================================================
// MANUAL CRT SCAN
// ============================================================

export async function scanCRTNow(
  client
) {
  await refreshSymbols(
    true
  );

  await scanAll(
    client
  );
}

// ============================================================
// MANUAL LIVE LIQUIDITY SCAN
// ============================================================

export async function scanLiveLiquidityNow(
  client
) {
  await refreshSymbols(
    true
  );

  await scanLiveLiquidity(
    client,
    false
  );
}

// ============================================================
// GET CRT CONFIG
// ============================================================

export function getCRTConfig() {
  return {
    markets:
      MARKET_TYPES,

    timeframes:
      TIMEFRAME_PRIORITY.filter(
        (timeframe) =>
          TIMEFRAMES[
            timeframe
          ]
      ),

    timeframeMilliseconds:
      TIMEFRAME_MS,

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

    exactMexcBoundaries:
      true,

    primarySignal:
      'RACHEL_T_FRACTAL_CRT',

    liveSignal:
      'PDYN_LIQUIDITY_SIGNAL',

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
  `[CRT] Service loaded • Rachel T Fractal PRIMARY • ${TIMEFRAME_PRIORITY.filter(
    (timeframe) =>
      TIMEFRAMES[
        timeframe
      ]
  ).join(
    ', '
  )}`
);

