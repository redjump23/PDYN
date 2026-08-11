// ============================================================
// PDYN CRT ENGINE
// ============================================================
//
// PRIMARY SIGNAL:
//
//   Rachel T Filtered Fractal
//
// CRT CONFIRMATION:
//
//   The Rachel T fractal must be confirmed first.
//
//   Then the actual CRT confirmation candle must:
//
//   BUY / BOTTOM:
//      • Sweep previous candle LOW
//      • Close back INSIDE previous candle range
//
//   SELL / TOP:
//      • Sweep previous candle HIGH
//      • Close back INSIDE previous candle range
//
// Optional filters:
//
//   • Candle direction
//   • Minimum candle body ratio
//
// IMPORTANT:
//
//   This engine ONLY uses CLOSED candles.
//
//   The currently-forming candle is NEVER used.
//
// ============================================================

import {
  calculateRSI,
  getRSIState,
} from './rsi.js';

// ============================================================
// CONSTANTS
// ============================================================

const DEFAULT_RSI_PERIOD = 14;
const DEFAULT_OVERSOLD = 30;
const DEFAULT_OVERBOUGHT = 70;

// Number of previous fractals used for structure.
const STRUCTURE_FRACTALS = 3;

// ============================================================
// NUMBER HELPERS
// ============================================================

function number(value) {
  const n = Number(value);

  return Number.isFinite(n)
    ? n
    : null;
}

// ============================================================
// CANDLE TIME
// ============================================================

function getCandleTime(candle) {
  if (!candle) {
    return null;
  }

  return (
    candle.openTime ??
    candle.time ??
    candle.timestamp ??
    candle.ts ??
    null
  );
}

// ============================================================
// CLOSED CANDLE FILTER
// ============================================================
//
// The engine expects the caller to provide MEXC Futures candles.
//
// We still protect against a currently-forming candle.
//
// ============================================================

function getClosedCandles(candles) {
  if (!Array.isArray(candles)) {
    return [];
  }

  return candles.filter((candle) => {
    if (!candle) {
      return false;
    }

    if (candle.closed === false) {
      return false;
    }

    return (
      number(candle.open) !== null &&
      number(candle.high) !== null &&
      number(candle.low) !== null &&
      number(candle.close) !== null
    );
  });
}

// ============================================================
// RACHEL T FILTERED TOP
// ============================================================
//
// Exact filtered top logic:
//
// high[4] < high[2]
// high[3] <= high[2]
// high[2] >= high[1]
// high[2] > high[0]
//
// Pivot:
//
//   index - 2
//
// ============================================================

function isFilteredTopAt(
  candles,
  index
) {
  if (
    !Array.isArray(candles) ||
    index < 4 ||
    index >= candles.length
  ) {
    return false;
  }

  const h4 =
    number(
      candles[index - 4]?.high
    );

  const h3 =
    number(
      candles[index - 3]?.high
    );

  const h2 =
    number(
      candles[index - 2]?.high
    );

  const h1 =
    number(
      candles[index - 1]?.high
    );

  const h0 =
    number(
      candles[index]?.high
    );

  if (
    h4 === null ||
    h3 === null ||
    h2 === null ||
    h1 === null ||
    h0 === null
  ) {
    return false;
  }

  return (
    h4 < h2 &&
    h3 <= h2 &&
    h2 >= h1 &&
    h2 > h0
  );
}

// ============================================================
// RACHEL T FILTERED BOTTOM
// ============================================================
//
// Exact filtered bottom logic:
//
// low[4] > low[2]
// low[3] >= low[2]
// low[2] <= low[1]
// low[2] < low[0]
//
// Pivot:
//
//   index - 2
//
// ============================================================

function isFilteredBottomAt(
  candles,
  index
) {
  if (
    !Array.isArray(candles) ||
    index < 4 ||
    index >= candles.length
  ) {
    return false;
  }

  const l4 =
    number(
      candles[index - 4]?.low
    );

  const l3 =
    number(
      candles[index - 3]?.low
    );

  const l2 =
    number(
      candles[index - 2]?.low
    );

  const l1 =
    number(
      candles[index - 1]?.low
    );

  const l0 =
    number(
      candles[index]?.low
    );

  if (
    l4 === null ||
    l3 === null ||
    l2 === null ||
    l1 === null ||
    l0 === null
  ) {
    return false;
  }

  return (
    l4 > l2 &&
    l3 >= l2 &&
    l2 <= l1 &&
    l2 < l0
  );
}

// ============================================================
// FIND CONFIRMED RACHEL T FRACTALS
// ============================================================
//
// A fractal is confirmed two closed candles after its pivot.
//
// Example:
//
//   Candle A
//   Candle B
//   Candle C  <- pivot
//   Candle D
//   Candle E  <- fractal confirmed
//
// ============================================================

