// ============================================================
// PDYN CRT SERVICE
// ============================================================
//
// PROVIDER:
//   MEXC FUTURES ONLY
//
// SIGNAL ENGINE:
//   Rachel T Fractal
//
// TIMEFRAMES:
//
//   1D
//   4H
//   1H
//   15M
//   5M
//
// SCAN PRIORITY:
//
//   1D
//    ↓
//   4H
//    ↓
//   1H
//    ↓
//   15M
//    ↓
//   5M
//
// ============================================================
// CRT OUTPUT
// ============================================================
//
// Discord output:
//
//   PDYN CRT CONFIRMATION: BTC_USDT
//
//   SOURCE
//   MEXC
//
//   TIMEFRAME
//   15M
//
//   RSI
//   Neutral / **Overbought** / **Oversold**
//
//   VOLUME
//   coin volume
//
//   STD DEV
//   Low / Medium / High
//
//   MARKET STRUCTURE
//   🟢 Bullish
//   🔴 Bearish
//
//   PRICE
//
//   FRACTAL PRICE
//
//   LIQUIDITY
//   SWEPT / NOT SWEPT
//
//   SWEPT PRICE
//   actual liquidity sweep price when available
//
//   CONFIRMED
//
// ============================================================
// IMPORTANT
// ============================================================
//
// • 30M is removed.
// • Rachel T is CRT confirmation.
// • TopDown analysis is REMOVED.
// • HTF alignment is REMOVED.
// • 5M is NOT blocked by HTF conditions.
// • Previous CRT state is handled locally.
// • Startup historical fractals are baseline only.
// • Duplicate signals are blocked.
// • Only CLOSED candles are used.
// • RSI is DISPLAY ONLY.
// • STD DEV is DISPLAY ONLY.
// • Market Structure is DISPLAY ONLY.
// • Scanner is synchronized to timeframe candle boundaries.
// • MEXC API publication delay is accounted for.
// • Liquidity sweep is INFORMATION ONLY.
// • Liquidity sweep does NOT create or block a CRT.
// ============================================================

import {
  EmbedBuilder,
} from "discord.js";

import botConfig from "../../config/bot.js";

import {
  getFuturesSymbols,
  getFuturesKlines,
  getMexcServiceInfo,
} from "./mexcService.js";

// ============================================================
// CONFIG
// ============================================================

const CRT_CONFIG =
  botConfig?.crt || {};

const CRT_TIMEZONE =
  CRT_CONFIG.timezone ||
  "Asia/Manila";

// ============================================================
// TIMEFRAMES
// ============================================================

const TIMEFRAMES = {
  "1d": 1440,
  "4h": 240,
  "1h": 60,
  "15m": 15,
  "5m": 5,
};

// ============================================================
// SCAN PRIORITY
// ============================================================

const SCAN_PRIORITY = [
  "1d",
  "4h",
  "1h",
  "15m",
  "5m",
];

// ============================================================
// API / SCANNER CONFIG
// ============================================================

const CHECK_INTERVAL = 1000;

const CANDLE_CLOSE_DELAY =
  Math.max(
    1000,
    Number(
      CRT_CONFIG.candleCloseDelay
    ) || 2500
  );

const CANDLE_LIMIT =
  Math.min(
    Math.max(
      Number(
        CRT_CONFIG.candleLimit
      ) || 220,
      50
    ),
    1000
  );

const CONCURRENCY =
  Math.max(
    1,
    Math.min(
      Number(
        CRT_CONFIG.concurrency
      ) || 10,
      20
    )
  );

// ============================================================
// MEXC REQUEST COOLDOWN
// ============================================================

const MEXC_BLOCK_COOLDOWN =
  30 * 1000;

// ============================================================
// RSI CONFIG
// ============================================================

const RSI_CONFIG =
  CRT_CONFIG.rsi || {};

const RSI_PERIOD =
  Math.max(
    2,
    Number(
      RSI_CONFIG.period
    ) || 14
  );

const RSI_OVERBOUGHT =
  Number(
    RSI_CONFIG.overbought
  ) || 70;

const RSI_OVERSOLD =
  Number(
    RSI_CONFIG.oversold
  ) || 30;

// ============================================================
// STANDARD DEVIATION
// ============================================================

const STD_DEV_PERIOD =
  20;

const STD_DEV_LOW_PERCENT =
  0.50;

const STD_DEV_MEDIUM_PERCENT =
  1.50;

// ============================================================
// DISCORD CHANNELS
// ============================================================

const CHANNELS =
  CRT_CONFIG.channels || {};

// ============================================================
// SIGNAL STATE
// ============================================================
//
// key:
//
//   MEXC|BTC_USDT|5m
//
// value:
//
//   latest confirmed fractal timestamp
//
// ============================================================

const signalState =
  new Map();

// ============================================================
// STARTUP BASELINE
// ============================================================
//
// Historical latest fractal is stored but never immediately
// sent after Railway restart.
//
// ============================================================

const startupBaseline =
  new Set();

// ============================================================
// MARKET STRUCTURE STATE
// ============================================================
//
// key:
//
//   MEXC|BTC_USDT|15m
//
// value:
//
//   Bullish
//   Bearish
//
// Market structure is DISPLAY ONLY.
//
// ============================================================

const marketStructureState =
  new Map();

// ============================================================
// MONITOR STATE
// ============================================================

let crtMonitorStarted =
  false;

let monitorTimer =
  null;

let scanRunning =
  false;

let initializationRunning =
  false;

// ============================================================
// MEXC STATE
// ============================================================

let mexcSymbolsCache =
  null;

let mexcSymbolsCacheTime =
  0;

const SYMBOL_CACHE_TIME =
  10 * 60 * 1000;

let mexcBlockedUntil =
  0;

// ============================================================
// SCHEDULE STATE
// ============================================================

const processedBoundaryState =
  new Map();

// ============================================================
// NORMALIZE SYMBOL
// ============================================================

function normalizeSymbol(
  symbol
) {
  return String(
    symbol || ""
  )
    .trim()
    .toUpperCase();
}

// ============================================================
// NORMALIZE TIMEFRAME
// ============================================================

function normalizeTimeframe(
  timeframe
) {
  return String(
    timeframe || ""
  )
    .trim()
    .toLowerCase();
}

// ============================================================
// TIMEFRAME VALIDATION
// ============================================================

export function isValidCRTTimeframe(
  timeframe
) {
  return Object.prototype.hasOwnProperty.call(
    TIMEFRAMES,
    normalizeTimeframe(
      timeframe
    )
  );
}

// ============================================================
// AVAILABLE TIMEFRAMES
// ============================================================

export function getAvailableCRTTimeframes() {
  return Object.keys(
    TIMEFRAMES
  );
}

// ============================================================
// PAD
// ============================================================

function pad(
  value
) {
  return String(
    value
  ).padStart(
    2,
    "0"
  );
}

// ============================================================
// ZONED TIME PARTS
// ============================================================

function getZonedParts(
  date = new Date()
) {
  const formatter =
    new Intl.DateTimeFormat(
      "en-US",
      {
        timeZone:
          CRT_TIMEZONE,

        year:
          "numeric",

        month:
          "2-digit",

        day:
          "2-digit",

        hour:
          "2-digit",

        minute:
          "2-digit",

        second:
          "2-digit",

        hourCycle:
          "h23",
      }
    );

  const parts =
    formatter.formatToParts(
      date
    );

  const result = {};

  for (
    const part of parts
  ) {
    if (
      part.type !==
      "literal"
    ) {
      result[
        part.type
      ] =
        Number(
          part.value
        );
    }
  }

  return result;
}

// ============================================================
// CURRENT TIME
// ============================================================

export function getCRTNow() {
  return getZonedParts(
    new Date()
  );
}

// ============================================================
// CURRENT CRT WINDOW
// ============================================================

