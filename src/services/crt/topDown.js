// ============================================================
// PDYN CRT TOP-DOWN SERVICE
// ============================================================
//
// PURPOSE:
//
// Rachel T Fractal ONLY.
//
// Higher Timeframes:
//
//   1D
//   4H
//   1H
//   15M
//
// Lower Timeframe:
//
//   5M
//
// BEHAVIOR:
//
//   • Store the latest confirmed Rachel T fractal.
//   • Store separately for every symbol.
//   • Store separately for every timeframe.
//   • Save confirmed HTF fractals to PostgreSQL.
//   • Load previous HTF fractals from PostgreSQL on startup.
//   • If no NEW fractal is found, keep the previous one.
//   • If API/data has a temporary problem, keep the
//     previous stored fractal.
//   • A newer confirmed fractal replaces the old one.
//   • 5M reads the latest stored HTF fractals.
//
// IMPORTANT:
//
// This module does NOT use:
//
//   RSI
//   Standard Deviation
//   Market Structure
//   Candle containment
//   Same-candle HTF confirmation
//   30M
//
// Rachel T fractal confirmation is the ONLY CRT confirmation
// used by the top-down system.
//
// ============================================================

import { pgDb } from "../../utils/postgresDatabase.js";

// ============================================================
// TIMEFRAMES
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

const LOWER_TIMEFRAME = "5m";

// ============================================================
// ALL TIMEFRAMES
// ============================================================

const ALL_TIMEFRAMES = [
  ...TOP_DOWN_TIMEFRAMES,
  LOWER_TIMEFRAME,
];

// ============================================================
// IN-MEMORY STATE
// ============================================================
//
// Structure:
//
// Map<symbol, Map<timeframe, CRT>>
//
// Example:
//
// BTC_USDT
//   1d  -> BUY
//   4h  -> BUY
//   1h  -> SELL
//   15m -> BUY
//
// PostgreSQL is the permanent backup.
// Memory is used for fast access during runtime.
//
// ============================================================

const topDownState = new Map();

// ============================================================
// DATABASE PREFIX
// ============================================================
//
// Each CRT state is stored separately:
//
// temp:crt_topdown:BTC_USDT:1d
// temp:crt_topdown:BTC_USDT:4h
// temp:crt_topdown:BTC_USDT:1h
// temp:crt_topdown:BTC_USDT:15m
//
// No TTL is used.
//
// Therefore the records survive Railway restarts.
//
// ============================================================

const TOPDOWN_DB_PREFIX = "temp:crt_topdown";

// ============================================================
// DATABASE LOAD STATE
// ============================================================

let topDownPersistenceLoaded = false;

// ============================================================
// NORMALIZE SYMBOL
// ============================================================

function normalizeSymbol(symbol) {
  return String(symbol || "")
    .trim()
    .toUpperCase();
}

// ============================================================
// NORMALIZE TIMEFRAME
// ============================================================

function normalizeTimeframe(timeframe) {
  return String(timeframe || "")
    .trim()
    .toLowerCase();
}

// ============================================================
// BUILD DATABASE KEY
// ============================================================

function getTopDownDatabaseKey(symbol, timeframe) {
  return (
    `${TOPDOWN_DB_PREFIX}:` +
    `${normalizeSymbol(symbol)}:` +
    `${normalizeTimeframe(timeframe)}`
  );
}

// ============================================================
// CHECK HTF
// ============================================================

export function isTopDownTimeframe(timeframe) {
  return TOP_DOWN_TIMEFRAMES.includes(
    normalizeTimeframe(timeframe)
  );
}

// ============================================================
// CHECK SUPPORTED TIMEFRAME
// ============================================================

function isSupportedTimeframe(timeframe) {
  return ALL_TIMEFRAMES.includes(
    normalizeTimeframe(timeframe)
  );
}

// ============================================================
// GET SYMBOL STATE
// ============================================================

function getSymbolState(symbol) {
  const normalizedSymbol = normalizeSymbol(symbol);

  if (!normalizedSymbol) {
    return null;
  }

  if (!topDownState.has(normalizedSymbol)) {
    topDownState.set(
      normalizedSymbol,
      new Map()
    );
  }

  return topDownState.get(normalizedSymbol);
}