export function findFractals(
  candles
) {
  const closed =
    getClosedCandles(
      candles
    );

  if (
    closed.length < 5
  ) {
    return [];
  }

  const fractals = [];

  for (
    let confirmationIndex = 4;
    confirmationIndex <
    closed.length;
    confirmationIndex++
  ) {
    const pivotIndex =
      confirmationIndex - 2;

    // ========================================================
    // FILTERED TOP
    // ========================================================

    if (
      isFilteredTopAt(
        closed,
        confirmationIndex
      )
    ) {
      const pivot =
        closed[pivotIndex];

      const price =
        number(
          pivot.high
        );

      if (
        price !== null
      ) {
        fractals.push({
          type: 'TOP',

          fractalType:
            'FILTERED TOP',

          price,

          candle:
            pivot,

          pivotIndex,

          confirmationCandle:
            closed[
              confirmationIndex
            ],

          confirmationIndex,

          pivotTime:
            getCandleTime(
              pivot
            ),

          confirmationTime:
            getCandleTime(
              closed[
                confirmationIndex
              ]
            ),
        });
      }
    }

    // ========================================================
    // FILTERED BOTTOM
    // ========================================================

    if (
      isFilteredBottomAt(
        closed,
        confirmationIndex
      )
    ) {
      const pivot =
        closed[pivotIndex];

      const price =
        number(
          pivot.low
        );

      if (
        price !== null
      ) {
        fractals.push({
          type: 'BOTTOM',

          fractalType:
            'FILTERED BOTTOM',

          price,

          candle:
            pivot,

          pivotIndex,

          confirmationCandle:
            closed[
              confirmationIndex
            ],

          confirmationIndex,

          pivotTime:
            getCandleTime(
              pivot
            ),

          confirmationTime:
            getCandleTime(
              closed[
                confirmationIndex
              ]
            ),
        });
      }
    }
  }

  // ==========================================================
  // CHRONOLOGICAL ORDER
  // ==========================================================

  fractals.sort(
    (a, b) =>
      Number(
        a.confirmationIndex
      ) -
      Number(
        b.confirmationIndex
      )
  );

  return fractals;
}

// ============================================================
// GET LATEST CONFIRMED FRACTAL
// ============================================================

export function getLatestFractal(
  candles
) {
  const fractals =
    findFractals(
      candles
    );

  if (
    !fractals.length
  ) {
    return null;
  }

  return fractals[
    fractals.length - 1
  ];
}

// ============================================================
// GET PREVIOUS SAME-TYPE FRACTALS
// ============================================================

function getPreviousSameType(
  fractals,
  latest,
  count = STRUCTURE_FRACTALS
) {
  if (!latest) {
    return [];
  }

  return fractals
    .filter(
      (fractal) =>
        fractal.type ===
          latest.type &&
        fractal.confirmationIndex <
          latest.confirmationIndex
    )
    .slice(-count);
}

// ============================================================
// INDIVIDUAL MARKET STRUCTURE
// ============================================================

function calculateMarketStructureInternal(
  fractals,
  latest
) {
  if (!latest) {
    return {
      marketStructure:
        'NEUTRAL',

      structureType:
        'NONE',

      structurePrice:
        null,
    };
  }

  const previous =
    getPreviousSameType(
      fractals,
      latest,
      STRUCTURE_FRACTALS
    );

  if (
    !previous.length
  ) {
    return {
      marketStructure:
        'NEUTRAL',

      structureType:
        'NONE',

      structurePrice:
        latest.price,
    };
  }

  const previousFractal =
    previous[
      previous.length - 1
    ];

  // ==========================================================
  // TOP STRUCTURE
  // ==========================================================

  if (
    latest.type ===
    'TOP'
  ) {
    if (
      latest.price >
      previousFractal.price
    ) {
      return {
        marketStructure:
          'BULLISH',

        structureType:
          'HIGHER HIGH',

        structurePrice:
          latest.price,
      };
    }

    if (
      latest.price <
      previousFractal.price
    ) {
      return {
        marketStructure:
          'BEARISH',

        structureType:
          'LOWER HIGH',

        structurePrice:
          latest.price,
      };
    }
  }

  // ==========================================================
  // BOTTOM STRUCTURE
  // ==========================================================

  if (
    latest.type ===
    'BOTTOM'
  ) {
    if (
      latest.price >
      previousFractal.price
    ) {
      return {
        marketStructure:
          'BULLISH',

        structureType:
          'HIGHER LOW',

        structurePrice:
          latest.price,
      };
    }

    if (
      latest.price <
      previousFractal.price
    ) {
      return {
        marketStructure:
          'BEARISH',

        structureType:
          'LOWER LOW',

        structurePrice:
          latest.price,
      };
    }
  }

  return {
    marketStructure:
      'NEUTRAL',

    structureType:
      'NONE',

    structurePrice:
      latest.price,
  };
}

// ============================================================
// COMBINED MARKET STRUCTURE
// ============================================================
//
// Uses both TOP and BOTTOM fractals.
//
// HH + HL = BULLISH
// LH + LL = BEARISH
//
// If only one side is available, preserve that direction.
//
// ============================================================

