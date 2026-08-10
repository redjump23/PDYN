```javascript
// ============================================================
// PDYN TOP-DOWN CRT
// ============================================================
//
// PURPOSE:
//
// Persistent higher-timeframe CRT state for the 5M output.
//
// FLOW:
//
//   1D
//    ↓
//   4H
//    ↓
//   1H
//    ↓
//   15M
//    ↓
//   5M
//
// IMPORTANT:
//
// 1D / 4H / 1H / 15M continue using their normal CRT output.
//
// ONLY 5M uses this module for the Top-Down display.
//
// Each higher timeframe is checked independently.
//
// Example:
//
//   1D  → HAS CRT
//   4H  → HAS CRT
//   1H  → HAS CRT
//   15M → DOESN'T HAVE CRT
//
// A timeframe does NOT need to generate a new CRT during the
// current scan.
//
// The latest previously detected Rachel T CRT is remembered.
//
// 30M is intentionally NOT part of the chain.
//
// ============================================================

// ============================================================
// TOP-DOWN TIMEFRAMES
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
// STATE
// ============================================================
//
// Structure:
//
// Map<symbol, Map<timeframe, CRT>>
//
// Example:
//
// symbol:
//   BTC_USDT
//
// timeframe:
//   1d
//
// value:
//   {
//     type: "BUY",
//     fractalType: "BOTTOM",
//     timestamp: 123456789,
//     price: 100000,
//     fractalPrice: 99500
//   }
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
// VALID HTF
// ============================================================

function isTopDownTimeframe(timeframe) {

  const normalized =
    normalizeTimeframe(timeframe);

  return TOP_DOWN_TIMEFRAMES.includes(
    normalized
  );

}

// ============================================================
// CREATE SYMBOL STATE
// ============================================================

function createSymbolState() {

  return {

    "1d": null,

    "4h": null,

    "1h": null,

    "15m": null,

  };

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
      createSymbolState()
    );

  }

  return topDownState.get(
    normalizedSymbol
  );

}

// ============================================================
// CLONE CRT
// ============================================================
//
// Prevent accidental mutation of stored state.
//
// ============================================================

function cloneCRT(crt) {

  if (!crt) {

    return null;

  }

  return {

    ...crt,

  };

}

// ============================================================
// UPDATE TOP-DOWN CRT
// ============================================================
//
// Called whenever a new Rachel T CRT is detected on:
//
//   1D
//   4H
//   1H
//   15M
//
// The previous CRT remains stored until a newer CRT replaces it.
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

  if (!normalizedSymbol) {

    return null;

  }

  if (
    !isTopDownTimeframe(
      normalizedTimeframe
    )
  ) {

    return null;

  }

  if (!signal) {

    return null;

  }

  const state =
    getSymbolState(
      normalizedSymbol
    );

  const previous =
    state[
      normalizedTimeframe
    ];

  //
  // Store a clean copy.
  //

  const storedCRT = {

    type:
      signal.type || null,

    fractalType:
      signal.fractalType || null,

    timestamp:
      Number.isFinite(
        Number(
          signal.timestamp
        )
      )
        ? Number(
            signal.timestamp
          )
        : null,

    price:
      Number.isFinite(
        Number(
          signal.price
        )
      )
        ? Number(
            signal.price
          )
        : null,

    fractalPrice:
      Number.isFinite(
        Number(
          signal.fractalPrice
        )
      )
        ? Number(
            signal.fractalPrice
          )
        : null,

    volume:
      Number.isFinite(
        Number(
          signal.volume
        )
      )
        ? Number(
            signal.volume
          )
        : 0,

  };

  state[
    normalizedTimeframe
  ] =
    storedCRT;

  return {

    previous:
      cloneCRT(
        previous
      ),

    current:
      cloneCRT(
        storedCRT
      ),

  };

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

  if (!normalizedSymbol) {

    return null;

  }

  if (
    !isTopDownTimeframe(
      normalizedTimeframe
    )
  ) {

    return null;

  }

  const state =
    topDownState.get(
      normalizedSymbol
    );

  if (!state) {

    return null;

  }

  return cloneCRT(
    state[
      normalizedTimeframe
    ]
  );

}

// ============================================================
// CHECK HAS CRT
// ============================================================

export function hasTopDownCRT(
  symbol,
  timeframe
) {

  return Boolean(
    getTopDownCRT(
      symbol,
      timeframe
    )
  );

}

// ============================================================
// GET ALL STORED CRT
// ============================================================

export function getTopDownState(
  symbol
) {

  const normalizedSymbol =
    normalizeSymbol(symbol);

  if (!normalizedSymbol) {

    return null;

  }

  const state =
    topDownState.get(
      normalizedSymbol
    );

  if (!state) {

    return createSymbolState();

  }

  return {

    "1d":
      cloneCRT(
        state["1d"]
      ),

    "4h":
      cloneCRT(
        state["4h"]
      ),

    "1h":
      cloneCRT(
        state["1h"]
      ),

    "15m":
      cloneCRT(
        state["15m"]
      ),

  };

}

// ============================================================
// BUILD TOP-DOWN CHAIN
// ============================================================
//
// IMPORTANT:
//
// This does NOT enforce price containment.
//
// It simply reports whether each HTF currently has a stored
// Rachel T CRT.
//
// ============================================================

export function buildTopDownChain(
  symbol
) {

  const normalizedSymbol =
    normalizeSymbol(symbol);

  const state =
    getSymbolState(
      normalizedSymbol
    );

  const chain =
    TOP_DOWN_TIMEFRAMES.map(
      timeframe => {

        const crt =
          state
            ? state[
                timeframe
              ]
            : null;

        return {

          timeframe,

          label:
            formatTimeframeLabel(
              timeframe
            ),

          hasCRT:
            Boolean(
              crt
            ),

          status:
            crt
              ? "HAS CRT"
              : "DOESN'T HAVE CRT",

          type:
            crt?.type ||
            null,

          fractalType:
            crt?.fractalType ||
            null,

          timestamp:
            crt?.timestamp ||
            null,

          price:
            crt?.price ||
            null,

          fractalPrice:
            crt?.fractalPrice ||
            null,

          signal:
            crt
              ? cloneCRT(
                  crt
                )
              : null,

        };

      }
    );

  const confirmed =
    chain.filter(
      item =>
        item.hasCRT
    ).length;

  return {

    symbol:
      normalizedSymbol,

    timeframes:
      chain,

    confirmed,

    total:
      TOP_DOWN_TIMEFRAMES.length,

    lowerTimeframe:
      LOWER_TIMEFRAME,

    complete:
      confirmed ===
      TOP_DOWN_TIMEFRAMES.length,

  };

}

// ============================================================
// ANALYZE TOP-DOWN
// ============================================================
//
// The 5M signal is passed in for context.
//
// The 5M itself is NOT counted as an HTF confirmation.
//
// ============================================================

export function analyzeTopDown(
  symbol,
  fiveMinuteSignal = null
) {

  const chain =
    buildTopDownChain(
      symbol
    );

  return {

    ...chain,

    fiveMinute: fiveMinuteSignal
      ? cloneCRT(
          fiveMinuteSignal
        )
      : null,

  };

}

// ============================================================
// TIMEFRAME LABEL
// ============================================================

function formatTimeframeLabel(
  timeframe
) {

  switch (
    normalizeTimeframe(
      timeframe
    )
  ) {

    case "1d":

      return "1D";

    case "4h":

      return "4H";

    case "1h":

      return "1H";

    case "15m":

      return "15M";

    case "5m":

      return "5M";

    default:

      return String(
        timeframe || ""
      ).toUpperCase();

  }

}

// ============================================================
// FORMAT TOP-DOWN COUNT
// ============================================================
//
// Example:
//
//   3/4 CONFIRMED
//
// ============================================================

export function formatTopDownCount(
  topDown
) {

  if (!topDown) {

    return "0/4 CONFIRMED";

  }

  const confirmed =
    Number(
      topDown.confirmed
    ) || 0;

  const total =
    Number(
      topDown.total
    ) ||
    TOP_DOWN_TIMEFRAMES.length;

  return (
    `${confirmed}/${total} CONFIRMED`
  );

}

// ============================================================
// FORMAT HTF CRT
// ============================================================
//
// Example:
//
// 1D HAS CRT • 4H HAS CRT • 1H HAS CRT • 15M DOESN'T HAVE CRT
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

  const chain =
    Array.isArray(
      topDown.timeframes
    )
      ? topDown.timeframes
      : [];

  return TOP_DOWN_TIMEFRAMES
    .map(
      timeframe => {

        const item =
          chain.find(
            entry =>
              entry.timeframe ===
              timeframe
          );

        const label =
          formatTimeframeLabel(
            timeframe
          );

        if (!item) {

          return (
            `${label} DOESN'T HAVE CRT`
          );

        }

        return (
          `${label} ${
            item.hasCRT
              ? "HAS CRT"
              : "DOESN'T HAVE CRT"
          }`
        );

      }
    )
    .join(
      " • "
    );

}

