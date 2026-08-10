import { EmbedBuilder } from "discord.js";
import botConfig from "../../config/bot.js";

// ============================================================
// PDYN CRT SIGNAL SERVICE
// ============================================================
//
// SOURCE:
//   MEXC FUTURES ONLY
//
// SPECIAL:
//   XAUUSDT.P is supported through MEXC Futures.
//
// SIGNAL PRIORITY:
//   Rachel T Fractals
//
// FILTERED TOP:
//   CRT SELL
//
// FILTERED BOTTOM:
//   CRT BUY
//
// RSI:
//   INFORMATION ONLY
//   Does NOT filter CRT
//
// RSI OUTPUT:
//   OVERBOUGHT
//   OVERSOLD
//   NEUTRAL
//
// OUTPUT:
//   MEXC
//   TIMEFRAME
//   CRT
//   RSI
//   VOLUME
//   CANDLE
//
// TIMEZONE:
//   Asia/Manila
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

const TIMEFRAMES =
  CRT_CONFIG.timeframes || {
    "5m": 5,
    "15m": 15,
    "30m": 30,
    "1h": 60,
    "4h": 240,
    "1d": 1440,
  };


// ============================================================
// DISCORD CHANNELS
// ============================================================

const CHANNELS =
  CRT_CONFIG.channels || {};


// ============================================================
// MEXC FUTURES API
// ============================================================

const MEXC_BASE_URL =
  (
    process.env.MEXC_FUTURES_API_URL ||
    CRT_CONFIG.mexc?.api ||
    "https://api.mexc.com"
  ).replace(/\/+$/, "");


// ============================================================
// MEXC SPECIAL SYMBOL
// ============================================================
//
// The Discord display name:
//
//   XAUUSDT.P
//
// The MEXC Futures API symbol may be:
//
//   XAU_USDT
//
// Therefore the API symbol and display symbol
// are handled separately.
//
// ============================================================

const SPECIAL_MEXC_SYMBOLS = {
  XAUUSDT: "XAUUSDT.P",
  XAU_USDT: "XAUUSDT.P",
};


// ============================================================
// RSI
// ============================================================

const RSI_PERIOD =
  Number(
    CRT_CONFIG.rsi?.period
  ) || 14;


const RSI_OVERBOUGHT =
  Number(
    CRT_CONFIG.rsi?.overbought
  ) || 70;


const RSI_OVERSOLD =
  Number(
    CRT_CONFIG.rsi?.oversold
  ) || 30;


// ============================================================
// RACHEL T FILTER SETTINGS
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
  10 * 60 * 1000;


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
  60 * 1000;


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
      data = null;
    }

    if (!response.ok) {
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
    clearTimeout(timeout);
  }
}


// ============================================================
// MEXC INTERVAL
// ============================================================

function getMexcInterval(
  timeframe
) {
  const intervals = {
    "5m": "Min5",
    "15m": "Min15",
    "30m": "Min30",
    "1h": "Min60",
    "4h": "Hour4",
    "1d": "Day1",
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
  if (!timeframe) {
    return false;
  }

  return Object.prototype.hasOwnProperty.call(
    TIMEFRAMES,
    String(timeframe).toLowerCase()
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
// DATE FORMAT
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
// TIME FORMAT
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
// TIME FORMAT WITH SECONDS
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
    ) % 24;

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
    symbol || ""
  )
    .trim()
    .toUpperCase();
}


// ============================================================
// DISPLAY SYMBOL
// ============================================================

function getDisplaySymbol(
  symbol
) {
  const normalized =
    normalizeMexcSymbol(
      symbol
    );

  if (
    SPECIAL_MEXC_SYMBOLS[
      normalized
    ]
  ) {
    return SPECIAL_MEXC_SYMBOLS[
      normalized
    ];
  }

  return normalized;
}


// ============================================================
// API SYMBOL
// ============================================================

function getApiSymbol(
  symbol
) {
  const normalized =
    normalizeMexcSymbol(
      symbol
    );

  if (
    normalized ===
    "XAUUSDT.P"
  ) {
    return "XAU_USDT";
  }

  if (
    normalized ===
    "XAUUSDT"
  ) {
    return "XAU_USDT";
  }

  return normalized;
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
    console.warn(
      "[CRT] MEXC temporarily paused."
    );

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
          contract => {
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
          contract =>
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

      console.error(
        `[CRT] MEXC access denied (${error.status}).`
      );
    }

    throw error;
  }
}


