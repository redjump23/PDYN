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
// STANDARD TIMEFRAMES:
//   15m
//   1h
//   4h
//   1d
//
// LOWER TIMEFRAME:
//   5m
//
// 5m MODE:
//   TOP-DOWN ANALYSIS
//
// HIGHER TIMEFRAME STACK:
//   1d
//   4h
//   1h
//   15m
//
// TOP-DOWN RULE:
//   Minimum 2 of 4 higher timeframes must have
//   a confirmed Rachel T Fractal signal.
//
// EXAMPLE:
//
//   1D  ❌
//   4H  ✅
//   1H  ✅
//   15M ❌
//
//   RESULT = 2/4
//
// 2/4, 3/4 and 4/4 are valid.
//
// 1/4 or 0/4 = NO 5m SIGNAL
//
// IMPORTANT:
//   Daily does NOT need to be confirmed.
//
// OANDA:
//   DISABLED
//
// MEXC SPOT:
//   DISABLED
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
// Standard output:
//   15m
//   1h
//   4h
//   1d
//
// Top-down lower timeframe:
//   5m
//
// 30m removed.
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
// STANDARD TIMEFRAMES
// ============================================================

const STANDARD_TIMEFRAMES = [
  "15m",
  "1h",
  "4h",
  "1d",
];

// ============================================================
// TOP-DOWN HIGHER TIMEFRAMES
// ============================================================
//
// The order is intentional.
//
// 1D -> 4H -> 1H -> 15M
//
// ============================================================

const TOP_DOWN_TIMEFRAMES = [
  "1d",
  "4h",
  "1h",
  "15m",
];

// ============================================================
// LOWER TIMEFRAME
// ============================================================

const TOP_DOWN_LOWER_TIMEFRAME =
  "5m";

// ============================================================
// TOP-DOWN MINIMUM CONFIRMATION
// ============================================================

const TOP_DOWN_MIN_CONFIRMATIONS =
  Number(
    CRT_CONFIG.topDown?.minimumConfirmations
  ) >= 1
    ? Number(
        CRT_CONFIG.topDown
          .minimumConfirmations
      )
    : 2;

// ============================================================
// DISCORD CHANNELS
// ============================================================

const CHANNELS =
  CRT_CONFIG.channels || {};

// ============================================================
// 5M CHANNEL
// ============================================================
//
// Explicitly assigned according to the requested
// Discord channel.
//
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
// STANDARD DEVIATION
// ============================================================

const STDDEV_PERIOD =
  Number(
    CRT_CONFIG.standardDeviation?.period
  ) || 20;

const STDDEV_HIGH_MULTIPLIER =
  Number(
    CRT_CONFIG.standardDeviation?.highMultiplier
  ) || 1.5;

const STDDEV_LOW_MULTIPLIER =
  Number(
    CRT_CONFIG.standardDeviation?.lowMultiplier
  ) || 0.75;

// ============================================================
// MARKET STRUCTURE
// ============================================================

const STRUCTURE_LOOKBACK =
  Number(
    CRT_CONFIG.marketStructure?.lookback
  ) || 20;

const STRUCTURE_SWING_LENGTH =
  Number(
    CRT_CONFIG.marketStructure?.swingLength
  ) || 2;

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
// TOP-DOWN STATE
// ============================================================

const topDownState =
  new Map();

// ============================================================
// STARTUP BASELINE
// ============================================================

const startupBaseline =
  new Set();

// ============================================================
// TOP-DOWN STARTUP BASELINE
// ============================================================

