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
// STANDARD SIGNAL TIMEFRAMES:
//   15m
//   1h
//   4h
//   1d
//
// SPECIAL TOP-DOWN TIMEFRAME:
//   5m
//
// 5M TOP-DOWN:
//
//   1D
//   4H
//   1H
//   5M
//
// IMPORTANT:
//
//   1D / 4H / 1H use the MOST RECENT CONFIRMED
//   Rachel T fractal.
//
//   They do NOT require a brand-new CRT on the
//   current candle.
//
//   The 5M signal is ALWAYS DISPLAYED.
//
//   Top-down confirmation is informational:
//
//     0/4
//     1/4
//     2/4
//     3/4
//     4/4
//
//   2/4 is NOT a filter.
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
// 30m intentionally removed.
//
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
//
// 5M top-down count:
//
//   1D
//   4H
//   1H
//   5M
//
// 15M is NOT part of the 5M top-down calculation.
//
// ============================================================

const TOP_DOWN_TIMEFRAMES = [

  "1d",

  "4h",

  "1h",

  "5m",

];


// ============================================================
// DISCORD CHANNELS
// ============================================================

const CHANNELS =
  CRT_CONFIG.channels || {};


// ============================================================
// 5M CHANNEL
// ============================================================

const FIVE_MINUTE_CHANNEL_ID =
  "1536311840378986547";


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

const startupBaseline =
  new Set();


// ============================================================
// TOP-DOWN STATE
// ============================================================
//
// Stores the most recently confirmed Rachel T CRT.
//
// Example:
//
// BTC_USDT
//   1d -> BUY
//   4h -> BUY
//   1h -> SELL
//
// This allows the 5M output to read historical HTF CRT data.
//
// ============================================================

const topDownCRTState =
  new Map();


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

            ...(options.headers ||
              {}),

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
          ? JSON.parse(
              text
            )
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
            text.slice(
              0,
              250
            )
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
    intervals[
      timeframe
    ] ||
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

    pad(
      hours
    ),

    pad(
      minutes
    ),

    pad(
      seconds
    ),

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

    return number *
      1000;

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
            data.open?.[
              i
            ]
          ),

        high:
          Number(
            data.high?.[
              i
            ]
          ),

        low:
          Number(
            data.low?.[
              i
            ]
          ),

        close:
          Number(
            data.close?.[
              i
            ]
          ),

        volume:
          Number(
            data.vol?.[
              i
            ] ||
            data.volume?.[
              i
            ] ||
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
        ]?.close
      );

    const current =
      Number(
        candles[
          i
        ]?.close
      );

    if (
      !Number.isFinite(
        previous
      ) ||
      !Number.isFinite(
        current
      ) ||
      previous ===
        0
    ) {

      continue;

    }

    returns.push(
      (
        (
          current -
          previous
        ) /
        previous
      ) *
      100
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

  return Math.sqrt(
    variance
  );

}


// ============================================================
// STANDARD DEVIATION CONTEXT
// ============================================================

function calculateStdDevContext(
  candles
) {

  const current =
    calculateStandardDeviation(
      candles,
      STDDEV_PERIOD
    );

  if (
    !Number.isFinite(
      current
    )
  ) {

    return {

      value:
        null,

      state:
        "N/A",

      baseline:
        null,

    };

  }

  const historical =
    [];

  const start =
    Math.max(
      STDDEV_PERIOD + 1,
      candles.length -
        (
          STDDEV_PERIOD *
          5
        )
    );

  for (
    let end = start;
    end <
    candles.length;
    end++
  ) {

    const section =
      candles.slice(
        0,
        end
      );

    const value =
      calculateStandardDeviation(
        section,
        STDDEV_PERIOD
      );

    if (
      Number.isFinite(
        value
      )
    ) {

      historical.push(
        value
      );

    }

  }

  let baseline =
    historical.length
      ? historical.reduce(
          (
            sum,
            value
          ) =>
            sum +
            value,
          0
        ) /
        historical.length
      : current;

  if (
    !Number.isFinite(
      baseline
    ) ||
    baseline <=
      0
  ) {

    baseline =
      current;

  }

  let state =
    "NORMAL";

  if (
    current >=
    baseline *
      STDDEV_HIGH_MULTIPLIER
  ) {

    state =
      "HIGH";

  } else if (
    current <=
    baseline *
      STDDEV_LOW_MULTIPLIER
  ) {

    state =
      "LOW";

  }

  return {

    value:
      current,

    state,

    baseline,

  };

}


