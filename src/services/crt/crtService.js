import { EmbedBuilder } from "discord.js";
import botConfig from "../../config/bot.js";

// ============================================================
// PDYN CRT SIGNAL SERVICE
// ============================================================
//
// SOURCE:
//   MEXC FUTURES ONLY
//
// PRIMARY SIGNAL:
//   Rachel T Fractals
//
// MARKET CONTEXT:
//   RSI
//   Standard Deviation
//   Market Structure
//
// MARKET STRUCTURE OUTPUT:
//   BULLISH
//   BEARISH
//
// TIMEFRAMES:
//   5m  -> TOP-DOWN ANALYSIS ONLY
//   15m -> STANDARD CRT
//   1h  -> STANDARD CRT
//   4h  -> STANDARD CRT
//   1d  -> STANDARD CRT
//
// 30m:
//   REMOVED
//
// OANDA:
//   DISABLED
//
// MEXC SPOT:
//   DISABLED
//
// 5m TOP-DOWN:
//
//   DAILY
//      ↓
//   4H
//      ↓
//   1H
//      ↓
//   15M
//      ↓
//   5M
//
// The 5m signal is only sent when ALL higher timeframes
// confirm the same Rachel T fractal direction.
//
// ============================================================


// ============================================================
// CONFIG
// ============================================================

const CRT_CONFIG =
  botConfig?.crt || {};


// ============================================================
// TIMEZONE
// ============================================================

const CRT_TIMEZONE =
  CRT_CONFIG.timezone ||
  "Asia/Manila";


// ============================================================
// TIMEFRAMES
// ============================================================
//
// 30m REMOVED.
//
// 5m is enabled for Top-Down Analysis.
//
// ============================================================

const TIMEFRAMES =
  CRT_CONFIG.timeframes || {

    "5m": 5,

    "15m": 15,

    "1h": 60,

    "4h": 240,

    "1d": 1440,

  };


// ============================================================
// FORCE REQUIRED TIMEFRAMES
// ============================================================
//
// This guarantees 30m is not used even if an older config
// still contains it.
//
// ============================================================

delete TIMEFRAMES["30m"];


// ============================================================
// DISCORD CHANNELS
// ============================================================

const CHANNELS = {

  ...(CRT_CONFIG.channels || {}),

  // New dedicated 5m channel
  "5m":
    "1536311840378986547",

};


// ============================================================
// TOP-DOWN TIMEFRAMES
// ============================================================

const TOP_DOWN_TIMEFRAMES = [

  "1d",

  "4h",

  "1h",

  "15m",

];


// ============================================================
// MEXC FUTURES API
// ============================================================

const MEXC_BASE_URL =
  (
    process.env.MEXC_FUTURES_API_URL ||
    CRT_CONFIG.mexc?.api ||
    "https://api.mexc.com"
  ).replace(
    /\/+$/,
    ""
  );


// ============================================================
// RSI
// ============================================================

const RSI_PERIOD =
  Number(
    CRT_CONFIG.rsi?.period
  ) ||
  14;

const RSI_OVERBOUGHT =
  Number(
    CRT_CONFIG.rsi?.overbought
  ) ||
  70;

const RSI_OVERSOLD =
  Number(
    CRT_CONFIG.rsi?.oversold
  ) ||
  30;


// ============================================================
// STANDARD DEVIATION
// ============================================================

const STDDEV_PERIOD =
  Number(
    CRT_CONFIG.standardDeviation?.period
  ) ||
  20;

const STDDEV_HIGH_MULTIPLIER =
  Number(
    CRT_CONFIG.standardDeviation?.highMultiplier
  ) ||
  1.5;

const STDDEV_LOW_MULTIPLIER =
  Number(
    CRT_CONFIG.standardDeviation?.lowMultiplier
  ) ||
  0.75;


// ============================================================
// MARKET STRUCTURE
// ============================================================

const STRUCTURE_LOOKBACK =
  Number(
    CRT_CONFIG.marketStructure?.lookback
  ) ||
  20;

const STRUCTURE_SWING_LENGTH =
  Number(
    CRT_CONFIG.marketStructure?.swingLength
  ) ||
  2;


// ============================================================
// RACHEL T FRACTALS
// ============================================================

const FILTER_BW =
  false;

const FILTERED_TOP_ENABLED =
  true;

const FILTERED_BOTTOM_ENABLED =
  true;


// ============================================================
// REQUEST SETTINGS
// ============================================================

const REQUEST_TIMEOUT =
  15000;

const CANDLE_LIMIT =
  220;

const CHECK_INTERVAL =
  Number(
    CRT_CONFIG.checkInterval
  ) >= 1000
    ? Number(
        CRT_CONFIG.checkInterval
      )
    : 5000;


// ============================================================
// CONCURRENCY
// ============================================================

const MEXC_CONCURRENCY =
  4;


// ============================================================
// CACHE
// ============================================================

let mexcSymbolsCache =
  null;

let mexcSymbolsCacheTime =
  0;

const MEXC_SYMBOL_CACHE_TIME =
  10 *
  60 *
  1000;


// ============================================================
// SIGNAL STATE
// ============================================================

const signalState =
  new Map();


// ============================================================
// STARTUP BASELINE
// ============================================================

const startupBaseline =
  new Set();


// ============================================================
// MONITOR STATE
// ============================================================

let crtMonitorStarted =
  false;

let monitorTimer =
  null;


// ============================================================
// MEXC BLOCK STATE
// ============================================================

let mexcBlockedUntil =
  0;

const MEXC_BLOCK_COOLDOWN =
  60 *
  1000;


// ============================================================
// FETCH JSON
// ============================================================