// ============================================================
// NORMALIZE SIGNAL
// ============================================================
//
// Accepts the signal object produced by crtService.js.
//
// Preserves:
//
//   type
//   fractalType
//   timestamp
//   price
//   fractalPrice
//   volume
//
// ============================================================

function normalizeSignal(symbol, timeframe, signal) {
  if (!signal) {
    return null;
  }

  const normalizedSymbol = normalizeSymbol(symbol);

  const normalizedTimeframe =
    normalizeTimeframe(timeframe);

  if (
    !normalizedSymbol ||
    !isSupportedTimeframe(normalizedTimeframe)
  ) {
    return null;
  }

  const timestamp = Number(signal.timestamp);

  if (!Number.isFinite(timestamp)) {
    return null;
  }

  const type = String(signal.type || "")
    .trim()
    .toUpperCase();

  if (type !== "BUY" && type !== "SELL") {
    return null;
  }

  const fractalType = String(
    signal.fractalType ||
      (type === "BUY" ? "BOTTOM" : "TOP")
  )
    .trim()
    .toUpperCase();

  const price = Number(signal.price);
  const fractalPrice = Number(signal.fractalPrice);
  const volume = Number(signal.volume);

  return {
    symbol: normalizedSymbol,

    timeframe: normalizedTimeframe,

    type,

    fractalType,

    timestamp,

    price: Number.isFinite(price)
      ? price
      : null,

    fractalPrice: Number.isFinite(fractalPrice)
      ? fractalPrice
      : null,

    volume: Number.isFinite(volume)
      ? volume
      : 0,

    storedAt: Date.now(),
  };
}

// ============================================================
// SAVE CRT TO POSTGRESQL
// ============================================================
//
// Saves one confirmed HTF CRT.
//
// No TTL is supplied.
//
// Therefore this record remains in PostgreSQL until explicitly
// replaced or deleted.
//
// ============================================================

async function saveTopDownCRTToDatabase(signal) {
  try {
    if (!pgDb.isAvailable()) {
      console.warn(
        "[TOPDOWN] PostgreSQL unavailable. " +
        "CRT remains in memory only."
      );

      return false;
    }

    if (!signal) {
      return false;
    }

    if (!isTopDownTimeframe(signal.timeframe)) {
      return false;
    }

    const key = getTopDownDatabaseKey(
      signal.symbol,
      signal.timeframe
    );

    const saved = await pgDb.set(
      key,
      signal
    );

    if (saved) {
      console.log(
        `[TOPDOWN] PostgreSQL saved ` +
        `${signal.symbol} ` +
        `${signal.timeframe.toUpperCase()} ` +
        `${signal.type} fractal`
      );
    }

    return saved;
  } catch (error) {
    console.error(
      "[TOPDOWN] PostgreSQL save failed:",
      error.message
    );

    return false;
  }
}

// ============================================================
// LOAD ALL CRT STATE FROM POSTGRESQL
// ============================================================
//
// This function is called during CRT startup.
//
// It restores the latest stored HTF fractals BEFORE normal
// CRT scanning begins.
//
// ============================================================

