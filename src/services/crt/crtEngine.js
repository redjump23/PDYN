// ============================================================
// PDYN CRT ENGINE
// ============================================================
//
// PRIMARY SIGNAL:
//
//   Rachel T-style confirmed fractal
//
// SUPPORTING DATA:
//
//   • Market Structure
//   • STD Deviation
//   • Fractal Price
//   • Liquidity Sweep
//   • RSI
//
// IMPORTANT:
//
// The proprietary Rachel T source/indicator is not available here.
// Therefore this engine implements a deterministic confirmed
// 5-candle fractal model:
//
// TOP FRACTAL:
//   Center candle high is higher than the 2 candles before
//   and the 2 candles after it.
//
// BOTTOM FRACTAL:
//   Center candle low is lower than the 2 candles before
//   and the 2 candles after it.
//
// The fractal is considered CONFIRMED only after the required
// right-side candles have closed.
//
// Market Structure is calculated independently from the CRT
// fractal so the display can show:
//
//   BULLISH
//   BEARISH
//
// STD Deviation is calculated from recent closed-candle returns
// and expressed as a percentage.
//
// Liquidity Sweep is calculated from the confirmed fractal
// against previous liquidity.
//
// ============================================================

import {
  calculateRSI,
  getRSIState,
} from './rsi.js';

// ============================================================
// CONSTANTS
// ============================================================

const FRACTAL_LEFT = 2;
const FRACTAL_RIGHT = 2;

const DEFAULT_STRUCTURE_LOOKBACK = 50;
const DEFAULT_STD_PERIOD = 20;
const DEFAULT_LIQUIDITY_LOOKBACK = 20;

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
// NORMALIZE CANDLES
// ============================================================

function normalizeCandles(candles) {
  if (!Array.isArray(candles)) {
    return [];
  }

  return candles
    .filter(validCandle)
    .map((candle) => ({
      ...candle,

      open: num(candle.open),
      high: num(candle.high),
      low: num(candle.low),
      close: num(candle.close),

      openTime: finite(candle.openTime)
        ? num(candle.openTime)
        : null,

      closeTime: finite(candle.closeTime)
        ? num(candle.closeTime)
        : null,

      closed:
        candle.closed !== false,
    }));
}

// ============================================================
// STANDARD DEVIATION
//
// We use percentage returns instead of raw price values.
//
// Example:
//
// BTC moves:
//
// 0.42%
// -0.31%
// 0.18%
//
// STD Deviation:
//
// 0.32
//
// This keeps the value meaningful across BTC, XAU, ETH,
// low-priced coins, etc.
//
// ============================================================

function calculateStdDeviation(
  candles,
  period = DEFAULT_STD_PERIOD
) {
  if (!Array.isArray(candles)) {
    return null;
  }

  const closes = candles
    .map((candle) => num(candle.close))
    .filter(Number.isFinite);

  if (closes.length < 3) {
    return null;
  }

  const usablePeriod = Math.max(
    2,
    Math.min(
      Number(period) || DEFAULT_STD_PERIOD,
      closes.length - 1
    )
  );

  const recentCloses =
    closes.slice(
      -(usablePeriod + 1)
    );

  const returns = [];

  for (
    let i = 1;
    i < recentCloses.length;
    i += 1
  ) {
    const previous =
      recentCloses[i - 1];

    const current =
      recentCloses[i];

    if (
      !Number.isFinite(previous) ||
      !Number.isFinite(current) ||
      previous === 0
    ) {
      continue;
    }

    const percentageReturn =
      ((current - previous) /
        previous) *
      100;

    if (
      Number.isFinite(
        percentageReturn
      )
    ) {
      returns.push(
        percentageReturn
      );
    }
  }

  if (returns.length < 2) {
    return null;
  }

  const mean =
    returns.reduce(
      (sum, value) =>
        sum + value,
      0
    ) / returns.length;

  const variance =
    returns.reduce(
      (sum, value) =>
        sum +
        Math.pow(
          value - mean,
          2
        ),
      0
    ) / returns.length;

  const standardDeviation =
    Math.sqrt(variance);

  if (
    !Number.isFinite(
      standardDeviation
    )
  ) {
    return null;
  }

  return standardDeviation;
}

