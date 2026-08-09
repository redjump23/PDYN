import { EmbedBuilder } from "discord.js";
import botConfig from "../../config/bot.js";


// ============================================================
// PDYN-BOT — CRT SIGNAL SERVICE
// ============================================================
//
// MEXC CRT SIGNAL SCANNER
//
// Supported timeframes:
//
// 5m
// 15m
// 30m
// 1h
// 4h
// 1d
//
// Markets:
//
// MEXC SPOT
// MEXC FUTURES
//
// CRT:
//
// C1 = Parent / Range Candle
// C2 = Sweep / Confirmation Candle
//
// Bullish CRT:
//
// C2 LOW < C1 LOW
// C2 CLOSE returns inside C1 range
//
// Bearish CRT:
//
// C2 HIGH > C1 HIGH
// C2 CLOSE returns inside C1 range
//
// RSI:
//
// RSI >= 70 = OVERBOUGHT
// RSI <= 30 = OVERSOLD
// Otherwise = NEUTRAL
//
// IMPORTANT:
//
// The signal is based ONLY on CLOSED candles.
//
// The currently forming candle is NEVER used as the CRT
// confirmation candle.
//
// ============================================================


// ============================================================
// CONFIGURATION
// ============================================================

const CRT_CONFIG =
  botConfig.crt || {};

const CRT_TIMEZONE =
  CRT_CONFIG.timezone ||
  "Asia/Manila";

const DEFAULT_TIMEFRAME =
  CRT_CONFIG.timeframe ||
  "15m";

const TIMEFRAMES =
  CRT_CONFIG.timeframes || {
    "5m": 5,
    "15m": 15,
    "30m": 30,
    "1h": 60,
    "4h": 240,
    "1d": 1440,
  };

const CHANNELS =
  CRT_CONFIG.channels || {};


// ============================================================
// MONITOR INTERVAL
// ============================================================

const CHECK_INTERVAL =
  Math.max(
    5000,
    Number(
      CRT_CONFIG.checkInterval ||
      process.env.CRT_CHECK_INTERVAL ||
      30000
    )
  );


// ============================================================
// RSI SETTINGS
// ============================================================

const RSI_PERIOD =
  Math.max(
    2,
    Number(
      process.env.CRT_RSI_PERIOD ||
      14
    )
  );

const RSI_OVERSOLD =
  Number(
    process.env.CRT_RSI_OVERSOLD ||
    30
  );

const RSI_OVERBOUGHT =
  Number(
    process.env.CRT_RSI_OVERBOUGHT ||
    70
  );


// ============================================================
// MEXC MARKETS
// ============================================================
//
// Default:
//
// spot,futures
//
// ============================================================

const MARKETS =
  String(
    process.env.CRT_MARKETS ||
    "spot,futures"
  )
    .split(",")
    .map(
      (value) =>
        value
          .trim()
          .toLowerCase()
    )
    .filter(
      Boolean
    );


// ============================================================
// SYMBOL CONFIGURATION
// ============================================================
//
// You can control symbols from Railway Variables.
//
// Example:
//
// CRT_SPOT_SYMBOLS=BTCUSDT,ETHUSDT,SOLUSDT
//
// CRT_FUTURES_SYMBOLS=BTC_USDT,ETH_USDT,SOL_USDT
//
// ============================================================

const DEFAULT_SPOT_SYMBOLS = [
  "BTCUSDT",
  "ETHUSDT",
  "SOLUSDT",
];

const DEFAULT_FUTURES_SYMBOLS = [
  "BTC_USDT",
  "ETH_USDT",
  "SOL_USDT",
];


// ============================================================
// STATE FILE
// ============================================================
//
// This prevents the same candle from being processed repeatedly
// during normal Railway/container restarts where the filesystem
// is retained.
//
// For guaranteed persistence across container recreation,
// use a Railway Volume or move this state to PostgreSQL.
//
// ============================================================

import fs from "node:fs";
import path from "node:path";

const STATE_DIRECTORY =
  process.env.CRT_STATE_DIRECTORY ||
  path.join(
    process.cwd(),
    "data"
  );

const STATE_FILE =
  process.env.CRT_STATE_FILE ||
  path.join(
    STATE_DIRECTORY,
    "crt-signal-state.json"
  );


// ============================================================
// STATE
// ============================================================

let signalState = {};


// ============================================================
// MONITOR STATUS
// ============================================================

let crtMonitorStarted =
  false;

let scanInProgress =
  false;


// ============================================================
// TIMEZONE
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
// CURRENT CRT TIME
// ============================================================

export function getCRTNow() {

  return getZonedParts(
    new Date()
  );
}


// ============================================================
// TIMEFRAME VALIDATION
// ============================================================

export function isValidCRTTimeframe(
  timeframe
) {

  if (
    !timeframe
  ) {
    return false;
  }

  return Object.prototype.hasOwnProperty.call(
    TIMEFRAMES,
    String(
      timeframe
    ).toLowerCase()
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
  )
    .padStart(
      2,
      "0"
    );
}


// ============================================================
// FORMAT DATE
// ============================================================

function formatDateParts(
  parts
) {

  return (
    `${parts.year}-` +
    `${pad(parts.month)}-` +
    `${pad(parts.day)}`
  );
}


// ============================================================
// FORMAT TIME
// ============================================================

function formatTimeParts(
  hour,
  minute
) {

  return (
    `${pad(hour)}:` +
    `${pad(minute)}`
  );
}


// ============================================================
// FORMAT SECONDS
// ============================================================

function formatTimeSeconds(
  hour,
  minute,
  second
) {

  return (
    `${pad(hour)}:` +
    `${pad(minute)}:` +
    `${pad(second)}`
  );
}


// ============================================================
// NEXT DAY
// ============================================================