// ============================================================
// FORMAT DETAILED TOP-DOWN DISPLAY
// ============================================================
//
// This is useful for logs / debugging.
//
// ============================================================

export function formatTopDownDisplay(
  topDown
) {

  if (!topDown) {

    return (
      "TOP-DOWN\n" +
      "1D → DOESN'T HAVE CRT\n" +
      "4H → DOESN'T HAVE CRT\n" +
      "1H → DOESN'T HAVE CRT\n" +
      "15M → DOESN'T HAVE CRT"
    );

  }

  const chain =
    Array.isArray(
      topDown.timeframes
    )
      ? topDown.timeframes
      : [];

  const lines =
    TOP_DOWN_TIMEFRAMES.map(
      timeframe => {

        const item =
          chain.find(
            entry =>
              entry.timeframe ===
              timeframe
          );

        const label =
          formatTimeframeLabel(
            timeframe
          );

        if (!item) {

          return (
            `${label} → DOESN'T HAVE CRT`
          );

        }

        if (
          item.hasCRT
        ) {

          const type =
            item.type
              ? ` (${item.type})`
              : "";

          return (
            `${label} → HAS CRT${type}`
          );

        }

        return (
          `${label} → DOESN'T HAVE CRT`
        );

      }
    );

  return (
    "TOP-DOWN\n" +
    lines.join(
      "\n"
    )
  );

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
// GET LOWER TIMEFRAME
// ============================================================

export function getLowerTimeframe() {

  return LOWER_TIMEFRAME;

}

// ============================================================
// CLEAR SYMBOL
// ============================================================
//
// Useful for testing or manually resetting a symbol.
//
// ============================================================

export function clearTopDownSymbol(
  symbol
) {

  const normalizedSymbol =
    normalizeSymbol(
      symbol
    );

  if (!normalizedSymbol) {

    return false;

  }

  return topDownState.delete(
    normalizedSymbol
  );

}

// ============================================================
// CLEAR ALL
// ============================================================
//
// Clears all persistent top-down state.
//
// ============================================================

export function clearAllTopDownState() {

  topDownState.clear();

}

// ============================================================
// EXPORT SNAPSHOT
// ============================================================
//
// Returns all stored HTF CRT data.
//
// ============================================================

export function getAllTopDownState() {

  const result = {};

  for (
    const [
      symbol,
      state
    ]
    of topDownState.entries()
  ) {

    result[
      symbol
    ] = {

      "1d":
        cloneCRT(
          state["1d"]
        ),

      "4h":
        cloneCRT(
          state["4h"]
        ),

      "1h":
        cloneCRT(
          state["1h"]
        ),

      "15m":
        cloneCRT(
          state["15m"]
        ),

    };

  }

  return result;

}

// ============================================================
// SERVICE INFO
// ============================================================

export function getTopDownServiceInfo() {

  return {

    timeframes:
      [
        ...TOP_DOWN_TIMEFRAMES,
      ],

    lowerTimeframe:
      LOWER_TIMEFRAME,

    persistent:
      true,

    containmentRequired:
      false,

    independentConfirmation:
      true,

    description:
      "Persistent independent HTF Rachel T CRT state for 5M top-down display.",

  };

}

// ============================================================
// STARTUP
// ============================================================

console.log(
  "[TOP-DOWN] Module loaded."
);

console.log(
  "[TOP-DOWN] HTF chain: 1D -> 4H -> 1H -> 15M -> 5M"
);

console.log(
  "[TOP-DOWN] Persistent HTF CRT: ENABLED"
);

console.log(
  "[TOP-DOWN] Independent HTF confirmation: ENABLED"
);

console.log(
  "[TOP-DOWN] Price containment requirement: DISABLED"
);

console.log(
  "[TOP-DOWN] 30M: REMOVED"
);
```
