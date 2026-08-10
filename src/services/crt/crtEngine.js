import { calculateRSI, getRSIState } from './rsi.js';

/*
 * ============================================================
 * PDYN CRT ENGINE
 * ============================================================
 *
 * CRT MODEL:
 *
 * Parent candle establishes the range.
 *
 * Signal candle:
 *   - sweeps parent high OR parent low
 *   - closes back inside parent range
 *
 * Additional information returned:
 *
 *   marketStructure
 *   stdDeviation
 *   fractalPrice
 *   fractalType
 *   confirmedCRT
 *
 * The existing CRT confirmation logic is preserved.
 * ============================================================
 */

// ============================================================
// NUMERIC HELPERS
// ============================================================

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

// ============================================================
// STANDARD DEVIATION
//
// Uses the closes from the supplied closed candles.
//
// Population standard deviation is used because the engine
// is measuring the dispersion of the current candle sample,
// not estimating a larger statistical population.
// ============================================================

function calculateStdDeviation(values) {
  if (!Array.isArray(values)) {
    return null;
  }

  const numbers = values
    .map(Number)
    .filter(Number.isFinite);

  if (numbers.length < 2) {
    return null;
  }

  const mean =
    numbers.reduce(
      (sum, value) => sum + value,
      0
    ) / numbers.length;

  const variance =
    numbers.reduce(
      (sum, value) =>
        sum + Math.pow(value - mean, 2),
      0
    ) / numbers.length;

  const stdDeviation =
    Math.sqrt(variance);

  return Number.isFinite(stdDeviation)
    ? stdDeviation
    : null;
}

// ============================================================
// MARKET STRUCTURE
//
// Simple structure model:
//
// BULLISH:
//   latest confirmed high > previous confirmed high
//   AND latest confirmed low >= previous confirmed low
//
// BEARISH:
//   latest confirmed high < previous confirmed high
//   AND latest confirmed low <= previous confirmed low
//
// If neither condition is cleanly satisfied,
// the engine uses the latest directional movement.
//
// This intentionally stays simple.
// ============================================================

function detectMarketStructure(candles) {
  if (
    !Array.isArray(candles) ||
    candles.length < 4
  ) {
    return 'N/A';
  }

  const recent = candles
    .slice(-20)
    .filter(
      (c) =>
        Number.isFinite(Number(c.high)) &&
        Number.isFinite(Number(c.low))
    );

  if (recent.length < 4) {
    return 'N/A';
  }

  const latest = recent[recent.length - 1];
  const previous = recent[recent.length - 2];

  const latestHigh = Number(latest.high);
  const latestLow = Number(latest.low);

  const previousHigh = Number(previous.high);
  const previousLow = Number(previous.low);

  if (
    latestHigh > previousHigh &&
    latestLow >= previousLow
  ) {
    return 'Bullish';
  }

  if (
    latestHigh < previousHigh &&
    latestLow <= previousLow
  ) {
    return 'Bearish';
  }

  /*
   * If the latest candle is mixed,
   * compare its close with the previous close.
   */

  const latestClose = Number(latest.close);
  const previousClose = Number(previous.close);

  if (
    Number.isFinite(latestClose) &&
    Number.isFinite(previousClose)
  ) {
    if (latestClose > previousClose) {
      return 'Bullish';
    }

    if (latestClose < previousClose) {
      return 'Bearish';
    }
  }

  return 'N/A';
}

// ============================================================
// CRT DETECTION
// ============================================================

/**
 * Standard two-candle CRT interpretation.
 *
 * Parent candle establishes the range.
 *
 * Signal candle sweeps the parent high/low
 * and closes back inside the range.
 *
 * The original behavior is intentionally preserved.
 */
export function detectCRT(
  candles,
  options = {}
) {
  const minBodyRatio =
    Number(
      options.minBodyRatio ?? 0
    );

  const requireCloseInside =
    options.requireCloseInside !== false;

  const useCloseDirection =
    options.useCloseDirection === true;

  if (
    !Array.isArray(candles) ||
    candles.length < 2
  ) {
    return null;
  }

  const parent =
    candles[candles.length - 2];

  const signal =
    candles[candles.length - 1];

  if (!parent || !signal) {
    return null;
  }

  const parentHigh =
    toNumber(parent.high);

  const parentLow =
    toNumber(parent.low);

  const high =
    toNumber(signal.high);

  const low =
    toNumber(signal.low);

  const open =
    toNumber(signal.open);

  const close =
    toNumber(signal.close);

  if (
    [
      parentHigh,
      parentLow,
      high,
      low,
      open,
      close,
    ].some(
      (value) => value === null
    )
  ) {
    return null;
  }

  const range =
    parentHigh - parentLow;

  if (range <= 0) {
    return null;
  }

  const bodyRatio =
    Math.abs(close - open) /
    range;

  if (
    bodyRatio <
    minBodyRatio
  ) {
    return null;
  }

  // ==========================================================
  // LIQUIDITY SWEEP
  // ==========================================================

  const sweptLow =
    low < parentLow;

  const sweptHigh =
    high > parentHigh;

  // ==========================================================
  // CLOSE BACK INSIDE CRT RANGE
  // ==========================================================

  const closedInside =
    close >= parentLow &&
    close <= parentHigh;

  let direction = null;
  let fractalType = null;
  let fractalPrice = null;

  // ==========================================================
  // BOTTOM FRACTAL / LOW SWEEP
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
      direction = 'BUY';

      /*
       * The swept low is the fractal price.
       */
      fractalType = 'BOTTOM';

      fractalPrice = low;
    }
  }

  // ==========================================================
  // TOP FRACTAL / HIGH SWEEP
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
        direction === null
      ) {
        direction = 'SELL';

        /*
         * The swept high is the fractal price.
         */
        fractalType = 'TOP';

        fractalPrice = high;
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

    signalHigh: high,
    signalLow: low,
    signalClose: close,

    sweptLow,
    sweptHigh,

    closedInside,

    candleTime:
      signal.openTime,

    // ========================================================
    // NEW FRACTAL INFORMATION
    // ========================================================

    fractalType,

    fractalPrice,

    // ========================================================
    // CRT CONFIRMATION
    // ========================================================

    confirmedCRT: true,
  };
}

