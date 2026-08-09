// ============================================================
// PDYN BOT CONFIGURATION
// ============================================================
//
// CRT SIGNAL ENGINE
//
// CRYPTO
//   → MEXC FUTURES ONLY
//
// FOREX / METALS
//   → OANDA
//
// SIGNAL LOGIC
//   → Rachel T Filtered Top
//   → Rachel T Filtered Bottom
//
// DISCORD OUTPUT
//   → BUY / SELL
//   → Signal Price
//   → RSI
//   → OVERBOUGHT / OVERSOLD / NEUTRAL
//
// ============================================================


export default {

  // ==========================================================
  // BOT SETTINGS
  // ==========================================================

  bot: {

    prefix:
      process.env.BOT_PREFIX ||
      "!",

  },


  // ==========================================================
  // DISCORD CHANNELS
  // ==========================================================

  channels: {

    main:
      process.env.MAIN_CHANNEL_ID ||
      "",

    announcements:
      process.env.ANNOUNCEMENTS_CHANNEL_ID ||
      "",

    signals:
      process.env.SIGNALS_CHANNEL_ID ||
      "",

  },


  // ==========================================================
  // CRT TRADING SETTINGS
  // ==========================================================

  crt: {

    // --------------------------------------------------------
    // ENABLE CRT
    // --------------------------------------------------------

    enabled:
      true,


    // --------------------------------------------------------
    // AUTOMATIC SIGNALS
    // --------------------------------------------------------

    autoAlerts:
      true,


    // --------------------------------------------------------
    // TIMEZONE
    // --------------------------------------------------------

    timezone:
      "Asia/Manila",


    // --------------------------------------------------------
    // TIMEFRAMES
    // --------------------------------------------------------
    //
    // These are processed independently.
    //
    // 5M
    // 15M
    // 30M
    // 1H
    // 4H
    // 1D
    //
    // --------------------------------------------------------

    timeframes: {

      "5m":
        5,

      "15m":
        15,

      "30m":
        30,

      "1h":
        60,

      "4h":
        240,

      "1d":
        1440,

    },


    // ========================================================
    // MARKET INSTRUMENTS
    // ========================================================
    //
    // IMPORTANT:
    //
    // CRYPTO:
    //   MEXC FUTURES ONLY
    //
    // FOREX / METALS:
    //   OANDA
    //
    // DO NOT PUT XAU_USDT HERE.
    //
    // XAUUSD is an OANDA instrument.
    //
    // --------------------------------------------------------
    //
    // To add crypto later:
    //
    // {
    //   market: "crypto",
    //   symbol: "BTCUSDT",
    //   display: "BTCUSDT.P",
    // },
    //
    // MEXC Futures will resolve the actual contract.
    //
    // To add Forex:
    //
    // {
    //   market: "forex",
    //   symbol: "EURUSD",
    //   display: "EURUSD",
    // },
    //
    // ========================================================

    instruments: [

      // ------------------------------------------------------
      // GOLD
      // ------------------------------------------------------
      //
      // OANDA:
      // XAUUSD → XAU_USD
      //
      // ------------------------------------------------------

      {
        market:
          "forex",

        symbol:
          "XAUUSD",

        display:
          "XAUUSD",
      },


      // ------------------------------------------------------
      // ADD MORE OANDA FOREX PAIRS HERE
      // ------------------------------------------------------
      //
      // Example:
      //
      // {
      //   market: "forex",
      //   symbol: "EURUSD",
      //   display: "EURUSD",
      // },
      //
      // {
      //   market: "forex",
      //   symbol: "GBPUSD",
      //   display: "GBPUSD",
      // },
      //
      // {
      //   market: "forex",
      //   symbol: "USDJPY",
      //   display: "USDJPY",
      // },
      //
      // ------------------------------------------------------


      // ------------------------------------------------------
      // ADD MEXC FUTURES CRYPTO HERE
      // ------------------------------------------------------
      //
      // Example:
      //
      // {
      //   market: "crypto",
      //   symbol: "BTCUSDT",
      //   display: "BTCUSDT.P",
      // },
      //
      // {
      //   market: "crypto",
      //   symbol: "ETHUSDT",
      //   display: "ETHUSDT.P",
      // },
      //
      // {
      //   market: "crypto",
      //   symbol: "SOLUSDT",
      //   display: "SOLUSDT.P",
      // },
      //
      // MEXC Futures contract discovery is handled by
      // crtService.js.
      //
      // ------------------------------------------------------

    ],


    // ========================================================
    // DISCORD CRT CHANNELS
    // ========================================================
    //
    // Each timeframe has its own channel.
    //
    // ========================================================

    channels: {

      "5m":
        "1536085497087135795",

      "15m":
        "1536085573691773060",

      "30m":
        "1536085618981871648",

      "1h":
        "1536085667216367728",

      "4h":
        "1536085721192857600",

      "1d":
        "1536085794576404480",

    },


    // ========================================================
    // SCAN INTERVAL
    // ========================================================
    //
    // Check every 5 seconds.
    //
    // This does NOT mean a signal is sent every 5 seconds.
    //
    // The service only sends when a NEW CLOSED candle is
    // detected and a NEW Rachel fractal signal is confirmed.
    //
    // ========================================================

    checkInterval:
      5000,


    // ========================================================
    // RACHEL FRACTAL MODE
    // ========================================================
    //
    // false = Bill Williams fractal
    //
    // true = Regular fractal
    //
    // Rachel source defaults to:
    //
    // filterBW = false
    //
    // Therefore this stays FALSE.
    //
    // ========================================================

    filterBW:
      false,


    // ========================================================
    // RSI SETTINGS
    // ========================================================
    //
    // RSI is DISPLAY ONLY.
    //
    // It does NOT override the CRT signal.
    //
    // ========================================================

    rsi: {

      period:
        14,

      overbought:
        70,

      oversold:
        30,

    },


    // ========================================================
    // SIGNAL SETTINGS
    // ========================================================

    signal: {

      // ------------------------------------------------------
      // Only these two Rachel conditions are enabled.
      // ------------------------------------------------------

      filteredTop:
        true,

      filteredBottom:
        true,


      // ------------------------------------------------------
      // Signal price
      // ------------------------------------------------------
      //
      // Uses the CLOSE of the confirmed fractal candle.
      //
      // ------------------------------------------------------

      priceSource:
        "close",

    },


    // ========================================================
    // MARKET DATA PROVIDERS
    // ========================================================
    //
    // These values are informational/configuration values.
    //
    // crtService.js performs the actual API requests.
    //
    // ========================================================

    providers: {

      crypto: {

        name:
          "MEXC FUTURES",

        api:
          "https://contract.mexc.com",

        spot:
          false,

      },


      forex: {

        name:
          "OANDA",

        environment:
          process.env.OANDA_ENVIRONMENT ||
          "live",

      },

    },


    // ========================================================
    // OANDA SETTINGS
    // ========================================================
    //
    // Credentials MUST come from Railway environment
    // variables.
    //
    // DO NOT put API keys in this file.
    //
    // Railway:
    //
    // OANDA_API_KEY
    // OANDA_ACCOUNT_ID
    // OANDA_ENVIRONMENT
    //
    // ========================================================

    oanda: {

      apiKey:
        process.env.OANDA_API_KEY ||
        "",

      accountId:
        process.env.OANDA_ACCOUNT_ID ||
        "",

      environment:
        process.env.OANDA_ENVIRONMENT ||
        "live",

    },


    // ========================================================
    // MEXC SETTINGS
    // ========================================================
    //
    // No API key is required for public Futures candle and
    // contract information used by the CRT scanner.
    //
    // IMPORTANT:
    //
    // This is FUTURES only.
    //
    // ========================================================

    mexc: {

      futuresOnly:
        true,

      spotEnabled:
        false,

      api:
        "https://contract.mexc.com",

    },


    // ========================================================
    // DISCORD MESSAGE SETTINGS
    // ========================================================
    //
    // The user-facing message intentionally does NOT display:
    //
    // - Rachel T
    // - Filtered Top Fractal
    // - Filtered Bottom Fractal
    //
    // ========================================================

    message: {

      showProvider:
        false,

      showFractalName:
        false,

      showRachelName:
        false,

      showSignalPrice:
        true,

      showRSI:
        true,

      showRSIState:
        true,

    },


    // ========================================================
    // EMBED COLORS
    // ========================================================

    colors: {

      buy:
        "#57F287",

      sell:
        "#ED4245",

      neutral:
        "#5865F2",

    },


    // ========================================================
    // FOOTER
    // ========================================================

    footer:
      "CRT • PDYN",

  },


  // ==========================================================
  // OTHER BOT FEATURES
  // ==========================================================
  //
  // Keep your other existing configuration sections below
  // this point if your project uses them.
  //
  // If your current bot.js contains additional settings
  // required by other services, DO NOT delete those sections.
  //
  // ==========================================================


};