// ============================================================
// MEXC CANDLES
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

  const apiSymbol =
    getApiSymbol(
      symbol
    );

  if (!apiSymbol) {
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
      apiSymbol
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

      console.error(
        `[CRT] MEXC access denied for ${apiSymbol}.`
      );

      return [];
    }

    if (
      error.status ===
      429
    ) {
      mexcBlockedUntil =
        Date.now() +
        30000;

      console.warn(
        "[CRT] MEXC rate limited."
      );

      return [];
    }

    throw error;
  }
}


// ============================================================
// PARSE MEXC KLINE
// ============================================================

function parseMexcKlineResponse(
  response
) {
  const data =
    response?.data;

  if (!data) {
    return [];
  }

  // ----------------------------------------------------------
  // OBJECT FORMAT
  // ----------------------------------------------------------

  if (
    !Array.isArray(data) &&
    Array.isArray(data.time)
  ) {
    const candles =
      [];

    for (
      let i = 0;
      i < data.time.length;
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
      (a, b) =>
        a.timestamp -
        b.timestamp
    );
  }


  // ----------------------------------------------------------
  // ARRAY FORMAT
  // ----------------------------------------------------------

  if (
    Array.isArray(data)
  ) {
    return data
      .map(
        row => {
          if (
            Array.isArray(row)
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
        (a, b) =>
          a.timestamp -
          b.timestamp
      );
  }

  return [];
}


// ============================================================
// NORMALIZE TIMESTAMP
// ============================================================

function normalizeTimestamp(
  value
) {
  const number =
    Number(value);

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
      candle =>
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
    i < closes.length;
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
// RACHEL T TOP FRACTAL
// ============================================================
//
// isBWFractal(1)
//
// high[4] < high[2]
// high[3] <= high[2]
// high[2] >= high[1]
// high[2] > high[0]
//
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
//
// isBWFractal(-1)
//
// low[4] > low[2]
// low[3] >= low[2]
// low[2] <= low[1]
// low[2] < low[0]
//
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
    index >= 4;
    index--
  ) {
    const fractalIndex =
      index - 2;

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
    index >= 4;
    index--
  ) {
    const fractalIndex =
      index - 2;

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

  const rsi =
    calculateRSI(
      candles,
      RSI_PERIOD
    );

  const rsiState =
    getRSIState(
      rsi
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

  if (!signal) {
    return;
  }


  // ==========================================================
  // STARTUP BASELINE
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
      `[CRT] Baseline | MEXC | ${symbol} | ${timeframe} | ${signal.fractalType} | ${formatSignalTime(signal.timestamp)}`
    );

    return;
  }


  // ==========================================================
  // DUPLICATE PROTECTION
  // ==========================================================

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


  // ==========================================================
  // SAVE BEFORE SEND
  // ==========================================================

  signalState.set(
    stateKey,
    signal.timestamp
  );


  // ==========================================================
  // SEND
  // ==========================================================

  await sendCRTSignal(
    client,
    {
      symbol,
      timeframe,
      signal,
      rsi,
      rsiState,
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
    Math.abs(price) >=
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
    Math.abs(price) >=
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

  if (
    Math.abs(volume) >=
    1_000_000_000
  ) {
    return (
      (
        volume /
        1_000_000_000
      ).toFixed(2) +
      "B"
    );
  }

  if (
    Math.abs(volume) >=
    1_000_000
  ) {
    return (
      (
        volume /
        1_000_000
      ).toFixed(2) +
      "M"
    );
  }

  if (
    Math.abs(volume) >=
    1_000
  ) {
    return (
      (
        volume /
        1_000
      ).toFixed(2) +
      "K"
    );
  }

  return volume.toLocaleString(
    "en-US",
    {
      maximumFractionDigits:
        2,
    }
  );
}


// ============================================================
// FORMAT SIGNAL TIME
// ============================================================
//
// IMPORTANT:
//
// This uses the ACTUAL MEXC candle timestamp.
//
// It does NOT use the current Discord/Railway time.
//
// Example:
//
// Signal detected at 08:38
// Fractal candle = 08:25
//
// Output:
//
// CANDLE: 08:25
//
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
    rsiState,
  } =
    data;

  const isBuy =
    signal.type ===
    "BUY";

  const title =
    isBuy
      ? "🟢 CRT SIGNAL"
      : "🔴 CRT SIGNAL";

  const color =
    isBuy
      ? (
          CRT_CONFIG.colors
            ?.buy ||
          "#57F287"
        )
      : (
          CRT_CONFIG.colors
            ?.sell ||
          "#ED4245"
        );

  const displaySymbol =
    getDisplaySymbol(
      symbol
    );

  return new EmbedBuilder()

    .setTitle(
      title
    )

    // ONLY THE COIN IS BOLD
    .setDescription(
      `**${displaySymbol}**`
    )

    .addFields(

      {
        name:
          "SOURCE",

        value:
          "`MEXC`",

        inline:
          true,
      },

      {
        name:
          "TIMEFRAME",

        value:
          `\`${timeframe.toUpperCase()}\``,

        inline:
          true,
      },

      {
        name:
          "CRT",

        value:
          `\`${signal.type}\``,

        inline:
          true,
      },

      {
        name:
          "RSI",

        value:
          `\`${rsiState}\``,

        inline:
          true,
      },

      {
        name:
          "VOLUME",

        value:
          `\`${formatVolume(
            signal.volume
          )}\``,

        inline:
          true,
      },

      {
        name:
          "CANDLE",

        value:
          `\`${formatSignalTime(
            signal.timestamp
          )}\``,

        inline:
          true,
      }

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
      `MEXC | ` +
      `${data.symbol} | ` +
      `${data.timeframe} | ` +
      `CRT ${data.signal.type} | ` +
      `CANDLE ${formatSignalTime(
        data.signal.timestamp
      )} | ` +
      `VOLUME ${formatVolume(
        data.signal.volume
      )} | ` +
      `RSI ${data.rsiState}`
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
          items[index]
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


  // ==========================================================
  // FORCE XAUUSDT.P
  // ==========================================================

  const xauApiSymbol =
    "XAU_USDT";

  if (
    !symbols.includes(
      xauApiSymbol
    )
  ) {
    symbols.push(
      xauApiSymbol
    );
  }


  // ==========================================================
  // REMOVE DUPLICATES
  // ==========================================================

  symbols =
    [
      ...new Set(
        symbols
      ),
    ];


  console.log(
    `[CRT] Scanning ${symbols.length} MEXC Futures contracts.`
  );


  // ==========================================================
  // TIMEFRAMES
  // ==========================================================

  for (
    const timeframe
    of Object.keys(
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
        symbol => ({
          symbol,
          timeframe,
        })
      );

    await runWithConcurrency(
      jobs,
      MEXC_CONCURRENCY,
      async job => {
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

          await processMarket(
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
    "[CRT] Starting MEXC market scan..."
  );

  await scanMexc(
    client
  );

  console.log(
    "[CRT] MEXC market scan completed."
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
    `[CRT] SOURCE: MEXC FUTURES ONLY`
  );

  console.log(
    `[CRT] MEXC API: ${MEXC_BASE_URL}`
  );

  console.log(
    `[CRT] TIMEZONE: ${CRT_TIMEZONE}`
  );

  console.log(
    `[CRT] TIMEFRAMES: ${Object.keys(
      TIMEFRAMES
    ).join(", ")}`
  );

  console.log(
    "[CRT] Rachel T Filtered Top: ON"
  );

  console.log(
    "[CRT] Rachel T Filtered Bottom: ON"
  );

  console.log(
    "[CRT] RSI: INFORMATION ONLY"
  );

  console.log(
    "[CRT] OANDA: DISABLED"
  );

  console.log(
    "[CRT] XAUUSDT.P: ENABLED"
  );

  console.log(
    "============================================================"
  );


  // ==========================================================
  // INITIAL SCAN
  // ==========================================================

  runFullScan(
    client
  ).catch(
    error => {
      console.error(
        "[CRT] Initial scan failed:",
        error
      );
    }
  );


  // ==========================================================
  // CONTINUOUS SCAN
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
// SERVICE INFO
// ============================================================

export function getCRTServiceInfo() {
  return {
    cryptoProvider:
      "MEXC FUTURES",

    forexProvider:
      null,

    source:
      "MEXC",

    mexcApi:
      MEXC_BASE_URL,

    spot:
      false,

    oanda:
      false,

    xauusdtp:
      true,

    timeframes:
      Object.keys(
        TIMEFRAMES
      ),

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
  "[CRT] Source: MEXC Futures ONLY."
);

console.log(
  "[CRT] OANDA disabled."
);

console.log(
  "[CRT] MEXC Spot disabled."
);

console.log(
  "[CRT] XAUUSDT.P enabled."
);

console.log(
  "[CRT] Rachel T Filtered Top enabled."
);

console.log(
  "[CRT] Rachel T Filtered Bottom enabled."
);

console.log(
  "[CRT] RSI is informational only."
);