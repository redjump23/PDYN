// ============================================================
// PDYN TOP-DOWN CRT ENGINE
// ============================================================
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
// BEHAVIOR:
//
// 1. 30M IS COMPLETELY REMOVED.
//
// 2. 1D / 4H / 1H / 15M CRT signals are stored.
//
// 3. The latest CRT for each higher timeframe is persistent
//    during the lifetime of the bot process.
//
// 4. A higher timeframe does NOT need a NEW CRT during the
//    same scan for 5M to use its previous CRT.
//
// 5. 5M can therefore display:
//
//      1D previous CRT
//      4H previous CRT
//      1H previous CRT
//      15M previous CRT
//
//    even when those timeframes did not produce a new signal
//    during the current scan.
//
// 6. A new CRT replaces the previous CRT for that symbol and
//    timeframe.
//
// 7. 5M itself is also stored so the complete top-down state
//    can be inspected.
//
// 8. State is kept per MEXC symbol.
//
// ============================================================

// ============================================================
// TIMEFRAMES
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
// TOP-DOWN ORDER
// ============================================================
//
// 30M intentionally does NOT exist.
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
// HIGHER TIMEFRAMES
// ============================================================
//
// These are the timeframes used by the 5M top-down analysis.
//
// ============================================================

const HIGHER_TIMEFRAMES = [

  "1d",

  "4h",

  "1h",

  "15m",

];

// ============================================================
// SIGNAL STATE
// ============================================================
//
// Map:
//
//   symbol
//      ↓
//   timeframe
//      ↓
//   latest CRT
//
// Example:
//
//   MEXC|BTC_USDT
//      1d  -> SELL
//      4h  -> BUY
//      1h  -> BUY
//      15m -> BUY
//      5m  -> SELL
//
// ============================================================

const topDownState =
  new Map();

// ============================================================
// STATE CLEANUP
// ============================================================
//
// Prevent unlimited memory growth if the bot scans many
// contracts over a long period.
//
// This is NOT a 30M timeframe.
//
// It is only memory housekeeping.
//
// ============================================================

const STATE_CLEANUP_INTERVAL =
  30 * 60 * 1000;

const STATE_MAX_AGE =
  7 * 24 * 60 * 60 * 1000;

let lastStateCleanup =
  Date.now();

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
// TIMEFRAME VALIDATION
// ============================================================

export function isTopDownTimeframe(
  timeframe
) {

  const normalized =
    normalizeTimeframe(
      timeframe
    );

  return Object.prototype.hasOwnProperty.call(
    TIMEFRAME_MINUTES,
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
// GET HIGHER TIMEFRAMES
// ============================================================

export function getHigherTimeframes() {

  return [
    ...HIGHER_TIMEFRAMES,
  ];

}

// ============================================================
// TIMEFRAME MILLISECONDS
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
// CANDLE RANGE
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
// This helper is retained for compatibility and diagnostics.
//
// IMPORTANT:
//
// The persistent top-down display does NOT require old HTF
// signals to remain physically inside the current 5M candle.
//
// That would cause previous valid CRTs to disappear simply
// because time moved forward.
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

  return isTimestampInsideCandle(

    childSignal.timestamp,

    parentSignal.timestamp,

    parentTimeframe

  );

}

// ============================================================
// EMPTY STATE
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
// CLONE SIGNAL
// ============================================================
//
// Prevent external mutation of stored state.
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
// GET SYMBOL STATE
// ============================================================

function getSymbolState(
  symbol
) {

  const normalizedSymbol =
    normalizeSymbol(
      symbol
    );

  if (
    !normalizedSymbol
  ) {

    return null;

  }

  let state =
    topDownState.get(
      normalizedSymbol
    );

  if (
    !state
  ) {

    state =
      createEmptyTopDownState();

    topDownState.set(
      normalizedSymbol,
      state
    );

  }

  return state;

}

// ============================================================
// UPDATE TOP-DOWN CRT
// ============================================================
//
// Called by crtService.js whenever a NEW CRT is discovered.
//
// The newest signal replaces the previous signal.
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

    return false;

  }

  if (
    !isTopDownTimeframe(
      normalizedTimeframe
    )
  ) {

    return false;

  }

  if (
    !signal ||
    !signal.type
  ) {

    return false;

  }

  const state =
    getSymbolState(
      normalizedSymbol
    );

  if (
    !state
  ) {

    return false;

  }

  const previous =
    state[
      normalizedTimeframe
    ];

  const signalTimestamp =
    Number(
      signal.timestamp
    );

  const previousTimestamp =
    Number(
      previous?.timestamp
    );

  //
  // Never move backwards in time.
  //
  if (
    Number.isFinite(
      previousTimestamp
    ) &&
    Number.isFinite(
      signalTimestamp
    ) &&
    signalTimestamp <
      previousTimestamp
  ) {

    return false;

  }

  state[
    normalizedTimeframe
  ] =
    cloneSignal(
      signal
    );

  state[
    normalizedTimeframe
  ].timeframe =
    normalizedTimeframe;

  state[
    normalizedTimeframe
  ].storedAt =
    Date.now();

  cleanupTopDownState();

  return true;

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
// GET FULL STORED STATE
// ============================================================