export function getCurrentCRT(
  timeframe = "15m"
) {
  const normalized =
    normalizeTimeframe(
      timeframe
    );

  if (
    !isValidCRTTimeframe(
      normalized
    )
  ) {
    throw new Error(
      `Invalid CRT timeframe "${timeframe}".`
    );
  }

  const minutes =
    TIMEFRAMES[
      normalized
    ];

  const now =
    getCRTNow();

  const totalMinutes =
    now.hour * 60 +
    now.minute;

  const candleStart =
    Math.floor(
      totalMinutes /
      minutes
    ) * minutes;

  const startHour =
    Math.floor(
      candleStart /
      60
    );

  const startMinute =
    candleStart %
    60;

  const endTotal =
    candleStart +
    minutes;

  const endHour =
    Math.floor(
      endTotal /
      60
    ) % 24;

  const endMinute =
    endTotal %
    60;

  const startTimestamp =
    zonedPartsToTimestamp(
      {
        year:
          now.year,

        month:
          now.month,

        day:
          now.day,

        hour:
          startHour,

        minute:
          startMinute,

        second:
          0,
      }
    );

  const endTimestamp =
    startTimestamp +
    minutes *
    60 *
    1000;

  return {
    timeframe:
      normalized,

    label:
      normalized.toUpperCase(),

    date:
      `${now.year}-${pad(
        now.month
      )}-${pad(
        now.day
      )}`,

    startHour,

    startMinute,

    endHour,

    endMinute,

    startTime:
      `${pad(
        startHour
      )}:${pad(
        startMinute
      )}`,

    endTime:
      `${pad(
        endHour
      )}:${pad(
        endMinute
      )}`,

    startTimestamp,

    endTimestamp,

    timezone:
      CRT_TIMEZONE,
  };
}

// ============================================================
// TIMEZONE-AWARE PARTS TO TIMESTAMP
// ============================================================
//
// Asia/Manila has no DST.
//
// ============================================================

function zonedPartsToTimestamp(
  parts
) {
  return Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour - 8,
    parts.minute,
    parts.second || 0,
    0
  );
}

// ============================================================
// REMAINING TIME
// ============================================================

export function getRemainingTime(
  timeframe = "15m"
) {
  const crt =
    getCurrentCRT(
      timeframe
    );

  const remaining =
    Math.max(
      0,
      crt.endTimestamp -
      Date.now()
    );

  const totalSeconds =
    Math.floor(
      remaining /
      1000
    );

  const hours =
    Math.floor(
      totalSeconds /
      3600
    );

  const minutes =
    Math.floor(
      (
        totalSeconds %
        3600
      ) /
      60
    );

  const seconds =
    totalSeconds %
    60;

  return [
    pad(hours),
    pad(minutes),
    pad(seconds),
  ].join(":");
}

// ============================================================
// CRT STATUS
// ============================================================

export function getCRTStatus(
  timeframe = "15m"
) {
  const crt =
    getCurrentCRT(
      timeframe
    );

  const now =
    getCRTNow();

  return {
    timeframe:
      crt.timeframe,

    label:
      crt.label,

    date:
      crt.date,

    timezone:
      crt.timezone,

    currentTime:
      `${pad(
        now.hour
      )}:${pad(
        now.minute
      )}:${pad(
        now.second
      )}`,

    start:
      crt.startTime,

    end:
      crt.endTime,

    remaining:
      getRemainingTime(
        timeframe
      ),

    startTimestamp:
      crt.startTimestamp,

    endTimestamp:
      crt.endTimestamp,
  };
}

// ============================================================
// ALL CRT STATUS
// ============================================================

export function getAllCRTStatuses() {
  const result = {};

  for (
    const timeframe of
    Object.keys(
      TIMEFRAMES
    )
  ) {
    result[
      timeframe
    ] =
      getCRTStatus(
        timeframe
      );
  }

  return result;
}

// ============================================================
// CANDLE TIMESTAMP
// ============================================================

function getCandleTimestamp(
  candle
) {
  const timestamp =
    Number(
      candle?.timestamp ??
      candle?.openTime
    );

  return Number.isFinite(
    timestamp
  )
    ? timestamp
    : null;
}

// ============================================================
// CANDLE DURATION
// ============================================================

function getTimeframeMilliseconds(
  timeframe
) {
  return (
    TIMEFRAMES[
      normalizeTimeframe(
        timeframe
      )
    ] *
    60 *
    1000
  );
}

// ============================================================
// CLOSED CANDLE CHECK
// ============================================================

function isClosedCandle(
  candle,
  timeframe = null
) {
  if (
    !candle
  ) {
    return false;
  }

  if (
    candle.closed ===
    true
  ) {
    return true;
  }

  const closeTime =
    Number(
      candle.closeTime
    );

  if (
    Number.isFinite(
      closeTime
    )
  ) {
    return (
      closeTime <=
      Date.now()
    );
  }

  const timestamp =
    getCandleTimestamp(
      candle
    );

  if (
    !Number.isFinite(
      timestamp
    ) ||
    !timeframe
  ) {
    return false;
  }

  const duration =
    getTimeframeMilliseconds(
      timeframe
    );

  return (
    timestamp +
    duration <=
    Date.now()
  );
}

// ============================================================
// GET CLOSED CANDLES
// ============================================================

function getClosedCandles(
  candles,
  timeframe
) {
  if (
    !Array.isArray(
      candles
    )
  ) {
    return [];
  }

  return candles
    .filter(
      candle =>
        isClosedCandle(
          candle,
          timeframe
        )
    )
    .sort(
      (
        a,
        b
      ) =>
        getCandleTimestamp(
          a
        ) -
        getCandleTimestamp(
          b
        )
    );
}

// ============================================================
// RACHEL T TOP
// ============================================================
//
// CONFIRMATION MODEL:
//
// C[-4]   C[-3]   C[-2]   C[-1]   C[0]
//
//                         FRACTAL
//                           ↓
//
// C[-2] = fractal candle
// C[-1] = first candle after fractal
// C[0]  = second candle after fractal
//
// The fractal becomes CONFIRMED when C[0] closes.
//
// ============================================================

function isRachelTop(
  candles,
  confirmationIndex
) {
  if (
    !Array.isArray(
      candles
    ) ||
    confirmationIndex <
      4 ||
    confirmationIndex >=
      candles.length
  ) {
    return false;
  }

  const left2 =
    candles[
      confirmationIndex - 4
    ];

  const left1 =
    candles[
      confirmationIndex - 3
    ];

  const fractal =
    candles[
      confirmationIndex - 2
    ];

  const right1 =
    candles[
      confirmationIndex - 1
    ];

  const right2 =
    candles[
      confirmationIndex
    ];

  const left2High =
    Number(
      left2?.high
    );

  const left1High =
    Number(
      left1?.high
    );

  const fractalHigh =
    Number(
      fractal?.high
    );

  const right1High =
    Number(
      right1?.high
    );

  const right2High =
    Number(
      right2?.high
    );

  if (
    !Number.isFinite(
      left2High
    ) ||
    !Number.isFinite(
      left1High
    ) ||
    !Number.isFinite(
      fractalHigh
    ) ||
    !Number.isFinite(
      right1High
    ) ||
    !Number.isFinite(
      right2High
    )
  ) {
    return false;
  }

  return (
    fractalHigh >
      left2High &&
    fractalHigh >=
      left1High &&
    fractalHigh >=
      right1High &&
    fractalHigh >
      right2High
  );
}

// ============================================================
// RACHEL T BOTTOM
// ============================================================
//
// C[-4]   C[-3]   C[-2]   C[-1]   C[0]
//
//                         FRACTAL
//                           ↓
//
// C[-2] = fractal candle
// C[-1] = first candle after fractal
// C[0]  = second candle after fractal
//
// ============================================================

function isRachelBottom(
  candles,
  confirmationIndex
) {
  if (
    !Array.isArray(
      candles
    ) ||
    confirmationIndex <
      4 ||
    confirmationIndex >=
      candles.length
  ) {
    return false;
  }

  const left2 =
    candles[
      confirmationIndex - 4
    ];

  const left1 =
    candles[
      confirmationIndex - 3
    ];

  const fractal =
    candles[
      confirmationIndex - 2
    ];

  const right1 =
    candles[
      confirmationIndex - 1
    ];

  const right2 =
    candles[
      confirmationIndex
    ];

  const left2Low =
    Number(
      left2?.low
    );

  const left1Low =
    Number(
      left1?.low
    );

  const fractalLow =
    Number(
      fractal?.low
    );

  const right1Low =
    Number(
      right1?.low
    );

  const right2Low =
    Number(
      right2?.low
    );

  if (
    !Number.isFinite(
      left2Low
    ) ||
    !Number.isFinite(
      left1Low
    ) ||
    !Number.isFinite(
      fractalLow
    ) ||
    !Number.isFinite(
      right1Low
    ) ||
    !Number.isFinite(
      right2Low
    )
  ) {
    return false;
  }

  return (
    fractalLow <
      left2Low &&
    fractalLow <=
      left1Low &&
    fractalLow <=
      right1Low &&
    fractalLow <
      right2Low
  );
}

