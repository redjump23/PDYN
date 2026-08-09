```javascript
import { EmbedBuilder } from "discord.js";
import fs from "node:fs";
import path from "node:path";
import botConfig from "../../config/bot.js";

import {
  buildSignal,
} from "./crtEngine.js";

import {
  getKlines,
  getSpotSymbols,
  getFuturesContracts,
  getConfiguredSymbols,
} from "./mexcService.js";


// ============================================================
// PDYN-BOT — CRT + MEXC SIGNAL SERVICE
// ============================================================
//
// IMPORTANT:
//
// This service is restart-safe.
//
// Railway restart:
//     ↓
// Load persistent CRT state
//     ↓
// Fetch MEXC candles
//     ↓
// Ignore the currently-forming candle
//     ↓
// Process ONLY closed candles newer than the last processed candle
//     ↓
// Generate signal
//     ↓
// Save processed candle state
//
// This prevents Railway restarts from repeatedly processing the
// same historical CRT candle.
//
// Supported:
// 5m
// 15m
// 30m
// 1h
// 4h
// 1d
//
// Markets:
// spot
// futures
//
// Signal:
// CRT BUY
// CRT SELL
// CRT + RSI STRONG BUY
// CRT + RSI STRONG SELL
//
// ============================================================


// ============================================================
// CONFIGURATION
// ============================================================

const CRT_CONFIG =
  botConfig.crt || {};

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

const MARKET_TYPES =
  String(
    CRT_CONFIG.markets ||
    process.env.CRT_MARKETS ||
    "spot,futures"
  )
    .split(",")
    .map((value) =>
      value.trim().toLowerCase()
    )
    .filter(Boolean);

const SCAN_INTERVAL =
  Math.max(
    15000,
    Number(
      CRT_CONFIG.scanInterval ||
      process.env.CRT_SCAN_INTERVAL_MS ||
      30000
    )
  );

const KLINE_LIMIT =
  Math.max(
    30,
    Number(
      CRT_CONFIG.klineLimit ||
      process.env.CRT_KLINE_LIMIT ||
      100
    )
  );

const MAX_SYMBOLS =
  Math.max(
    1,
    Number(
      CRT_CONFIG.maxSymbolsPerMarket ||
      process.env.CRT_MAX_SYMBOLS_PER_MARKET ||
      30
    )
  );

const RSI_PERIOD =
  Number(
    CRT_CONFIG.rsi?.period ||
    process.env.CRT_RSI_PERIOD ||
    14
  );

const OVERSOLD =
  Number(
    CRT_CONFIG.rsi?.oversold ||
    process.env.CRT_RSI_OVERSOLD ||
    30
  );

const OVERBOUGHT =
  Number(
    CRT_CONFIG.rsi?.overbought ||
    process.env.CRT_RSI_OVERBOUGHT ||
    70
  );

const AUTO_SYMBOLS =
  CRT_CONFIG.autoSymbols !== false &&
  process.env.CRT_AUTO_SYMBOLS !== "false";


// ============================================================
// PERSISTENT STATE
// ============================================================
//
// Railway restart normally keeps the deployed filesystem during
// a restart of the same service.
//
// IMPORTANT:
//
// If Railway completely destroys/recreates the container,
// filesystem state may be lost.
//
// For guaranteed persistence across redeploys/recreates,
// PostgreSQL should eventually be used.
//
// This file still protects against normal process/container
// restarts where the filesystem remains available.
//
// ============================================================

const STATE_DIRECTORY =
  process.env.CRT_STATE_DIRECTORY ||
  path.resolve(
    process.cwd(),
    "data"
  );

const STATE_FILE =
  process.env.CRT_STATE_FILE ||
  path.join(
    STATE_DIRECTORY,
    "crt-state.json"
  );


// ============================================================
// RUNTIME STATE
// ============================================================

let monitorStarted =
  false;

let scanRunning =
  false;

let cachedSymbols =
  new Map();

let lastSymbolRefresh =
  0;


// ============================================================
// PERSISTENT CRT STATE
// ============================================================
//
// Structure:
//
// {
//   "spot:BTCUSDT:5m": {
//      "lastProcessedCandle": 123456789,
//      "lastSignalCandle": 123456789,
//      "lastSignalId": "...",
//      "lastSignalDirection": "BUY",
//      "updatedAt": 123456789
//   }
// }
//
// ============================================================

let persistentState = {};


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
          recursive: true,
        }
      );
    }
  } catch (error) {
    console.error(
      "[CRT] Failed to create state directory:",
      error.message
    );
  }
}


// ============================================================
// LOAD PERSISTENT STATE
// ============================================================

function loadPersistentState() {
  ensureStateDirectory();

  try {
    if (
      !fs.existsSync(
        STATE_FILE
      )
    ) {
      persistentState = {};

      console.log(
        "[CRT] No previous state found. Starting fresh."
      );

      return;
    }

    const raw =
      fs.readFileSync(
        STATE_FILE,
        "utf8"
      );

    if (!raw.trim()) {
      persistentState = {};

      console.log(
        "[CRT] State file is empty. Starting fresh."
      );

      return;
    }

    const parsed =
      JSON.parse(raw);

    if (
      !parsed ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    ) {
      persistentState = {};

      console.warn(
        "[CRT] Invalid state file. Starting fresh."
      );

      return;
    }

    persistentState =
      parsed;

    console.log(
      `[CRT] Persistent state loaded: ${Object.keys(
        persistentState
      ).length} entries.`
    );

  } catch (error) {

    console.error(
      "[CRT] Failed to load persistent state:",
      error.message
    );

    persistentState = {};
  }
}


// ============================================================
// SAVE PERSISTENT STATE
// ============================================================

function savePersistentState() {
  ensureStateDirectory();

  const temporaryFile =
    `${STATE_FILE}.tmp`;

  try {

    fs.writeFileSync(
      temporaryFile,
      JSON.stringify(
        persistentState,
        null,
        2
      ),
      "utf8"
    );

    fs.renameSync(
      temporaryFile,
      STATE_FILE
    );

  } catch (error) {

    console.error(
      "[CRT] Failed to save persistent state:",
      error.message
    );

    try {
      if (
        fs.existsSync(
          temporaryFile
        )
      ) {
        fs.unlinkSync(
          temporaryFile
        );
      }
    } catch {
      // Ignore cleanup failure.
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

function getSymbolState(
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
    persistentState[key] || {
      lastProcessedCandle: 0,

      lastSignalCandle: 0,

      lastSignalId: null,

      lastSignalDirection: null,

      updatedAt: 0,
    }
  );
}


// ============================================================
// UPDATE STATE
// ============================================================

function updateSymbolState(
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

  persistentState[key] = {
    ...getSymbolState(
      market,
      symbol,
      timeframe
    ),

    ...values,

    updatedAt:
      Date.now(),
  };

  savePersistentState();
}


// ============================================================
// TIMEFRAME LABEL
// ============================================================

function timeframeLabel(
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
    labels[timeframe] ||
    String(
      timeframe
    ).toUpperCase()
  );
}


// ============================================================
// PRICE FORMAT
// ============================================================

function fmtPrice(
  value
) {
  if (
    !Number.isFinite(
      value
    )
  ) {
    return "N/A";
  }

  if (
    Math.abs(value) >=
    1000
  ) {
    return value.toLocaleString(
      "en-US",
      {
        maximumFractionDigits: 2,
      }
    );
  }

  if (
    Math.abs(value) >=
    1
  ) {
    return value.toLocaleString(
      "en-US",
      {
        maximumFractionDigits: 5,
      }
    );
  }

  return value.toLocaleString(
    "en-US",
    {
      maximumSignificantDigits: 7,
    }
  );
}


// ============================================================
// RSI FORMAT
// ============================================================

function fmtRSI(
  value
) {
  if (
    value == null ||
    !Number.isFinite(
      Number(value)
    )
  ) {
    return "N/A";
  }

  return Number(
    value
  ).toFixed(2);
}


// ============================================================
// SIGNAL COLOR
// ============================================================

function signalColor(
  signal
) {
  if (
    signal.direction ===
    "BUY"
  ) {
    return 0x57f287;
  }

  return 0xed4245;
}


// ============================================================
// CREATE SIGNAL EMBED
// ============================================================

function createSignalEmbed(
  signal
) {
  const emoji =
    signal.direction ===
    "BUY"
      ? "🟢"
      : "🔴";

  const strength =
    signal.strength ===
    "STRONG"
      ? "STRONG "
      : "";

  return new EmbedBuilder()

    .setTitle(
      `${emoji} ${strength}CRT ${signal.direction}`
    )

    .setDescription(
      `**${signal.symbol}** • ${timeframeLabel(
        signal.timeframe
      )}`
    )

    .addFields(

      {
        name:
          "📌 Signal Price",

        value:
          `\`${fmtPrice(
            signal.price
          )}\``,

        inline:
          true,
      },

      {
        name:
          "📊 RSI(14)",

        value:
          `\`${fmtRSI(
            signal.rsi
          )}\``,

        inline:
          true,
      },

      {
        name:
          "RSI State",

        value:
          `\`${signal.rsiState}\``,

        inline:
          true,
      },

      {
        name:
          "CRT High",

        value:
          `\`${fmtPrice(
            signal.parentHigh
          )}\``,

        inline:
          true,
      },

      {
        name:
          "CRT Low",

        value:
          `\`${fmtPrice(
            signal.parentLow
          )}\``,

        inline:
          true,
      },

      {
        name:
          "Market",

        value:
          `\`${String(
            signal.market
          ).toUpperCase()}\``,

        inline:
          true,
      },

      {
        name:
          "Confirmation",

        value:
          "`CLOSED CANDLE`",

        inline:
          true,
      },

      {
        name:
          "Signal Candle",

        value:
          `<t:${Math.floor(
            signal.candleTime /
              1000
          )}:f>`,

        inline:
          true,
      }
    )

    .setColor(
      signalColor(
        signal
      )
    )

    .setFooter({
      text:
        "CRT • PDYN • MEXC",
    })

    .setTimestamp(
      new Date(
        signal.candleTime
      )
    );
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

  if (!channelId) {

    console.warn(
      `[CRT] No Discord channel configured for ${signal.timeframe}`
    );

    return false;
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
      `[CRT] Channel cannot receive messages: ${channelId}`
    );

    return false;
  }

  const emoji =
    signal.direction ===
    "BUY"
      ? "🟢"
      : "🔴";

  const strong =
    signal.strength ===
    "STRONG"
      ? "STRONG "
      : "";

  await channel.send({
    content:
      `${emoji} **${strong}CRT ${signal.direction}** • ${signal.symbol} • ${signal.timeframe}`,

    embeds: [
      createSignalEmbed(
        signal
      ),
    ],
  });

  return true;
}


