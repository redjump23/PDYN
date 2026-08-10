// ============================================================
// PDYN CRT ENGINE
// ============================================================
//
// PURPOSE:
//
// Rachel T Fractal is the PRIMARY CRT signal.
//
// The engine is responsible for:
//
//   1. Detecting confirmed CRT candle
//   2. Detecting confirmed fractal direction
//   3. Tracking previous confirmed fractals
//   4. Detecting FRACTAL LIQUIDITY SWEEPS
//   5. Calculating MARKET STRUCTURE
//   6. Calculating STD DEVIATION
//   7. Calculating RSI
//
// IMPORTANT:
//
// Liquidity is NOT based on the previous arbitrary candle.
//
// Liquidity is based on the previous CONFIRMED FRACTAL:
//
//   Top fractal:
//     latest fractal high > previous top fractal high
//
//   Bottom fractal:
//     latest fractal low < previous bottom fractal low
//
// Rachel T Fractal / CRT confirmation remains the
// actual signal trigger.
//
// RSI / STD Deviation / Market Structure / Liquidity
// are supporting information.
// ============================================================

import {
  calculateRSI,
  getRSIState,
} from './rsi.js';

// ============================================================
// CONSTANTS
// ============================================================

const DEFAULT_FRACTAL_LEFT = 2;
const DEFAULT_FRACTAL_RIGHT = 2;

const DEFAULT_STD_PERIOD = 20;

// ============================================================
// NUMBER HELPERS
// ============================================================

function finite(value) {
  return Number.isFinite(Number(value));
}

function num(value) {
  return Number(value);
}

// ============================================================
// CANDLE TIME
// ============================================================

function candleTime(candle) {
  return (
    candle?.openTime ??
    candle?.timestamp ??
    candle?.time ??
    candle?.closeTime ??
    null
  );
}

// ============================================================
// CANDLE VALIDATION
// ============================================================

function validCandle(candle) {
  if (!candle) {
    return false;
  }

  return (
    finite(candle.open) &&
    finite(candle.high) &&
    finite(candle.low) &&
    finite(candle.close)
  );
}

// ============================================================
// STANDARD DEVIATION
//
// Population standard deviation.
//
// Calculated from closed candle closes.
//
// This is supporting information only.
// ============================================================

export function calculateStdDeviation(
  candles,
  period = DEFAULT_STD_PERIOD
) {
  if (!Array.isArray(candles)) {
    return null;
  }

  const valid = candles
    .filter(validCandle)
    .map((c) => num(c.close))
    .filter(Number.isFinite);

  const length = Math.max(
    2,
    Number(period) || DEFAULT_STD_PERIOD
  );

  if (valid.length < length) {
    return null;
  }

  const values =
    valid.slice(-length);

  const mean =
    values.reduce(
      (sum, value) =>
        sum + value,
      0
    ) / values.length;

  const variance =
    values.reduce(
      (sum, value) =>
        sum +
        Math.pow(
          value - mean,
          2
        ),
      0
    ) / values.length;

  const deviation =
    Math.sqrt(variance);

  return Number.isFinite(
    deviation
  )
    ? deviation
    : null;
}

// ============================================================
// FRACTAL DETECTION
//
// A confirmed fractal requires candles on BOTH sides.
//
// Example:
//
//         HIGH
//           /\
//          /  \
//       /\ /    \ /\
//      /  X      X  \
//
// The center candle must be higher/lower than
// the configured number of candles on both sides.
//
// IMPORTANT:
//
// The latest candle cannot be confirmed as a fractal
// until the right-side confirmation candles exist.
//
// Default:
//
// LEFT  = 2
// RIGHT = 2
// ============================================================