// ============================================================
// BUILD FRACTAL SIGNAL
// ============================================================
//
// confirmationIndex = second closed candle after fractal.
//
// fractalIndex = confirmationIndex - 2.
//
// Example:
//
// index 100 = fractal
// index 101 = right candle #1
// index 102 = right candle #2
//
// The CRT is confirmed at index 102.
//
// ============================================================

function buildFractalSignal(
  candles,
  confirmationIndex,
  timeframe
) {
  if (
    !Array.isArray(
      candles
    )
  ) {
    return null;
  }

  if (
    confirmationIndex <
      4 ||
    confirmationIndex >=
      candles.length
  ) {
    return null;
  }

  const confirmationCandle =
    candles[
      confirmationIndex
    ];

  const fractalIndex =
    confirmationIndex - 2;

  const fractalCandle =
    candles[
      fractalIndex
    ];

  if (
    !confirmationCandle ||
    !fractalCandle
  ) {
    return null;
  }

  // ----------------------------------------------------------
  // ONLY CLOSED CANDLES
  // ----------------------------------------------------------

  if (
    !isClosedCandle(
      confirmationCandle,
      timeframe
    )
  ) {
    return null;
  }

  if (
    !isClosedCandle(
      fractalCandle,
      timeframe
    )
  ) {
    return null;
  }

  const fractalTimestamp =
    getCandleTimestamp(
      fractalCandle
    );

  const confirmationTimestamp =
    getCandleTimestamp(
      confirmationCandle
    );

  if (
    !Number.isFinite(
      fractalTimestamp
    ) ||
    !Number.isFinite(
      confirmationTimestamp
    )
  ) {
    return null;
  }

  const close =
    Number(
      fractalCandle.close
    );

  const high =
    Number(
      fractalCandle.high
    );

  const low =
    Number(
      fractalCandle.low
    );

  const volume =
    Number(
      fractalCandle.volume ??
      0
    );

  // ----------------------------------------------------------
  // TOP FRACTAL
  // ----------------------------------------------------------

  if (
    isRachelTop(
      candles,
      confirmationIndex
    )
  ) {
    return {
      type:
        "SELL",

      fractalType:
        "TOP",

      index:
        fractalIndex,

      confirmationIndex,

      timestamp:
        fractalTimestamp,

      confirmationTimestamp,

      price:
        Number.isFinite(
          close
        )
          ? close
          : null,

      fractalPrice:
        Number.isFinite(
          high
        )
          ? high
          : null,

      volume:
        Number.isFinite(
          volume
        )
          ? volume
          : 0,

      timeframe,
    };
  }

  // ----------------------------------------------------------
  // BOTTOM FRACTAL
  // ----------------------------------------------------------

  if (
    isRachelBottom(
      candles,
      confirmationIndex
    )
  ) {
    return {
      type:
        "BUY",

      fractalType:
        "BOTTOM",

      index:
        fractalIndex,

      confirmationIndex,

      timestamp:
        fractalTimestamp,

      confirmationTimestamp,

      price:
        Number.isFinite(
          close
        )
          ? close
          : null,

      fractalPrice:
        Number.isFinite(
          low
        )
          ? low
          : null,

      volume:
        Number.isFinite(
          volume
        )
          ? volume
          : 0,

      timeframe,
    };
  }

  return null;
}

// ============================================================
// FIND LAST CONFIRMED FRACTAL
// ============================================================
//
// Search from the newest CONFIRMATION candle backwards.
//
// ============================================================

function findLastFractal(
  candles,
  timeframe
) {
  if (
    !Array.isArray(
      candles
    ) ||
    candles.length <
      5
  ) {
    return null;
  }

  for (
    let confirmationIndex =
      candles.length - 1;

    confirmationIndex >=
      4;

    confirmationIndex--
  ) {
    const signal =
      buildFractalSignal(
        candles,
        confirmationIndex,
        timeframe
      );

    if (
      signal
    ) {
      return signal;
    }
  }

  return null;
}

// ============================================================
// FIND NEWER FRACTAL
// ============================================================
//
// previousTimestamp is the timestamp of the last FRACTAL
// already sent/baselined.
//
// Every possible confirmation candle is checked.
//
// ============================================================

function findNewestFractalAfter(
  candles,
  previousTimestamp,
  timeframe
) {
  if (
    !Array.isArray(
      candles
    ) ||
    candles.length <
      5
  ) {
    return null;
  }

  let newest =
    null;

  for (
    let confirmationIndex =
      4;

    confirmationIndex <
      candles.length;

    confirmationIndex++
  ) {
    const signal =
      buildFractalSignal(
        candles,
        confirmationIndex,
        timeframe
      );

    if (
      !signal
    ) {
      continue;
    }

    if (
      !Number.isFinite(
        signal.timestamp
      )
    ) {
      continue;
    }

    if (
      signal.timestamp <=
      previousTimestamp
    ) {
      continue;
    }

    if (
      !newest ||
      signal.timestamp >
        newest.timestamp
    ) {
      newest =
        signal;
    }
  }

  return newest;
}

// ============================================================
// LIQUIDITY SWEEP DETECTION
// ============================================================
//
// TOP:
//
//   candle high > fractal high
//
// BOTTOM:
//
//   candle low < fractal low
//
// INFORMATION ONLY.
//
// ============================================================

function findLiquiditySweep(
  candles,
  signal
) {
  if (
    !Array.isArray(
      candles
    ) ||
    !signal
  ) {
    return {
      swept:
        false,

      sweptPrice:
        null,

      sweepTimestamp:
        null,

      sweepCandleTimestamp:
        null,
    };
  }

  const fractalPrice =
    Number(
      signal.fractalPrice
    );

  if (
    !Number.isFinite(
      fractalPrice
    )
  ) {
    return {
      swept:
        false,

      sweptPrice:
        null,

      sweepTimestamp:
        null,

      sweepCandleTimestamp:
        null,
    };
  }

  let sweep =
    null;

  for (
    const candle of
    candles
  ) {
    const timestamp =
      getCandleTimestamp(
        candle
      );

    if (
      !Number.isFinite(
        timestamp
      )
    ) {
      continue;
    }

    if (
      timestamp <
      signal.timestamp
    ) {
      continue;
    }

    if (
      signal.fractalType ===
      "TOP"
    ) {
      const high =
        Number(
          candle.high
        );

      if (
        !Number.isFinite(
          high
        )
      ) {
        continue;
      }

      if (
        high >
        fractalPrice
      ) {
        if (
          !sweep ||
          high >
            sweep.sweptPrice
        ) {
          sweep = {
            swept:
              true,

            sweptPrice:
              high,

            sweepTimestamp:
              timestamp,

            sweepCandleTimestamp:
              timestamp,
          };
        }
      }
    }

    if (
      signal.fractalType ===
      "BOTTOM"
    ) {
      const low =
        Number(
          candle.low
        );

      if (
        !Number.isFinite(
          low
        )
      ) {
        continue;
      }

      if (
        low <
        fractalPrice
      ) {
        if (
          !sweep ||
          low <
            sweep.sweptPrice
        ) {
          sweep = {
            swept:
              true,

            sweptPrice:
              low,

            sweepTimestamp:
              timestamp,

            sweepCandleTimestamp:
              timestamp,
          };
        }
      }
    }
  }

  if (
    !sweep
  ) {
    return {
      swept:
        false,

      sweptPrice:
        null,

      sweepTimestamp:
        null,

      sweepCandleTimestamp:
        null,
    };
  }

  return sweep;
}

// ============================================================
// RSI CALCULATION
// ============================================================
//
// RSI IS DISPLAY ONLY.
//
// ============================================================