export function getTopDownState(
  symbol
) {

  const normalizedSymbol =
    normalizeSymbol(
      symbol
    );

  if (
    !normalizedSymbol
  ) {

    return createEmptyTopDownState();

  }

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
// CLEAR SYMBOL STATE
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
// CLEAR ALL STATE
// ============================================================

export function clearAllTopDownState() {

  topDownState.clear();

}

// ============================================================
// STATE CLEANUP
// ============================================================
//
// Cleanup only removes symbols that have been completely
// inactive for a long time.
//
// It does NOT remove a valid previous CRT after 30 minutes.
//
// This is important.
//
// ============================================================

function cleanupTopDownState(
  force = false
) {

  const now =
    Date.now();

  if (
    !force &&
    now -
      lastStateCleanup <
      STATE_CLEANUP_INTERVAL
  ) {

    return;

  }

  lastStateCleanup =
    now;

  for (
    const [
      symbol,
      state,
    ]
    of topDownState.entries()
  ) {

    const timestamps =
      Object.values(
        state
      )
        .map(
          signal =>
            Number(
              signal?.storedAt
            )
        )
        .filter(
          Number.isFinite
        );

    if (
      !timestamps.length
    ) {

      topDownState.delete(
        symbol
      );

      continue;

    }

    const newestStoredAt =
      Math.max(
        ...timestamps
      );

    if (
      now -
        newestStoredAt >
      STATE_MAX_AGE
    ) {

      topDownState.delete(
        symbol
      );

    }

  }

}

// ============================================================
// BUILD TOP-DOWN CHAIN
// ============================================================
//
// IMPORTANT:
//
// The chain is based on STORED CRT AVAILABILITY.
//
// It does NOT require every previous CRT to be inside the
// current lower timeframe candle.
//
// This is what allows the 5M scan to continue showing:
//
//   1D previous CRT
//   4H previous CRT
//   1H previous CRT
//   15M previous CRT
//
// even when those HTFs did not generate a fresh signal.
//
// ============================================================

export function buildTopDownChain(
  states
) {

  let source;

  if (
    states instanceof Map
  ) {

    source =
      Object.fromEntries(
        states
      );

  } else if (
    states &&
    typeof states ===
      "object"
  ) {

    source =
      states;

  } else {

    source =
      createEmptyTopDownState();

  }

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

    higherTimeframeCount:
      0,

    higherTimeframeTotal:
      4,

    chainStatus:
      "INCOMPLETE",

  };

  for (
    const timeframe of
      TOP_DOWN_TIMEFRAMES
  ) {

    const signal =
      source[
        timeframe
      ];

    if (
      signal &&
      signal.type &&
      Number.isFinite(
        Number(
          signal.timestamp
        )
      )
    ) {

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

        //
        // Persistent state is considered available.
        //
        linked:
          true,

      };

      result.confirmedCount++;

      if (
        HIGHER_TIMEFRAMES.includes(
          timeframe
        )
      ) {

        result.higherTimeframeCount++;

      }

    }

  }

  result.confirmed =
    result.confirmedCount ===
    5;

  //
  // For the 5M top-down logic, the important requirement
  // is the availability of the four HTF CRT states.
  //
  if (
    result.higherTimeframeCount ===
    result.higherTimeframeTotal
  ) {

    result.chainStatus =
      result.confirmed
        ? "CONFIRMED"
        : "HTF CONFIRMED";

  } else {

    result.chainStatus =
      "INCOMPLETE";

  }

  return result;

}

