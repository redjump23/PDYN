// ============================================================
// PDYN CRT TOP-DOWN ANALYSIS
// ============================================================
//
// Rachel T Fractal based top-down state.
//
// HIGHER TIMEFRAMES:
//   1D
//   4H
//   1H
//   15M
//
// LOWER TIMEFRAME:
//   5M
//
// IMPORTANT:
//   This module does NOT send Discord messages.
//   It only stores and reads the latest known HTF CRT.
//
// This allows the 5M scanner to remember a previous CRT from
// 1D / 4H / 1H / 15M even when that timeframe does not produce
// a new fractal during the current scan.
//
// ============================================================

const TOP_DOWN_TIMEFRAMES = [
  "1d",
  "4h",
  "1h",
  "15m",
];

// ============================================================
// STATE
// ============================================================
//
// Map:
//
// SYMBOL
//   -> Map(TIMEFRAME -> CRT)
//
// Example:
//
// BTC_USDT
//   1d  -> BUY
//   4h  -> BUY
//   1h  -> BUY
//   15m -> SELL
//
// ============================================================

const topDownState = new Map();

// ============================================================
// NORMALIZE SYMBOL
// ============================================================

function normalizeSymbol(symbol) {
  return String(
    symbol || ""
  )
    .trim()
    .toUpperCase();
}

// ============================================================
// NORMALIZE TIMEFRAME
// ============================================================

function normalizeTimeframe(timeframe) {
  return String(
    timeframe || ""
  )
    .trim()
    .toLowerCase();
}

// ============================================================
// IS HTF
// ============================================================

export function isTopDownTimeframe(timeframe) {
  return TOP_DOWN_TIMEFRAMES.includes(
    normalizeTimeframe(timeframe)
  );
}

// ============================================================
// GET TIMEFRAMES
// ============================================================

export function getTopDownTimeframes() {
  return [
    ...TOP_DOWN_TIMEFRAMES,
  ];
}

// ============================================================
// UPDATE HTF CRT
// ============================================================
//
// Stores the newest known Rachel T CRT.
//
// This is intentionally persistent for the lifetime of the
// running bot.
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

  if (
    !signal ||
    !signal.type
  ) {
    return false;
  }

  if (
    signal.type !== "BUY" &&
    signal.type !== "SELL"
  ) {
    return false;
  }

  let symbolState =
    topDownState.get(
      normalizedSymbol
    );

  if (!symbolState) {
    symbolState =
      new Map();

    topDownState.set(
      normalizedSymbol,
      symbolState
    );
  }

  const previous =
    symbolState.get(
      normalizedTimeframe
    );

  //
  // Only replace the stored CRT when the new CRT is newer.
  //
  if (
    previous &&
    Number.isFinite(
      previous.timestamp
    ) &&
    Number.isFinite(
      signal.timestamp
    ) &&
    signal.timestamp <=
      previous.timestamp
  ) {
    return false;
  }

  symbolState.set(
    normalizedTimeframe,
    {
      type:
        signal.type,

      fractalType:
        signal.fractalType ||
        null,

      timestamp:
        Number(
          signal.timestamp
        ) || 0,

      price:
        Number(
          signal.price
        ) || 0,

      fractalPrice:
        Number(
          signal.fractalPrice
        ) || 0,

      volume:
        Number(
          signal.volume
        ) || 0,

    }
  );

  return true;
}

// ============================================================
// GET STORED CRT
// ============================================================