async function fetchJson(
  url,
  options = {}
) {

  const controller =
    new AbortController();

  const timeout =
    setTimeout(
      () => {
        controller.abort();
      },
      REQUEST_TIMEOUT
    );

  try {

    const response =
      await fetch(
        url,
        {
          ...options,

          signal:
            controller.signal,

          headers: {

            Accept:
              "application/json",

            "User-Agent":
              "PDYN-CRT-Bot/1.0",

            ...(options.headers || {}),

          },

        }
      );

    const text =
      await response.text();

    let data =
      null;

    try {

      data =
        text
          ? JSON.parse(text)
          : null;

    } catch {

      data =
        null;

    }

    if (
      !response.ok
    ) {

      const error =
        new Error(
          `HTTP ${response.status}: ${
            data?.msg ||
            data?.message ||
            text.slice(0, 250)
          }`
        );

      error.status =
        response.status;

      error.url =
        url;

      throw error;

    }

    return data;

  } finally {

    clearTimeout(
      timeout
    );

  }

}


// ============================================================
// MEXC INTERVAL
// ============================================================

function getMexcInterval(
  timeframe
) {

  const intervals = {

    "5m":
      "Min5",

    "15m":
      "Min15",

    "1h":
      "Min60",

    "4h":
      "Hour4",

    "1d":
      "Day1",

  };

  return (
    intervals[timeframe] ||
    "Min15"
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
// DATE
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
// TIME
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
// TIME WITH SECONDS
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
// CURRENT CRT
// ============================================================

export function getCurrentCRT(
  timeframe = "15m"
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
      `Invalid CRT timeframe "${timeframe}".`
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

  if (
    timeframe ===
    "1d"
  ) {

    const startTimestamp =
      Date.UTC(
        now.year,
        now.month - 1,
        now.day,
        -8,
        0,
        0
      );

    const endTimestamp =
      startTimestamp +
      24 *
      60 *
      60 *
      1000;

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

  const totalMinutes =
    now.hour *
    60 +
    now.minute;

  const candleStartMinutes =
    Math.floor(
      totalMinutes /
      minutes
    ) *
    minutes;

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
    ) %
    24;

  const endMinute =
    endTotalMinutes %
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

  ].join(
    ":"
  );

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
// NORMALIZE MEXC SYMBOL
// ============================================================

function normalizeMexcSymbol(
  symbol
) {

  return String(
    symbol ||
    ""
  )
    .trim()
    .toUpperCase();

}


// ============================================================
// GET MEXC FUTURES SYMBOLS
// ============================================================

async function getMexcFuturesSymbols() {

  const now =
    Date.now();

  if (
    mexcSymbolsCache &&
    now -
      mexcSymbolsCacheTime <
      MEXC_SYMBOL_CACHE_TIME
  ) {

    return mexcSymbolsCache;

  }

  if (
    now <
    mexcBlockedUntil
  ) {

    return [];

  }

  const url =
    `${MEXC_BASE_URL}` +
    `/api/v1/contract/detail`;

  try {

    const response =
      await fetchJson(
        url
      );

    const contracts =
      Array.isArray(
        response?.data
      )
        ? response.data
        : [];

    const symbols =
      contracts
        .filter(
          (
            contract
          ) => {

            const symbol =
              normalizeMexcSymbol(
                contract?.symbol
              );

            const quoteCoin =
              String(
                contract?.quoteCoin ||
                ""
              ).toUpperCase();

            const settleCoin =
              String(
                contract?.settleCoin ||
                ""
              ).toUpperCase();

            const isUSDT =
              quoteCoin ===
                "USDT" ||
              settleCoin ===
                "USDT" ||
              symbol.endsWith(
                "_USDT"
              ) ||
              symbol.endsWith(
                "USDT"
              );

            return (
              Boolean(
                symbol
              ) &&
              isUSDT
            );

          }
        )
        .map(
          (
            contract
          ) =>
            normalizeMexcSymbol(
              contract.symbol
            )
        )
        .filter(
          Boolean
        );

    mexcSymbolsCache =
      [
        ...new Set(
          symbols
        ),
      ];

    mexcSymbolsCacheTime =
      now;

    const xauSymbols =
      mexcSymbolsCache.filter(
        (
          symbol
        ) =>
          symbol.includes(
            "XAU"
          )
      );

    if (
      xauSymbols.length
    ) {

      console.log(
        `[CRT] XAU MEXC contracts: ${xauSymbols.join(", ")}`
      );

    }

    console.log(
      `[CRT] MEXC Futures contracts loaded: ${mexcSymbolsCache.length}`
    );

    return mexcSymbolsCache;

  } catch (
    error
  ) {

    if (
      error.status ===
        403 ||
      error.status ===
        401
    ) {

      mexcBlockedUntil =
        Date.now() +
        MEXC_BLOCK_COOLDOWN;

    }

    throw error;

  }

}


// ============================================================
// FETCH MEXC CANDLES
// ============================================================

async function fetchMexcCandles(
  symbol,
  timeframe
) {

  if (
    Date.now() <
    mexcBlockedUntil
  ) {

    return [];

  }

  const normalizedSymbol =
    normalizeMexcSymbol(
      symbol
    );

  if (
    !normalizedSymbol
  ) {

    return [];

  }

  const interval =
    getMexcInterval(
      timeframe
    );

  const url =
    `${MEXC_BASE_URL}` +
    `/api/v1/contract/kline/` +
    `${encodeURIComponent(
      normalizedSymbol
    )}` +
    `?interval=${encodeURIComponent(
      interval
    )}` +
    `&limit=${CANDLE_LIMIT}`;

  try {

    const response =
      await fetchJson(
        url
      );

    return parseMexcKlineResponse(
      response
    );

  } catch (
    error
  ) {

    if (
      error.status ===
        403 ||
      error.status ===
        401
    ) {

      mexcBlockedUntil =
        Date.now() +
        MEXC_BLOCK_COOLDOWN;

      return [];

    }

    if (
      error.status ===
      429
    ) {

      mexcBlockedUntil =
        Date.now() +
        30 *
        1000;

      return [];

    }

    throw error;

  }

}


// ============================================================
// NORMALIZE TIMESTAMP
// ============================================================

function normalizeTimestamp(
  value
) {

  const number =
    Number(
      value
    );

  if (
    !Number.isFinite(
      number
    )
  ) {

    return NaN;

  }

  if (
    number <
    100000000000
  ) {

    return (
      number *
      1000
    );

  }

  return number;

}


// ============================================================
// PARSE MEXC KLINE
// ============================================================

function parseMexcKlineResponse(
  response
) {

  const data =
    response?.data;

  if (
    !data
  ) {

    return [];

  }

  if (
    !Array.isArray(
      data
    ) &&
    Array.isArray(
      data.time
    )
  ) {

    const candles =
      [];

    for (
      let i = 0;
      i <
      data.time.length;
      i++
    ) {

      const candle = {

        timestamp:
          normalizeTimestamp(
            data.time[i]
          ),

        open:
          Number(
            data.open?.[i]
          ),

        high:
          Number(
            data.high?.[i]
          ),

        low:
          Number(
            data.low?.[i]
          ),

        close:
          Number(
            data.close?.[i]
          ),

        volume:
          Number(
            data.vol?.[i] ||
            data.volume?.[i] ||
            0
          ),

      };

      if (
        isValidCandle(
          candle
        )
      ) {

        candles.push(
          candle
        );

      }

    }

    return candles.sort(
      (
        a,
        b
      ) =>
        a.timestamp -
        b.timestamp
    );

  }

  if (
    Array.isArray(
      data
    )
  ) {

    return data
      .map(
        (
          row
        ) => {

          if (
            Array.isArray(
              row
            )
          ) {

            return {

              timestamp:
                normalizeTimestamp(
                  row[0]
                ),

              open:
                Number(
                  row[1]
                ),

              close:
                Number(
                  row[2]
                ),

              high:
                Number(
                  row[3]
                ),

              low:
                Number(
                  row[4]
                ),

              volume:
                Number(
                  row[5] ||
                  0
                ),

            };

          }

          return {

            timestamp:
              normalizeTimestamp(
                row?.time
              ),

            open:
              Number(
                row?.open
              ),

            high:
              Number(
                row?.high
              ),

            low:
              Number(
                row?.low
              ),

            close:
              Number(
                row?.close
              ),

            volume:
              Number(
                row?.vol ||
                row?.volume ||
                0
              ),

          };

        }
      )
      .filter(
        isValidCandle
      )
      .sort(
        (
          a,
          b
        ) =>
          a.timestamp -
          b.timestamp
      );

  }

  return [];

}


// ============================================================
// VALID CANDLE
// ============================================================

function isValidCandle(
  candle
) {

  return (

    candle &&

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
    candles.map(
      (
        candle
      ) =>
        Number(
          candle.close
        )
    );

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
      change >
      0
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
    (
      100 /
      (
        1 +
        rs
      )
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

    return "N/A";

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
// STANDARD DEVIATION
// ============================================================

export function calculateStandardDeviation(
  candles,
  period = STDDEV_PERIOD
) {

  if (
    !Array.isArray(
      candles
    ) ||
    candles.length <
      period + 1
  ) {

    return null;

  }

  const returns =
    [];

  const start =
    Math.max(
      1,
      candles.length -
        period
    );

  for (
    let i = start;
    i <
    candles.length;
    i++
  ) {

    const previous =
      Number(
        candles[
          i - 1
        ].close
      );

    const current =
      Number(
        candles[
          i
        ].close
      );

    if (
      previous <=
        0 ||
      current <=
        0
    ) {

      continue;

    }

    returns.push(
      (
        current -
        previous
      ) /
      previous
    );

  }

  if (
    returns.length <
    2
  ) {

    return null;

  }

  const mean =
    returns.reduce(
      (
        sum,
        value
      ) =>
        sum +
        value,
      0
    ) /
    returns.length;

  const variance =
    returns.reduce(
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
    returns.length;

  const value =
    Math.sqrt(
      variance
    );

  const historicalValues =
    [];

  const historicalStart =
    Math.max(
      period + 1,
      candles.length -
        period * 3
    );

  for (
    let i =
      historicalStart;
    i <
    candles.length;
    i++
  ) {

    const window =
      [];

    const begin =
      Math.max(
        1,
        i -
          period +
          1
      );

    for (
      let j =
        begin;
      j <=
      i;
      j++
    ) {

      const previous =
        Number(
          candles[
            j - 1
          ].close
        );

      const current =
        Number(
          candles[
            j
          ].close
        );

      if (
        previous >
          0 &&
        current >
          0
      ) {

        window.push(
          (
            current -
            previous
          ) /
          previous
        );

      }

    }

    if (
      window.length >=
      2
    ) {

      const avg =
        window.reduce(
          (
            sum,
            item
          ) =>
            sum +
            item,
          0
        ) /
        window.length;

      const varianceWindow =
        window.reduce(
          (
            sum,
            item
          ) =>
            sum +
            Math.pow(
              item -
              avg,
              2
            ),
          0
        ) /
        window.length;

      historicalValues.push(
        Math.sqrt(
          varianceWindow
        )
      );

    }

  }

  const averageHistorical =
    historicalValues.length
      ? historicalValues.reduce(
          (
            sum,
            item
          ) =>
            sum +
            item,
          0
        ) /
        historicalValues.length
      : value;

  let state =
    "NORMAL";

  if (
    value >
    averageHistorical *
      STDDEV_HIGH_MULTIPLIER
  ) {

    state =
      "HIGH";

  } else if (
    value <
    averageHistorical *
      STDDEV_LOW_MULTIPLIER
  ) {

    state =
      "LOW";

  }

  return {

    value,

    state,

    mean,

    baseline:
      averageHistorical,

  };

}


// ============================================================
// RACHEL T TOP FRACTAL
// ============================================================

function isBWTop(
  candles,
  index
) {

  if (
    index <
      4 ||
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
// RACHEL T BOTTOM FRACTAL
// ============================================================

function isBWBottom(
  candles,
  index
) {

  if (
    index <
      4 ||
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
// FILTERED TOP
// ============================================================

function isFilteredTop(
  candles,
  index
) {

  if (
    FILTER_BW
  ) {

    return false;

  }

  return isBWTop(
    candles,
    index
  );

}


// ============================================================
// FILTERED BOTTOM
// ============================================================

function isFilteredBottom(
  candles,
  index
) {

  if (
    FILTER_BW
  ) {

    return false;

  }

  return isBWBottom(
    candles,
    index
  );

}


// ============================================================
// FIND LAST FRACTAL
// ============================================================

function findLastFilteredFractal(
  candles
) {

  if (
    candles.length <
    5
  ) {

    return null;

  }

  const lastIndex =
    candles.length -
    1;

  for (
    let index =
      lastIndex;
    index >=
      4;
    index--
  ) {

    const fractalIndex =
      index -
      2;

    const candle =
      candles[
        fractalIndex
      ];

    if (
      FILTERED_TOP_ENABLED &&
      isFilteredTop(
        candles,
        index
      )
    ) {

      return {

        type:
          "SELL",

        fractalType:
          "TOP",

        index:
          fractalIndex,

        timestamp:
          candle.timestamp,

        price:
          candle.close,

        fractalPrice:
          candle.high,

        volume:
          candle.volume,

      };

    }

    if (
      FILTERED_BOTTOM_ENABLED &&
      isFilteredBottom(
        candles,
        index
      )
    ) {

      return {

        type:
          "BUY",

        fractalType:
          "BOTTOM",

        index:
          fractalIndex,

        timestamp:
          candle.timestamp,

        price:
          candle.close,

        fractalPrice:
          candle.low,

        volume:
          candle.volume,

      };

    }

  }

  return null;

}


// ============================================================
// FIND NEW FRACTAL
// ============================================================

function findNewestFractalAfter(
  candles,
  timestamp
) {

  if (
    candles.length <
    5
  ) {

    return null;

  }

  const lastIndex =
    candles.length -
    1;

  for (
    let index =
      lastIndex;
    index >=
      4;
    index--
  ) {

    const fractalIndex =
      index -
      2;

    const candle =
      candles[
        fractalIndex
      ];

    if (
      candle.timestamp <=
      timestamp
    ) {

      break;

    }

    if (
      FILTERED_TOP_ENABLED &&
      isFilteredTop(
        candles,
        index
      )
    ) {

      return {

        type:
          "SELL",

        fractalType:
          "TOP",

        index:
          fractalIndex,

        timestamp:
          candle.timestamp,

        price:
          candle.close,

        fractalPrice:
          candle.high,

        volume:
          candle.volume,

      };

    }

    if (
      FILTERED_BOTTOM_ENABLED &&
      isFilteredBottom(
        candles,
        index
      )
    ) {

      return {

        type:
          "BUY",

        fractalType:
          "BOTTOM",

        index:
          fractalIndex,

        timestamp:
          candle.timestamp,

        price:
          candle.close,

        fractalPrice:
          candle.low,

        volume:
          candle.volume,

      };

    }

  }

  return null;

}


// ============================================================
// FIND SWING HIGHS
// ============================================================

function findSwingHighs(
  candles,
  swingLength =
    STRUCTURE_SWING_LENGTH
) {

  const swings =
    [];

  for (
    let i =
      swingLength;
    i <
      candles.length -
      swingLength;
    i++
  ) {

    const current =
      candles[
        i
      ].high;

    let valid =
      true;

    for (
      let j = 1;
      j <=
        swingLength;
      j++
    ) {

      if (
        current <=
          candles[
            i - j
          ].high ||
        current <
          candles[
            i + j
          ].high
      ) {

        valid =
          false;

        break;

      }

    }

    if (
      valid
    ) {

      swings.push({

        index:
          i,

        timestamp:
          candles[
            i
          ].timestamp,

        price:
          current,

      });

    }

  }

  return swings;

}


// ============================================================
// FIND SWING LOWS
// ============================================================

function findSwingLows(
  candles,
  swingLength =
    STRUCTURE_SWING_LENGTH
) {

  const swings =
    [];

  for (
    let i =
      swingLength;
    i <
      candles.length -
      swingLength;
    i++
  ) {

    const current =
      candles[
        i
      ].low;

    let valid =
      true;

    for (
      let j = 1;
      j <=
        swingLength;
      j++
    ) {

      if (
        current >=
          candles[
            i - j
          ].low ||
        current >
          candles[
            i + j
          ].low
      ) {

        valid =
          false;

        break;

      }

    }

    if (
      valid
    ) {

      swings.push({

        index:
          i,

        timestamp:
          candles[
            i
          ].timestamp,

        price:
          current,

      });

    }

  }

  return swings;

}


// ============================================================
// MARKET STRUCTURE
// ============================================================
//
// Output:
//
//   BULLISH
//   BEARISH
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
      STRUCTURE_LOOKBACK
  ) {

    return {

      state:
        "BEARISH",

      bias:
        "BEARISH",

      lastHigh:
        null,

      previousHigh:
        null,

      lastLow:
        null,

      previousLow:
        null,

    };

  }

  const recent =
    candles.slice(
      Math.max(
        0,
        candles.length -
          STRUCTURE_LOOKBACK
      )
    );

  const highs =
    findSwingHighs(
      recent
    );

  const lows =
    findSwingLows(
      recent
    );

  const lastHigh =
    highs.at(-1) ||
    null;

  const previousHigh =
    highs.at(-2) ||
    null;

  const lastLow =
    lows.at(-1) ||
    null;

  const previousLow =
    lows.at(-2) ||
    null;

  let bullishScore =
    0;

  let bearishScore =
    0;

  if (
    lastHigh &&
    previousHigh
  ) {

    if (
      lastHigh.price >
      previousHigh.price
    ) {

      bullishScore++;

    } else if (
      lastHigh.price <
      previousHigh.price
    ) {

      bearishScore++;

    }

  }

  if (
    lastLow &&
    previousLow
  ) {

    if (
      lastLow.price >
      previousLow.price
    ) {

      bullishScore++;

    } else if (
      lastLow.price <
      previousLow.price
    ) {

      bearishScore++;

    }

  }

  const currentPrice =
    candles[
      candles.length -
      1
    ].close;

  if (
    lastHigh &&
    currentPrice >
      lastHigh.price
  ) {

    bullishScore +=
      2;

  }

  if (
    lastLow &&
    currentPrice <
      lastLow.price
  ) {

    bearishScore +=
      2;

  }

  if (
    bullishScore ===
    bearishScore
  ) {

    const recentHigh =
      Math.max(
        ...recent.map(
          (
            candle
          ) =>
            candle.high
        )
      );

    const recentLow =
      Math.min(
        ...recent.map(
          (
            candle
          ) =>
            candle.low
        )
      );

    const midpoint =
      (
        recentHigh +
        recentLow
      ) /
      2;

    if (
      currentPrice >=
      midpoint
    ) {

      bullishScore++;

    } else {

      bearishScore++;

    }

  }

  const bias =
    bullishScore >
    bearishScore
      ? "BULLISH"
      : "BEARISH";

  return {

    state:
      bias,

    bias,

    bullishScore,

    bearishScore,

    lastHigh,

    previousHigh,

    lastLow,

    previousLow,

  };

}


// ============================================================
// STANDARD DEVIATION CONTEXT
// ============================================================

function getVolatilityState(
  standardDeviation
) {

  if (
    !standardDeviation
  ) {

    return "NORMAL";

  }

  if (
    standardDeviation.state ===
    "HIGH"
  ) {

    return "EXPANSION";

  }

  if (
    standardDeviation.state ===
    "LOW"
  ) {

    return "COMPRESSION";

  }

  return "NORMAL";

}


// ============================================================
// GET FRACTAL CONFIRMATION
// ============================================================
//
// This is the core signal used for Top-Down Analysis.
//
// ============================================================

function getFractalConfirmation(
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

  return findLastFilteredFractal(
    candles
  );

}


// ============================================================
// TOP-DOWN ANALYSIS
// ============================================================
//
// Higher timeframe confirmation:
//
//   1D
//   4H
//   1H
//   15M
//
// ALL must have a Rachel T fractal signal.
//
// ALL must have the SAME direction.
//
// If one timeframe is missing or opposite,
// the 5m signal is rejected.
//
// ============================================================

async function performTopDownAnalysis(
  symbol,
  fiveMinuteSignal
) {

  const confirmations =
    {};

  for (
    const timeframe of
    TOP_DOWN_TIMEFRAMES
  ) {

    try {

      const candles =
        await fetchMexcCandles(
          symbol,
          timeframe
        );

      if (
        !Array.isArray(
          candles
        ) ||
        candles.length <
          20
      ) {

        return {

          confirmed:
            false,

          direction:
            null,

          confirmations,

          reason:
            `${timeframe} data unavailable`,

        };

      }

      const fractal =
        getFractalConfirmation(
          candles
        );

      if (
        !fractal
      ) {

        return {

          confirmed:
            false,

          direction:
            null,

          confirmations,

          reason:
            `${timeframe} has no Rachel T confirmation`,

        };

      }

      confirmations[
        timeframe
      ] = {

        confirmed:
          true,

        direction:
          fractal.type,

        fractalType:
          fractal.fractalType,

        timestamp:
          fractal.timestamp,

      };

    } catch (
      error
    ) {

      console.error(
        `[CRT] Top-down ${symbol} ${timeframe}: ${error.message}`
      );

      return {

        confirmed:
          false,

        direction:
          null,

        confirmations,

        reason:
          `${timeframe} analysis failed`,

      };

    }

  }

  const directions =
    TOP_DOWN_TIMEFRAMES.map(
      (
        timeframe
      ) =>
        confirmations[
          timeframe
        ]?.direction
    );

  const allConfirmed =
    directions.every(
      (
        direction
      ) =>
        direction ===
        "BUY" ||
        direction ===
        "SELL"
    );

  if (
    !allConfirmed
  ) {

    return {

      confirmed:
        false,

      direction:
        null,

      confirmations,

      reason:
        "Not all higher timeframes confirmed",

    };

  }

  const firstDirection =
    directions[0];

  const sameDirection =
    directions.every(
      (
        direction
      ) =>
        direction ===
        firstDirection
    );

  if (
    !sameDirection
  ) {

    return {

      confirmed:
        false,

      direction:
        null,

      confirmations,

      reason:
        "Higher timeframes disagree",

    };

  }

  if (
    fiveMinuteSignal &&
    fiveMinuteSignal.type !==
      firstDirection
  ) {

    return {

      confirmed:
        false,

      direction:
        null,

      confirmations,

      reason:
        "5m signal disagrees with higher timeframes",

    };

  }

  return {

    confirmed:
      true,

    direction:
      firstDirection,

    confirmations,

    reason:
      "All higher timeframes confirmed",

  };

}


// ============================================================
// PROCESS STANDARD MARKET
// ============================================================
//
// Used for:
//
//   15m
//   1h
//   4h
//   1d
//
// ============================================================

async function processStandardMarket(
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

  const rsi =
    calculateRSI(
      candles,
      RSI_PERIOD
    );

  const rsiState =
    getRSIState(
      rsi
    );

  const standardDeviation =
    calculateStandardDeviation(
      candles,
      STDDEV_PERIOD
    );

  const marketStructure =
    calculateMarketStructure(
      candles
    );

  const stateKey =
    `MEXC|${symbol}|${timeframe}`;

  const previousTimestamp =
    signalState.get(
      stateKey
    );

  let signal;

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
      findLastFilteredFractal(
        candles
      );

  }

  if (
    !signal
  ) {

    return;

  }

  // ----------------------------------------------------------
  // STARTUP BASELINE
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
      `[CRT] Baseline | MEXC | ${symbol} | ${timeframe} | ${signal.fractalType}`
    );

    return;

  }

  // ----------------------------------------------------------
  // DUPLICATE PROTECTION
  // ----------------------------------------------------------

  if (
    signal.timestamp <=
    (
      signalState.get(
        stateKey
      ) ||
      0
    )
  ) {

    return;

  }

  // ----------------------------------------------------------
  // SAVE BEFORE SEND
  // ----------------------------------------------------------

  signalState.set(
    stateKey,
    signal.timestamp
  );

  // ----------------------------------------------------------
  // SEND
  // ----------------------------------------------------------

  await sendCRTSignal(
    client,
    {

      symbol,

      timeframe,

      signal,

      rsi,

      rsiState,

      standardDeviation,

      marketStructure,

      topDown:
        null,

    }
  );

}


// ============================================================
// PROCESS 5M TOP-DOWN MARKET
// ============================================================
//
// The 5m signal is NOT sent using normal standalone CRT.
//
// It must pass:
//
//   1D
//   4H
//   1H
//   15M
//   5M
//
// confirmation.
//
// ============================================================

async function processFiveMinuteMarket(
  client,
  symbol,
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

  const timeframe =
    "5m";

  const rsi =
    calculateRSI(
      candles,
      RSI_PERIOD
    );

  const rsiState =
    getRSIState(
      rsi
    );

  const standardDeviation =
    calculateStandardDeviation(
      candles,
      STDDEV_PERIOD
    );

  const marketStructure =
    calculateMarketStructure(
      candles
    );

  const stateKey =
    `MEXC|${symbol}|5m`;

  const previousTimestamp =
    signalState.get(
      stateKey
    );

  let signal;

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
      findLastFilteredFractal(
        candles
      );

  }

  if (
    !signal
  ) {

    return;

  }

  // ----------------------------------------------------------
  // STARTUP BASELINE
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
      `[CRT] 5m Baseline | MEXC | ${symbol} | ${signal.fractalType}`
    );

    return;

  }

  // ----------------------------------------------------------
  // DUPLICATE PROTECTION
  // ----------------------------------------------------------

  if (
    signal.timestamp <=
    (
      signalState.get(
        stateKey
      ) ||
      0
    )
  ) {

    return;

  }

  // ----------------------------------------------------------
  // TOP-DOWN ANALYSIS
  // ----------------------------------------------------------

  const topDown =
    await performTopDownAnalysis(
      symbol,
      signal
    );

  if (
    !topDown.confirmed
  ) {

    console.log(
      `[CRT] 5m rejected | ${symbol} | ${topDown.reason}`
    );

    return;

  }

  // ----------------------------------------------------------
  // SAVE ONLY AFTER FULL CONFIRMATION
  // ----------------------------------------------------------

  signalState.set(
    stateKey,
    signal.timestamp
  );

  // ----------------------------------------------------------
  // SEND 5M TOP-DOWN SIGNAL
  // ----------------------------------------------------------

  await sendCRTSignal(
    client,
    {

      symbol,

      timeframe,

      signal,

      rsi,

      rsiState,

      standardDeviation,

      marketStructure,

      topDown,

    }
  );

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

  const absolute =
    Math.abs(
      volume
    );

  if (
    absolute >=
    1_000_000_000
  ) {

    return (
      (
        volume /
        1_000_000_000
      ).toFixed(
        2
      ) +
      "B"
    );

  }

  if (
    absolute >=
    1_000_000
  ) {

    return (
      (
        volume /
        1_000_000
      ).toFixed(
        2
      ) +
      "M"
    );

  }

  if (
    absolute >=
    1_000
  ) {

    return (
      (
        volume /
        1_000
      ).toFixed(
        2
      ) +
      "K"
    );

  }

  return volume.toFixed(
    2
  );

}


// ============================================================
// FORMAT RSI
// ============================================================
//
// OVERBOUGHT / OVERSOLD = BOLD
// NEUTRAL = NORMAL
//
// ============================================================

function formatRSI(
  rsi
) {

  const state =
    getRSIState(
      rsi
    );

  if (
    state ===
      "OVERBOUGHT" ||
    state ===
      "OVERSOLD"
  ) {

    return `**${state}**`;

  }

  return state;

}


// ============================================================
// FORMAT STANDARD DEVIATION
// ============================================================

function formatStandardDeviation(
  standardDeviation
) {

  if (
    !standardDeviation
  ) {

    return "N/A";

  }

  return getVolatilityState(
    standardDeviation
  );

}


// ============================================================
// FORMAT MARKET STRUCTURE
// ============================================================

function formatMarketStructure(
  structure
) {

  if (
    !structure
  ) {

    return "BEARISH";

  }

  return (
    structure.bias ===
    "BULLISH"
      ? "BULLISH"
      : "BEARISH"
  );

}


// ============================================================
// FORMAT TOP-DOWN
// ============================================================

function formatTopDown(
  topDown
) {

  if (
    !topDown ||
    !topDown.confirmed
  ) {

    return null;

  }

  const direction =
    topDown.direction;

  const confirmations =
    topDown.confirmations ||
    {};

  const daily =
    confirmations["1d"]?.direction ||
    "N/A";

  const fourHour =
    confirmations["4h"]?.direction ||
    "N/A";

  const oneHour =
    confirmations["1h"]?.direction ||
    "N/A";

  const fifteen =
    confirmations["15m"]?.direction ||
    "N/A";

  return (

    `1D ${daily}\n` +
    `4H ${fourHour}\n` +
    `1H ${oneHour}\n` +
    `15M ${fifteen}\n` +
    `5M ${direction}`

  );

}


// ============================================================
// FORMAT SIGNAL TIME
// ============================================================

function formatSignalTime(
  timestamp
) {

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

    rsi,

    standardDeviation,

    marketStructure,

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

  // Only coin is bold
  const coin =
    `**${symbol}**`;

  // Only volume is bold
  const volume =
    `**${formatVolume(
      signal.volume
    )}**`;

  const structure =
    formatMarketStructure(
      marketStructure
    );

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
        "CRT",

      value:
        isBuy
          ? "🟢 BUY"
          : "🔴 SELL",

      inline:
        true,

    },

    {
      name:
        "RSI",

      value:
        formatRSI(
          rsi
        ),

      inline:
        true,

    },

    {
      name:
        "VOLUME",

      value:
        volume,

      inline:
        true,

    },

    {
      name:
        "CANDLE",

      value:
        formatSignalTime(
          signal.timestamp
        ),

      inline:
        true,

    },

    {
      name:
        "STANDARD DEVIATION",

      value:
        formatStandardDeviation(
          standardDeviation
        ),

      inline:
        true,

    },

    {
      name:
        "STRUCTURE",

      value:
        structure,

      inline:
        true,

    },

  ];

  // ----------------------------------------------------------
  // 5M TOP-DOWN FIELD
  // ----------------------------------------------------------

  if (
    timeframe ===
    "5m" &&
    topDown?.confirmed
  ) {

    fields.push({

      name:
        "TOP-DOWN",

      value:
        formatTopDown(
          topDown
        ),

      inline:
        false,

    });

  }

  const embed =
    new EmbedBuilder()

      .setTitle(
        "CRT SIGNAL"
      )

      .setDescription(
        coin
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

  return embed;

}


// ============================================================
// SEND CRT SIGNAL
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
      `[CRT] SIGNAL SENT | ` +
      `${data.symbol} | ` +
      `${data.timeframe} | ` +
      `${data.signal.type} | ` +
      `RSI ${data.rsiState} | ` +
      `STD ${getVolatilityState(
        data.standardDeviation
      )} | ` +
      `STRUCTURE ${
        data.marketStructure?.bias ||
        "BEARISH"
      }`
    );

  } catch (
    error
  ) {

    console.error(
      "[CRT] Discord signal error:",
      error
    );

  }

}


