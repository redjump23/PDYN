import { EmbedBuilder } from 'discord.js';
import botConfig from '../../config/bot.js';
import { buildSignal } from './crtEngine.js';
import { getKlines, getSpotSymbols, getFuturesContracts, getConfiguredSymbols } from './mexcService.js';
import { isNewSignal } from './signalManager.js';

const CRT_CONFIG = botConfig.crt || {};
const TIMEFRAMES = CRT_CONFIG.timeframes || { '5m': 5, '15m': 15, '30m': 30, '1h': 60, '4h': 240, '1d': 1440 };
const CHANNELS = CRT_CONFIG.channels || {};
const MARKET_TYPES = String(CRT_CONFIG.markets || 'spot,futures').split(',').map((x) => x.trim()).filter(Boolean);
const SCAN_INTERVAL = Math.max(15000, Number(CRT_CONFIG.scanInterval || 30000));
const KLINE_LIMIT = Math.max(30, Number(CRT_CONFIG.klineLimit || 100));
const MAX_SYMBOLS = Math.max(1, Number(CRT_CONFIG.maxSymbolsPerMarket || 30));
const RSI_PERIOD = Number(CRT_CONFIG.rsi?.period || 14);
const OVERSOLD = Number(CRT_CONFIG.rsi?.oversold || 30);
const OVERBOUGHT = Number(CRT_CONFIG.rsi?.overbought || 70);
const AUTO_SYMBOLS = CRT_CONFIG.autoSymbols !== false;

let monitorStarted = false;
let scanRunning = false;
let cachedSymbols = new Map();
let lastSymbolRefresh = 0;

function timeframeLabel(tf) {
  return ({ '5m': '5 MINUTES', '15m': '15 MINUTES', '30m': '30 MINUTES', '1h': '1 HOUR', '4h': '4 HOURS', '1d': 'DAILY' })[tf] || tf;
}

function fmtPrice(value) {
  if (!Number.isFinite(value)) return 'N/A';
  if (Math.abs(value) >= 1000) return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (Math.abs(value) >= 1) return value.toLocaleString('en-US', { maximumFractionDigits: 5 });
  return value.toLocaleString('en-US', { maximumSignificantDigits: 7 });
}

function fmtRSI(value) {
  return value == null ? 'N/A' : value.toFixed(2);
}

function signalColor(signal) {
  if (signal.direction === 'BUY') return 0x57f287;
  return 0xed4245;
}

function createSignalEmbed(signal) {
  const emoji = signal.direction === 'BUY' ? '🟢' : '🔴';
  const strength = signal.strength === 'STRONG' ? 'STRONG ' : '';
  return new EmbedBuilder()
    .setTitle(`${emoji} ${strength}CRT ${signal.direction}`)
    .setDescription(`**${signal.symbol}** • ${timeframeLabel(signal.timeframe)}`)
    .addFields(
      { name: '📌 Signal Price', value: `[0;32m${fmtPrice(signal.price)}[0m`, inline: true },
      { name: '📊 RSI(14)', value: `[0;33m${fmtRSI(signal.rsi)}[0m`, inline: true },
      { name: 'RSI State', value: `[0;36m${signal.rsiState}[0m`, inline: true },
      { name: 'CRT High', value: `[0;37m${fmtPrice(signal.parentHigh)}[0m`, inline: true },
      { name: 'CRT Low', value: `[0;37m${fmtPrice(signal.parentLow)}[0m`, inline: true },
      { name: 'Market', value: `[0;37m${signal.market.toUpperCase()}[0m`, inline: true },
    )
    .setColor(signalColor(signal))
    .setFooter({ text: 'CRT • PDYN • MEXC' })
    .setTimestamp(new Date(signal.candleTime));
}

async function sendSignal(client, signal) {
  const channelId = CHANNELS[signal.timeframe];
  if (!channelId) {
    console.warn(`[CRT] No Discord channel configured for ${signal.timeframe}`);
    return;
  }

  const channel = await client.channels.fetch(channelId);
  if (!channel || typeof channel.send !== 'function') return;

  const emoji = signal.direction === 'BUY' ? '🟢' : '🔴';
  await channel.send({
    content: `${emoji} **${signal.strength === 'STRONG' ? 'STRONG ' : ''}CRT ${signal.direction}** • ${signal.symbol} • ${signal.timeframe}`,
    embeds: [createSignalEmbed(signal)],
  });
}

