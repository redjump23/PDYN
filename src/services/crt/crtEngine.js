// ============================================================
// PDYN CRT ENGINE
// ============================================================
//
// PRIMARY SIGNAL:
//
//   Rachel T Fractal / Confirmed Fractal
//
// SUPPORTING INFORMATION ONLY:
//
//   • RSI
//   • STD Deviation
//   • Market Structure
//   • Liquidity Sweep
//
// IMPORTANT:
//
// The primary signal is the confirmed fractal.
// RSI, STD Deviation, Market Structure and Liquidity
// do NOT create the signal.
//
// A fractal is only confirmed after the required number
// of candles have closed to its right.
//
// This prevents the engine from using a still-forming
// fractal and reduces repainting.
//
// NOTE:
// Exact proprietary Rachel T logic cannot be guaranteed
// without the original Rachel T source/script.
// This engine uses a confirmed pivot/fractal structure
// as the primary fractal detector.
// ============================================================

import {
  calculateRSI,
  getRSIState,
} from './rsi.js';

// ============================================================
// DEFAULT SETTINGS
// ============================================================

const DEFAULT_LEFT_BARS = 2;
const DEFAULT_RIGHT_BARS = 2;

const DEFAULT_STD_PERIOD = 20;

const DEFAULT_STRUCTURE_LOOKBACK = 20;

// ============================================================
// NUMBER HELPERS
// ============================================================

function toNumber(value) {
  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : null;
}

function isValidCandle(candle) {
  if (!candle) {
    return false;
  }

  const high = toNumber(candle.high);
  const low = toNumber(candle.low);
  const close = toNumber(candle.close);

  return (
    high !== null &&
    low !== null &&
    close !== null
  );
}

// ============================================================
// GET CLOSED CANDLES
// ============================================================

function getClosedCandles(candles) {
  if (!Array.isArray(candles)) {
    return [];
  }

  return candles.filter((candle) => {
    if (!isValidCandle(candle)) {
      return false;
    }

    return candle.closed !== false;
  });
}

// ============================================================
// FRACTAL SETTINGS
// ============================================================

function getFractalSettings(options = {}) {
  const leftBars = Math.max(
    1,
    Number(
      options.leftBars ??
        options.fractalLeftBars ??
        DEFAULT_LEFT_BARS
    )
  );

  const rightBars = Math.max(
    1,
    Number(
      options.rightBars ??
        options.fractalRightBars ??
        DEFAULT_RIGHT_BARS
    )
  );

  return {
    leftBars,
    rightBars,
  };
}

// ============================================================
// FRACTAL HIGH
// ============================================================
//
// A confirmed TOP fractal:
//
//        LEFT       FRACTAL       RIGHT
//
//          H            H            H
//          |            |            |
//       lower        HIGHEST       lower
//
// The fractal candle must have a higher high than
// every candle in the left/right confirmation window.
//
// The right-side candles must already be CLOSED.
//
// ============================================================

function isFractalHigh(
  candles,
  index,
  leftBars,
  rightBars
) {
  if (!Array.isArray(candles)) {
    return false;
  }

  if (
    index - leftBars < 0 ||
    index + rightBars >= candles.length
  ) {
    return false;
  }

  const fractalHigh =
    toNumber(candles[index]?.high);

  if (fractalHigh === null) {
    return false;
  }

  // ----------------------------------------------------------
  // LEFT SIDE
  // ----------------------------------------------------------

  for (
    let i = index - leftBars;
    i < index;
    i++
  ) {
    const high =
      toNumber(candles[i]?.high);

    if (
      high === null ||
      high >= fractalHigh
    ) {
      return false;
    }
  }

  // ----------------------------------------------------------
  // RIGHT SIDE
  // ----------------------------------------------------------

  for (
    let i = index + 1;
    i <= index + rightBars;
    i++
  ) {
    const high =
      toNumber(candles[i]?.high);

    if (
      high === null ||
      high >= fractalHigh
    ) {
      return false;
    }
  }

  return true;
}