// ============================================================
// RACHEL T TOP
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
// RACHEL T BOTTOM
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
// FRACTAL OBJECT
// ============================================================

function createFractal(
  candle,
  fractalIndex,
  type,
  fractalType
) {

  return {

    type,

    fractalType,

    index:
      fractalIndex,

    timestamp:
      candle.timestamp,

    price:
      candle.close,

    fractalPrice:
      type ===
      "BUY"
        ? candle.low
        : candle.high,

    volume:
      Number(
        candle.volume ||
        0
      ),

  };

}


// ============================================================
// FIND LATEST CONFIRMED RACHEL T FRACTAL
// ============================================================
//
// IMPORTANT:
//
// The fractal candle is TWO candles behind the latest candle.
//
// Therefore this function returns the latest HISTORICALLY
// CONFIRMED Rachel T fractal.
//
// This is what 1D / 4H / 1H use for top-down data.
//
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

      return createFractal(
        candle,
        fractalIndex,
        "SELL",
        "TOP"
      );

    }

    if (
      FILTERED_BOTTOM_ENABLED &&
      isFilteredBottom(
        candles,
        index
      )
    ) {

      return createFractal(
        candle,
        fractalIndex,
        "BUY",
        "BOTTOM"
      );

    }

  }

  return null;

}


// ============================================================
// FIND NEW FRACTAL AFTER TIMESTAMP
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

      return createFractal(
        candle,
        fractalIndex,
        "SELL",
        "TOP"
      );

    }

    if (
      FILTERED_BOTTOM_ENABLED &&
      isFilteredBottom(
        candles,
        index
      )
    ) {

      return createFractal(
        candle,
        fractalIndex,
        "BUY",
        "BOTTOM"
      );

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
        "UNKNOWN",

      bias:
        "NEUTRAL",

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

  if (
    highs.length <
      2 ||
    lows.length <
      2
  ) {

    return {

      state:
        "UNKNOWN",

      bias:
        "NEUTRAL",

      lastHigh:
        highs.at(-1) ||
        null,

      previousHigh:
        highs.at(-2) ||
        null,

      lastLow:
        lows.at(-1) ||
        null,

      previousLow:
        lows.at(-2) ||
        null,

    };

  }

  const lastHigh =
    highs.at(-1);

  const previousHigh =
    highs.at(-2);

  const lastLow =
    lows.at(-1);

  const previousLow =
    lows.at(-2);

  const higherHigh =
    lastHigh.price >
    previousHigh.price;

  const lowerHigh =
    lastHigh.price <
    previousHigh.price;

  const higherLow =
    lastLow.price >
    previousLow.price;

  const lowerLow =
    lastLow.price <
    previousLow.price;

  let state =
    "RANGE";

  let bias =
    "NEUTRAL";

  if (
    higherHigh &&
    higherLow
  ) {

    state =
      "HH / HL";

    bias =
      "BULLISH";

  } else if (
    lowerHigh &&
    lowerLow
  ) {

    state =
      "LH / LL";

    bias =
      "BEARISH";

  } else if (
    higherHigh
  ) {

    state =
      "HH";

    bias =
      "BULLISH";

  } else if (
    lowerLow
  ) {

    state =
      "LL";

    bias =
      "BEARISH";

  } else if (
    lowerHigh
  ) {

    state =
      "LH";

    bias =
      "BEARISH";

  } else if (
    higherLow
  ) {

    state =
      "HL";

    bias =
      "BULLISH";

  }

  return {

    state,

    bias,

    higherHigh,

    lowerHigh,

    higherLow,

    lowerLow,

    lastHigh,

    previousHigh,

    lastLow,

    previousLow,

  };

}


// ============================================================
// STRUCTURE CONFIRMATION
// ============================================================

