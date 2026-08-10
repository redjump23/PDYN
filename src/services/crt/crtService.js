import { EmbedBuilder } from "discord.js";
import botConfig from "../../config/bot.js";

// ============================================================
// PDYN-BOT — CRT SIGNAL SERVICE
// ============================================================
//
// MARKET DATA
//
// CRYPTO:
//   MEXC FUTURES ONLY
//
// FOREX / METALS:
//   OANDA
//
// CRT / FRACTAL SOURCE:
//   Rachel T Fractals
//
// ENABLED FRACTALS:
//   Filtered Top Fractals
//   Filtered Bottom Fractals
//
// FILTER MODE:
//   filterBW = false
//
// Therefore the source uses:
//   isBWFractal(1)
//   isBWFractal(-1)
//
// TIMEFRAMES:
//   5m
//   15m
//   30m
//   1h
//   4h
//   1d
//
// RSI:
//   14
//
// RSI DISPLAY:
//   >= 70  OVERBOUGHT
//   <= 30  OVERSOLD
//   otherwise NEUTRAL
//
// IMPORTANT:
//   A signal is generated from a CONFIRMED closed candle.
//   The fractal itself is the candle at index [2].
//   This follows the original Rachel T source's offset=-2.
//
// RAILWAY RESTART:
//   The service establishes a startup baseline.
//   It does NOT resend an old signal immediately after restart.
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

    "5m":
      5,

    "15m":
      15,

    "30m":
      30,

    "1h":
      60,

    "4h":
      240,

    "1d":
      1440,
  };


const CHANNELS =
  CRT_CONFIG.channels || {};


// ============================================================
// MEXC FUTURES
// ============================================================

const MEXC_BASE_URL =
  CRT_CONFIG.mexc?.api ||
  "https://contract.mexc.com";


// ============================================================
// OANDA
// ============================================================

const OANDA_ENVIRONMENT =
  CRT_CONFIG.oanda?.environment ||
  process.env.OANDA_ENVIRONMENT ||
  "live";


const OANDA_API_KEY =
  CRT_CONFIG.oanda?.apiKey ||
  process.env.OANDA_API_KEY ||
  "";


const OANDA_ACCOUNT_ID =
  CRT_CONFIG.oanda?.accountId ||
  process.env.OANDA_ACCOUNT_ID ||
  "";


const OANDA_BASE_URL =
  OANDA_ENVIRONMENT === "practice"
    ? "https://api-fxpractice.oanda.com"
    : "https://api-fxtrade.oanda.com";


// ============================================================
// RSI SETTINGS
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
// FRACTAL SETTINGS
// ============================================================
//
// Rachel T source:
//
// filterBW = input(false)
//
// filteredtopf = filterBW
//   ? isRegularFractal(1)
//   : isBWFractal(1)
//
// filteredbotf = filterBW
//   ? isRegularFractal(-1)
//   : isBWFractal(-1)
//
// Therefore:
//
// filterBW = false
//
// ============================================================

const FILTER_BW =
  CRT_CONFIG.filterBW === true;


// ============================================================
// SIGNAL SETTINGS
// ============================================================

const FILTERED_TOP_ENABLED =
  CRT_CONFIG.filteredTop !== false;


const FILTERED_BOTTOM_ENABLED =
  CRT_CONFIG.filteredBottom !== false;


// ============================================================
// REQUEST SETTINGS
// ============================================================

const CHECK_INTERVAL =
  Number(
    CRT_CONFIG.checkInterval
  ) >= 1000
    ? Number(
        CRT_CONFIG.checkInterval
      )
    : 5000;


const CANDLE_LIMIT =
  220;


// ============================================================
// FETCH TIMEOUT
// ============================================================

const REQUEST_TIMEOUT =
  15000;


// ============================================================
// MEXC REQUEST CONCURRENCY
// ============================================================
//
// MEXC has many Futures contracts.
// Do not request every symbol simultaneously.
//
// ============================================================

const MEXC_CONCURRENCY =
  8;


// ============================================================
// OANDA SYMBOL CACHE
// ============================================================

let oandaInstrumentsCache =
  null;


let oandaInstrumentsCacheTime =
  0;


const OANDA_CACHE_TIME =
  30 *
  60 *
  1000;


// ============================================================
// MEXC SYMBOL CACHE
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
//
// Key:
//
// provider|symbol|timeframe
//
// Value:
//
// last processed signal candle timestamp
//
// ============================================================

const signalState =
  new Map();