export function detectFractals(
  candles,
  options = {}
) {
  if (!Array.isArray(candles)) {
    return [];
  }

  const left = Math.max(
    1,
    Number(
      options.left ??
        DEFAULT_FRACTAL_LEFT
    )
  );

  const right = Math.max(
    1,
    Number(
      options.right ??
        DEFAULT_FRACTAL_RIGHT
    )
  );

  if (
    candles.length <
    left + right + 1
  ) {
    return [];
  }

  const fractals = [];

  for (
    let i = left;
    i <
      candles.length - right;
    i++
  ) {
    const center =
      candles[i];

    if (!validCandle(center)) {
      continue;
    }

    const centerHigh =
      num(center.high);

    const centerLow =
      num(center.low);

    let isTop = true;
    let isBottom = true;

    // ========================================================
    // LEFT SIDE
    // ========================================================

    for (
      let j = i - left;
      j < i;
      j++
    ) {
      if (!validCandle(candles[j])) {
        isTop = false;
        isBottom = false;
        break;
      }

      if (
        num(candles[j].high) >=
        centerHigh
      ) {
        isTop = false;
      }

      if (
        num(candles[j].low) <=
        centerLow
      ) {
        isBottom = false;
      }
    }

    if (
      !isTop &&
      !isBottom
    ) {
      continue;
    }

    // ========================================================
    // RIGHT SIDE
    // ========================================================

    for (
      let j = i + 1;
      j <= i + right;
      j++
    ) {
      if (!validCandle(candles[j])) {
        isTop = false;
        isBottom = false;
        break;
      }

      if (
        num(candles[j].high) >=
        centerHigh
      ) {
        isTop = false;
      }

      if (
        num(candles[j].low) <=
        centerLow
      ) {
        isBottom = false;
      }
    }

    // ========================================================
    // TOP FRACTAL
    // ========================================================

    if (isTop) {
      fractals.push({
        type: 'TOP',
        price: centerHigh,
        high: centerHigh,
        low: centerLow,
        index: i,
        candleTime:
          candleTime(center),
        candle: center,
      });
    }

    // ========================================================
    // BOTTOM FRACTAL
    // ========================================================

    if (isBottom) {
      fractals.push({
        type: 'BOTTOM',
        price: centerLow,
        high: centerHigh,
        low: centerLow,
        index: i,
        candleTime:
          candleTime(center),
        candle: center,
      });
    }
  }

  return fractals;
}

// ============================================================
// GET LATEST CONFIRMED FRACTAL
// ============================================================

export function getLatestFractal(
  fractals
) {
  if (
    !Array.isArray(fractals) ||
    !fractals.length
  ) {
    return null;
  }

  return fractals[
    fractals.length - 1
  ];
}

// ============================================================
// GET PREVIOUS FRACTAL OF SAME TYPE
// ============================================================
//
// This is extremely important.
//
// We do NOT compare a top fractal to the previous
// bottom fractal.
//
// We compare:
//
//   TOP    → previous TOP
//   BOTTOM → previous BOTTOM
// ============================================================

export function getPreviousSameTypeFractal(
  fractals,
  latest
) {
  if (
    !Array.isArray(fractals) ||
    !latest
  ) {
    return null;
  }

  for (
    let i =
      fractals.length - 1;
    i >= 0;
    i--
  ) {
    const fractal =
      fractals[i];

    if (
      fractal === latest
    ) {
      continue;
    }

    if (
      fractal.type ===
      latest.type
    ) {
      return fractal;
    }
  }

  return null;
}

// ============================================================
// FRACTAL LIQUIDITY SWEEP
//
// TOP:
//
// Latest confirmed TOP fractal high
// breaks previous confirmed TOP fractal high.
//
// BOTTOM:
//
// Latest confirmed BOTTOM fractal low
// breaks previous confirmed BOTTOM fractal low.
//
// This is the FINAL liquidity model.
// ============================================================