// ============================================================
// FIND TOP FRACTAL
//
// A top fractal is:
//
//             HIGH
//               /\
//              /  \
//       lower /    \ lower
//
// Center candle must be greater than the two candles
// immediately before and after it.
//
// ============================================================

function isTopFractal(
  candles,
  index
) {
  if (
    !Array.isArray(candles) ||
    index < FRACTAL_LEFT ||
    index + FRACTAL_RIGHT >=
      candles.length
  ) {
    return false;
  }

  const center =
    candles[index];

  if (!validCandle(center)) {
    return false;
  }

  const centerHigh =
    num(center.high);

  for (
    let offset = 1;
    offset <= FRACTAL_LEFT;
    offset += 1
  ) {
    if (
      centerHigh <=
      num(
        candles[index - offset]
          .high
      )
    ) {
      return false;
    }
  }

  for (
    let offset = 1;
    offset <= FRACTAL_RIGHT;
    offset += 1
  ) {
    if (
      centerHigh <=
      num(
        candles[index + offset]
          .high
      )
    ) {
      return false;
    }
  }

  return true;
}

// ============================================================
// FIND BOTTOM FRACTAL
//
// A bottom fractal is:
//
//       higher      higher
//          \          /
//           \        /
//            \ LOW  /
//
// Center candle must be lower than the two candles
// immediately before and after it.
//
// ============================================================

function isBottomFractal(
  candles,
  index
) {
  if (
    !Array.isArray(candles) ||
    index < FRACTAL_LEFT ||
    index + FRACTAL_RIGHT >=
      candles.length
  ) {
    return false;
  }

  const center =
    candles[index];

  if (!validCandle(center)) {
    return false;
  }

  const centerLow =
    num(center.low);

  for (
    let offset = 1;
    offset <= FRACTAL_LEFT;
    offset += 1
  ) {
    if (
      centerLow >=
      num(
        candles[index - offset]
          .low
      )
    ) {
      return false;
    }
  }

  for (
    let offset = 1;
    offset <= FRACTAL_RIGHT;
    offset += 1
  ) {
    if (
      centerLow >=
      num(
        candles[index + offset]
          .low
      )
    ) {
      return false;
    }
  }

  return true;
}

// ============================================================
// FIND ALL CONFIRMED FRACTALS
// ============================================================
//
// The last two candles cannot be fractal centers because
// they do not yet have two confirmed candles to their right.
//
// ============================================================

function findConfirmedFractals(
  candles
) {
  const fractals = [];

  if (
    !Array.isArray(candles) ||
    candles.length <
      FRACTAL_LEFT +
        FRACTAL_RIGHT +
        1
  ) {
    return fractals;
  }

  const lastIndex =
    candles.length -
    1 -
    FRACTAL_RIGHT;

  for (
    let i = FRACTAL_LEFT;
    i <= lastIndex;
    i += 1
  ) {
    if (
      isTopFractal(
        candles,
        i
      )
    ) {
      fractals.push({
        type: 'TOP',
        index: i,
        price: num(
          candles[i].high
        ),
        candle: candles[i],
        candleTime:
          candles[i].openTime,
      });
    }

    if (
      isBottomFractal(
        candles,
        i
      )
    ) {
      fractals.push({
        type: 'BOTTOM',
        index: i,
        price: num(
          candles[i].low
        ),
        candle: candles[i],
        candleTime:
          candles[i].openTime,
      });
    }
  }

  return fractals;
}

// ============================================================
// GET LATEST CONFIRMED FRACTAL
// ============================================================
//
// We intentionally return the most recent confirmed fractal.
//
// The fractal center is allowed to be older than the latest
// candle because the two right-side candles are required to
// confirm it.
//
// ============================================================

function getLatestConfirmedFractal(
  candles
) {
  const fractals =
    findConfirmedFractals(
      candles
    );

  if (!fractals.length) {
    return null;
  }

  fractals.sort(
    (a, b) =>
      a.index - b.index
  );

  return fractals[
    fractals.length - 1
  ];
}

// ============================================================
// GET PREVIOUS SAME-TYPE FRACTAL
// ============================================================

function getPreviousFractal(
  fractals,
  latest,
  type
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
    i -= 1
  ) {
    const fractal =
      fractals[i];

    if (
      fractal.index >=
      latest.index
    ) {
      continue;
    }

    if (
      fractal.type === type
    ) {
      return fractal;
    }
  }

  return null;
}