// ============================================================
// STARTUP BASELINE
// ============================================================
//
// This prevents Railway restart from immediately sending the
// previous confirmed fractal again.
//
// ============================================================

const startupBaseline =
  new Set();


// ============================================================
// ACTIVE MONITOR
// ============================================================

let crtMonitorStarted =
  false;


let monitorTimer =
  null;


// ============================================================
// GENERIC FETCH
// ============================================================

async function fetchJson(
  url,
  options = {}
) {

  const controller =
    new AbortController();


  const timeout =
    setTimeout(
      () =>
        controller.abort(),
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

            ...(options.headers ||
              {}),
          },
        }
      );


    const text =
      await response.text();


    let data;


    try {

      data =
        JSON.parse(
          text
        );

    } catch {

      throw new Error(
        `Invalid JSON response from ${url}: ${text.slice(
          0,
          200
        )}`
      );
    }


    if (
      !response.ok
    ) {

      throw new Error(
        `HTTP ${response.status} from ${url}: ${
          data?.msg ||
          data?.message ||
          text.slice(
            0,
            200
          )
        }`
      );
    }


    return data;

  } finally {

    clearTimeout(
      timeout
    );
  }
}


// ============================================================
// MEXC TIMEFRAME
// ============================================================

function getMexcInterval(
  timeframe
) {

  const intervals = {

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
    intervals[
      timeframe
    ] ||
    "Min15"
  );
}


// ============================================================
// OANDA TIMEFRAME
// ============================================================