function filterSymbols(symbols, market) {
  const configured = getConfiguredSymbols(market);
  if (configured.length) return configured.slice(0, MAX_SYMBOLS);

  const quote = String(CRT_CONFIG.quoteAsset || 'USDT').toUpperCase();
  const filtered = symbols.filter((s) => {
    const symbol = typeof s === 'string' ? s : s.symbol;
    if (!symbol) return false;
    if (market === 'futures') return String(s.quoteCoin || '').toUpperCase() === quote || symbol.endsWith(`_${quote}`);
    return symbol.endsWith(quote);
  });
  return filtered.slice(0, MAX_SYMBOLS).map((s) => typeof s === 'string' ? s : s.symbol);
}

async function refreshSymbols(force = false) {
  const ttl = Number(CRT_CONFIG.symbolRefreshMs || 15 * 60 * 1000);
  if (!force && Date.now() - lastSymbolRefresh < ttl && cachedSymbols.size) return;

  for (const market of MARKET_TYPES) {
    try {
      if (market === 'futures') {
        const contracts = await getFuturesContracts();
        cachedSymbols.set(market, filterSymbols(contracts, market));
      } else {
        const symbols = await getSpotSymbols();
        cachedSymbols.set(market, filterSymbols(symbols, market));
      }
      console.log(`[CRT] ${market} symbols: ${(cachedSymbols.get(market) || []).join(', ')}`);
    } catch (error) {
      console.error(`[CRT] Failed to refresh ${market} symbols:`, error.message);
    }
  }
  lastSymbolRefresh = Date.now();
}

async function scanSymbol(client, market, symbol, timeframe) {
  try {
    const candles = await getKlines({ market, symbol, timeframe, limit: KLINE_LIMIT });
    // Never use the still-forming candle for a confirmed signal.
    const closed = candles.filter((c) => c.closed && Number.isFinite(c.close));
    if (closed.length < RSI_PERIOD + 2) return;

    const signal = buildSignal({
      symbol,
      market,
      timeframe,
      candles: closed,
      rsiPeriod: RSI_PERIOD,
      oversold: OVERSOLD,
      overbought: OVERBOUGHT,
      crtOptions: {
        requireCloseInside: CRT_CONFIG.requireCloseInside !== false,
        useCloseDirection: CRT_CONFIG.useCloseDirection === true,
        minBodyRatio: Number(CRT_CONFIG.minBodyRatio || 0),
      },
    });

    if (!signal || !isNewSignal(signal.id)) return;
    await sendSignal(client, signal);
    console.log(`[CRT] ${signal.direction} ${signal.strength} ${market}:${symbol} ${timeframe} @ ${signal.price} RSI=${signal.rsi}`);
  } catch (error) {
    console.error(`[CRT] Scan failed ${market}:${symbol}:${timeframe}:`, error.message);
  }
}

async function scanAll(client) {
  if (scanRunning) return;
  scanRunning = true;
  try {
    await refreshSymbols();

    // Sequential requests are intentional to stay well below MEXC rate limits.
    for (const timeframe of Object.keys(TIMEFRAMES)) {
      for (const market of MARKET_TYPES) {
        const symbols = cachedSymbols.get(market) || [];
        for (const symbol of symbols) {
          await scanSymbol(client, market, symbol, timeframe);
        }
      }
    }
  } finally {
    scanRunning = false;
  }
}

export function startCRTMonitor(client) {
  if (monitorStarted) return;
  if (CRT_CONFIG.enabled === false || CRT_CONFIG.autoAlerts === false) {
    console.log('[CRT] Signal monitor disabled by configuration.');
    return;
  }
  if (!client) throw new Error('Discord client is required for CRT monitor');

  monitorStarted = true;
  console.log('[CRT] Signal monitor started.');
  console.log(`[CRT] Markets: ${MARKET_TYPES.join(', ')}`);
  console.log(`[CRT] Timeframes: ${Object.keys(TIMEFRAMES).join(', ')}`);
  console.log(`[CRT] Scan interval: ${SCAN_INTERVAL}ms; max symbols/market: ${MAX_SYMBOLS}`);

  void scanAll(client);
  setInterval(() => void scanAll(client), SCAN_INTERVAL);
}

export async function scanCRTNow(client) {
  await scanAll(client);
}

export function getCRTConfig() {
  return {
    markets: MARKET_TYPES,
    timeframes: Object.keys(TIMEFRAMES),
    scanInterval: SCAN_INTERVAL,
    maxSymbolsPerMarket: MAX_SYMBOLS,
    rsi: { period: RSI_PERIOD, oversold: OVERSOLD, overbought: OVERBOUGHT },
  };
}

console.log(`[CRT] Service loaded • ${Object.keys(TIMEFRAMES).join(', ')}`);