function getStructureConfirmation(
  signalType,
  structure
) {

  if (
    !structure
  ) {

    return "NEUTRAL";

  }

  if (
    signalType ===
      "BUY" &&
    structure.bias ===
      "BULLISH"
  ) {

    return "CONFIRMED";

  }

  if (
    signalType ===
      "SELL" &&
    structure.bias ===
      "BEARISH"
  ) {

    return "CONFIRMED";

  }

  if (
    signalType ===
      "BUY" &&
    structure.bias ===
      "BEARISH"
  ) {

    return "CONFLICT";

  }

  if (
    signalType ===
      "SELL" &&
    structure.bias ===
      "BULLISH"
  ) {

    return "CONFLICT";

  }

  return "NEUTRAL";

}


// ============================================================
// VOLATILITY CONFIRMATION
// ============================================================

function getVolatilityConfirmation(
  stddev
) {

  if (
    !stddev ||
    !Number.isFinite(
      stddev.value
    )
  ) {

    return "NEUTRAL";

  }

  if (
    stddev.state ===
    "HIGH"
  ) {

    return "EXPANSION";

  }

  if (
    stddev.state ===
    "LOW"
  ) {

    return "COMPRESSION";

  }

  return "NORMAL";

}


// ============================================================
// MARKET ANALYSIS
// ============================================================

function analyzeMarket(
  candles,
  signal
) {

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
    calculateStdDevContext(
      candles
    );

  const marketStructure =
    calculateMarketStructure(
      candles
    );

  const structureConfirmation =
    getStructureConfirmation(
      signal.type,
      marketStructure
    );

  const volatilityConfirmation =
    getVolatilityConfirmation(
      standardDeviation
    );

  return {

    rsi,

    rsiState,

    standardDeviation,

    marketStructure,

    structureConfirmation,

    volatilityConfirmation,

  };

}


// ============================================================
// TOP-DOWN STATE UPDATE
// ============================================================
//
// This function stores the latest confirmed Rachel T fractal.
//
// It is called for 1D, 4H and 1H.
//
// ============================================================

function updateTopDownCRTState(
  symbol,
  timeframe,
  signal
) {

  if (
    !TOP_DOWN_TIMEFRAMES.includes(
      timeframe
    )
  ) {

    return;

  }

  if (
    !signal ||
    !signal.type
  ) {

    return;

  }

  const symbolKey =
    normalizeMexcSymbol(
      symbol
    );

  if (
    !symbolKey
  ) {

    return;

  }

  let state =
    topDownCRTState.get(
      symbolKey
    );

  if (
    !state
  ) {

    state =
      new Map();

    topDownCRTState.set(
      symbolKey,
      state
    );

  }

  state.set(
    timeframe,
    {

      type:
        signal.type,

      fractalType:
        signal.fractalType,

      timestamp:
        signal.timestamp,

      price:
        signal.price,

      fractalPrice:
        signal.fractalPrice,

    }
  );

}


// ============================================================
// GET LATEST HTF CRT DIRECTLY FROM CANDLES
// ============================================================
//
// This is the important historical lookup.
//
// Even if there is no NEW CRT on the current 1D / 4H / 1H
// candle, the function searches the candle history and returns
// the latest confirmed Rachel T fractal.
//
// ============================================================

function getLatestConfirmedCRTFromCandles(
  candles
) {

  const signal =
    findLastFilteredFractal(
      candles
    );

  if (
    !signal
  ) {

    return {

      confirmed:
        false,

      type:
        null,

      timestamp:
        null,

      fractalType:
        null,

    };

  }

  return {

    confirmed:
      true,

    type:
      signal.type,

    timestamp:
      signal.timestamp,

    fractalType:
      signal.fractalType,

    price:
      signal.price,

    fractalPrice:
      signal.fractalPrice,

  };

}


// ============================================================
// BUILD 5M TOP-DOWN DATA
// ============================================================
//
// The 5M signal is always the trigger.
//
// HTF:
//
//   1D
//   4H
//   1H
//
// Current:
//
//   5M
//
// Count:
//
//   confirmed / 4
//
// No filtering.
//
// ============================================================