export function calculateRSI(
  candles,
  period = RSI_PERIOD
) {
  if (
    !Array.isArray(
      candles
    ) ||
    candles.length <=
      period
  ) {
    return null;
  }

  const closes =
    candles
      .map(
        candle =>
          Number(
            candle.close
          )
      )
      .filter(
        Number.isFinite
      );

  if (
    closes.length <=
      period
  ) {
    return null;
  }

  let gains =
    0;

  let losses =
    0;

  for (
    let i = 1;
    i <= period;
    i++
  ) {
    const change =
      closes[i] -
      closes[i - 1];

    if (
      change > 0
    ) {
      gains +=
        change;
    } else {
      losses +=
        Math.abs(
          change
        );
    }
  }

  let averageGain =
    gains /
    period;

  let averageLoss =
    losses /
    period;

  for (
    let i =
      period + 1;

    i <
      closes.length;

    i++
  ) {
    const change =
      closes[i] -
      closes[i - 1];

    const gain =
      change > 0
        ? change
        : 0;

    const loss =
      change < 0
        ? Math.abs(
            change
          )
        : 0;

    averageGain =
      (
        averageGain *
          (period - 1) +
        gain
      ) /
      period;

    averageLoss =
      (
        averageLoss *
          (period - 1) +
        loss
      ) /
      period;
  }

  if (
    averageLoss ===
    0
  ) {
    return 100;
  }

  if (
    averageGain ===
    0
  ) {
    return 0;
  }

  const rs =
    averageGain /
    averageLoss;

  return (
    100 -
    100 /
      (1 + rs)
  );
}

// ============================================================
// RSI STATE
// ============================================================

function getRSIState(
  rsi
) {
  if (
    !Number.isFinite(
      rsi
    )
  ) {
    return "Neutral";
  }

  if (
    rsi >=
    RSI_OVERBOUGHT
  ) {
    return "Overbought";
  }

  if (
    rsi <=
    RSI_OVERSOLD
  ) {
    return "Oversold";
  }

  return "Neutral";
}

// ============================================================
// FORMAT RSI
// ============================================================

function formatRSIState(
  state
) {
  if (
    state ===
    "Overbought"
  ) {
    return "**Overbought**";
  }

  if (
    state ===
    "Oversold"
  ) {
    return "**Oversold**";
  }

  return "Neutral";
}

// ============================================================
// STANDARD DEVIATION
// ============================================================

export function calculateStandardDeviation(
  candles,
  period = STD_DEV_PERIOD
) {
  if (
    !Array.isArray(
      candles
    ) ||
    candles.length <
      period
  ) {
    return null;
  }

  const recent =
    candles.slice(
      -period
    );

  const values =
    recent
      .map(
        candle =>
          Number(
            candle.close
          )
      )
      .filter(
        Number.isFinite
      );

  if (
    values.length <
      period
  ) {
    return null;
  }

  const mean =
    values.reduce(
      (
        sum,
        value
      ) =>
        sum + value,
      0
    ) /
    values.length;

  if (
    !Number.isFinite(
      mean
    ) ||
    mean === 0
  ) {
    return null;
  }

  const variance =
    values.reduce(
      (
        sum,
        value
      ) =>
        sum +
        Math.pow(
          value -
            mean,
          2
        ),
      0
    ) /
    values.length;

  const value =
    Math.sqrt(
      variance
    );

  const relativePercent =
    (
      Math.abs(
        value
      ) /
      Math.abs(
        mean
      )
    ) *
    100;

  let state =
    "High";

  if (
    relativePercent <
    STD_DEV_LOW_PERCENT
  ) {
    state =
      "Low";
  } else if (
    relativePercent <
    STD_DEV_MEDIUM_PERCENT
  ) {
    state =
      "Medium";
  }

  return {
    value,

    mean,

    relativePercent,

    state,
  };
}

// ============================================================
// MARKET STRUCTURE
// ============================================================
//
// DISPLAY ONLY.
//
// ============================================================

function getMarketStructure(
  candles,
  timeframe = "15m"
) {
  if (
    !Array.isArray(
      candles
    ) ||
    candles.length <
      10
  ) {
    return "Bearish";
  }

  const highs =
    [];

  const lows =
    [];

  for (
    let confirmationIndex =
      4;

    confirmationIndex <
      candles.length;

    confirmationIndex++
  ) {
    const fractalIndex =
      confirmationIndex - 2;

    const fractalCandle =
      candles[
        fractalIndex
      ];

    if (
      isRachelTop(
        candles,
        confirmationIndex
      )
    ) {
      if (
        fractalCandle &&
        Number.isFinite(
          Number(
            fractalCandle.high
          )
        )
      ) {
        highs.push(
          {
            timestamp:
              getCandleTimestamp(
                fractalCandle
              ),

            price:
              Number(
                fractalCandle.high
              ),
          }
        );
      }
    }

    if (
      isRachelBottom(
        candles,
        confirmationIndex
      )
    ) {
      if (
        fractalCandle &&
        Number.isFinite(
          Number(
            fractalCandle.low
          )
        )
      ) {
        lows.push(
          {
            timestamp:
              getCandleTimestamp(
                fractalCandle
              ),

            price:
              Number(
                fractalCandle.low
              ),
          }
        );
      }
    }
  }

  if (
    highs.length >= 2 &&
    lows.length >= 2
  ) {
    const previousHigh =
      highs[
        highs.length - 2
      ];

    const latestHigh =
      highs[
        highs.length - 1
      ];

    const previousLow =
      lows[
        lows.length - 2
      ];

    const latestLow =
      lows[
        lows.length - 1
      ];

    if (
      latestHigh.price >
        previousHigh.price &&
      latestLow.price >
        previousLow.price
    ) {
      return "Bullish";
    }

    if (
      latestHigh.price <
        previousHigh.price &&
      latestLow.price <
        previousLow.price
    ) {
      return "Bearish";
    }
  }

  const recentCount =
    Math.min(
      10,
      candles.length
    );

  const current =
    Number(
      candles[
        candles.length - 1
      ]?.close
    );

  const previous =
    Number(
      candles[
        candles.length -
          recentCount
      ]?.close
    );

  if (
    Number.isFinite(
      current
    ) &&
    Number.isFinite(
      previous
    )
  ) {
    return (
      current >=
      previous
        ? "Bullish"
        : "Bearish"
    );
  }

  return "Bearish";
}

// ============================================================
// TEST MARKET ANALYSIS
// ============================================================

export function testMarketAnalysis(
  candles
) {
  if (
    !Array.isArray(
      candles
    ) ||
    candles.length <
      5
  ) {
    return null;
  }

  const rsi =
    calculateRSI(
      candles
    );

  const stdDev =
    calculateStandardDeviation(
      candles
    );

  return {
    fractal:
      findLastFractal(
        candles,
        "15m"
      ),

    rsi,

    rsiState:
      getRSIState(
        rsi
      ),

    standardDeviation:
      stdDev,

    marketStructure:
      getMarketStructure(
        candles,
        "15m"
      ),
  };
}

// ============================================================
// FETCH MEXC SYMBOLS
// ============================================================

async function getSymbols() {
  const now =
    Date.now();

  if (
    mexcSymbolsCache &&
    now -
      mexcSymbolsCacheTime <
      SYMBOL_CACHE_TIME
  ) {
    return mexcSymbolsCache;
  }

  if (
    now <
    mexcBlockedUntil
  ) {
    return [];
  }

  try {
    const symbols =
      await getFuturesSymbols();

    if (
      !Array.isArray(
        symbols
      )
    ) {
      throw new Error(
        "MEXC Futures symbols response was not an array."
      );
    }

    mexcSymbolsCache =
      [
        ...new Set(
          symbols
            .map(
              normalizeSymbol
            )
            .filter(
              Boolean
            )
        ),
      ];

    mexcSymbolsCacheTime =
      now;

    console.log(
      `[CRT] MEXC Futures symbols loaded: ${mexcSymbolsCache.length}`
    );

    return mexcSymbolsCache;
  } catch (
    error
  ) {
    console.error(
      "[CRT] Failed to load MEXC Futures symbols:",
      error.message
    );

    mexcBlockedUntil =
      Date.now() +
      MEXC_BLOCK_COOLDOWN;

    return [];
  }
}

// ============================================================
// FETCH CANDLES
// ============================================================

