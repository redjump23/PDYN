import { EmbedBuilder } from 'discord.js';
import botConfig from '../../config/bot.js';

import {
  buildSignal,
  getLiveLiquiditySweep,
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
// SUPPORTING DATA:
//
//   • Market Structure
//   • STD Deviation
//   • Fractal Price
//   • Liquidity Sweep
//   • RSI
//
// IMPORTANT:
//
//   crtEngine.js is the authority for:
//   • Rachel T fractals
//   • CRT confirmation
//   • Market structure
//   • STD deviation
//   • fractal price
//   • closed-candle liquidity
//   • RSI
//
//   crtService.js is responsible for:
//   • MEXC candle retrieval
//   • closed-candle timing
//   • live liquidity monitoring
//   • Discord alerts
//   • duplicate prevention
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
// ============================================================
//
// Example:
//
// markets: 'futures'
//
// or:
//
// markets: 'spot,futures'
//
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
// CLOSED-CANDLE SCAN INTERVAL
// ============================================================
//
// This does NOT define the trading timeframe.
//
// MEXC defines the candle.
//
// The timer only checks whether a NEW closed MEXC candle
// exists.
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
// The currently-running MEXC candle is checked independently
// from the closed-candle CRT confirmation process.
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
// SERVICE STATE
// ============================================================

let monitorStarted = false;

let scanRunning = false;

const cachedSymbols =
  new Map();

let lastSymbolRefresh = 0;

// ============================================================
// LIVE SWEEP STATE
// ============================================================
//
// Prevent the same liquidity sweep from being sent repeatedly
// while the same MEXC candle remains active.
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
// This ensures every MEXC closed candle is processed once.
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
//
// Do not display RSI numerical value.
//
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
// CLOSED-CANDLE LIQUIDITY
// ============================================================
//
// crtEngine.js is responsible for calculating the closed-candle
// liquidity sweep.
//
// crtService.js only displays the result.
//
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
// SIGNAL CONFIRMATION
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
// CREATE CRT EMBED
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
      .setColor(
        signalColor(
          signal
        )
      )
      .setFooter({
        text:
          'PDYN • Rachel T CRT • MEXC Exchange',
      });

  if (
    signal.candleTime
  ) {
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
// SEND CONFIRMED SIGNAL
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
//
// This alert is NOT a CRT confirmation.
//
// It means:
//
//   The currently-running MEXC candle has swept a previous
//   Rachel T fractal liquidity level.
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

  let fractalLabel =
    fractal?.fractalType;

  if (
    !fractalLabel
  ) {
    fractalLabel =
      type ===
      'HIGH'
        ? 'FILTERED TOP'
        : type ===
          'LOW'
          ? 'FILTERED BOTTOM'
          : 'RACHEL T FRACTAL';
  }

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
            fractalLabel,
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
// LIVE LIQUIDITY SCAN — ONE SYMBOL
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

    // ========================================================
    // IMPORTANT FIX:
    //
    // crtEngine.js exports:
    //
    //   getLiveLiquiditySweep()
    //
    // NOT:
    //
    //   detectLiveFractalLiquiditySweep()
    //
    // ========================================================

    const liveSweep =
      getLiveLiquiditySweep(
        candles
      );

    if (
      !liveSweep?.swept ||
      !liveSweep.fractal
    ) {
      return;
    }

    // ========================================================
    // CURRENTLY RUNNING CANDLE
    // ========================================================

    const liveCandle =
      candles[
        candles.length - 1
      ];

    const liveCandleTime =
      Number(
        liveCandle?.openTime ??
        liveCandle?.time ??
        liveCandle?.timestamp ??
        0
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
        liveSweep
          .fractal
          ?.pivotTime ??
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
      liveSweep.level,
    ].join(':');

    if (
      liveSweepSeen.has(
        key
      )
    ) {
      return;
    }

    // ========================================================
    // MARK BEFORE SEND
    //
    // This prevents duplicate alerts if Discord/send takes
    // longer than the live scan interval.
    // ========================================================

    liveSweepSeen.set(
      key,
      Date.now()
    );

    // ========================================================
    // KEEP MEMORY BOUNDED
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
    // SEND LIVE LIQUIDITY ALERT
    // ========================================================

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

// ============================================================
// LIVE LIQUIDITY SCAN
// ============================================================

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
// CLOSED-CANDLE SCAN — ONE SYMBOL
// ============================================================
//
// IMPORTANT:
//
// The currently-running candle is NEVER used for CRT
// confirmation.
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

    const candleKey = [
      market,
      symbol,
      timeframe,
      candleOpenTime,
    ].join(':');

    // ========================================================
    // DO NOT PROCESS SAME CANDLE TWICE
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
    // IMPORTANT FIX:
    //
    // crtEngine.js defines:
    //
    //   buildSignal(candles, options)
    //
    // Therefore the CLOSED candles must be the first argument.
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
    // Mark it regardless of whether a signal exists.
    //
    // This prevents repeated evaluation of the same candle.
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
    // NO CONFIRMED CRT
    // ========================================================

    if (!signal) {
      return;
    }

    // ========================================================
    // SAFETY
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
// Timeframe priority:
//
//   5m
//   15m
//   30m
//   1h
//   4h
//   1d
//
// MEXC remains the authority for candle timing.
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
  // ==========================================================
  // PREVENT MULTIPLE MONITORS
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
  // CONFIG CHECK
  // ==========================================================

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

  // ==========================================================
  // CLIENT CHECK
  // ==========================================================

  if (
    !client
  ) {
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
    `[CRT] MEXC candle detection interval: ${SCAN_INTERVAL}ms`
  );

  console.log(
    `[CRT] Live liquidity interval: ${LIVE_LIQUIDITY_INTERVAL}ms`
  );

  console.log(
    `[CRT] Max symbols/market: ${MAX_SYMBOLS}`
  );

  console.log(
    `[CRT] Kline history: ${KLINE_LIMIT} candles`
  );

  console.log(
    `[CRT] Auto symbols: ${AUTO_SYMBOLS}`
  );

  // ==========================================================
  // INITIAL SYMBOL / CANDLE SCAN
  // ==========================================================

  void scanAll(
    client
  );

  // ==========================================================
  // CLOSED-CANDLE MONITOR
  // ==========================================================
  //
  // This timer DOES NOT define the candle timeframe.
  //
  // MEXC defines the candle.
  //
  // The timer only checks for a new closed MEXC candle.
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
  // This reads the currently-running MEXC candle.
  //
  // It is intentionally separate from CRT confirmation.
  //
  // Therefore:
  //
  // 15M candle still running
  //       ↓
  // previous Rachel T fractal gets swept
  //       ↓
  // LIVE LIQUIDITY alert
  //
  // No CRT confirmation is claimed until the candle closes.
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
