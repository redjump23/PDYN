// ============================================================
// PDYN CRT SERVICE
// ============================================================
//
// SOURCE:
//   MEXC FUTURES
//
// PRIMARY SIGNAL:
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
// SIGNAL ROUTING:
//
//   1D  -> 1D Discord channel
//   4H  -> 4H Discord channel
//   1H  -> 1H Discord channel
//   15M -> 15M Discord channel
//   5M  -> 5M Discord channel
//
// IMPORTANT:
//
//   • Rachel T Fractal is the ONLY signal confirmation.
//   • RSI is DISPLAY ONLY.
//   • Standard Deviation is DISPLAY ONLY.
//   • Market Structure is DISPLAY ONLY.
//   • RSI does NOT create CRT signals.
//   • Standard Deviation does NOT create CRT signals.
//   • Market Structure does NOT create CRT signals.
//   • 30M is completely removed.
//   • Only CLOSED candles are used for fractal confirmation.
//   • HTF state is stored by topDown.js.
//   • topDown.js persists HTF state to PostgreSQL.
//   • 5M reads the latest stored HTF state.
//   • Duplicate fractal timestamps are blocked.
//   • A newer fractal replaces the previous fractal.
//   • Temporary MEXC/API errors do NOT clear previous state.
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
  getTopDownCRT,
  loadTopDownPersistence,
} from "./topDown.js";

// ============================================================
// CONFIG
// ============================================================

const CRT_CONFIG =
  botConfig?.crt ||
  {};

const CRT_TIMEZONE =
  CRT_CONFIG.timezone ||
  "Asia/Manila";

// ============================================================
// TIMEFRAMES
// ============================================================

