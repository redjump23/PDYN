// ============================================================
// PDYN MEXC SERVICE
// ============================================================
//
// PURPOSE:
//
// Central MEXC market-data service.
//
// MARKETS:
//
//   SPOT
//   FUTURES
//
// CRT USES:
//
//   FUTURES
//
// CRT TIMEFRAMES:
//
//   5m
//   15m
//   1h
//   4h
//   1d
//
// 30m remains supported here for compatibility with other
// services, but CRT top-down does NOT use 30m.
//
// ============================================================

// ============================================================
// BASE URLS
// ============================================================

const SPOT_BASE_URL = (
  process.env.MEXC_SPOT_BASE_URL ||
  "https://api.mexc.com"
).replace(/\/+$/, "");

const FUTURES_BASE_URL = (
  process.env.MEXC_FUTURES_BASE_URL ||
  process.env.MEXC_FUTURES_API_URL ||
  "https://api.mexc.com"
).replace(/\/+$/, "");

// ============================================================
// TIMEFRAMES
// ============================================================

const INTERVALS = {
  "5m": {
    spot: "5m",
    futures: "Min5",
  },

  "15m": {
    spot: "15m",
    futures: "Min15",
  },

  "30m": {
    spot: "30m",
    futures: "Min30",
  },

  "1h": {
    spot: "60m",
    futures: "Min60",
  },

  "4h": {
    spot: "4h",
    futures: "Hour4",
  },

  "1d": {
    spot: "1d",
    futures: "Day1",
  },
};

// ============================================================
// ASSERT TIMEFRAME
// ============================================================

function assertTimeframe(timeframe) {
  if (!INTERVALS[timeframe]) {
    throw new Error(
      `Unsupported MEXC timeframe: ${timeframe}`
    );
  }
}

// ============================================================
// REQUEST JSON
// ============================================================

async function requestJson(
  url,
  options = {}
) {
  const controller =
    new AbortController();

  const timeout =
    setTimeout(
      () =>
        controller.abort(),
      Number(
        process.env.MEXC_HTTP_TIMEOUT_MS
      ) || 10000
    );

  try {
    const response =
      await fetch(
        url,
        {
          ...options,

          signal:
            controller.signal,

          headers: {
            Accept:
              "application/json",

            "User-Agent":
              "PDYN-MEXC-Service/1.0",

            ...(options.headers || {}),
          },
        }
      );

    const text =
      await response.text();

    let data;

    try {
      data =
        text
          ? JSON.parse(text)
          : null;
    } catch {
      throw new Error(
        `MEXC returned non-JSON (${response.status})`
      );
    }

    if (!response.ok) {
      throw new Error(
        `MEXC HTTP ${response.status}: ${JSON.stringify(
          data
        )}`
      );
    }

    return data;
  } finally {
    clearTimeout(timeout);
  }
}

// ============================================================
// NORMALIZE SPOT KLINES
// ============================================================

function normalizeSpotKlines(rows) {
  if (!Array.isArray(rows)) {
    return [];
  }

  return rows
    .map((row) => {
      const openTime =
        Number(row?.[0]);

      const open =
        Number(row?.[1]);

      const high =
        Number(row?.[2]);

      const low =
        Number(row?.[3]);

      const close =
        Number(row?.[4]);

      const volume =
        Number(row?.[5] || 0);

      const closeTime =
        Number(row?.[6]);

      return {
        openTime,

        timestamp:
          openTime,

        open,
        high,
        low,
        close,
        volume,

        closeTime,

        closed:
          Number.isFinite(
            closeTime
          )
            ? closeTime <=
              Date.now()
            : true,
      };
    })
    .filter(
      (candle) =>
        Number.isFinite(
          candle.openTime
        ) &&
        Number.isFinite(
          candle.open
        ) &&
        Number.isFinite(
          candle.high
        ) &&
        Number.isFinite(
          candle.low
        ) &&
        Number.isFinite(
          candle.close
        )
    );
}

// ============================================================
// NORMALIZE FUTURES KLINES
// ============================================================

