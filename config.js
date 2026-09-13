const os = require('os');

function intEnv(name, fallback) {
  const v = parseInt(process.env[name], 10);
  return Number.isFinite(v) ? v : fallback;
}

const config = {
  // Web server (serves the static site in paths.site)
  server: {
    port: intEnv('PORT', 3000),
    host: process.env.HOST || 'localhost'
  },

  processing: {
    // Flight paths only: read every other snapshot (10 s instead of 5 s)
    lightweightMode: process.env.LIGHTWEIGHT_MODE === 'true',
    // Concurrent HTTP downloads
    concurrencyLimit: Math.max(1, intEnv('CONCURRENCY_LIMIT', 10)),
    // Worker threads for the noise and flight path generators
    workerThreads: Math.max(1, intEnv('WORKER_THREADS', os.cpus().length - 2))
  },

  // All paths are relative to the repository root
  paths: {
    flightHistory: 'data/flight-history', // <date>/HHMMSSZ.json.gz snapshots
    flightPaths: 'data/flightpaths',      // per-city GeoJSON
    terrain: 'data/terrain',              // elevation.bin / airports.json
    noise: 'data/noise',                  // <date>/<layer>/*.tiles energy grids
    tiles: 'data/tiles',                  // rendered Web Mercator metatiles
    site: 'docs'                          // static site, GitHub Pages root
  },

  // Day of ADS-B Exchange sample data to process (YYYY-MM-DD)
  defaultDate: process.env.DEFAULT_DATE || '2023-09-01',

  // Radii (miles) for the per-city flight path product
  defaultRadii: process.env.DEFAULT_RADII
    ? process.env.DEFAULT_RADII.split(',').map(r => parseInt(r.trim(), 10)).filter(Number.isFinite)
    : [80],

  // Cities for the flight path product. Key style: <ISO country>_<region>_<Name>.
  cities: {
    'ARE_Dubai': { lat: 25.2048, lon: 55.2708 },
    'AUS_Sydney': { lat: -33.8688, lon: 151.2093 },
    'BRA_SaoPaulo': { lat: -23.5505, lon: -46.6333 },
    'CAN_Toronto': { lat: 43.6532, lon: -79.3832 },
    'DE_Berlin': { lat: 52.5200, lon: 13.4050 },
    'DE_Frankfurt': { lat: 50.1109, lon: 8.6821 },
    'FRA_Paris': { lat: 48.8566, lon: 2.3522 },
    'GBR_London': { lat: 51.5074, lon: -0.1278 },
    'GBR_Manchester': { lat: 53.4808, lon: -2.2426 },
    'HKG_HongKong': { lat: 22.3193, lon: 114.1694 },
    'IND_Mumbai': { lat: 19.0760, lon: 72.8777 },
    'JPN_Tokyo': { lat: 35.6762, lon: 139.6503 },
    'MEX_MexicoCity': { lat: 19.4326, lon: -99.1332 },
    'NLD_Amsterdam': { lat: 52.3676, lon: 4.9041 },
    'SGP_Singapore': { lat: 1.3521, lon: 103.8198 },
    'USA_AK_Anchorage': { lat: 61.2181, lon: -149.9003 },
    'USA_AZ_Phoenix': { lat: 33.4484, lon: -112.0740 },
    'USA_CA_LosAngeles': { lat: 34.0522, lon: -118.2437 },
    'USA_CO_Denver': { lat: 39.7392, lon: -104.9903 },
    'USA_FL_Miami': { lat: 25.7617, lon: -80.1918 },
    'USA_GA_Atlanta': { lat: 33.7490, lon: -84.3880 },
    'USA_IL_Chicago': { lat: 41.8781, lon: -87.6298 },
    'USA_MA_Boston': { lat: 42.3601, lon: -71.0589 },
    'USA_TX_Dallas': { lat: 32.7767, lon: -96.7970 },
    'USA_WA_Seattle': { lat: 47.6062, lon: -122.3321 },
    'ZAF_Johannesburg': { lat: -26.2041, lon: 28.0473 }
  },

  adsbExchange: {
    baseUrl: 'https://samples.adsbexchange.com/readsb-hist',
    // 'YYYY-MM-DD' -> 'YYYY/MM/DD'
    getDatePath: (date) => {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
      if (!m) throw new Error(`Invalid date "${date}", expected YYYY-MM-DD`);
      return `${m[1]}/${m[2]}/${m[3]}`;
    }
  },

  // Inputs for scripts/prepare-terrain.py, fetched by `npm run download:terrain`
  terrain: {
    sources: [
      'https://www.ngdc.noaa.gov/thredds/fileServer/global/ETOPO2022/60s/60s_surface_elev_netcdf/ETOPO_2022_v1_60s_N90W180_surface.nc',
      'https://davidmegginson.github.io/ourairports-data/airports.csv'
    ]
  }
};

module.exports = config;
