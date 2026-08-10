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
// IMPORTANT:
//
//   • 30M is completely removed.
//   • Rachel T Fractal is the ONLY signal trigger.
//   • RSI is INFORMATION ONLY.
//   • Standard Deviation is INFORMATION ONLY.
//   • Market Structure is INFORMATION ONLY.
//   • Candle direction is INFORMATION ONLY.
//   • Volume is INFORMATION ONLY.
//   • HTF CRT state is stored by topDown.js.
//   • PostgreSQL persistence is handled by topDown.js.
//   • Previous HTF fractals are never cleared because of
//     a temporary scan/data problem.
//   • 5M reads the latest stored HTF fractals.
//   • HTF is scanned before 5M.
//   • Startup historical fractals are baseline only.
//   • Startup baseline signals are NOT immediately sent.
//   • Newer fractals replace older fractals.
//   • Duplicate signals are blocked.
//   • Only CLOSED candles are used for fractal confirmation.
//
// ============================================================

import { EmbedBuilder } from "discord.js";
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

const TOP_DOWN_TIMEFRAMES =
  getTopDownTimeframes();

const LOWER_TIMEFRAME =
  "5m";

const SCAN_ORDER = [
  "1d",
  "4h",
  "1h",
  "15m",
  "5m",
];

// ============================================================
// INDICATOR SETTINGS
// ============================================================

const RSI_PERIOD =
  Number(
    CRT_CONFIG.rsiPeriod
  ) > 0
    ? Number(
        CRT_CONFIG.rsiPeriod
      )
    : 14;

const RSI_OVERBOUGHT =
  Number(
    CRT_CONFIG.rsiOverbought
  ) > 0
    ? Number(
        CRT_CONFIG.rsiOverbought
      )
    : 70;

const RSI_OVERSOLD =
  Number(
    CRT_CONFIG.rsiOversold
  ) >= 0
    ? Number(
        CRT_CONFIG.rsiOversold
      )
    : 30;

const STD_DEV_PERIOD =
  Number(
    CRT_CONFIG.standardDeviationPeriod
  ) > 0
    ? Number(
        CRT_CONFIG.standardDeviationPeriod
      )
    : 20;