async function fetchCandles(
  symbol,
  timeframe
) {
  if (
    Date.now() <
    mexcBlockedUntil
  ) {
    return [];
  }

  try {
    const candles =
      await getFuturesKlines(
        symbol,
        timeframe,
        CANDLE_LIMIT
      );

    if (
      !Array.isArray(
        candles
      )
    ) {
      return [];
    }

    return candles
      .filter(
        candle =>
          Number.isFinite(
            Number(
              candle.timestamp ??
              candle.openTime
            )
          ) &&
          Number.isFinite(
            Number(
              candle.open
            )
          ) &&
          Number.isFinite(
            Number(
              candle.high
            )
          ) &&
          Number.isFinite(
            Number(
              candle.low
            )
          ) &&
          Number.isFinite(
            Number(
              candle.close
            )
          )
      )
      .sort(
        (
          a,
          b
        ) =>
          getCandleTimestamp(
            a
          ) -
          getCandleTimestamp(
            b
          )
      );
  } catch (
    error
  ) {
    console.error(
      `[CRT] Candle fetch failed ${symbol} ${timeframe}:`,
      error.message
    );

    return [];
  }
}

// ============================================================
// FORMAT PRICE
// ============================================================

function formatPrice(
  price
) {
  if (
    !Number.isFinite(
      price
    )
  ) {
    return "N/A";
  }

  if (
    Math.abs(
      price
    ) >= 1000
  ) {
    return price.toLocaleString(
      "en-US",
      {
        minimumFractionDigits:
          2,

        maximumFractionDigits:
          2,
      }
    );
  }

  if (
    Math.abs(
      price
    ) >= 1
  ) {
    return price.toLocaleString(
      "en-US",
      {
        minimumFractionDigits:
          2,

        maximumFractionDigits:
          5,
      }
    );
  }

  return price.toLocaleString(
    "en-US",
    {
      minimumFractionDigits:
        4,

      maximumFractionDigits:
        8,
    }
  );
}

// ============================================================
// FORMAT VOLUME
// ============================================================

function formatVolume(
  volume
) {
  if (
    !Number.isFinite(
      volume
    )
  ) {
    return "N/A";
  }

  const value =
    Math.abs(
      volume
    );

  if (
    value >=
    1000000000
  ) {
    return (
      (
        volume /
        1000000000
      ).toFixed(2) +
      "B"
    );
  }

  if (
    value >=
    1000000
  ) {
    return (
      (
        volume /
        1000000
      ).toFixed(2) +
      "M"
    );
  }

  if (
    value >=
    1000
  ) {
    return (
      (
        volume /
        1000
      ).toFixed(2) +
      "K"
    );
  }

  return Number(
    volume
  ).toFixed(2);
}

// ============================================================
// FORMAT DATE/TIME
// ============================================================

function formatDateTime(
  timestamp
) {
  if (
    !Number.isFinite(
      Number(
        timestamp
      )
    )
  ) {
    return "N/A";
  }

  return new Intl.DateTimeFormat(
    "en-US",
    {
      timeZone:
        CRT_TIMEZONE,

      year:
        "numeric",

      month:
        "2-digit",

      day:
        "2-digit",

      hour:
        "2-digit",

      minute:
        "2-digit",

      second:
        "2-digit",

      hourCycle:
        "h23",
    }
  ).format(
    new Date(
      Number(
        timestamp
      )
    )
  );
}

// ============================================================
// FORMAT MARKET STRUCTURE
// ============================================================

function formatMarketStructure(
  structure
) {
  if (
    structure ===
    "Bullish"
  ) {
    return "🟢 Bullish";
  }

  return "🔴 Bearish";
}

// ============================================================
// GET EMBED COLOR
// ============================================================

function getStructureColor(
  structure
) {
  if (
    structure ===
    "Bullish"
  ) {
    return (
      CRT_CONFIG.colors
        ?.bullish ||
      "#57F287"
    );
  }

  return (
    CRT_CONFIG.colors
      ?.bearish ||
    "#ED4245"
  );
}

// ============================================================
// SET MARKET STRUCTURE STATE
// ============================================================

function setMarketStructureState(
  symbol,
  timeframe,
  structure
) {
  const key =
    `MEXC|${symbol}|${timeframe}`;

  marketStructureState.set(
    key,
    structure
  );
}

// ============================================================
// GET MARKET STRUCTURE STATE
// ============================================================

function getMarketStructureState(
  symbol,
  timeframe
) {
  const key =
    `MEXC|${symbol}|${timeframe}`;

  return (
    marketStructureState.get(
      key
    ) ||
    null
  );
}

// ============================================================
// BUILD MARKET ANALYSIS
// ============================================================

function buildMarketAnalysis(
  candles,
  timeframe
) {
  const rsi =
    calculateRSI(
      candles
    );

  const stdDev =
    calculateStandardDeviation(
      candles
    );

  const marketStructure =
    getMarketStructure(
      candles,
      timeframe
    );

  return {
    rsi,

    rsiState:
      getRSIState(
        rsi
      ),

    stdDev,

    marketStructure,
  };
}

// ============================================================
// CREATE DISCORD EMBED
// ============================================================

function createSignalEmbed(
  data
) {
  const {
    symbol,
    timeframe,
    signal,
    marketStructure,
    rsiState,
    stdDev,
    liquidity,
  } = data;

  const structure =
    marketStructure ===
    "Bullish"
      ? "Bullish"
      : "Bearish";

  const fields = [
    {
      name:
        "SOURCE",

      value:
        "MEXC",

      inline:
        true,
    },

    {
      name:
        "TIMEFRAME",

      value:
        timeframe.toUpperCase(),

      inline:
        true,
    },

    {
      name:
        "RSI",

      value:
        formatRSIState(
          rsiState
        ),

      inline:
        true,
    },

    {
      name:
        "VOLUME",

      value:
        formatVolume(
          signal.volume
        ),

      inline:
        true,
    },

    {
      name:
        "STD DEV",

      value:
        stdDev?.state ||
        "N/A",

      inline:
        true,
    },

    {
      name:
        "MARKET STRUCTURE",

      value:
        formatMarketStructure(
          structure
        ),

      inline:
        true,
    },

    {
      name:
        "PRICE",

      value:
        formatPrice(
          signal.price
        ),

      inline:
        true,
    },

    {
      name:
        "FRACTAL PRICE",

      value:
        formatPrice(
          signal.fractalPrice
        ),

      inline:
        true,
    },

    {
      name:
        "LIQUIDITY",

      value:
        liquidity?.swept
          ? "SWEPT"
          : "NOT SWEPT",

      inline:
        true,
    },
  ];

  // ----------------------------------------------------------
  // SWEPT PRICE
  // ----------------------------------------------------------

  if (
    liquidity?.swept
  ) {
    fields.push(
      {
        name:
          "SWEPT PRICE",

        value:
          formatPrice(
            liquidity.sweptPrice
          ),

        inline:
          true,
      },

      {
        name:
          "SWEEP TIME",

        value:
          formatDateTime(
            liquidity.sweepTimestamp
          ),

        inline:
          true,
      }
    );
  }

  // ----------------------------------------------------------
  // CONFIRMED
  //
  // This is the actual candle on which the Rachel T fractal
  // became confirmed.
  // ----------------------------------------------------------

  fields.push(
    {
      name:
        "CONFIRMED",

      value:
        formatDateTime(
          signal.confirmationTimestamp ??
          signal.timestamp
        ),

      inline:
        false,
    }
  );

  return new EmbedBuilder()
    .setTitle(
      `PDYN CRT CONFIRMATION: ${symbol}`
    )

    .setDescription(
      "Rachel T Fractal Confirmation"
    )

    .addFields(
      fields
    )

    .setColor(
      getStructureColor(
        structure
      )
    )

    .setFooter(
      {
        text:
          CRT_CONFIG.footer ||
          "PDYN • MEXC Futures • CRT Confirmation",
      }
    )

    .setTimestamp(
      new Date(
        signal.confirmationTimestamp ??
        signal.timestamp
      )
    );
}

// ============================================================
// SEND SIGNAL
// ============================================================