// ============================================================
// FILTER SYMBOLS
// ============================================================

function filterSymbols(
  symbols,
  market
) {
  const configured =
    getConfiguredSymbols(
      market
    );

  if (
    configured.length
  ) {
    return configured
      .slice(
        0,
        MAX_SYMBOLS
      );
  }

  if (
    !AUTO_SYMBOLS
  ) {
    return [];
  }

  const quote =
    String(
      CRT_CONFIG.quoteAsset ||
      process.env.CRT_QUOTE_ASSET ||
      "USDT"
    ).toUpperCase();

  const filtered =
    symbols.filter(
      (entry) => {

        const symbol =
          typeof entry ===
          "string"
            ? entry
            : entry?.symbol;

        if (!symbol) {
          return false;
        }

        if (
          market ===
          "futures"
        ) {
          return (
            String(
              entry?.quoteCoin ||
              ""
            ).toUpperCase() ===
              quote ||
            String(
              symbol
            ).endsWith(
              `_${quote}`
            )
          );
        }

        return String(
          symbol
        ).endsWith(
          quote
        );
      }
    );

  return filtered
    .slice(
      0,
      MAX_SYMBOLS
    )
    .map(
      (entry) =>
        typeof entry ===
        "string"
          ? entry
          : entry.symbol
    );
}