// ============================================================
// FRACTAL LOW
// ============================================================
//
// A confirmed BOTTOM fractal:
//
//        LEFT       FRACTAL       RIGHT
//
//          L            L            L
//          |            |            |
//       higher        LOWEST       higher
//
// ============================================================

function isFractalLow(
  candles,
  index,
  leftBars,
  rightBars
) {
  if (!Array.isArray(candles)) {
    return false;
  }

  if (
    index - leftBars < 0 ||
    index + rightBars >= candles.length
  ) {
    return false;
  }

  const fractalLow =
    toNumber(candles[index]?.low);

  if (fractalLow === null) {
    return false;
  }

  // ----------------------------------------------------------
  // LEFT SIDE
  // ----------------------------------------------------------

  for (
    let i = index - leftBars;
    i < index;
    i++
  ) {
    const low =
      toNumber(candles[i]?.low);

    if (
      low === null ||
      low <= fractalLow
    ) {
      return false;
    }
  }

  // ----------------------------------------------------------
  // RIGHT SIDE
  // ----------------------------------------------------------

  for (
    let i = index + 1;
    i <= index + rightBars;
    i++
  ) {
    const low =
      toNumber(candles[i]?.low);

    if (
      low === null ||
      low <= fractalLow
    ) {
      return false;
    }
  }

  return true;
}

// ============================================================
// FIND LATEST CONFIRMED FRACTAL
// ============================================================
//
// IMPORTANT:
//
// The fractal itself is NOT the latest candle.
//
// Example:
//
// Candle 100 = potential fractal
// Candle 101 = confirmation 1
// Candle 102 = confirmation 2
//
// When candle 102 closes:
//
// Candle 100 becomes a CONFIRMED fractal.
//
// This is the candle that generates the signal.
//
// ============================================================

export function findLatestConfirmedFractal(
  candles,
  options = {}
) {
  const closedCandles =
    getClosedCandles(candles);

  const {
    leftBars,
    rightBars,
  } = getFractalSettings(options);

  if (
    closedCandles.length <
    leftBars + rightBars + 1
  ) {
    return null;
  }

  /*
   * The latest possible confirmed fractal is
   * rightBars candles before the latest closed candle.
   */
  const latestFractalIndex =
    closedCandles.length -
    1 -
    rightBars;

  if (latestFractalIndex < leftBars) {
    return null;
  }

  /*
   * Check newest possible fractal first.
   */
  for (
    let index = latestFractalIndex;
    index >= leftBars;
    index--
  ) {
    const top =
      isFractalHigh(
        closedCandles,
        index,
        leftBars,
        rightBars
      );

    const bottom =
      isFractalLow(
        closedCandles,
        index,
        leftBars,
        rightBars
      );

    /*
     * A candle should not normally be both.
     */
    if (top && !bottom) {
      const candle =
        closedCandles[index];

      return {
        type: 'TOP',
        price: toNumber(candle.high),
        candle,
        index,
        confirmationIndex:
          index + rightBars,
        confirmationCandle:
          closedCandles[
            index + rightBars
          ],
        candleTime:
          candle.openTime ??
          candle.time ??
          candle.timestamp ??
          candle.ts,
        confirmationTime:
          closedCandles[
            index + rightBars
          ]?.openTime ??
          closedCandles[
            index + rightBars
          ]?.time ??
          closedCandles[
            index + rightBars
          ]?.timestamp ??
          closedCandles[
            index + rightBars
          ]?.ts,
      };
    }

    if (bottom && !top) {
      const candle =
        closedCandles[index];

      return {
        type: 'BOTTOM',
        price: toNumber(candle.low),
        candle,
        index,
        confirmationIndex:
          index + rightBars,
        confirmationCandle:
          closedCandles[
            index + rightBars
          ],
        candleTime:
          candle.openTime ??
          candle.time ??
          candle.timestamp ??
          candle.ts,
        confirmationTime:
          closedCandles[
            index + rightBars
          ]?.openTime ??
          closedCandles[
            index + rightBars
          ]?.time ??
          closedCandles[
            index + rightBars
          ]?.timestamp ??
          closedCandles[
            index + rightBars
          ]?.ts,
      };
    }
  }

  return null;
}

