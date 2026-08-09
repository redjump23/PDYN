// ============================================================
// PDYN CRT SIGNAL SERVICE
// ============================================================
//
// MAIN SOURCE:
// Rachel T - Fractals
//
// ACTIVE RACHEL T SETTINGS:
//
// [x] Filtered Top Fractals
// [x] Filtered Bottom Fractals
//
// ALL OTHER RACHEL T SETTINGS:
//
// [ ] Time Fractals
// [ ] ZigZag
// [ ] Higher High
// [ ] Lower High
// [ ] Higher Low
// [ ] Lower Low
// [ ] Harmonic Patterns
// [ ] Bat
// [ ] Alt Bat
// [ ] Butterfly
// [ ] Gartley
// [ ] Crab
// [ ] Shark
// [ ] 5-O
// [ ] Wolf Wave
// [ ] Head & Shoulders
// [ ] Contracting Triangle
// [ ] Expanding Triangle
//
// RSI(14):
//
// <= 30  = OVERSOLD
// >= 70  = OVERBOUGHT
// otherwise = NEUTRAL
//
// SIGNAL:
//
// Filtered Bottom Fractal = BUY
// Filtered Top Fractal    = SELL
//
// TIMEFRAMES:
//
// 5m
// 15m
// 30m
// 1h
// 4h
// 1d
//
// EXCHANGE:
//
// MEXC Futures
//
// DISPLAY SYMBOL:
//
// XAUUSDT.P
//
// API SYMBOL:
//
// XAU_USDT
//
// ============================================================


// ============================================================
// IMPORTS
// ============================================================

import {
  EmbedBuilder,
} from "discord.js";

import botConfig from "../../config/bot.js";


// ============================================================
// CONFIG
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
// TIMEFRAMES
// ============================================================
//
// Keep the six existing PDYN timeframes.
//
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
// DISCORD CHANNEL ROUTING
// ============================================================
//
// Channel IDs remain in bot.js.
//
// This service reads them from:
//
// botConfig.crt.channels
//
// ============================================================

const CHANNELS =
  CRT_CONFIG.channels || {};


// ============================================================
// MEXC
// ============================================================

const MEXC_API =
  "https://api.mexc.com";


// ============================================================
// DISPLAY SYMBOL
// ============================================================
//
// Discord/chart display.
//
// ============================================================

const DISPLAY_SYMBOL =
  "XAUUSDT.P";


// ============================================================
// MEXC API SYMBOL
// ============================================================
//
// MEXC Futures API symbol.
//
// ============================================================

const API_SYMBOL =
  "XAU_USDT";


// ============================================================
// RSI SETTINGS
// ============================================================

const RSI_PERIOD =
  14;

const RSI_OVERSOLD =
  30;

const RSI_OVERBOUGHT =
  70;


// ============================================================
// RACHEL T SETTINGS
// ============================================================
//
// ONLY THESE TWO SETTINGS ARE ENABLED.
//
// ============================================================

const FILTERED_TOP_FRACTALS =
  true;

const FILTERED_BOTTOM_FRACTALS =
  true;


// ============================================================
// ALL OTHER RACHEL T SETTINGS DISABLED
// ============================================================

const SHOW_TIME_FRACTALS =
  false;

const SHOW_ZIGZAG =
  false;

const SHOW_HIGHER_HIGH =
  false;

const SHOW_LOWER_HIGH =
  false;

const SHOW_HIGHER_LOW =
  false;

const SHOW_LOWER_LOW =
  false;

const SHOW_HARMONIC_PATTERNS =
  false;


// ============================================================
// FRACTAL MODE
// ============================================================
//
// Rachel T source:
//
// filterBW = input(false)
//
// false = Bill Williams fractal
// true  = Regular fractal
//
// Default is false.
//
// ============================================================

const FILTER_BW =
  process.env.CRT_FILTER_BW ===
  "true";


// ============================================================
// MONITOR INTERVAL
// ============================================================

const CHECK_INTERVAL =
  Number(
    CRT_CONFIG.checkInterval
  ) >= 1000
    ? Number(
        CRT_CONFIG.checkInterval
      )
    : 5000;


// ============================================================
// CANDLE LIMIT
// ============================================================

const MAX_CANDLES =
  500;