function getOandaGranularity(
  timeframe
) {

  const granularities = {

    "5m":
      "M5",

    "15m":
      "M15",

    "30m":
      "M30",

    "1h":
      "H1",

    "4h":
      "H4",

    "1d":
      "D",
  };


  return (
    granularities[
      timeframe
    ] ||
    "M15"
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
  )
    .padStart(
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
// CURRENT CRT CANDLE
// ============================================================
//
// Kept for compatibility with the existing bot commands.
//
// ============================================================

export function getCurrentCRT(
  timeframe = DEFAULT_TIMEFRAME
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
          .join(
            ", "
          )
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


  let endYear =
    now.year;


  let endMonth =
    now.month;


  let endDay =
    now.day;


  if (
    endTotalMinutes >=
    1440
  ) {

    const next =
      new Date(
        Date.UTC(
          now.year,
          now.month - 1,
          now.day
        )
      );


    next.setUTCDate(
      next.getUTCDate() +
      1
    );


    endYear =
      next.getUTCFullYear();


    endMonth =
      next.getUTCMonth() +
      1;


    endDay =
      next.getUTCDate();
  }


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
    Date.UTC(
      endYear,
      endMonth - 1,
      endDay,
      endHour - 8,
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
  timeframe = DEFAULT_TIMEFRAME
) {

  const crt =
    getCurrentCRT(
      timeframe
    );


  let remaining =
    crt.endTimestamp -
    Date.now();


  if (
    remaining <
    0
  ) {

    remaining =
      0;
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
  timeframe = DEFAULT_TIMEFRAME
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
// MEXC SYMBOL NORMALIZATION
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
//
// MEXC Futures contract detail endpoint:
//
// GET /api/v1/contract/detail
//
// Only active USDT-settled Futures contracts are returned.
//
// Spot is never requested.
//
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


  const url =
    `${MEXC_BASE_URL}/api/v1/contract/detail`;


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
        (contract) => {

          const symbol =
            normalizeMexcSymbol(
              contract.symbol
            );


          const quoteCoin =
            String(
              contract.quoteCoin ||
              ""
            )
              .toUpperCase();


          const settleCoin =
            String(
              contract.settleCoin ||
              ""
            )
              .toUpperCase();


          const state =
            Number(
              contract.state
            );


          const isUsdt =
            quoteCoin ===
              "USDT" ||
            settleCoin ===
              "USDT" ||
            symbol.endsWith(
              "USDT"
            );


          const active =
            !Number.isFinite(
              state
            ) ||
            state ===
              0;


          return (
            Boolean(
              symbol
            ) &&
            isUsdt &&
            active
          );
        }
      )

      .map(
        (contract) =>
          normalizeMexcSymbol(
            contract.symbol
          )
      )

      .filter(
        Boolean
      );


  const unique =
    [
      ...new Set(
        symbols
      ),
    ];


  mexcSymbolsCache =
    unique;


  mexcSymbolsCacheTime =
    now;


  console.log(
    `[CRT] MEXC Futures symbols loaded: ${unique.length}`
  );


  return unique;
}


// ============================================================
// MEXC KLINE
// ============================================================
//
// Endpoint:
//
// /api/v1/contract/kline/{symbol}
//
// ============================================================

async function fetchMexcCandles(
  symbol,
  timeframe
) {

  const interval =
    getMexcInterval(
      timeframe
    );


  const url =
    `${MEXC_BASE_URL}` +
    `/api/v1/contract/kline/` +
    `${encodeURIComponent(
      symbol
    )}` +
    `?interval=${encodeURIComponent(
      interval
    )}` +
    `&limit=${CANDLE_LIMIT}`;


  const response =
    await fetchJson(
      url
    );


  const data =
    response?.data;


  if (
    !data
  ) {

    return [];
  }


  // ----------------------------------------------------------
  // MEXC common Futures response format:
  //
  // {
  //   time: [],
  //   open: [],
  //   close: [],
  //   high: [],
  //   low: [],
  //   vol: []
  // }
  //
  // ----------------------------------------------------------

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
          Number(
            data.time[
              i
            ]
          ) *
          1000,

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
            0
          ),
      };


      if (
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
      ) {

        candles.push(
          candle
        );
      }
    }


    return candles
      .sort(
        (
          a,
          b
        ) =>
          a.timestamp -
          b.timestamp
      );
  }


  // ----------------------------------------------------------
  // Array response fallback
  // ----------------------------------------------------------

  if (
    Array.isArray(
      data
    )
  ) {

    return data

      .map(
        (row) => {

          if (
            Array.isArray(
              row
            )
          ) {

            return {

              timestamp:
                Number(
                  row[0]
                ) *
                1000,

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
              Number(
                row.time
              ) *
              1000,

            open:
              Number(
                row.open
              ),

            high:
              Number(
                row.high
              ),

            low:
              Number(
                row.low
              ),

            close:
              Number(
                row.close
              ),

            volume:
              Number(
                row.vol ||
                row.volume ||
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
// OANDA REQUEST HEADERS
// ============================================================

function getOandaHeaders() {

  return {

    Authorization:
      `Bearer ${OANDA_API_KEY}`,

    Accept:
      "application/json",
  };
}


// ============================================================
// GET OANDA INSTRUMENTS
// ============================================================
//
// OANDA account instruments endpoint returns the instruments
// actually available to the account.
//
// This means XAUUSD comes from OANDA rather than MEXC.
//
// ============================================================

async function getOandaInstruments() {

  if (
    !OANDA_API_KEY ||
    !OANDA_ACCOUNT_ID
  ) {

    console.warn(
      "[CRT] OANDA credentials are not configured."
    );


    return [];
  }


  const now =
    Date.now();


  if (
    oandaInstrumentsCache &&
    now -
      oandaInstrumentsCacheTime <
      OANDA_CACHE_TIME
  ) {

    return oandaInstrumentsCache;
  }


  const url =
    `${OANDA_BASE_URL}` +
    `/v3/accounts/` +
    `${encodeURIComponent(
      OANDA_ACCOUNT_ID
    )}` +
    `/instruments`;


  const response =
    await fetchJson(
      url,
      {
        headers:
          getOandaHeaders(),
      }
    );


  const instruments =
    Array.isArray(
      response?.instruments
    )
      ? response.instruments
      : [];


  oandaInstrumentsCache =
    instruments
      .map(
        (instrument) =>
          instrument.name
      )
      .filter(
        Boolean
      );


  oandaInstrumentsCacheTime =
    now;


  console.log(
    `[CRT] OANDA instruments loaded: ${oandaInstrumentsCache.length}`
  );


  return oandaInstrumentsCache;
}


// ============================================================
// OANDA KLINE
// ============================================================

async function fetchOandaCandles(
  instrument,
  timeframe
) {

  if (
    !OANDA_API_KEY ||
    !OANDA_ACCOUNT_ID
  ) {

    return [];
  }


  const granularity =
    getOandaGranularity(
      timeframe
    );


  const url =
    `${OANDA_BASE_URL}` +
    `/v3/instruments/` +
    `${encodeURIComponent(
      instrument
    )}` +
    `/candles` +
    `?granularity=${granularity}` +
    `&count=${CANDLE_LIMIT}` +
    `&price=M`;


  const response =
    await fetchJson(
      url,
      {
        headers:
          getOandaHeaders(),
      }
    );


  const candles =
    Array.isArray(
      response?.candles
    )
      ? response.candles
      : [];


  return candles

    .filter(
      (candle) =>
        candle.complete ===
        true
    )

    .map(
      (candle) => {

        const mid =
          candle.mid ||
          {};


        return {

          timestamp:
            new Date(
              candle.time
            ).getTime(),

          open:
            Number(
              mid.o
            ),

          high:
            Number(
              mid.h
            ),

          low:
            Number(
              mid.l
            ),

          close:
            Number(
              mid.c
            ),

          volume:
            Number(
              candle.volume ||
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
      (candle) =>
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
// RSI STATUS
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
// RACHEL T — REGULAR FRACTAL
// ============================================================
//
// Exact source:
//
// isRegularFractal(mode) =>
//
// mode == 1 ?
//   high[4] < high[3] and
//   high[3] < high[2] and
//   high[2] > high[1] and
//   high[1] > high[0]
//
// mode == -1 ?
//   low[4] > low[3] and
//   low[3] > low[2] and
//   low[2] < low[1] and
//   low[1] < low[0]
//
// ============================================================

function isRegularTop(
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
      c3.high &&

    c3.high <
      c2.high &&

    c2.high >
      c1.high &&

    c1.high >
      c0.high
  );
}


// ============================================================
// RACHEL T — REGULAR BOTTOM
// ============================================================

function isRegularBottom(
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
      c3.low &&

    c3.low >
      c2.low &&

    c2.low <
      c1.low &&

    c1.low <
      c0.low
  );
}


// ============================================================
// RACHEL T — BILL WILLIAMS FRACTAL
// ============================================================
//
// EXACT SOURCE:
//
// isBWFractal(mode) =>
//
// mode == 1 ?
//   high[4] < high[2] and
//   high[3] <= high[2] and
//   high[2] >= high[1] and
//   high[2] > high[0]
//
// mode == -1 ?
//   low[4] > low[2] and
//   low[3] >= low[2] and
//   low[2] <= low[1] and
//   low[2] < low[0]
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
// RACHEL T — BILL WILLIAMS BOTTOM
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
//
// filterBW = false
// → isBWFractal
//
// filterBW = true
// → isRegularFractal
//
// This exactly follows the source.
//
// ============================================================

function isFilteredTop(
  candles,
  index
) {

  if (
    FILTER_BW
  ) {

    return isRegularTop(
      candles,
      index
    );
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

    return isRegularBottom(
      candles,
      index
    );
  }


  return isBWBottom(
    candles,
    index
  );
}


// ============================================================
// FIND LAST FILTERED FRACTAL
// ============================================================
//
// The source uses offset=-2.
//
// Therefore:
//
// index = current closed candle
// index-2 = actual fractal candle
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


  // ----------------------------------------------------------
  // Current final candle must be closed.
  // ----------------------------------------------------------

  const lastIndex =
    candles.length -
    1;


  // ----------------------------------------------------------
  // Search newest confirmed fractal.
  //
  // We intentionally do NOT inspect index = lastIndex
  // as a fractal because the original source needs
  // high[4] ... high[0].
  //
  // ----------------------------------------------------------

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
      };
    }
  }


  return null;
}


// ============================================================
// FIND NEWEST FRACTAL AFTER TIMESTAMP
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
      };
    }
  }


  return null;
}


// ============================================================
// PROCESS ONE MARKET
// ============================================================

async function processMarket(
  client,
  provider,
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


  // ----------------------------------------------------------
  // Calculate RSI using the completed candle set.
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


  // ----------------------------------------------------------
  // State key
  // ----------------------------------------------------------

  const stateKey =
    `${provider}|${symbol}|${timeframe}`;


  const previousSignalTimestamp =
    signalState.get(
      stateKey
    );


  // ----------------------------------------------------------
  // Find newest confirmed Rachel fractal.
  // ----------------------------------------------------------

  let signal;


  if (
    Number.isFinite(
      previousSignalTimestamp
    )
  ) {

    signal =
      findNewestFractalAfter(
        candles,
        previousSignalTimestamp
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
  //
  // First scan after Railway restart:
  //
  // Do not send the old fractal.
  //
  // Register it as the baseline.
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
      `[CRT] Baseline ${provider} ${symbol} ${timeframe}: ${signal.fractalType} ${signal.timestamp}`
    );


    return;
  }


  // ----------------------------------------------------------
  // Duplicate protection
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
  // Save state BEFORE sending.
  //
  // This prevents duplicate alerts if Discord/API retries.
  // ----------------------------------------------------------

  signalState.set(
    stateKey,
    signal.timestamp
  );


  // ----------------------------------------------------------
  // Send signal
  // ----------------------------------------------------------

  await sendCRTSignal(
    client,
    {
      provider,

      symbol,

      timeframe,

      signal,

      rsi,

      rsiState,

      candles,
    }
  );
}


// ============================================================
// PRICE FORMAT
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
// RSI FORMAT
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


  return rsi.toFixed(
    2
  );
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
// SIGNAL EMBED
// ============================================================

function createSignalEmbed(
  data
) {

  const {

    provider,

    symbol,

    timeframe,

    signal,

    rsi,

    rsiState,

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


  const emoji =
    isBuy
      ? "🟢"
      : "🔴";


  const title =
    isBuy
      ? "CRT BUY SIGNAL"
      : "CRT SELL SIGNAL";


  const embed =
    new EmbedBuilder()
      .setTitle(
        `${emoji} ${title}`
      )
      .setDescription(
        `**${symbol}**`
      )
      .addFields(

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
            "SIGNAL PRICE",

          value:
            `\`${formatPrice(
              signal.price
            )}\``,

          inline:
            true,
        },

        {
          name:
            "RSI",

          value:
            `\`${formatRSI(
              rsi
            )}\``,

          inline:
            true,
        },

        {
          name:
            "RSI STATUS",

          value:
            `\`${rsiState}\``,

          inline:
            true,
        },

        {
          name:
            "SIGNAL",

          value:
            `\`${signal.type}\``,

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
          "CRT • PDYN",
      })
      .setTimestamp(
        new Date(
          signal.timestamp
        )
      );


  return embed;
}


// ============================================================
// SEND SIGNAL
// ============================================================

async function sendCRTSignal(
  client,
  data
) {

  try {

    const timeframe =
      data.timeframe;


    const channelId =
      CHANNELS[
        timeframe
      ];


    if (
      !channelId
    ) {

      console.warn(
        `[CRT] No Discord channel configured for ${timeframe}.`
      );


      return;
    }


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


      return;
    }


    if (
      typeof channel.send !==
      "function"
    ) {

      console.warn(
        `[CRT] Discord channel cannot receive messages: ${channelId}`
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

      `${data.provider} | ` +

      `${data.symbol} | ` +

      `${data.timeframe} | ` +

      `${data.signal.type} | ` +

      `${formatPrice(
        data.signal.price
      )} | ` +

      `RSI ${formatRSI(
        data.rsi
      )} ${data.rsiState}`
    );

  } catch (
    error
  ) {

    console.error(
      `[CRT] Failed to send signal ${data.symbol} ${data.timeframe}:`,
      error
    );
  }
}


// ============================================================
// CONCURRENCY HELPER
// ============================================================

async function runWithConcurrency(
  items,
  concurrency,
  worker
) {

  const results =
    [];


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


      const item =
        items[
          index
        ];


      try {

        results[
          index
        ] =
          await worker(
            item
          );

      } catch (
        error
      ) {

        results[
          index
        ] = {

          error,
        };
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
      () =>
        runner()
    )

  );


  return results;
}