function normalizeFuturesKlines(
  data,
  timeframe
) {
  const times =
    Array.isArray(data?.time)
      ? data.time
      : [];

  const opens =
    Array.isArray(data?.open)
      ? data.open
      : [];

  const highs =
    Array.isArray(data?.high)
      ? data.high
      : [];

  const lows =
    Array.isArray(data?.low)
      ? data.low
      : [];

  const closes =
    Array.isArray(data?.close)
      ? data.close
      : [];

  const volumes =
    Array.isArray(data?.vol)
      ? data.vol
      : [];

  const intervalMs = {
    "5m":
      5 *
      60 *
      1000,

    "15m":
      15 *
      60 *
      1000,

    "30m":
      30 *
      60 *
      1000,

    "1h":
      60 *
      60 *
      1000,

    "4h":
      4 *
      60 *
      60 *
      1000,

    "1d":
      24 *
      60 *
      60 *
      1000,
  }[timeframe];

  if (!intervalMs) {
    return [];
  }

  return times
    .map(
      (time, index) => {
        const openTime =
          Number(time) *
          1000;

        const closeTime =
          openTime +
          intervalMs -
          1;

        return {
          openTime,

          timestamp:
            openTime,

          open:
            Number(
              opens[index]
            ),

          high:
            Number(
              highs[index]
            ),

          low:
            Number(
              lows[index]
            ),

          close:
            Number(
              closes[index]
            ),

          volume:
            Number(
              volumes[index] || 0
            ),

          closeTime,

          closed:
            closeTime <=
            Date.now(),
        };
      }
    )
    .filter(
      (candle) =>
        Number.isFinite(
          candle.openTime
        ) &&
        Number.isFinite(
          candle.open
        ) &&
        Number.isFinite(
          candle.high
        ) &&
        Number.isFinite(
          candle.low
        ) &&
        Number.isFinite(
          candle.close
        )
    );
}

// ============================================================
// GET SPOT KLINES
// ============================================================

export async function getSpotKlines(
  symbol,
  timeframe,
  limit = 100
) {
  assertTimeframe(
    timeframe
  );

  const safeLimit =
    Math.min(
      Math.max(
        Number(limit) || 100,
        1
      ),
      1000
    );

  const normalizedSymbol =
    String(symbol || "")
      .trim()
      .toUpperCase();

  if (!normalizedSymbol) {
    throw new Error(
      "MEXC spot symbol is required."
    );
  }

  const params =
    new URLSearchParams({
      symbol:
        normalizedSymbol,

      interval:
        INTERVALS[
          timeframe
        ].spot,

      limit:
        String(safeLimit),
    });

  const data =
    await requestJson(
      `${SPOT_BASE_URL}/api/v3/klines?${params}`
    );

  if (!Array.isArray(data)) {
    throw new Error(
      `Unexpected spot kline response for ${symbol}`
    );
  }

  return normalizeSpotKlines(
    data
  );
}

// ============================================================
// GET FUTURES KLINES
// ============================================================

export async function getFuturesKlines(
  symbol,
  timeframe,
  limit = 100
) {
  assertTimeframe(
    timeframe
  );

  const safeLimit =
    Math.min(
      Math.max(
        Number(limit) || 100,
        1
      ),
      1000
    );

  const interval =
    INTERVALS[
      timeframe
    ].futures;

  const normalizedSymbol =
    String(symbol || "")
      .trim()
      .toUpperCase();

  if (!normalizedSymbol) {
    throw new Error(
      "MEXC futures symbol is required."
    );
  }

  const params =
    new URLSearchParams({
      interval,

      limit:
        String(safeLimit),
    });

  const data =
    await requestJson(
      `${FUTURES_BASE_URL}/api/v1/contract/kline/` +
      `${encodeURIComponent(
        normalizedSymbol
      )}?${params}`
    );

  if (
    !data?.success ||
    !data?.data
  ) {
    throw new Error(
      `Unexpected futures kline response for ${symbol}`
    );
  }

  return normalizeFuturesKlines(
    data.data,
    timeframe
  );
}

// ============================================================
// GET GENERIC KLINES
// ============================================================