// ============================================================
// MEXC FUTURES INTERVALS
// ============================================================

const FUTURES_INTERVALS = {

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
    number >= 1000
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
    number >= 1
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


  return number.toFixed(
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
  url
) {

  const response =
    await fetch(
      url,
      {
        method:
          "GET",

        headers: {
          Accept:
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
      `MEXC HTTP ${response.status}`
    );
  }


  return response.json();
}


// ============================================================
// GET MEXC FUTURES CANDLES
// ============================================================

async function getMEXCCandles(
  timeframe
) {

  const interval =
    FUTURES_INTERVALS[
      timeframe
    ];


  if (
    !interval
  ) {

    throw new Error(
      `Unsupported timeframe: ${timeframe}`
    );
  }


  const url =
    new URL(
      `${MEXC_API}/api/v1/contract/kline/${API_SYMBOL}`
    );


  url.searchParams.set(
    "interval",
    interval
  );


  url.searchParams.set(
    "limit",
    String(
      MAX_CANDLES
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
      "Invalid MEXC Futures kline response."
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


  const timeframeMinutes =
    Number(
      TIMEFRAMES[
        timeframe
      ]
    );


  const candleDuration =
    timeframeMinutes *
    60 *
    1000;


  const now =
    Date.now();


  const candles =
    [];


  for (
    let i = 0;
    i < count;
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
        volumes[i] || 0
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
      candleDuration -
      1;


    candles.push({

      index:
        candles.length,

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


  return candles.sort(
    (
      a,
      b
    ) =>
      a.openTime -
      b.openTime
  );
}


// ============================================================
// RSI(14)
// ============================================================
//
// Wilder RSI.
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
      change >= 0
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
      change > 0
        ? change
        : 0;


    const currentLoss =
      change < 0
        ? Math.abs(
            change
          )
        : 0;


    averageGain =
      (
        averageGain *
          (
            period - 1
          ) +
        currentGain
      ) /
      period;


    averageLoss =
      (
        averageLoss *
          (
            period - 1
          ) +
        currentLoss
      ) /
      period;
  }


  if (
    averageLoss === 0
  ) {

    if (
      averageGain === 0
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
// RACHEL T REGULAR FRACTAL
// ============================================================
//
// Direct translation of:
//
// isRegularFractal(mode) =>
//
// mode == 1 ?
// high[4] < high[3]
// and high[3] < high[2]
// and high[2] > high[1]
// and high[1] > high[0]
//
// mode == -1 ?
// low[4] > low[3]
// and low[3] > low[2]
// and low[2] < low[1]
// and low[1] < low[0]
//
// ============================================================

function isRegularFractal(
  candles,
  index,
  mode
) {

  if (
    index < 4
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
    mode === 1
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


  if (
    mode === -1
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


  return false;
}


// ============================================================
// RACHEL T BILL WILLIAMS FRACTAL
// ============================================================
//
// Direct translation of:
//
// isBWFractal(mode) =>
//
// mode == 1 ?
// high[4] < high[2]
// and high[3] <= high[2]
// and high[2] >= high[1]
// and high[2] > high[0]
//
// mode == -1 ?
// low[4] > low[2]
// and low[3] >= low[2]
// and low[2] <= low[1]
// and low[2] < low[0]
//
// ============================================================

function isBWFractal(
  candles,
  index,
  mode
) {

  if (
    index < 4
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
    mode === 1
  ) {

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


  if (
    mode === -1
  ) {

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


  return false;
}


// ============================================================
// GET RACHEL T FRACTAL
// ============================================================

function getRachelTFractal(
  candles,
  index,
  mode
) {

  if (
    FILTER_BW
  ) {

    return isRegularFractal(
      candles,
      index,
      mode
    );
  }


  return isBWFractal(
    candles,
    index,
    mode
  );
}


// ============================================================
// BUILD FILTERED FRACTALS
// ============================================================
//
// The Rachel T fractal is plotted on:
//
// high[2]
// low[2]
//
// Therefore:
//
// confirmation index = i
// fractal candle       = i - 2
//
// ============================================================

function buildFilteredFractals(
  candles
) {

  const result =
    candles.map(
      (
        candle
      ) => ({

        ...candle,

        filteredTop:
          false,

        filteredBottom:
          false,
      })
    );


  for (
    let i = 0;
    i <
      candles.length;

    i++
  ) {

    // --------------------------------------------------------
    // FILTERED TOP FRACTAL
    // --------------------------------------------------------

    if (
      FILTERED_TOP_FRACTALS &&
      getRachelTFractal(
        candles,
        i,
        1
      )
    ) {

      const fractalIndex =
        i - 2;


      if (
        fractalIndex >= 0
      ) {

        result[
          fractalIndex
        ].filteredTop =
          true;
      }
    }


    // --------------------------------------------------------
    // FILTERED BOTTOM FRACTAL
    // --------------------------------------------------------

    if (
      FILTERED_BOTTOM_FRACTALS &&
      getRachelTFractal(
        candles,
        i,
        -1
      )
    ) {

      const fractalIndex =
        i - 2;


      if (
        fractalIndex >= 0
      ) {

        result[
          fractalIndex
        ].filteredBottom =
          true;
      }
    }
  }


  return result;
}


// ============================================================
// FIND LATEST CONFIRMED FRACTAL
// ============================================================
//
// Only Filtered Top and Filtered Bottom are considered.
//
// No ZigZag.
// No structure.
// No harmonic pattern.
//
// ============================================================

function findLatestFractal(
  candles
) {

  let latest =
    null;


  for (
    let i = 0;
    i <
      candles.length;
    i++
  ) {

    const candle =
      candles[i];


    if (
      candle.filteredTop
    ) {

      latest = {

        index:
          i,

        type:
          "TOP",

        price:
          candle.high,

        candle,
      };
    }


    if (
      candle.filteredBottom
    ) {

      if (
        !latest ||
        candle.openTime >
          latest.candle.openTime
      ) {

        latest = {

          index:
            i,

          type:
            "BOTTOM",

          price:
            candle.low,

          candle,
        };
      }
    }
  }


  return latest;
}


// ============================================================
// ANALYZE RACHEL T
// ============================================================
//
// ONLY:
//
// Filtered Top Fractal
// Filtered Bottom Fractal
//
// RSI is informational.
//
// ============================================================

function analyzeRachelT(
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


  const fractalCandles =
    buildFilteredFractals(
      closed
    );


  const latestFractal =
    findLatestFractal(
      fractalCandles
    );


  if (
    !latestFractal
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
  // SIGNAL DIRECTION
  // ==========================================================

  let direction =
    null;


  if (
    latestFractal.type ===
    "BOTTOM"
  ) {

    direction =
      "BUY";
  }


  if (
    latestFractal.type ===
    "TOP"
  ) {

    direction =
      "SELL";
  }


  if (
    !direction
  ) {

    return null;
  }


  // ==========================================================
  // SIGNAL ID
  // ==========================================================

  const signalId =
    [
      DISPLAY_SYMBOL,

      latestFractal.candle.openTime,

      latestFractal.type,
    ].join(
      ":"
    );


  // ==========================================================
  // RETURN SIGNAL
  // ==========================================================

  return {

    signalId,

    direction,

    fractalType:
      latestFractal.type,

    fractalPrice:
      latestFractal.price,

    signalPrice:
      latestFractal.candle.close,

    fractalTime:
      latestFractal.candle.openTime,

    candleOpen:
      latestFractal.candle.open,

    candleHigh:
      latestFractal.candle.high,

    candleLow:
      latestFractal.candle.low,

    candleClose:
      latestFractal.candle.close,

    rsi,

    rsiState:
      getRSIState(
        rsi
      ),
  };
}


// ============================================================
// CREATE SIGNAL
// ============================================================

function createSignal(
  timeframe,
  analysis
) {

  if (
    !analysis
  ) {

    return null;
  }


  return {

    ...analysis,

    timeframe,

    symbol:
      DISPLAY_SYMBOL,

    apiSymbol:
      API_SYMBOL,

    market:
      "MEXC FUTURES",
  };
}


// ============================================================
// CREATE DISCORD EMBED
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


  const direction =
    isBuy
      ? "BUY"
      : "SELL";


  const fractal =
    signal.fractalType ===
    "BOTTOM"
      ? "Filtered Bottom Fractal"
      : "Filtered Top Fractal";


  const signalTime =
    Math.floor(
      signal.fractalTime /
      1000
    );


  const embed =
    new EmbedBuilder()


      .setTitle(
        `${emoji} CRT SIGNAL — ${signal.symbol} · ${getTimeframeLabel(
          signal.timeframe
        )}`
      )


      .setDescription(
        `**${direction}**`
      )


      .addFields(

        {
          name:
            "Rachel T",

          value:
            `**${fractal}**`,

          inline:
            false,
        },


        {
          name:
            "Signal Price",

          value:
            `\`${formatPrice(
              signal.signalPrice
            )}\``,

          inline:
            true,
        },


        {
          name:
            "RSI(14)",

          value:
            `**${formatRSI(
              signal.rsi
            )}**`,

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
        },


        {
          name:
            "Fractal Price",

          value:
            `\`${formatPrice(
              signal.fractalPrice
            )}\``,

          inline:
            true,
        },


        {
          name:
            "Candle Close",

          value:
            `\`${formatPrice(
              signal.candleClose
            )}\``,

          inline:
            true,
        },


        {
          name:
            "Confirmed",

          value:
            `<t:${signalTime}:f>`,

          inline:
            false,
        }
      )


      .setColor(
        isBuy
          ? "#57F287"
          : "#ED4245"
      )


      .setFooter({
        text:
          "Rachel T Fractals • MEXC Futures • PDYN",
      })


      .setTimestamp(
        new Date(
          signal.fractalTime
        )
      );


  return embed;
}


// ============================================================
// SEND SIGNAL TO DISCORD
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
      `[CRT] ❌ No Discord channel configured for ${signal.timeframe}`
    );


    return false;
  }


  console.log(
    `[CRT] Routing ${signal.timeframe} → ${channelId}`
  );


  try {

    const channel =
      await client.channels.fetch(
        channelId
      );


    if (
      !channel
    ) {

      console.error(
        `[CRT] ❌ Channel not found: ${channelId}`
      );


      return false;
    }


    if (
      typeof channel.send !==
      "function"
    ) {

      console.error(
        `[CRT] ❌ Channel cannot send messages: ${channelId}`
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
      `[CRT] ✅ SIGNAL SENT | ${signal.symbol} | ${signal.timeframe} | ${signal.direction} | ${signal.fractalType}`
    );


    return true;

  } catch (
    error
  ) {

    console.error(
      `[CRT] ❌ Discord send failed:`,
      error
    );


    return false;
  }
}


// ============================================================
// MONITOR STATE
// ============================================================

const monitorState =
  new Map();


// ============================================================
// STATE KEY
// ============================================================

function getStateKey(
  timeframe
) {

  return [
    DISPLAY_SYMBOL,
    timeframe,
  ].join(
    ":"
  );
}


// ============================================================
// PROCESS TIMEFRAME
// ============================================================

async function processTimeframe(
  client,
  timeframe
) {

  try {

    const candles =
      await getMEXCCandles(
        timeframe
      );


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

      console.warn(
        `[CRT] Not enough closed candles for ${timeframe}.`
      );


      return;
    }


    const key =
      getStateKey(
        timeframe
      );


    const latestClosed =
      closed[
        closed.length - 1
      ];


    const latestClosedTime =
      latestClosed.openTime;


    const state =
      monitorState.get(
        key
      );


    // ========================================================
    // FIRST START / RAILWAY RESTART
    // ========================================================
    //
    // IMPORTANT:
    //
    // When Railway restarts, do NOT send the old fractal again.
    //
    // Establish the latest closed candle as the baseline.
    //
    // The next NEW closed candle becomes the first candle
    // eligible for a new signal.
    //
    // ========================================================

    if (
      !state
    ) {

      monitorState.set(
        key,
        {

          lastClosedCandle:
            latestClosedTime,

          lastSignalId:
            null,

          initialized:
            true,
        }
      );


      console.log(
        `[CRT] BASELINE | ${DISPLAY_SYMBOL} | ${timeframe} | ${new Date(
          latestClosedTime
        ).toISOString()}`
      );


      return;
    }


    // ========================================================
    // NO NEW CANDLE
    // ========================================================

    if (
      latestClosedTime <=
      state.lastClosedCandle
    ) {

      return;
    }


    // ========================================================
    // NEW CLOSED CANDLE
    // ========================================================

    monitorState.set(
      key,
      {

        ...state,

        lastClosedCandle:
          latestClosedTime,
      }
    );


    // ========================================================
    // ANALYZE RACHEL T
    // ========================================================

    const analysis =
      analyzeRachelT(
        closed
      );


    if (
      !analysis
    ) {

      console.log(
        `[CRT] No Filtered Top/Bottom Fractal | ${DISPLAY_SYMBOL} | ${timeframe}`
      );


      return;
    }


    // ========================================================
    // DUPLICATE PROTECTION
    // ========================================================

    if (
      state.lastSignalId ===
      analysis.signalId
    ) {

      console.log(
        `[CRT] Duplicate ignored | ${DISPLAY_SYMBOL} | ${timeframe}`
      );


      return;
    }


    // ========================================================
    // CREATE SIGNAL
    // ========================================================

    const signal =
      createSignal(
        timeframe,
        analysis
      );


    // ========================================================
    // LOG
    // ========================================================

    console.log(
      "========================================"
    );


    console.log(
      "[CRT] 🚨 RACHEL T FRACTAL SIGNAL"
    );


    console.log(
      `[CRT] Symbol: ${signal.symbol}`
    );


    console.log(
      `[CRT] API Symbol: ${signal.apiSymbol}`
    );


    console.log(
      `[CRT] Timeframe: ${signal.timeframe}`
    );


    console.log(
      `[CRT] Direction: ${signal.direction}`
    );


    console.log(
      `[CRT] Fractal: ${signal.fractalType}`
    );


    console.log(
      `[CRT] Fractal Price: ${formatPrice(
        signal.fractalPrice
      )}`
    );


    console.log(
      `[CRT] Signal Price: ${formatPrice(
        signal.signalPrice
      )}`
    );


    console.log(
      `[CRT] RSI(14): ${formatRSI(
        signal.rsi
      )}`
    );


    console.log(
      `[CRT] RSI State: ${signal.rsiState}`
    );


    console.log(
      "========================================"
    );


    // ========================================================
    // SEND
    // ========================================================

    const sent =
      await sendSignal(
        client,
        signal
      );


    // ========================================================
    // SAVE SIGNAL AFTER SUCCESS
    // ========================================================

    if (
      sent
    ) {

      monitorState.set(
        key,
        {

          ...monitorState.get(
            key
          ),

          lastSignalId:
            signal.signalId,

          lastClosedCandle:
            latestClosedTime,
        }
      );
    }

  } catch (
    error
  ) {

    console.error(
      `[CRT] Error processing ${timeframe}:`,
      error
    );
  }
}


// ============================================================
// SCAN ALL TIMEFRAMES
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

    for (
      const timeframe
      of Object.keys(
        TIMEFRAMES
      )
    ) {

      await processTimeframe(
        client,
        timeframe
      );
    }

  } finally {

    scanRunning =
      false;
  }
}


// ============================================================
// MONITOR START STATE
// ============================================================

let crtMonitorStarted =
  false;


// ============================================================
// START CRT MONITOR
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
      "[CRT] CRT automatic alerts disabled."
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
    "========================================"
  );


  console.log(
    "[CRT] RACHEL T FRACTAL ENGINE STARTED"
  );


  console.log(
    "========================================"
  );


  console.log(
    `[CRT] Exchange: MEXC Futures`
  );


  console.log(
    `[CRT] Display Symbol: ${DISPLAY_SYMBOL}`
  );


  console.log(
    `[CRT] API Symbol: ${API_SYMBOL}`
  );


  console.log(
    `[CRT] Timeframes: ${Object.keys(
      TIMEFRAMES
    ).join(
      ", "
    )}`
  );


  console.log(
    `[CRT] Filtered Top Fractals: ${
      FILTERED_TOP_FRACTALS
        ? "ON"
        : "OFF"
    }`
  );


  console.log(
    `[CRT] Filtered Bottom Fractals: ${
      FILTERED_BOTTOM_FRACTALS
        ? "ON"
        : "OFF"
    }`
  );


  console.log(
    `[CRT] Time Fractals: OFF`
  );


  console.log(
    `[CRT] ZigZag: OFF`
  );


  console.log(
    `[CRT] HH/LH/HL/LL: OFF`
  );


  console.log(
    `[CRT] Harmonic Patterns: OFF`
  );


  console.log(
    `[CRT] RSI(${RSI_PERIOD}): ON`
  );


  console.log(
    `[CRT] RSI Oversold: <= ${RSI_OVERSOLD}`
  );


  console.log(
    `[CRT] RSI Overbought: >= ${RSI_OVERBOUGHT}`
  );


  console.log(
    `[CRT] Check Interval: ${CHECK_INTERVAL}ms`
  );


  // ==========================================================
  // CHANNELS
  // ==========================================================

  console.log(
    "[CRT] Discord channel routing:"
  );


  for (
    const timeframe
    of Object.keys(
      TIMEFRAMES
    )
  ) {

    console.log(
      `[CRT] ${timeframe} → ${
        CHANNELS[
          timeframe
        ] ||
        "NOT CONFIGURED"
      }`
    );
  }


  // ==========================================================
  // INITIAL BASELINE
  // ==========================================================

  void scanAll(
    client
  );


  // ==========================================================
  // CONTINUOUS MONITOR
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
      "Discord client required."
    );
  }


  await scanAll(
    client
  );
}


// ============================================================
// GET CURRENT TIME
// ============================================================

export function getCRTNow() {

  const date =
    new Date();


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


  return formatter.format(
    date
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
// AVAILABLE TIMEFRAMES
// ============================================================

export function getAvailableCRTTimeframes() {

  return Object.keys(
    TIMEFRAMES
  );
}


// ============================================================
// CURRENT CRT CANDLE
// ============================================================

export function getCurrentCRT(
  timeframe =
    "15m"
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
      `Invalid CRT timeframe: ${timeframe}`
    );
  }


  const minutes =
    Number(
      TIMEFRAMES[
        timeframe
      ]
    );


  const timestamp =
    Date.now();


  const candleSize =
    minutes *
    60 *
    1000;


  const startTimestamp =
    Math.floor(
      timestamp /
      candleSize
    ) *
    candleSize;


  const endTimestamp =
    startTimestamp +
    candleSize;


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
    "15m"
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
      seconds
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
    "15m"
) {

  const crt =
    getCurrentCRT(
      timeframe
    );


  return {

    timeframe,

    label:
      crt.label,

    timezone:
      crt.timezone,

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
// COMPATIBILITY EMBED
// ============================================================

export function createCRTEmbed(
  timeframe =
    "15m"
) {

  const status =
    getCRTStatus(
      timeframe
    );


  return new EmbedBuilder()

    .setTitle(
      "📊 RACHEL T CRT"
    )

    .setDescription(
      `**${status.label}**`
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
          "Exchange",

        value:
          "`MEXC Futures`",

        inline:
          true,
      },


      {
        name:
          "Symbol",

        value:
          `\`${DISPLAY_SYMBOL}\``,

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
      }
    )


    .setColor(
      CRT_CONFIG.color ||
      "#5865F2"
    )


    .setFooter({
      text:
        "Rachel T Fractals • PDYN",
    })


    .setTimestamp();
}


// ============================================================
// GET ALL CRT STATUS
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
// GET ENGINE STATE
// ============================================================

export function getCRTStateStatus() {

  return {

    running:
      crtMonitorStarted,

    scanning:
      scanRunning,

    symbol:
      DISPLAY_SYMBOL,

    apiSymbol:
      API_SYMBOL,

    exchange:
      "MEXC Futures",

    timeframes:
      Object.keys(
        TIMEFRAMES
      ),

    filteredTopFractals:
      FILTERED_TOP_FRACTALS,

    filteredBottomFractals:
      FILTERED_BOTTOM_FRACTALS,

    timeFractals:
      false,

    zigzag:
      false,

    structure:
      false,

    harmonicPatterns:
      false,

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
  "[CRT] Rachel T Fractal service loaded."
);


console.log(
  `[CRT] Symbol: ${DISPLAY_SYMBOL}`
);


console.log(
  `[CRT] MEXC API Symbol: ${API_SYMBOL}`
);


console.log(
  `[CRT] Active: Filtered Top Fractals`
);


console.log(
  `[CRT] Active: Filtered Bottom Fractals`
);


console.log(
  `[CRT] Disabled: All other Rachel T settings`
);


console.log(
  `[CRT] RSI(${RSI_PERIOD}) enabled as informational filter`
);