// ============================================================
// ANALYZE TOP-DOWN
// ============================================================
//
// This is the primary function called by crtService.js.
//
// Usage:
//
//   analyzeTopDown(
//     symbol,
//     fiveMinuteSignal
//   );
//
// It takes the persistent previous CRT state and updates the
// current 5M signal.
//
// ============================================================

export function analyzeTopDown(
  symbol,
  current5mSignal = null
) {

  const normalizedSymbol =
    normalizeSymbol(
      symbol
    );

  if (
    !normalizedSymbol
  ) {

    return buildTopDownChain(
      createEmptyTopDownState()
    );

  }

  const state =
    getTopDownState(
      normalizedSymbol
    );

  //
  // If the current 5M signal exists, use it immediately.
  //
  // This ensures the 5M signal being processed appears in
  // the top-down output even before another scan occurs.
  //

  if (
    current5mSignal &&
    current5mSignal.type
  ) {

    state["5m"] =
      cloneSignal(
        current5mSignal
      );

    state["5m"].timeframe =
      "5m";

    state["5m"].storedAt =
      Date.now();

  }

  //
  // IMPORTANT:
  //
  // Do NOT clear HTF state when no new HTF signal exists.
  //
  // That is the persistent previous CRT behavior.
  //

  return buildTopDownChain(
    state
  );

}

// ============================================================
// TOP-DOWN COUNT
// ============================================================
//
// Returns:
//
//   "4/4 CONFIRMED"
//   "3/4 CONFIRMED"
//   etc.
//
// The count intentionally refers ONLY to the four higher
// timeframes because 5M is the triggering timeframe.
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

  let count =
    0;

  for (
    const timeframe of
      HIGHER_TIMEFRAMES
  ) {

    if (
      topDown.levels?.[
        timeframe
      ]?.hasCRT
    ) {

      count++;

    }

  }

  return `${count}/4 CONFIRMED`;

}

// ============================================================
// FORMAT SINGLE CRT
// ============================================================

function formatCRTType(
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

    return "🟢 BUY";

  }

  if (
    signal.type ===
    "SELL"
  ) {

    return "🔴 SELL";

  }

  return String(
    signal.type
  );

}

// ============================================================
// FORMAT HTF CRT
// ============================================================
//
// Output:
//
//   1D BUY • 4H BUY • 1H SELL • 15M BUY
//
// ============================================================

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
    {};

  const result = [];

  for (
    const timeframe of
      HIGHER_TIMEFRAMES
  ) {

    const level =
      levels[
        timeframe
      ];

    const label =
      timeframe ===
      "1d"
        ? "1D"
        : timeframe ===
          "4h"
          ? "4H"
          : timeframe ===
            "1h"
            ? "1H"
            : "15M";

    if (
      level?.hasCRT
    ) {

      result.push(
        `${label} ${formatCRTType(
          level.signal
        )}`
      );

    } else {

      result.push(
        `${label} N/A`
      );

    }

  }

  return result.join(
    " • "
  );

}

// ============================================================
// FORMAT HTF CRT DETAILS
// ============================================================
//
// More detailed version for diagnostics.
//
// ============================================================