export async function getKlines({
  market,
  symbol,
  timeframe,
  limit = 100,
}) {
  if (
    String(market)
      .toLowerCase() ===
    "futures"
  ) {
    return getFuturesKlines(
      symbol,
      timeframe,
      limit
    );
  }

  return getSpotKlines(
    symbol,
    timeframe,
    limit
  );
}

// ============================================================
// GET SPOT SYMBOLS
// ============================================================

export async function getSpotSymbols() {
  const data =
    await requestJson(
      `${SPOT_BASE_URL}/api/v3/exchangeInfo`
    );

  const symbols =
    Array.isArray(
      data?.symbols
    )
      ? data.symbols
      : [];

  return symbols
    .filter((item) => {
      return (
        item?.status ===
          "ENABLED" ||
        item?.isSpotTradingAllowed ===
          true
      );
    })
    .map(
      (item) =>
        item?.symbol
    )
    .filter(Boolean);
}

// ============================================================
// GET FUTURES CONTRACTS
// ============================================================

export async function getFuturesContracts() {
  const data =
    await requestJson(
      `${FUTURES_BASE_URL}/api/v1/contract/detail`
    );

  if (
    !data?.success ||
    !Array.isArray(
      data?.data
    )
  ) {
    throw new Error(
      "Unexpected futures contract response"
    );
  }

  return data.data.filter(
    (contract) =>
      Boolean(
        contract?.symbol
      )
  );
}

// ============================================================
// GET FUTURES SYMBOLS
// ============================================================

export async function getFuturesSymbols() {
  const contracts =
    await getFuturesContracts();

  return contracts
    .filter((contract) => {
      const symbol =
        String(
          contract?.symbol ||
            ""
        )
          .trim()
          .toUpperCase();

      const quote =
        String(
          contract?.quoteCoin ||
            ""
        )
          .trim()
          .toUpperCase();

      const settle =
        String(
          contract?.settleCoin ||
            ""
        )
          .trim()
          .toUpperCase();

      return (
        Boolean(symbol) &&
        (
          quote === "USDT" ||
          settle === "USDT" ||
          symbol.endsWith(
            "_USDT"
          ) ||
          symbol.endsWith(
            "USDT"
          )
        )
      );
    })
    .map(
      (contract) =>
        String(
          contract.symbol
        )
          .trim()
          .toUpperCase()
    )
    .filter(Boolean);
}

// ============================================================
// CONFIGURED SYMBOLS
// ============================================================

export function getConfiguredSymbols(
  market
) {
  const key =
    String(market)
      .toLowerCase() ===
    "futures"
      ? "MEXC_FUTURES_SYMBOLS"
      : "MEXC_SPOT_SYMBOLS";

  return String(
    process.env[key] || ""
  )
    .split(",")
    .map(
      (symbol) =>
        symbol.trim()
    )
    .filter(Boolean);
}

// ============================================================
// SERVICE INFO
// ============================================================

export function getMexcServiceInfo() {
  return {
    spotBaseUrl:
      SPOT_BASE_URL,

    futuresBaseUrl:
      FUTURES_BASE_URL,

    futuresTimeframes: [
      "5m",
      "15m",
      "1h",
      "4h",
      "1d",
    ],

    topDownTimeframes: [
      "1d",
      "4h",
      "1h",
      "15m",
    ],

    lowerTimeframe:
      "5m",

    compatibilityTimeframes: [
      "30m",
    ],

    removedCRTTimeframes: [
      "30m",
    ],
  };
}

// ============================================================
// EXPORT INTERVALS
// ============================================================

export {
  INTERVALS,
};

// ============================================================
// STARTUP
// ============================================================

console.log(
  "[MEXC] MEXC service loaded."
);

console.log(
  `[MEXC] Spot API: ${SPOT_BASE_URL}`
);

console.log(
  `[MEXC] Futures API: ${FUTURES_BASE_URL}`
);

console.log(
  "[MEXC] CRT intervals: 1D, 4H, 1H, 15M, 5M"
);

console.log(
  "[MEXC] 30M: compatibility only, NOT used by CRT"
);