const topDownStartupBaseline =
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
        `[CRT] XAU MEXC contracts: ${xauSymbols.join(
          ", "
        )}`
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
      closes[
        i - 1
      ];

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
      closes[
        i - 1
      ];

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
        candles[i]
          .close
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
        period *
          3
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
      let j = begin;
      j <= i;
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
          candles[j]
            .close
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
//
// This searches backwards for the newest CONFIRMED
// Rachel T fractal.
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
    index >=
    4;
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
      candles[i]
        .high;

    let valid =
      true;

    for (
      let j = 1;
      j <= swingLength;
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
          candles[i]
            .timestamp,

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
      candles[i]
        .low;

    let valid =
      true;

    for (
      let j = 1;
      j <= swingLength;
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
          candles[i]
            .timestamp,

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
      candles.length - 1
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
// This function is used by the top-down algorithm.
//
// The most recent confirmed Rachel T fractal determines
// whether that timeframe is currently:
//
//   BUY
//   SELL
//
// ============================================================

function getRachelConfirmation(
  candles
) {
  if (
    !Array.isArray(
      candles
    ) ||
    candles.length <
      5
  ) {
    return {
      confirmed:
        false,

      direction:
        null,

      fractal:
        null,
    };
  }

  const fractal =
    findLastFilteredFractal(
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

      fractal:
        null,
    };
  }

  return {
    confirmed:
      true,

    direction:
      fractal.type,

    fractal,
  };
}

// ============================================================
// TOP-DOWN ANALYSIS
// ============================================================
//
// 4 higher timeframes:
//
//   1D
//   4H
//   1H
//   15M
//
// Minimum:
//
//   2 / 4
//
// The daily timeframe is NOT mandatory.
//
// ============================================================

function calculateTopDownAnalysis(
  timeframeData
) {
  const confirmations =
    [];

  for (
    const timeframe of
      TOP_DOWN_TIMEFRAMES
  ) {
    const data =
      timeframeData[
        timeframe
      ];

    const confirmation =
      data?.confirmation || {
        confirmed:
          false,

        direction:
          null,

        fractal:
          null,
      };

    confirmations.push({
      timeframe,

      confirmed:
        confirmation.confirmed,

      direction:
        confirmation.direction,

      fractal:
        confirmation.fractal,
    });
  }

  const confirmed =
    confirmations.filter(
      (
        item
      ) =>
        item.confirmed
    );

  const confirmationCount =
    confirmed.length;

  const total =
    TOP_DOWN_TIMEFRAMES.length;

  const eligible =
    confirmationCount >=
    TOP_DOWN_MIN_CONFIRMATIONS;

  let bullishCount =
    0;

  let bearishCount =
    0;

  for (
    const item of
      confirmed
  ) {
    if (
      item.direction ===
      "BUY"
    ) {
      bullishCount++;
    }

    if (
      item.direction ===
      "SELL"
    ) {
      bearishCount++;
    }
  }

  let direction =
    null;

  // ----------------------------------------------------------
  // Direction
  // ----------------------------------------------------------
  //
  // If one direction has the majority, use that direction.
  //
  // If 2/4 are split 1 BUY + 1 SELL, use the newest
  // confirmation among the confirmed higher timeframes.
  //
  // ----------------------------------------------------------

  if (
    bullishCount >
    bearishCount
  ) {
    direction =
      "BUY";
  } else if (
    bearishCount >
    bullishCount
  ) {
    direction =
      "SELL";
  } else if (
    confirmed.length
  ) {
    const newest =
      confirmed
        .slice()
        .sort(
          (
            a,
            b
          ) =>
            (
              b.fractal
                ?.timestamp ||
              0
            ) -
            (
              a.fractal
                ?.timestamp ||
              0
            )
        )[0];

    direction =
      newest?.direction ||
      null;
  }

  return {
    eligible,

    direction,

    confirmationCount,

    total,

    label:
      `${confirmationCount}/${total}`,

    bullishCount,

    bearishCount,

    confirmations,
  };
}

// ============================================================
// FORMAT TOP-DOWN STATUS
// ============================================================

function formatTopDownStatus(
  analysis
) {
  if (
    !analysis
  ) {
    return "0/4";
  }

  return analysis.label;
}

// ============================================================
// FORMAT TOP-DOWN DETAIL
// ============================================================
//
// Example:
//
// 1D ❌ | 4H ✅ | 1H ✅ | 15M ❌
//
// ============================================================

function formatTopDownDetail(
  analysis
) {
  if (
    !analysis
  ) {
    return (
      "1D ❌ | " +
      "4H ❌ | " +
      "1H ❌ | " +
      "15M ❌"
    );
  }

  return analysis.confirmations
    .map(
      (
        item
      ) => {
        const label =
          item.timeframe ===
          "1d"
            ? "1D"
            : item.timeframe ===
              "4h"
            ? "4H"
            : item.timeframe ===
              "1h"
            ? "1H"
            : "15M";

        return (
          `${label} ` +
          `${
            item.confirmed
              ? "✅"
              : "❌"
          }`
        );
      }
    )
    .join(
      " | "
    );
}

// ============================================================
// TOP-DOWN DIRECTION TEXT
// ============================================================

function formatTopDownDirection(
  analysis
) {
  if (
    !analysis ||
    !analysis.direction
  ) {
    return "WAIT";
  }

  return analysis.direction ===
    "BUY"
    ? "BUY"
    : "SELL";
}

// ============================================================
// PROCESS STANDARD MARKET
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
  // SEND STANDARD SIGNAL
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

      isTopDown:
        false,
    }
  );
}