export async function loadTopDownPersistence() {
  if (topDownPersistenceLoaded) {
    return true;
  }

  try {
    if (!pgDb.isAvailable()) {
      console.warn(
        "[TOPDOWN] PostgreSQL unavailable during startup."
      );

      console.warn(
        "[TOPDOWN] Starting with memory-only CRT state."
      );

      return false;
    }

    console.log(
      "[TOPDOWN] Loading persistent CRT state from PostgreSQL..."
    );

    const keys = await pgDb.list(
      TOPDOWN_DB_PREFIX
    );

    let loaded = 0;

    for (const key of keys) {
      try {
        if (
          !key.startsWith(
            `${TOPDOWN_DB_PREFIX}:`
          )
        ) {
          continue;
        }

        const prefix =
          `${TOPDOWN_DB_PREFIX}:`;

        const remainder = key.slice(
          prefix.length
        );

        const separatorIndex =
          remainder.lastIndexOf(":");

        if (
          separatorIndex <= 0 ||
          separatorIndex >= remainder.length - 1
        ) {
          continue;
        }

        const symbol = normalizeSymbol(
          remainder.slice(
            0,
            separatorIndex
          )
        );

        const timeframe =
          normalizeTimeframe(
            remainder.slice(
              separatorIndex + 1
            )
          );

        if (
          !symbol ||
          !isTopDownTimeframe(timeframe)
        ) {
          continue;
        }

        const signal = await pgDb.get(
          key,
          null
        );

        if (!signal) {
          continue;
        }

        const normalizedSignal =
          normalizeSignal(
            symbol,
            timeframe,
            signal
          );

        if (!normalizedSignal) {
          console.warn(
            `[TOPDOWN] Invalid database CRT ignored: ` +
            `${symbol} ${timeframe}`
          );

          continue;
        }

        const symbolState =
          getSymbolState(symbol);

        if (!symbolState) {
          continue;
        }

        const previous =
          symbolState.get(timeframe);

        if (
          !previous ||
          normalizedSignal.timestamp >
            previous.timestamp
        ) {
          symbolState.set(
            timeframe,
            normalizedSignal
          );

          loaded++;

          console.log(
            `[TOPDOWN] Restored ${symbol} ` +
            `${timeframe.toUpperCase()} ` +
            `${normalizedSignal.type} fractal ` +
            `from PostgreSQL`
          );
        }
      } catch (error) {
        console.error(
          `[TOPDOWN] Failed to restore database key ${key}:`,
          error.message
        );
      }
    }

    topDownPersistenceLoaded = true;

    console.log(
      `[TOPDOWN] PostgreSQL state loaded: ` +
      `${loaded} CRT records`
    );

    return true;
  } catch (error) {
    console.error(
      "[TOPDOWN] PostgreSQL load failed:",
      error.message
    );

    return false;
  }
}

// ============================================================
// STORE CRT
// ============================================================
//
// ONLY replace the stored CRT when the incoming fractal
// is newer.
//
// Older/equal fractals are ignored.
//
// Every accepted new fractal is:
//
//   1. Stored in memory.
//   2. Saved to PostgreSQL.
//
// ============================================================

export function updateTopDownCRT(
  symbol,
  timeframe,
  signal
) {
  const normalizedSymbol =
    normalizeSymbol(symbol);

  const normalizedTimeframe =
    normalizeTimeframe(timeframe);

  if (
    !normalizedSymbol ||
    !isTopDownTimeframe(
      normalizedTimeframe
    )
  ) {
    return false;
  }

  const normalizedSignal =
    normalizeSignal(
      normalizedSymbol,
      normalizedTimeframe,
      signal
    );

  if (!normalizedSignal) {
    return false;
  }

  const symbolState =
    getSymbolState(
      normalizedSymbol
    );

  if (!symbolState) {
    return false;
  }

  const previous =
    symbolState.get(
      normalizedTimeframe
    );

  // ----------------------------------------------------------
  // FIRST CONFIRMED FRACTAL
  // ----------------------------------------------------------

  if (!previous) {
    symbolState.set(
      normalizedTimeframe,
      normalizedSignal
    );

    console.log(
      `[TOPDOWN] Stored ${normalizedSymbol} ` +
      `${normalizedTimeframe.toUpperCase()} ` +
      `${normalizedSignal.type} fractal`
    );

    void saveTopDownCRTToDatabase(
      normalizedSignal
    );

    return true;
  }

  // ----------------------------------------------------------
  // OLD OR SAME FRACTAL
  // ----------------------------------------------------------

  if (
    normalizedSignal.timestamp <=
    previous.timestamp
  ) {
    return false;
  }

  // ----------------------------------------------------------
  // NEWER FRACTAL
  // ----------------------------------------------------------

  symbolState.set(
    normalizedTimeframe,
    normalizedSignal
  );

  console.log(
    `[TOPDOWN] Updated ${normalizedSymbol} ` +
    `${normalizedTimeframe.toUpperCase()} ` +
    `${normalizedSignal.type} fractal`
  );

  void saveTopDownCRTToDatabase(
    normalizedSignal
  );

  return true;
}

// ============================================================
// GET STORED CRT
// ============================================================