function calculateCombinedStructure(
  fractals
) {
  const tops =
    fractals.filter(
      (fractal) =>
        fractal.type ===
        'TOP'
    );

  const bottoms =
    fractals.filter(
      (fractal) =>
        fractal.type ===
        'BOTTOM'
    );

  let higherHigh =
    false;

  let lowerHigh =
    false;

  let higherLow =
    false;

  let lowerLow =
    false;

  // ==========================================================
  // TOPS
  // ==========================================================

  if (
    tops.length >= 2
  ) {
    const latestTop =
      tops[
        tops.length - 1
      ];

    const previousTop =
      tops[
        tops.length - 2
      ];

    higherHigh =
      latestTop.price >
      previousTop.price;

    lowerHigh =
      latestTop.price <
      previousTop.price;
  }

  // ==========================================================
  // BOTTOMS
  // ==========================================================

  if (
    bottoms.length >= 2
  ) {
    const latestBottom =
      bottoms[
        bottoms.length - 1
      ];

    const previousBottom =
      bottoms[
        bottoms.length - 2
      ];

    higherLow =
      latestBottom.price >
      previousBottom.price;

    lowerLow =
      latestBottom.price <
      previousBottom.price;
  }

  // ==========================================================
  // STRONG BULLISH
  // ==========================================================

  if (
    higherHigh &&
    higherLow
  ) {
    return {
      marketStructure:
        'BULLISH',

      structureType:
        'HIGHER HIGH / HIGHER LOW',
    };
  }

  // ==========================================================
  // STRONG BEARISH
  // ==========================================================

  if (
    lowerHigh &&
    lowerLow
  ) {
    return {
      marketStructure:
        'BEARISH',

      structureType:
        'LOWER HIGH / LOWER LOW',
    };
  }

  // ==========================================================
  // ONE-SIDE BULLISH
  // ==========================================================

  if (
    higherHigh ||
    higherLow
  ) {
    return {
      marketStructure:
        'BULLISH',

      structureType:
        higherHigh
          ? 'HIGHER HIGH'
          : 'HIGHER LOW',
    };
  }

  // ==========================================================
  // ONE-SIDE BEARISH
  // ==========================================================

  if (
    lowerHigh ||
    lowerLow
  ) {
    return {
      marketStructure:
        'BEARISH',

      structureType:
        lowerHigh
          ? 'LOWER HIGH'
          : 'LOWER LOW',
    };
  }

  return {
    marketStructure:
      'NEUTRAL',

    structureType:
      'NONE',
  };
}

// ============================================================
// PUBLIC MARKET STRUCTURE EXPORT
// ============================================================

export function calculateMarketStructure(
  fractals,
  latest
) {
  return calculateMarketStructureInternal(
    fractals,
    latest
  );
}

// ============================================================
// STANDARD DEVIATION
// ============================================================
//
// Population standard deviation of closed candle closing prices.
//
// This is supplementary information only.
//
// ============================================================

function calculateStdDeviationInternal(
  candles
) {
  const values =
    candles
      .map(
        (candle) =>
          number(
            candle.close
          )
      )
      .filter(
        (value) =>
          value !== null
      );

  if (
    !values.length
  ) {
    return null;
  }

  const mean =
    values.reduce(
      (sum, value) =>
        sum + value,
      0
    ) /
    values.length;

  const variance =
    values.reduce(
      (sum, value) =>
        sum +
        Math.pow(
          value - mean,
          2
        ),
      0
    ) /
    values.length;

  return Math.sqrt(
    variance
  );
}

// ============================================================
// PUBLIC STD DEVIATION EXPORT
// ============================================================

export function calculateStdDeviation(
  candles
) {
  return calculateStdDeviationInternal(
    candles
  );
}

// ============================================================
// FRACTAL LIQUIDITY SWEEP
// ============================================================
//
// This is supplementary historical liquidity.
//
// It compares the latest confirmed Rachel T fractal against
// the previous confirmed fractal of the same type.
//
// ============================================================

function detectFractalLiquiditySweepInternal(
  candles,
  fractals,
  latest
) {
  if (
    !latest ||
    !Array.isArray(
      fractals
    )
  ) {
    return {
      swept: false,

      type:
        'NONE',

      label:
        'None',

      level:
        null,

      fractal:
        null,
    };
  }

  const previousFractals =
    fractals.filter(
      (fractal) =>
        fractal.confirmationIndex <
        latest.confirmationIndex
    );

  if (
    !previousFractals.length
  ) {
    return {
      swept: false,

      type:
        'NONE',

      label:
        'None',

      level:
        null,

      fractal:
        null,
    };
  }

  const previousTops =
    previousFractals.filter(
      (fractal) =>
        fractal.type ===
        'TOP'
    );

  const previousBottoms =
    previousFractals.filter(
      (fractal) =>
        fractal.type ===
        'BOTTOM'
    );

  // ==========================================================
  // TOP
  // ==========================================================

  if (
    latest.type ===
      'TOP' &&
    previousTops.length
  ) {
    const previousTop =
      previousTops[
        previousTops.length - 1
      ];

    if (
      latest.price >
      previousTop.price
    ) {
      return {
        swept: true,

        type:
          'HIGH',

        label:
          '**PREVIOUS FRACTAL HIGH SWEPT**',

        level:
          previousTop.price,

        fractal:
          previousTop,
      };
    }
  }

  // ==========================================================
  // BOTTOM
  // ==========================================================

  if (
    latest.type ===
      'BOTTOM' &&
    previousBottoms.length
  ) {
    const previousBottom =
      previousBottoms[
        previousBottoms.length - 1
      ];

    if (
      latest.price <
      previousBottom.price
    ) {
      return {
        swept: true,

        type:
          'LOW',

        label:
          '**PREVIOUS FRACTAL LOW SWEPT**',

        level:
          previousBottom.price,

        fractal:
          previousBottom,
      };
    }
  }

  return {
    swept: false,

    type:
      'NONE',

    label:
      'None',

    level:
      null,

    fractal:
      null,
  };
}