// ============================================================
// PROCESS TOP-DOWN 5M
// ============================================================
//
// IMPORTANT:
//
// The 5m signal is NOT treated like the standard timeframe.
//
// The 5m signal requires:
//
//   1. A new 5m Rachel T Fractal
//   2. At least 2/4 higher timeframe confirmations
//
// The 4 higher timeframes are:
//
//   1D
//   4H
//   1H
//   15M
//
// ============================================================

async function processTopDownMarket(
  client,
  symbol,
  timeframeData
) {
  const lowerTimeframe =
    TOP_DOWN_LOWER_TIMEFRAME;

  const lowerData =
    timeframeData[
      lowerTimeframe
    ];

  if (
    !lowerData ||
    !Array.isArray(
      lowerData.candles
    ) ||
    lowerData.candles.length <
      20
  ) {
    return;
  }

  const topDown =
    calculateTopDownAnalysis(
      timeframeData
    );

  // ----------------------------------------------------------
  // 2/4 MINIMUM
  // ----------------------------------------------------------

  if (
    !topDown.eligible
  ) {
    return;
  }

  // ----------------------------------------------------------
  // FIND 5M CRT
  // ----------------------------------------------------------
  //
  // The 5m itself must produce a Rachel T fractal.
  //
  // This prevents the bot from sending a 5m message every
  // time a higher timeframe remains confirmed.
  //
  // ----------------------------------------------------------

  const candles =
    lowerData.candles;

  const stateKey =
    `MEXC|${symbol}|5m|TOPDOWN`;

  const previousTimestamp =
    topDownState.get(
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
  // TOP-DOWN STARTUP BASELINE
  // ----------------------------------------------------------

  if (
    !topDownStartupBaseline.has(
      stateKey
    )
  ) {
    topDownState.set(
      stateKey,
      signal.timestamp
    );

    topDownStartupBaseline.add(
      stateKey
    );

    console.log(
      `[CRT] 5m Top-Down Baseline | ` +
      `MEXC | ${symbol} | ` +
      `${topDown.label} | ` +
      `${topDown.direction || "WAIT"}`
    );

    return;
  }

  // ----------------------------------------------------------
  // DUPLICATE PROTECTION
  // ----------------------------------------------------------

  if (
    signal.timestamp <=
    (
      topDownState.get(
        stateKey
      ) ||
      0
    )
  ) {
    return;
  }

  // ----------------------------------------------------------
  // DIRECTION ALIGNMENT
  // ----------------------------------------------------------
  //
  // The 5m CRT must agree with the top-down majority.
  //
  // Example:
  //
  // 4H BUY
  // 1H BUY
  //
  // Top-down = BUY
  //
  // A 5m SELL fractal will NOT trigger.
  //
  // ----------------------------------------------------------

  if (
    topDown.direction &&
    signal.type !==
      topDown.direction
  ) {
    topDownState.set(
      stateKey,
      signal.timestamp
    );

    console.log(
      `[CRT] 5m ignored | ` +
      `${symbol} | ` +
      `5m ${signal.type} | ` +
      `Top-Down ${topDown.direction} | ` +
      `${topDown.label}`
    );

    return;
  }

  // ----------------------------------------------------------
  // SAVE BEFORE SEND
  // ----------------------------------------------------------

  topDownState.set(
    stateKey,
    signal.timestamp
  );

  // ----------------------------------------------------------
  // 5M INDICATORS
  // ----------------------------------------------------------

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

  // ----------------------------------------------------------
  // SEND 5M TOP-DOWN SIGNAL
  // ----------------------------------------------------------

  await sendCRTSignal(
    client,
    {
      symbol,

      timeframe:
        "5m",

      signal,

      rsi,

      rsiState,

      standardDeviation,

      marketStructure,

      topDown,

      isTopDown:
        true,
    }
  );
}

// ============================================================
// BUILD TIMEFRAME DATA FOR SYMBOL
// ============================================================
//
// One symbol is analyzed across:
//
//   1D
//   4H
//   1H
//   15M
//   5M
//
// ============================================================

async function buildSymbolTimeframeData(
  symbol
) {
  const timeframeData =
    {};

  const jobs =
    Object.keys(
      TIMEFRAMES
    ).map(
      (
        timeframe
      ) => ({
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
            symbol,
            job.timeframe
          );

        timeframeData[
          job.timeframe
        ] = {
          candles,

          confirmation:
            getRachelConfirmation(
              candles
            ),
        };
      } catch (
        error
      ) {
        console.error(
          `[CRT] MEXC ${symbol} ${job.timeframe}: ${error.message}`
        );

        timeframeData[
          job.timeframe
        ] = {
          candles:
            [],

          confirmation:
            {
              confirmed:
                false,

              direction:
                null,

              fractal:
                null,
            },
        };
      }
    }
  );

  return timeframeData;
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
// RSI number is intentionally not displayed.
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
// FORMAT TOP-DOWN CONFIRMATION FIELD
// ============================================================

function createTopDownFields(
  topDown
) {
  if (
    !topDown
  ) {
    return [];
  }

  return [
    {
      name:
        "TOP-DOWN",

      value:
        `**${formatTopDownStatus(
          topDown
        )}**`,

      inline:
        true,
    },

    {
      name:
        "HTF CONFIRMATION",

      value:
        formatTopDownDetail(
          topDown
        ),

      inline:
        false,
    },

    {
      name:
        "TOP-DOWN DIRECTION",

      value:
        formatTopDownDirection(
          topDown
        ),

      inline:
        true,
    },
  ];
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

    isTopDown,
  } = data;

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

  const coin =
    `**${symbol}**`;

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

  if (
    isTopDown &&
    topDown
  ) {
    fields.push(
      ...createTopDownFields(
        topDown
      )
    );
  }

  return new EmbedBuilder()
    .setTitle(
      isTopDown
        ? "CRT SIGNAL • TOP-DOWN"
        : "CRT SIGNAL"
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
        isTopDown
          ? (
              CRT_CONFIG.footer ||
              "CRT • PDYN • MEXC • TOP-DOWN"
            )
          : (
              CRT_CONFIG.footer ||
              "CRT • PDYN • MEXC"
            ),
    })

    .setTimestamp(
      new Date(
        signal.timestamp
      )
    );
}