export function getTopDownCRT(
  symbol,
  timeframe
) {
  const normalizedSymbol =
    normalizeSymbol(symbol);

  const normalizedTimeframe =
    normalizeTimeframe(timeframe);

  if (
    !normalizedSymbol ||
    !isTopDownTimeframe(
      normalizedTimeframe
    )
  ) {
    return null;
  }

  const symbolState =
    topDownState.get(
      normalizedSymbol
    );

  if (!symbolState) {
    return null;
  }

  return (
    symbolState.get(
      normalizedTimeframe
    ) || null
  );
}

// ============================================================
// GET ALL STORED HTF CRT
// ============================================================

export function getStoredTopDownState(
  symbol
) {
  const normalizedSymbol =
    normalizeSymbol(symbol);

  if (!normalizedSymbol) {
    return createEmptyTopDownState();
  }

  const result =
    createEmptyTopDownState();

  const symbolState =
    topDownState.get(
      normalizedSymbol
    );

  if (!symbolState) {
    return result;
  }

  for (
    const timeframe of
    TOP_DOWN_TIMEFRAMES
  ) {
    const signal =
      symbolState.get(
        timeframe
      );

    if (signal) {
      result[timeframe] = {
        ...signal,
      };
    }
  }

  return result;
}

// ============================================================
// CREATE EMPTY STATE
// ============================================================

export function createEmptyTopDownState() {
  return {
    "1d": null,
    "4h": null,
    "1h": null,
    "15m": null,
  };
}

// ============================================================
// GET TOP-DOWN TIMEFRAMES
// ============================================================

export function getTopDownTimeframes() {
  return [
    ...TOP_DOWN_TIMEFRAMES,
  ];
}

// ============================================================
// COUNT CONFIRMED HTF CRT
// ============================================================

export function countTopDownConfirmed(
  topDown
) {
  if (!topDown) {
    return 0;
  }

  let count = 0;

  for (
    const timeframe of
    TOP_DOWN_TIMEFRAMES
  ) {
    if (topDown[timeframe]) {
      count++;
    }
  }

  return count;
}

// ============================================================
// FORMAT TOP-DOWN COUNT
// ============================================================

export function formatTopDownCount(
  topDown
) {
  const count =
    countTopDownConfirmed(
      topDown
    );

  return `${count}/4 CONFIRMED`;
}

// ============================================================
// FORMAT SINGLE CRT
// ============================================================

function formatSingleCRT(
  signal
) {
  if (!signal) {
    return "N/A";
  }

  return signal.type === "BUY"
    ? "BUY"
    : "SELL";
}

// ============================================================
// FORMAT HTF CRT
// ============================================================
//
// Example:
//
// 1D BUY • 4H BUY • 1H SELL • 15M BUY
//
// ============================================================

export function formatHTFCRT(
  topDown
) {
  if (!topDown) {
    return (
      "1D N/A • " +
      "4H N/A • " +
      "1H N/A • " +
      "15M N/A"
    );
  }

  return [
    `1D ${formatSingleCRT(
      topDown["1d"]
    )}`,

    `4H ${formatSingleCRT(
      topDown["4h"]
    )}`,

    `1H ${formatSingleCRT(
      topDown["1h"]
    )}`,

    `15M ${formatSingleCRT(
      topDown["15m"]
    )}`,
  ].join(" • ");
}

// ============================================================
// FORMAT HTF CRT DETAILS
// ============================================================
//
// Kept as an alias because crtService.js imports:
//
//   formatHTFCRTDetails
//
// ============================================================

export function formatHTFCRTDetails(
  topDown
) {
  return formatHTFCRT(
    topDown
  );
}

// ============================================================
// BUILD TOP-DOWN CHAIN
// ============================================================
//
// 5M reads the latest STORED HTF fractals.
//
// It does NOT require fresh HTF fractals.
//
// ============================================================

export function buildTopDownChain(
  symbol
) {
  const normalizedSymbol =
    normalizeSymbol(symbol);

  const state =
    getStoredTopDownState(
      normalizedSymbol
    );

  const confirmed =
    countTopDownConfirmed(
      state
    );

  return {
    symbol:
      normalizedSymbol,

    "1d":
      state["1d"],

    "4h":
      state["4h"],

    "1h":
      state["1h"],

    "15m":
      state["15m"],

    confirmed,

    total:
      TOP_DOWN_TIMEFRAMES.length,

    confirmedCount:
      confirmed,

    isComplete:
      confirmed ===
      TOP_DOWN_TIMEFRAMES.length,
  };
}