// ============================================================
// PUBLIC FRACTAL LIQUIDITY EXPORT
// ============================================================

export function detectFractalLiquiditySweep(
  candles,
  fractals,
  latest
) {
  return detectFractalLiquiditySweepInternal(
    candles,
    fractals,
    latest
  );
}

// ============================================================
// CRT DIRECTION
// ============================================================
//
// BOTTOM = BUY
// TOP    = SELL
//
// ============================================================

function getDirection(
  fractal
) {
  if (!fractal) {
    return null;
  }

  if (
    fractal.type ===
    'BOTTOM'
  ) {
    return 'BUY';
  }

  if (
    fractal.type ===
    'TOP'
  ) {
    return 'SELL';
  }

  return null;
}

// ============================================================
// CANDLE BODY RATIO
// ============================================================
//
// body / full range
//
// Example:
//
//   body = 0.5
//   range = 1.0
//
//   ratio = 0.50
//
// ============================================================

function getBodyRatio(
  candle
) {
  if (!candle) {
    return 0;
  }

  const open =
    number(
      candle.open
    );

  const high =
    number(
      candle.high
    );

  const low =
    number(
      candle.low
    );

  const close =
    number(
      candle.close
    );

  if (
    open === null ||
    high === null ||
    low === null ||
    close === null
  ) {
    return 0;
  }

  const range =
    high - low;

  if (
    range <= 0
  ) {
    return 0;
  }

  const body =
    Math.abs(
      close - open
    );

  return (
    body / range
  );
}

// ============================================================
// CRT CANDLE CONFIRMATION
// ============================================================
//
// THIS IS THE IMPORTANT FIX.
//
// The fractal confirmation candle is checked against the
// immediately previous closed candle.
//
// BUY / BOTTOM:
//
//   signal.low < parent.low
//   signal.close >= parent.low
//   signal.close <= parent.high
//
// SELL / TOP:
//
//   signal.high > parent.high
//   signal.close <= parent.high
//   signal.close >= parent.low
//
// This creates:
//
//   LIQUIDITY SWEEP
//          +
//   CLOSE BACK INSIDE RANGE
//
// ============================================================