// ============================================================
// REFRESH SYMBOLS
// ============================================================

async function refreshSymbols(
  force = false
) {
  const ttl =
    Number(
      CRT_CONFIG.symbolRefreshMs ||
      process.env.CRT_SYMBOL_REFRESH_MS ||
      15 * 60 * 1000
    );

  if (
    !force &&
    Date.now() -
      lastSymbolRefresh <
      ttl &&
    cachedSymbols.size
  ) {
    return;
  }

  for (
    const market
    of MARKET_TYPES
  ) {

    try {

      if (
        market ===
        "futures"
      ) {

        const contracts =
          await getFuturesContracts();

        cachedSymbols.set(
          market,
          filterSymbols(
            contracts,
            market
          )
        );

      } else {

        const symbols =
          await getSpotSymbols();

        cachedSymbols.set(
          market,
          filterSymbols(
            symbols,
            market
          )
        );
      }

      console.log(
        `[CRT] ${market} symbols: ${
          (
            cachedSymbols.get(
              market
            ) || []
          ).join(", ")
        }`
      );

    } catch (
      error
    ) {

      console.error(
        `[CRT] Failed to refresh ${market} symbols:`,
        error.message
      );
    }
  }

  lastSymbolRefresh =
    Date.now();
}


// ============================================================
// GET CLOSED CANDLES
// ============================================================

