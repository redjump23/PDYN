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
// TIMEFRAMES:
//   1D
//   4H
//   1H
//   15M
//   5M
//
// TOP-DOWN:
//   1D -> 4H -> 1H -> 15M -> 5M
//
// IMPORTANT:
//   1D / 4H / 1H / 15M keep their own normal CRT signals.
//
//   5M uses the latest/previous confirmed Rachel T CRT
//   information from the higher timeframes.
//
//   5M IS NOT BLOCKED when HTF confirmation is incomplete.
//
//   Example:
//
//   TOP-DOWN : 3/4 CONFIRMED
//   HTF CRT  : 1D BUY • 4H BUY • 1H BUY • 15M SELL
//
//   The 5M signal is still displayed.
//
// CHANNEL IDs:
//   NEVER hard-coded here.
//   Read from botConfig.crt.channels in bot.js.
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
// These are the higher timeframes used by the 5M signal.
//
// 5M itself is NOT included here.
//
// ============================================================

const TOP_DOWN_TIMEFRAMES = [

  "1d",

  "4h",

  "1h",

  "15m",

];


// ============================================================
// DISCORD CHANNELS
// ============================================================
//
// IMPORTANT:
//
// Channel IDs must be placed in:
//
//   src/config/bot.js
//
// crtService.js does NOT contain any channel IDs.
//
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
// RACHEL T FRACTAL
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
// Stores the latest known Rachel T CRT for:
//
// 1D
// 4H
// 1H
// 15M
//
// This allows the 5M signal to read previous CRT signals even
// when the higher timeframe does not produce a new CRT during
// the same scan.
//
// ============================================================

const topDownCRTState =
  new Map();


// ============================================================
// MONITOR
// ============================================================

let crtMonitorStarted =
  false;

let monitorTimer =
  null;


// ============================================================
// MEXC BLOCK
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
    TIMEFRAMES[
      timeframe
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

    timeframe,

    label:
      timeframe.toUpperCase(),

    date:
      `${now.year}-${pad(now.month)}-${pad(now.day)}`,

    startHour,

    startMinute,

    endHour,

    endMinute,

    startTime:
      `${pad(startHour)}:${pad(startMinute)}`,

    endTime:
      `${pad(endHour)}:${pad(endMinute)}`,

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
      `${pad(now.hour)}:${pad(now.minute)}:${pad(now.second)}`,

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
// NORMALIZE SYMBOL
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
// MEXC SYMBOLS
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
    `${MEXC_BASE_URL}/api/v1/contract/detail`;

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

            const quote =
              String(
                contract?.quoteCoin ||
                  ""
              ).toUpperCase();

            const settle =
              String(
                contract?.settleCoin ||
                  ""
              ).toUpperCase();

            return (
              Boolean(symbol) &&
              (
                quote ===
                  "USDT" ||
                settle ===
                  "USDT" ||
                symbol.endsWith(
                  "_USDT"
                ) ||
                symbol.endsWith(
                  "USDT"
                )
              )
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
        401 ||
      error.status ===
        403
    ) {

      mexcBlockedUntil =
        Date.now() +
        MEXC_BLOCK_COOLDOWN;

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

  return number <
    100000000000
    ? number *
        1000
    : number;

}


// ============================================================
// VALID CANDLE
// ============================================================

function isValidCandle(
  candle
) {

  return Boolean(
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
    !Array.isArray(data) &&
    Array.isArray(data.time)
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
      (a, b) =>
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
        row => {

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
        (a, b) =>
          a.timestamp -
          b.timestamp
      );

  }

  return [];

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

  const normalized =
    normalizeMexcSymbol(
      symbol
    );

  if (
    !normalized
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
      normalized
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
        401 ||
      error.status ===
        403
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
        30000;

      return [];

    }

    throw error;

  }

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

  let state =
    "NORMAL";

  if (
    value >
    Math.abs(
      mean
    ) *
      STDDEV_HIGH_MULTIPLIER
  ) {

    state =
      "HIGH";

  }

  return {

    value,

    state,

    mean,

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
// FILTERED FRACTALS
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
// SWING HIGHS
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
// SWING LOWS
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
        "BEARISH",

      bias:
        "BEARISH",

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

  let bullish =
    0;

  let bearish =
    0;

  if (
    lastHigh &&
    previousHigh
  ) {

    if (
      lastHigh.price >
      previousHigh.price
    ) {

      bullish++;

    } else if (
      lastHigh.price <
      previousHigh.price
    ) {

      bearish++;

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

      bullish++;

    } else if (
      lastLow.price <
      previousLow.price
    ) {

      bearish++;

    }

  }

  const current =
    candles.at(-1).close;

  if (
    lastHigh &&
    current >
      lastHigh.price
  ) {

    bullish +=
      2;

  }

  if (
    lastLow &&
    current <
      lastLow.price
  ) {

    bearish +=
      2;

  }

  if (
    bullish ===
    bearish
  ) {

    const high =
      Math.max(
        ...recent.map(
          candle =>
            candle.high
        )
      );

    const low =
      Math.min(
        ...recent.map(
          candle =>
            candle.low
        )
      );

    const midpoint =
      (
        high +
        low
      ) /
      2;

    if (
      current >=
      midpoint
    ) {

      bullish++;

    } else {

      bearish++;

    }

  }

  const state =
    bullish >
    bearish
      ? "BULLISH"
      : "BEARISH";

  return {

    state,

    bias:
      state,

    bullishScore:
      bullish,

    bearishScore:
      bearish,

    lastHigh,

    previousHigh,

    lastLow,

    previousLow,

  };

}


// ============================================================
// MARKET ANALYSIS
// ============================================================

function analyzeMarket(
  candles
) {

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

    rsi,

    rsiState:
      getRSIState(
        rsi
      ),

    standardDeviation,

    marketStructure,

    structureConfirmation:
      marketStructure?.state ||
      "BEARISH",

  };

}