// ============================================================
// CONCURRENCY
// ============================================================

async function runWithConcurrency(
  items,
  concurrency,
  worker
) {

  if (
    !items.length
  ) {

    return;

  }

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

  const workerCount =
    Math.min(
      concurrency,
      items.length
    );

  await Promise.all(

    Array.from(
      {
        length:
          workerCount,
      },
      runner
    )

  );

}


// ============================================================
// SCAN MEXC
// ============================================================

async function scanMexc(
  client
) {

  if (
    Date.now() <
    mexcBlockedUntil
  ) {

    return;

  }

  let symbols;

  try {

    symbols =
      await getMexcFuturesSymbols();

  } catch (
    error
  ) {

    console.error(
      "[CRT] MEXC Futures symbol scan failed:",
      error.message
    );

    return;

  }

  if (
    !symbols.length
  ) {

    console.warn(
      "[CRT] No MEXC Futures symbols found."
    );

    return;

  }

  console.log(
    `[CRT] Scanning ${symbols.length} MEXC Futures contracts.`
  );

  for (
    const timeframe of
    Object.keys(
      TIMEFRAMES
    )
  ) {

    if (
      Date.now() <
      mexcBlockedUntil
    ) {

      break;

    }

    const jobs =
      symbols.map(
        (
          symbol
        ) => ({

          symbol,

          timeframe,

        })
      );

    await runWithConcurrency(

      jobs,

      MEXC_CONCURRENCY,

      async (
        job
      ) => {

        if (
          Date.now() <
          mexcBlockedUntil
        ) {

          return;

        }

        try {

          const candles =
            await fetchMexcCandles(
              job.symbol,
              job.timeframe
            );

          if (
            candles.length <
            20
          ) {

            return;

          }

          // --------------------------------------------------
          // 5M TOP-DOWN
          // --------------------------------------------------

          if (
            job.timeframe ===
            "5m"
          ) {

            await processFiveMinuteMarket(
              client,
              job.symbol,
              candles
            );

            return;

          }

          // --------------------------------------------------
          // STANDARD TIMEFRAMES
          // --------------------------------------------------

          await processStandardMarket(

            client,

            job.symbol,

            job.timeframe,

            candles

          );

        } catch (
          error
        ) {

          console.error(

            `[CRT] MEXC ${job.symbol} ${job.timeframe}: ${error.message}`

          );

        }

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
    "[CRT] Starting full MEXC market scan..."
  );

  await scanMexc(
    client
  );

  console.log(
    "[CRT] Full MEXC market scan completed."
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
    "[CRT] CRT SIGNAL MONITOR STARTED"
  );

  console.log(
    `[CRT] MEXC Futures API: ${MEXC_BASE_URL}`
  );

  console.log(
    "[CRT] MEXC: ENABLED"
  );

  console.log(
    "[CRT] OANDA: DISABLED"
  );

  console.log(
    "[CRT] MEXC Spot: DISABLED"
  );

  console.log(
    `[CRT] Timeframes: ${Object.keys(
      TIMEFRAMES
    ).join(", ")}`
  );

  console.log(
    "[CRT] 30m: REMOVED"
  );

  console.log(
    "[CRT] 5m: TOP-DOWN ANALYSIS"
  );

  console.log(
    `[CRT] 5m Channel: ${CHANNELS["5m"]}`
  );

  console.log(
    "[CRT] 5m Higher TF Confirmation: 1D / 4H / 1H / 15M"
  );

  console.log(
    "[CRT] Rachel T Filtered Top: ON"
  );

  console.log(
    "[CRT] Rachel T Filtered Bottom: ON"
  );

  console.log(
    `[CRT] RSI Period: ${RSI_PERIOD}`
  );

  console.log(
    `[CRT] RSI Overbought: ${RSI_OVERBOUGHT}`
  );

  console.log(
    `[CRT] RSI Oversold: ${RSI_OVERSOLD}`
  );

  console.log(
    `[CRT] Standard Deviation Period: ${STDDEV_PERIOD}`
  );

  console.log(
    `[CRT] Market Structure Lookback: ${STRUCTURE_LOOKBACK}`
  );

  console.log(
    `[CRT] Market Structure Swing Length: ${STRUCTURE_SWING_LENGTH}`
  );

  console.log(
    "[CRT] Structure Output: BULLISH / BEARISH"
  );

  console.log(
    "============================================================"
  );


  // ----------------------------------------------------------
  // INITIAL BASELINE
  // ----------------------------------------------------------

  runFullScan(
    client
  ).catch(
    (
      error
    ) => {

      console.error(
        "[CRT] Initial scan failed:",
        error
      );

    }
  );


  // ----------------------------------------------------------
  // CONTINUOUS SCAN
  // ----------------------------------------------------------

  monitorTimer =
    setInterval(

      () => {

        runFullScan(
          client
        ).catch(
          (
            error
          ) => {

            console.error(
              "[CRT] Full scan error:",
              error
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

  console.log(
    "[CRT] Monitor stopped."
  );

}


// ============================================================
// ALL CRT STATUS
// ============================================================

export function getAllCRTStatuses() {

  const statuses =
    {};

  for (
    const timeframe of
    Object.keys(
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

  return findLastFilteredFractal(
    candles
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
    findLastFilteredFractal(
      candles
    );

  const rsi =
    calculateRSI(
      candles,
      RSI_PERIOD
    );

  const standardDeviation =
    calculateStandardDeviation(
      candles,
      STDDEV_PERIOD
    );

  const marketStructure =
    calculateMarketStructure(
      candles
    );

  return {

    fractal,

    rsi,

    rsiState:
      getRSIState(
        rsi
      ),

    standardDeviation,

    marketStructure,

    structure:
      formatMarketStructure(
        marketStructure
      ),

  };

}


// ============================================================
// TEST TOP-DOWN ANALYSIS
// ============================================================

export async function testTopDownAnalysis(
  symbol,
  fiveMinuteSignal = null
) {

  if (
    !symbol
  ) {

    return {

      confirmed:
        false,

      direction:
        null,

      confirmations:
        {},

      reason:
        "Symbol is required",

    };

  }

  return performTopDownAnalysis(
    normalizeMexcSymbol(
      symbol
    ),
    fiveMinuteSignal
  );

}


// ============================================================
// SERVICE INFO
// ============================================================

export function getCRTServiceInfo() {

  return {

    cryptoProvider:
      "MEXC FUTURES",

    forexProvider:
      null,

    oanda:
      false,

    mexcApi:
      MEXC_BASE_URL,

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

    fiveMinuteChannel:
      CHANNELS["5m"],

    fiveMinuteMode:
      "TOP-DOWN",

    topDownTimeframes:
      TOP_DOWN_TIMEFRAMES,

    filterBW:
      FILTER_BW,

    filteredTop:
      FILTERED_TOP_ENABLED,

    filteredBottom:
      FILTERED_BOTTOM_ENABLED,

    rsiPeriod:
      RSI_PERIOD,

    rsiOverbought:
      RSI_OVERBOUGHT,

    rsiOversold:
      RSI_OVERSOLD,

    standardDeviationPeriod:
      STDDEV_PERIOD,

    standardDeviationHighMultiplier:
      STDDEV_HIGH_MULTIPLIER,

    standardDeviationLowMultiplier:
      STDDEV_LOW_MULTIPLIER,

    marketStructureLookback:
      STRUCTURE_LOOKBACK,

    marketStructureSwingLength:
      STRUCTURE_SWING_LENGTH,

    structureOutput:
      "BULLISH / BEARISH",

    timezone:
      CRT_TIMEZONE,

    checkInterval:
      CHECK_INTERVAL,

  };

}


// ============================================================
// STARTUP
// ============================================================

console.log(
  "[CRT] Signal service loaded."
);

console.log(
  "[CRT] MEXC Futures only."
);

console.log(
  `[CRT] MEXC API: ${MEXC_BASE_URL}`
);

console.log(
  "[CRT] OANDA disabled."
);

console.log(
  "[CRT] MEXC Spot disabled."
);

console.log(
  "[CRT] 30m timeframe removed."
);

console.log(
  "[CRT] 5m timeframe enabled."
);

console.log(
  `[CRT] 5m Discord Channel: ${CHANNELS["5m"]}`
);

console.log(
  "[CRT] 5m Top-Down: 1D -> 4H -> 1H -> 15M -> 5M."
);

console.log(
  "[CRT] 5m requires ALL higher timeframes to confirm."
);

console.log(
  "[CRT] Rachel T Filtered Top enabled."
);

console.log(
  "[CRT] Rachel T Filtered Bottom enabled."
);

console.log(
  "[CRT] Structure output: BULLISH / BEARISH."
);