export function detectFractalLiquiditySweep(
  latest,
  previous
) {
  if (
    !latest ||
    !previous
  ) {
    return {
      swept: false,
      type: 'NONE',
      label: 'None',
      level: null,
      previousFractal: null,
    };
  }

  // ==========================================================
  // TOP FRACTAL
  // ==========================================================

  if (
    latest.type ===
      'TOP' &&
    previous.type ===
      'TOP'
  ) {
    const latestHigh =
      num(latest.high);

    const previousHigh =
      num(previous.high);

    if (
      Number.isFinite(
        latestHigh
      ) &&
      Number.isFinite(
        previousHigh
      ) &&
      latestHigh >
        previousHigh
    ) {
      return {
        swept: true,
        type: 'HIGH',
        label:
          '**PREVIOUS CRT HIGH SWEPT**',
        level:
          previousHigh,
        previousFractal:
          previous,
      };
    }

    return {
      swept: false,
      type: 'NONE',
      label: 'None',
      level:
        Number.isFinite(
          previousHigh
        )
          ? previousHigh
          : null,
      previousFractal:
        previous,
    };
  }

  // ==========================================================
  // BOTTOM FRACTAL
  // ==========================================================

  if (
    latest.type ===
      'BOTTOM' &&
    previous.type ===
      'BOTTOM'
  ) {
    const latestLow =
      num(latest.low);

    const previousLow =
      num(previous.low);

    if (
      Number.isFinite(
        latestLow
      ) &&
      Number.isFinite(
        previousLow
      ) &&
      latestLow <
        previousLow
    ) {
      return {
        swept: true,
        type: 'LOW',
        label:
          '**PREVIOUS CRT LOW SWEPT**',
        level:
          previousLow,
        previousFractal:
          previous,
      };
    }

    return {
      swept: false,
      type: 'NONE',
      label: 'None',
      level:
        Number.isFinite(
          previousLow
        )
          ? previousLow
          : null,
      previousFractal:
        previous,
    };
  }

  return {
    swept: false,
    type: 'NONE',
    label: 'None',
    level: null,
    previousFractal:
      previous,
  };
}

// ============================================================
// MARKET STRUCTURE
//
// Market structure is derived from the latest two
// confirmed same-type fractals.
//
// TOP FRACTALS:
//
// Higher High  → BULLISH
// Lower High   → BEARISH
//
// BOTTOM FRACTALS:
//
// Higher Low   → BULLISH
// Lower Low    → BEARISH
//
// When both are available, the most recent structural
// relationship gets priority.
//
// IMPORTANT:
//
// This does NOT determine whether the CRT exists.
// Rachel T fractal confirmation remains primary.
// ============================================================

export function calculateMarketStructure(
  fractals
) {
  if (
    !Array.isArray(fractals) ||
    fractals.length < 2
  ) {
    return 'N/A';
  }

  const tops =
    fractals.filter(
      (f) =>
        f.type ===
        'TOP'
    );

  const bottoms =
    fractals.filter(
      (f) =>
        f.type ===
        'BOTTOM'
    );

  const latestTop =
    tops[tops.length - 1];

  const previousTop =
    tops[tops.length - 2];

  const latestBottom =
    bottoms[
      bottoms.length - 1
    ];

  const previousBottom =
    bottoms[
      bottoms.length - 2
    ];

  const candidates = [];

  // ==========================================================
  // TOP STRUCTURE
  // ==========================================================

  if (
    latestTop &&
    previousTop
  ) {
    const latestHigh =
      num(latestTop.high);

    const previousHigh =
      num(previousTop.high);

    if (
      Number.isFinite(
        latestHigh
      ) &&
      Number.isFinite(
        previousHigh
      )
    ) {
      candidates.push({
        time:
          Number(
            latestTop.candleTime
          ) || 0,

        structure:
          latestHigh >
          previousHigh
            ? 'BULLISH'
            : latestHigh <
                previousHigh
              ? 'BEARISH'
              : 'NEUTRAL',
      });
    }
  }

  // ==========================================================
  // BOTTOM STRUCTURE
  // ==========================================================

  if (
    latestBottom &&
    previousBottom
  ) {
    const latestLow =
      num(latestBottom.low);

    const previousLow =
      num(previousBottom.low);

    if (
      Number.isFinite(
        latestLow
      ) &&
      Number.isFinite(
        previousLow
      )
    ) {
      candidates.push({
        time:
          Number(
            latestBottom.candleTime
          ) || 0,

        structure:
          latestLow >
          previousLow
            ? 'BULLISH'
            : latestLow <
                previousLow
              ? 'BEARISH'
              : 'NEUTRAL',
      });
    }
  }

  if (!candidates.length) {
    return 'N/A';
  }

  candidates.sort(
    (a, b) =>
      a.time - b.time
  );

  const latest =
    candidates[
      candidates.length - 1
    ];

  if (
    latest.structure ===
    'NEUTRAL'
  ) {
    /*
     * If the newest relationship is equal,
     * use the most recent non-neutral relationship.
     */
    for (
      let i =
        candidates.length - 2;
      i >= 0;
      i--
    ) {
      if (
        candidates[i]
          .structure !==
        'NEUTRAL'
      ) {
        return candidates[i]
          .structure;
      }
    }
  }

  return latest.structure;
}