// ============================================================
// UPDATE TOP-DOWN STATE
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

  const key =
    normalizeMexcSymbol(
      symbol
    );

  if (
    !key
  ) {

    return;

  }

  let state =
    topDownCRTState.get(
      key
    );

  if (
    !state
  ) {

    state =
      new Map();

    topDownCRTState.set(
      key,
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

    }
  );

}


// ============================================================
// GET TOP-DOWN STATE
// ============================================================

function getTopDownState(
  symbol,
  lowerSignal
) {

  const key =
    normalizeMexcSymbol(
      symbol
    );

  const state =
    topDownCRTState.get(
      key
    );

  const states =
    {};

  let confirmedCount =
    0;

  let availableCount =
    0;

  for (
    const timeframe of
      TOP_DOWN_TIMEFRAMES
  ) {

    const item =
      state?.get(
        timeframe
      );

    if (
      item &&
      item.type
    ) {

      states[
        timeframe
      ] =
        item.type;

      availableCount++;

      if (
        lowerSignal &&
        item.type ===
          lowerSignal.type
      ) {

        confirmedCount++;

      }

    } else {

      states[
        timeframe
      ] =
        "N/A";

    }

  }

  const total =
    TOP_DOWN_TIMEFRAMES.length;

  const direction =
    lowerSignal?.type ||
    null;

  return {

    confirmed:
      confirmedCount ===
      total,

    confirmedCount,

    availableCount,

    total,

    direction,

    states,

  };

}


// ============================================================
// FORMAT TOP-DOWN
// ============================================================

function formatTopDown(
  topDown
) {

  if (
    !topDown
  ) {

    return "N/A";

  }

  const count =
    `${topDown.confirmedCount}/${topDown.total}`;

  if (
    topDown.confirmed
  ) {

    return (
      `${count} CONFIRMED`
    );

  }

  return (
    `${count} CONFIRMED`
  );

}


// ============================================================
// FORMAT HTF CRT
// ============================================================

function formatHTFCRT(
  topDown
) {

  if (
    !topDown
  ) {

    return "N/A";

  }

  return TOP_DOWN_TIMEFRAMES
    .map(
      timeframe =>
        `${timeframe.toUpperCase()} ${topDown.states[timeframe]}`
    )
    .join(
      " • "
    );

}