// ============================================================
// SCAN MEXC
// ============================================================

async function scanMexc(
  client
) {

  let symbols;


  try {

    symbols =
      await getMexcFuturesSymbols();

  } catch (
    error
  ) {

    console.error(
      "[CRT] Failed to load MEXC Futures symbols:",
      error
    );


    return;
  }


  if (
    symbols.length ===
    0
  ) {

    console.warn(
      "[CRT] No MEXC Futures symbols available."
    );


    return;
  }


  for (
    const timeframe
    of Object.keys(
      TIMEFRAMES
    )
  ) {

    const jobs =
      symbols.map(
        (symbol) => ({
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
              job.timeframe
            );


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

            `[CRT] MEXC ${job.symbol} ${job.timeframe}:`,

            error.message
          );
        }
      }
    );
  }
}


// ============================================================
// SCAN OANDA
// ============================================================

async function scanOanda(
  client
) {

  if (
    !OANDA_API_KEY ||
    !OANDA_ACCOUNT_ID
  ) {

    console.warn(
      "[CRT] OANDA scan skipped: OANDA_API_KEY or OANDA_ACCOUNT_ID missing."
    );


    return;
  }


  let instruments;


  try {

    instruments =
      await getOandaInstruments();

  } catch (
    error
  ) {

    console.error(
      "[CRT] Failed to load OANDA instruments:",
      error
    );


    return;
  }


  if (
    instruments.length ===
    0
  ) {

    return;
  }


  // ----------------------------------------------------------
  // We scan all instruments available to the OANDA account.
  // XAU_USD is therefore obtained from OANDA itself.
  // ----------------------------------------------------------

  for (
    const timeframe
    of Object.keys(
      TIMEFRAMES
    )
  ) {

    const jobs =
      instruments.map(
        (
          instrument
        ) => ({
          instrument,

          timeframe,
        })
      );


    await runWithConcurrency(

      jobs,

      4,

      async (
        job
      ) => {

        try {

          const candles =
            await fetchOandaCandles(
              job.instrument,
              job.timeframe
            );


          await processMarket(

            client,

            "OANDA",

            job.instrument,

            job.timeframe,

            candles
          );

        } catch (
          error
        ) {

          console.error(

            `[CRT] OANDA ${job.instrument} ${job.timeframe}:`,

            error.message
          );
        }
      }
    );
  }
}