// ============================================================
// MARKET STRUCTURE
// ============================================================
//
// This is INFORMATION ONLY.
//
// It does NOT create the CRT signal.
//
// Structure is derived from the most recent confirmed
// swing highs/lows.
//
// BULLISH:
//
//   Latest swing high > previous swing high
//   AND
//   Latest swing low > previous swing low
//
// BEARISH:
//
//   Latest swing high < previous swing high
//   AND
//   Latest swing low < previous swing low
//
// Otherwise:
//
//   NEUTRAL
//
// ============================================================

function getRecentFractals(
  candles,
  options = {}
) {
  const {
    leftBars,
    rightBars,
  } = getFractalSettings(options);

  const results = [];

  const maxIndex =
    candles.length -
    1 -
    rightBars;

  for (
    let index = leftBars;
    index <= maxIndex;
    index++
  ) {
    if (
      isFractalHigh(
        candles,
        index,
        leftBars,
        rightBars
      )
    ) {
      results.push({
        type: 'TOP',
        price:
          toNumber(
            candles[index].high
          ),
        index,
      });
    }

    if (
      isFractalLow(
        candles,
        index,
        leftBars,
        rightBars
      )
    ) {
      results.push({
        type: 'BOTTOM',
        price:
          toNumber(
            candles[index].low
          ),
        index,
      });
    }
  }

  return results;
}

export function calculateMarketStructure(
  candles,
  options = {}
) {
  if (
    !Array.isArray(candles) ||
    candles.length < 5
  ) {
    return 'NEUTRAL';
  }

  const lookback =
    Math.max(
      5,
      Number(
        options.structureLookback ??
          DEFAULT_STRUCTURE_LOOKBACK
      )
    );

  const source =
    candles.length > lookback
      ? candles.slice(-lookback)
      : candles;

  const fractals =
    getRecentFractals(
      source,
      options
    );

  const highs =
    fractals.filter(
      (item) =>
        item.type === 'TOP'
    );

  const lows =
    fractals.filter(
      (item) =>
        item.type === 'BOTTOM'
    );

  if (
    highs.length < 2 ||
    lows.length < 2
  ) {
    return 'NEUTRAL';
  }

  const previousHigh =
    highs[highs.length - 2].price;

  const latestHigh =
    highs[highs.length - 1].price;

  const previousLow =
    lows[lows.length - 2].price;

  const latestLow =
    lows[lows.length - 1].price;

  if (
    latestHigh > previousHigh &&
    latestLow > previousLow
  ) {
    return 'BULLISH';
  }

  if (
    latestHigh < previousHigh &&
    latestLow < previousLow
  ) {
    return 'BEARISH';
  }

  /*
   * If the highs/lows are mixed, use the latest
   * confirmed swing relationship as a fallback.
   */
  if (
    latestHigh > previousHigh &&
    latestLow >= previousLow
  ) {
    return 'BULLISH';
  }

  if (
    latestHigh <= previousHigh &&
    latestLow < previousLow
  ) {
    return 'BEARISH';
  }

  return 'NEUTRAL';
}

// ============================================================
// STANDARD DEVIATION
// ============================================================
//
// INFORMATION ONLY.
//
// Calculates population standard deviation of closing
// prices over the configured period.
//
// This does NOT determine whether a fractal exists.
//
// ============================================================

export function calculateStdDeviation(
  candles,
  period = DEFAULT_STD_PERIOD
) {
  if (!Array.isArray(candles)) {
    return null;
  }

  const safePeriod =
    Math.max(
      2,
      Number(period)
    );

  const closes =
    candles
      .slice(-safePeriod)
      .map((candle) =>
        toNumber(candle.close)
      )
      .filter(
        (value) =>
          value !== null
      );

  if (
    closes.length < 2
  ) {
    return null;
  }

  const mean =
    closes.reduce(
      (sum, value) =>
        sum + value,
      0
    ) / closes.length;

  const variance =
    closes.reduce(
      (sum, value) =>
        sum +
        Math.pow(
          value - mean,
          2
        ),
      0
    ) / closes.length;

  return Math.sqrt(
    variance
  );
}