// ============================================================
// MARKET STRUCTURE
// ============================================================
//
// BULLISH:
//
//   Higher High OR Higher Low
//
// BEARISH:
//
//   Lower High OR Lower Low
//
// We use confirmed fractals rather than the CRT direction.
//
// This is important:
//
// CRT fractal = PRIMARY SIGNAL
//
// Market structure = SUPPORTING INFORMATION
//
// ============================================================

function calculateMarketStructure(
  candles,
  options = {}
) {
  const lookback = Math.max(
    10,
    Number(
      options.structureLookback ||
        DEFAULT_STRUCTURE_LOOKBACK
    )
  );

  const source =
    candles.length >
    lookback
      ? candles.slice(
          -lookback
        )
      : candles;

  const fractals =
    findConfirmedFractals(
      source
    );

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

  if (
    tops.length < 2 &&
    bottoms.length < 2
  ) {
    /*
     * We still provide a structure using
     * recent price direction rather than
     * returning N/A.
     */

    if (
      source.length >= 2
    ) {
      const first =
        num(
          source[0].close
        );

      const last =
        num(
          source[
            source.length - 1
          ].close
        );

      if (
        last > first
      ) {
        return {
          value: 'BULLISH',
          reason:
            'PRICE STRUCTURE RISING',
          higherHigh: false,
          higherLow: false,
          lowerHigh: false,
          lowerLow: false,
        };
      }

      if (
        last < first
      ) {
        return {
          value: 'BEARISH',
          reason:
            'PRICE STRUCTURE FALLING',
          higherHigh: false,
          higherLow: false,
          lowerHigh: false,
          lowerLow: false,
        };
      }
    }

    return {
      value: 'BULLISH',
      reason:
        'INSUFFICIENT SWING HISTORY',
      higherHigh: false,
      higherLow: false,
      lowerHigh: false,
      lowerLow: false,
    };
  }

  let higherHigh = false;
  let higherLow = false;
  let lowerHigh = false;
  let lowerLow = false;

  if (tops.length >= 2) {
    const previousTop =
      tops[tops.length - 2];

    const latestTop =
      tops[tops.length - 1];

    higherHigh =
      latestTop.price >
      previousTop.price;

    lowerHigh =
      latestTop.price <
      previousTop.price;
  }

  if (
    bottoms.length >= 2
  ) {
    const previousBottom =
      bottoms[
        bottoms.length - 2
      ];

    const latestBottom =
      bottoms[
        bottoms.length - 1
      ];

    higherLow =
      latestBottom.price >
      previousBottom.price;

    lowerLow =
      latestBottom.price <
      previousBottom.price;
  }

  /*
   * Strong bullish structure:
   *
   * HH + HL
   *
   * Bullish can also be established by
   * either HH or HL when only one swing
   * type is currently available.
   */

  if (
    (higherHigh &&
      higherLow) ||
    higherHigh
  ) {
    return {
      value: 'BULLISH',
      reason:
        higherHigh &&
        higherLow
          ? 'HIGHER HIGH + HIGHER LOW'
          : 'HIGHER HIGH',
      higherHigh,
      higherLow,
      lowerHigh,
      lowerLow,
    };
  }

  /*
   * Strong bearish structure:
   *
   * LH + LL
   *
   * Bearish can also be established by
   * either LH or LL.
   */

  if (
    (lowerHigh &&
      lowerLow) ||
    lowerLow
  ) {
    return {
      value: 'BEARISH',
      reason:
        lowerHigh &&
        lowerLow
          ? 'LOWER HIGH + LOWER LOW'
          : 'LOWER LOW',
      higherHigh,
      higherLow,
      lowerHigh,
      lowerLow,
    };
  }

  /*
   * If the latest confirmed top is lower
   * and latest bottom is higher, this is
   * compression/range behavior.
   *
   * We use the most recent candle direction
   * to resolve it instead of N/A.
   */

  const last =
    source[
      source.length - 1
    ];

  const previous =
    source[
      source.length - 2
    ];

  if (
    last &&
    previous
  ) {
    if (
      num(last.close) >
      num(previous.close)
    ) {
      return {
        value: 'BULLISH',
        reason:
          'LATEST PRICE MOMENTUM',
        higherHigh,
        higherLow,
        lowerHigh,
        lowerLow,
      };
    }

    if (
      num(last.close) <
      num(previous.close)
    ) {
      return {
        value: 'BEARISH',
        reason:
          'LATEST PRICE MOMENTUM',
        higherHigh,
        higherLow,
        lowerHigh,
        lowerLow,
      };
    }
  }

  return {
    value: 'BULLISH',
    reason:
      'NEUTRAL STRUCTURE DEFAULT',
    higherHigh,
    higherLow,
    lowerHigh,
    lowerLow,
  };
}