// ============================================================
// ONE FULL SCAN
// ============================================================

async function runFullScan(
  client
) {

  console.log(
    "[CRT] Starting market scan..."
  );


  // ----------------------------------------------------------
  // MEXC Futures
  // ----------------------------------------------------------

  await scanMexc(
    client
  );


  // ----------------------------------------------------------
  // OANDA
  // ----------------------------------------------------------

  await scanOanda(
    client
  );


  console.log(
    "[CRT] Market scan completed."
  );
}


// ============================================================
// CRT MONITOR
// ============================================================

export function startCRTMonitor(
  client
) {

  if (
    crtMonitorStarted
  ) {

    console.warn(
      "[CRT] Monitor is already running."
    );


    return;
  }


  if (
    CRT_CONFIG.enabled ===
    false
  ) {

    console.log(
      "[CRT] CRT system is disabled."
    );


    return;
  }


  if (
    CRT_CONFIG.autoAlerts ===
    false
  ) {

    console.log(
      "[CRT] Automatic CRT signals are disabled."
    );


    return;
  }


  if (
    !client
  ) {

    console.error(
      "[CRT] Discord client is missing."
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
    `[CRT] Timezone: ${CRT_TIMEZONE}`
  );


  console.log(
    `[CRT] Timeframes: ${
      Object.keys(
        TIMEFRAMES
      ).join(
        ", "
      )
    }`
  );


  console.log(
    "[CRT] Crypto provider: MEXC FUTURES ONLY"
  );


  console.log(
    "[CRT] Forex/metals provider: OANDA"
  );


  console.log(
    "[CRT] Rachel T filterBW: " +
    `${FILTER_BW}`
  );


  console.log(
    "[CRT] Filtered Top: " +
    `${FILTERED_TOP_ENABLED}`
  );


  console.log(
    "[CRT] Filtered Bottom: " +
    `${FILTERED_BOTTOM_ENABLED}`
  );


  console.log(
    `[CRT] RSI: ${RSI_PERIOD} / ${RSI_OVERBOUGHT} / ${RSI_OVERSOLD}`
  );


  console.log(
    "============================================================"
  );


  // ----------------------------------------------------------
  // FIRST SCAN
  //
  // This establishes startup baselines.
  // No old signals are sent.
  // ----------------------------------------------------------

  runFullScan(
    client
  ).catch(
    (error) => {

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
          (error) => {

            console.error(
              "[CRT] Scan failed:",
              error
            );
          }
        );

      },

      CHECK_INTERVAL
    );
}


// ============================================================
// STOP CRT MONITOR
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
// GET ALL CRT STATUSES
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
// MANUAL FRACTAL TEST
// ============================================================
//
// Useful for debugging.
//
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
// SERVICE INFORMATION
// ============================================================

export function getCRTServiceInfo() {

  return {

    providerCrypto:
      "MEXC FUTURES",

    providerForex:
      "OANDA",

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

    checkInterval:
      CHECK_INTERVAL,

    timezone:
      CRT_TIMEZONE,
  };
}


// ============================================================
// STARTUP LOG
// ============================================================

console.log(
  "[CRT] Signal service loaded."
);


console.log(
  "[CRT] Rachel T Filtered Top/Bottom logic enabled."
);


console.log(
  "[CRT] MEXC Spot disabled."
);


console.log(
  "[CRT] MEXC Futures enabled."
);


console.log(
  "[CRT] OANDA enabled for Forex/Metals."
);