// ============================================================
// FRACTAL PRICE
// ============================================================
//
// TOP    = fractal high
// BOTTOM = fractal low
//
// ============================================================

function getFractalPrice(fractal) {
  if (!fractal) {
    return null;
  }

  if (
    Number.isFinite(
      Number(fractal.price)
    )
  ) {
    return Number(
      fractal.price
    );
  }

  if (
    fractal.type === 'TOP'
  ) {
    return toNumber(
      fractal.candle?.high
    );
  }

  if (
    fractal.type === 'BOTTOM'
  ) {
    return toNumber(
      fractal.candle?.low
    );
  }

  return null;
}

// ============================================================
// FRACTAL LABEL
// ============================================================

function getFractalLabel(type) {
  if (type === 'TOP') {
    return 'TOP FRACTAL';
  }

  if (type === 'BOTTOM') {
    return 'BOTTOM FRACTAL';
  }

  return 'FRACTAL';
}

// ============================================================
// CRT FRACTAL DETECTION
// ============================================================
//
// This function is intentionally independent from:
//
//   • RSI
//   • Market Structure
//   • STD Deviation
//   • Liquidity
//
// The fractal alone creates the primary signal.
//
// ============================================================

export function detectCRT(
  candles,
  options = {}
) {
  const closedCandles =
    getClosedCandles(candles);

  if (
    closedCandles.length <
    Math.max(
      10,
      Number(
        options.minimumCandles ??
          10
      )
    )
  ) {
    return null;
  }

  const fractal =
    findLatestConfirmedFractal(
      closedCandles,
      options
    );

  if (!fractal) {
    return null;
  }

  const fractalPrice =
    getFractalPrice(
      fractal
    );

  if (
    fractalPrice === null
  ) {
    return null;
  }

  return {
    type: fractal.type,

    fractalType:
      fractal.type,

    fractalLabel:
      getFractalLabel(
        fractal.type
      ),

    fractalPrice,

    fractalCandle:
      fractal.candle,

    confirmationCandle:
      fractal.confirmationCandle,

    fractalIndex:
      fractal.index,

    confirmationIndex:
      fractal.confirmationIndex,

    fractalCandleTime:
      fractal.candleTime,

    candleTime:
      fractal.confirmationTime ??
      fractal.candleTime,

    confirmed: true,

    confirmedCRT: true,

    crtConfirmed: true,

    /*
     * Compatibility fields.
     *
     * These are retained so existing service code
     * does not break while the engine moves away
     * from BUY/SELL as the primary logic.
     */
    parent:
      fractal.candle,

    signal:
      fractal.confirmationCandle,

    parentHigh:
      toNumber(
        fractal.candle?.high
      ),

    parentLow:
      toNumber(
        fractal.candle?.low
      ),

    signalHigh:
      toNumber(
        fractal.confirmationCandle?.high
      ),

    signalLow:
      toNumber(
        fractal.confirmationCandle?.low
      ),

    signalClose:
      toNumber(
        fractal.confirmationCandle?.close
      ),
  };
}