function confirmCRTCandle(
  fractal,
  closedCandles,
  options = {}
) {
  if (
    !fractal ||
    !Array.isArray(
      closedCandles
    )
  ) {
    return {
      confirmed: false,

      reason:
        'Missing fractal or candles.',

      direction:
        null,

      signalCandle:
        null,

      parentCandle:
        null,

      sweptLow:
        false,

      sweptHigh:
        false,

      closedInside:
        false,

      bodyRatio:
        0,
    };
  }

  const confirmationIndex =
    Number(
      fractal.confirmationIndex
    );

  if (
    !Number.isInteger(
      confirmationIndex
    ) ||
    confirmationIndex <= 0 ||
    confirmationIndex >=
      closedCandles.length
  ) {
    return {
      confirmed: false,

      reason:
        'Invalid CRT confirmation candle index.',

      direction:
        getDirection(
          fractal
        ),

      signalCandle:
        null,

      parentCandle:
        null,

      sweptLow:
        false,

      sweptHigh:
        false,

      closedInside:
        false,

      bodyRatio:
        0,
    };
  }

  const signalCandle =
    closedCandles[
      confirmationIndex
    ];

  const parentCandle =
    closedCandles[
      confirmationIndex - 1
    ];

  if (
    !signalCandle ||
    !parentCandle
  ) {
    return {
      confirmed: false,

      reason:
        'Missing CRT signal or parent candle.',

      direction:
        getDirection(
          fractal
        ),

      signalCandle:
        signalCandle ||
        null,

      parentCandle:
        parentCandle ||
        null,

      sweptLow:
        false,

      sweptHigh:
        false,

      closedInside:
        false,

      bodyRatio:
        0,
    };
  }

  const signalOpen =
    number(
      signalCandle.open
    );

  const signalHigh =
    number(
      signalCandle.high
    );

  const signalLow =
    number(
      signalCandle.low
    );

  const signalClose =
    number(
      signalCandle.close
    );

  const parentHigh =
    number(
      parentCandle.high
    );

  const parentLow =
    number(
      parentCandle.low
    );

  if (
    signalOpen === null ||
    signalHigh === null ||
    signalLow === null ||
    signalClose === null ||
    parentHigh === null ||
    parentLow === null
  ) {
    return {
      confirmed: false,

      reason:
        'Invalid OHLC values.',

      direction:
        getDirection(
          fractal
        ),

      signalCandle,

      parentCandle,

      sweptLow:
        false,

      sweptHigh:
        false,

      closedInside:
        false,

      bodyRatio:
        0,
    };
  }

  const direction =
    getDirection(
      fractal
    );

  const bodyRatio =
    getBodyRatio(
      signalCandle
    );

  const minBodyRatio =
    Math.max(
      0,
      Number(
        options.minBodyRatio ??
          0
      )
    );

  const requireCloseInside =
    options.requireCloseInside !==
    false;

  const useCloseDirection =
    options.useCloseDirection ===
    true;

  // ==========================================================
  // BUY / BOTTOM
  // ==========================================================

  if (
    direction ===
    'BUY'
  ) {
    const sweptLow =
      signalLow <
      parentLow;

    const closedInside =
      signalClose >=
        parentLow &&
      signalClose <=
        parentHigh;

    const bullishClose =
      signalClose >=
      signalOpen;

    const bodyPass =
      bodyRatio >=
      minBodyRatio;

    if (
      !sweptLow
    ) {
      return {
        confirmed: false,

        reason:
          'BUY CRT failed: confirmation candle did not sweep previous candle LOW.',

        direction,

        signalCandle,

        parentCandle,

        sweptLow,

        sweptHigh:
          false,

        closedInside,

        bodyRatio,
      };
    }

    if (
      requireCloseInside &&
      !closedInside
    ) {
      return {
        confirmed: false,

        reason:
          'BUY CRT failed: confirmation candle did not close back inside previous candle range.',

        direction,

        signalCandle,

        parentCandle,

        sweptLow,

        sweptHigh:
          false,

        closedInside,

        bodyRatio,
      };
    }

    if (
      useCloseDirection &&
      !bullishClose
    ) {
      return {
        confirmed: false,

        reason:
          'BUY CRT failed: confirmation candle is not bullish.',

        direction,

        signalCandle,

        parentCandle,

        sweptLow,

        sweptHigh:
          false,

        closedInside,

        bodyRatio,
      };
    }

    if (
      bodyRatio <
      minBodyRatio
    ) {
      return {
        confirmed: false,

        reason:
          `BUY CRT failed: body ratio ${bodyRatio.toFixed(
            4
          )} is below minimum ${minBodyRatio.toFixed(
            4
          )}.`,

        direction,

        signalCandle,

        parentCandle,

        sweptLow,

        sweptHigh:
          false,

        closedInside,

        bodyRatio,
      };
    }

    return {
      confirmed: true,

      reason:
        'BUY CRT confirmed: previous LOW swept and candle closed back inside previous range.',

      direction,

      signalCandle,

      parentCandle,

      sweptLow: true,

      sweptHigh:
        false,

      closedInside,

      bodyRatio,

      parentHigh,

      parentLow,

      signalHigh,

      signalLow,

      signalClose,
    };
  }

  // ==========================================================
  // SELL / TOP
  // ==========================================================

  if (
    direction ===
    'SELL'
  ) {
    const sweptHigh =
      signalHigh >
      parentHigh;

    const closedInside =
      signalClose <=
        parentHigh &&
      signalClose >=
        parentLow;

    const bearishClose =
      signalClose <=
      signalOpen;

    const bodyPass =
      bodyRatio >=
      minBodyRatio;

    if (
      !sweptHigh
    ) {
      return {
        confirmed: false,

        reason:
          'SELL CRT failed: confirmation candle did not sweep previous candle HIGH.',

        direction,

        signalCandle,

        parentCandle,

        sweptLow:
          false,

        sweptHigh,

        closedInside,

        bodyRatio,
      };
    }

    if (
      requireCloseInside &&
      !closedInside
    ) {
      return {
        confirmed: false,

        reason:
          'SELL CRT failed: confirmation candle did not close back inside previous candle range.',

        direction,

        signalCandle,

        parentCandle,

        sweptLow:
          false,

        sweptHigh,

        closedInside,

        bodyRatio,
      };
    }

    if (
      useCloseDirection &&
      !bearishClose
    ) {
      return {
        confirmed: false,

        reason:
          'SELL CRT failed: confirmation candle is not bearish.',

        direction,

        signalCandle,

        parentCandle,

        sweptLow:
          false,

        sweptHigh,

        closedInside,

        bodyRatio,
      };
    }

    if (
      bodyRatio <
      minBodyRatio
    ) {
      return {
        confirmed: false,

        reason:
          `SELL CRT failed: body ratio ${bodyRatio.toFixed(
            4
          )} is below minimum ${minBodyRatio.toFixed(
            4
          )}.`,

        direction,

        signalCandle,

        parentCandle,

        sweptLow:
          false,

        sweptHigh,

        closedInside,

        bodyRatio,
      };
    }

    return {
      confirmed: true,

      reason:
        'SELL CRT confirmed: previous HIGH swept and candle closed back inside previous range.',

      direction,

      signalCandle,

      parentCandle,

      sweptLow:
        false,

      sweptHigh: true,

      closedInside,

      bodyRatio,

      parentHigh,

      parentLow,

      signalHigh,

      signalLow,

      signalClose,
    };
  }

  return {
    confirmed: false,

    reason:
      'Unable to determine CRT direction.',

    direction:
      null,

    signalCandle,

    parentCandle,

    sweptLow:
      false,

    sweptHigh:
      false,

    closedInside:
      false,

    bodyRatio,
  };
}

// ============================================================
// SIGNAL ID
// ============================================================
//
// Uses fractal pivot time + market + symbol + timeframe.
//
// This prevents duplicate alerts for the same setup.
//
// ============================================================