// ============================================================
// ANALYZE TOP-DOWN
// ============================================================
//
// Called when a 5M Rachel T fractal is detected.
//
// HTF confirmation comes ONLY from stored Rachel T fractals.
//
// ============================================================

export function analyzeTopDown(
  symbol,
  current5mSignal = null
) {
  const normalizedSymbol =
    normalizeSymbol(symbol);

  const stored =
    getStoredTopDownState(
      normalizedSymbol
    );

  const confirmedCount =
    countTopDownConfirmed(
      stored
    );

  const currentSignal =
    normalizeSignal(
      normalizedSymbol,
      LOWER_TIMEFRAME,
      current5mSignal
    );

  const chain =
    buildTopDownChain(
      normalizedSymbol
    );

  return {
    symbol:
      normalizedSymbol,

    timeframe:
      LOWER_TIMEFRAME,

    current5m:
      currentSignal,

    "1d":
      stored["1d"],

    "4h":
      stored["4h"],

    "1h":
      stored["1h"],

    "15m":
      stored["15m"],

    confirmed:
      confirmedCount,

    confirmedCount,

    total:
      TOP_DOWN_TIMEFRAMES.length,

    isComplete:
      confirmedCount ===
      TOP_DOWN_TIMEFRAMES.length,

    chain,
  };
}

// ============================================================
// FORMAT TOP-DOWN DISPLAY
// ============================================================

export function formatTopDownDisplay(
  topDown
) {
  if (!topDown) {
    return (
      "TOP-DOWN: 0/4 CONFIRMED\n" +
      "1D: N/A\n" +
      "4H: N/A\n" +
      "1H: N/A\n" +
      "15M: N/A"
    );
  }

  const confirmed =
    Number(
      topDown.confirmedCount ??
      topDown.confirmed ??
      0
    );

  const daily =
    topDown["1d"];

  const fourHour =
    topDown["4h"];

  const oneHour =
    topDown["1h"];

  const fifteen =
    topDown["15m"];

  return [
    `TOP-DOWN: ${confirmed}/4 CONFIRMED`,

    `1D: ${formatSingleCRT(
      daily
    )}`,

    `4H: ${formatSingleCRT(
      fourHour
    )}`,

    `1H: ${formatSingleCRT(
      oneHour
    )}`,

    `15M: ${formatSingleCRT(
      fifteen
    )}`,
  ].join("\n");
}

// ============================================================
// GET TOP-DOWN SUMMARY
// ============================================================

export function getTopDownSummary(
  symbol
) {
  const normalizedSymbol =
    normalizeSymbol(symbol);

  const state =
    getStoredTopDownState(
      normalizedSymbol
    );

  const confirmed =
    countTopDownConfirmed(
      state
    );

  return {
    symbol:
      normalizedSymbol,

    confirmed,

    total:
      TOP_DOWN_TIMEFRAMES.length,

    isComplete:
      confirmed ===
      TOP_DOWN_TIMEFRAMES.length,

    display:
      formatTopDownDisplay({
        ...state,

        confirmed,

        confirmedCount:
          confirmed,
      }),
  };
}

// ============================================================
// CLEAR ONE SYMBOL
// ============================================================
//
// Deliberate operation only.
// Normal scanning NEVER clears HTF state.
//
// Also removes the symbol's persistent database records.
//
// ============================================================

export function clearTopDownSymbol(
  symbol
) {
  const normalizedSymbol =
    normalizeSymbol(symbol);

  if (!normalizedSymbol) {
    return false;
  }

  const deleted =
    topDownState.delete(
      normalizedSymbol
    );

  for (
    const timeframe of
    TOP_DOWN_TIMEFRAMES
  ) {
    const key =
      getTopDownDatabaseKey(
        normalizedSymbol,
        timeframe
      );

    void pgDb.delete(key);
  }

  return deleted;
}

// ============================================================
// CLEAR ONE TIMEFRAME
// ============================================================
//
// Deliberate operation only.
//
// ============================================================

