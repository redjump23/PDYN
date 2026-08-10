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
// TOP-DOWN:
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
// SIGNAL RULES
// ============================================================
//
// 1D / 4H / 1H / 15M:
//
//   A confirmed Rachel T fractal produces a signal in its
//   designated Discord channel.
//
// 5M:
//
//   A new Rachel T 5M fractal is detected.
//
//   The bot then checks the SAME COIN:
//
//      15M
//      1H
//      4H
//      1D
//
//   Every HTF must have a stored confirmed Rachel T fractal.
//
//   Every HTF fractal must have the SAME direction as 5M.
//
//   Every HTF market structure must agree with that direction.
//
//   BUY:
//
//      5M BUY
//      15M BUY + Bullish
//      1H  BUY + Bullish
//      4H  BUY + Bullish
//      1D  BUY + Bullish
//
//      = SEND
//
//   SELL:
//
//      5M SELL
//      15M SELL + Bearish
//      1H  SELL + Bearish
//      4H  SELL + Bearish
//      1D  SELL + Bearish
//
//      = SEND
//
//   Anything else:
//
//      = DO NOT SEND
//
// ============================================================
//
// IMPORTANT:
//
//   • 30M is removed from CRT.
//   • Rachel T is the CRT confirmation.
//   • HTF state is stored by topDown.js.
//   • PostgreSQL persistence is handled by topDown.js.
//   • Previous HTF fractals are NOT cleared.
//   • HTF is scanned BEFORE 5M.
//   • Startup historical fractals are baseline only.
//   • Duplicate signals are blocked.
//   • Only CLOSED candles are used.
//   • RSI is DISPLAY ONLY.
//   • STD DEV is DISPLAY ONLY.
//   • Market Structure is used for 5M alignment.
//   • 1D / 4H / 1H / 15M signals are still sent normally.
//
// ============================================================
//
// DISCORD OUTPUT:
//
//   PDYN SIGNAL: BTC_USDT
//
//   SOURCE
//   MEXC
//
//   TIMEFRAME
//   5M
//
//   SIGNAL
//   BUY
//
//   FRACTAL
//   BOTTOM
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
//   Bullish / Bearish
//
//   CANDLE
//   date/time + timeframe
//
//   PRICE
//
//   FRACTAL PRICE
//
//   CONFIRMED
//
//   TOP-DOWN
//   4/4 CONFIRMED
//
//   HTF CRT
//   1D BUY • 4H BUY • 1H BUY • 15M BUY
//
//   ALIGNMENT
//   5M BUY • HTF BUY • STRUCTURE BULLISH
//
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

import {
  isTopDownTimeframe,
  getTopDownTimeframes,
  updateTopDownCRT,
  analyzeTopDown,
  formatTopDownCount,
  formatHTFCRTDetails,
  getStoredTopDownState,
  loadTopDownPersistence,
} from "./topDown.js";

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
// TOP-DOWN TIMEFRAMES
// ============================================================

const TOP_DOWN_TIMEFRAMES =
  getTopDownTimeframes();

// ============================================================
// LOWER TIMEFRAME
// ============================================================

const LOWER_TIMEFRAME =
  "5m";

// ============================================================
// HTF ALIGNMENT ORDER
// ============================================================

const HTF_ALIGNMENT_TIMEFRAMES = [
  "15m",
  "1h",
  "4h",
  "1d",
];

// ============================================================
// SCAN ORDER
// ============================================================
//
// HTF MUST be scanned before 5M.
//
// ============================================================

const SCAN_ORDER = [
  "1d",
  "4h",
  "1h",
  "15m",
  "5m",
];

// ============================================================
// CONFIGURATION
// ============================================================

const CHECK_INTERVAL =
  Number(
    CRT_CONFIG.checkInterval
  ) >= 1000
    ? Number(
        CRT_CONFIG.checkInterval
      )
    : 30000;

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
      ) || 3,
      10
    )
  );

const SIGNAL_CLEANUP_INTERVAL =
  30 *
  60 *
  1000;

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