const MARKET_STRUCTURE_LOOKBACK =
  Math.max(
    20,
    Number(
      CRT_CONFIG.marketStructureLookback
    ) || 80
  );

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
// c4 c3 c2 c1 c0
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
    !isClosedCandle(c4) ||
    !isClosedCandle(c3) ||
    !isClosedCandle(c2) ||
    !isClosedCandle(c1) ||
    !isClosedCandle(c0)
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
    !isClosedCandle(c4) ||
    !isClosedCandle(c3) ||
    !isClosedCandle(c2) ||
    !isClosedCandle(c1) ||
    !isClosedCandle(c0)
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
    candles[index];

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
      signal
    ) {
      if (
        !newest ||
        signal.timestamp >
          newest.timestamp
      ) {
        newest =
          signal;
      }
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

  let gains = 0;
  let losses = 0;

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
        sum +
        value,
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
// CANDLE DIRECTION
// ============================================================

function getCandleDirection(
  candle
) {
  if (
    !candle
  ) {
    return "Neutral";
  }

  const open =
    Number(
      candle.open
    );

  const close =
    Number(
      candle.close
    );

  if (
    !Number.isFinite(
      open
    ) ||
    !Number.isFinite(
      close
    )
  ) {
    return "Neutral";
  }

  if (
    close >
    open
  ) {
    return "Bullish";
  }

  if (
    close <
    open
  ) {
    return "Bearish";
  }

  return "Neutral";
}

// ============================================================
// FIND RECENT SWINGS
// ============================================================

function getRecentSwingPoints(
  candles
) {
  const tops = [];
  const bottoms = [];

  if (
    !Array.isArray(
      candles
    )
  ) {
    return {
      tops,
      bottoms,
    };
  }

  const start =
    Math.max(
      4,
      candles.length -
        MARKET_STRUCTURE_LOOKBACK
    );

  for (
    let index =
      start;
    index <
    candles.length;
    index++
  ) {
    if (
      isRachelTop(
        candles,
        index
      )
    ) {
      const fractalIndex =
        index - 2;

      const candle =
        candles[
          fractalIndex
        ];

      const high =
        Number(
          candle?.high
        );

      if (
        Number.isFinite(
          high
        )
      ) {
        tops.push({
          index:
            fractalIndex,

          timestamp:
            Number(
              candle.timestamp ??
              candle.openTime
            ),

          price:
            high,
        });
      }
    }

    if (
      isRachelBottom(
        candles,
        index
      )
    ) {
      const fractalIndex =
        index - 2;

      const candle =
        candles[
          fractalIndex
        ];

      const low =
        Number(
          candle?.low
        );

      if (
        Number.isFinite(
          low
        )
      ) {
        bottoms.push({
          index:
            fractalIndex,

          timestamp:
            Number(
              candle.timestamp ??
              candle.openTime
            ),

          price:
            low,
        });
      }
    }
  }

  return {
    tops,
    bottoms,
  };
}

// ============================================================
// MARKET STRUCTURE
// ============================================================
//
// Bullish:
//
//   Higher High + Higher Low
//
// Bearish:
//
//   Lower High + Lower Low
//
// If there is not enough confirmed swing information,
// direction falls back to the latest closed candle.
//
// ============================================================

export function calculateMarketStructure(
  candles
) {
  if (
    !Array.isArray(
      candles
    ) ||
    candles.length <
      10
  ) {
    return "Neutral";
  }

  const {
    tops,
    bottoms,
  } =
    getRecentSwingPoints(
      candles
    );

  if (
    tops.length >= 2 &&
    bottoms.length >= 2
  ) {
    const previousTop =
      tops[
        tops.length - 2
      ];

    const latestTop =
      tops[
        tops.length - 1
      ];

    const previousBottom =
      bottoms[
        bottoms.length - 2
      ];

    const latestBottom =
      bottoms[
        bottoms.length - 1
      ];

    const higherHigh =
      latestTop.price >
      previousTop.price;

    const higherLow =
      latestBottom.price >
      previousBottom.price;

    const lowerHigh =
      latestTop.price <
      previousTop.price;

    const lowerLow =
      latestBottom.price <
      previousBottom.price;

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

  const latest =
    candles[
      candles.length - 1
    ];

  return getCandleDirection(
    latest
  );
}

// ============================================================
// BUILD INDICATOR SNAPSHOT
// ============================================================

function buildIndicatorSnapshot(
  candles,
  signal
) {
  if (
    !Array.isArray(
      candles
    ) ||
    !candles.length
  ) {
    return {
      rsi:
        null,

      rsiState:
        "Neutral",

      volume:
        0,

      candle:
        "Neutral",

      standardDeviation:
        null,

      marketStructure:
        "Neutral",
    };
  }

  const rsi =
    calculateRSI(
      candles,
      RSI_PERIOD
    );

  const stdDev =
    calculateStandardDeviation(
      candles,
      STD_DEV_PERIOD
    );

  const signalCandle =
    signal &&
    Number.isInteger(
      signal.index
    )
      ? candles[
          signal.index
        ]
      : candles[
          candles.length - 1
        ];

  return {
    rsi,

    rsiState:
      getRSIState(
        rsi
      ),

    volume:
      Number(
        signalCandle?.volume ??
        0
      ),

    candle:
      getCandleDirection(
        signalCandle
      ),

    standardDeviation:
      stdDev,

    marketStructure:
      calculateMarketStructure(
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
      .map(
        candle => ({
          timestamp:
            Number(
              candle.timestamp ??
              candle.openTime
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

          volume:
            Number(
              candle.volume ??
              0
            ),

          closeTime:
            Number(
              candle.closeTime
            ),

          closed:
            candle.closed ===
            true,
        })
      )
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
    ) >=
    1000
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
    ) >=
    1
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
// FORMAT RSI
// ============================================================
//
// Only Overbought and Oversold are bolded.
//
// ============================================================

function formatRSI(
  rsiState
) {
  if (
    rsiState ===
    "Overbought"
  ) {
    return "**Overbought**";
  }

  if (
    rsiState ===
    "Oversold"
  ) {
    return "**Oversold**";
  }

  return "Neutral";
}

// ============================================================
// FORMAT STD DEV
// ============================================================

function formatStandardDeviation(
  standardDeviation
) {
  if (
    !standardDeviation ||
    !Number.isFinite(
      standardDeviation.value
    )
  ) {
    return "N/A";
  }

  return formatPrice(
    standardDeviation.value
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
// CREATE DISCORD EMBED
// ============================================================

function createSignalEmbed(
  data
) {
  const {
    symbol,
    timeframe,
    signal,
    indicators,
    topDown,
  } =
    data;

  const isBuy =
    signal.type ===
    "BUY";

  const color =
    isBuy
      ? (
          CRT_CONFIG
            .colors
            ?.buy ||
          "#57F287"
        )
      : (
          CRT_CONFIG
            .colors
            ?.sell ||
          "#ED4245"
        );

  const rsiText =
    formatRSI(
      indicators?.rsiState
    );

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
        "SOURCE",

      value:
        "MEXC FUTURES",

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
        "FRACTAL",

      value:
        signal.fractalType ||
        "N/A",

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
          indicators?.volume ??
          signal.volume ??
          0
        ),

      inline:
        true,
    },

    {
      name:
        "CANDLE",

      value:
        indicators?.candle ||
        "Neutral",

      inline:
        true,
    },

    {
      name:
        "STD DEV",

      value:
        formatStandardDeviation(
          indicators?.standardDeviation
        ),

      inline:
        true,
    },

    {
      name:
        "MARKET STRUCTURE",

      value:
        indicators?.marketStructure ||
        "Neutral",

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

  // ----------------------------------------------------------
  // TOP-DOWN DETAILS
  // ----------------------------------------------------------

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
      "CRT SIGNAL"
    )

    .setDescription(
      symbol
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
        "CRT • PDYN • MEXC FUTURES",
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

      return;
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

      return;
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
      `[CRT] SIGNAL SENT | ${data.symbol} | ${data.timeframe} | ${data.signal.type} | ${data.signal.fractalType}`
    );
  } catch (
    error
  ) {
    console.error(
      "[CRT] Discord signal error:",
      error.message
    );
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

  // ----------------------------------------------------------
  // FIND NEW FRACTAL
  // ----------------------------------------------------------

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

  // ----------------------------------------------------------
  // NO NEW FRACTAL
  // ----------------------------------------------------------

  if (
    !signal
  ) {
    return;
  }

  const fractalCandle =
    candles[
      signal.index
    ];

  if (
    !fractalCandle
  ) {
    return;
  }

  // ----------------------------------------------------------
  // SIGNAL DATA
  // ----------------------------------------------------------

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
    fractalCandle.timestamp;

  signal.candleStart =
    fractalCandle.timestamp;

  signal.candleEnd =
    fractalCandle.timestamp +
    TIMEFRAMES[
      normalizedTimeframe
    ] *
      60 *
      1000;

  // ----------------------------------------------------------
  // INDICATORS
  // ----------------------------------------------------------
  //
  // These DO NOT filter the Rachel T signal.
  //
  // They are display information only.
  //
  // ----------------------------------------------------------

  const indicators =
    buildIndicatorSnapshot(
      candles,
      signal
    );

  signal.rsi =
    indicators.rsi;

  signal.rsiState =
    indicators.rsiState;

  signal.candle =
    indicators.candle;

  signal.standardDeviation =
    indicators.standardDeviation;

  signal.marketStructure =
    indicators.marketStructure;

  // ----------------------------------------------------------
  // STORE HTF CRT
  // ----------------------------------------------------------

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

  // ----------------------------------------------------------
  // STARTUP BASELINE
  // ----------------------------------------------------------
  //
  // Historical signal is stored.
  //
  // It is NOT sent immediately after Railway restart.
  //
  // ----------------------------------------------------------

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

  // ----------------------------------------------------------
  // DUPLICATE PROTECTION
  // ----------------------------------------------------------

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

  signalState.set(
    stateKey,
    signal.timestamp
  );

  // ----------------------------------------------------------
  // 5M TOP-DOWN
  // ----------------------------------------------------------

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

  // ----------------------------------------------------------
  // SEND
  // ----------------------------------------------------------

  await sendCRTSignal(
    client,
    {
      symbol:
        normalizedSymbol,

      timeframe:
        normalizedTimeframe,

      signal,

      indicators,

      topDown,
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
// This only removes old 30M legacy state.
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

      startupBaseline.delete(
        key
      );
    }
  }

  console.log(
    "[CRT] 30M legacy signal state cleanup completed."
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

  // ----------------------------------------------------------
  // HTF FIRST
  // ----------------------------------------------------------
  //
  // 1D -> 4H -> 1H -> 15M -> 5M
  //
  // This ensures 5M can read newly stored HTF state.
  //
  // ----------------------------------------------------------

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
    "[CRT] CRT SIGNAL MONITOR STARTED"
  );

  console.log(
    "[CRT] Provider: MEXC FUTURES"
  );

  console.log(
    "[CRT] Rachel T Fractals: ENABLED"
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
    "[CRT] RSI: INFORMATION ONLY"
  );

  console.log(
    "[CRT] Standard Deviation: INFORMATION ONLY"
  );

  console.log(
    "[CRT] Market Structure: INFORMATION ONLY"
  );

  console.log(
    "[CRT] Candle Direction: INFORMATION ONLY"
  );

  console.log(
    "[CRT] Volume: INFORMATION ONLY"
  );

  console.log(
    "[CRT] Persistent HTF state: ENABLED"
  );

  console.log(
    `[CRT] RSI period: ${RSI_PERIOD}`
  );

  console.log(
    `[CRT] RSI OB/OS: ${RSI_OVERBOUGHT}/${RSI_OVERSOLD}`
  );

  console.log(
    `[CRT] STD DEV period: ${STD_DEV_PERIOD}`
  );

  console.log(
    `[CRT] Check interval: ${CHECK_INTERVAL}ms`
  );

  console.log(
    "============================================================"
  );

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
// GET MONITOR STATUS
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

    rachelTFractal:
      true,

    thirtyMinute:
      false,

    rsi:
      true,

    rsiPeriod:
      RSI_PERIOD,

    rsiOverbought:
      RSI_OVERBOUGHT,

    rsiOversold:
      RSI_OVERSOLD,

    standardDeviation:
      true,

    standardDeviationPeriod:
      STD_DEV_PERIOD,

    marketStructure:
      true,

    candleDirection:
      true,

    volume:
      true,

    persistentHTFState:
      true,

    databasePersistence:
      "topDown.js",
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
      20
  ) {
    return null;
  }

  const fractal =
    findLastFractal(
      candles
    );

  const indicators =
    buildIndicatorSnapshot(
      candles,
      fractal
    );

  return {
    fractal,

    rsi:
      indicators.rsi,

    rsiState:
      indicators.rsiState,

    volume:
      indicators.volume,

    candle:
      indicators.candle,

    standardDeviation:
      indicators.standardDeviation,

    marketStructure:
      indicators.marketStructure,
  };
}

// ============================================================
// LEGACY RSI EXPORT
// ============================================================
//
// Kept for compatibility with existing commands/imports.
//
// ============================================================

// calculateRSI is already exported above.

// ============================================================
// LEGACY STANDARD DEVIATION EXPORT
// ============================================================
//
// calculateStandardDeviation is already exported above.
//
// ============================================================

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

    rachelTFractal:
      true,

    rsi:
      true,

    rsiPeriod:
      RSI_PERIOD,

    rsiOverbought:
      RSI_OVERBOUGHT,

    rsiOversold:
      RSI_OVERSOLD,

    standardDeviation:
      true,

    standardDeviationPeriod:
      STD_DEV_PERIOD,

    marketStructure:
      true,

    candleDirection:
      true,

    volume:
      true,

    persistentPreviousCRT:
      true,

    persistentHTFState:
      true,

    topDownCandleSynchronization:
      false,

    timezone:
      CRT_TIMEZONE,

    checkInterval:
      CHECK_INTERVAL,

    candleLimit:
      CANDLE_LIMIT,

    concurrency:
      CONCURRENCY,
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
  "[CRT] RSI information enabled."
);

console.log(
  "[CRT] Standard Deviation information enabled."
);

console.log(
  "[CRT] Market Structure information enabled."
);

console.log(
  "[CRT] Candle direction information enabled."
);

console.log(
  "[CRT] Volume information enabled."
);

console.log(
  "[CRT] Persistent previous HTF CRT enabled."
);

console.log(
  "[CRT] PostgreSQL persistence delegated to topDown.js."
);