export function clearTopDownTimeframe(
  symbol,
  timeframe
) {
  const normalizedSymbol =
    normalizeSymbol(symbol);

  const normalizedTimeframe =
    normalizeTimeframe(timeframe);

  if (
    !normalizedSymbol ||
    !isTopDownTimeframe(
      normalizedTimeframe
    )
  ) {
    return false;
  }

  const symbolState =
    topDownState.get(
      normalizedSymbol
    );

  if (!symbolState) {
    void pgDb.delete(
      getTopDownDatabaseKey(
        normalizedSymbol,
        normalizedTimeframe
      )
    );

    return false;
  }

  const deleted =
    symbolState.delete(
      normalizedTimeframe
    );

  void pgDb.delete(
    getTopDownDatabaseKey(
      normalizedSymbol,
      normalizedTimeframe
    )
  );

  if (symbolState.size === 0) {
    topDownState.delete(
      normalizedSymbol
    );
  }

  return deleted;
}

// ============================================================
// CLEAR EVERYTHING
// ============================================================
//
// Deliberate operation only.
//
// DO NOT call during normal scans.
//
// This removes both memory state and persistent database state.
//
// ============================================================

export async function clearAllTopDownState() {
  topDownState.clear();

  try {
    if (!pgDb.isAvailable()) {
      return false;
    }

    const keys =
      await pgDb.list(
        TOPDOWN_DB_PREFIX
      );

    let deleted = 0;

    for (const key of keys) {
      const result =
        await pgDb.delete(
          key
        );

      if (result) {
        deleted++;
      }
    }

    console.log(
      `[TOPDOWN] Cleared ${deleted} persistent CRT records.`
    );

    return true;
  } catch (error) {
    console.error(
      "[TOPDOWN] Failed to clear persistent CRT state:",
      error.message
    );

    return false;
  }
}

// ============================================================
// GET STATE SIZE
// ============================================================

export function getTopDownStateSize() {
  return topDownState.size;
}

// ============================================================
// GET ALL SYMBOLS
// ============================================================

export function getTopDownSymbols() {
  return [
    ...topDownState.keys(),
  ];
}

// ============================================================
// DEBUG STATE
// ============================================================

export function getTopDownDebugState() {
  const result = {};

  for (
    const [
      symbol,
      symbolState,
    ] of topDownState.entries()
  ) {
    result[symbol] = {};

    for (
      const timeframe of
      TOP_DOWN_TIMEFRAMES
    ) {
      const signal =
        symbolState.get(
          timeframe
        );

      result[symbol][timeframe] =
        signal
          ? {
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

              volume:
                signal.volume,

              storedAt:
                signal.storedAt,
            }
          : null;
    }
  }

  return result;
}

// ============================================================
// GET PERSISTENCE STATUS
// ============================================================

export function isTopDownPersistenceLoaded() {
  return topDownPersistenceLoaded;
}

// ============================================================
// GET DATABASE KEY FOR DEBUGGING
// ============================================================

export function getTopDownPersistenceKey(
  symbol,
  timeframe
) {
  const normalizedSymbol =
    normalizeSymbol(symbol);

  const normalizedTimeframe =
    normalizeTimeframe(timeframe);

  if (
    !normalizedSymbol ||
    !isTopDownTimeframe(
      normalizedTimeframe
    )
  ) {
    return null;
  }

  return getTopDownDatabaseKey(
    normalizedSymbol,
    normalizedTimeframe
  );
}

// ============================================================
// EXPORT CONSTANTS
// ============================================================

export {
  TOP_DOWN_TIMEFRAMES,
  LOWER_TIMEFRAME,
  ALL_TIMEFRAMES,
};

// ============================================================
// SERVICE STARTUP
// ============================================================

console.log(
  "[TOPDOWN] Rachel T top-down service loaded."
);

console.log(
  `[TOPDOWN] HTF: ${TOP_DOWN_TIMEFRAMES.join(
    " -> "
  )}`
);

console.log(
  "[TOPDOWN] Lower timeframe: 5M"
);

console.log(
  "[TOPDOWN] PostgreSQL persistence: ENABLED"
);

console.log(
  "[TOPDOWN] Persistent previous fractal: ENABLED"
);

console.log(
  "[TOPDOWN] HTF candle synchronization: DISABLED"
);

console.log(
  "[TOPDOWN] Rachel T fractal only: ENABLED"
);