function getNextDay(
  year,
  month,
  day
) {

  const date =
    new Date(
      Date.UTC(
        year,
        month - 1,
        day
      )
    );

  date.setUTCDate(
    date.getUTCDate() + 1
  );

  return {

    year:
      date.getUTCFullYear(),

    month:
      date.getUTCMonth() + 1,

    day:
      date.getUTCDate(),
  };
}


// ============================================================
// MANILA COMPONENTS → UTC
// ============================================================

function manilaComponentsToTimestamp(
  year,
  month,
  day,
  hour = 0,
  minute = 0,
  second = 0
) {

  return Date.UTC(
    year,
    month - 1,
    day,
    hour - 8,
    minute,
    second
  );
}


// ============================================================
// CURRENT CRT CANDLE
// ============================================================

export function getCurrentCRT(
  timeframe =
    DEFAULT_TIMEFRAME
) {

  timeframe =
    String(
      timeframe
    ).toLowerCase();

  if (
    !isValidCRTTimeframe(
      timeframe
    )
  ) {

    throw new Error(
      `Invalid CRT timeframe "${timeframe}". ` +
      `Available: ${
        getAvailableCRTTimeframes()
          .join(", ")
      }`
    );
  }

  const minutes =
    Number(
      TIMEFRAMES[
        timeframe
      ]
    );

  const now =
    getCRTNow();


  // ==========================================================
  // DAILY
  // ==========================================================

  if (
    timeframe ===
    "1d"
  ) {

    const nextDay =
      getNextDay(
        now.year,
        now.month,
        now.day
      );

    const startTimestamp =
      manilaComponentsToTimestamp(
        now.year,
        now.month,
        now.day,
        0,
        0,
        0
      );

    const endTimestamp =
      manilaComponentsToTimestamp(
        nextDay.year,
        nextDay.month,
        nextDay.day,
        0,
        0,
        0
      );

    return {

      timeframe:
        "1d",

      label:
        "DAILY",

      date:
        formatDateParts(
          now
        ),

      startHour:
        0,

      startMinute:
        0,

      endHour:
        0,

      endMinute:
        0,

      startTime:
        "00:00",

      endTime:
        "00:00",

      startTimestamp,

      endTimestamp,

      timezone:
        CRT_TIMEZONE,
    };
  }


  // ==========================================================
  // INTRADAY
  // ==========================================================

  const totalMinutes =
    now.hour * 60 +
    now.minute;

  const candleStartMinutes =
    Math.floor(
      totalMinutes /
      minutes
    ) * minutes;

  const startHour =
    Math.floor(
      candleStartMinutes /
      60
    );

  const startMinute =
    candleStartMinutes %
    60;

  const endTotalMinutes =
    candleStartMinutes +
    minutes;

  const endHour =
    Math.floor(
      endTotalMinutes /
      60
    ) % 24;

  const endMinute =
    endTotalMinutes %
    60;

  let endYear =
    now.year;

  let endMonth =
    now.month;

  let endDay =
    now.day;


  // ==========================================================
  // CANDLE CROSSES MIDNIGHT
  // ==========================================================

  if (
    endTotalMinutes >=
    1440
  ) {

    const nextDay =
      getNextDay(
        now.year,
        now.month,
        now.day
      );

    endYear =
      nextDay.year;

    endMonth =
      nextDay.month;

    endDay =
      nextDay.day;
  }


  // ==========================================================
  // TIMESTAMPS
  // ==========================================================

  const startTimestamp =
    manilaComponentsToTimestamp(
      now.year,
      now.month,
      now.day,
      startHour,
      startMinute,
      0
    );

  const endTimestamp =
    manilaComponentsToTimestamp(
      endYear,
      endMonth,
      endDay,
      endHour,
      endMinute,
      0
    );


  return {

    timeframe,

    label:
      timeframe.toUpperCase(),

    date:
      formatDateParts(
        now
      ),

    startHour,

    startMinute,

    endHour,

    endMinute,

    startTime:
      formatTimeParts(
        startHour,
        startMinute
      ),

    endTime:
      formatTimeParts(
        endHour,
        endMinute
      ),

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
  timeframe =
    DEFAULT_TIMEFRAME
) {

  const crt =
    getCurrentCRT(
      timeframe
    );

  let remaining =
    crt.endTimestamp -
    Date.now();

  if (
    remaining < 0
  ) {
    remaining = 0;
  }

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
      ) / 60
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
  timeframe =
    DEFAULT_TIMEFRAME
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
      formatTimeSeconds(
        now.hour,
        now.minute,
        now.second
      ),

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
// TIMEFRAME LABEL
// ============================================================

function getTimeframeLabel(
  timeframe
) {

  const labels = {

    "5m":
      "5 MINUTES",

    "15m":
      "15 MINUTES",

    "30m":
      "30 MINUTES",

    "1h":
      "1 HOUR",

    "4h":
      "4 HOURS",

    "1d":
      "DAILY",
  };

  return (
    labels[
      timeframe
    ] ||
    String(
      timeframe
    ).toUpperCase()
  );
}


// ============================================================
// MEXC TIMEFRAME
// ============================================================

function getMEXCInterval(
  timeframe
) {

  const map = {

    "5m":
      "Min5",

    "15m":
      "Min15",

    "30m":
      "Min30",

    "1h":
      "Min60",

    "4h":
      "Hour4",

    "1d":
      "Day1",
  };

  return (
    map[
      timeframe
    ] ||
    "Min15"
  );
}


// ============================================================
// SPOT MEXC INTERVAL
// ============================================================

function getMEXCSpotInterval(
  timeframe
) {

  const map = {

    "5m":
      "5m",

    "15m":
      "15m",

    "30m":
      "30m",

    "1h":
      "60m",

    "4h":
      "4h",

    "1d":
      "1d",
  };

  return (
    map[
      timeframe
    ] ||
    "15m"
  );
}


// ============================================================
// GET SYMBOLS FROM ENVIRONMENT
// ============================================================

function getSymbols(
  market
) {

  if (
    market ===
    "futures"
  ) {

    const configured =
      process.env.CRT_FUTURES_SYMBOLS;

    if (
      configured
    ) {

      return configured
        .split(",")
        .map(
          (value) =>
            value
              .trim()
              .toUpperCase()
        )
        .filter(
          Boolean
        );
    }

    return [
      ...DEFAULT_FUTURES_SYMBOLS,
    ];
  }


  const configured =
    process.env.CRT_SPOT_SYMBOLS;

  if (
    configured
  ) {

    return configured
      .split(",")
      .map(
        (value) =>
          value
            .trim()
            .toUpperCase()
      )
      .filter(
        Boolean
      );
  }

  return [
    ...DEFAULT_SPOT_SYMBOLS,
  ];
}


// ============================================================
// FETCH JSON
// ============================================================

async function fetchJSON(
  url
) {

  const response =
    await fetch(
      url,
      {
        method:
          "GET",

        headers: {
          "Accept":
            "application/json",
        },

        signal:
          AbortSignal.timeout(
            15000
          ),
      }
    );

  if (
    !response.ok
  ) {

    throw new Error(
      `HTTP ${response.status} from MEXC`
    );
  }

  const data =
    await response.json();

  return data;
}


// ============================================================
// GET SPOT KLINES
// ============================================================
//
// MEXC Spot:
//
// GET /api/v3/klines
//
// ============================================================

async function getSpotKlines(
  symbol,
  timeframe,
  limit = 100
) {

  const interval =
    getMEXCSpotInterval(
      timeframe
    );

  const url =
    new URL(
      "https://api.mexc.com/api/v3/klines"
    );

  url.searchParams.set(
    "symbol",
    symbol
  );

  url.searchParams.set(
    "interval",
    interval
  );

  url.searchParams.set(
    "limit",
    String(
      Math.min(
        1000,
        Math.max(
          20,
          limit
        )
      )
    )
  );

  const data =
    await fetchJSON(
      url
    );

  if (
    !Array.isArray(
      data
    )
  ) {

    throw new Error(
      `Invalid spot kline response for ${symbol}`
    );
  }

  const now =
    Date.now();

  return data
    .map(
      (row) => {

        const openTime =
          Number(
            row[0]
          );

        const open =
          Number(
            row[1]
          );

        const high =
          Number(
            row[2]
          );

        const low =
          Number(
            row[3]
          );

        const close =
          Number(
            row[4]
          );

        const volume =
          Number(
            row[5]
          );

        const closeTime =
          Number(
            row[6]
          );

        return {

          openTime,

          closeTime,

          open,

          high,

          low,

          close,

          volume,

          closed:
            Number.isFinite(
              closeTime
            ) &&
            closeTime <=
              now,
        };
      }
    )
    .filter(
      (candle) =>
        Number.isFinite(
          candle.openTime
        ) &&
        Number.isFinite(
          candle.closeTime
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
        a.openTime -
        b.openTime
    );
}


// ============================================================
// GET FUTURES KLINES
// ============================================================
//
// MEXC Futures:
//
// GET /api/v1/contract/kline/{symbol}
//
// ============================================================

async function getFuturesKlines(
  symbol,
  timeframe
) {

  const interval =
    getMEXCInterval(
      timeframe
    );

  const url =
    new URL(
      `https://contract.mexc.com/api/v1/contract/kline/${encodeURIComponent(
        symbol
      )}`
    );

  url.searchParams.set(
    "interval",
    interval
  );

  const data =
    await fetchJSON(
      url
    );

  if (
    !data ||
    data.success !== true ||
    !data.data
  ) {

    throw new Error(
      `Invalid futures kline response for ${symbol}`
    );
  }

  const source =
    data.data;

  const times =
    Array.isArray(
      source.time
    )
      ? source.time
      : [];

  const opens =
    Array.isArray(
      source.open
    )
      ? source.open
      : [];

  const highs =
    Array.isArray(
      source.high
    )
      ? source.high
      : [];

  const lows =
    Array.isArray(
      source.low
    )
      ? source.low
      : [];

  const closes =
    Array.isArray(
      source.close
    )
      ? source.close
      : [];

  const volumes =
    Array.isArray(
      source.vol
    )
      ? source.vol
      : [];

  const timeframeMinutes =
    Number(
      TIMEFRAMES[
        timeframe
      ]
    );

  const duration =
    timeframeMinutes *
    60 *
    1000;

  const now =
    Date.now();

  const candles = [];

  const count =
    Math.min(
      times.length,
      opens.length,
      highs.length,
      lows.length,
      closes.length
    );

  for (
    let index = 0;
    index < count;
    index++
  ) {

    const openTime =
      Number(
        times[index]
      ) * 1000;

    const open =
      Number(
        opens[index]
      );

    const high =
      Number(
        highs[index]
      );

    const low =
      Number(
        lows[index]
      );

    const close =
      Number(
        closes[index]
      );

    const volume =
      Number(
        volumes[index] ??
        0
      );

    const closeTime =
      openTime +
      duration -
      1;

    candles.push({

      openTime,

      closeTime,

      open,

      high,

      low,

      close,

      volume,

      closed:
        closeTime <=
        now,
    });
  }

  return candles
    .filter(
      (candle) =>
        Number.isFinite(
          candle.openTime
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
        a.openTime -
        b.openTime
    );
}


// ============================================================
// GET KLINES
// ============================================================

async function getKlines(
  market,
  symbol,
  timeframe
) {

  if (
    market ===
    "futures"
  ) {

    return getFuturesKlines(
      symbol,
      timeframe
    );
  }

  return getSpotKlines(
    symbol,
    timeframe
  );
}


// ============================================================
// CLEAN DISPLAY VALUE
// ============================================================
//
// Removes ANSI terminal color codes that may accidentally
// appear in Discord messages.
//
// ============================================================

function cleanDisplayValue(
  value
) {

  if (
    value ===
      null ||
    value ===
      undefined
  ) {

    return "N/A";
  }

  return String(
    value
  )

    .replace(
      /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g,
      ""
    )

    .replace(
      /\u001b(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g,
      ""
    )

    .replace(
      /\[0;3[0-9]m/g,
      ""
    )

    .replace(
      /\[1;3[0-9]m/g,
      ""
    )

    .replace(
      /\[0m/g,
      ""
    )

    .trim();
}


// ============================================================
// FORMAT PRICE
// ============================================================

function formatPrice(
  value
) {

  const number =
    Number(
      cleanDisplayValue(
        value
      )
    );

  if (
    !Number.isFinite(
      number
    )
  ) {

    return "N/A";
  }

  if (
    number ===
    0
  ) {

    return "0";
  }

  if (
    Math.abs(
      number
    ) >=
    1000
  ) {

    return number.toLocaleString(
      "en-US",
      {
        maximumFractionDigits:
          2,
      }
    );
  }

  if (
    Math.abs(
      number
    ) >=
    1
  ) {

    return number.toFixed(
      5
    );
  }

  if (
    Math.abs(
      number
    ) >=
    0.01
  ) {

    return number.toFixed(
      6
    );
  }

  if (
    Math.abs(
      number
    ) >=
    0.0001
  ) {

    return number.toFixed(
      8
    );
  }

  return number.toPrecision(
    8
  );
}


// ============================================================
// FORMAT RSI
// ============================================================

function formatRSI(
  value
) {

  const rsi =
    Number(
      cleanDisplayValue(
        value
      )
    );

  if (
    !Number.isFinite(
      rsi
    )
  ) {

    return "N/A";
  }

  return rsi.toFixed(
    2
  );
}


// ============================================================
// CALCULATE RSI
// ============================================================
//
// Wilder RSI
//
// ============================================================

function calculateRSI(
  closes,
  period =
    RSI_PERIOD
) {

  if (
    !Array.isArray(
      closes
    )
  ) {

    return null;
  }

  if (
    closes.length <
    period + 1
  ) {

    return null;
  }

  const values =
    closes.map(
      Number
    );

  let gainSum =
    0;

  let lossSum =
    0;

  for (
    let index = 1;
    index <= period;
    index++
  ) {

    const change =
      values[index] -
      values[index - 1];

    if (
      change >=
      0
    ) {

      gainSum +=
        change;

    } else {

      lossSum +=
        Math.abs(
          change
        );
    }
  }

  let averageGain =
    gainSum /
    period;

  let averageLoss =
    lossSum /
    period;

  for (
    let index =
      period + 1;

    index <
      values.length;

    index++
  ) {

    const change =
      values[index] -
      values[index - 1];

    const gain =
      change >
      0
        ? change
        : 0;

    const loss =
      change <
      0
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

    if (
      averageGain ===
      0
    ) {

      return 50;
    }

    return 100;
  }

  const relativeStrength =
    averageGain /
    averageLoss;

  return (
    100 -
    100 /
      (
        1 +
        relativeStrength
      )
  );
}


// ============================================================
// RSI HEATMAP STATE
// ============================================================

function getRSIHeatmapState(
  value
) {

  const rsi =
    Number(
      cleanDisplayValue(
        value
      )
    );

  if (
    !Number.isFinite(
      rsi
    )
  ) {

    return "NEUTRAL";
  }

  if (
    rsi >=
    RSI_OVERBOUGHT
  ) {

    return "OVERBOUGHT";
  }

  if (
    rsi <=
    RSI_OVERSOLD
  ) {

    return "OVERSOLD";
  }

  return "NEUTRAL";
}


// ============================================================
// CRT DETECTION
// ============================================================
//
// C1 = Parent candle
// C2 = Sweep / confirmation candle
//
// BULLISH:
//
// C2 LOW breaks C1 LOW
// AND C2 CLOSE returns inside C1 range
//
// BEARISH:
//
// C2 HIGH breaks C1 HIGH
// AND C2 CLOSE returns inside C1 range
//
// ============================================================

function detectCRT(
  c1,
  c2
) {

  if (
    !c1 ||
    !c2
  ) {

    return null;
  }

  const c1High =
    Number(
      c1.high
    );

  const c1Low =
    Number(
      c1.low
    );

  const c2High =
    Number(
      c2.high
    );

  const c2Low =
    Number(
      c2.low
    );

  const c2Close =
    Number(
      c2.close
    );

  if (
    ![
      c1High,
      c1Low,
      c2High,
      c2Low,
      c2Close,
    ].every(
      Number.isFinite
    )
  ) {

    return null;
  }


  // ==========================================================
  // BULLISH LOW SWEEP
  // ==========================================================

  const bullishSweep =
    c2Low <
      c1Low &&
    c2Close >=
      c1Low &&
    c2Close <=
      c1High;


  // ==========================================================
  // BEARISH HIGH SWEEP
  // ==========================================================

  const bearishSweep =
    c2High >
      c1High &&
    c2Close <=
      c1High &&
    c2Close >=
      c1Low;


  if (
    bullishSweep
  ) {

    return {

      direction:
        "BUY",

      label:
        "BULLISH",

      sweep:
        "Low Sweep",

      c1High,

      c1Low,

      c2High,

      c2Low,

      c2Close,

      candleTime:
        Number(
          c2.openTime
        ),
    };
  }


  if (
    bearishSweep
  ) {

    return {

      direction:
        "SELL",

      label:
        "BEARISH",

      sweep:
        "High Sweep",

      c1High,

      c1Low,

      c2High,

      c2Low,

      c2Close,

      candleTime:
        Number(
          c2.openTime
        ),
    };
  }


  return null;
}


// ============================================================
// BUILD SIGNAL
// ============================================================

function buildSignal(
  market,
  symbol,
  timeframe,
  candles
) {

  const closedCandles =
    candles.filter(
      (candle) =>
        candle.closed ===
        true
    );

  if (
    closedCandles.length <
    RSI_PERIOD + 3
  ) {

    return null;
  }


  // ==========================================================
  // C2 = MOST RECENT CLOSED CANDLE
  // ==========================================================

  const c2 =
    closedCandles[
      closedCandles.length -
      1
    ];


  // ==========================================================
  // C1 = CANDLE BEFORE C2
  // ==========================================================

  const c1 =
    closedCandles[
      closedCandles.length -
      2
    ];


  // ==========================================================
  // CRT
  // ==========================================================

  const crt =
    detectCRT(
      c1,
      c2
    );

  if (
    !crt
  ) {

    return null;
  }


  // ==========================================================
  // RSI DATA
  // ==========================================================

  const closes =
    closedCandles.map(
      (candle) =>
        Number(
          candle.close
        )
    );

  const rsi =
    calculateRSI(
      closes,
      RSI_PERIOD
    );

  if (
    !Number.isFinite(
      rsi
    )
  ) {

    return null;
  }


  // ==========================================================
  // RSI STATE
  // ==========================================================

  const rsiState =
    getRSIHeatmapState(
      rsi
    );


  // ==========================================================
  // SIGNAL ID
  // ==========================================================

  const signalId =
    [
      market,
      symbol,
      timeframe,
      crt.candleTime,
      crt.direction,
    ].join(
      ":"
    );


  // ==========================================================
  // RETURN SIGNAL
  // ==========================================================

  return {

    id:
      signalId,

    market,

    symbol,

    timeframe,

    direction:
      crt.direction,

    directionLabel:
      crt.label,

    sweep:
      crt.sweep,

    rsi,

    rsiState,

    c1High:
      crt.c1High,

    c1Low:
      crt.c1Low,

    c2High:
      crt.c2High,

    c2Low:
      crt.c2Low,

    c2Close:
      crt.c2Close,

    price:
      crt.c2Close,

    candleTime:
      crt.candleTime,
  };
}


// ============================================================
// ENSURE STATE DIRECTORY
// ============================================================

function ensureStateDirectory() {

  try {

    if (
      !fs.existsSync(
        STATE_DIRECTORY
      )
    ) {

      fs.mkdirSync(
        STATE_DIRECTORY,
        {
          recursive:
            true,
        }
      );
    }

  } catch (
    error
  ) {

    console.error(
      "[CRT] State directory error:",
      error.message
    );
  }
}


// ============================================================
// LOAD STATE
// ============================================================

function loadState() {

  ensureStateDirectory();

  try {

    if (
      !fs.existsSync(
        STATE_FILE
      )
    ) {

      signalState =
        {};

      return;
    }

    const raw =
      fs.readFileSync(
        STATE_FILE,
        "utf8"
      );

    if (
      !raw.trim()
    ) {

      signalState =
        {};

      return;
    }

    const parsed =
      JSON.parse(
        raw
      );

    if (
      !parsed ||
      typeof parsed !==
        "object" ||
      Array.isArray(
        parsed
      )
    ) {

      signalState =
        {};

      return;
    }

    signalState =
      parsed;

    console.log(
      `[CRT] Loaded ${Object.keys(signalState).length} saved signal states.`
    );

  } catch (
    error
  ) {

    console.error(
      "[CRT] Failed to load signal state:",
      error.message
    );

    signalState =
      {};
  }
}


// ============================================================
// SAVE STATE
// ============================================================

function saveState() {

  ensureStateDirectory();

  const tempFile =
    `${STATE_FILE}.tmp`;

  try {

    fs.writeFileSync(
      tempFile,
      JSON.stringify(
        signalState,
        null,
        2
      ),
      "utf8"
    );

    fs.renameSync(
      tempFile,
      STATE_FILE
    );

  } catch (
    error
  ) {

    console.error(
      "[CRT] Failed to save signal state:",
      error.message
    );

    try {

      if (
        fs.existsSync(
          tempFile
        )
      ) {

        fs.unlinkSync(
          tempFile
        );
      }

    } catch {
      // Ignore cleanup errors.
    }
  }
}


// ============================================================
// STATE KEY
// ============================================================

function getStateKey(
  market,
  symbol,
  timeframe
) {

  return (
    `${market}:` +
    `${symbol}:` +
    `${timeframe}`
  );
}


// ============================================================
// GET STATE
// ============================================================

function getState(
  market,
  symbol,
  timeframe
) {

  const key =
    getStateKey(
      market,
      symbol,
      timeframe
    );

  return (
    signalState[
      key
    ] || {
      initialized:
        false,

      lastClosedCandle:
        0,

      lastSignalId:
        null,

      lastSignalCandle:
        0,

      lastSignalDirection:
        null,

      updatedAt:
        0,
    }
  );
}


// ============================================================
// UPDATE STATE
// ============================================================

function updateState(
  market,
  symbol,
  timeframe,
  values
) {

  const key =
    getStateKey(
      market,
      symbol,
      timeframe
    );

  signalState[
    key
  ] = {

    ...getState(
      market,
      symbol,
      timeframe
    ),

    ...values,

    updatedAt:
      Date.now(),
  };

  saveState();
}


// ============================================================
// SIGNAL COLOR
// ============================================================

function getSignalColor(
  direction
) {

  if (
    direction ===
    "BUY"
  ) {

    return "#57F287";
  }

  if (
    direction ===
    "SELL"
  ) {

    return "#ED4245";
  }

  return "#5865F2";
}


// ============================================================
// SIGNAL EMOJI
// ============================================================

function getSignalEmoji(
  direction
) {

  if (
    direction ===
    "BUY"
  ) {

    return "🟢";
  }

  if (
    direction ===
    "SELL"
  ) {

    return "🔴";
  }

  return "⚪";
}


// ============================================================
// SIGNAL EMBED
// ============================================================
//
// FINAL RECOMMENDED FORMAT
//
// 🟢 CRT SIGNAL — BANUSDT · 4H
//
// Direction      RSI(14)       RSI State
// BULLISH        27.26         OVERSOLD
//
// C1 High        C1 Low
// 0.07299        0.07253
//
// C2 High        C2 Low
// 0.07385        0.07253
//
// C2 Close
// 0.07320
//
// C2 Date
// 2026-07-01 00:11 UTC
//
// ============================================================

function createSignalEmbed(
  signal
) {

  const symbol =
    cleanDisplayValue(
      signal.symbol
    );

  const timeframe =
    getTimeframeLabel(
      signal.timeframe
    );

  const emoji =
    getSignalEmoji(
      signal.direction
    );

  const color =
    getSignalColor(
      signal.direction
    );

  const direction =
    signal.directionLabel ||
    (
      signal.direction ===
      "BUY"
        ? "BULLISH"
        : "BEARISH"
    );

  const sweep =
    signal.sweep ||
    (
      signal.direction ===
      "BUY"
        ? "Low Sweep"
        : "High Sweep"
    );

  const rsi =
    formatRSI(
      signal.rsi
    );

  const rsiState =
    cleanDisplayValue(
      signal.rsiState
    );

  const candleTime =
    Number(
      signal.candleTime
    );

  const candleDate =
    Number.isFinite(
      candleTime
    )
      ? new Date(
          candleTime
        )
      : new Date();


  return new EmbedBuilder()

    .setTitle(
      `${emoji} CRT SIGNAL — ${symbol} · ${timeframe}`
    )

    .addFields(

      // ======================================================
      // DIRECTION
      // ======================================================

      {
        name:
          "Direction",

        value:
          `**${direction} — ${sweep}**`,

        inline:
          true,
      },

      // ======================================================
      // RSI
      // ======================================================

      {
        name:
          "RSI(14)",

        value:
          `**${rsi}**`,

        inline:
          true,
      },

      // ======================================================
      // RSI STATE
      // ======================================================

      {
        name:
          "RSI State",

        value:
          `**${rsiState}**`,

        inline:
          true,
      },

      // ======================================================
      // C1 HIGH
      // ======================================================

      {
        name:
          "C1 High",

        value:
          `\`${formatPrice(
            signal.c1High
          )}\``,

        inline:
          true,
      },

      // ======================================================
      // C1 LOW
      // ======================================================

      {
        name:
          "C1 Low",

        value:
          `\`${formatPrice(
            signal.c1Low
          )}\``,

        inline:
          true,
      },

      // ======================================================
      // C2 HIGH
      // ======================================================

      {
        name:
          "C2 High",

        value:
          `\`${formatPrice(
            signal.c2High
          )}\``,

        inline:
          true,
      },

      // ======================================================
      // C2 LOW
      // ======================================================

      {
        name:
          "C2 Low",

        value:
          `\`${formatPrice(
            signal.c2Low
          )}\``,

        inline:
          true,
      },

      // ======================================================
      // C2 CLOSE
      // ======================================================

      {
        name:
          "C2 Close",

        value:
          `\`${formatPrice(
            signal.c2Close
          )}\``,

        inline:
          true,
      },

      // ======================================================
      // C2 DATE
      // ======================================================

      {
        name:
          "C2 Date",

        value:
          `<t:${Math.floor(
            candleDate.getTime() /
            1000
          )}:f>`,

        inline:
          false,
      }
    )

    .setColor(
      color
    )

    .setFooter({
      text:
        `CRT Scanner • MEXC • ${signal.market.toUpperCase()}`,
    })

    .setTimestamp(
      candleDate
    );
}


// ============================================================
// CREATE OLD CRT TIMEFRAME EMBED
// ============================================================
//
// Kept for compatibility with the existing PDYN CRT service.
//
// ============================================================

export function createCRTEmbed(
  timeframe =
    DEFAULT_TIMEFRAME
) {

  const status =
    getCRTStatus(
      timeframe
    );

  return new EmbedBuilder()

    .setTitle(
      "📊 CRT TIMEFRAME"
    )

    .setDescription(
      `**${status.label} CRT Candle Started**`
    )

    .addFields(

      {
        name:
          "Timeframe",

        value:
          `\`${status.label}\``,

        inline:
          true,
      },

      {
        name:
          "Start",

        value:
          `\`${status.start}\``,

        inline:
          true,
      },

      {
        name:
          "End",

        value:
          `\`${status.end}\``,

        inline:
          true,
      },

      {
        name:
          "Remaining",

        value:
          `\`${status.remaining}\``,

        inline:
          true,
      },

      {
        name:
          "Current Time",

        value:
          `\`${status.currentTime}\``,

        inline:
          true,
      },

      {
        name:
          "Timezone",

        value:
          `\`${status.timezone}\``,

        inline:
          true,
      },

      {
        name:
          "Date",

        value:
          `\`${status.date}\``,

        inline:
          true,
      }
    )

    .setColor(
      CRT_CONFIG.color ||
      "#5865F2"
    )

    .setFooter({
      text:
        CRT_CONFIG.footer ||
        "CRT • PDYN",
    })

    .setTimestamp();
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

  if (
    !channelId
  ) {

    console.warn(
      `[CRT] No Discord channel configured for ${signal.timeframe}.`
    );

    return false;
  }

  try {

    const channel =
      await client.channels.fetch(
        channelId
      );

    if (
      !channel
    ) {

      console.warn(
        `[CRT] Discord channel not found: ${channelId}`
      );

      return false;
    }

    if (
      typeof channel.send !==
      "function"
    ) {

      console.warn(
        `[CRT] Discord channel cannot send messages: ${channelId}`
      );

      return false;
    }


    const embed =
      createSignalEmbed(
        signal
      );


    await channel.send({

      embeds: [
        embed,
      ],
    });


    console.log(
      `[CRT] SIGNAL SENT | ${signal.direction} | ${signal.market} | ${signal.symbol} | ${signal.timeframe} | RSI ${signal.rsi.toFixed(2)} | ${signal.rsiState}`
    );

    return true;

  } catch (
    error
  ) {

    console.error(
      `[CRT] Failed to send signal ${signal.symbol} ${signal.timeframe}:`,
      error.message
    );

    return false;
  }
}


// ============================================================
// PROCESS SYMBOL
// ============================================================

async function processSymbol(
  client,
  market,
  symbol,
  timeframe
) {

  try {

    const candles =
      await getKlines(
        market,
        symbol,
        timeframe
      );

    const closedCandles =
      candles.filter(
        (candle) =>
          candle.closed ===
          true
      );


    // ========================================================
    // NEED ENOUGH HISTORY
    // ========================================================

    if (
      closedCandles.length <
      RSI_PERIOD + 3
    ) {

      return;
    }


    // ========================================================
    // STATE
    // ========================================================

    const state =
      getState(
        market,
        symbol,
        timeframe
      );


    // ========================================================
    // LATEST CLOSED CANDLE
    // ========================================================

    const latestClosed =
      closedCandles[
        closedCandles.length -
        1
      ];

    const latestClosedTime =
      Number(
        latestClosed.openTime
      );


    // ========================================================
    // FIRST STARTUP
    // ========================================================
    //
    // If there is no saved state, establish the latest closed
    // candle as the baseline.
    //
    // DO NOT generate an old historical signal.
    //
    // The next newly closed candle becomes the first candidate.
    //
    // ========================================================

    if (
      !state.initialized
    ) {

      updateState(
        market,
        symbol,
        timeframe,
        {

          initialized:
            true,

          lastClosedCandle:
            latestClosedTime,

          lastSignalId:
            null,

          lastSignalCandle:
            0,

          lastSignalDirection:
            null,
        }
      );

      console.log(
        `[CRT] BASELINE | ${market} | ${symbol} | ${timeframe} | ${new Date(
          latestClosedTime
        ).toISOString()}`
      );

      return;
    }


    // ========================================================
    // NO NEW CLOSED CANDLE
    // ========================================================

    if (
      latestClosedTime <=
      Number(
        state.lastClosedCandle ||
        0
      )
    ) {

      return;
    }


    // ========================================================
    // PROCESS ALL NEW CLOSED CANDLES
    // ========================================================
    //
    // Normally this is only one candle.
    //
    // If Railway was offline for several candles, this loop
    // processes the missed candles in chronological order.
    //
    // ========================================================

    const newCandles =
      closedCandles.filter(
        (candle) =>
          Number(
            candle.openTime
          ) >
          Number(
            state.lastClosedCandle ||
            0
          )
      );


    for (
      const newCandle
      of newCandles
    ) {

      const candleIndex =
        closedCandles.findIndex(
          (candle) =>
            Number(
              candle.openTime
            ) ===
            Number(
              newCandle.openTime
            )
        );


      if (
        candleIndex <
        RSI_PERIOD + 1
      ) {

        updateState(
          market,
          symbol,
          timeframe,
          {
            lastClosedCandle:
              Number(
                newCandle.openTime
              ),
          }
        );

        continue;
      }


      // ======================================================
      // BUILD HISTORY UP TO THIS CLOSED CANDLE
      // ======================================================

      const history =
        closedCandles.slice(
          0,
          candleIndex + 1
        );


      // ======================================================
      // BUILD SIGNAL
      // ======================================================

      const signal =
        buildSignal(
          market,
          symbol,
          timeframe,
          history
        );


      // ======================================================
      // NO SIGNAL
      // ======================================================

      if (
        !signal
      ) {

        updateState(
          market,
          symbol,
          timeframe,
          {

            lastClosedCandle:
              Number(
                newCandle.openTime
              ),
          }
        );

        continue;
      }


      // ======================================================
      // SAFETY CHECK
      // ======================================================
      //
      // The signal must belong to the candle we are currently
      // processing.
      //
      // ======================================================

      if (
        Number(
          signal.candleTime
        ) !==
        Number(
          newCandle.openTime
        )
      ) {

        updateState(
          market,
          symbol,
          timeframe,
          {

            lastClosedCandle:
              Number(
                newCandle.openTime
              ),
          }
        );

        continue;
      }


      // ======================================================
      // DUPLICATE CHECK
      // ======================================================

      const duplicate =
        state.lastSignalId ===
        signal.id;


      if (
        duplicate
      ) {

        updateState(
          market,
          symbol,
          timeframe,
          {

            lastClosedCandle:
              Number(
                newCandle.openTime
              ),
          }
        );

        continue;
      }


      // ======================================================
      // SEND SIGNAL
      // ======================================================

      const sent =
        await sendSignal(
          client,
          signal
        );


      // ======================================================
      // ONLY ADVANCE STATE IF SEND SUCCEEDED
      // ======================================================

      if (
        sent
      ) {

        updateState(
          market,
          symbol,
          timeframe,
          {

            lastClosedCandle:
              Number(
                newCandle.openTime
              ),

            lastSignalId:
              signal.id,

            lastSignalCandle:
              Number(
                signal.candleTime
              ),

            lastSignalDirection:
              signal.direction,
          }
        );

      } else {

        // ====================================================
        // DISCORD SEND FAILED
        // ====================================================
        //
        // Do NOT advance the state.
        //
        // The signal can be retried on the next scan.
        //
        break;
      }
    }

  } catch (
    error
  ) {

    console.error(
      `[CRT] Scan error | ${market} | ${symbol} | ${timeframe}:`,
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

  if (
    scanInProgress
  ) {

    return;
  }

  scanInProgress =
    true;

  try {

    const timeframes =
      Object.keys(
        TIMEFRAMES
      );


    for (
      const timeframe
      of timeframes
    ) {

      const markets =
        MARKETS;


      for (
        const market
        of markets
      ) {

        const symbols =
          getSymbols(
            market
          );


        for (
          const symbol
          of symbols
        ) {

          await processSymbol(
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
      "[CRT] Global scanner error:",
      error.message
    );

  } finally {

    scanInProgress =
      false;
  }
}


// ============================================================
// MANUAL SCAN
// ============================================================

export async function scanCRTNow(
  client
) {

  if (
    !Object.keys(
      signalState
    ).length
  ) {

    loadState();
  }

  await scanAll(
    client
  );
}


// ============================================================
// START CRT MONITOR
// ============================================================

export function startCRTMonitor(
  client
) {

  // ==========================================================
  // PREVENT DUPLICATE MONITOR
  // ==========================================================

  if (
    crtMonitorStarted
  ) {

    console.warn(
      "[CRT] Monitor is already running."
    );

    return;
  }


  // ==========================================================
  // ENABLED
  // ==========================================================

  if (
    CRT_CONFIG.enabled ===
    false
  ) {

    console.log(
      "[CRT] CRT system is disabled."
    );

    return;
  }


  // ==========================================================
  // AUTO ALERTS
  // ==========================================================

  if (
    CRT_CONFIG.autoAlerts ===
    false
  ) {

    console.log(
      "[CRT] Automatic CRT alerts are disabled."
    );

    return;
  }


  // ==========================================================
  // DISCORD CLIENT
  // ==========================================================

  if (
    !client
  ) {

    console.error(
      "[CRT] Discord client is missing."
    );

    return;
  }


  // ==========================================================
  // LOAD STATE
  // ==========================================================

  loadState();


  // ==========================================================
  // MARK STARTED
  // ==========================================================

  crtMonitorStarted =
    true;


  // ==========================================================
  // STARTUP LOG
  // ==========================================================

  console.log(
    "[CRT] ========================================"
  );

  console.log(
    "[CRT] MEXC CRT SIGNAL MONITOR STARTED"
  );

  console.log(
    "[CRT] ========================================"
  );

  console.log(
    `[CRT] Timezone: ${CRT_TIMEZONE}`
  );

  console.log(
    `[CRT] Check interval: ${CHECK_INTERVAL}ms`
  );

  console.log(
    `[CRT] RSI period: ${RSI_PERIOD}`
  );

  console.log(
    `[CRT] RSI oversold: ${RSI_OVERSOLD}`
  );

  console.log(
    `[CRT] RSI overbought: ${RSI_OVERBOUGHT}`
  );

  console.log(
    `[CRT] Markets: ${MARKETS.join(
      ", "
    )}`
  );

  console.log(
    `[CRT] Timeframes: ${Object.keys(
      TIMEFRAMES
    ).join(", ")}`
  );

  console.log(
    `[CRT] State file: ${STATE_FILE}`
  );


  // ==========================================================
  // SYMBOL LOG
  // ==========================================================

  for (
    const market
    of MARKETS
  ) {

    console.log(
      `[CRT] ${market.toUpperCase()} symbols: ${getSymbols(
        market
      ).join(", ")}`
    );
  }


  // ==========================================================
  // FIRST SCAN
  // ==========================================================

  void scanAll(
    client
  );


  // ==========================================================
  // REPEATING SCAN
  // ==========================================================

  setInterval(
    () =>
      void scanAll(
        client
      ),
    CHECK_INTERVAL
  );
}


// ============================================================
// CRT CONFIG
// ============================================================

export function getCRTConfig() {

  return {

    timezone:
      CRT_TIMEZONE,

    markets:
      MARKETS,

    timeframes:
      Object.keys(
        TIMEFRAMES
      ),

    checkInterval:
      CHECK_INTERVAL,

    rsi: {

      period:
        RSI_PERIOD,

      oversold:
        RSI_OVERSOLD,

      overbought:
        RSI_OVERBOUGHT,
    },

    stateFile:
      STATE_FILE,
  };
}


// ============================================================
// CRT STATE STATUS
// ============================================================

export function getCRTStateStatus() {

  return {

    stateFile:
      STATE_FILE,

    entries:
      Object.keys(
        signalState
      ).length,

    states:
      Object.entries(
        signalState
      ).map(
        ([
          key,
          value,
        ]) => ({

          key,

          initialized:
            value.initialized ===
            true,

          lastClosedCandle:
            value.lastClosedCandle
              ? new Date(
                  value.lastClosedCandle
                ).toISOString()
              : null,

          lastSignalCandle:
            value.lastSignalCandle
              ? new Date(
                  value.lastSignalCandle
                ).toISOString()
              : null,

          lastSignalId:
            value.lastSignalId ||
            null,

          lastSignalDirection:
            value.lastSignalDirection ||
            null,

          updatedAt:
            value.updatedAt
              ? new Date(
                  value.updatedAt
                ).toISOString()
              : null,
        })
      ),
  };
}


// ============================================================
// ALL CRT STATUSES
// ============================================================

export function getAllCRTStatuses() {

  const statuses = {};

  for (
    const timeframe
    of Object.keys(
      TIMEFRAMES
    )
  ) {

    statuses[
      timeframe
    ] =
      getCRTStatus(
        timeframe
      );
  }

  return statuses;
}


// ============================================================
// SERVICE LOADED
// ============================================================

console.log(
  "[CRT] Service loaded."
);

console.log(
  `[CRT] Timeframes: ${getAvailableCRTTimeframes().join(
    ", "
  )}`
);

console.log(
  `[CRT] RSI: ${RSI_PERIOD} | Oversold <= ${RSI_OVERSOLD} | Overbought >= ${RSI_OVERBOUGHT}`
);