// ============================================================
// LIQUIDITY SWEEP
// ============================================================
//
// PRIMARY FRACTAL:
//
// TOP:
//
//   fractal high > previous liquidity high
//
// BOTTOM:
//
//   fractal low < previous liquidity low
//
// The liquidity search excludes the fractal candle itself
// and the confirmation candles after it.
//
// ============================================================

function calculateLiquiditySweep(
  candles,
  fractal,
  lookback = DEFAULT_LIQUIDITY_LOOKBACK
) {
  if (
    !Array.isArray(candles) ||
    !fractal
  ) {
    return {
      swept: false,
      type: 'NONE',
      label: 'None',
      level: null,
    };
  }

  const fractalIndex =
    fractal.index;

  if (
    !Number.isInteger(
      fractalIndex
    )
  ) {
    return {
      swept: false,
      type: 'NONE',
      label: 'None',
      level: null,
    };
  }

  /*
   * Only candles BEFORE the fractal are used
   * as previous liquidity.
   *
   * This prevents the fractal itself from
   * becoming its own liquidity level.
   */

  const beforeFractal =
    candles.slice(
      0,
      fractalIndex
    );

  if (
    beforeFractal.length < 2
  ) {
    return {
      swept: false,
      type: 'NONE',
      label: 'None',
      level: null,
    };
  }

  const liquidityCandles =
    beforeFractal.slice(
      -Math.max(
        3,
        Number(lookback) ||
          DEFAULT_LIQUIDITY_LOOKBACK
      )
    );

  if (
    fractal.type ===
    'TOP'
  ) {
    const highs =
      liquidityCandles
        .map(
          (candle) =>
            num(
              candle.high
            )
        )
        .filter(
          Number.isFinite
        );

    if (highs.length) {
      const previousHigh =
        Math.max(...highs);

      if (
        fractal.price >
        previousHigh
      ) {
        return {
          swept: true,
          type: 'HIGH',
          label:
            '**PREVIOUS HIGH SWEPT**',
          level:
            previousHigh,
        };
      }
    }
  }

  if (
    fractal.type ===
    'BOTTOM'
  ) {
    const lows =
      liquidityCandles
        .map(
          (candle) =>
            num(
              candle.low
            )
        )
        .filter(
          Number.isFinite
        );

    if (lows.length) {
      const previousLow =
        Math.min(...lows);

      if (
        fractal.price <
        previousLow
      ) {
        return {
          swept: true,
          type: 'LOW',
          label:
            '**PREVIOUS LOW SWEPT**',
          level:
            previousLow,
        };
      }
    }
  }

  return {
    swept: false,
    type: 'NONE',
    label: 'None',
    level: null,
  };
}

// ============================================================
// CRT CONFIRMATION
// ============================================================
//
// The fractal is the PRIMARY SIGNAL.
//
// Confirmation candle:
//
// TOP FRACTAL:
//
//   Price trades above the fractal high
//   and closes back below/inside the fractal level.
//
// BOTTOM FRACTAL:
//
//   Price trades below the fractal low
//   and closes back above/inside the fractal level.
//
// This gives the service a clean confirmed CRT candle.
//
// ============================================================