const TIMEFRAMES = {
  "1d":
    1440,

  "4h":
    240,

  "1h":
    60,

  "15m":
    15,

  "5m":
    5,
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
// SCAN ORDER
// ============================================================
//
// IMPORTANT:
//
// HTF is scanned first.
//
// This means:
//
//   1D
//   4H
//   1H
//   15M
//   5M
//
// 5M can immediately read any newly updated HTF state.
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
// CHECK INTERVAL
// ============================================================

const CHECK_INTERVAL =
  Number(
    CRT_CONFIG.checkInterval
  ) >= 1000
    ? Number(
        CRT_CONFIG.checkInterval
      )
    : 30000;

// ============================================================
// CANDLE LIMIT
// ============================================================

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

// ============================================================
// CONCURRENCY
// ============================================================

const CONCURRENCY =
  Math.max(
    1,
    Number(
      CRT_CONFIG.concurrency
    ) || 4
  );

// ============================================================
// SIGNAL CLEANUP
// ============================================================

const SIGNAL_CLEANUP_INTERVAL =
  30 *
  60 *
  1000;

// ============================================================
// DISCORD CHANNELS
// ============================================================

const CHANNELS =
  CRT_CONFIG.channels ||
  {};

// ============================================================
// SIGNAL STATE
// ============================================================
//
// key:
//
//   MEXC|BTC_USDT|1h
//
// value:
//
//   latest sent fractal timestamp
//
// ============================================================

const signalState =
  new Map();

// ============================================================
// MONITOR STATE
// ============================================================

let crtMonitorStarted =
  false;

let monitorTimer =
  null;

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
  60 *
  1000;

// ============================================================
// CLEANUP STATE
// ============================================================

let lastSignalCleanup =
  Date.now();

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
// VALIDATE TIMEFRAME
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
// GET AVAILABLE TIMEFRAMES
// ============================================================

export function getAvailableCRTTimeframes() {
  return Object.keys(
    TIMEFRAMES
  );
}

// ============================================================
// ZONED TIME
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

  const result =
    {};

  for (
    const part of
      parts
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
// CURRENT CRT TIME
// ============================================================

export function getCRTNow() {
  return getZonedParts(
    new Date()
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
// ALL CRT STATUSES
// ============================================================

export function getAllCRTStatuses() {
  const result =
    {};

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
// RACHEL T TOP
// ============================================================
//
// Five-candle confirmation:
//
//   c4  c3  c2  c1  c0
//
// c2 = fractal candle
//
// c0 MUST be CLOSED.
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
    c0.closed ===
    false
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
    c0.closed ===
    false
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
  fractalIndex,
  type
) {
  const candle =
    candles[
      fractalIndex
    ];

  if (
    !candle
  ) {
    return null;
  }

  return {
    type:
      type ===
      "TOP"
        ? "SELL"
        : "BUY",

    fractalType:
      type,

    index:
      fractalIndex,

    timestamp:
      Number(
        candle.timestamp
      ),

    price:
      Number(
        candle.close
      ),

    fractalPrice:
      type ===
      "TOP"
        ? Number(
            candle.high
          )
        : Number(
            candle.low
          ),

    volume:
      Number(
        candle.volume ||
          0
      ),

    open:
      Number(
        candle.open
      ),

    high:
      Number(
        candle.high
      ),

    low:
      Number(
        candle.low
      ),

    close:
      Number(
        candle.close
      ),
  };
}

// ============================================================
// FIND LAST CONFIRMED FRACTAL
// ============================================================
//
// Searches backward.
//
// Only CLOSED confirmation candles
// are accepted.
//
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

    if (
      isRachelTop(
        candles,
        index
      )
    ) {
      return buildFractalSignal(
        candles,
        fractalIndex,
        "TOP"
      );
    }

    if (
      isRachelBottom(
        candles,
        index
      )
    ) {
      return buildFractalSignal(
        candles,
        fractalIndex,
        "BOTTOM"
      );
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
    let index =
      4;

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

    if (
      !candle
    ) {
      continue;
    }

    if (
      Number(
        candle.timestamp
      ) <=
      Number(
        previousTimestamp
      )
    ) {
      continue;
    }

    if (
      isRachelTop(
        candles,
        index
      )
    ) {
      newest =
        buildFractalSignal(
          candles,
          fractalIndex,
          "TOP"
        );

      continue;
    }

    if (
      isRachelBottom(
        candles,
        index
      )
    ) {
      newest =
        buildFractalSignal(
          candles,
          fractalIndex,
          "BOTTOM"
        );
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
// RSI
// ============================================================
//
// DISPLAY ONLY.
//
// RSI DOES NOT CREATE SIGNALS.
//
// ============================================================

export function calculateRSI(
  candles,
  period = 14
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
          (
            period -
            1
          ) +
        gain
      ) /
      period;

    averageLoss =
      (
        averageLoss *
          (
            period -
            1
          ) +
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
      (
        1 +
        rs
      )
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

  const period =
    Number(
      CRT_CONFIG.rsi?.period
    ) || 14;

  const overbought =
    Number(
      CRT_CONFIG.rsi?.overbought
    ) || 70;

  const oversold =
    Number(
      CRT_CONFIG.rsi?.oversold
    ) || 30;

  void period;

  if (
    rsi >=
    overbought
  ) {
    return "Overbought";
  }

  if (
    rsi <=
    oversold
  ) {
    return "Oversold";
  }

  return "Neutral";
}

// ============================================================
// STANDARD DEVIATION
// ============================================================
//
// DISPLAY ONLY.
//
// ============================================================

export function calculateStandardDeviation(
  candles,
  period = 20
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

  return {
    value:
      Math.sqrt(
        variance
      ),

    mean,

    state:
      "NORMAL",
  };
}

// ============================================================
// MARKET STRUCTURE
// ============================================================
//
// DISPLAY ONLY.
//
// Uses recent confirmed swing points.
//
// Bullish:
//   Higher High + Higher Low
//
// Bearish:
//   Lower High + Lower Low
//
// Otherwise uses recent close direction.
//
// ============================================================

function findSwingHighs(
  candles
) {
  const swings =
    [];

  for (
    let i = 2;

    i <
      candles.length -
        2;

    i++
  ) {
    const left1 =
      candles[
        i - 1
      ];

    const left2 =
      candles[
        i - 2
      ];

    const current =
      candles[i];

    const right1 =
      candles[
        i + 1
      ];

    const right2 =
      candles[
        i + 2
      ];

    if (
      current.high >
        left1.high &&
      current.high >
        left2.high &&
      current.high >=
        right1.high &&
      current.high >
        right2.high
    ) {
      swings.push(
        current
      );
    }
  }

  return swings;
}

// ============================================================
// SWING LOWS
// ============================================================

function findSwingLows(
  candles
) {
  const swings =
    [];

  for (
    let i = 2;

    i <
      candles.length -
        2;

    i++
  ) {
    const left1 =
      candles[
        i - 1
      ];

    const left2 =
      candles[
        i - 2
      ];

    const current =
      candles[i];

    const right1 =
      candles[
        i + 1
      ];

    const right2 =
      candles[
        i + 2
      ];

    if (
      current.low <
        left1.low &&
      current.low <
        left2.low &&
      current.low <=
        right1.low &&
      current.low <
        right2.low
    ) {
      swings.push(
        current
      );
    }
  }

  return swings;
}

// ============================================================
// MARKET STRUCTURE
// ============================================================

export function getMarketStructure(
  candles
) {
  if (
    !Array.isArray(
      candles
    ) ||
    candles.length <
      10
  ) {
    return "Bullish";
  }

  const highs =
    findSwingHighs(
      candles
    );

  const lows =
    findSwingLows(
      candles
    );

  if (
    highs.length >=
      2 &&
    lows.length >=
      2
  ) {
    const previousHigh =
      highs[
        highs.length -
          2
      ];

    const latestHigh =
      highs[
        highs.length -
          1
      ];

    const previousLow =
      lows[
        lows.length -
          2
      ];

    const latestLow =
      lows[
        lows.length -
          1
      ];

    const higherHigh =
      latestHigh.high >
      previousHigh.high;

    const higherLow =
      latestLow.low >
      previousLow.low;

    const lowerHigh =
      latestHigh.high <
      previousHigh.high;

    const lowerLow =
      latestLow.low <
      previousLow.low;

    if (
      higherHigh &&
      higherLow
    ) {
      return "Bullish";
    }

    if (
      lowerHigh &&
      lowerLow
    ) {
      return "Bearish";
    }
  }

  const recent =
    candles.slice(
      -5
    );

  const first =
    Number(
      recent[0]?.close
    );

  const last =
    Number(
      recent[
        recent.length -
          1
      ]?.close
    );

  if (
    Number.isFinite(
      first
    ) &&
    Number.isFinite(
      last
    )
  ) {
    return last >=
      first
      ? "Bullish"
      : "Bearish";
  }

  return "Bullish";
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
      "[CRT] Failed to load MEXC symbols:",
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
            candle.timestamp
          ) &&
          Number.isFinite(
            candle.open
          ) &&
          Number.isFinite(
            candle.high
          ) &&
          Number.isFinite(
            candle.low
          ) &&
          Number.isFinite(
            candle.close
          )
      )
      .sort(
        (
          a,
          b
        ) =>
          a.timestamp -
          b.timestamp
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
      ).toFixed(
        2
      ) +
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
      ).toFixed(
        2
      ) +
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
      ).toFixed(
        2
      ) +
      "K"
    );
  }

  return Number(
    volume
  ).toFixed(
    2
  );
}