function getClosedCandles(
  candles
) {
  if (
    !Array.isArray(
      candles
    )
  ) {
    return [];
  }

  return candles
    .filter(
      (candle) =>
        candle &&
        candle.closed === true &&
        Number.isFinite(
          Number(
            candle.close
          )
        )
    )
    .sort(
      (
        a,
        b
      ) =>
        Number(
          a.openTime
        ) -
        Number(
          b.openTime
        )
    );
}


// ============================================================
// FIND NEW CLOSED CANDLES
// ============================================================
//
// This is the key restart-safe logic.
//
// If:
//
// lastProcessed = 10:00
//
// and MEXC returns:
//
// 09:50
// 09:55
// 10:00
// 10:05
//
// The service only processes:
//
// 10:05
//
// It will NOT process 10:00 again.
//
// ============================================================

function getNewClosedCandles(
  closedCandles,
  lastProcessedCandle
) {
  return closedCandles.filter(
    (candle) =>
      Number(
        candle.openTime
      ) >
      Number(
        lastProcessedCandle ||
        0
      )
  );
}


// ============================================================
// SCAN ONE SYMBOL
// ============================================================

async function scanSymbol(
  client,
  market,
  symbol,
  timeframe
) {
  try {

    const candles =
      await getKlines({
        market,
        symbol,
        timeframe,
        limit:
          KLINE_LIMIT,
      });

    const closedCandles =
      getClosedCandles(
        candles
      );

    if (
      closedCandles.length <
      RSI_PERIOD + 3
    ) {
      return;
    }


    // ========================================================
    // LOAD PERSISTENT STATE
    // ========================================================

    const state =
      getSymbolState(
        market,
        symbol,
        timeframe
      );

    const latestClosed =
      closedCandles[
        closedCandles.length - 1
      ];

    const latestClosedTime =
      Number(
        latestClosed.openTime
      );


    // ========================================================
    // FIRST RUN AFTER INSTALLATION
    // ========================================================
    //
    // IMPORTANT:
    //
    // We don't generate a signal from an old historical candle
    // when the bot is first installed.
    //
    // We establish the latest CLOSED candle as the baseline.
    //
    // Then the NEXT closed candle becomes the first candle
    // eligible for a new signal.
    //
    // ========================================================

    if (
      !state.lastProcessedCandle
    ) {

      updateSymbolState(
        market,
        symbol,
        timeframe,
        {
          lastProcessedCandle:
            latestClosedTime,

          lastSignalCandle:
            0,

          lastSignalId:
            null,

          lastSignalDirection:
            null,
        }
      );

      console.log(
        `[CRT] ${market}:${symbol}:${timeframe} baseline set to ${new Date(
          latestClosedTime
        ).toISOString()}`
      );

      return;
    }


    // ========================================================
    // FIND NEW CLOSED CANDLES
    // ========================================================

    const newClosedCandles =
      getNewClosedCandles(
        closedCandles,
        state.lastProcessedCandle
      );


    if (
      newClosedCandles.length ===
      0
    ) {
      return;
    }


    // ========================================================
    // PROCESS EACH NEW CLOSED CANDLE
    // ========================================================
    //
    // Usually this will be one candle.
    //
    // If Railway was offline for several candles,
    // the service processes them chronologically.
    //
    // This prevents the bot from jumping directly to the newest
    // candle and missing a valid signal.
    //
    // ========================================================

    for (
      const newCandle
      of newClosedCandles
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


      // ======================================================
      // NEED AT LEAST TWO CLOSED CANDLES
      // ======================================================

      if (
        candleIndex <
        2
      ) {

        updateSymbolState(
          market,
          symbol,
          timeframe,
          {
            lastProcessedCandle:
              Number(
                newCandle.openTime
              ),
          }
        );

        continue;
      }


      // ======================================================
      // BUILD CANDLE WINDOW
      // ======================================================
      //
      // Parent candle:
      //     N - 2
      //
      // CRT signal candle:
      //     N - 1
      //
      // New candle:
      //     N
      //
      // We want the CRT decision to be based on the newly CLOSED
      // candle and the candle immediately before it.
      //
      // Therefore buildSignal receives:
      //
      // [historical..., parent, signal]
      //
      // where signal = newCandle.
      //
      // ======================================================

      const candlesThroughNew =
        closedCandles.slice(
          0,
          candleIndex + 1
        );


      // ======================================================
      // BUILD SIGNAL
      // ======================================================

      const signal =
        buildSignal({
          symbol,
          market,
          timeframe,

          candles:
            candlesThroughNew,

          rsiPeriod:
            RSI_PERIOD,

          oversold:
            OVERSOLD,

          overbought:
            OVERBOUGHT,

          crtOptions: {
            requireCloseInside:
              CRT_CONFIG.requireCloseInside !==
              false,

            useCloseDirection:
              CRT_CONFIG.useCloseDirection ===
              true,

            minBodyRatio:
              Number(
                CRT_CONFIG.minBodyRatio ||
                0
              ),
          },
        });


      // ======================================================
      // SIGNAL FOUND
      // ======================================================

      if (
        signal &&
        Number(
          signal.candleTime
        ) ===
          Number(
            newCandle.openTime
          )
      ) {

        const signalId =
          signal.id;

        const alreadyProcessed =
          state.lastSignalId ===
          signalId;

        if (
          !alreadyProcessed
        ) {

          try {

            const sent =
              await sendSignal(
                client,
                signal
              );

            if (
              sent
            ) {

              updateSymbolState(
                market,
                symbol,
                timeframe,
                {
                  lastProcessedCandle:
                    Number(
                      newCandle.openTime
                    ),

                  lastSignalCandle:
                    Number(
                      newCandle.openTime
                    ),

                  lastSignalId:
                    signalId,

                  lastSignalDirection:
                    signal.direction,
                }
              );

              console.log(
                `[CRT] ${signal.direction} ${signal.strength} ${market}:${symbol}:${timeframe} @ ${signal.price} RSI=${signal.rsi}`
              );

            } else {

              console.warn(
                `[CRT] Signal generated but Discord message was not sent: ${signalId}`
              );

              // Do NOT advance lastProcessedCandle if Discord
              // failed. This allows the next scan to retry.
              break;
            }

          } catch (
            sendError
          ) {

            console.error(
              `[CRT] Failed sending signal ${signalId}:`,
              sendError.message
            );

            // Do NOT advance state.
            // Retry on next scan.
            break;
          }

        } else {

          // Signal already sent previously.
          updateSymbolState(
            market,
            symbol,
            timeframe,
            {
              lastProcessedCandle:
                Number(
                  newCandle.openTime
                ),
            }
          );

        }

      } else {

        // ====================================================
        // NO CRT SIGNAL
        // ====================================================
        //
        // The candle has been fully processed.
        //
        // Advance state so it will never be evaluated again
        // after Railway restart.
        //
        updateSymbolState(
          market,
          symbol,
          timeframe,
          {
            lastProcessedCandle:
              Number(
                newCandle.openTime
              ),
          }
        );
      }
    }

  } catch (
    error
  ) {

    console.error(
      `[CRT] Scan failed ${market}:${symbol}:${timeframe}:`,
      error.message
    );
  }
}