// ============================================================
// BUILD SIGNAL
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
  // VALIDATE CLOSED CANDLES
  // ==========================================================

  const closedCandles =
    Array.isArray(candles)
      ? candles.filter(
          (c) =>
            c.closed !== false
        )
      : [];

  if (
    closedCandles.length <
    Math.max(
      20,
      rsiPeriod + 2
    )
  ) {
    return null;
  }

  // ==========================================================
  // DETECT CRT
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
  // RSI
  // ==========================================================

  const closes =
    closedCandles
      .map((c) => Number(c.close))
      .filter(Number.isFinite);

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
    detectMarketStructure(
      closedCandles
    );

  // ==========================================================
  // STANDARD DEVIATION
  //
  // Use the recent closed candles.
  // 20 candles is enough to keep this responsive
  // while avoiding excessive historical influence.
  // ==========================================================

  const stdWindow =
    closedCandles
      .slice(-20)
      .map(
        (c) => Number(c.close)
      )
      .filter(
        Number.isFinite
      );

  const stdDeviation =
    calculateStdDeviation(
      stdWindow
    );

  // ==========================================================
  // SIGNAL STRENGTH
  // ==========================================================

  const strength =
    (
      crt.direction === 'BUY' &&
      rsiState === 'OVERSOLD'
    ) ||
    (
      crt.direction === 'SELL' &&
      rsiState === 'OVERBOUGHT'
    )
      ? 'STRONG'
      : 'STANDARD';

  // ==========================================================
  // SIGNAL ID
  //
  // Includes candle time and direction so the same confirmed
  // CRT candle is not repeatedly alerted by the monitor.
  // ==========================================================

  const id =
    `${market}:${symbol}:${timeframe}:${crt.candleTime}:${crt.direction}`;

  // ==========================================================
  // FINAL SIGNAL
  // ==========================================================

  return {
    // ========================================================
    // CORE
    // ========================================================

    id,

    symbol,

    market,

    timeframe,

    direction,

    strength,

    // ========================================================
    // PRICE
    //
    // Kept internally for compatibility.
    // crtService does NOT display this as Signal Price.
    // ========================================================

    price:
      crt.signalClose,

    // ========================================================
    // RSI
    // ========================================================

    rsi,

    rsiState,

    // ========================================================
    // CANDLE TIME
    // ========================================================

    candleTime:
      crt.candleTime,

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

    // ========================================================
    // SWEEP INFORMATION
    // ========================================================

    sweptLow:
      crt.sweptLow,

    sweptHigh:
      crt.sweptHigh,

    // ========================================================
    // FRACTAL INFORMATION
    //
    // TOP:
    //   signal high swept liquidity
    //
    // BOTTOM:
    //   signal low swept liquidity
    // ========================================================

    fractalType:
      crt.fractalType,

    fractalPrice:
      crt.fractalPrice,

    // ========================================================
    // MARKET STRUCTURE
    //
    // FIXES:
    // Market Structure = N/A
    // ========================================================

    marketStructure,

    structure:
      marketStructure,

    market_structure:
      marketStructure,

    // ========================================================
    // STANDARD DEVIATION
    //
    // FIXES:
    // STD Deviation = N/A
    // ========================================================

    stdDeviation,

    stdDev:
      stdDeviation,

    standardDeviation:
      stdDeviation,

    // ========================================================
    // CRT CONFIRMATION
    // ========================================================

    confirmedCRT:
      true,

    crtConfirmed:
      true,

    confirmed:
      true,

    // ========================================================
    // ORIGINAL CRT SWEEP FLAGS
    // ========================================================

    crtSweep: {
      high:
        crt.sweptHigh,

      low:
        crt.sweptLow,
    },
  };
}
