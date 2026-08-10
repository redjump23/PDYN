```javascript
// ============================================================
// PDYN CRT TOP-DOWN SERVICE
// ============================================================
//
// PURPOSE
// ============================================================
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
// PostgreSQL persistence:
//
//   • Previous confirmed HTF fractals survive Railway restart.
//   • Memory cache is used for fast reads.
//   • Database is loaded asynchronously at startup.
//   • Newer fractals replace older fractals.
//   • Older/equal fractals are ignored.
//   • Temporary database failures do NOT clear memory.
//   • No TTL is applied to HTF CRT state.
//
// ============================================================
//
// DOES NOT USE
// ============================================================
//
//   RSI
//   Standard Deviation
//   Market Structure
//   Candle containment
//   Same-candle HTF confirmation
//   30M
//
// ============================================================

import pgDb from "../../utils/postgresDatabase.js";

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
// ALL SUPPORTED TIMEFRAMES
// ============================================================

const ALL_TIMEFRAMES = [
  ...TOP_DOWN_TIMEFRAMES,
  LOWER_TIMEFRAME,
];

// ============================================================
// DATABASE KEY PREFIX
// ============================================================
//
// One database key per symbol:
//
// temp:pdyn:topdown:BTC_USDT
//
// Stored value:
//
// {
//   "1d": {...},
//   "4h": {...},
//   "1h": {...},
//   "15m": {...}
// }
//
// ============================================================

const DATABASE_KEY_PREFIX =
  "pdyn:topdown:";

// ============================================================
// IN-MEMORY STATE
// ============================================================
//
// Map<symbol, Map<timeframe, CRT>>
//
// ============================================================

const topDownState = new Map();

// ============================================================
// DATABASE LOAD STATE
// ============================================================

let databaseLoadStarted = false;

let databaseLoadCompleted = false;

// ============================================================
// DATABASE WRITE QUEUE
// ============================================================
//
// Prevent multiple writes for the same symbol from racing.
//
// ============================================================

const databaseWriteQueue = new Map();

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
// DATABASE KEY
// ============================================================

function getDatabaseKey(symbol) {
  const normalizedSymbol =
    normalizeSymbol(symbol);

  if (!normalizedSymbol) {
    return null;
  }

  return (
    DATABASE_KEY_PREFIX +
    normalizedSymbol
  );
}

// ============================================================
// CHECK TOP-DOWN TIMEFRAME
// ============================================================

export function isTopDownTimeframe(
  timeframe
) {
  return TOP_DOWN_TIMEFRAMES.includes(
    normalizeTimeframe(timeframe)
  );
}

// ============================================================
// CHECK SUPPORTED TIMEFRAME
// ============================================================

function isSupportedTimeframe(
  timeframe
) {
  return ALL_TIMEFRAMES.includes(
    normalizeTimeframe(timeframe)
  );
}

// ============================================================
// GET SYMBOL STATE
// ============================================================

function getSymbolState(symbol) {
  const normalizedSymbol =
    normalizeSymbol(symbol);

  if (!normalizedSymbol) {
    return null;
  }

  if (!topDownState.has(normalizedSymbol)) {
    topDownState.set(
      normalizedSymbol,
      new Map()
    );
  }

  return topDownState.get(
    normalizedSymbol
  );
}

// ============================================================
// CREATE EMPTY TOP-DOWN STATE
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
// NORMALIZE SIGNAL
// ============================================================

function normalizeSignal(
  symbol,
  timeframe,
  signal
) {
  if (!signal) {
    return null;
  }

  const normalizedSymbol =
    normalizeSymbol(symbol);

  const normalizedTimeframe =
    normalizeTimeframe(timeframe);

  if (
    !normalizedSymbol ||
    !isSupportedTimeframe(
      normalizedTimeframe
    )
  ) {
    return null;
  }

  const timestamp =
    Number(signal.timestamp);

  if (!Number.isFinite(timestamp)) {
    return null;
  }

  const type =
    String(signal.type || "")
      .trim()
      .toUpperCase();

  if (
    type !== "BUY" &&
    type !== "SELL"
  ) {
    return null;
  }

  const fractalType =
    String(
      signal.fractalType ||
        (
          type === "BUY"
            ? "BOTTOM"
            : "TOP"
        )
    )
      .trim()
      .toUpperCase();

  const price =
    Number(signal.price);

  const fractalPrice =
    Number(signal.fractalPrice);

  const volume =
    Number(signal.volume);

  const candleTimestamp =
    Number(signal.candleTimestamp);

  const candleStart =
    Number(signal.candleStart);

  const candleEnd =
    Number(signal.candleEnd);

  return {
    symbol:
      normalizedSymbol,

    timeframe:
      normalizedTimeframe,

    type,

    fractalType,

    timestamp,

    price:
      Number.isFinite(price)
        ? price
        : null,

    fractalPrice:
      Number.isFinite(fractalPrice)
        ? fractalPrice
        : null,

    volume:
      Number.isFinite(volume)
        ? volume
        : 0,

    candleTimestamp:
      Number.isFinite(
        candleTimestamp
      )
        ? candleTimestamp
        : timestamp,

    candleStart:
      Number.isFinite(
        candleStart
      )
        ? candleStart
        : timestamp,

    candleEnd:
      Number.isFinite(
        candleEnd
      )
        ? candleEnd
        : null,

    storedAt:
      Number.isFinite(
        Number(signal.storedAt)
      )
        ? Number(signal.storedAt)
        : Date.now(),
  };
}

// ============================================================
// SERIALIZE SIGNAL
// ============================================================

function serializeSignal(signal) {
  if (!signal) {
    return null;
  }

  return {
    symbol:
      signal.symbol,

    timeframe:
      signal.timeframe,

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

    candleTimestamp:
      signal.candleTimestamp,

    candleStart:
      signal.candleStart,

    candleEnd:
      signal.candleEnd,

    storedAt:
      signal.storedAt,
  };
}

// ============================================================
// SAVE SYMBOL STATE TO POSTGRESQL
// ============================================================
//
// IMPORTANT:
//
// This function is asynchronous, but updateTopDownCRT()
// remains synchronous so existing crtService.js does not
// need to use await.
//
// ============================================================

async function persistSymbolState(
  symbol
) {
  const normalizedSymbol =
    normalizeSymbol(symbol);

  if (!normalizedSymbol) {
    return false;
  }

  const key =
    getDatabaseKey(
      normalizedSymbol
    );

  if (!key) {
    return false;
  }

  const symbolState =
    topDownState.get(
      normalizedSymbol
    );

  if (!symbolState) {
    return false;
  }

  const payload =
    createEmptyTopDownState();

  for (
    const timeframe of
      TOP_DOWN_TIMEFRAMES
  ) {
    const signal =
      symbolState.get(
        timeframe
      );

    if (signal) {
      payload[timeframe] =
        serializeSignal(
          signal
        );
    }
  }

  try {
    if (
      !pgDb ||
      typeof pgDb.set !==
        "function"
    ) {
      console.error(
        "[TOPDOWN] PostgreSQL pgDb.set() is unavailable."
      );

      return false;
    }

    await pgDb.set(
      key,
      payload
    );

    return true;
  } catch (error) {
    console.error(
      `[TOPDOWN] PostgreSQL save failed for ${normalizedSymbol}:`,
      error?.message ||
        error
    );

    return false;
  }
}

// ============================================================
// QUEUE DATABASE WRITE
// ============================================================
//
// Prevent overlapping writes for the same symbol.
//
// ============================================================

function queueDatabaseWrite(
  symbol
) {
  const normalizedSymbol =
    normalizeSymbol(symbol);

  if (!normalizedSymbol) {
    return;
  }

  const previousPromise =
    databaseWriteQueue.get(
      normalizedSymbol
    ) || Promise.resolve();

  const nextPromise =
    previousPromise
      .catch(
        () => {}
      )
      .then(
        () =>
          persistSymbolState(
            normalizedSymbol
          )
      )
      .catch(
        error => {
          console.error(
            `[TOPDOWN] Database queue error ${normalizedSymbol}:`,
            error?.message ||
              error
          );
        }
      );

  databaseWriteQueue.set(
    normalizedSymbol,
    nextPromise
  );

  nextPromise.finally(
    () => {
      if (
        databaseWriteQueue.get(
          normalizedSymbol
        ) === nextPromise
      ) {
        databaseWriteQueue.delete(
          normalizedSymbol
        );
      }
    }
  );
}

// ============================================================
// LOAD ONE SYMBOL FROM POSTGRESQL
// ============================================================

async function loadSymbolFromDatabase(
  symbol
) {
  const normalizedSymbol =
    normalizeSymbol(symbol);

  if (!normalizedSymbol) {
    return false;
  }

  const key =
    getDatabaseKey(
      normalizedSymbol
    );

  if (!key) {
    return false;
  }

  try {
    if (
      !pgDb ||
      typeof pgDb.get !==
        "function"
    ) {
      console.error(
        "[TOPDOWN] PostgreSQL pgDb.get() is unavailable."
      );

      return false;
    }

    const stored =
      await pgDb.get(
        key
      );

    if (
      !stored ||
      typeof stored !==
        "object"
    ) {
      return false;
    }

    const symbolState =
      getSymbolState(
        normalizedSymbol
      );

    if (!symbolState) {
      return false;
    }

    let loadedCount = 0;

    for (
      const timeframe of
        TOP_DOWN_TIMEFRAMES
    ) {
      const storedSignal =
        stored[
          timeframe
        ];

      if (!storedSignal) {
        continue;
      }

      const normalizedSignal =
        normalizeSignal(
          normalizedSymbol,
          timeframe,
          storedSignal
        );

      if (!normalizedSignal) {
        continue;
      }

      const previous =
        symbolState.get(
          timeframe
        );

      if (
        !previous ||
        normalizedSignal.timestamp >
          previous.timestamp
      ) {
        symbolState.set(
          timeframe,
          normalizedSignal
        );

        loadedCount++;
      }
    }

    if (loadedCount > 0) {
      console.log(
        `[TOPDOWN] PostgreSQL restored ${normalizedSymbol}: ${loadedCount} HTF CRT(s)`
      );

      return true;
    }

    return false;
  } catch (error) {
    console.error(
      `[TOPDOWN] PostgreSQL load failed for ${normalizedSymbol}:`,
      error?.message ||
        error
    );

    return false;
  }
}

// ============================================================
// LOAD ALL TOP-DOWN STATE
// ============================================================
//
// The existing database layer may not expose a convenient
// "get all top-down keys" method.
//
// Therefore:
//
// 1. Existing in-memory state is always safe.
// 2. Known symbols can be restored when requested.
// 3. New signals are persisted immediately.
//
// ============================================================

export async function loadTopDownState(
  symbols = []
) {
  if (
    databaseLoadStarted &&
    databaseLoadCompleted
  ) {
    return true;
  }

  databaseLoadStarted =
    true;

  const normalizedSymbols = [
    ...new Set(
      (
        Array.isArray(symbols)
          ? symbols
          : []
      )
        .map(
          normalizeSymbol
        )
        .filter(Boolean)
    ),
  ];

  try {
    for (
      const symbol of
        normalizedSymbols
    ) {
      await loadSymbolFromDatabase(
        symbol
      );
    }

    databaseLoadCompleted =
      true;

    console.log(
      `[TOPDOWN] PostgreSQL state load completed | symbols: ${normalizedSymbols.length}`
    );

    return true;
  } catch (error) {
    console.error(
      "[TOPDOWN] PostgreSQL startup load failed:",
      error?.message ||
        error
    );

    databaseLoadCompleted =
      false;

    return false;
  }
}

// ============================================================
// ENSURE SYMBOL DATABASE STATE
// ============================================================
//
// Called when a symbol is first encountered.
//
// It loads the persisted state once, but does not block the
// synchronous CRT update API.
//
// ============================================================

function ensureSymbolDatabaseLoad(
  symbol
) {
  const normalizedSymbol =
    normalizeSymbol(symbol);

  if (!normalizedSymbol) {
    return;
  }

  const symbolState =
    getSymbolState(
      normalizedSymbol
    );

  if (!symbolState) {
    return;
  }

  // ----------------------------------------------------------
  // Marker stored directly on the Map object.
  // ----------------------------------------------------------

  if (
    symbolState.__databaseLoaded
  ) {
    return;
  }

  Object.defineProperty(
    symbolState,
    "__databaseLoaded",
    {
      value:
        true,
      writable:
        true,
      configurable:
        true,
      enumerable:
        false,
    }
  );

  loadSymbolFromDatabase(
    normalizedSymbol
  ).catch(
    error => {
      console.error(
        `[TOPDOWN] Background database restore failed ${normalizedSymbol}:`,
        error?.message ||
          error
      );
    }
  );
}

// ============================================================
// STORE / UPDATE CRT
// ============================================================
//
// IMPORTANT:
//
// This function remains synchronous.
//
// crtService.js currently calls:
//
//   updateTopDownCRT(...)
//
// without await.
//
// Therefore database persistence happens asynchronously.
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
      `[TOPDOWN] Stored ${normalizedSymbol} ${normalizedTimeframe.toUpperCase()} ${normalizedSignal.type} fractal`
    );

    queueDatabaseWrite(
      normalizedSymbol
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
    `[TOPDOWN] Updated ${normalizedSymbol} ${normalizedTimeframe.toUpperCase()} ${normalizedSignal.type} fractal`
  );

  queueDatabaseWrite(
    normalizedSymbol
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

  ensureSymbolDatabaseLoad(
    normalizedSymbol
  );

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
    ) ||
    null
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

  ensureSymbolDatabaseLoad(
    normalizedSymbol
  );

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
    if (
      topDown[timeframe]
    ) {
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
  ].join(
    " • "
  );
}

// ============================================================
// FORMAT HTF CRT DETAILS
// ============================================================
//
// Alias required by crtService.js.
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
  ].join(
    "\n"
  );
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
//
// Also removes the PostgreSQL record.
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

  const key =
    getDatabaseKey(
      normalizedSymbol
    );

  if (
    key &&
    pgDb &&
    typeof pgDb.delete ===
      "function"
  ) {
    Promise.resolve(
      pgDb.delete(
        key
      )
    ).catch(
      error => {
        console.error(
          `[TOPDOWN] PostgreSQL delete failed ${normalizedSymbol}:`,
          error?.message ||
            error
        );
      }
    );
  }

  return deleted;
}

// ============================================================
// CLEAR ONE TIMEFRAME
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
    return false;
  }

  const deleted =
    symbolState.delete(
      normalizedTimeframe
    );

  if (
    !deleted
  ) {
    return false;
  }

  queueDatabaseWrite(
    normalizedSymbol
  );

  if (
    symbolState.size === 0
  ) {
    topDownState.delete(
      normalizedSymbol
    );
  }

  return true;
}

// ============================================================
// CLEAR EVERYTHING
// ============================================================
//
// Deliberate operation only.
//
// WARNING:
//
// This clears memory state.
//
// Database records are also removed when the database layer
// supports delete().
//
// ============================================================

export async function clearAllTopDownState() {
  const symbols =
    getTopDownSymbols();

  topDownState.clear();

  databaseWriteQueue.clear();

  if (
    pgDb &&
    typeof pgDb.delete ===
      "function"
  ) {
    for (
      const symbol of
        symbols
    ) {
      const key =
        getDatabaseKey(
          symbol
        );

      if (!key) {
        continue;
      }

      try {
        await pgDb.delete(
          key
        );
      } catch (error) {
        console.error(
          `[TOPDOWN] PostgreSQL clear failed ${symbol}:`,
          error?.message ||
            error
        );
      }
    }
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
// GET DATABASE STATUS
// ============================================================

export function getTopDownDatabaseStatus() {
  return {
    enabled:
      Boolean(
        pgDb
      ),

    loadStarted:
      databaseLoadStarted,

    loadCompleted:
      databaseLoadCompleted,

    databaseKeyPrefix:
      DATABASE_KEY_PREFIX,

    persistence:
      true,
  };
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

      result[symbol][
        timeframe
      ] =
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

              candleTimestamp:
                signal.candleTimestamp,

              candleStart:
                signal.candleStart,

              candleEnd:
                signal.candleEnd,

              storedAt:
                signal.storedAt,
            }
          : null;
    }
  }

  return result;
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
// STARTUP
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

console.log(
  "[TOPDOWN] RSI: DISABLED"
);

console.log(
  "[TOPDOWN] Standard Deviation: DISABLED"
);

console.log(
  "[TOPDOWN] Market Structure: DISABLED"
);

console.log(
  "[TOPDOWN] 30M: REMOVED"
);
```