function buildSignalId(
  symbol,
  market,
  timeframe,
  fractal
) {
  return [
    market,
    symbol,
    timeframe,
    fractal.type,
    fractal.pivotTime,
    fractal.price,
  ].join(':');
}

// ============================================================
// BUILD SIGNAL
// ============================================================
//
// MAIN ENGINE.
//
// IMPORTANT:
//
// A signal is returned ONLY when:
//
//   1. Rachel T fractal exists
//   2. Fractal is confirmed
//   3. Actual CRT candle is confirmed
//
// ============================================================

export function buildSignal({
  symbol,

  market,

  timeframe,

  candles,

  rsiPeriod =
    DEFAULT_RSI_PERIOD,

  oversold =
    DEFAULT_OVERSOLD,

  overbought =
    DEFAULT_OVERBOUGHT,

  crtOptions = {},
}) {
  // ==========================================================
  // CLOSED CANDLES ONLY
  // ==========================================================

  const closedCandles =
    getClosedCandles(
      candles
    );

  // ==========================================================
  // MINIMUM HISTORY
  // ==========================================================

  const minimumCandles =
    Math.max(
      5,
      Number(
        rsiPeriod
      ) + 2
    );

  if (
    closedCandles.length <
    minimumCandles
  ) {
    return null;
  }

  // ==========================================================
  // FIND RACHEL T FRACTALS
  // ==========================================================

  const fractals =
    findFractals(
      closedCandles
    );

  if (
    !fractals.length
  ) {
    return null;
  }

  // ==========================================================
  // LATEST CONFIRMED FRACTAL
  // ==========================================================

  const latest =
    fractals[
      fractals.length - 1
    ];

  if (!latest) {
    return null;
  }

  // ==========================================================
  // VERIFY FRACTAL CONFIRMATION
  // ==========================================================

  const fractalConfirmed =
    Number.isInteger(
      latest.confirmationIndex
    ) &&
    latest.confirmationIndex <
      closedCandles.length;

  if (
    !fractalConfirmed
  ) {
    return null;
  }

  // ==========================================================
  // DIRECTION
  // ==========================================================

  const direction =
    getDirection(
      latest
    );

  if (!direction) {
    return null;
  }

  // ==========================================================
  // ACTUAL CRT CONFIRMATION
  // ==========================================================
  //
  // THIS IS THE IMPORTANT PART.
  //
  // The engine will NOT return a signal unless the CRT candle
  // passes the sweep + close-inside requirements.
  //
  // ==========================================================

  const crtConfirmation =
    confirmCRTCandle(
      latest,
      closedCandles,
      crtOptions
    );

  if (
    !crtConfirmation.confirmed
  ) {
    return null;
  }

  // ==========================================================
  // RSI
  //
  // Supplementary only.
  //
  // RSI DOES NOT CREATE THE SIGNAL.
  // ==========================================================

  const closes =
    closedCandles.map(
      (candle) =>
        Number(
          candle.close
        )
    );

  const rsi =
    calculateRSI(
      closes,
      Number(
        rsiPeriod
      )
    );

  const rsiState =
    getRSIState(
      rsi,
      Number(
        oversold
      ),
      Number(
        overbought
      )
    );

  // ==========================================================
  // STANDARD DEVIATION
  // ==========================================================

  const stdDeviation =
    calculateStdDeviationInternal(
      closedCandles
    );

  // ==========================================================
  // MARKET STRUCTURE
  // ==========================================================

  const individualStructure =
    calculateMarketStructureInternal(
      fractals,
      latest
    );

  const combinedStructure =
    calculateCombinedStructure(
      fractals
    );

  const marketStructure =
    combinedStructure.marketStructure !==
    'NEUTRAL'
      ? combinedStructure.marketStructure
      : individualStructure.marketStructure;

  const structureType =
    combinedStructure.structureType !==
    'NONE'
      ? combinedStructure.structureType
      : individualStructure.structureType;

  // ==========================================================
  // FRACTAL LIQUIDITY
  // ==========================================================

  const fractalLiquiditySweep =
    detectFractalLiquiditySweepInternal(
      closedCandles,
      fractals,
      latest
    );

  // ==========================================================
  // CRT LIQUIDITY
  //
  // THIS is the liquidity sweep that actually confirmed CRT.
  //
  // ==========================================================

  const crtLiquiditySweep =
    crtConfirmation.sweptLow
      ? {
          swept: true,

          type:
            'LOW',

          label:
            '**PREVIOUS LOW SWEPT**',

          level:
            crtConfirmation
              .parentLow,

          fractal:
            null,
        }
      : crtConfirmation.sweptHigh
        ? {
            swept: true,

            type:
              'HIGH',

            label:
              '**PREVIOUS HIGH SWEPT**',

            level:
              crtConfirmation
                .parentHigh,

            fractal:
              null,
          }
        : {
            swept: false,

            type:
              'NONE',

            label:
              'None',

            level:
              null,

            fractal:
              null,
          };

  // ==========================================================
  // STRENGTH
  // ==========================================================

  const strength =
    (
      direction ===
        'BUY' &&
      rsiState ===
        'OVERSOLD'
    ) ||
    (
      direction ===
        'SELL' &&
      rsiState ===
        'OVERBOUGHT'
    )
      ? 'STRONG'
      : 'STANDARD';

  // ==========================================================
  // SIGNAL ID
  // ==========================================================

  const id =
    buildSignalId(
      symbol,
      market,
      timeframe,
      latest
    );

  // ==========================================================
  // FINAL SIGNAL
  // ==========================================================
  //
  // CONFIRMATION VALUES ARE NOW REAL.
  //
  // They are true ONLY because:
  //
  //   Rachel T fractal = confirmed
  //   AND
  //   CRT candle = confirmed
  //
  // ==========================================================

  return {
    // ========================================================
    // IDENTITY
    // ========================================================

    id,

    symbol,

    market,

    timeframe,

    // ========================================================
    // PRIMARY RACHEL T SIGNAL
    // ========================================================

    direction,

    fractalType:
      latest.fractalType,

    // Kept internally for compatibility.
    // crtService no longer displays this.
    fractalPrice:
      latest.price,

    fractal: {
      type:
        latest.type,

      label:
        latest.fractalType,

      price:
        latest.price,

      pivotTime:
        latest.pivotTime,

      confirmationTime:
        latest.confirmationTime,

      pivotCandle:
        latest.candle,

      confirmationCandle:
        latest.confirmationCandle,
    },

    // ========================================================
    // FRACTAL CONFIRMATION
    // ========================================================

    fractalConfirmed:
      true,

    // ========================================================
    // ACTUAL CRT CONFIRMATION
    // ========================================================

    confirmed:
      true,

    confirmedCRT:
      true,

    crtConfirmed:
      true,

    // ========================================================
    // CRT DETAILS
    // ========================================================

    crtConfirmation: {
      confirmed:
        true,

      direction:
        crtConfirmation.direction,

      reason:
        crtConfirmation.reason,

      signalCandle:
        crtConfirmation.signalCandle,

      parentCandle:
        crtConfirmation.parentCandle,

      sweptLow:
        crtConfirmation.sweptLow,

      sweptHigh:
        crtConfirmation.sweptHigh,

      closedInside:
        crtConfirmation.closedInside,

      bodyRatio:
        crtConfirmation.bodyRatio,

      parentHigh:
        crtConfirmation.parentHigh,

      parentLow:
        crtConfirmation.parentLow,
    },

    // ========================================================
    // CRT CANDLE
    // ========================================================

    crtCandle:
      crtConfirmation.signalCandle,

    crtParentCandle:
      crtConfirmation.parentCandle,

    crtParentHigh:
      crtConfirmation.parentHigh,

    crtParentLow:
      crtConfirmation.parentLow,

    crtClosedInside:
      crtConfirmation.closedInside,

    crtSweptLow:
      crtConfirmation.sweptLow,

    crtSweptHigh:
      crtConfirmation.sweptHigh,

    crtBodyRatio:
      crtConfirmation.bodyRatio,

    // ========================================================
    // MARKET STRUCTURE
    // ========================================================

    marketStructure,

    structure:
      marketStructure,

    market_structure:
      marketStructure,

    structureType,

    // ========================================================
    // STANDARD DEVIATION
    // ========================================================

    stdDeviation,

    stdDev:
      stdDeviation,

    standardDeviation:
      stdDeviation,

    // ========================================================
    // LIQUIDITY
    //
    // Use actual CRT candle liquidity first.
    // Fractal liquidity is retained separately.
    // ========================================================

    liquiditySweep:
      crtLiquiditySweep,

    crtLiquiditySweep,

    fractalLiquiditySweep,

    // ========================================================
    // RSI
    // ========================================================

    rsi,

    rsiState,

    // ========================================================
    // STRENGTH
    // ========================================================

    strength,

    // ========================================================
    // FRACTAL PIVOT TIME
    // ========================================================

    candleTime:
      latest.pivotTime,

    // ========================================================
    // CRT CONFIRMATION CANDLE TIME
    // ========================================================

    confirmationTime:
      latest.confirmationTime,

    crtCandleTime:
      getCandleTime(
        crtConfirmation.signalCandle
      ),

    // ========================================================
    // PRICE COMPATIBILITY
    //
    // Kept because other modules may reference it.
    //
    // This is NOT displayed as Fractal Price by the service.
    // ========================================================

    price:
      latest.price,

    // ========================================================
    // FRACTAL HIGH / LOW COMPATIBILITY
    // ========================================================

    signalHigh:
      latest.type ===
      'TOP'
        ? latest.price
        : null,

    signalLow:
      latest.type ===
      'BOTTOM'
        ? latest.price
        : null,

    // ========================================================
    // CRT COMPATIBILITY
    // ========================================================

    parentHigh:
      crtConfirmation.parentHigh,

    parentLow:
      crtConfirmation.parentLow,

    closedInside:
      crtConfirmation.closedInside,

    sweptLow:
      crtConfirmation.sweptLow,

    sweptHigh:
      crtConfirmation.sweptHigh,
  };
}