// ============================================================
// SCAN EVERYTHING
// ============================================================

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

    await refreshSymbols();


    // ========================================================
    // TIMEFRAME LOOP
    // ========================================================

    for (
      const timeframe
      of Object.keys(
        TIMEFRAMES
      )
    ) {

      // ======================================================
      // MARKET LOOP
      // ======================================================

      for (
        const market
        of MARKET_TYPES
      ) {

        const symbols =
          cachedSymbols.get(
            market
          ) || [];


        // ====================================================
        // SYMBOL LOOP
        // ====================================================

        for (
          const symbol
          of symbols
        ) {

          await scanSymbol(
            client,
            market,
            symbol,
            timeframe
          );
        }
      }
    }

  } finally {

    scanRunning =
      false;
  }
}


// ============================================================
// START CRT MONITOR
// ============================================================

export function startCRTMonitor(
  client
) {

  // ==========================================================
  // PREVENT DUPLICATE MONITORS
  // ==========================================================

  if (
    monitorStarted
  ) {

    console.warn(
      "[CRT] Signal monitor is already running."
    );

    return;
  }


  // ==========================================================
  // CONFIG CHECK
  // ==========================================================

  if (
    CRT_CONFIG.enabled ===
      false ||
    CRT_CONFIG.autoAlerts ===
      false
  ) {

    console.log(
      "[CRT] Signal monitor disabled by configuration."
    );

    return;
  }


  // ==========================================================
  // CLIENT CHECK
  // ==========================================================

  if (
    !client
  ) {

    throw new Error(
      "Discord client is required for CRT monitor"
    );
  }


  // ==========================================================
  // LOAD PERSISTENT STATE
  // ==========================================================

  loadPersistentState();


  // ==========================================================
  // MARK STARTED
  // ==========================================================

  monitorStarted =
    true;


  // ==========================================================
  // STARTUP LOG
  // ==========================================================

  console.log(
    "[CRT] Signal monitor started."
  );

  console.log(
    `[CRT] Markets: ${MARKET_TYPES.join(
      ", "
    )}`
  );

  console.log(
    `[CRT] Timeframes: ${Object.keys(
      TIMEFRAMES
    ).join(", ")}`
  );

  console.log(
    `[CRT] Scan interval: ${SCAN_INTERVAL}ms`
  );

  console.log(
    `[CRT] Max symbols/market: ${MAX_SYMBOLS}`
  );

  console.log(
    `[CRT] Persistent state: ${STATE_FILE}`
  );


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
    SCAN_INTERVAL
  );
}