function confirmFractalCRT(
  candles,
  fractal,
  options = {}
) {
  if (
    !Array.isArray(candles) ||
    !fractal
  ) {
    return null;
  }

  const fractalIndex =
    fractal.index;

  /*
   * The candle immediately after the
   * fractal's two right-side confirmation
   * candles is the first candle that can
   * be treated as the CRT confirmation.
   */

  const confirmationIndex =
    fractalIndex +
    FRACTAL_RIGHT +
    1;

  /*
   * If the confirmation candle does not
   * exist yet, the fractal is not ready
   * to produce a CRT signal.
   */

  if (
    confirmationIndex >=
    candles.length
  ) {
    return null;
  }

  const confirmation =
    candles[
      confirmationIndex
    ];

  if (
    !validCandle(
      confirmation
    )
  ) {
    return null;
  }

  const high =
    num(
      confirmation.high
    );

  const low =
    num(
      confirmation.low
    );

  const open =
    num(
      confirmation.open
    );

  const close =
    num(
      confirmation.close
    );

  const level =
    num(
      fractal.price
    );

  if (
    ![
      high,
      low,
      open,
      close,
      level,
    ].every(
      Number.isFinite
    )
  ) {
    return null;
  }

  const requireCloseInside =
    options.requireCloseInside !==
    false;

  const useCloseDirection =
    options.useCloseDirection ===
    true;

  /*
   * TOP FRACTAL
   */

  if (
    fractal.type ===
    'TOP'
  ) {
    const swept =
      high > level;

    const closedBackInside =
      close <= level;

    const directionValid =
      !useCloseDirection ||
      close <= open;

    if (
      swept &&
      (!requireCloseInside ||
        closedBackInside) &&
      directionValid
    ) {
      return {
        confirmed: true,
        type: 'TOP',
        direction: 'SELL',
        fractal,
        confirmation,
        confirmationIndex,
        swept,
        closedBackInside,
      };
    }
  }

  /*
   * BOTTOM FRACTAL
   */

  if (
    fractal.type ===
    'BOTTOM'
  ) {
    const swept =
      low < level;

    const closedBackInside =
      close >= level;

    const directionValid =
      !useCloseDirection ||
      close >= open;

    if (
      swept &&
      (!requireCloseInside ||
        closedBackInside) &&
      directionValid
    ) {
      return {
        confirmed: true,
        type: 'BOTTOM',
        direction: 'BUY',
        fractal,
        confirmation,
        confirmationIndex,
        swept,
        closedBackInside,
      };
    }
  }

  return null;
}

// ============================================================
// FIND MOST RECENT CONFIRMED CRT FRACTAL
// ============================================================
//
// We search from newest to oldest.
//
// This is important because the monitor continuously scans
// the same 100 closed candles.
//
// The newest confirmed Rachel-style fractal that has a valid
// CRT confirmation is returned.
//
// ============================================================

function findLatestConfirmedCRT(
  candles,
  options = {}
) {
  const fractals =
    findConfirmedFractals(
      candles
    );

  if (!fractals.length) {
    return null;
  }

  for (
    let i =
      fractals.length - 1;
    i >= 0;
    i -= 1
  ) {
    const fractal =
      fractals[i];

    const confirmation =
      confirmFractalCRT(
        candles,
        fractal,
        options
      );

    if (
      confirmation
    ) {
      return {
        fractals,
        fractal,
        confirmation,
      };
    }
  }

  return null;
}