// Relative volatility thresholds.
//
// These are DISPLAY classifications only.
//
// ============================================================

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

const startupBaseline =
  new Set();

// ============================================================
// CLEANUP
// ============================================================

let lastSignalCleanup =
  Date.now();

// ============================================================
// MONITOR STATE
// ============================================================

let crtMonitorStarted =
  false;

let monitorTimer =
  null;

let scanRunning =
  false;

// ============================================================
// MEXC STATE
// ============================================================

let mexcSymbolsCache =
  null;

let mexcSymbolsCacheTime =
  0;

const SYMBOL_CACHE_TIME =
  10 *
  60 *
  1000;

let mexcBlockedUntil =
  0;

const MEXC_BLOCK_COOLDOWN =
  30 *
  1000;

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
    now.hour *
      60 +
    now.minute;

  const candleStart =
    Math.floor(
      totalMinutes /
        minutes
    ) *
    minutes;

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
    ) %
    24;

  const endMinute =
    endTotal %
    60;

  const startTimestamp =
    Date.UTC(
      now.year,
      now.month - 1,
      now.day,
      startHour - 8,
      startMinute,
      0
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
// CLOSED CANDLE CHECK
// ============================================================

function isClosedCandle(
  candle
) {
  if (!candle) {
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

  return false;
}

// ============================================================
// RACHEL T TOP
// ============================================================
//
// Five candle confirmation:
//
//   c4 c3 c2 c1 c0
//
// c2 = fractal candle
//
// ============================================================

function isRachelTop(
  candles,
  index
) {
  if (
    !Array.isArray(
      candles
    ) ||
    index < 4 ||
    index >=
      candles.length
  ) {
    return false;
  }

  const c4 =
    candles[
      index - 4
    ];

  const c3 =
    candles[
      index - 3
    ];

  const c2 =
    candles[
      index - 2
    ];

  const c1 =
    candles[
      index - 1
    ];

  const c0 =
    candles[
      index
    ];

  if (
    !isClosedCandle(
      c4
    ) ||
    !isClosedCandle(
      c3
    ) ||
    !isClosedCandle(
      c2
    ) ||
    !isClosedCandle(
      c1
    ) ||
    !isClosedCandle(
      c0
    )
  ) {
    return false;
  }

  return (
    c4.high <
      c2.high &&

    c3.high <=
      c2.high &&

    c2.high >=
      c1.high &&

    c2.high >
      c0.high
  );
}

// ============================================================
// RACHEL T BOTTOM
// ============================================================

function isRachelBottom(
  candles,
  index
) {
  if (
    !Array.isArray(
      candles
    ) ||
    index < 4 ||
    index >=
      candles.length
  ) {
    return false;
  }

  const c4 =
    candles[
      index - 4
    ];

  const c3 =
    candles[
      index - 3
    ];

  const c2 =
    candles[
      index - 2
    ];

  const c1 =
    candles[
      index - 1
    ];

  const c0 =
    candles[
      index
    ];

  if (
    !isClosedCandle(
      c4
    ) ||
    !isClosedCandle(
      c3
    ) ||
    !isClosedCandle(
      c2
    ) ||
    !isClosedCandle(
      c1
    ) ||
    !isClosedCandle(
      c0
    )
  ) {
    return false;
  }

  return (
    c4.low >
      c2.low &&

    c3.low >=
      c2.low &&

    c2.low <=
      c1.low &&

    c2.low <
      c0.low
  );
}

// ============================================================
// BUILD FRACTAL SIGNAL
// ============================================================

function buildFractalSignal(
  candles,
  index,
  timeframe
) {
  if (
    !Array.isArray(
      candles
    )
  ) {
    return null;
  }

  const candle =
    candles[
      index
    ];

  if (
    !candle ||
    !isClosedCandle(
      candle
    )
  ) {
    return null;
  }

  const timestamp =
    Number(
      candle.timestamp ??
      candle.openTime
    );

  if (
    !Number.isFinite(
      timestamp
    )
  ) {
    return null;
  }

  const close =
    Number(
      candle.close
    );

  const high =
    Number(
      candle.high
    );

  const low =
    Number(
      candle.low
    );

  const volume =
    Number(
      candle.volume ??
      0
    );

  if (
    isRachelTop(
      candles,
      index + 2
    )
  ) {
    return {
      type:
        "SELL",

      fractalType:
        "TOP",

      index,

      timestamp,

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

  if (
    isRachelBottom(
      candles,
      index + 2
    )
  ) {
    return {
      type:
        "BUY",

      fractalType:
        "BOTTOM",

      index,

      timestamp,

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
// FIND LAST FRACTAL
// ============================================================

function findLastFractal(
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

  for (
    let index =
      candles.length -
      1;
    index >= 4;
    index--
  ) {
    const fractalIndex =
      index - 2;

    const signal =
      buildFractalSignal(
        candles,
        fractalIndex,
        null
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

function findNewestFractalAfter(
  candles,
  previousTimestamp
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
    let index = 4;
    index <
    candles.length;
    index++
  ) {
    const fractalIndex =
      index - 2;

    const candle =
      candles[
        fractalIndex
      ];

    const timestamp =
      Number(
        candle?.timestamp ??
        candle?.openTime
      );

    if (
      !Number.isFinite(
        timestamp
      )
    ) {
      continue;
    }

    if (
      timestamp <=
      previousTimestamp
    ) {
      continue;
    }

    const signal =
      buildFractalSignal(
        candles,
        fractalIndex,
        null
      );

    if (
      signal &&
      (
        !newest ||
        signal.timestamp >
          newest.timestamp
      )
    ) {
      newest =
        signal;
    }
  }

  return newest;
}

// ============================================================
// TEST RACHEL FRACTAL
// ============================================================

export function testRachelFractal(
  candles
) {
  if (
    !Array.isArray(
      candles
    )
  ) {
    return null;
  }

  return findLastFractal(
    candles
  );
}

// ============================================================
// RSI CALCULATION
// ============================================================
//
// RSI IS DISPLAY ONLY.
//
// RSI DOES NOT CREATE OR BLOCK CRT SIGNALS.
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
// FORMAT RSI STATE
// ============================================================
//
// Only Overbought and Oversold are bold.
//
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
//
// DISPLAY:
//
//   Low
//   Medium
//   High
//
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
        sum +
        value,
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
// Uses confirmed Rachel-style swing highs/lows.
//
// Bullish:
//
//   latest swing high > previous swing high
//   AND
//   latest swing low  > previous swing low
//
// Bearish:
//
//   latest swing high < previous swing high
//   AND
//   latest swing low  < previous swing low
//
// If mixed, price movement is used as tie-breaker.
//
// Output:
//
//   Bullish
//   Bearish
//
// ============================================================

function getMarketStructure(
  candles
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
    let index = 4;
    index <
    candles.length;
    index++
  ) {
    const fractalIndex =
      index - 2;

    if (
      isRachelTop(
        candles,
        index
      )
    ) {
      const candle =
        candles[
          fractalIndex
        ];

      if (
        candle &&
        Number.isFinite(
          Number(
            candle.high
          )
        )
      ) {
        highs.push(
          {
            timestamp:
              Number(
                candle.timestamp ??
                candle.openTime
              ),

            price:
              Number(
                candle.high
              ),
          }
        );
      }
    }

    if (
      isRachelBottom(
        candles,
        index
      )
    ) {
      const candle =
        candles[
          fractalIndex
        ];

      if (
        candle &&
        Number.isFinite(
          Number(
            candle.low
          )
        )
      ) {
        lows.push(
          {
            timestamp:
              Number(
                candle.timestamp ??
                candle.openTime
              ),

            price:
              Number(
                candle.low
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
    return current >=
      previous
      ? "Bullish"
      : "Bearish";
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
        candles
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
        candles
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
          Number(
            a.timestamp ??
            a.openTime
          ) -
          Number(
            b.timestamp ??
            b.openTime
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
// FORMAT CANDLE
// ============================================================
//
// Example:
//
//   08/10/2026 21:00:00 • 15M CANDLE
//
// ============================================================

function formatCandle(
  candle,
  timeframe
) {
  if (
    !candle
  ) {
    return "N/A";
  }

  const timestamp =
    Number(
      candle.timestamp ??
      candle.openTime
    );

  if (
    !Number.isFinite(
      timestamp
    )
  ) {
    return "N/A";
  }

  return (
    `${formatDateTime(
      timestamp
    )} • ` +
    `${String(
      timeframe
    ).toUpperCase()} CANDLE`
  );
}

// ============================================================
// CHECK 5M TOP-DOWN ALIGNMENT
// ============================================================
//
// THIS IS THE IMPORTANT NEW RULE.
//
// 5M can only be sent when:
//
//   1. All four HTFs exist.
//   2. Every HTF CRT direction equals the 5M direction.
//   3. Every HTF market structure equals the direction.
//
// The current 5M market structure is also required to match.
//
// ============================================================

function check5MAlignment(
  fiveMinuteSignal,
  fiveMinuteMarketStructure,
  topDown,
  htfMarketStructures
) {
  if (
    !fiveMinuteSignal ||
    !topDown
  ) {
    return {
      aligned:
        false,

      reason:
        "Missing 5M or top-down state.",

      direction:
        null,

      confirmed:
        0,

      total:
        HTF_ALIGNMENT_TIMEFRAMES.length,

      details:
        [],
    };
  }

  const direction =
    fiveMinuteSignal.type ===
    "BUY"
      ? "BUY"
      : "SELL";

  const requiredStructure =
    direction ===
    "BUY"
      ? "Bullish"
      : "Bearish";

  const details =
    [];

  let aligned =
    true;

  // ----------------------------------------------------------
  // CURRENT 5M MARKET STRUCTURE
  // ----------------------------------------------------------

  if (
    fiveMinuteMarketStructure !==
    requiredStructure
  ) {
    aligned =
      false;
  }

  details.push(
    {
      timeframe:
        "5m",

      crt:
        direction,

      marketStructure:
        fiveMinuteMarketStructure,

      aligned:
        fiveMinuteMarketStructure ===
        requiredStructure,
    }
  );

  // ----------------------------------------------------------
  // HTF CHECK
  // ----------------------------------------------------------

  for (
    const timeframe of
    HTF_ALIGNMENT_TIMEFRAMES
  ) {
    const signal =
      topDown[
        timeframe
      ];

    const structure =
      htfMarketStructures[
        timeframe
      ];

    const crtAligned =
      Boolean(
        signal
      ) &&
      signal.type ===
        direction;

    const structureAligned =
      structure ===
      requiredStructure;

    const timeframeAligned =
      crtAligned &&
      structureAligned;

    if (
      !timeframeAligned
    ) {
      aligned =
        false;
    }

    details.push(
      {
        timeframe,

        crt:
          signal
            ? signal.type
            : null,

        marketStructure:
          structure ||
          null,

        aligned:
          timeframeAligned,
      }
    );
  }

  // ----------------------------------------------------------
  // ALL FOUR HTFS MUST EXIST
  // ----------------------------------------------------------

  const confirmed =
    HTF_ALIGNMENT_TIMEFRAMES
      .filter(
        timeframe =>
          Boolean(
            topDown[
              timeframe
            ]
          )
      )
      .length;

  if (
    confirmed !==
    HTF_ALIGNMENT_TIMEFRAMES.length
  ) {
    aligned =
      false;
  }

  return {
    aligned,

    reason:
      aligned
        ? "5M CRT + all HTF CRTs + market structure aligned."
        : "5M CRT is not fully aligned with HTF CRTs and market structure.",

    direction,

    requiredStructure,

    confirmed,

    total:
      HTF_ALIGNMENT_TIMEFRAMES.length,

    details,
  };
}

// ============================================================
// FORMAT ALIGNMENT
// ============================================================

function formatAlignment(
  alignment
) {
  if (
    !alignment
  ) {
    return "NOT ALIGNED";
  }

  if (
    alignment.aligned
  ) {
    return (
      `${alignment.direction} • ` +
      `HTF ALIGNED • ` +
      `${alignment.requiredStructure.toUpperCase()}`
    );
  }

  return (
    `NOT ALIGNED • ` +
    `${alignment.confirmed}/4 HTF`
  );
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
    candles,
    topDown,
    marketStructure,
    rsiState,
    stdDev,
    alignment,
  } =
    data;

  const isBuy =
    signal.type ===
    "BUY";

  const color =
    isBuy
      ? (
          CRT_CONFIG.colors?.buy ||
          "#57F287"
        )
      : (
          CRT_CONFIG.colors?.sell ||
          "#ED4245"
        );

  const signalCandle =
    candles?.find(
      candle =>
        Number(
          candle.timestamp ??
          candle.openTime
        ) ===
        Number(
          signal.candleTimestamp
        )
    ) ||
    candles?.[
      signal.index
    ];

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
        "SIGNAL",

      value:
        isBuy
          ? "🟢 BUY"
          : "🔴 SELL",

      inline:
        true,
    },

    {
      name:
        "FRACTAL",

      value:
        signal.fractalType,

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
        marketStructure ===
        "Bullish"
          ? "Bullish"
          : "Bearish",

      inline:
        true,
    },

    {
      name:
        "CANDLE",

      value:
        formatCandle(
          signalCandle,
          timeframe
        ),

      inline:
        false,
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
        "CONFIRMED",

      value:
        formatDateTime(
          signal.timestamp
        ),

      inline:
        false,
    },
  ];

  // ==========================================================
  // 5M TOP-DOWN
  // ==========================================================

  if (
    timeframe ===
    LOWER_TIMEFRAME
  ) {
    fields.push(
      {
        name:
          "TOP-DOWN",

        value:
          topDown
            ? formatTopDownCount(
                topDown
              )
            : "0/4 CONFIRMED",

        inline:
          true,
      },

      {
        name:
          "HTF CRT",

        value:
          topDown
            ? formatHTFCRTDetails(
                topDown
              )
            : "1D N/A • 4H N/A • 1H N/A • 15M N/A",

        inline:
          false,
      },

      {
        name:
          "ALIGNMENT",

        value:
          formatAlignment(
            alignment
          ),

        inline:
          false,
      }
    );
  }

  return new EmbedBuilder()
    .setTitle(
      `PDYN SIGNAL: ${symbol}`
    )

    .setDescription(
      "PDYN CRT Confirmation"
    )

    .addFields(
      fields
    )

    .setColor(
      color
    )

    .setFooter({
      text:
        CRT_CONFIG.footer ||
        "PDYN • MEXC Futures",
    })

    .setTimestamp(
      new Date(
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

    await channel.send({
      embeds: [
        embed,
      ],
    });

    console.log(
      `[CRT] PDYN SIGNAL SENT | ${data.symbol} | ${data.timeframe} | ${data.signal.type} | ${data.signal.fractalType}`
    );

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
// BUILD MARKET ANALYSIS
// ============================================================

function buildMarketAnalysis(
  candles
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
      candles
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
// GET HTF MARKET STRUCTURES
// ============================================================
//
// IMPORTANT:
//
// The 5M scanner does not need to refetch all HTF candles here.
//
// The scanner maintains this cache while processing each HTF.
//
// ============================================================

const marketStructureState =
  new Map();

// key:
//
//   MEXC|BTC_USDT|15m
//
// value:
//
//   Bullish / Bearish
//
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
// CHECK ALL HTF MARKET STRUCTURES
// ============================================================
//
// If the in-memory market structure is not available, the
// function returns null for that timeframe.
//
// This prevents the bot from pretending that an HTF is aligned
// when its structure has never been calculated.
//
// ============================================================

function getHTFMarketStructures(
  symbol
) {
  const result = {};

  for (
    const timeframe of
    HTF_ALIGNMENT_TIMEFRAMES
  ) {
    result[
      timeframe
    ] =
      getMarketStructureState(
        symbol,
        timeframe
      );
  }

  return result;
}

// ============================================================
// PROCESS MARKET
// ============================================================

async function processMarket(
  client,
  symbol,
  timeframe,
  candles
) {
  if (
    !Array.isArray(
      candles
    ) ||
    candles.length <
      20
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

  const stateKey =
    `MEXC|${normalizedSymbol}|${normalizedTimeframe}`;

  // ==========================================================
  // MARKET ANALYSIS
  // ==========================================================

  const analysis =
    buildMarketAnalysis(
      candles
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
        previousTimestamp
      );
  } else {
    signal =
      findLastFractal(
        candles
      );
  }

  // ==========================================================
  // NO NEW FRACTAL
  // ==========================================================

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

  if (
    !fractalCandle
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
    Number(
      fractalCandle.timestamp ??
      fractalCandle.openTime
    );

  signal.candleStart =
    signal.candleTimestamp;

  signal.candleEnd =
    signal.candleTimestamp +
    TIMEFRAMES[
      normalizedTimeframe
    ] *
      60 *
      1000;

  // ==========================================================
  // UPDATE HTF TOP-DOWN
  // ==========================================================

  if (
    isTopDownTimeframe(
      normalizedTimeframe
    )
  ) {
    updateTopDownCRT(
      normalizedSymbol,
      normalizedTimeframe,
      signal
    );
  }

  // ==========================================================
  // STARTUP BASELINE
  // ==========================================================
  //
  // The latest historical fractal becomes the baseline.
  //
  // It is stored.
  //
  // It is NOT immediately sent.
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
      `[CRT] Baseline | ${normalizedSymbol} | ${normalizedTimeframe} | ${signal.type} | ${signal.fractalType}`
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
  // SAVE STATE BEFORE DISCORD
  // ==========================================================

  signalState.set(
    stateKey,
    signal.timestamp
  );

  // ==========================================================
  // TOP-DOWN ANALYSIS
  // ==========================================================

  let topDown =
    null;

  let alignment =
    null;

  // ==========================================================
  // 5M SPECIAL RULE
  // ==========================================================

  if (
    normalizedTimeframe ===
    LOWER_TIMEFRAME
  ) {
    // --------------------------------------------------------
    // Read latest persistent HTF CRT state.
    // --------------------------------------------------------

    topDown =
      analyzeTopDown(
        normalizedSymbol,
        signal
      );

    // --------------------------------------------------------
    // Read market structure for every HTF.
    // --------------------------------------------------------

    const htfMarketStructures =
      getHTFMarketStructures(
        normalizedSymbol
      );

    // --------------------------------------------------------
    // Verify:
    //
    // 5M CRT
    // 15M CRT
    // 1H CRT
    // 4H CRT
    // 1D CRT
    //
    // AND:
    //
    // 5M structure
    // 15M structure
    // 1H structure
    // 4H structure
    // 1D structure
    //
    // --------------------------------------------------------

    alignment =
      check5MAlignment(
        signal,
        analysis.marketStructure,
        topDown,
        htfMarketStructures
      );

    // --------------------------------------------------------
    // DO NOT SEND UNALIGNED 5M SIGNAL.
    // --------------------------------------------------------

    if (
      !alignment.aligned
    ) {
      console.log(
        `[CRT] 5M BLOCKED | ${normalizedSymbol} | ${signal.type} | ${alignment.confirmed}/4 HTF | ${alignment.reason}`
      );

      return;
    }

    console.log(
      `[CRT] 5M ALIGNED | ${normalizedSymbol} | ${signal.type} | 15M + 1H + 4H + 1D | ${analysis.marketStructure}`
    );
  }

  // ==========================================================
  // SEND SIGNAL
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

      topDown,

      marketStructure:
        analysis.marketStructure,

      rsi:
        analysis.rsi,

      rsiState:
        analysis.rsiState,

      stdDev:
        analysis.stdDev,

      alignment,
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
// CLEANUP
// ============================================================
//
// 30M is NOT scanned.
//
// This only removes legacy state if it exists.
//
// ============================================================

function cleanupOldState() {
  const now =
    Date.now();

  if (
    now -
      lastSignalCleanup <
    SIGNAL_CLEANUP_INTERVAL
  ) {
    return;
  }

  lastSignalCleanup =
    now;

  let removed =
    0;

  for (
    const key of
    signalState.keys()
  ) {
    if (
      key.endsWith(
        "|30m"
      )
    ) {
      signalState.delete(
        key
      );

      startupBaseline.delete(
        key
      );

      removed++;
    }
  }

  for (
    const key of
    marketStructureState.keys()
  ) {
    if (
      key.endsWith(
        "|30m"
      )
    ) {
      marketStructureState.delete(
        key
      );
    }
  }

  console.log(
    `[CRT] Legacy 30M state cleanup completed. Removed: ${removed}`
  );
}

// ============================================================
// SCAN MEXC
// ============================================================

async function scanMexc(
  client
) {
  cleanupOldState();

  if (
    Date.now() <
    mexcBlockedUntil
  ) {
    console.warn(
      "[CRT] MEXC temporarily blocked."
    );

    return;
  }

  const symbols =
    await getSymbols();

  if (
    !symbols.length
  ) {
    console.warn(
      "[CRT] No MEXC Futures symbols found."
    );

    return;
  }

  console.log(
    `[CRT] Scanning ${symbols.length} MEXC Futures symbols.`
  );

  // ==========================================================
  // IMPORTANT
  // ==========================================================
  //
  // HTF is scanned FIRST.
  //
  // This ensures the latest HTF state is available when the
  // 5M timeframe is processed later in the same scan.
  //
  // ==========================================================

  for (
    const timeframe of
    SCAN_ORDER
  ) {
    if (
      Date.now() <
      mexcBlockedUntil
    ) {
      console.warn(
        "[CRT] MEXC cooldown activated."
      );

      break;
    }

    console.log(
      `[CRT] Scanning timeframe ${timeframe.toUpperCase()}`
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
  }
}

// ============================================================
// FULL SCAN
// ============================================================

async function runFullScan(
  client
) {
  if (
    scanRunning
  ) {
    console.warn(
      "[CRT] Previous scan is still running. Skipping overlapping scan."
    );

    return;
  }

  scanRunning =
    true;

  const startedAt =
    Date.now();

  console.log(
    "[CRT] Starting MEXC CRT scan..."
  );

  try {
    await scanMexc(
      client
    );
  } catch (
    error
  ) {
    console.error(
      "[CRT] MEXC CRT scan failed:",
      error.message
    );
  } finally {
    const elapsed =
      Date.now() -
      startedAt;

    console.log(
      `[CRT] MEXC CRT scan completed in ${elapsed}ms.`
    );

    scanRunning =
      false;
  }
}

// ============================================================
// INITIALIZE PERSISTENCE
// ============================================================

async function initializeCRTState() {
  try {
    await loadTopDownPersistence();

    console.log(
      "[CRT] PostgreSQL top-down state initialized."
    );
  } catch (
    error
  ) {
    console.error(
      "[CRT] PostgreSQL top-down initialization failed:",
      error.message
    );
  }
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
    "[CRT] HTF: 1D -> 4H -> 1H -> 15M"
  );

  console.log(
    "[CRT] Lower timeframe: 5M"
  );

  console.log(
    "[CRT] 30M: REMOVED"
  );

  console.log(
    "[CRT] PostgreSQL HTF persistence: ENABLED"
  );

  console.log(
    "[CRT] 5M HTF alignment: REQUIRED"
  );

  console.log(
    "[CRT] 5M Market Structure alignment: REQUIRED"
  );

  console.log(
    "[CRT] RSI: DISPLAY ONLY"
  );

  console.log(
    "[CRT] Standard Deviation: DISPLAY ONLY"
  );

  console.log(
    "[CRT] Market Structure: BULLISH / BEARISH"
  );

  console.log(
    `[CRT] Check interval: ${CHECK_INTERVAL}ms`
  );

  console.log(
    `[CRT] Candle limit: ${CANDLE_LIMIT}`
  );

  console.log(
    `[CRT] Concurrency: ${CONCURRENCY}`
  );

  console.log(
    "============================================================"
  );

  // ==========================================================
  // LOAD DATABASE FIRST
  // ==========================================================

  initializeCRTState()
    .then(
      () =>
        runFullScan(
          client
        )
    )
    .catch(
      error => {
        console.error(
          "[CRT] Initial startup scan failed:",
          error.message
        );
      }
    );

  // ==========================================================
  // PERIODIC SCAN
  // ==========================================================

  monitorTimer =
    setInterval(
      () => {
        runFullScan(
          client
        ).catch(
          error => {
            console.error(
              "[CRT] Full scan error:",
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

  console.log(
    "[CRT] Monitor stopped."
  );
}

// ============================================================
// MONITOR STATUS
// ============================================================

export function getCRTMonitorStatus() {
  return {
    started:
      crtMonitorStarted,

    scanRunning,

    checkInterval:
      CHECK_INTERVAL,

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
        ...SCAN_ORDER,
      ],

    topDownTimeframes:
      [
        ...TOP_DOWN_TIMEFRAMES,
      ],

    lowerTimeframe:
      LOWER_TIMEFRAME,

    fiveMinuteAlignment:
      true,

    requiredHTF:
      [
        ...HTF_ALIGNMENT_TIMEFRAMES,
      ],

    rachelTFractal:
      true,

    thirtyMinute:
      false,

    rsi:
      true,

    standardDeviation:
      true,

    marketStructure:
      true,

    persistentHTFState:
      true,

    databasePersistence:
      "topDown.js",

    timezone:
      CRT_TIMEZONE,
  };
}

// ============================================================
// GET CURRENT TOP-DOWN STATE
// ============================================================

export function getCRTTopDownState(
  symbol
) {
  return getStoredTopDownState(
    normalizeSymbol(
      symbol
    )
  );
}

// ============================================================
// GET 5M ALIGNMENT STATE
// ============================================================
//
// Useful for debugging.
//
// ============================================================

export function get5MAlignmentState(
  symbol
) {
  const normalizedSymbol =
    normalizeSymbol(
      symbol
    );

  const topDown =
    getStoredTopDownState(
      normalizedSymbol
    );

  const marketStructures =
    getHTFMarketStructures(
      normalizedSymbol
    );

  return {
    symbol:
      normalizedSymbol,

    topDown,

    marketStructures,

    requiredTimeframes:
      [
        ...HTF_ALIGNMENT_TIMEFRAMES,
      ],
  };
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

    topDownTimeframes:
      [
        ...TOP_DOWN_TIMEFRAMES,
      ],

    lowerTimeframe:
      LOWER_TIMEFRAME,

    fiveMinuteAlignment:
      true,

    requiredFiveMinuteHTF:
      [
        ...HTF_ALIGNMENT_TIMEFRAMES,
      ],

    rachelTFractal:
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

    marketStructureValues:
      [
        "Bullish",
        "Bearish",
      ],

    persistentPreviousCRT:
      true,

    persistentHTFState:
      true,

    databasePersistence:
      "topDown.js",

    topDownCandleSynchronization:
      false,

    closedCandleConfirmation:
      true,

    timezone:
      CRT_TIMEZONE,

    checkInterval:
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
  "[CRT] 1D -> 4H -> 1H -> 15M -> 5M"
);

console.log(
  "[CRT] 30M removed."
);

console.log(
  "[CRT] PostgreSQL top-down persistence enabled."
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
  "[CRT] 5M requires complete HTF CRT alignment."
);

console.log(
  "[CRT] 5M requires market structure alignment."
);

console.log(
  "[CRT] PDYN SIGNAL output enabled."
);
