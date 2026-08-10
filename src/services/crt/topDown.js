// ============================================================
// PDYN TOP-DOWN CRT
// ============================================================
//
// HIERARCHY:
//
// 1D
//  ↓
// 4H
//  ↓
// 1H
//  ↓
// 15M
//  ↓
// 5M
//
// RULE:
//
// A lower timeframe CRT must belong to the candle
// containing the confirmed higher-timeframe CRT candle.
//
// Example:
//
// 1D CRT candle
//     ↓
// 4H CRT candle inside that 1D candle
//     ↓
// 1H CRT candle inside that 4H candle
//     ↓
// 15M CRT candle inside that 1H candle
//     ↓
// 5M CRT candle inside that 15M candle
//
// Only 5M uses this information for the special
// Top-Down Discord display.
//
// ============================================================

const TIMEFRAME_MINUTES = {
  "1d": 1440,
  "4h": 240,
  "1h": 60,
  "15m": 15,
  "5m": 5,
};

const TOP_DOWN_TIMEFRAMES = [
  "1d",
  "4h",
  "1h",
  "15m",
  "5m",
];

// ============================================================
// NORMALIZE TIMEFRAME
// ============================================================

function normalizeTimeframe(timeframe) {
  return String(timeframe || "")
    .trim()
    .toLowerCase();
}

// ============================================================
// TIMEFRAME DURATION
// ============================================================

function getTimeframeMilliseconds(timeframe) {
  const normalized = normalizeTimeframe(timeframe);

  const minutes =
    TIMEFRAME_MINUTES[normalized];

  if (!minutes) {
    return 0;
  }

  return minutes * 60 * 1000;
}

// ============================================================
// CANDLE RANGE
// ============================================================

