import { calculateRSI, getRSIState } from './rsi.js';

/**
 * Standard two-candle CRT interpretation.
 *
 * Parent candle establishes the range.
 * Signal candle sweeps the parent high/low and closes back inside the range.
 *
 * This is intentionally configurable because the uploaded sources do not
 * contain Rachel_T's proprietary indicator source, so exact parity cannot be
 * guaranteed without that source/script.
 */
export function detectCRT(candles, options = {}) {
  const minBodyRatio = Number(options.minBodyRatio ?? 0);
  const requireCloseInside = options.requireCloseInside !== false;
  const useCloseDirection = options.useCloseDirection === true;

  if (!Array.isArray(candles) || candles.length < 2) return null;

  const parent = candles[candles.length - 2];
  const signal = candles[candles.length - 1];

  if (!parent || !signal) return null;

  const parentHigh = Number(parent.high);
  const parentLow = Number(parent.low);
  const high = Number(signal.high);
  const low = Number(signal.low);
  const open = Number(signal.open);
  const close = Number(signal.close);

  if (![parentHigh, parentLow, high, low, open, close].every(Number.isFinite)) return null;

  const range = parentHigh - parentLow;
  if (range <= 0) return null;

  const bodyRatio = Math.abs(close - open) / range;
  if (bodyRatio < minBodyRatio) return null;

  const sweptLow = low < parentLow;
  const sweptHigh = high > parentHigh;
  const closedInside = close >= parentLow && close <= parentHigh;

  let direction = null;

  if (sweptLow && (!requireCloseInside || closedInside)) {
    if (!useCloseDirection || close >= open) direction = 'BUY';
  }

  if (sweptHigh && (!requireCloseInside || closedInside)) {
    if (!useCloseDirection || close <= open) {
      if (direction === null) direction = 'SELL';
    }
  }

  if (!direction) return null;

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
    candleTime: signal.openTime,
  };
}

export function buildSignal({ symbol, market, timeframe, candles, rsiPeriod = 14, oversold = 30, overbought = 70, crtOptions = {} }) {
  const closedCandles = candles.filter((c) => c.closed !== false);
  if (closedCandles.length < Math.max(20, rsiPeriod + 2)) return null;

  const crt = detectCRT(closedCandles, crtOptions);
  const closes = closedCandles.map((c) => Number(c.close));
  const rsi = calculateRSI(closes, rsiPeriod);
  const rsiState = getRSIState(rsi, oversold, overbought);

  if (!crt) return null;

  const strength =
    (crt.direction === 'BUY' && rsiState === 'OVERSOLD') ||
    (crt.direction === 'SELL' && rsiState === 'OVERBOUGHT')
      ? 'STRONG'
      : 'STANDARD';

  return {
    id: `${market}:${symbol}:${timeframe}:${crt.candleTime}:${crt.direction}`,
    symbol,
    market,
    timeframe,
    direction: crt.direction,
    strength,
    price: crt.signalClose,
    rsi,
    rsiState,
    candleTime: crt.candleTime,
    parentHigh: crt.parentHigh,
    parentLow: crt.parentLow,
    signalHigh: crt.signalHigh,
    signalLow: crt.signalLow,
    closedInside: crt.closedInside,
  };
}