// ============================================================
// FORMAT RSI
// ============================================================
//
// OVERBOUGHT / OVERSOLD = bold
// NEUTRAL = normal
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
  value
) {

  if (
    !value
  ) {

    return "N/A";

  }

  if (
    value.state ===
    "HIGH"
  ) {

    return "EXPANSION";

  }

  return "NORMAL";

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
    structure.state ===
    "BULLISH"
      ? "BULLISH"
      : "BEARISH"
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

  return volume.toFixed(
    2
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
// CREATE EMBED
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
          CRT_CONFIG.colors?.buy ||
          "#57F287"
        )
      : (
          CRT_CONFIG.colors?.sell ||
          "#ED4245"
        );

  const coin =
    `**${symbol}**`;

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

  ];

  if (
    timeframe ===
    "5m"
  ) {

    fields.push(

      {

        name:
          "TOP-DOWN",

        value:
          topDown
            ? (
                topDown.confirmed
                  ? `**${topDown.confirmedCount}/${topDown.total} CONFIRMED**`
                  : `${topDown.confirmedCount}/${topDown.total} CONFIRMED`
              )
            : "0/4 CONFIRMED",

        inline:
          true,

      },

      {

        name:
          "HTF CRT",

        value:
          formatHTFCRT(
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
        `[CRT] No Discord channel configured for ${data.timeframe} in bot.js`
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
      `${data.signal.type}`
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

  signal.volume =
    Number(
      candles[
        signal.index
      ]?.volume ||
      0
    );

  const analysis =
    analyzeMarket(
      candles
    );

  // ----------------------------------------------------------
  // HIGHER TIMEFRAME STATE
  // ----------------------------------------------------------

  updateTopDownCRTState(
    symbol,
    timeframe,
    signal
  );

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
      `[CRT] Baseline | ` +
      `${symbol} | ` +
      `${timeframe} | ` +
      `${signal.type}`
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
  // TOP-DOWN
  // ----------------------------------------------------------

  let topDown =
    null;

  if (
    timeframe ===
    "5m"
  ) {

    topDown =
      getTopDownState(
        symbol,
        signal
      );

  }

  // ----------------------------------------------------------
  // SAVE
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
      "[CRT] MEXC symbol scan failed:",
      error.message
    );

    return;

  }

  if (
    !symbols.length
  ) {

    return;

  }

  // ----------------------------------------------------------
  // IMPORTANT:
  //
  // Higher timeframes are scanned FIRST.
  //
  // This lets 1D / 4H / 1H / 15M update their stored CRT
  // state before the 5M scan runs.
  // ----------------------------------------------------------

  const scanOrder = [

    "1d",

    "4h",

    "1h",

    "15m",

    "5m",

  ];

  for (
    const timeframe of
      scanOrder
  ) {

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
    "[CRT] Starting MEXC full scan..."
  );

  await scanMexc(
    client
  );

  console.log(
    "[CRT] MEXC full scan completed."
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
    "[CRT] PDYN CRT MONITOR STARTED"
  );

  console.log(
    `[CRT] SOURCE: MEXC FUTURES`
  );

  console.log(
    `[CRT] TIMEFRAMES: ${Object.keys(
      TIMEFRAMES
    ).join(
      ", "
    )}`
  );

  console.log(
    `[CRT] TOP-DOWN: ${TOP_DOWN_TIMEFRAMES.join(
      " -> "
    )}`
  );

  console.log(
    "[CRT] 5M TOP-DOWN FILTER: DISPLAY ONLY"
  );

  console.log(
    "[CRT] 5M SIGNAL WILL DISPLAY EVEN IF HTF IS NOT CONFIRMED."
  );

  console.log(
    "[CRT] CHANNEL IDs: READ FROM bot.js"
  );

  console.log(
    "[CRT] OANDA: DISABLED"
  );

  console.log(
    "[CRT] MEXC SPOT: DISABLED"
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
        error
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

  const analysis =
    analyzeMarket(
      candles
    );

  return {

    fractal,

    rsi:
      analysis.rsi,

    rsiState:
      analysis.rsiState,

    standardDeviation:
      analysis.standardDeviation,

    marketStructure:
      analysis.marketStructure,

    structure:
      analysis.structureConfirmation,

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

    channelSource:
      "bot.js",

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
  "[CRT] OANDA disabled."
);

console.log(
  "[CRT] MEXC Spot disabled."
);

console.log(
  "[CRT] 30M disabled."
);

console.log(
  "[CRT] 5M enabled."
);

console.log(
  "[CRT] Rachel T fractals enabled."
);

console.log(
  "[CRT] Top-down previous CRT state enabled."
);

console.log(
  "[CRT] 5M signals are NOT blocked by HTF confirmation."
);

console.log(
  "[CRT] Discord channel IDs are loaded from bot.js."
);