export function formatHTFCRTDetails(
  topDown
) {

  if (
    !topDown
  ) {

    return (
      "1D → N/A\n" +
      "4H → N/A\n" +
      "1H → N/A\n" +
      "15M → N/A"
    );

  }

  const levels =
    topDown.levels ||
    {};

  const lines = [];

  for (
    const timeframe of
      HIGHER_TIMEFRAMES
  ) {

    const level =
      levels[
        timeframe
      ];

    const label =
      timeframe ===
      "1d"
        ? "1D"
        : timeframe ===
          "4h"
          ? "4H"
          : timeframe ===
            "1h"
            ? "1H"
            : "15M";

    if (
      level?.hasCRT &&
      level.signal
    ) {

      const signal =
        level.signal;

      const timestamp =
        Number(
          signal.timestamp
        );

      let time =
        "N/A";

      if (
        Number.isFinite(
          timestamp
        )
      ) {

        time =
          new Date(
            timestamp
          ).toISOString();

      }

      lines.push(
        `${label} → ${formatCRTType(
          signal
        )} • ${time}`
      );

    } else {

      lines.push(
        `${label} → N/A`
      );

    }

  }

  return lines.join(
    "\n"
  );

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
// FORMAT TOP-DOWN DISPLAY
// ============================================================
//
// This function is kept for compatibility with existing code.
//
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

  const lines = [

    `1D → ${getLevelDisplay(
      chain.levels?.["1d"]
    )}`,

    `4H → ${getLevelDisplay(
      chain.levels?.["4h"]
    )}`,

    `1H → ${getLevelDisplay(
      chain.levels?.["1h"]
    )}`,

    `15M → ${getLevelDisplay(
      chain.levels?.["15m"]
    )}`,

    `5M → ${getLevelDisplay(
      chain.levels?.["5m"]
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
// TOP-DOWN SUMMARY
// ============================================================

export function getTopDownSummary(
  symbol
) {

  const state =
    getTopDownState(
      symbol
    );

  const chain =
    buildTopDownChain(
      state
    );

  return {

    symbol:
      normalizeSymbol(
        symbol
      ),

    confirmed:
      chain.confirmed,

    chainStatus:
      chain.chainStatus,

    confirmedCount:
      chain.confirmedCount,

    higherTimeframeCount:
      chain.higherTimeframeCount,

    higherTimeframeTotal:
      chain.higherTimeframeTotal,

    topDownCount:
      formatTopDownCount(
        chain
      ),

    htfCRT:
      formatHTFCRT(
        chain
      ),

    levels:
      chain.levels,

  };

}

// ============================================================
// CHECK FULL HTF CONFIRMATION
// ============================================================
//
// Returns true when all four HTFs have a stored CRT.
//
// 5M is intentionally excluded.
//
// ============================================================

export function hasFullHTFConfirmation(
  topDown
) {

  if (
    !topDown
  ) {

    return false;

  }

  return (
    HIGHER_TIMEFRAMES.every(
      timeframe =>
        Boolean(
          topDown.levels?.[
            timeframe
          ]?.hasCRT
        )
    )
  );

}

// ============================================================
// GET HTF DIRECTION
// ============================================================
//
// Returns:
//
//   BUY
//   SELL
//   MIXED
//   N/A
//
// ============================================================

export function getHTFDirection(
  topDown
) {

  if (
    !topDown
  ) {

    return "N/A";

  }

  const directions =
    HIGHER_TIMEFRAMES
      .map(
        timeframe =>
          topDown.levels?.[
            timeframe
          ]?.type
      )
      .filter(
        Boolean
      );

  if (
    !directions.length
  ) {

    return "N/A";

  }

  const allBuy =
    directions.every(
      direction =>
        direction ===
        "BUY"
    );

  if (
    allBuy
  ) {

    return "BUY";

  }

  const allSell =
    directions.every(
      direction =>
        direction ===
        "SELL"
    );

  if (
    allSell
  ) {

    return "SELL";

  }

  return "MIXED";

}

// ============================================================
// STATE SIZE
// ============================================================

export function getTopDownStateSize() {

  return topDownState.size;

}

// ============================================================
// FORCE CLEANUP
// ============================================================

export function cleanupTopDownStateNow() {

  cleanupTopDownState(
    true
  );

}

// ============================================================
// DEBUG STATE
// ============================================================

export function getAllTopDownStates() {

  const result =
    {};

  for (
    const [
      symbol,
      state,
    ]
    of topDownState.entries()
  ) {

    result[
      symbol
    ] =
      getTopDownState(
        symbol
      );

  }

  return result;

}

// ============================================================
// EXPORT CONSTANTS
// ============================================================

export {

  TIMEFRAME_MINUTES,

  TOP_DOWN_TIMEFRAMES,

  HIGHER_TIMEFRAMES,

};
