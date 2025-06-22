const path = require('path');

const config = {
  // Server configuration
  server: {
    port: process.env.PORT || 3000,
    host: process.env.HOST || 'localhost'
  },

  // Data processing configuration
  processing: {
    // Reduces granularity by skipping every-other file (10s vs 5s intervals)
    lightweightMode: process.env.LIGHTWEIGHT_MODE === 'true' || false,
    // Concurrent downloads limit
    concurrencyLimit: parseInt(process.env.CONCURRENCY_LIMIT) || 10,
    // Worker thread count (defaults to CPU count)
    workerThreads: parseInt(process.env.WORKER_THREADS) || require('os').cpus().length
  },

  // Paths configuration
  paths: {
    flightHistory: process.env.FLIGHT_HISTORY_DIR || 'data/flight-history',
    flightPaths: process.env.FLIGHT_PATHS_DIR || 'data/flightpaths',
    aircraftData: process.env.AIRCRAFT_DATA_FILE || 'data/airplanes.json'
  },

  // Default date for historical data (YYYY-MM-DD)
  defaultDate: process.env.DEFAULT_DATE || '2023-09-01',

  // Default radii for flight path generation (in miles)
  defaultRadii: process.env.DEFAULT_RADII ?
    process.env.DEFAULT_RADII.split(',').map(r => parseInt(r.trim())) :
    [80],

  // City coordinates for flight path generation
  cities: {
    'CAN_Toronto': {lat: 43.6532, lon: -79.3832},
    'DE_Berlin': {lat: 52.5200, lon: 13.4050},
    'FRA_Paris': {lat: 48.8566, lon: 2.3522},
    'JPN_Tokyo': {lat: 35.6762, lon: 139.6503},
    'GBR_London': {lat: 51.5074, lon: -0.1278},
    'GBR_Manchester': {lat: 53.4808, lon: -2.2426},
    'USA_AK_Anchorage': {lat: 61.2181, lon: -149.9003},
    'USA_AZ_Phoenix': {lat: 33.4484, lon: -112.0740},
    'USA_CA_LosAngeles': {lat: 34.0522, lon: -118.2437},
    'USA_CO_Denver': {lat: 39.7392, lon: -104.9903},
    'USA_FL_Miami': {lat: 25.7617, lon: -80.1918},
    'USA_GA_Atlanta': {lat: 33.7490, lon: -84.3880},
    'USA_IL_Chicago': {lat: 41.8781, lon: -87.6298},
    'USA_MA_Boston': {lat: 42.3601, lon: -71.0589},
    'USA_TX_Dallas': {lat: 32.7767, lon: -96.7970},
    'USA_WA_Seattle': {lat: 47.6062, lon: -122.3321},
  },

  // ADS-B Exchange configuration
  adsbExchange: {
    baseUrl: 'https://samples.adsbexchange.com/readsb-hist',
    // Date format: YYYY/MM/DD
    getDatePath: (date) => {
      const d = new Date(date + 'T00:00:00'); // Avoid timezone issues
      return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
    }
  }
};

module.exports = config;