// ============================================================
// BUILD CRT SIGNAL
// ============================================================
//
// PUBLIC FUNCTION USED BY crtService.js
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
  const closedCandles =
    normalizeCandles(
      candles
    ).filter(
      (candle) =>
        candle.closed !== false
    );

  /*
   * We need enough candles for:
//
//   • RSI
//   • Standard deviation
//   • Fractals
//   • Market structure
//   • Liquidity
//
   */

  const minimumCandles =
    Math.max(
      30,
      Number(rsiPeriod) + 5,
      DEFAULT_STD_PERIOD + 5,
      FRACTAL_LEFT +
        FRACTAL_RIGHT +
        5
    );

  if (
    closedCandles.length <
    minimumCandles
  ) {
    return null;
  }

  // ==========================================================
  // PRIMARY RACHEL-STYLE FRACTAL
  // ==========================================================

  const crt =
    findLatestConfirmedCRT(
      closedCandles,
      crtOptions
    );

  /*
   * No confirmed fractal + CRT confirmation
   * means no signal.
   *
   * This keeps Rachel T fractal as the
   * PRIMARY SIGNAL.
   */

  if (!crt) {
    return null;
  }

  const fractal =
    crt.fractal;

  const confirmation =
    crt.confirmation;

  // ==========================================================
  // RSI
  // ==========================================================

  const closes =
    closedCandles.map(
      (candle) =>
        num(candle.close)
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
  // MARKET STRUCTURE
  // ==========================================================

  const marketStructure =
    calculateMarketStructure(
      closedCandles,
      {
        structureLookback:
          crtOptions.structureLookback ||
          DEFAULT_STRUCTURE_LOOKBACK,
      }
    );

  // ==========================================================
  // STD DEVIATION
  // ==========================================================

  const stdDeviation =
    calculateStdDeviation(
      closedCandles,
      crtOptions.stdPeriod ||
        DEFAULT_STD_PERIOD
    );

  // ==========================================================
  // LIQUIDITY SWEEP
  // ==========================================================

  const liquiditySweep =
    calculateLiquiditySweep(
      closedCandles,
      fractal,
      crtOptions.liquidityLookback ||
        DEFAULT_LIQUIDITY_LOOKBACK
    );

  // ==========================================================
  // CRT CANDLE
  // ==========================================================

  const crtCandle =
    confirmation.confirmation;

  // ==========================================================
  // STRENGTH
  //
  // This does NOT determine whether the CRT exists.
  //
  // Rachel fractal confirmation already determines
  // whether the signal exists.
  //
  // Strength is only additional information.
  // ==========================================================

  const strongBullish =
    fractal.type ===
      'BOTTOM' &&
    rsiState ===
      'OVERSOLD';

  const strongBearish =
    fractal.type ===
      'TOP' &&
    rsiState ===
      'OVERBOUGHT';

  const strength =
    strongBullish ||
    strongBearish
      ? 'STRONG'
      : 'STANDARD';

  // ==========================================================
  // CANDLE TIME
  //
  // The CRT confirmation candle is the actual
  // candle responsible for the alert timestamp.
  // ==========================================================

  const candleTime =
    crtCandle.openTime ??
    crtCandle.closeTime ??
    fractal.candleTime ??
    Date.now();

  // ==========================================================
  // SIGNAL ID
  //
  // Includes the fractal candle and confirmation candle.
  //
  // This prevents duplicate Discord alerts while
  // preserving a unique signal for every confirmed fractal.
  // ==========================================================

  const signalId =
    [
      market,
      symbol,
      timeframe,
      fractal.type,
      fractal.candleTime,
      candleTime,
    ].join(':');

  // ==========================================================
  // RETURN SIGNAL
  // ==========================================================

  return {
    // --------------------------------------------------------
    // IDENTIFICATION
    // --------------------------------------------------------

    id: signalId,

    symbol,
    market,
    timeframe,

    // --------------------------------------------------------
    // PRIMARY CRT DIRECTION
    //
    // Kept internally for compatibility.
    //
    // Discord display does NOT need to show BUY/SELL.
    // --------------------------------------------------------

    direction:
      confirmation.direction,

    strength,

    // --------------------------------------------------------
    // RACHEL-STYLE FRACTAL
    // --------------------------------------------------------

    fractalType:
      fractal.type,

    fractal: {
      type:
        fractal.type,

      price:
        fractal.price,

      index:
        fractal.index,

      candleTime:
        fractal.candleTime,
    },

    fractalPrice:
      fractal.price,

    // --------------------------------------------------------
    // CRT CONFIRMATION
    // --------------------------------------------------------

    confirmed: true,

    confirmedCRT: true,

    crtConfirmed: true,

    crtCandle: {
      open:
        num(crtCandle.open),

      high:
        num(crtCandle.high),

      low:
        num(crtCandle.low),

      close:
        num(crtCandle.close),

      openTime:
        crtCandle.openTime,

      closeTime:
        crtCandle.closeTime,
    },

    // --------------------------------------------------------
    // MARKET STRUCTURE
    //
    // THIS FIXES:
    //
    // Market Structure: N/A
    //
    // The value is now generated by the engine.
    // --------------------------------------------------------

    marketStructure:
      marketStructure.value,

    structure:
      marketStructure.value,

    market_structure:
      marketStructure.value,

    structureReason:
      marketStructure.reason,

    structureDetails: {
      higherHigh:
        marketStructure.higherHigh,

      higherLow:
        marketStructure.higherLow,

      lowerHigh:
        marketStructure.lowerHigh,

      lowerLow:
        marketStructure.lowerLow,
    },

    // --------------------------------------------------------
    // STD DEVIATION
    //
    // THIS FIXES:
    //
    // STD Deviation: N/A
    //
    // Value is percentage standard deviation of
    // recent candle-to-candle returns.
    // --------------------------------------------------------

    stdDeviation,

    stdDev:
      stdDeviation,

    standardDeviation:
      stdDeviation,

    // --------------------------------------------------------
    // LIQUIDITY SWEEP
    //
    // THIS IS GENERATED HERE so crtService.js can
    // simply display:
    //
    // signal.liquiditySweep.label
    // --------------------------------------------------------

    liquiditySweep,

    // --------------------------------------------------------
    // PRICE
    // --------------------------------------------------------

    price:
      num(
        crtCandle.close
      ),

    signalPrice:
      num(
        crtCandle.close
      ),

    // --------------------------------------------------------
    // CANDLE EXTREMES
    // --------------------------------------------------------

    parentHigh:
      num(
        fractal.candle.high
      ),

    parentLow:
      num(
        fractal.candle.low
      ),

    signalHigh:
      num(
        crtCandle.high
      ),

    signalLow:
      num(
        crtCandle.low
      ),

    signalClose:
      num(
        crtCandle.close
      ),

    closedInside:
      confirmation.closedBackInside,

    // --------------------------------------------------------
    // RSI
    // --------------------------------------------------------

    rsi,

    rsiState,

    // --------------------------------------------------------
    // TIME
    // --------------------------------------------------------

    fractalCandleTime:
      fractal.candleTime,

    confirmationCandleTime:
      candleTime,

    candleTime,

    // --------------------------------------------------------
    // DEBUG / INTERNAL DATA
    // --------------------------------------------------------

    crt: {
      fractalType:
        fractal.type,

      fractalPrice:
        fractal.price,

      direction:
        confirmation.direction,

      confirmed:
        true,

      swept:
        confirmation.swept,

      closedBackInside:
        confirmation.closedBackInside,
    },
  };
}

