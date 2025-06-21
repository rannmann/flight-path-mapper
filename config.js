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
    flightHistory: process.env.FLIGHT_HISTORY_DIR || 'flight-history',
    flightPaths: process.env.FLIGHT_PATHS_DIR || 'flightpaths',
    aircraftData: process.env.AIRCRAFT_DATA_FILE || 'lib/airplanes.json'
  },

  // Default date for historical data (YYYY-MM-DD)
  defaultDate: process.env.DEFAULT_DATE || '2023-09-01',

  // Default radii for flight path generation (in miles)
  defaultRadii: process.env.DEFAULT_RADII ?
    process.env.DEFAULT_RADII.split(',').map(r => parseInt(r.trim())) :
    [20],

  // City coordinates for flight path generation
  cities: {
    //'GBR_London': {lat: 51.5074, lon: -0.1278},
    //'GBR_Manchester': {lat: 53.4808, lon: -2.2426},
    //'USA_AZ_Phoenix': {lat: 33.4484, lon: -112.0740},
    //'USA_CA_LosAngeles': {lat: 34.0522, lon: -118.2437},
    //'USA_CO_Denver': {lat: 39.7392, lon: -104.9903},
    //'USA_FL_Miami': {lat: 25.7617, lon: -80.1918},
    //'USA_GA_Atlanta': {lat: 33.7490, lon: -84.3880},
    //'USA_IL_Chicago': {lat: 41.8781, lon: -87.6298},
    //'USA_MA_Boston': {lat: 42.3601, lon: -71.0589},
    //'USA_MD_Baltimore': {lat: 39.2904, lon: -76.6122},
    //'USA_TX_Dallas': {lat: 32.7767, lon: -96.7970},
    'USA_WA_Seattle': {lat: 47.6062, lon: -122.3321},
    //'USA_WA_Tacoma': {lat: 47.2529, lon: -122.4443}
  },

  // ADS-B Exchange configuration
  adsbExchange: {
    baseUrl: 'https://samples.adsbexchange.com/readsb-hist',
    // Date format: YYYY/MM/DD
    getDatePath: (date) => {
      const d = new Date(date + 'T00:00:00'); // Avoid timezone issues
      return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
    }
  },

  // Heatmap configuration
  heatmap: {
    gridSize: parseFloat(process.env.HEATMAP_GRID_SIZE) || 0.001, // degrees
    maxRadius: parseFloat(process.env.HEATMAP_MAX_RADIUS) || 10, // miles
    noiseFactor: parseFloat(process.env.NOISE_FACTOR) || 1.0
  }
};

module.exports = config;
