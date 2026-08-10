```javascript
// ============================================================
// PDYN TOP-DOWN CRT ENGINE
// ============================================================
//
// PURPOSE:
//
// Persistent higher-timeframe CRT state for the PDYN CRT
// signal service.
//
// HIERARCHY:
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
// 30M is intentionally NOT included.
//
// Higher-timeframe CRT signals are persistent.
//
// If a higher timeframe does NOT produce a new CRT during
// the current scan, the previously stored CRT remains available
// to the 5M analysis.
//
// The 5M signal therefore does NOT require a brand-new HTF CRT
// during the same scan.
//
// ============================================================

// ============================================================
// TIMEFRAME DEFINITIONS
// ============================================================

const TIMEFRAME_MINUTES = {

  "1d":
    1440,

  "4h":
    240,

  "1h":
    60,

  "15m":
    15,

  "5m":
    5,

};

// ============================================================
// TOP-DOWN TIMEFRAMES
// ============================================================
//
// These are the persistent HTF levels.
//
// 5M is included because the top-down display also shows
// the current 5M CRT.
//
// ============================================================

const TOP_DOWN_TIMEFRAMES = [

  "1d",

  "4h",

  "1h",

  "15m",

  "5m",

];

// ============================================================
// PERSISTENT STATE
// ============================================================
//
// Structure:
//
// Map<symbol, Map<timeframe, signal>>
//
// Example:
//
// BTC_USDT
//   ├── 1d  -> previous CRT
//   ├── 4h  -> previous CRT
//   ├── 1h  -> previous CRT
//   ├── 15m -> previous CRT
//   └── 5m  -> latest 5M CRT
//
// This state intentionally remains in memory for the lifetime
// of the bot process.
//
// ============================================================

const topDownState =
  new Map();

// ============================================================
// NORMALIZE SYMBOL
// ============================================================

function normalizeSymbol(
  symbol
) {

  return String(
    symbol || ""
  )
    .trim()
    .toUpperCase();

}

// ============================================================
// NORMALIZE TIMEFRAME
// ============================================================

export function normalizeTimeframe(
  timeframe
) {

  return String(
    timeframe || ""
  )
    .trim()
    .toLowerCase();

}

// ============================================================
// CHECK TOP-DOWN TIMEFRAME
// ============================================================
//
// Used by crtService.js.
//
// IMPORTANT:
//
// 30M returns false.
//
// ============================================================

export function isTopDownTimeframe(
  timeframe
) {

  const normalized =
    normalizeTimeframe(
      timeframe
    );

  return TOP_DOWN_TIMEFRAMES.includes(
    normalized
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
// GET TIMEFRAME MILLISECONDS
// ============================================================

export function getTimeframeMilliseconds(
  timeframe
) {

  const normalized =
    normalizeTimeframe(
      timeframe
    );

  const minutes =
    TIMEFRAME_MINUTES[
      normalized
    ];

  if (
    !minutes
  ) {

    return 0;

  }

  return (
    minutes *
    60 *
    1000
  );

}

// ============================================================
// GET CANDLE RANGE
// ============================================================
//
// Returns:
//
// {
//   start,
//   end
// }
//
// Timestamp is expected to be milliseconds.
//
// ============================================================

export function getCandleRange(
  timestamp,
  timeframe
) {

  const start =
    Number(
      timestamp
    );

  if (
    !Number.isFinite(
      start
    )
  ) {

    return null;

  }

  const duration =
    getTimeframeMilliseconds(
      timeframe
    );

  if (
    !duration
  ) {

    return null;

  }

  return {

    start,

    end:
      start +
      duration,

  };

}

// ============================================================
// TIMESTAMP INSIDE CANDLE
// ============================================================

export function isTimestampInsideCandle(
  timestamp,
  candleTimestamp,
  timeframe
) {

  const childTimestamp =
    Number(
      timestamp
    );

  const parentTimestamp =
    Number(
      candleTimestamp
    );

  if (
    !Number.isFinite(
      childTimestamp
    ) ||
    !Number.isFinite(
      parentTimestamp
    )
  ) {

    return false;

  }

  const range =
    getCandleRange(
      parentTimestamp,
      timeframe
    );

  if (
    !range
  ) {

    return false;

  }

  return (
    childTimestamp >=
      range.start &&
    childTimestamp <
      range.end
  );

}

// ============================================================
// SIGNAL INSIDE PARENT
// ============================================================
//
// This helper remains available for compatibility and testing.
//
// IMPORTANT:
//
// It is NOT required for persistent HTF display.
//
// The persistent model remembers the latest valid CRT at each
// timeframe independently.
//
// ============================================================

export function isSignalInsideParent(
  childSignal,
  parentSignal,
  parentTimeframe
) {

  if (
    !childSignal ||
    !parentSignal
  ) {

    return false;

  }

  const childTimestamp =
    Number(
      childSignal.timestamp
    );

  const parentTimestamp =
    Number(
      parentSignal.timestamp
    );

  if (
    !Number.isFinite(
      childTimestamp
    ) ||
    !Number.isFinite(
      parentTimestamp
    )
  ) {

    return false;

  }

  return isTimestampInsideCandle(
    childTimestamp,
    parentTimestamp,
    parentTimeframe
  );

}

// ============================================================
// CREATE SYMBOL STATE
// ============================================================

function ensureSymbolState(
  symbol
) {

  const normalized =
    normalizeSymbol(
      symbol
    );

  if (
    !normalized
  ) {

    return null;

  }

  if (
    !topDownState.has(
      normalized
    )
  ) {

    topDownState.set(
      normalized,
      {
        "1d":
          null,

        "4h":
          null,

        "1h":
          null,

        "15m":
          null,

        "5m":
          null,

      }
    );

  }

  return topDownState.get(
    normalized
  );

}

// ============================================================
// CLONE SIGNAL
// ============================================================
//
// Prevent accidental mutation of the stored signal object.
//
// ============================================================

function cloneSignal(
  signal
) {

  if (
    !signal ||
    typeof signal !==
      "object"
  ) {

    return null;

  }

  return {
    ...signal,
  };

}

// ============================================================
// UPDATE TOP-DOWN CRT
// ============================================================
//
// Called by crtService.js whenever a new confirmed CRT is
// detected.
//
// HTF signals are persistent.
//
// A later scan with NO new CRT does not erase the stored value.
//
// ============================================================

export function updateTopDownCRT(
  symbol,
  timeframe,
  signal
) {

  const normalizedSymbol =
    normalizeSymbol(
      symbol
    );

  const normalizedTimeframe =
    normalizeTimeframe(
      timeframe
    );

  if (
    !normalizedSymbol
  ) {

    return null;

  }

  if (
    !isTopDownTimeframe(
      normalizedTimeframe
    )
  ) {

    return null;

  }

  if (
    !signal ||
    typeof signal !==
      "object"
  ) {

    return null;

  }

  const timestamp =
    Number(
      signal.timestamp
    );

  if (
    !Number.isFinite(
      timestamp
    )
  ) {

    return null;

  }

  const state =
    ensureSymbolState(
      normalizedSymbol
    );

  const existing =
    state[
      normalizedTimeframe
    ];

  //
  // Do not replace a newer stored CRT with an older one.
  //

  if (
    existing &&
    Number.isFinite(
      Number(
        existing.timestamp
      )
    ) &&
    timestamp <
      Number(
        existing.timestamp
      )
  ) {

    return cloneSignal(
      existing
    );

  }

  const storedSignal = {

    ...signal,

    symbol:
      signal.symbol ||
      normalizedSymbol,

    timeframe:
      signal.timeframe ||
      normalizedTimeframe,

    timestamp,

  };

  state[
    normalizedTimeframe
  ] =
    storedSignal;

  return cloneSignal(
    storedSignal
  );

}

// ============================================================
// GET STORED CRT
// ============================================================

export function getStoredTopDownCRT(
  symbol,
  timeframe
) {

  const normalizedSymbol =
    normalizeSymbol(
      symbol
    );

  const normalizedTimeframe =
    normalizeTimeframe(
      timeframe
    );

  if (
    !normalizedSymbol ||
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

  if (
    !state
  ) {

    return null;

  }

  return cloneSignal(
    state[
      normalizedTimeframe
    ]
  );

}

// ============================================================
// GET ALL STORED CRT
// ============================================================

export function getTopDownState(
  symbol
) {

  const normalizedSymbol =
    normalizeSymbol(
      symbol
    );

  const state =
    topDownState.get(
      normalizedSymbol
    );

  if (
    !state
  ) {

    return createEmptyTopDownState();

  }

  return {

    "1d":
      cloneSignal(
        state["1d"]
      ),

    "4h":
      cloneSignal(
        state["4h"]
      ),

    "1h":
      cloneSignal(
        state["1h"]
      ),

    "15m":
      cloneSignal(
        state["15m"]
      ),

    "5m":
      cloneSignal(
        state["5m"]
      ),

  };

}

// ============================================================
// GET ALL STORED SYMBOLS
// ============================================================

export function getTopDownSymbols() {

  return [
    ...topDownState.keys(),
  ];

}

// ============================================================
// CLEAR SYMBOL
// ============================================================

export function clearTopDownState(
  symbol
) {

  const normalizedSymbol =
    normalizeSymbol(
      symbol
    );

  if (
    !normalizedSymbol
  ) {

    return false;

  }

  return topDownState.delete(
    normalizedSymbol
  );

}

// ============================================================
// CLEAR ALL
// ============================================================

export function clearAllTopDownState() {

  topDownState.clear();

}

// ============================================================
// BUILD TOP-DOWN CHAIN
// ============================================================
//
// This function creates a snapshot for display.
//
// IMPORTANT:
//
// The chain is NOT invalidated just because an HTF CRT was
// created earlier than the current 5M signal.
//
// Persistent previous CRTs are intentionally allowed.
//
// Each timeframe therefore reports its latest stored CRT.
//
// "confirmedCount" means how many levels currently have a
// stored CRT.
//
// ============================================================

export function buildTopDownChain(
  states
) {

  const source =
    states instanceof Map
      ? Object.fromEntries(
          states
        )
      : (
        states &&
        typeof states ===
          "object"
          ? states
          : {}
      );

  const result = {

    confirmed:
      false,

    levels: {

      "1d": {

        hasCRT:
          false,

        type:
          null,

        signal:
          null,

        linked:
          true,

      },

      "4h": {

        hasCRT:
          false,

        type:
          null,

        signal:
          null,

        linked:
          false,

      },

      "1h": {

        hasCRT:
          false,

        type:
          null,

        signal:
          null,

        linked:
          false,

      },

      "15m": {

        hasCRT:
          false,

        type:
          null,

        signal:
          null,

        linked:
          false,

      },

      "5m": {

        hasCRT:
          false,

        type:
          null,

        signal:
          null,

        linked:
          false,

      },

    },

    confirmedCount:
      0,

    total:
      5,

    chainStatus:
      "INCOMPLETE",

  };

  const levels =
    [
      "1d",
      "4h",
      "1h",
      "15m",
      "5m",
    ];

  for (
    const timeframe of
      levels
  ) {

    const signal =
      source[
        timeframe
      ];

    if (
      !signal ||
      !signal.type
    ) {

      continue;

    }

    if (
      !Number.isFinite(
        Number(
          signal.timestamp
        )
      )
    ) {

      continue;

    }

    result.levels[
      timeframe
    ] = {

      hasCRT:
        true,

      type:
        signal.type,

      signal:
        cloneSignal(
          signal
        ),

      linked:
        true,

    };

    result.confirmedCount++;

  }

  result.confirmed =
    result.confirmedCount ===
    result.total;

  result.chainStatus =
    result.confirmed
      ? "CONFIRMED"
      : "INCOMPLETE";

  return result;

}

// ============================================================
// ANALYZE TOP-DOWN
// ============================================================
//
// Called by crtService.js:
//
//   analyzeTopDown(symbol, signal)
//
// The current 5M signal is inserted into a temporary snapshot.
//
// The persistent HTF CRTs remain untouched.
//
// This is the key behavior:
//
//   1D previous CRT
//   4H previous CRT
//   1H previous CRT
//   15M previous CRT
//   5M current CRT
//
// Therefore a 5M signal can always display the latest available
// HTF CRT information, even when no HTF CRT occurred in the
// current scan.
//
// ============================================================

export function analyzeTopDown(
  symbol,
  fiveMinuteSignal = null
) {

  const normalizedSymbol =
    normalizeSymbol(
      symbol
    );

  const stored =
    getTopDownState(
      normalizedSymbol
    );

  //
  // If a current 5M signal was supplied, use it for this
  // analysis snapshot.
  //
  // Do NOT automatically persist it here.
  //
  // crtService.js controls persistence through
  // updateTopDownCRT().
  //

  if (
    fiveMinuteSignal &&
    typeof fiveMinuteSignal ===
      "object"
  ) {

    stored["5m"] =
      cloneSignal(
        fiveMinuteSignal
      );

  }

  const chain =
    buildTopDownChain(
      stored
    );

  //
  // Count only HTF levels.
  //
  // 1D + 4H + 1H + 15M = 4.
  //

  const htfTimeframes = [

    "1d",

    "4h",

    "1h",

    "15m",

  ];

  let htfConfirmedCount =
    0;

  for (
    const timeframe of
      htfTimeframes
  ) {

    if (
      chain.levels[
        timeframe
      ]?.hasCRT
    ) {

      htfConfirmedCount++;

    }

  }

  const htfTotal =
    htfTimeframes.length;

  const htfConfirmed =
    htfConfirmedCount ===
    htfTotal;

  return {

    symbol:
      normalizedSymbol,

    confirmed:
      htfConfirmed,

    chainConfirmed:
      chain.confirmed,

    confirmedCount:
      htfConfirmedCount,

    total:
      htfTotal,

    chain,

    levels:
      chain.levels,

    htf: {

      "1d":
        cloneSignal(
          stored["1d"]
        ),

      "4h":
        cloneSignal(
          stored["4h"]
        ),

      "1h":
        cloneSignal(
          stored["1h"]
        ),

      "15m":
        cloneSignal(
          stored["15m"]
        ),

    },

    current5m:
      cloneSignal(
        stored["5m"]
      ),

  };

}

// ============================================================
// LEVEL DISPLAY
// ============================================================

export function getLevelDisplay(
  level
) {

  if (
    !level ||
    !level.hasCRT
  ) {

    return "❌ NO CRT";

  }

  if (
    level.type ===
    "BUY"
  ) {

    return "🟢 BUY CRT";

  }

  if (
    level.type ===
    "SELL"
  ) {

    return "🔴 SELL CRT";

  }

  return "❓ UNKNOWN";

}

// ============================================================
// FORMAT TOP-DOWN COUNT
// ============================================================
//
// Used directly by crtService.js.
//
// Example:
//
// 4/4 CONFIRMED
//
// ============================================================

export function formatTopDownCount(
  topDown
) {

  if (
    !topDown
  ) {

    return "0/4 CONFIRMED";

  }

  const count =
    Number(
      topDown.confirmedCount
    ) || 0;

  const total =
    Number(
      topDown.total
    ) || 4;

  return (
    `${Math.min(
      count,
      total
    )}/${total} CONFIRMED`
  );

}

// ============================================================
// FORMAT HTF CRT
// ============================================================
//
// Compact format for Discord:
//
// 1D BUY • 4H BUY • 1H N/A • 15M SELL
//
// ============================================================

function formatSignalShort(
  signal
) {

  if (
    !signal ||
    !signal.type
  ) {

    return "N/A";

  }

  if (
    signal.type ===
    "BUY"
  ) {

    return "BUY";

  }

  if (
    signal.type ===
    "SELL"
  ) {

    return "SELL";

  }

  return "N/A";

}

export function formatHTFCRT(
  topDown
) {

  if (
    !topDown
  ) {

    return (
      "1D N/A • " +
      "4H N/A • " +
      "1H N/A • " +
      "15M N/A"
    );

  }

  const levels =
    topDown.levels ||
    topDown.chain?.levels ||
    {};

  return [

    `1D ${formatSignalShort(
      levels["1d"]?.signal ||
      topDown.htf?.["1d"]
    )}`,

    `4H ${formatSignalShort(
      levels["4h"]?.signal ||
      topDown.htf?.["4h"]
    )}`,

    `1H ${formatSignalShort(
      levels["1h"]?.signal ||
      topDown.htf?.["1h"]
    )}`,

    `15M ${formatSignalShort(
      levels["15m"]?.signal ||
      topDown.htf?.["15m"]
    )}`,

  ].join(
    " • "
  );

}

// ============================================================
// FORMAT HTF CRT DETAILS
// ============================================================
//
// Detailed version for diagnostics/tests.
//
// ============================================================

export function formatHTFCRTDetails(
  topDown
) {

  if (
    !topDown
  ) {

    return (
      "1D: N/A\n" +
      "4H: N/A\n" +
      "1H: N/A\n" +
      "15M: N/A"
    );

  }

  const levels =
    topDown.levels ||
    topDown.chain?.levels ||
    {};

  const lines = [];

  for (
    const [
      timeframe,
      label,
    ] of [
      [
        "1d",
        "1D",
      ],
      [
        "4h",
        "4H",
      ],
      [
        "1h",
        "1H",
      ],
      [
        "15m",
        "15M",
      ],
    ]
  ) {

    const signal =
      levels[
        timeframe
      ]?.signal ||
      topDown.htf?.[
        timeframe
      ] ||
      null;

    if (
      !signal
    ) {

      lines.push(
        `${label}: N/A`
      );

      continue;

    }

    const type =
      signal.type ||
      "N/A";

    const timestamp =
      Number(
        signal.timestamp
      );

    const time =
      Number.isFinite(
        timestamp
      )
        ? new Date(
            timestamp
          ).toISOString()
        : "N/A";

    lines.push(
      `${label}: ${type} • ${time}`
    );

  }

  return lines.join(
    "\n"
  );

}

// ============================================================
// FORMAT COMPLETE TOP-DOWN DISPLAY
// ============================================================

export function formatTopDownDisplay(
  chain
) {

  if (
    !chain
  ) {

    return [

      "1D → ❌ NO CRT",

      "4H → ❌ NO CRT",

      "1H → ❌ NO CRT",

      "15M → ❌ NO CRT",

      "5M → ❌ NO CRT",

      "",

      "TOP-DOWN → INCOMPLETE",

    ].join(
      "\n"
    );

  }

  const levels =
    chain.levels ||
    {};

  const lines = [

    `1D → ${getLevelDisplay(
      levels["1d"]
    )}`,

    `4H → ${getLevelDisplay(
      levels["4h"]
    )}`,

    `1H → ${getLevelDisplay(
      levels["1h"]
    )}`,

    `15M → ${getLevelDisplay(
      levels["15m"]
    )}`,

    `5M → ${getLevelDisplay(
      levels["5m"]
    )}`,

    "",

    `TOP-DOWN → ${
      chain.chainStatus ||
      "INCOMPLETE"
    }`,

  ];

  return lines.join(
    "\n"
  );

}

// ============================================================
// EMPTY TOP-DOWN STATE
// ============================================================

export function createEmptyTopDownState() {

  return {

    "1d":
      null,

    "4h":
      null,

    "1h":
      null,

    "15m":
      null,

    "5m":
      null,

  };

}

// ============================================================
// SERVICE INFORMATION
// ============================================================

export function getTopDownServiceInfo() {

  return {

    timeframes:
      [
        ...TOP_DOWN_TIMEFRAMES,
      ],

    persistent:
      true,

    persistentHTF:
      true,

    lowerTimeframe:
      "5m",

    removedTimeframes:
      [
        "30m",
      ],

    hierarchy:
      [
        "1d",
        "4h",
        "1h",
        "15m",
        "5m",
      ],

  };

}

// ============================================================
// EXPORTS
// ============================================================

export {

  TIMEFRAME_MINUTES,

  TOP_DOWN_TIMEFRAMES,

};
```