export function getCandleRange(
  timestamp,
  timeframe
) {
  const start = Number(timestamp);

  if (!Number.isFinite(start)) {
    return null;
  }

  const duration =
    getTimeframeMilliseconds(timeframe);

  if (!duration) {
    return null;
  }

  return {
    start,
    end: start + duration,
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
    Number(timestamp);

  const parentTimestamp =
    Number(candleTimestamp);

  if (
    !Number.isFinite(childTimestamp) ||
    !Number.isFinite(parentTimestamp)
  ) {
    return false;
  }

  const range =
    getCandleRange(
      parentTimestamp,
      timeframe
    );

  if (!range) {
    return false;
  }

  return (
    childTimestamp >= range.start &&
    childTimestamp < range.end
  );
}

// ============================================================
// SIGNAL INSIDE PARENT SIGNAL
// ============================================================
//
// The child fractal candle must physically occur
// inside the parent fractal candle.
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

  if (
    !Number.isFinite(
      Number(childSignal.timestamp)
    ) ||
    !Number.isFinite(
      Number(parentSignal.timestamp)
    )
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
// BUILD TOP-DOWN CHAIN
// ============================================================
//
// states format:
//
// {
//   "1d": signal,
//   "4h": signal,
//   "1h": signal,
//   "15m": signal,
//   "5m": signal
// }
//
// The chain is confirmed only when every level exists
// AND every lower timeframe belongs to its parent candle.
//
// ============================================================

export function buildTopDownChain(
  states
) {
  const source =
    states instanceof Map
      ? Object.fromEntries(states)
      : (
          states &&
          typeof states === "object"
            ? states
            : {}
        );

  const result = {
    confirmed: false,

    levels: {
      "1d": {
        hasCRT: false,
        type: null,
        signal: null,
        linked: true,
      },

      "4h": {
        hasCRT: false,
        type: null,
        signal: null,
        linked: false,
      },

      "1h": {
        hasCRT: false,
        type: null,
        signal: null,
        linked: false,
      },

      "15m": {
        hasCRT: false,
        type: null,
        signal: null,
        linked: false,
      },

      "5m": {
        hasCRT: false,
        type: null,
        signal: null,
        linked: false,
      },
    },

    confirmedCount: 0,

    total: 5,

    chainStatus: "INCOMPLETE",
  };

  // ----------------------------------------------------------
  // 1D
  // ----------------------------------------------------------

  const daily =
    source["1d"] || null;

  if (
    daily &&
    daily.type &&
    Number.isFinite(
      Number(daily.timestamp)
    )
  ) {
    result.levels["1d"] = {
      hasCRT: true,
      type: daily.type,
      signal: daily,
      linked: true,
    };

    result.confirmedCount++;
  } else {
    return result;
  }

  // ----------------------------------------------------------
  // 4H
  // ----------------------------------------------------------

  const fourHour =
    source["4h"] || null;

  if (
    fourHour &&
    fourHour.type &&
    isSignalInsideParent(
      fourHour,
      daily,
      "1d"
    )
  ) {
    result.levels["4h"] = {
      hasCRT: true,
      type: fourHour.type,
      signal: fourHour,
      linked: true,
    };

    result.confirmedCount++;
  } else {
    return result;
  }

  // ----------------------------------------------------------
  // 1H
  // ----------------------------------------------------------

  const oneHour =
    source["1h"] || null;

  if (
    oneHour &&
    oneHour.type &&
    isSignalInsideParent(
      oneHour,
      fourHour,
      "4h"
    )
  ) {
    result.levels["1h"] = {
      hasCRT: true,
      type: oneHour.type,
      signal: oneHour,
      linked: true,
    };

    result.confirmedCount++;
  } else {
    return result;
  }

  // ----------------------------------------------------------
  // 15M
  // ----------------------------------------------------------

  const fifteenMinute =
    source["15m"] || null;

  if (
    fifteenMinute &&
    fifteenMinute.type &&
    isSignalInsideParent(
      fifteenMinute,
      oneHour,
      "1h"
    )
  ) {
    result.levels["15m"] = {
      hasCRT: true,
      type: fifteenMinute.type,
      signal: fifteenMinute,
      linked: true,
    };

    result.confirmedCount++;
  } else {
    return result;
  }

  // ----------------------------------------------------------
  // 5M
  // ----------------------------------------------------------

  const fiveMinute =
    source["5m"] || null;

  if (
    fiveMinute &&
    fiveMinute.type &&
    isSignalInsideParent(
      fiveMinute,
      fifteenMinute,
      "15m"
    )
  ) {
    result.levels["5m"] = {
      hasCRT: true,
      type: fiveMinute.type,
      signal: fiveMinute,
      linked: true,
    };

    result.confirmedCount++;
  }

  // ----------------------------------------------------------
  // FINAL STATUS
  // ----------------------------------------------------------

  result.confirmed =
    result.confirmedCount === 5;

  result.chainStatus =
    result.confirmed
      ? "CONFIRMED"
      : "INCOMPLETE";

  return result;
}

// ============================================================
// DISPLAY STATUS
// ============================================================
//
// This is intentionally independent from chain validity.
//
// Every timeframe is displayed.
//
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
    level.type === "BUY"
  ) {
    return "🟢 BUY CRT";
  }

  if (
    level.type === "SELL"
  ) {
    return "🔴 SELL CRT";
  }

  return "❓ UNKNOWN";
}

// ============================================================
// FORMAT 5M TOP-DOWN DISPLAY
// ============================================================

export function formatTopDownDisplay(
  chain
) {
  if (!chain) {
    return [
      "1D  → ❌ NO CRT",
      "4H  → ❌ NO CRT",
      "1H  → ❌ NO CRT",
      "15M → ❌ NO CRT",
      "5M  → ❌ NO CRT",
      "",
      "TOP-DOWN → INCOMPLETE",
    ].join("\n");
  }

  const lines = [
    `1D  → ${getLevelDisplay(chain.levels["1d"])}`,
    `4H  → ${getLevelDisplay(chain.levels["4h"])}`,
    `1H  → ${getLevelDisplay(chain.levels["1h"])}`,
    `15M → ${getLevelDisplay(chain.levels["15m"])}`,
    `5M  → ${getLevelDisplay(chain.levels["5m"])}`,
    "",
    `TOP-DOWN → ${chain.chainStatus}`,
  ];

  return lines.join("\n");
}

// ============================================================
// EMPTY TOP-DOWN STATE
// ============================================================

export function createEmptyTopDownState() {
  return {
    "1d": null,
    "4h": null,
    "1h": null,
    "15m": null,
    "5m": null,
  };
}

// ============================================================
// EXPORTS
// ============================================================

export {
  TIMEFRAME_MINUTES,
  TOP_DOWN_TIMEFRAMES,
  normalizeTimeframe,
  getTimeframeMilliseconds,
};