async function sendCRTSignal(
  client,
  data
) {
  try {
    const channelId =
      CHANNELS[
        data.timeframe
      ];

    if (
      !channelId
    ) {
      console.warn(
        `[CRT] No Discord channel configured for ${data.timeframe}.`
      );

      return false;
    }

    const channel =
      await client.channels.fetch(
        channelId
      );

    if (
      !channel ||
      typeof channel.send !==
        "function"
    ) {
      console.warn(
        `[CRT] Invalid Discord channel: ${channelId}`
      );

      return false;
    }

    const embed =
      createSignalEmbed(
        data
      );

    await channel.send(
      {
        embeds: [
          embed,
        ],
      }
    );

    console.log(
      `[CRT] CRT CONFIRMATION SENT | ${data.symbol} | ${data.timeframe} | ${data.signal.type} | ${data.signal.fractalType} | FRACTAL: ${formatDateTime(data.signal.timestamp)} | CONFIRMED: ${formatDateTime(data.signal.confirmationTimestamp)} | LIQUIDITY: ${data.liquidity?.swept ? "SWEPT" : "NOT SWEPT"}`
    );

    if (
      data.liquidity?.swept
    ) {
      console.log(
        `[CRT] LIQUIDITY SWEEP | ${data.symbol} | ${data.timeframe} | ${data.signal.fractalType} | FRACTAL: ${formatPrice(data.signal.fractalPrice)} | SWEPT: ${formatPrice(data.liquidity.sweptPrice)}`
      );
    }

    return true;
  } catch (
    error
  ) {
    console.error(
      "[CRT] Discord signal error:",
      error.message
    );

    return false;
  }
}

// ============================================================
// PROCESS MARKET
// ============================================================

async function processMarket(
  client,
  symbol,
  timeframe,
  rawCandles,
  options = {}
) {
  if (
    !Array.isArray(
      rawCandles
    )
  ) {
    return;
  }

  const normalizedSymbol =
    normalizeSymbol(
      symbol
    );

  const normalizedTimeframe =
    normalizeTimeframe(
      timeframe
    );

  if (
    !isValidCRTTimeframe(
      normalizedTimeframe
    )
  ) {
    return;
  }

  // ==========================================================
  // CLOSED CANDLES ONLY
  // ==========================================================

  const candles =
    getClosedCandles(
      rawCandles,
      normalizedTimeframe
    );

  if (
    candles.length <
    20
  ) {
    return;
  }

  const stateKey =
    `MEXC|${normalizedSymbol}|${normalizedTimeframe}`;

  // ==========================================================
  // MARKET ANALYSIS
  // ==========================================================

  const analysis =
    buildMarketAnalysis(
      candles,
      normalizedTimeframe
    );

  // ==========================================================
  // STORE MARKET STRUCTURE
  // ==========================================================

  setMarketStructureState(
    normalizedSymbol,
    normalizedTimeframe,
    analysis.marketStructure
  );

  // ==========================================================
  // FIND FRACTAL
  // ==========================================================

  const previousTimestamp =
    signalState.get(
      stateKey
    );

  let signal =
    null;

  if (
    Number.isFinite(
      previousTimestamp
    )
  ) {
    signal =
      findNewestFractalAfter(
        candles,
        previousTimestamp,
        normalizedTimeframe
      );
  } else {
    signal =
      findLastFractal(
        candles,
        normalizedTimeframe
      );
  }

  if (
    !signal
  ) {
    return;
  }

  // ==========================================================
  // FRACTAL CANDLE
  // ==========================================================

  const fractalCandle =
    candles[
      signal.index
    ];

  const confirmationCandle =
    candles[
      signal.confirmationIndex
    ];

  if (
    !fractalCandle ||
    !confirmationCandle
  ) {
    return;
  }

  signal.symbol =
    normalizedSymbol;

  signal.timeframe =
    normalizedTimeframe;

  signal.volume =
    Number(
      fractalCandle.volume ||
      0
    );

  signal.candleTimestamp =
    getCandleTimestamp(
      fractalCandle
    );

  signal.candleStart =
    signal.candleTimestamp;

  signal.candleEnd =
    signal.candleTimestamp +
    getTimeframeMilliseconds(
      normalizedTimeframe
    );

  signal.confirmationTimestamp =
    getCandleTimestamp(
      confirmationCandle
    );

  // ==========================================================
  // STARTUP BASELINE
  // ==========================================================
  //
  // Historical signal is saved but NOT sent.
  //
  // ==========================================================

  if (
    !startupBaseline.has(
      stateKey
    )
  ) {
    signalState.set(
      stateKey,
      signal.timestamp
    );

    startupBaseline.add(
      stateKey
    );

    console.log(
      `[CRT] BASELINE | ${normalizedSymbol} | ${normalizedTimeframe} | ${signal.type} | ${signal.fractalType} | FRACTAL: ${formatDateTime(signal.timestamp)} | CONFIRMED: ${formatDateTime(signal.confirmationTimestamp)}`
    );

    return;
  }

  // ==========================================================
  // DUPLICATE PROTECTION
  // ==========================================================

  const storedTimestamp =
    signalState.get(
      stateKey
    ) || 0;

  if (
    signal.timestamp <=
    storedTimestamp
  ) {
    return;
  }

  // ==========================================================
  // LIQUIDITY SWEEP
  // ==========================================================

  const liquidity =
    findLiquiditySweep(
      candles,
      signal
    );

  // ==========================================================
  // SAVE STATE BEFORE DISCORD
  // ==========================================================

  signalState.set(
    stateKey,
    signal.timestamp
  );

  // ==========================================================
  // SEND CRT CONFIRMATION
  // ==========================================================

  await sendCRTSignal(
    client,
    {
      symbol:
        normalizedSymbol,

      timeframe:
        normalizedTimeframe,

      signal,

      candles,

      marketStructure:
        analysis.marketStructure,

      rsi:
        analysis.rsi,

      rsiState:
        analysis.rsiState,

      stdDev:
        analysis.stdDev,

      liquidity,
    }
  );
}

// ============================================================
// CONCURRENCY
// ============================================================

async function runWithConcurrency(
  items,
  concurrency,
  worker
) {
  let nextIndex =
    0;

  async function runner() {
    while (
      true
    ) {
      const index =
        nextIndex++;

      if (
        index >=
        items.length
      ) {
        return;
      }

      try {
        await worker(
          items[
            index
          ]
        );
      } catch (
        error
      ) {
        console.error(
          "[CRT] Worker error:",
          error.message
        );
      }
    }
  }

  const workers =
    Math.min(
      concurrency,
      items.length
    );

  if (
    workers <=
    0
  ) {
    return;
  }

  await Promise.all(
    Array.from(
      {
        length:
          workers,
      },
      runner
    )
  );
}

// ============================================================
// GET CURRENT TIMEFRAME BOUNDARY
// ============================================================

function getBoundaryKey(
  timeframe,
  date = new Date()
) {
  const minutes =
    TIMEFRAMES[
      timeframe
    ];

  const zoned =
    getZonedParts(
      date
    );

  const totalMinutes =
    zoned.hour * 60 +
    zoned.minute;

  const boundaryMinute =
    Math.floor(
      totalMinutes /
      minutes
    ) *
    minutes;

  return [
    zoned.year,
    pad(
      zoned.month
    ),
    pad(
      zoned.day
    ),
    pad(
      Math.floor(
        boundaryMinute /
        60
      )
    ),
    pad(
      boundaryMinute %
        60
    ),
  ].join("-");
}

// ============================================================
// GET NEXT CANDLE CLOSE
// ============================================================

function getNextCandleCloseTimestamp(
  timeframe
) {
  const crt =
    getCurrentCRT(
      timeframe
    );

  return crt.endTimestamp;
}

// ============================================================
// IS TIMEFRAME DUE
// ============================================================

function isTimeframeDue(
  timeframe,
  now = Date.now()
) {
  const closeTimestamp =
    getNextCandleCloseTimestamp(
      timeframe
    );

  if (
    now <
    closeTimestamp +
      CANDLE_CLOSE_DELAY
  ) {
    return false;
  }

  const boundaryKey =
    getBoundaryKey(
      timeframe,
      new Date(
        closeTimestamp
      )
    );

  const previous =
    processedBoundaryState.get(
      timeframe
    );

  return (
    previous !==
    boundaryKey
  );
}

// ============================================================
// MARK TIMEFRAME PROCESSED
// ============================================================

function markTimeframeProcessed(
  timeframe,
  closeTimestamp = null
) {
  const timestamp =
    Number.isFinite(
      closeTimestamp
    )
      ? closeTimestamp
      : getNextCandleCloseTimestamp(
          timeframe
        );

  const boundaryKey =
    getBoundaryKey(
      timeframe,
      new Date(
        timestamp
      )
    );

  processedBoundaryState.set(
    timeframe,
    boundaryKey
  );
}