function buildTopDownAnalysis(
  symbol,
  lowerTimeframeSignal,
  htfCandles
) {

  const states =
    {};

  let confirmedCount =
    0;

  for (
    const timeframe of
      [
        "1d",
        "4h",
        "1h",
      ]
  ) {

    const candles =
      htfCandles[
        timeframe
      ];

    const latest =
      Array.isArray(
        candles
      ) &&
      candles.length >=
        5
        ? getLatestConfirmedCRTFromCandles(
            candles
          )
        : {
            confirmed:
              false,

            type:
              null,

            timestamp:
              null,

            fractalType:
              null,
          };

    states[
      timeframe
    ] = latest;

    if (
      latest.confirmed
    ) {

      confirmedCount++;

    }

    if (
      latest.confirmed
    ) {

      updateTopDownCRTState(
        symbol,
        timeframe,
        latest
      );

    }

  }

  const fiveMinute =
    lowerTimeframeSignal
      ? {

          confirmed:
            true,

          type:
            lowerTimeframeSignal.type,

          timestamp:
            lowerTimeframeSignal.timestamp,

          fractalType:
            lowerTimeframeSignal.fractalType,

          price:
            lowerTimeframeSignal.price,

          fractalPrice:
            lowerTimeframeSignal.fractalPrice,

        }
      : {

          confirmed:
            false,

          type:
            null,

          timestamp:
            null,

          fractalType:
            null,

        };

  states["5m"] =
    fiveMinute;

  if (
    fiveMinute.confirmed
  ) {

    confirmedCount++;

  }

  const direction =
    lowerTimeframeSignal?.type ||
    null;

  return {

    confirmedCount,

    total:
      4,

    ratio:
      `${confirmedCount}/4`,

    confirmed:
      confirmedCount >=
      2,

    direction,

    states,

  };

}


// ============================================================
// VOLUME FORMAT
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
    absolute >=
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
    absolute >=
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

  return volume.toFixed(
    2
  );

}


// ============================================================
// RSI DISPLAY
// ============================================================

function formatRSI(
  rsi
) {

  if (
    !Number.isFinite(
      rsi
    )
  ) {

    return "N/A";

  }

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
// STANDARD DEVIATION DISPLAY
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

  return (
    standardDeviation.state
  );

}


// ============================================================
// MARKET STRUCTURE DISPLAY
// ============================================================

function formatMarketStructure(
  structure
) {

  if (
    !structure
  ) {

    return "UNKNOWN";

  }

  if (
    structure.bias ===
    "BULLISH"
  ) {

    return "BULLISH";

  }

  if (
    structure.bias ===
    "BEARISH"
  ) {

    return "BEARISH";

  }

  return "NEUTRAL";

}


// ============================================================
// SIGNAL TIME
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
// TOP-DOWN STATUS FORMAT
// ============================================================

function formatTopDownStatus(
  topDown
) {

  if (
    !topDown
  ) {

    return "0/4 CONFIRMED";

  }

  return (
    `${topDown.confirmedCount}/` +
    `${topDown.total} CONFIRMED`
  );

}


// ============================================================
// TOP-DOWN TIMEFRAME FORMAT
// ============================================================

function formatTopDownTimeframes(
  topDown
) {

  if (
    !topDown
  ) {

    return (
      "1D NOT CONFIRMED • " +
      "4H NOT CONFIRMED • " +
      "1H NOT CONFIRMED • " +
      "5M NOT CONFIRMED"
    );

  }

  return [
    "1d",
    "4h",
    "1h",
    "5m",
  ]
    .map(
      (
        timeframe
      ) => {

        const item =
          topDown.states?.[
            timeframe
          ];

        if (
          item?.confirmed
        ) {

          return (
            `${timeframe.toUpperCase()} ` +
            `${item.type}`
          );

        }

        return (
          `${timeframe.toUpperCase()} ` +
          "NOT CONFIRMED"
        );

      }
    )
    .join(
      " • "
    );

}


// ============================================================
// CREATE SIGNAL EMBED
// ============================================================