export function getStoredCRT(
  symbol,
  timeframe
) {
  const normalizedSymbol =
    normalizeSymbol(symbol);

  const normalizedTimeframe =
    normalizeTimeframe(timeframe);

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
// GET ALL STORED CRT
// ============================================================

export function getStoredTopDownCRT(
  symbol
) {
  const normalizedSymbol =
    normalizeSymbol(symbol);

  const symbolState =
    topDownState.get(
      normalizedSymbol
    );

  const result = {};

  for (
    const timeframe of
      TOP_DOWN_TIMEFRAMES
  ) {
    result[timeframe] =
      symbolState?.get(
        timeframe
      ) || null;
  }

  return result;
}

// ============================================================
// BUILD TOP-DOWN ANALYSIS
// ============================================================
//
// The lower timeframe signal is used as the direction reference.
//
// Example:
//
// 1D BUY
// 4H BUY
// 1H SELL
// 15M BUY
// 5M BUY
//
// Result:
//
// BUY confirmations = 3/4
//
// ============================================================

export function analyzeTopDown(
  symbol,
  lowerSignal
) {
  const states =
    getStoredTopDownCRT(
      symbol
    );

  const direction =
    lowerSignal?.type ||
    null;

  let confirmedCount = 0;

  let availableCount = 0;

  const details = {};

  for (
    const timeframe of
      TOP_DOWN_TIMEFRAMES
  ) {
    const item =
      states[timeframe];

    if (
      item &&
      (
        item.type ===
          "BUY" ||
        item.type ===
          "SELL"
      )
    ) {
      availableCount++;

      details[
        timeframe
      ] = {
        type:
          item.type,

        timestamp:
          item.timestamp,

        price:
          item.price,

        fractalType:
          item.fractalType,

        confirmed:
          direction
            ? item.type ===
              direction
            : false,

      };

      if (
        direction &&
        item.type ===
          direction
      ) {
        confirmedCount++;
      }

    } else {

      details[
        timeframe
      ] = {
        type:
          "N/A",

        timestamp:
          null,

        price:
          null,

        fractalType:
          null,

        confirmed:
          false,

      };

    }
  }

  const total =
    TOP_DOWN_TIMEFRAMES.length;

  return {

    direction,

    confirmed:
      confirmedCount ===
      total,

    confirmedCount,

    availableCount,

    total,

    details,

  };
}

// ============================================================
// FORMAT COUNT
// ============================================================

export function formatTopDownCount(
  analysis
) {
  if (
    !analysis
  ) {
    return "0/4 CONFIRMED";
  }

  return (
    `${analysis.confirmedCount}/${analysis.total} CONFIRMED`
  );
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
  analysis
) {
  if (
    !analysis
  ) {
    return (
      "1D N/A • " +
      "4H N/A • " +
      "1H N/A • " +
      "15M N/A"
    );
  }

  return TOP_DOWN_TIMEFRAMES
    .map(
      timeframe => {

        const item =
          analysis.details?.[
            timeframe
          ];

        return (
          `${timeframe.toUpperCase()} ` +
          `${item?.type || "N/A"}`
        );

      }
    )
    .join(
      " • "
    );
}

// ============================================================
// FORMAT DETAILED HTF CRT
// ============================================================

export function formatHTFCRTDetails(
  analysis
) {
  if (
    !analysis
  ) {
    return "N/A";
  }

  return TOP_DOWN_TIMEFRAMES
    .map(
      timeframe => {

        const item =
          analysis.details?.[
            timeframe
          ];

        if (
          !item ||
          item.type ===
            "N/A"
        ) {
          return (
            `${timeframe.toUpperCase()} N/A`
          );
        }

        return (
          `${timeframe.toUpperCase()} ${item.type}`
        );

      }
    )
    .join(
      " • "
    );
}

// ============================================================
// CLEAR SYMBOL
// ============================================================

export function clearTopDownSymbol(
  symbol
) {
  const normalizedSymbol =
    normalizeSymbol(symbol);

  topDownState.delete(
    normalizedSymbol
  );
}

// ============================================================
// CLEAR ALL
// ============================================================

export function clearTopDownState() {
  topDownState.clear();
}

// ============================================================
// DEBUG
// ============================================================

export function getTopDownDebugState() {
  const result = {};

  for (
    const [
      symbol,
      state
    ] of topDownState
  ) {

    result[symbol] = {};

    for (
      const timeframe of
        TOP_DOWN_TIMEFRAMES
    ) {

      result[
        symbol
      ][timeframe] =
        state.get(
          timeframe
        ) || null;

    }
  }

  return result;
}

// ============================================================
// SERVICE INFO
// ============================================================

export function getTopDownServiceInfo() {
  return {

    enabled:
      true,

    source:
      "Rachel T Fractals",

    higherTimeframes:
      [
        ...TOP_DOWN_TIMEFRAMES,
      ],

    lowerTimeframe:
      "5m",

    persistent:
      true,

    discord:
      false,

  };
}