// ============================================================
// GET DUE TIMEFRAMES
// ============================================================

function getDueTimeframes() {
  const now =
    Date.now();

  return SCAN_PRIORITY.filter(
    timeframe =>
      isTimeframeDue(
        timeframe,
        now
      )
  );
}

// ============================================================
// SCAN SINGLE TIMEFRAME
// ============================================================

async function scanTimeframe(
  client,
  timeframe,
  symbols
) {
  console.log(
    `[CRT] PRIORITY SCAN START | ${timeframe.toUpperCase()} | ${symbols.length} symbols`
  );

  const jobs =
    symbols.map(
      symbol => ({
        symbol,
        timeframe,
      })
    );

  await runWithConcurrency(
    jobs,
    CONCURRENCY,
    async job => {
      if (
        Date.now() <
        mexcBlockedUntil
      ) {
        return;
      }

      const candles =
        await fetchCandles(
          job.symbol,
          job.timeframe
        );

      if (
        candles.length <
        20
      ) {
        return;
      }

      await processMarket(
        client,
        job.symbol,
        job.timeframe,
        candles
      );
    }
  );

  console.log(
    `[CRT] PRIORITY SCAN COMPLETE | ${timeframe.toUpperCase()}`
  );
}

// ============================================================
// SYNCHRONIZED SCAN
// ============================================================

async function runSynchronizedScan(
  client
) {
  if (
    initializationRunning
  ) {
    return;
  }

  if (
    scanRunning
  ) {
    console.warn(
      "[CRT] Previous synchronized scan still running."
    );

    return;
  }

  if (
    Date.now() <
    mexcBlockedUntil
  ) {
    return;
  }

  const dueTimeframes =
    getDueTimeframes();

  if (
    !dueTimeframes.length
  ) {
    return;
  }

  scanRunning =
    true;

  const startedAt =
    Date.now();

  try {
    const symbols =
      await getSymbols();

    if (
      !symbols.length
    ) {
      console.warn(
        "[CRT] No MEXC Futures symbols available."
      );

      return;
    }

    console.log(
      `[CRT] SYNCHRONIZED SCAN | ${dueTimeframes
        .map(
          timeframe =>
            timeframe.toUpperCase()
        )
        .join(" -> ")}`
    );

    // ========================================================
    // HIGHER TIMEFRAMES FIRST
    //
    // Priority only.
    //
    // NO HTF dependency.
    // NO alignment blocking.
    // ========================================================

    for (
      const timeframe of
      dueTimeframes
    ) {
      if (
        Date.now() <
        mexcBlockedUntil
      ) {
        break;
      }

      const closeTimestamp =
        getNextCandleCloseTimestamp(
          timeframe
        );

      await scanTimeframe(
        client,
        timeframe,
        symbols
      );

      markTimeframeProcessed(
        timeframe,
        closeTimestamp
      );
    }
  } catch (
    error
  ) {
    console.error(
      "[CRT] Synchronized scan failed:",
      error.message
    );
  } finally {
    const elapsed =
      Date.now() -
      startedAt;

    console.log(
      `[CRT] SYNCHRONIZED SCAN COMPLETE | ${elapsed}ms`
    );

    scanRunning =
      false;
  }
}

// ============================================================
// STARTUP BASELINE SCAN
// ============================================================
//
// Startup MUST NOT send historical signals.
//
// It creates the baseline only.
//
// ============================================================

async function initializeStartupBaseline(
  client
) {
  initializationRunning =
    true;

  try {
    const symbols =
      await getSymbols();

    if (
      !symbols.length
    ) {
      console.warn(
        "[CRT] Startup baseline skipped: no MEXC symbols."
      );

      return;
    }

    console.log(
      "[CRT] Building historical startup baseline..."
    );

    for (
      const timeframe of
      SCAN_PRIORITY
    ) {
      if (
        Date.now() <
        mexcBlockedUntil
      ) {
        break;
      }

      console.log(
        `[CRT] Baseline timeframe: ${timeframe.toUpperCase()}`
      );

      const jobs =
        symbols.map(
          symbol => ({
            symbol,
            timeframe,
          })
        );

      await runWithConcurrency(
        jobs,
        CONCURRENCY,
        async job => {
          const candles =
            await fetchCandles(
              job.symbol,
              job.timeframe
            );

          if (
            candles.length <
            20
          ) {
            return;
          }

          const closed =
            getClosedCandles(
              candles,
              job.timeframe
            );

          if (
            closed.length <
            20
          ) {
            return;
          }

          const analysis =
            buildMarketAnalysis(
              closed,
              job.timeframe
            );

          const normalizedSymbol =
            normalizeSymbol(
              job.symbol
            );

          setMarketStructureState(
            normalizedSymbol,
            job.timeframe,
            analysis.marketStructure
          );

          const signal =
            findLastFractal(
              closed,
              job.timeframe
            );

          if (
            !signal
          ) {
            return;
          }

          const stateKey =
            `MEXC|${normalizedSymbol}|${job.timeframe}`;

          signalState.set(
            stateKey,
            signal.timestamp
          );

          startupBaseline.add(
            stateKey
          );
        }
      );
    }

    // ========================================================
    // MARK CURRENT BOUNDARIES PROCESSED
    //
    // Prevents startup from immediately re-scanning the
    // current already-known boundary.
    // ========================================================

    for (
      const timeframe of
      SCAN_PRIORITY
    ) {
      const crt =
        getCurrentCRT(
          timeframe
        );

      processedBoundaryState.set(
        timeframe,
        getBoundaryKey(
          timeframe,
          new Date(
            crt.startTimestamp
          )
        )
      );
    }

    console.log(
      "[CRT] Historical startup baseline complete."
    );
  } finally {
    initializationRunning =
      false;
  }
}

// ============================================================
// INITIALIZE CRT STATE
// ============================================================

async function initializeCRTState(
  client
) {
  await initializeStartupBaseline(
    client
  );
}

// ============================================================
// START MONITOR
// ============================================================

export function startCRTMonitor(
  client
) {
  if (
    crtMonitorStarted
  ) {
    console.warn(
      "[CRT] Monitor already running."
    );

    return;
  }

  if (
    CRT_CONFIG.enabled ===
    false
  ) {
    console.log(
      "[CRT] CRT disabled."
    );

    return;
  }

  if (
    CRT_CONFIG.autoAlerts ===
    false
  ) {
    console.log(
      "[CRT] CRT auto alerts disabled."
    );

    return;
  }

  if (
    !client
  ) {
    console.error(
      "[CRT] Discord client missing."
    );

    return;
  }

  crtMonitorStarted =
    true;

  console.log(
    "============================================================"
  );

  console.log(
    "[CRT] PDYN CRT SIGNAL MONITOR STARTED"
  );

  console.log(
    "[CRT] Provider: MEXC FUTURES"
  );

  console.log(
    "[CRT] Rachel T Fractal: ENABLED"
  );

  console.log(
    "[CRT] Timeframes: 1D -> 4H -> 1H -> 15M -> 5M"
  );

  console.log(
    "[CRT] 30M: REMOVED"
  );

  console.log(
    "[CRT] TopDown analysis: REMOVED"
  );

  console.log(
    "[CRT] HTF alignment: REMOVED"
  );

  console.log(
    "[CRT] 5M blocking rule: REMOVED"
  );

  console.log(
    "[CRT] Liquidity sweep detection: ENABLED"
  );

  console.log(
    "[CRT] RSI: DISPLAY ONLY"
  );

  console.log(
    "[CRT] Standard Deviation: DISPLAY ONLY"
  );

  console.log(
    "[CRT] Market Structure: DISPLAY ONLY"
  );

  console.log(
    "[CRT] Closed candles only: ENABLED"
  );

  console.log(
    `[CRT] Candle close delay: ${CANDLE_CLOSE_DELAY}ms`
  );

  console.log(
    `[CRT] Request concurrency: ${CONCURRENCY}`
  );

  console.log(
    "[CRT] Candle-boundary synchronization: ENABLED"
  );

  console.log(
    "[CRT] Priority scheduling: ENABLED"
  );

  console.log(
    "[CRT] Discord output: CRT CONFIRMATION + LIQUIDITY"
  );

  console.log(
    "[CRT] Rachel T confirmation: FRACTAL + TWO CLOSED RIGHT CANDLES"
  );

  console.log(
    "============================================================"
  );

  // ==========================================================
  // LOAD BASELINE
  // ==========================================================

  initializeCRTState(
    client
  )
    .then(
      () => {
        console.log(
          "[CRT] Initial state ready. Waiting for MEXC candle boundaries."
        );
      }
    )
    .catch(
      error => {
        console.error(
          "[CRT] Initial state initialization failed:",
          error.message
        );
      }
    );

  // ==========================================================
  // HIGH-FREQUENCY SCHEDULER
  // ==========================================================
  //
  // This does NOT scan the market every second.
  //
  // It only checks whether a timeframe has reached its
  // candle boundary.
  //
  // ==========================================================

  monitorTimer =
    setInterval(
      () => {
        runSynchronizedScan(
          client
        ).catch(
          error => {
            console.error(
              "[CRT] Scheduled scan error:",
              error.message
            );
          }
        );
      },
      CHECK_INTERVAL
    );

  if (
    typeof monitorTimer.unref ===
    "function"
  ) {
    monitorTimer.unref();
  }
}