// ============================================================
// DETECT CRT
// ============================================================
//
// Compatibility wrapper.
//
// This now returns the ACTUAL CRT confirmation rather than
// automatically assuming the fractal itself is CRT-confirmed.
//
// ============================================================

export function detectCRT(
  candles,
  options = {}
) {
  const closed =
    getClosedCandles(
      candles
    );

  if (
    closed.length < 5
  ) {
    return null;
  }

  const fractal =
    getLatestFractal(
      closed
    );

  if (!fractal) {
    return null;
  }

  const direction =
    getDirection(
      fractal
    );

  if (!direction) {
    return null;
  }

  const crt =
    confirmCRTCandle(
      fractal,
      closed,
      options
    );

  if (
    !crt.confirmed
  ) {
    return null;
  }

  return {
    confirmed:
      true,

    confirmedCRT:
      true,

    crtConfirmed:
      true,

    direction,

    fractalType:
      fractal.fractalType,

    fractalPrice:
      fractal.price,

    fractal,

    signal:
      crt.signalCandle,

    parent:
      crt.parentCandle,

    candleTime:
      fractal.pivotTime,

    confirmationTime:
      fractal.confirmationTime,

    crtCandleTime:
      getCandleTime(
        crt.signalCandle
      ),

    // ========================================================
    // CRT RANGE
    // ========================================================

    parentHigh:
      crt.parentHigh,

    parentLow:
      crt.parentLow,

    signalHigh:
      crt.signalHigh,

    signalLow:
      crt.signalLow,

    closedInside:
      crt.closedInside,

    sweptLow:
      crt.sweptLow,

    sweptHigh:
      crt.sweptHigh,

    bodyRatio:
      crt.bodyRatio,

    // ========================================================
    // CONFIRMATION
    // ========================================================

    confirmation: {
      confirmed:
        true,

      reason:
        crt.reason,

      direction,

      sweptLow:
        crt.sweptLow,

      sweptHigh:
        crt.sweptHigh,

      closedInside:
        crt.closedInside,

      bodyRatio:
        crt.bodyRatio,
    },
  };
}