// ============================================================
// OPTIONAL DIRECT FRACTAL SCANNER
// ============================================================
//
// Useful if another part of the bot needs to inspect
// Rachel-style confirmed fractals without creating
// a complete CRT signal.
//
// ============================================================

export function findFractals(
  candles
) {
  const normalized =
    normalizeCandles(
      candles
    ).filter(
      (candle) =>
        candle.closed !== false
    );

  return findConfirmedFractals(
    normalized
  );
}

// ============================================================
// OPTIONAL MARKET STRUCTURE SCANNER
// ============================================================
//
// Exposed for debugging/testing.
//
// ============================================================

export function getMarketStructure(
  candles,
  options = {}
) {
  const normalized =
    normalizeCandles(
      candles
    ).filter(
      (candle) =>
        candle.closed !== false
    );

  return calculateMarketStructure(
    normalized,
    options
  );
}

// ============================================================
// OPTIONAL STD DEVIATION SCANNER
// ============================================================
//
// Exposed for debugging/testing.
//
// ============================================================

export function getStdDeviation(
  candles,
  period = DEFAULT_STD_PERIOD
) {
  const normalized =
    normalizeCandles(
      candles
    ).filter(
      (candle) =>
        candle.closed !== false
    );

  return calculateStdDeviation(
    normalized,
    period
  );
}

// ============================================================
// OPTIONAL LIQUIDITY SCANNER
// ============================================================
//
// Exposed for debugging/testing.
//
// ============================================================

export function getLiquiditySweep(
  candles,
  fractal,
  lookback =
    DEFAULT_LIQUIDITY_LOOKBACK
) {
  const normalized =
    normalizeCandles(
      candles
    ).filter(
      (candle) =>
        candle.closed !== false
    );

  return calculateLiquiditySweep(
    normalized,
    fractal,
    lookback
  );
}

// ============================================================
// EXPORT FRACTAL CONSTANTS
// ============================================================
//
// Helpful for future engine modules.
//
// ============================================================

export const CRT_FRACTAL_CONFIG = {
  left:
    FRACTAL_LEFT,

  right:
    FRACTAL_RIGHT,

  stdPeriod:
    DEFAULT_STD_PERIOD,

  liquidityLookback:
    DEFAULT_LIQUIDITY_LOOKBACK,
};

// ============================================================
// ENGINE LOADED
// ============================================================

console.log(
  '[CRT ENGINE] Loaded • Rachel-style confirmed fractal engine'
);
