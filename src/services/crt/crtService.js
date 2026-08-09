import { EmbedBuilder } from "discord.js";

import botConfig from "../../config/bot.js";


// ============================================================
// PDYN CRT SIGNAL ENGINE
// ============================================================
//
// DATA SOURCES
//
// CRYPTO
//   → MEXC FUTURES ONLY
//
// FOREX / METALS
//   → OANDA
//
// NO MEXC SPOT
// NO HARD-CODED XAU_USDT
//
// SIGNAL SOURCE
//
//   Filtered Top Fractal
//          ↓
//        SELL
//
//   Filtered Bottom Fractal
//          ↓
//         BUY
//
// RSI is DISPLAY ONLY.
//
// ============================================================


// ============================================================
// CONFIGURATION
// ============================================================

const CRT_CONFIG =
  botConfig.crt || {};


// ============================================================
// TIMEZONE
// ============================================================

const CRT_TIMEZONE =
  CRT_CONFIG.timezone ||
  "Asia/Manila";


// ============================================================
// DEFAULT TIMEFRAME
// ============================================================

const DEFAULT_TIMEFRAME =
  CRT_CONFIG.timeframe ||
  "15m";


// ============================================================
// TIMEFRAMES
// ============================================================

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


// ============================================================
// DISCORD CHANNELS
// ============================================================

const CHANNELS =
  CRT_CONFIG.channels || {};


// ============================================================
// RSI
// ============================================================

const RSI_PERIOD =
  14;

const RSI_OVERBOUGHT =
  70;

const RSI_OVERSOLD =
  30;


// ============================================================
// FRACTAL SETTINGS
// ============================================================
//
// These are the ONLY Rachel fractal conditions used.
//
// ============================================================

const USE_FILTERED_TOP =
  true;

const USE_FILTERED_BOTTOM =
  true;


// ============================================================
// FRACTAL MODE
// ============================================================
//
// Rachel source:
//
// filterBW = false
//
// false:
// Bill Williams fractal
//
// true:
// Regular fractal
//
// ============================================================

const FILTER_BW =
  CRT_CONFIG.filterBW === true;


// ============================================================
// API CONFIGURATION
// ============================================================
//
// IMPORTANT:
//
// MEXC = Futures only
//
// OANDA = Forex / Metals
//
// ============================================================

const MEXC_FUTURES_API =
  "https://contract.mexc.com";

const OANDA_API =
  "https://api-fxtrade.oanda.com";

const OANDA_PRACTICE_API =
  "https://api-fxpractice.oanda.com";


// ============================================================
// API KEYS
// ============================================================

const OANDA_API_KEY =
  process.env.OANDA_API_KEY ||
  "";

const OANDA_ACCOUNT_ID =
  process.env.OANDA_ACCOUNT_ID ||
  "";


// ============================================================
// OANDA ENVIRONMENT
// ============================================================

const OANDA_ENVIRONMENT =
  String(
    process.env.OANDA_ENVIRONMENT ||
    "live"
  ).toLowerCase();


// ============================================================
// OANDA API BASE
// ============================================================

const OANDA_BASE_URL =
  OANDA_ENVIRONMENT ===
  "practice"
    ? OANDA_PRACTICE_API
    : OANDA_API;


// ============================================================
// CHECK INTERVAL
// ============================================================

const configuredInterval =
  Number(
    CRT_CONFIG.checkInterval
  );

const CHECK_INTERVAL =
  Number.isFinite(
    configuredInterval
  ) &&
  configuredInterval >=
    1000
    ? configuredInterval
    : 5000;


// ============================================================
// CANDLE REQUEST LIMIT
// ============================================================

const CANDLE_LIMIT =
  500;


// ============================================================
// MEXC INTERVALS
// ============================================================
//
// MEXC FUTURES intervals.
//
// ============================================================