// ============================================================
// MANUAL SCAN
// ============================================================

export async function scanCRTNow(
  client
) {

  if (
    !persistentState ||
    Object.keys(
      persistentState
    ).length ===
      0
  ) {
    loadPersistentState();
  }

  await scanAll(
    client
  );
}


// ============================================================
// CRT CONFIG
// ============================================================

export function getCRTConfig() {

  return {
    markets:
      MARKET_TYPES,

    timeframes:
      Object.keys(
        TIMEFRAMES
      ),

    scanInterval:
      SCAN_INTERVAL,

    maxSymbolsPerMarket:
      MAX_SYMBOLS,

    klineLimit:
      KLINE_LIMIT,

    persistentStateFile:
      STATE_FILE,

    rsi: {
      period:
        RSI_PERIOD,

      oversold:
        OVERSOLD,

      overbought:
        OVERBOUGHT,
    },
  };
}


// ============================================================
// STATE STATUS
// ============================================================

export function getCRTStateStatus() {

  const entries =
    Object.entries(
      persistentState
    );

  return {
    stateFile:
      STATE_FILE,

    entries:
      entries.length,

    symbols:
      entries.map(
        ([
          key,
          value,
        ]) => ({
          key,

          lastProcessedCandle:
            value.lastProcessedCandle
              ? new Date(
                  value.lastProcessedCandle
                ).toISOString()
              : null,

          lastSignalCandle:
            value.lastSignalCandle
              ? new Date(
                  value.lastSignalCandle
                ).toISOString()
              : null,

          lastSignalId:
            value.lastSignalId,

          lastSignalDirection:
            value.lastSignalDirection,

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
// SERVICE LOADED
// ============================================================

console.log(
  `[CRT] Service loaded • ${Object.keys(
    TIMEFRAMES
  ).join(", ")}`
);
```