// ============================================================
// STOP MONITOR
// ============================================================

export function stopCRTMonitor() {
  if (
    monitorTimer
  ) {
    clearInterval(
      monitorTimer
    );

    monitorTimer =
      null;
  }

  crtMonitorStarted =
    false;

  scanRunning =
    false;

  initializationRunning =
    false;

  console.log(
    "[CRT] Monitor stopped."
  );
}

// ============================================================
// MONITOR STATUS
// ============================================================

export function getCRTMonitorStatus() {
  const nextCloseTimes =
    {};

  for (
    const timeframe of
    SCAN_PRIORITY
  ) {
    nextCloseTimes[
      timeframe
    ] =
      getNextCandleCloseTimestamp(
        timeframe
      );
  }

  return {
    started:
      crtMonitorStarted,

    scanRunning,

    initializationRunning,

    schedulerInterval:
      CHECK_INTERVAL,

    candleCloseDelay:
      CANDLE_CLOSE_DELAY,

    candleLimit:
      CANDLE_LIMIT,

    concurrency:
      CONCURRENCY,

    blockedUntil:
      mexcBlockedUntil,

    symbolsCached:
      Array.isArray(
        mexcSymbolsCache
      )
        ? mexcSymbolsCache.length
        : 0,

    timeframes:
      [
        ...SCAN_PRIORITY,
      ],

    thirtyMinute:
      false,

    rachelTFractal:
      true,

    rachelTConfirmation:
      "TWO_CLOSED_RIGHT_CANDLES",

    liquiditySweep:
      true,

    liquiditySweepInformationOnly:
      true,

    rsi:
      true,

    standardDeviation:
      true,

    marketStructure:
      true,

    persistentHTFState:
      false,

    databasePersistence:
      null,

    topDownAnalysis:
      false,

    fiveMinuteAlignment:
      false,

    synchronizedToCandleClose:
      true,

    priorityScheduling:
      true,

    nextCandleClose:
      nextCloseTimes,

    timezone:
      CRT_TIMEZONE,
  };
}

// ============================================================
// GET NEXT CANDLE INFORMATION
// ============================================================

export function getNextCRTClose(
  timeframe = "5m"
) {
  const normalized =
    normalizeTimeframe(
      timeframe
    );

  if (
    !isValidCRTTimeframe(
      normalized
    )
  ) {
    throw new Error(
      `Invalid CRT timeframe "${timeframe}".`
    );
  }

  const closeTimestamp =
    getNextCandleCloseTimestamp(
      normalized
    );

  const remaining =
    Math.max(
      0,
      closeTimestamp -
      Date.now()
    );

  return {
    timeframe:
      normalized,

    closeTimestamp,

    closeTime:
      formatDateTime(
        closeTimestamp
      ),

    remainingMilliseconds:
      remaining,

    remaining:
      formatDuration(
        remaining
      ),

    timezone:
      CRT_TIMEZONE,
  };
}

// ============================================================
// FORMAT DURATION
// ============================================================

function formatDuration(
  milliseconds
) {
  const totalSeconds =
    Math.max(
      0,
      Math.floor(
        milliseconds /
        1000
      )
    );

  const hours =
    Math.floor(
      totalSeconds /
      3600
    );

  const minutes =
    Math.floor(
      (
        totalSeconds %
        3600
      ) /
      60
    );

  const seconds =
    totalSeconds %
    60;

  return (
    `${pad(
      hours
    )}:` +
    `${pad(
      minutes
    )}:` +
    `${pad(
      seconds
    )}`
  );
}

// ============================================================
// SERVICE INFO
// ============================================================

export function getCRTServiceInfo() {
  const mexc =
    getMexcServiceInfo();

  return {
    cryptoProvider:
      "MEXC FUTURES",

    forexProvider:
      null,

    oanda:
      false,

    mexcApi:
      mexc.futuresBaseUrl,

    spot:
      false,

    timeframes:
      Object.keys(
        TIMEFRAMES
      ),

    removedTimeframes:
      [
        "30m",
      ],

    topDownAnalysis:
      false,

    fiveMinuteAlignment:
      false,

    requiredFiveMinuteHTF:
      [],

    rachelTFractal:
      true,

    rachelTConfirmation:
      "TWO_CLOSED_RIGHT_CANDLES",

    liquiditySweep:
      true,

    liquiditySweepInformationOnly:
      true,

    liquiditySweepUsesFractalPrice:
      true,

    liquiditySweepReportsPrice:
      true,

    rsi:
      true,

    rsiDisplayOnly:
      true,

    standardDeviation:
      true,

    standardDeviationDisplayOnly:
      true,

    standardDeviationStates:
      [
        "Low",
        "Medium",
        "High",
      ],

    marketStructure:
      true,

    marketStructureDisplayOnly:
      true,

    marketStructureValues:
      [
        "Bullish",
        "Bearish",
      ],

    marketStructureColor:
      {
        bullish:
          "🟢",

        bearish:
          "🔴",
      },

    persistentPreviousCRT:
      false,

    persistentHTFState:
      false,

    databasePersistence:
      null,

    closedCandleConfirmation:
      true,

    synchronizedScanner:
      true,

    priorityScanner:
      true,

    candleCloseDelay:
      CANDLE_CLOSE_DELAY,

    timezone:
      CRT_TIMEZONE,

    schedulerInterval:
      CHECK_INTERVAL,

    candleLimit:
      CANDLE_LIMIT,

    concurrency:
      CONCURRENCY,

    monitor:
      getCRTMonitorStatus(),
  };
}

// ============================================================
// STARTUP LOG
// ============================================================

console.log(
  "[CRT] PDYN CRT service loaded."
);

console.log(
  "[CRT] MEXC Futures enabled."
);

console.log(
  "[CRT] Rachel T Fractal confirmation enabled."
);

console.log(
  "[CRT] Rachel T confirmation requires two closed candles."
);

console.log(
  "[CRT] Timeframes: 1D -> 4H -> 1H -> 15M -> 5M."
);

console.log(
  "[CRT] 30M removed."
);

console.log(
  "[CRT] TopDown analysis removed."
);

console.log(
  "[CRT] HTF alignment removed."
);

console.log(
  "[CRT] 5M alignment requirement removed."
);

console.log(
  "[CRT] Liquidity sweep detection enabled."
);

console.log(
  "[CRT] Liquidity sweep is informational only."
);

console.log(
  "[CRT] Liquidity sweep price reporting enabled."
);

console.log(
  "[CRT] RSI display enabled."
);

console.log(
  "[CRT] Standard Deviation: Low / Medium / High."
);

console.log(
  "[CRT] Market Structure: Bullish / Bearish."
);

console.log(
  "[CRT] Candle-boundary synchronization enabled."
);

console.log(
  `[CRT] MEXC candle publication delay: ${CANDLE_CLOSE_DELAY}ms.`
);

console.log(
  "[CRT] Priority scanner: 1D -> 4H -> 1H -> 15M -> 5M."
);

console.log(
  "[CRT] Discord output: CRT CONFIRMATION + LIQUIDITY."
);

console.log(
  "[CRT] SIGNAL BUY/SELL field removed."
);

console.log(
  "[CRT] CANDLE field removed."
);

console.log(
  "[CRT] PDYN CRT service ready."
);