function createSignalEmbed(
  data
) {

  const {

    symbol,

    timeframe,

    signal,

    analysis,

    topDown,

  } =
    data;

  const isBuy =
    signal.type ===
    "BUY";

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

  // ONLY COIN IS BOLD
  const coin =
    `**${symbol}**`;

  // ONLY VOLUME IS BOLD
  const volume =
    `**${formatVolume(
      signal.volume
    )}**`;

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
          analysis.rsi
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
          analysis.standardDeviation
        ),

      inline:
        true,

    },

    {

      name:
        "MARKET STRUCTURE",

      value:
        formatMarketStructure(
          analysis.marketStructure
        ),

      inline:
        true,

    },

    {

      name:
        "STRUCTURE",

      value:
        analysis.structureConfirmation,

      inline:
        true,

    },

  ];


  // ----------------------------------------------------------
  // 5M TOP-DOWN INFORMATION
  // ----------------------------------------------------------

  if (
    timeframe ===
    "5m"
  ) {

    fields.push(

      {

        name:
          "TOP-DOWN",

        value:
          formatTopDownStatus(
            topDown
          ),

        inline:
          true,

      },

      {

        name:
          "HTF CRT",

        value:
          formatTopDownTimeframes(
            topDown
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
      data.timeframe ===
      "5m"
        ? FIVE_MINUTE_CHANNEL_ID
        : CHANNELS[
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
      `TOPDOWN ${data.topDown?.ratio || "N/A"}`

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
// PROCESS MARKET
// ============================================================

async function processMarket(
  client,
  provider,
  symbol,
  timeframe,
  candles,
  htfCandles = {}
) {

  if (
    provider !==
    "MEXC"
  ) {

    return;

  }

  if (
    !Array.isArray(
      candles
    ) ||
    candles.length <
      20
  ) {

    return;

  }

  const stateKey =
    `${provider}|${symbol}|${timeframe}`;

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
  // VOLUME
  // ----------------------------------------------------------

  signal.volume =
    Number(
      candles[
        signal.index
      ]?.volume ||
      candles.at(-1)?.volume ||
      0
    );


  // ----------------------------------------------------------
  // ANALYSIS
  // ----------------------------------------------------------

  const analysis =
    analyzeMarket(
      candles,
      signal
    );


  // ----------------------------------------------------------
  // UPDATE HISTORICAL HTF STATE
  // ----------------------------------------------------------

  if (
    TOP_DOWN_TIMEFRAMES.includes(
      timeframe
    )
  ) {

    updateTopDownCRTState(
      symbol,
      timeframe,
      signal
    );

  }


  // ----------------------------------------------------------
  // FIRST SCAN BASELINE
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

      `[CRT] Baseline | ` +
      `${symbol} | ` +
      `${timeframe} | ` +
      `${signal.fractalType}`

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
  // TOP-DOWN DATA
  // ----------------------------------------------------------

  let topDown =
    null;

  if (
    timeframe ===
    "5m"
  ) {

    topDown =
      buildTopDownAnalysis(
        symbol,
        signal,
        htfCandles
      );

    // IMPORTANT:
    //
    // DO NOT BLOCK THE SIGNAL.
    //
    // Regardless of:
    //
    // 0/4
    // 1/4
    // 2/4
    // 3/4
    // 4/4
    //
    // the 5M signal is displayed.

    console.log(

      `[CRT] 5M TOP-DOWN | ` +
      `${symbol} | ` +
      `${topDown.ratio} | ` +
      `1D=${topDown.states["1d"]?.type || "NONE"} | ` +
      `4H=${topDown.states["4h"]?.type || "NONE"} | ` +
      `1H=${topDown.states["1h"]?.type || "NONE"} | ` +
      `5M=${signal.type}`

    );

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

      provider,

      symbol,

      timeframe,

      signal,

      analysis,

      topDown,

    }
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


  // ==========================================================
  // FIRST:
  // BUILD HISTORICAL HTF DATA
  //
  // We specifically collect:
  //
  // 1D
  // 4H
  // 1H
  //
  // before scanning 5M.
  // ==========================================================

  const historicalHTF =
    new Map();


  for (
    const timeframe of
      [
        "1d",
        "4h",
        "1h",
      ]
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

          let symbolData =
            historicalHTF.get(
              job.symbol
            );

          if (
            !symbolData
          ) {

            symbolData =
              {};

            historicalHTF.set(
              job.symbol,
              symbolData
            );

          }

          symbolData[
            job.timeframe
          ] =
            candles;


          // ------------------------------------------------
          // Maintain latest historical Rachel T state.
          // ------------------------------------------------

          const latest =
            findLastFilteredFractal(
              candles
            );

          if (
            latest
          ) {

            updateTopDownCRTState(
              job.symbol,
              job.timeframe,
              latest
            );

          }


          // ------------------------------------------------
          // Standard signal processing.
          // ------------------------------------------------

          await processMarket(
            client,
            "MEXC",
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


  // ==========================================================
  // 15M STANDARD SIGNAL
  // ==========================================================

  {

    const timeframe =
      "15m";

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

        try {

          const candles =
            await fetchMexcCandles(
              job.symbol,
              timeframe
            );

          if (
            candles.length <
            20
          ) {

            return;

          }

          await processMarket(
            client,
            "MEXC",
            job.symbol,
            timeframe,
            candles
          );

        } catch (
          error
        ) {

          console.error(

            `[CRT] MEXC ${job.symbol} ${timeframe}: ${error.message}`

          );

        }

      }

    );

  }


  // ==========================================================
  // 5M SPECIAL TOP-DOWN SIGNAL
  // ==========================================================

  {

    const timeframe =
      "5m";

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

        try {

          const candles =
            await fetchMexcCandles(
              job.symbol,
              timeframe
            );

          if (
            candles.length <
            20
          ) {

            return;

          }

          const htfCandles =
            historicalHTF.get(
              job.symbol
            ) ||
            {};

          await processMarket(
            client,
            "MEXC",
            job.symbol,
            timeframe,
            candles,
            htfCandles
          );

        } catch (
          error
        ) {

          console.error(

            `[CRT] MEXC ${job.symbol} ${timeframe}: ${error.message}`

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
    "[CRT] MEXC Futures: ENABLED"
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
    ).join(
      ", "
    )}`
  );

  console.log(
    `[CRT] 5M Channel: ${FIVE_MINUTE_CHANNEL_ID}`
  );

  console.log(
    `[CRT] 5M Top-Down: ${TOP_DOWN_TIMEFRAMES.join(
      " -> "
    )}`
  );

  console.log(
    "[CRT] 5M Top-Down Filter: DISPLAY ONLY"
  );

  console.log(
    "[CRT] 5M signals are NOT blocked by 2/4."
  );

  console.log(
    "[CRT] 1D / 4H / 1H use latest confirmed Rachel T CRT."
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
    "============================================================"
  );


  // ----------------------------------------------------------
  // INITIAL SCAN
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

  if (
    !fractal
  ) {

    return {

      fractal:
        null,

      rsi:
        calculateRSI(
          candles,
          RSI_PERIOD
        ),

      standardDeviation:
        calculateStdDevContext(
          candles
        ),

      marketStructure:
        calculateMarketStructure(
          candles
        ),

    };

  }

  return {

    fractal,

    rsi:
      calculateRSI(
        candles,
        RSI_PERIOD
      ),

    standardDeviation:
      calculateStdDevContext(
        candles
      ),

    marketStructure:
      calculateMarketStructure(
        candles
      ),

  };

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

    spot:
      false,

    mexcApi:
      MEXC_BASE_URL,

    timeframes:
      Object.keys(
        TIMEFRAMES
      ),

    topDownTimeframes:
      TOP_DOWN_TIMEFRAMES,

    fiveMinuteChannelId:
      FIVE_MINUTE_CHANNEL_ID,

    topDownMode:
      "DISPLAY_ONLY",

    topDownMinimum:
      "2/4 INFORMATIONAL ONLY",

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
  "[CRT] Provider: MEXC FUTURES"
);

console.log(
  `[CRT] MEXC Futures API: ${MEXC_BASE_URL}`
);

console.log(
  "[CRT] OANDA disabled."
);

console.log(
  "[CRT] MEXC Spot disabled."
);

console.log(
  "[CRT] 30M disabled."
);

console.log(
  "[CRT] Rachel T Filtered Top enabled."
);

console.log(
  "[CRT] Rachel T Filtered Bottom enabled."
);

console.log(
  "[CRT] Historical 1D / 4H / 1H CRT enabled."
);

console.log(
  "[CRT] 5M Top-Down: 1D + 4H + 1H + 5M."
);

console.log(
  "[CRT] 5M 2/4 threshold is informational only."
);

console.log(
  `[CRT] 5M channel: ${FIVE_MINUTE_CHANNEL_ID}`
);