const MEXC_INTERVALS = {

  "1m":
    "Min1",

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


// ============================================================
// OANDA GRANULARITIES
// ============================================================

const OANDA_GRANULARITIES = {

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


// ============================================================
// FORMAT PRICE
// ============================================================

function formatPrice(
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

    return "N/A";
  }


  if (
    number >=
    1000
  ) {

    return number.toLocaleString(
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
    number >=
    1
  ) {

    return number.toFixed(
      2
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

  if (
    !Number.isFinite(
      value
    )
  ) {

    return "N/A";
  }


  return value.toFixed(
    2
  );
}


// ============================================================
// TIMEFRAME LABEL
// ============================================================

function getTimeframeLabel(
  timeframe
) {

  const labels = {

    "5m":
      "5M",

    "15m":
      "15M",

    "30m":
      "30M",

    "1h":
      "1H",

    "4h":
      "4H",

    "1d":
      "1D",
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
// FETCH JSON
// ============================================================

async function fetchJSON(
  url,
  options = {}
) {

  const response =
    await fetch(
      url,
      {
        ...options,

        signal:
          AbortSignal.timeout(
            20000
          ),
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
      `Invalid JSON response: ${text.slice(
        0,
        300
      )}`
    );
  }


  if (
    !response.ok
  ) {

    throw new Error(
      `HTTP ${response.status}: ${
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
}


// ============================================================
// MARKET CLASSIFICATION
// ============================================================
//
// The caller/configuration determines the market.
//
// crypto:
//   MEXC FUTURES
//
// forex/metals:
//   OANDA
//
// ============================================================

function normalizeMarket(
  market
) {

  const value =
    String(
      market ||
      ""
    )
    .trim()
    .toLowerCase();


  if (
    value ===
      "crypto" ||
    value ===
      "cryptocurrency"
  ) {

    return "crypto";
  }


  if (
    value ===
      "forex" ||
    value ===
      "fx" ||
    value ===
      "metal" ||
    value ===
      "metals"
  ) {

    return "forex";
  }


  return null;
}


// ============================================================
// NORMALIZE SYMBOL
// ============================================================

function normalizeSymbol(
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
// DISPLAY SYMBOL
// ============================================================

function getDisplaySymbol(
  instrument
) {

  return (
    instrument.display ||
    instrument.symbol ||
    ""
  );
}


// ============================================================
// MEXC SYMBOL NORMALIZATION
// ============================================================
//
// This does NOT hard-code an instrument.
//
// The requested symbol is resolved against the MEXC
// Futures contract list.
//
// ============================================================

function normalizeMEXCSymbol(
  symbol
) {

  const clean =
    normalizeSymbol(
      symbol
    );


  if (
    clean.endsWith(
      ".P"
    )
  ) {

    return clean.slice(
      0,
      -2
    );
  }


  return clean;
}


// ============================================================
// OANDA SYMBOL NORMALIZATION
// ============================================================
//
// User-facing:
//
// XAUUSD
//
// OANDA:
//
// XAU_USD
//
// ============================================================

function normalizeOandaSymbol(
  symbol
) {

  const clean =
    normalizeSymbol(
      symbol
    );


  if (
    clean.includes(
      "_"
    )
  ) {

    return clean;
  }


  if (
    clean ===
    "XAUUSD"
  ) {

    return "XAU_USD";
  }


  if (
    clean.length ===
    6
  ) {

    return (
      clean.slice(
        0,
        3
      ) +
      "_" +
      clean.slice(
        3,
        6
      )
    );
  }


  return clean;
}


// ============================================================
// GET MEXC FUTURES CONTRACTS
// ============================================================

async function getMEXCFuturesContracts() {

  const url =
    `${MEXC_FUTURES_API}/api/v1/contract/detail`;


  const response =
    await fetchJSON(
      url
    );


  if (
    !response ||
    response.success !==
      true ||
    !Array.isArray(
      response.data
    )
  ) {

    throw new Error(
      "MEXC Futures contract list returned an invalid response."
    );
  }


  return response.data;
}


// ============================================================
// RESOLVE MEXC FUTURES SYMBOL
// ============================================================
//
// IMPORTANT:
//
// We never invent XAU_USDT.
//
// We search the actual MEXC Futures contract list.
//
// ============================================================

async function resolveMEXCFuturesSymbol(
  requestedSymbol
) {

  const requested =
    normalizeMEXCSymbol(
      requestedSymbol
    );


  const contracts =
    await getMEXCFuturesContracts();


  const exact =
    contracts.find(
      (
        contract
      ) =>
        normalizeSymbol(
          contract.symbol
        ) ===
        requested
    );


  if (
    exact
  ) {

    return exact.symbol;
  }


  const withoutSuffix =
    requested.endsWith(
      "USDT"
    )
      ? requested
      : `${requested}USDT`;


  const match =
    contracts.find(
      (
        contract
      ) =>
        normalizeSymbol(
          contract.symbol
        ) ===
        withoutSuffix
    );


  if (
    match
  ) {

    return match.symbol;
  }


  throw new Error(
    `MEXC Futures symbol "${requestedSymbol}" was not found in the live Futures contract list.`
  );
}


// ============================================================
// MEXC FUTURES CANDLES
// ============================================================

async function getMEXCFuturesCandles(
  symbol,
  timeframe
) {

  const interval =
    MEXC_INTERVALS[
      timeframe
    ];


  if (
    !interval
  ) {

    throw new Error(
      `MEXC Futures does not support timeframe ${timeframe}.`
    );
  }


  const contract =
    await resolveMEXCFuturesSymbol(
      symbol
    );


  const url =
    new URL(
      `${MEXC_FUTURES_API}/api/v1/contract/kline/${contract}`
    );


  url.searchParams.set(
    "interval",
    interval
  );


  url.searchParams.set(
    "limit",
    String(
      CANDLE_LIMIT
    )
  );


  const response =
    await fetchJSON(
      url
    );


  if (
    !response ||
    response.success !==
      true ||
    !response.data
  ) {

    throw new Error(
      `Invalid MEXC Futures candle response for ${contract} ${timeframe}.`
    );
  }


  const data =
    response.data;


  const times =
    Array.isArray(
      data.time
    )
      ? data.time
      : [];


  const opens =
    Array.isArray(
      data.open
    )
      ? data.open
      : [];


  const highs =
    Array.isArray(
      data.high
    )
      ? data.high
      : [];


  const lows =
    Array.isArray(
      data.low
    )
      ? data.low
      : [];


  const closes =
    Array.isArray(
      data.close
    )
      ? data.close
      : [];


  const volumes =
    Array.isArray(
      data.vol
    )
      ? data.vol
      : [];


  const count =
    Math.min(
      times.length,
      opens.length,
      highs.length,
      lows.length,
      closes.length
    );


  const minutes =
    Number(
      TIMEFRAMES[
        timeframe
      ]
    );


  const duration =
    minutes *
    60 *
    1000;


  const now =
    Date.now();


  const candles =
    [];


  for (
    let i = 0;
    i <
      count;
    i++
  ) {

    const openTime =
      Number(
        times[i]
      ) *
      1000;


    const open =
      Number(
        opens[i]
      );


    const high =
      Number(
        highs[i]
      );


    const low =
      Number(
        lows[i]
      );


    const close =
      Number(
        closes[i]
      );


    const volume =
      Number(
        volumes[i] ||
        0
      );


    if (
      ![
        openTime,
        open,
        high,
        low,
        close,
      ].every(
        Number.isFinite
      )
    ) {

      continue;
    }


    const closeTime =
      openTime +
      duration;


    candles.push({

      time:
        openTime,

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


  return {

    provider:
      "MEXC_FUTURES",

    symbol:
      contract,

    candles:
      candles.sort(
        (
          a,
          b
        ) =>
          a.time -
          b.time
      ),
  };
}


// ============================================================
// OANDA CANDLES
// ============================================================

async function getOandaCandles(
  symbol,
  timeframe
) {

  if (
    !OANDA_API_KEY
  ) {

    throw new Error(
      "OANDA_API_KEY is not configured."
    );
  }


  const granularity =
    OANDA_GRANULARITIES[
      timeframe
    ];


  if (
    !granularity
  ) {

    throw new Error(
      `OANDA does not support timeframe ${timeframe}.`
    );
  }


  const instrument =
    normalizeOandaSymbol(
      symbol
    );


  const url =
    new URL(
      `${OANDA_BASE_URL}/v3/instruments/${instrument}/candles`
    );


  url.searchParams.set(
    "granularity",
    granularity
  );


  url.searchParams.set(
    "count",
    String(
      CANDLE_LIMIT
    )
  );


  url.searchParams.set(
    "price",
    "M"
  );


  const response =
    await fetchJSON(
      url,
      {
        headers: {

          Authorization:
            `Bearer ${OANDA_API_KEY}`,

          Accept:
            "application/json",
        },
      }
    );


  if (
    !response ||
    !Array.isArray(
      response.candles
    )
  ) {

    throw new Error(
      `Invalid OANDA candle response for ${instrument} ${timeframe}.`
    );
  }


  const candles =
    response.candles
      .map(
        (
          candle
        ) => {

          const open =
            Number(
              candle.mid?.o
            );


          const high =
            Number(
              candle.mid?.h
            );


          const low =
            Number(
              candle.mid?.l
            );


          const close =
            Number(
              candle.mid?.c
            );


          const time =
            Date.parse(
              candle.time
            );


          return {

            time,

            open,

            high,

            low,

            close,

            volume:
              Number(
                candle.volume ||
                0
              ),

            closed:
              candle.complete ===
              true,
          };
        }
      )
      .filter(
        (
          candle
        ) =>
          Number.isFinite(
            candle.time
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


  return {

    provider:
      "OANDA",

    symbol:
      instrument,

    candles,
  };
}


// ============================================================
// GET MARKET CANDLES
// ============================================================

async function getMarketCandles(
  instrument,
  timeframe
) {

  const market =
    normalizeMarket(
      instrument.market
    );


  if (
    market ===
    "crypto"
  ) {

    return getMEXCFuturesCandles(
      instrument.symbol,
      timeframe
    );
  }


  if (
    market ===
    "forex"
  ) {

    return getOandaCandles(
      instrument.symbol,
      timeframe
    );
  }


  throw new Error(
    `Unknown CRT market for ${instrument.symbol}.`
  );
}


// ============================================================
// RSI
// ============================================================

function calculateRSI(
  closes,
  period =
    RSI_PERIOD
) {

  if (
    !Array.isArray(
      closes
    ) ||
    closes.length <
      period + 1
  ) {

    return null;
  }


  let gain =
    0;


  let loss =
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
      change >=
      0
    ) {

      gain +=
        change;

    } else {

      loss +=
        Math.abs(
          change
        );
    }
  }


  let averageGain =
    gain /
    period;


  let averageLoss =
    loss /
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


    const currentGain =
      change >
      0
        ? change
        : 0;


    const currentLoss =
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
        currentGain
      ) /
      period;


    averageLoss =
      (
        averageLoss *
          (
            period -
            1
          ) +
        currentLoss
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


  const rs =
    averageGain /
    averageLoss;


  return (
    100 -
    (
      100 /
      (
        1 + rs
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
    rsi <=
    RSI_OVERSOLD
  ) {

    return "OVERSOLD";
  }


  if (
    rsi >=
    RSI_OVERBOUGHT
  ) {

    return "OVERBOUGHT";
  }


  return "NEUTRAL";
}


// ============================================================
// RACHEL FILTERED TOP
// ============================================================
//
// Exact source logic:
//
// filterBW ? regular : BW
//
// BW:
//
// high[4] < high[2]
// high[3] <= high[2]
// high[2] >= high[1]
// high[2] > high[0]
//
// ============================================================

function isFilteredTop(
  candles,
  index
) {

  if (
    index <
    4
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
    FILTER_BW
  ) {

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
// RACHEL FILTERED BOTTOM
// ============================================================
//
// Exact source logic:
//
// filterBW ? regular : BW
//
// BW:
//
// low[4] > low[2]
// low[3] >= low[2]
// low[2] <= low[1]
// low[2] < low[0]
//
// ============================================================

function isFilteredBottom(
  candles,
  index
) {

  if (
    index <
    4
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
    FILTER_BW
  ) {

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
// FIND NEW FRACTAL
// ============================================================
//
// Rachel plots the fractal at [2].
//
// Therefore:
//
// index
//   ↓
// confirmation candle
//
// index - 2
//   ↓
// actual fractal candle
//
// We use ONLY CLOSED candles.
//
// ============================================================

function findLatestConfirmedFractal(
  candles
) {

  let latest =
    null;


  for (
    let i = 4;
    i <
      candles.length;
    i++
  ) {

    const fractalIndex =
      i - 2;


    if (
      USE_FILTERED_TOP &&
      isFilteredTop(
        candles,
        i
      )
    ) {

      latest = {

        type:
          "SELL",

        index:
          fractalIndex,

        time:
          candles[
            fractalIndex
          ].time,

        price:
          candles[
            fractalIndex
          ].high,

        signalPrice:
          candles[
            fractalIndex
          ].close,

        confirmationTime:
          candles[
            i
          ].time,
      };
    }


    if (
      USE_FILTERED_BOTTOM &&
      isFilteredBottom(
        candles,
        i
      )
    ) {

      const bottom =
        {

          type:
            "BUY",

          index:
            fractalIndex,

          time:
            candles[
              fractalIndex
            ].time,

          price:
            candles[
              fractalIndex
            ].low,

          signalPrice:
            candles[
              fractalIndex
            ].close,

          confirmationTime:
            candles[
              i
            ].time,
        };


      if (
        !latest ||
        bottom.confirmationTime >
          latest.confirmationTime
      ) {

        latest =
          bottom;
      }
    }
  }


  return latest;
}


// ============================================================
// ANALYZE MARKET
// ============================================================

function analyzeMarket(
  candles
) {

  const closed =
    candles.filter(
      (
        candle
      ) =>
        candle.closed
    );


  if (
    closed.length <
    RSI_PERIOD + 5
  ) {

    return null;
  }


  const fractal =
    findLatestConfirmedFractal(
      closed
    );


  if (
    !fractal
  ) {

    return null;
  }


  const closes =
    closed.map(
      (
        candle
      ) =>
        candle.close
    );


  const rsi =
    calculateRSI(
      closes
    );


  return {

    ...fractal,

    rsi,

    rsiState:
      getRSIState(
        rsi
      ),
  };
}


// ============================================================
// BUILD SIGNAL
// ============================================================

function buildSignal(
  instrument,
  timeframe,
  providerData,
  analysis
) {

  if (
    !analysis
  ) {

    return null;
  }


  return {

    id:
      [
        instrument.market,

        instrument.symbol,

        timeframe,

        analysis.type,

        analysis.confirmationTime,
      ].join(
        ":"
      ),

    market:
      instrument.market,

    symbol:
      getDisplaySymbol(
        instrument
      ),

    provider:
      providerData.provider,

    timeframe,

    direction:
      analysis.type,

    signalPrice:
      analysis.signalPrice,

    fractalPrice:
      analysis.price,

    fractalTime:
      analysis.time,

    confirmationTime:
      analysis.confirmationTime,

    rsi:
      analysis.rsi,

    rsiState:
      analysis.rsiState,
  };
}


// ============================================================
// CREATE DISCORD EMBED
// ============================================================
//
// IMPORTANT:
//
// Do NOT expose:
//
// Rachel T
// Filtered Top Fractal
// Filtered Bottom Fractal
//
// The Discord output contains only:
//
// BUY / SELL
// Signal Price
// RSI
// RSI State
//
// ============================================================

function createSignalEmbed(
  signal
) {

  const isBuy =
    signal.direction ===
    "BUY";


  const emoji =
    isBuy
      ? "🟢"
      : "🔴";


  const timeframe =
    getTimeframeLabel(
      signal.timeframe
    );


  const embed =
    new EmbedBuilder();


  embed.setTitle(
    `${emoji} CRT SIGNAL — ${signal.symbol} · ${timeframe}`
  );


  embed.setDescription(
    `**${signal.direction}**`
  );


  embed.addFields(

    {
      name:
        "Signal Price",

      value:
        `\`${formatPrice(
          signal.signalPrice
        )}\``,

      inline:
        false,
    },


    {
      name:
        "RSI",

      value:
        `\`${formatRSI(
          signal.rsi
        )}\``,

      inline:
        true,
    },


    {
      name:
        "RSI State",

      value:
        `**${signal.rsiState}**`,

      inline:
        true,
    }
  );


  embed.setColor(
    isBuy
      ? "#57F287"
      : "#ED4245"
  );


  embed.setFooter({
    text:
      CRT_CONFIG.footer ||
      "CRT • PDYN",
  });


  embed.setTimestamp(
    new Date(
      signal.confirmationTime
    )
  );


  return embed;
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

    console.error(
      `[CRT] ${signal.timeframe}: Discord channel is not configured.`
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

      throw new Error(
        `Discord channel ${channelId} was not found.`
      );
    }


    if (
      typeof channel.send !==
      "function"
    ) {

      throw new Error(
        `Discord channel ${channelId} cannot send messages.`
      );
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
      `[CRT] SIGNAL SENT | ${signal.symbol} | ${signal.timeframe} | ${signal.direction}`
    );


    return true;

  } catch (
    error
  ) {

    console.error(
      `[CRT] Discord error | ${signal.timeframe}:`,
      error
    );


    return false;
  }
}


// ============================================================
// GET CONFIGURED INSTRUMENTS
// ============================================================
//
// bot.js:
//
// instruments: [
//
//   {
//     market: "crypto",
//     symbol: "BTCUSDT",
//     display: "BTCUSDT.P"
//   },
//
//   {
//     market: "forex",
//     symbol: "XAUUSD",
//     display: "XAUUSD"
//   }
//
// ]
//
// ============================================================

function getConfiguredInstruments() {

  const instruments =
    Array.isArray(
      CRT_CONFIG.instruments
    )
      ? CRT_CONFIG.instruments
      : [];


  return instruments
    .map(
      (
        item
      ) => {

        if (
          typeof item ===
          "string"
        ) {

          return {

            market:
              "crypto",

            symbol:
              normalizeSymbol(
                item
              ),

            display:
              normalizeSymbol(
                item
              ),
          };
        }


        return {

          market:
            normalizeMarket(
              item.market
            ),

          symbol:
            normalizeSymbol(
              item.symbol
            ),

          display:
            item.display ||
            normalizeSymbol(
              item.symbol
            ),
        };
      }
    )
    .filter(
      (
        item
      ) =>
        item.market &&
        item.symbol
    );
}


// ============================================================
// MONITOR STATE
// ============================================================

const monitorState =
  new Map();


// ============================================================
// GET STATE KEY
// ============================================================

function getStateKey(
  instrument,
  timeframe
) {

  return [

    instrument.market,

    instrument.symbol,

    timeframe,

  ].join(
    ":"
  );
}


// ============================================================
// PROCESS ONE MARKET / TIMEFRAME
// ============================================================

async function processInstrumentTimeframe(
  client,
  instrument,
  timeframe
) {

  const stateKey =
    getStateKey(
      instrument,
      timeframe
    );


  try {

    const providerData =
      await getMarketCandles(
        instrument,
        timeframe
      );


    const closed =
      providerData.candles.filter(
        (
          candle
        ) =>
          candle.closed
      );


    if (
      closed.length <
      RSI_PERIOD + 5
    ) {

      console.warn(
        `[CRT] ${instrument.symbol} ${timeframe} → insufficient closed candles (${closed.length})`
      );


      return;
    }


    const newestClosed =
      closed[
        closed.length - 1
      ];


    const newestClosedTime =
      newestClosed.time;


    const state =
      monitorState.get(
        stateKey
      );


    // ========================================================
    // FIRST RUN
    // ========================================================
    //
    // Do not resend an old signal after Railway restart.
    //
    // Register the latest already-closed candle.
    //
    // ========================================================

    if (
      !state
    ) {

      monitorState.set(
        stateKey,
        {

          lastClosedTime:
            newestClosedTime,

          lastSignalId:
            null,

          initialized:
            true,
        }
      );


      console.log(
        `[CRT] BASELINE | ${instrument.symbol} | ${timeframe} | ${providerData.provider} | ${new Date(
          newestClosedTime
        ).toISOString()}`
      );


      return;
    }


    // ========================================================
    // NO NEW CLOSED CANDLE
    // ========================================================

    if (
      newestClosedTime <=
      state.lastClosedTime
    ) {

      return;
    }


    // ========================================================
    // NEW CLOSED CANDLE
    // ========================================================

    monitorState.set(
      stateKey,
      {

        ...state,

        lastClosedTime:
          newestClosedTime,
      }
    );


    console.log(
      `[CRT] NEW CANDLE | ${instrument.symbol} | ${timeframe} | ${providerData.provider}`
    );


    // ========================================================
    // ANALYZE
    // ========================================================

    const analysis =
      analyzeMarket(
        providerData.candles
      );


    if (
      !analysis
    ) {

      console.log(
        `[CRT] NO SIGNAL | ${instrument.symbol} | ${timeframe}`
      );


      return;
    }


    // ========================================================
    // BUILD SIGNAL
    // ========================================================

    const signal =
      buildSignal(
        instrument,
        timeframe,
        providerData,
        analysis
      );


    if (
      !signal
    ) {

      return;
    }


    // ========================================================
    // DUPLICATE SIGNAL PROTECTION
    // ========================================================

    if (
      state.lastSignalId ===
      signal.id
    ) {

      console.log(
        `[CRT] DUPLICATE IGNORED | ${instrument.symbol} | ${timeframe} | ${signal.direction}`
      );


      return;
    }


    // ========================================================
    // SEND
    // ========================================================

    const sent =
      await sendSignal(
        client,
        signal
      );


    // ========================================================
    // SAVE ONLY AFTER SUCCESS
    // ========================================================

    if (
      sent
    ) {

      monitorState.set(
        stateKey,
        {

          ...monitorState.get(
            stateKey
          ),

          lastSignalId:
            signal.id,

          lastClosedTime:
            newestClosedTime,
        }
      );
    }

  } catch (
    error
  ) {

    console.error(
      `[CRT] FAILED | ${instrument.symbol} | ${timeframe}:`,
      error
    );
  }
}


// ============================================================
// SCAN EVERYTHING
// ============================================================

let scanRunning =
  false;


async function scanAll(
  client
) {

  if (
    scanRunning
  ) {

    return;
  }


  scanRunning =
    true;


  try {

    const instruments =
      getConfiguredInstruments();


    if (
      instruments.length ===
      0
    ) {

      console.error(
        "[CRT] No CRT instruments configured."
      );


      return;
    }


    for (
      const instrument
      of instruments
    ) {

      for (
        const timeframe
        of Object.keys(
          TIMEFRAMES
        )
      ) {

        await processInstrumentTimeframe(
          client,
          instrument,
          timeframe
        );
      }
    }

  } finally {

    scanRunning =
      false;
  }
}


// ============================================================
// START MONITOR
// ============================================================

let crtMonitorStarted =
  false;


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
      "[CRT] Automatic CRT alerts disabled."
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


  const instruments =
    getConfiguredInstruments();


  if (
    instruments.length ===
    0
  ) {

    console.error(
      "[CRT] No instruments configured."
    );


    return;
  }


  const timeframes =
    Object.keys(
      TIMEFRAMES
    );


  crtMonitorStarted =
    true;


  console.log(
    "=================================================="
  );


  console.log(
    "[CRT] CRT SIGNAL ENGINE STARTED"
  );


  console.log(
    "=================================================="
  );


  console.log(
    "[CRT] Crypto provider: MEXC FUTURES ONLY"
  );


  console.log(
    "[CRT] Forex / Metals provider: OANDA"
  );


  console.log(
    "[CRT] MEXC SPOT: DISABLED"
  );


  console.log(
    "[CRT] Hard-coded XAU_USDT: NONE"
  );


  console.log(
    "[CRT] Signal source: Filtered Top / Bottom"
  );


  console.log(
    `[CRT] Timeframes: ${timeframes.join(
      ", "
    )}`
  );


  console.log(
    `[CRT] Instruments: ${instruments
      .map(
        (
          item
        ) =>
          `${item.display} [${item.market}]`
      )
      .join(
        ", "
      )}`
  );


  // ==========================================================
  // DISCORD CHANNELS
  // ==========================================================

  for (
    const timeframe
    of timeframes
  ) {

    console.log(
      `[CRT] Channel ${timeframe}: ${
        CHANNELS[
          timeframe
        ] ||
        "NOT CONFIGURED"
      }`
    );
  }


  // ==========================================================
  // INITIAL SCAN
  // ==========================================================

  void scanAll(
    client
  );


  // ==========================================================
  // CONTINUOUS SCAN
  // ==========================================================

  setInterval(
    () => {

      void scanAll(
        client
      );

    },
    CHECK_INTERVAL
  );
}


// ============================================================
// MANUAL SCAN
// ============================================================

export async function scanCRTNow(
  client
) {

  if (
    !client
  ) {

    throw new Error(
      "Discord client is required."
    );
  }


  await scanAll(
    client
  );
}


// ============================================================
// VALIDATE TIMEFRAME
// ============================================================

export function isValidCRTTimeframe(
  timeframe
) {

  return Object.prototype.hasOwnProperty.call(
    TIMEFRAMES,
    String(
      timeframe
    ).toLowerCase()
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
// TIMEZONE
// ============================================================

function getZonedParts(
  date =
    new Date()
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
    const part
    of parts
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
      `Invalid timeframe "${timeframe}".`
    );
  }


  const minutes =
    Number(
      TIMEFRAMES[
        timeframe
      ]
    );


  const now =
    Date.now();


  const duration =
    minutes *
    60 *
    1000;


  const startTimestamp =
    Math.floor(
      now /
      duration
    ) *
    duration;


  const endTimestamp =
    startTimestamp +
    duration;


  return {

    timeframe,

    label:
      getTimeframeLabel(
        timeframe
      ),

    startTimestamp,

    endTimestamp,

    startTime:
      new Date(
        startTimestamp
      ).toISOString(),

    endTime:
      new Date(
        endTimestamp
      ).toISOString(),

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

  const current =
    getCurrentCRT(
      timeframe
    );


  const remaining =
    Math.max(
      0,
      current.endTimestamp -
        Date.now()
    );


  const seconds =
    Math.floor(
      remaining /
      1000
    );


  const hours =
    Math.floor(
      seconds /
      3600
    );


  const minutes =
    Math.floor(
      (
        seconds %
        3600
      ) /
      60
    );


  const secs =
    seconds %
    60;


  return [

    String(
      hours
    ).padStart(
      2,
      "0"
    ),

    String(
      minutes
    ).padStart(
      2,
      "0"
    ),

    String(
      secs
    ).padStart(
      2,
      "0"
    ),

  ].join(
    ":"
  );
}


// ============================================================
// CRT STATUS
// ============================================================

export function getCRTStatus(
  timeframe =
    DEFAULT_TIMEFRAME
) {

  const current =
    getCurrentCRT(
      timeframe
    );


  return {

    timeframe,

    label:
      current.label,

    timezone:
      current.timezone,

    start:
      current.startTime,

    end:
      current.endTime,

    remaining:
      getRemainingTime(
        timeframe
      ),

    startTimestamp:
      current.startTimestamp,

    endTimestamp:
      current.endTimestamp,
  };
}


// ============================================================
// ALL CRT STATUSES
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
// ENGINE STATE
// ============================================================

export function getCRTStateStatus() {

  return {

    running:
      crtMonitorStarted,

    scanning:
      scanRunning,

    providerCrypto:
      "MEXC_FUTURES",

    providerForex:
      "OANDA",

    spot:
      false,

    filteredTop:
      USE_FILTERED_TOP,

    filteredBottom:
      USE_FILTERED_BOTTOM,

    timeframes:
      Object.keys(
        TIMEFRAMES
      ),

    instruments:
      getConfiguredInstruments(),

    states:
      Array.from(
        monitorState.entries()
      ),
  };
}


// ============================================================
// SERVICE LOADED
// ============================================================

console.log(
  "[CRT] Signal service loaded."
);

console.log(
  "[CRT] MEXC Spot disabled."
);

console.log(
  "[CRT] Crypto source: MEXC Futures."
);

console.log(
  "[CRT] Forex/Metals source: OANDA."
);

console.log(
  "[CRT] Signal source: Filtered Top / Filtered Bottom."
);