// ============================================================
// BUILD SIGNAL
// ============================================================
//
// PRIMARY:
//
//   Confirmed Rachel T-style fractal
//
// SUPPORTING:
//
//   RSI
//   STD Deviation
//   Market Structure
//
// IMPORTANT:
//
// There is NO BUY/SELL calculation here.
//
// The fractal is the signal.
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
    getClosedCandles(
      candles
    );

  if (
    closedCandles.length <
    Math.max(
      20,
      Number(
        rsiPeriod
      ) + 2
    )
  ) {
    return null;
  }

  // ==========================================================
  // PRIMARY SIGNAL
  // ==========================================================

  const fractal =
    detectCRT(
      closedCandles,
      {
        ...crtOptions,

        leftBars:
          crtOptions.leftBars ??
          crtOptions.fractalLeftBars ??
          DEFAULT_LEFT_BARS,

        rightBars:
          crtOptions.rightBars ??
          crtOptions.fractalRightBars ??
          DEFAULT_RIGHT_BARS,
      }
    );

  /*
   * NO CONFIRMED FRACTAL =
   * NO SIGNAL.
   */
  if (!fractal) {
    return null;
  }

  // ==========================================================
  // RSI
  //
  // INFORMATION ONLY
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
  //
  // INFORMATION ONLY
  // ==========================================================

  const marketStructure =
    calculateMarketStructure(
      closedCandles,
      {
        ...crtOptions,

        structureLookback:
          crtOptions.structureLookback ??
          DEFAULT_STRUCTURE_LOOKBACK,
      }
    );

  // ==========================================================
  // STD DEVIATION
  //
  // INFORMATION ONLY
  // ==========================================================

  const stdDeviation =
    calculateStdDeviation(
      closedCandles,
      Number(
        crtOptions.stdPeriod ??
          DEFAULT_STD_PERIOD
      )
    );

  // ==========================================================
  // PRIMARY SIGNAL ID
  // ==========================================================
  //
  // Use the CONFIRMATION candle time.
  //
  // This means the same confirmed fractal will not
  // repeatedly generate a new signal during subsequent scans.
  //
  // ==========================================================

  const signalTime =
    fractal.candleTime ??
    fractal.confirmationTime ??
    Date.now();

  const id =
    [
      market,
      symbol,
      timeframe,
      fractal.type,
      signalTime,
    ].join(':');

  // ==========================================================
  // FINAL SIGNAL OBJECT
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
    // PRIMARY RACHEL T FRACTAL
    // --------------------------------------------------------

    fractalType:
      fractal.fractalType,

    fractalLabel:
      fractal.fractalLabel,

    fractalPrice:
      fractal.fractalPrice,

    fractal:
      {
        type:
          fractal.fractalType,

        label:
          fractal.fractalLabel,

        price:
          fractal.fractalPrice,

        candle:
          fractal.fractalCandle,

        confirmationCandle:
          fractal.confirmationCandle,
      },

    // --------------------------------------------------------
    // CONFIRMATION
    // --------------------------------------------------------

    confirmed:
      true,

    confirmedCRT:
      true,

    crtConfirmed:
      true,

    confirmationIndex:
      fractal.confirmationIndex,

    confirmationCandle:
      fractal.confirmationCandle,

    // --------------------------------------------------------
    // TIMING
    // --------------------------------------------------------

    candleTime:
      fractal.candleTime ??
      signalTime,

    fractalCandleTime:
      fractal.fractalCandleTime,

    confirmationTime:
      fractal.confirmationTime,

    // --------------------------------------------------------
    // MARKET STRUCTURE
    //
    // INFORMATION ONLY
    // --------------------------------------------------------

    marketStructure,

    structure:
      marketStructure,

    market_structure:
      marketStructure,

    // --------------------------------------------------------
    // STD DEVIATION
    //
    // INFORMATION ONLY
    // --------------------------------------------------------

    stdDeviation,

    stdDev:
      stdDeviation,

    standardDeviation:
      stdDeviation,

    // --------------------------------------------------------
    // RSI
    //
    // INFORMATION ONLY
    // --------------------------------------------------------

    rsi,

    rsiState,

    // --------------------------------------------------------
    // COMPATIBILITY
    //
    // Keep these so existing crtService.js does not crash.
    // --------------------------------------------------------

    parent:
      fractal.parent,

    signal:
      fractal.signal,

    parentHigh:
      fractal.parentHigh,

    parentLow:
      fractal.parentLow,

    signalHigh:
      fractal.signalHigh,

    signalLow:
      fractal.signalLow,

    signalClose:
      fractal.signalClose,

    closedInside:
      true,

    /*
     * IMPORTANT:
     *
     * direction is intentionally NOT BUY/SELL.
     *
     * For compatibility, it represents the fractal side.
     *
     * TOP    = bearish-side fractal
     * BOTTOM = bullish-side fractal
     *
     * The Discord display should continue using
     * fractalType/fractalPrice rather than BUY/SELL.
     */
    direction:
      fractal.fractalType ===
      'TOP'
        ? 'TOP'
        : 'BOTTOM',

    /*
     * Strength is no longer used to decide the signal.
     * Keep a neutral value for compatibility.
     */
    strength:
      'STANDARD',
  };
}