// ============================================================
// TEST RACHEL T FRACTAL
// ============================================================
//
// Useful for debugging.
//
// ============================================================

export function testRachelFractal(
  candles
) {
  if (
    !Array.isArray(
      candles
    )
  ) {
    return null;
  }

  return getLatestFractal(
    candles
  );
}

// ============================================================
// TEST MARKET ANALYSIS
// ============================================================
//
// Returns analysis without requiring a CRT confirmation.
//
// Useful for debugging the chart.
//
// ============================================================

export function testMarketAnalysis(
  candles
) {
  const closed =
    getClosedCandles(
      candles
    );

  if (
    closed.length < 20
  ) {
    return null;
  }

  const fractals =
    findFractals(
      closed
    );

  const fractal =
    fractals.length
      ? fractals[
          fractals.length - 1
        ]
      : null;

  const rsiValues =
    closed.map(
      (candle) =>
        Number(
          candle.close
        )
    );

  const rsi =
    calculateRSI(
      rsiValues,
      DEFAULT_RSI_PERIOD
    );

  const rsiState =
    getRSIState(
      rsi,
      DEFAULT_OVERSOLD,
      DEFAULT_OVERBOUGHT
    );

  const stdDeviation =
    calculateStdDeviationInternal(
      closed
    );

  const marketStructure =
    fractal
      ? calculateMarketStructureInternal(
          fractals,
          fractal
        )
      : {
          marketStructure:
            'NEUTRAL',

          structureType:
            'NONE',

          structurePrice:
            null,
        };

  const combinedStructure =
    calculateCombinedStructure(
      fractals
    );

  const actualStructure =
    combinedStructure.marketStructure !==
    'NEUTRAL'
      ? combinedStructure
      : marketStructure;

  let crtConfirmation =
    null;

  if (fractal) {
    crtConfirmation =
      confirmCRTCandle(
        fractal,
        closed,
        {}
      );
  }

  return {
    fractal,

    fractals,

    rsi,

    rsiState,

    standardDeviation:
      stdDeviation,

    stdDeviation,

    marketStructure:
      actualStructure.marketStructure,

    structureType:
      actualStructure.structureType,

    crtConfirmation,
  };
}

// ============================================================
// EXPORT FRACTAL CALCULATORS
// ============================================================

export {
  isFilteredTopAt,

  isFilteredBottomAt,

  calculateStdDeviationInternal,

  calculateMarketStructureInternal,

  calculateCombinedStructure,

  detectFractalLiquiditySweepInternal,

  confirmCRTCandle,

  getClosedCandles,

  getBodyRatio,
};

// ============================================================
// ENGINE LOADED
// ============================================================

console.log(
  '[CRT ENGINE] Rachel T Filtered Top/Bottom Fractal engine loaded.'
);

console.log(
  '[CRT ENGINE] filterBW=false • Filtered fractal logic active.'
);

console.log(
  '[CRT ENGINE] Fractal pivot = high[2] / low[2].'
);

console.log(
  '[CRT ENGINE] Fractal confirmation = 2 closed candles after pivot.'
);

console.log(
  '[CRT ENGINE] Actual CRT candle confirmation enabled.'
);

console.log(
  '[CRT ENGINE] BUY CRT = previous LOW sweep + close back inside range.'
);

console.log(
  '[CRT ENGINE] SELL CRT = previous HIGH sweep + close back inside range.'
);

console.log(
  '[CRT ENGINE] Currently-forming candles are rejected.'
);