// ============================================================
// ALTERNATIVE MARKET STRUCTURE
//
// This uses the latest confirmed fractal itself as
// additional confirmation.
//
// Used when only one fractal type has enough history.
// ============================================================

function calculateFallbackStructure(
  fractals
) {
  const structure =
    calculateMarketStructure(
      fractals
    );

  if (
    structure !==
    'N/A'
  ) {
    return structure;
  }

  if (
    !Array.isArray(
      fractals
    ) ||
    fractals.length <
      2
  ) {
    return 'N/A';
  }

  const latest =
    fractals[
      fractals.length - 1
    ];

  const previous =
    fractals[
      fractals.length - 2
    ];

  if (
    latest.type ===
      'TOP' &&
    previous.type ===
      'TOP'
  ) {
    if (
      latest.high >
      previous.high
    ) {
      return 'BULLISH';
    }

    if (
      latest.high <
      previous.high
    ) {
      return 'BEARISH';
    }
  }

  if (
    latest.type ===
      'BOTTOM' &&
    previous.type ===
      'BOTTOM'
  ) {
    if (
      latest.low >
      previous.low
    ) {
      return 'BULLISH';
    }

    if (
      latest.low <
      previous.low
    ) {
      return 'BEARISH';
    }
  }

  return 'N/A';
}

// ============================================================
// CRT DETECTION
//
// Standard two-candle CRT interpretation.
//
// Parent candle establishes the range.
//
// Latest closed candle:
//
//   sweeps parent high/low
//   AND
//   closes back inside parent range
//
// This remains the CRT confirmation layer.
//
// Rachel T fractal remains the primary structural layer.
// ============================================================

export function detectCRT(
  candles,
  options = {}
) {
  const minBodyRatio =
    Number(
      options.minBodyRatio ??
        0
    );

  const requireCloseInside =
    options.requireCloseInside !==
    false;

  const useCloseDirection =
    options.useCloseDirection ===
    true;

  if (
    !Array.isArray(
      candles
    ) ||
    candles.length < 2
  ) {
    return null;
  }

  const parent =
    candles[
      candles.length - 2
    ];

  const signal =
    candles[
      candles.length - 1
    ];

  if (
    !validCandle(parent) ||
    !validCandle(signal)
  ) {
    return null;
  }

  const parentHigh =
    num(parent.high);

  const parentLow =
    num(parent.low);

  const high =
    num(signal.high);

  const low =
    num(signal.low);

  const open =
    num(signal.open);

  const close =
    num(signal.close);

  const range =
    parentHigh -
    parentLow;

  if (
    range <= 0
  ) {
    return null;
  }

  const bodyRatio =
    Math.abs(
      close - open
    ) / range;

  if (
    bodyRatio <
    minBodyRatio
  ) {
    return null;
  }

  const sweptLow =
    low <
    parentLow;

  const sweptHigh =
    high >
    parentHigh;

  const closedInside =
    close >=
      parentLow &&
    close <=
      parentHigh;

  let direction =
    null;

  // ==========================================================
  // LOW SWEEP
  // ==========================================================

  if (
    sweptLow &&
    (
      !requireCloseInside ||
      closedInside
    )
  ) {
    if (
      !useCloseDirection ||
      close >= open
    ) {
      direction =
        'BUY';
    }
  }

  // ==========================================================
  // HIGH SWEEP
  // ==========================================================

  if (
    sweptHigh &&
    (
      !requireCloseInside ||
      closedInside
    )
  ) {
    if (
      !useCloseDirection ||
      close <= open
    ) {
      if (
        direction ===
        null
      ) {
        direction =
          'SELL';
      }
    }
  }

  if (!direction) {
    return null;
  }

  return {
    direction,

    parent,

    signal,

    parentHigh,

    parentLow,

    signalHigh:
      high,

    signalLow:
      low,

    signalClose:
      close,

    sweptLow,

    sweptHigh,

    closedInside,

    candleTime:
      candleTime(signal),
  };
}

