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
//   • If no NEW fractal is found, keep the previous one.
//   • If the API/data has a temporary problem, keep the
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
// PERSISTENT STATE
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
// IMPORTANT:
//
// This state persists for the lifetime of the Node.js process.
// It is intentionally NOT cleared during normal scanning.
//
// ============================================================

const topDownState = new Map();


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

  if (
    !Number.isFinite(timestamp)
  ) {
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

    storedAt:
      Date.now(),
  };
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
  ].join(
    " • "
  );
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
// Normal scanning NEVER clears HTF state.
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

  return topDownState.delete(
    normalizedSymbol
  );
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
    symbolState.size === 0
  ) {
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
// ============================================================

export function clearAllTopDownState() {
  topDownState.clear();
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
  "[TOPDOWN] Persistent previous fractal: ENABLED"
);

console.log(
  "[TOPDOWN] HTF candle synchronization: DISABLED"
);

console.log(
  "[TOPDOWN] Rachel T fractal only: ENABLED"
);