// ============================================================
// UTILITY:
// GET LATEST FRACTAL WITHOUT BUILDING A SIGNAL
// ============================================================
//
// Useful for future top-down logic.
//
// ============================================================

export function getLatestFractal(
  candles,
  options = {}
) {
  return findLatestConfirmedFractal(
    getClosedCandles(candles),
    options
  );
}

// ============================================================
// UTILITY:
// GET ALL CONFIRMED FRACTALS
// ============================================================
//
// Useful if the service later needs to compare the current
// Rachel T fractal against previous fractal liquidity.
//
// ============================================================

export function getConfirmedFractals(
  candles,
  options = {}
) {
  const closedCandles =
    getClosedCandles(
      candles
    );

  const {
    leftBars,
    rightBars,
  } = getFractalSettings(
    options
  );

  const results = [];

  const maxIndex =
    closedCandles.length -
    1 -
    rightBars;

  for (
    let index = leftBars;
    index <= maxIndex;
    index++
  ) {
    const top =
      isFractalHigh(
        closedCandles,
        index,
        leftBars,
        rightBars
      );

    const bottom =
      isFractalLow(
        closedCandles,
        index,
        leftBars,
        rightBars
      );

    if (top && !bottom) {
      results.push({
        type: 'TOP',

        fractalType:
          'TOP',

        fractalPrice:
          toNumber(
            closedCandles[index].high
          ),

        candle:
          closedCandles[index],

        candleTime:
          closedCandles[index].openTime ??
          closedCandles[index].time ??
          closedCandles[index].timestamp ??
          closedCandles[index].ts,

        confirmationCandle:
          closedCandles[
            index + rightBars
          ],

        confirmationIndex:
          index + rightBars,

        confirmationTime:
          closedCandles[
            index + rightBars
          ]?.openTime ??
          closedCandles[
            index + rightBars
          ]?.time ??
          closedCandles[
            index + rightBars
          ]?.timestamp ??
          closedCandles[
            index + rightBars
          ]?.ts,
      });
    }

    if (bottom && !top) {
      results.push({
        type: 'BOTTOM',

        fractalType:
          'BOTTOM',

        fractalPrice:
          toNumber(
            closedCandles[index].low
          ),

        candle:
          closedCandles[index],

        candleTime:
          closedCandles[index].openTime ??
          closedCandles[index].time ??
          closedCandles[index].timestamp ??
          closedCandles[index].ts,

        confirmationCandle:
          closedCandles[
            index + rightBars
          ],

        confirmationIndex:
          index + rightBars,

        confirmationTime:
          closedCandles[
            index + rightBars
          ]?.openTime ??
          closedCandles[
            index + rightBars
          ]?.time ??
          closedCandles[
            index + rightBars
          ]?.timestamp ??
          closedCandles[
            index + rightBars
          ]?.ts,
      });
    }
  }

  return results;
}

// ============================================================
// ENGINE CONFIGURATION
// ============================================================

export function getEngineConfig() {
  return {
    primarySignal:
      'CONFIRMED_RACHEL_T_FRACTAL',

    fractal: {
      leftBars:
        DEFAULT_LEFT_BARS,

      rightBars:
        DEFAULT_RIGHT_BARS,
    },

    information: {
      rsi: true,

      stdDeviation: true,

      marketStructure: true,

      liquiditySweep:
        'CALCULATED_BY_CRT_SERVICE',
    },

    buySellSignal:
      false,
  };
}

// ============================================================
// ENGINE LOADED
// ============================================================

console.log(
  '[CRT ENGINE] Loaded • Primary: Confirmed Rachel T Fractal'
);

console.log(
  `[CRT ENGINE] Fractal confirmation: ${DEFAULT_LEFT_BARS} left / ${DEFAULT_RIGHT_BARS} right candles`
);

console.log(
  '[CRT ENGINE] RSI / STD Deviation / Market Structure = INFORMATION ONLY'
);