// ============================================================
// FORMAT SIGNAL TIME
// ============================================================

function formatSignalTime(
  timestamp
) {
  if (
    !Number.isFinite(
      timestamp
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
      timestamp
    )
  );
}

// ============================================================
// FORMAT RSI
// ============================================================
//
// Only Overbought and Oversold are bold.
//
// Neutral remains normal.
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
// FORMAT CANDLE
// ============================================================

function formatCandle(
  candle
) {
  if (
    !candle
  ) {
    return "N/A";
  }

  return (
    `O ${formatPrice(
      Number(
        candle.open
      )
    )} • ` +
    `H ${formatPrice(
      Number(
        candle.high
      )
    )} • ` +
    `L ${formatPrice(
      Number(
        candle.low
      )
    )} • ` +
    `C ${formatPrice(
      Number(
        candle.close
      )
    )}`
  );
}

// ============================================================
// CREATE SIGNAL DATA
// ============================================================

function buildDisplayData(
  candles,
  signal
) {
  const rsi =
    calculateRSI(
      candles,
      Number(
        CRT_CONFIG.rsi?.period
      ) || 14
    );

  const rsiState =
    getRSIState(
      rsi
    );

  const standardDeviation =
    calculateStandardDeviation(
      candles,
      20
    );

  const marketStructure =
    getMarketStructure(
      candles
    );

  const fractalCandle =
    candles[
      signal.index
    ];

  return {
    rsi,

    rsiState,

    standardDeviation,

    marketStructure,

    candle:
      fractalCandle,

    volume:
      Number(
        fractalCandle?.volume ||
          signal.volume ||
          0
      ),
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
    display,
    topDown,
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

  const rsiText =
    formatRSIState(
      display.rsiState
    );

  const stdText =
    display.standardDeviation &&
    Number.isFinite(
      display
        .standardDeviation
        .value
    )
      ? formatPrice(
          display
            .standardDeviation
            .value
        )
      : "N/A";

  const fields = [
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
        "SOURCE / TIMEFRAME",

      value:
        `MEXC / ${timeframe.toUpperCase()}`,

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
        rsiText,

      inline:
        true,
    },

    {
      name:
        "VOLUME",

      value:
        formatVolume(
          display.volume
        ),

      inline:
        true,
    },

    {
      name:
        "STD DEV",

      value:
        stdText,

      inline:
        true,
    },

    {
      name:
        "MARKET STRUCTURE",

      value:
        display.marketStructure,

      inline:
        true,
    },

    {
      name:
        "CANDLE",

      value:
        formatCandle(
          display.candle
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
        formatSignalTime(
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
            : (
                "1D N/A • " +
                "4H N/A • " +
                "1H N/A • " +
                "15M N/A"
              ),

        inline:
          false,
      }
    );
  }

  return new EmbedBuilder()
    .setTitle(
      `CRT SIGNAL: ${symbol}`
    )

    .setDescription(
      `Rachel T Fractal Confirmation`
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
        "CRT • PDYN • MEXC",
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
      console.error(
        `[CRT] NO CHANNEL CONFIGURED for ${data.timeframe}`
      );

      return false;
    }

    const channel =
      await client.channels.fetch(
        channelId
      );

    if (
      !channel
    ) {
      console.error(
        `[CRT] Channel not found: ${channelId}`
      );

      return false;
    }

    if (
      typeof channel.send !==
      "function"
    ) {
      console.error(
        `[CRT] Channel cannot send messages: ${channelId}`
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
      `[CRT] SIGNAL SENT | ` +
      `${data.symbol} | ` +
      `${data.timeframe.toUpperCase()} | ` +
      `${data.signal.type} | ` +
      `${data.signal.fractalType} | ` +
      `${data.signal.timestamp}`
    );

    return true;
  } catch (
    error
  ) {
    console.error(
      `[CRT] Discord signal error ` +
      `${data.symbol} ` +
      `${data.timeframe}:`,
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

  const previousTimestamp =
    signalState.get(
      stateKey
    );

  let signal =
    null;

  // ==========================================================
  // FIND SIGNAL
  // ==========================================================

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
  // NO FRACTAL
  // ==========================================================

  if (
    !signal
  ) {
    return;
  }

  // ==========================================================
  // SAFETY
  // ==========================================================

  if (
    !Number.isFinite(
      signal.timestamp
    )
  ) {
    return;
  }

  // ==========================================================
  // PREVENT DUPLICATE
  // ==========================================================

  if (
    Number.isFinite(
      previousTimestamp
    ) &&
    signal.timestamp <=
      previousTimestamp
  ) {
    return;
  }

  // ==========================================================
  // BUILD SIGNAL
  // ==========================================================

  signal.symbol =
    normalizedSymbol;

  signal.timeframe =
    normalizedTimeframe;

  signal.candleTimestamp =
    signal.timestamp;

  signal.candleStart =
    signal.timestamp;

  signal.candleEnd =
    signal.timestamp +
    TIMEFRAMES[
      normalizedTimeframe
    ] *
      60 *
      1000;

  // ==========================================================
  // DISPLAY DATA
  // ==========================================================

  const display =
    buildDisplayData(
      candles,
      signal
    );

  // ==========================================================
  // HTF STATE
  // ==========================================================

  let shouldSend =
    true;

  if (
    isTopDownTimeframe(
      normalizedTimeframe
    )
  ) {
    const existingHTF =
      getTopDownCRT(
        normalizedSymbol,
        normalizedTimeframe
      );

    // --------------------------------------------------------
    // If PostgreSQL already restored the same/latest fractal,
    // this is NOT a new CRT confirmation.
    //
    // Do not resend it after Railway restart.
    // --------------------------------------------------------

    if (
      existingHTF &&
      Number(
        existingHTF.timestamp
      ) >=
        Number(
          signal.timestamp
        )
    ) {
      shouldSend =
        false;
    }

    // --------------------------------------------------------
    // Store/update latest HTF fractal.
    // --------------------------------------------------------

    updateTopDownCRT(
      normalizedSymbol,
      normalizedTimeframe,
      signal
    );
  }

  // ==========================================================
  // 5M TOP-DOWN ANALYSIS
  // ==========================================================

  let topDown =
    null;

  if (
    normalizedTimeframe ===
    LOWER_TIMEFRAME
  ) {
    topDown =
      analyzeTopDown(
        normalizedSymbol,
        signal
      );
  }

  // ==========================================================
  // SEND SIGNAL
  // ==========================================================
//
// IMPORTANT:
//
// For a brand-new fractal:
//   send = true
//
// For an already persisted HTF fractal:
//   send = false
//
// For 5M:
//   in-memory state controls duplicates.
//
// ==========================================================

  if (
    shouldSend
  ) {
    const sent =
      await sendCRTSignal(
        client,
        {
          symbol:
            normalizedSymbol,

          timeframe:
            normalizedTimeframe,

          signal,

          display,

          topDown,
        }
      );

    if (
      sent
    ) {
      signalState.set(
        stateKey,
        signal.timestamp
      );
    }

    return;
  }

  // ==========================================================
  // MARK AS ALREADY PROCESSED
  // ==========================================================

  signalState.set(
    stateKey,
    signal.timestamp
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
// CLEAN OLD STATE
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

  // ----------------------------------------------------------
  // 30M is deliberately removed.
  //
  // If an old 30M key somehow remains in memory,
  // remove it.
  // ----------------------------------------------------------

  for (
    const key of
      signalState.keys()
  ) {
    if (
      key.includes(
        "|30m"
      )
    ) {
      signalState.delete(
        key
      );
    }
  }

  console.log(
    "[CRT] Legacy 30M signal state cleanup completed."
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
  // TIMEFRAME ORDER
  // ==========================================================

  for (
    const timeframe of
      SCAN_ORDER
  ) {
    if (
      Date.now() <
      mexcBlockedUntil
    ) {
      break;
    }

    const jobs =
      symbols.map(
        symbol => ({
          symbol,
          timeframe,
        })
      );

    console.log(
      `[CRT] Scanning ${timeframe.toUpperCase()}`
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
  console.log(
    "============================================================"
  );

  console.log(
    "[CRT] Starting MEXC Futures CRT scan..."
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
  }

  console.log(
    "[CRT] MEXC Futures CRT scan completed."
  );

  console.log(
    "============================================================"
  );
}

// ============================================================
// START MONITOR
// ============================================================

export async function startCRTMonitor(
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
    "[CRT] CRT SIGNAL MONITOR STARTING"
  );

  console.log(
    "[CRT] Provider: MEXC FUTURES"
  );

  console.log(
    "[CRT] Rachel T Fractals: ENABLED"
  );

  console.log(
    "[CRT] 1D: ENABLED"
  );

  console.log(
    "[CRT] 4H: ENABLED"
  );

  console.log(
    "[CRT] 1H: ENABLED"
  );

  console.log(
    "[CRT] 15M: ENABLED"
  );

  console.log(
    "[CRT] 5M: ENABLED"
  );

  console.log(
    "[CRT] 30M: REMOVED"
  );

  console.log(
    "[CRT] RSI: DISPLAY ONLY"
  );

  console.log(
    "[CRT] STANDARD DEVIATION: DISPLAY ONLY"
  );

  console.log(
    "[CRT] MARKET STRUCTURE: DISPLAY ONLY"
  );

  console.log(
    "[CRT] CLOSED CANDLE CONFIRMATION: ENABLED"
  );

  console.log(
    "[CRT] PostgreSQL HTF persistence: ENABLED"
  );

  console.log(
    `[CRT] Check interval: ${CHECK_INTERVAL}ms`
  );

  console.log(
    "============================================================"
  );

  // ==========================================================
  // LOAD PERSISTENT HTF STATE FIRST
  // ==========================================================

  try {
    await loadTopDownPersistence();

    console.log(
      "[CRT] Persistent HTF state loaded."
    );
  } catch (
    error
  ) {
    console.error(
      "[CRT] Failed to load persistent HTF state:",
      error.message
    );
  }

  // ==========================================================
  // FIRST SCAN
  // ==========================================================

  runFullScan(
    client
  ).catch(
    error => {
      console.error(
        "[CRT] Initial scan failed:",
        error.message
      );
    }
  );

  // ==========================================================
  // REPEATING SCAN
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

  console.log(
    "[CRT] CRT SIGNAL MONITOR STARTED."
  );
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

  console.log(
    "[CRT] Monitor stopped."
  );
}

// ============================================================
// TEST MARKET ANALYSIS
// ============================================================
//
// Compatibility function.
//
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

  const fractal =
    findLastFractal(
      candles
    );

  const rsi =
    calculateRSI(
      candles,
      Number(
        CRT_CONFIG.rsi?.period
      ) || 14
    );

  const standardDeviation =
    calculateStandardDeviation(
      candles,
      20
    );

  return {
    fractal,

    rsi,

    rsiState:
      getRSIState(
        rsi
      ),

    standardDeviation,

    marketStructure:
      getMarketStructure(
        candles
      ),
  };
}

// ============================================================
// SERVICE INFO
// ============================================================

export function getCRTServiceInfo() {
  let mexc =
    null;

  try {
    mexc =
      getMexcServiceInfo();
  } catch {
    mexc =
      null;
  }

  return {
    cryptoProvider:
      "MEXC FUTURES",

    forexProvider:
      null,

    oanda:
      false,

    mexcApi:
      mexc?.futuresBaseUrl ||
      null,

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

    rachelTFractal:
      true,

    rsi:
      "DISPLAY ONLY",

    standardDeviation:
      "DISPLAY ONLY",

    marketStructure:
      "DISPLAY ONLY",

    persistentPreviousCRT:
      true,

    persistentHTFState:
      true,

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

    channels:
      {
        ...CHANNELS,
      },
  };
}

// ============================================================
// STARTUP
// ============================================================

console.log(
  "[CRT] Signal service loaded."
);

console.log(
  "[CRT] MEXC Futures enabled."
);

console.log(
  "[CRT] Rachel T Fractals enabled."
);

console.log(
  "[CRT] HTF: 1D -> 4H -> 1H -> 15M"
);

console.log(
  "[CRT] Lower timeframe: 5M"
);

console.log(
  "[CRT] 30M removed."
);

console.log(
  "[CRT] RSI display enabled."
);

console.log(
  "[CRT] Standard Deviation display enabled."
);

console.log(
  "[CRT] Market Structure display enabled."
);

console.log(
  "[CRT] Closed-candle Rachel T confirmation enabled."
);

console.log(
  "[CRT] PostgreSQL HTF persistence enabled through topDown.js."
);

console.log(
  "[CRT] Designated Discord channels enabled."
);