// ============================================================
// GET CHANNEL ID
// ============================================================

function getChannelId(
  timeframe,
  isTopDown
) {
  if (
    isTopDown &&
    timeframe ===
      "5m"
  ) {
    return FIVE_MINUTE_CHANNEL_ID;
  }

  return (
    CHANNELS[
      timeframe
    ] ||
    null
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
      getChannelId(
        data.timeframe,
        data.isTopDown
      );

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
        data.marketStructure
          ?.bias ||
        "BEARISH"
      }` +
      (
        data.isTopDown
          ? ` | TOP-DOWN ${
              data.topDown
                ?.label ||
              "0/4"
            }`
          : ""
      )
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
// PROCESS ONE SYMBOL
// ============================================================
//
// This is the important change.
//
// Instead of processing 5m independently, the bot first
// downloads all five timeframes for the coin:
//
//   1D
//   4H
//   1H
//   15M
//   5M
//
// Then the top-down engine checks the four higher
// timeframes before allowing a 5m signal.
//
// ============================================================

async function processSymbol(
  client,
  symbol
) {
  const timeframeData =
    await buildSymbolTimeframeData(
      symbol
    );

  // ----------------------------------------------------------
  // STANDARD SIGNALS
  // ----------------------------------------------------------
  //
  // Keep existing standard output for:
  //
  //   15m
  //   1h
  //   4h
  //   1d
  //
  // ----------------------------------------------------------

  for (
    const timeframe of
      STANDARD_TIMEFRAMES
  ) {
    const data =
      timeframeData[
        timeframe
      ];

    if (
      !data ||
      !Array.isArray(
        data.candles
      )
    ) {
      continue;
    }

    await processStandardMarket(
      client,
      symbol,
      timeframe,
      data.candles
    );
  }

  // ----------------------------------------------------------
  // 5M TOP-DOWN
  // ----------------------------------------------------------

  await processTopDownMarket(
    client,
    symbol,
    timeframeData
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

  await runWithConcurrency(
    symbols,
    MEXC_CONCURRENCY,
    async (
      symbol
    ) => {
      if (
        Date.now() <
        mexcBlockedUntil
      ) {
        return;
      }

      try {
        await processSymbol(
          client,
          symbol
        );
      } catch (
        error
      ) {
        console.error(
          `[CRT] MEXC ${symbol}: ${error.message}`
        );
      }
    }
  );
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
    `[CRT] Standard Timeframes: ${STANDARD_TIMEFRAMES.join(
      ", "
    )}`
  );

  console.log(
    "[CRT] 5m: TOP-DOWN MODE"
  );

  console.log(
    `[CRT] Top-Down HTFs: ${TOP_DOWN_TIMEFRAMES.join(
      ", "
    )}`
  );

  console.log(
    `[CRT] Top-Down Minimum: ${TOP_DOWN_MIN_CONFIRMATIONS}/${TOP_DOWN_TIMEFRAMES.length}`
  );

  console.log(
    `[CRT] 5m Discord Channel: ${FIVE_MINUTE_CHANNEL_ID}`
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

  const confirmation =
    getRachelConfirmation(
      candles
    );

  return {
    fractal,

    confirmation,

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
//
// Useful for debugging.
//
// Pass:
//
// {
//   "1d": candles,
//   "4h": candles,
//   "1h": candles,
//   "15m": candles,
//   "5m": candles
// }
//
// ============================================================

export function testTopDownAnalysis(
  timeframeCandles
) {
  if (
    !timeframeCandles ||
    typeof timeframeCandles !==
      "object"
  ) {
    return null;
  }

  const timeframeData =
    {};

  for (
    const timeframe of
      Object.keys(
        TIMEFRAMES
      )
  ) {
    const candles =
      Array.isArray(
        timeframeCandles[
          timeframe
        ]
      )
        ? timeframeCandles[
            timeframe
          ]
        : [];

    timeframeData[
      timeframe
    ] = {
      candles,

      confirmation:
        getRachelConfirmation(
          candles
        ),
    };
  }

  const analysis =
    calculateTopDownAnalysis(
      timeframeData
    );

  return {
    ...analysis,

    detail:
      formatTopDownDetail(
        analysis
      ),

    direction:
      formatTopDownDirection(
        analysis
      ),

    eligible:
      analysis.eligible,
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

    mexcApi:
      MEXC_BASE_URL,

    spot:
      false,

    timeframes:
      Object.keys(
        TIMEFRAMES
      ),

    standardTimeframes:
      STANDARD_TIMEFRAMES,

    topDownLowerTimeframe:
      TOP_DOWN_LOWER_TIMEFRAME,

    topDownHigherTimeframes:
      TOP_DOWN_TIMEFRAMES,

    topDownMinimumConfirmations:
      TOP_DOWN_MIN_CONFIRMATIONS,

    topDownAlgorithm:
      "2/4+",

    fiveMinuteChannel:
      FIVE_MINUTE_CHANNEL_ID,

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
  "[CRT] 5m timeframe enabled in TOP-DOWN mode."
);

console.log(
  `[CRT] 5m Discord Channel: ${FIVE_MINUTE_CHANNEL_ID}`
);

console.log(
  "[CRT] Rachel T Filtered Top enabled."
);

console.log(
  "[CRT] Rachel T Filtered Bottom enabled."
);

console.log(
  `[CRT] Top-Down: ${TOP_DOWN_TIMEFRAMES.join(
    " -> "
  )}`
);

console.log(
  `[CRT] Top-Down minimum confirmation: ${TOP_DOWN_MIN_CONFIRMATIONS}/${TOP_DOWN_TIMEFRAMES.length}`
);

console.log(
  "[CRT] Daily confirmation is NOT mandatory."
);

console.log(
  "[CRT] 5m requires 2/4+ higher timeframe confirmation."
);

console.log(
  "[CRT] Structure output: BULLISH / BEARISH."
);