// ============================================================
// BUILD SIGNAL
//
// This is the main function consumed by crtService.js.
//
// Returned fields:
//
//   marketStructure
//   stdDeviation
//   fractalPrice
//   fractalType
//   fractal
//   previousFractal
//   liquiditySweep
//   confirmed
//   confirmedCRT
//   crtConfirmed
//   RSI
//
// ============================================================

export function buildSignal({
  symbol,
  market,
  timeframe,
  candles,
  rsiPeriod = 14,
  oversold = 30,
  overbought = 70,
  crtOptions = {},
}) {
  // ==========================================================
  // VALIDATE CANDLES
  // ==========================================================

  if (
    !Array.isArray(
      candles
    )
  ) {
    return null;
  }

  const closedCandles =
    candles.filter(
      (c) =>
        c?.closed !==
          false &&
        validCandle(c)
    );

  if (
    closedCandles.length <
    Math.max(
      20,
      Number(rsiPeriod) + 2
    )
  ) {
    return null;
  }

  // ==========================================================
  // CRT CONFIRMATION
  // ==========================================================

  const crt =
    detectCRT(
      closedCandles,
      crtOptions
    );

  if (!crt) {
    return null;
  }

  // ==========================================================
  // RACHEL T FRACTALS
  // ==========================================================

  const fractals =
    detectFractals(
      closedCandles,
      {
        left:
          crtOptions.fractalLeft ??
          DEFAULT_FRACTAL_LEFT,

        right:
          crtOptions.fractalRight ??
          DEFAULT_FRACTAL_RIGHT,
      }
    );

  if (
    !fractals.length
  ) {
    return null;
  }

  // ==========================================================
  // IMPORTANT:
  //
  // The fractal must be confirmed BEFORE the CRT signal
  // candle.
  //
  // We don't use a fractal that occurs after the
  // CRT confirmation candle.
  // ==========================================================

  const signalTime =
    Number(
      crt.candleTime
    );

  const eligibleFractals =
    fractals.filter(
      (fractal) =>
        Number(
          fractal.candleTime
        ) <=
        signalTime
    );

  if (
    !eligibleFractals.length
  ) {
    return null;
  }

  const latestFractal =
    eligibleFractals[
      eligibleFractals.length - 1
    ];

  // ==========================================================
  // PREVIOUS SAME-TYPE FRACTAL
  // ==========================================================

  const previousFractal =
    getPreviousSameTypeFractal(
      eligibleFractals,
      latestFractal
    );

  // ==========================================================
  // FRACTAL LIQUIDITY SWEEP
  // ==========================================================

  const liquiditySweep =
    detectFractalLiquiditySweep(
      latestFractal,
      previousFractal
    );

  // ==========================================================
  // MARKET STRUCTURE
  // ==========================================================

  let marketStructure =
    calculateMarketStructure(
      eligibleFractals
    );

  if (
    marketStructure ===
    'N/A'
  ) {
    marketStructure =
      calculateFallbackStructure(
        eligibleFractals
      );
  }

  // ==========================================================
  // STD DEVIATION
  // ==========================================================

  const stdPeriod =
    Number(
      crtOptions.stdPeriod ??
        DEFAULT_STD_PERIOD
    );

  const stdDeviation =
    calculateStdDeviation(
      closedCandles,
      stdPeriod
    );

  // ==========================================================
  // RSI
  // ==========================================================

  const closes =
    closedCandles.map(
      (c) =>
        num(c.close)
    );

  const rsi =
    calculateRSI(
      closes,
      rsiPeriod
    );

  const rsiState =
    getRSIState(
      rsi,
      oversold,
      overbought
    );

  // ==========================================================
  // STRENGTH
  //
  // Supporting information only.
  // ==========================================================

  const strength =
    (
      (
        crt.direction ===
          'BUY' &&
        rsiState ===
          'OVERSOLD'
      ) ||
      (
        crt.direction ===
          'SELL' &&
        rsiState ===
          'OVERBOUGHT'
      )
    )
      ? 'STRONG'
      : 'STANDARD';

  // ==========================================================
  // SIGNAL ID
  // ==========================================================

  const id =
    `${market}:${symbol}:${timeframe}:` +
    `${crt.candleTime}:` +
    `${latestFractal.candleTime}:` +
    `${latestFractal.type}`;

  // ==========================================================
  // RETURN FINAL SIGNAL
  // ==========================================================

  return {
    // --------------------------------------------------------
    // IDENTITY
    // --------------------------------------------------------

    id,

    symbol,

    market,

    timeframe,

    // --------------------------------------------------------
    // CRT
    // --------------------------------------------------------

    direction:
      crt.direction,

    strength,

    confirmed:
      true,

    confirmedCRT:
      true,

    crtConfirmed:
      true,

    // --------------------------------------------------------
    // CRT CANDLE
    // --------------------------------------------------------

    candleTime:
      crt.candleTime,

    price:
      crt.signalClose,

    signalHigh:
      crt.signalHigh,

    signalLow:
      crt.signalLow,

    parentHigh:
      crt.parentHigh,

    parentLow:
      crt.parentLow,

    closedInside:
      crt.closedInside,

    // --------------------------------------------------------
    // RACHEL T FRACTAL
    // --------------------------------------------------------

    fractalType:
      latestFractal.type,

    fractalPrice:
      latestFractal.price,

    fractal:
      latestFractal,

    previousFractal,

    // --------------------------------------------------------
    // FRACTAL LIQUIDITY
    // --------------------------------------------------------

    liquiditySweep,

    // --------------------------------------------------------
    // MARKET STRUCTURE
    // --------------------------------------------------------

    marketStructure,

    structure:
      marketStructure,

    market_structure:
      marketStructure,

    // --------------------------------------------------------
    // STANDARD DEVIATION
    // --------------------------------------------------------

    stdDeviation,

    stdDev:
      stdDeviation,

    standardDeviation:
      stdDeviation,

    // --------------------------------------------------------
    // RSI
    // --------------------------------------------------------

    rsi,

    rsiState,

    // --------------------------------------------------------
    // RAW CRT DATA
    // --------------------------------------------------------

    sweptLow:
      crt.sweptLow,

    sweptHigh:
      crt.sweptHigh,

    signalClose:
      crt.signalClose,

    // --------------------------------------------------------
    // FRACTAL COLLECTION
    //
    // Useful for debugging and top-down alignment.
    // --------------------------------------------------------

    fractals:
      eligibleFractals,
  };
}

// ============================================================
// DEFAULT EXPORT
// ============================================================
//
// Keeping a default export is useful if another service
// imports crtEngine as a module object.
//
// ============================================================

export default {
  detectCRT,
  detectFractals,
  getLatestFractal,
  getPreviousSameTypeFractal,
  detectFractalLiquiditySweep,
  calculateMarketStructure,
  calculateStdDeviation,
  buildSignal,
};
