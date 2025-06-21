# Flight Path Mapper

A comprehensive Node.js application for downloading, processing, and visualizing global flight data with aircraft noise analysis capabilities.

## Features

- **Flight Data Processing**: Download 24 hours of global flight data from ADS-B Exchange
- **Interactive Visualizations**: 
  - Flight path mapping with customizable city radius filters
  - Aircraft noise heatmap visualization
- **Multi-threaded Processing**: Efficient parallel processing using Worker Threads
- **Web Interface**: Modern, responsive frontend with real-time status updates
- **Configurable**: Environment-based configuration system
- **Logging**: Comprehensive logging system with file output

## Quick Start

### Prerequisites

- Node.js 14+ 
- ~20GB free disk space (for flight data)

### Installation

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd flight-path-mapper
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Create required directories:
   ```bash
   npm run setup
   ```

4. Start the web server:
   ```bash
   npm start
   ```

5. Open your browser to `http://localhost:3000`

## Usage

### 1. Download Flight Data

Download historical flight data (warning: ~16GB download):

```bash
npm run download
```

This downloads compressed JSON files containing aircraft position data from ADS-B Exchange for September 1, 2023.

### 2. Process Flight Paths

Generate flight path GeoJSON files for configured cities:

```bash
npm run process
```

This creates flight path files in the `flightpaths/` directory.

### 3. Generate Noise Heatmaps

Create aircraft noise analysis (work in progress):

```bash
npm run heatmap
```

### 4. View Results

Access the web interface at `http://localhost:3000`:

- **Flight Paths**: `http://localhost:3000/` - Interactive map with flight path overlays
- **Noise Heatmap**: `http://localhost:3000/heatmap.html` - Aircraft noise visualization

## Configuration

The application uses a centralized configuration system. You can customize settings through environment variables or by editing `config.js`:

### Environment Variables

```bash
# Server configuration
PORT=3000
HOST=localhost

# Processing options
LIGHTWEIGHT_MODE=false         # Skip every other file (10s vs 5s plane location intervals)
CONCURRENCY_LIMIT=10           # Download concurrency
WORKER_THREADS=4               # Processing threads

# Paths
FLIGHT_HISTORY_DIR=flight-history
FLIGHT_PATHS_DIR=flightpaths

# Data options
DEFAULT_DATE=2023-09-01
DEFAULT_RADII=20,60            # Miles from city center

# Heatmap options
HEATMAP_GRID_SIZE=0.001        # Grid resolution in degrees
HEATMAP_MAX_RADIUS=10          # Noise propagation radius
NOISE_FACTOR=1.0               # Noise calculation multiplier

# Logging
LOG_LEVEL=INFO                 # ERROR, WARN, INFO, DEBUG
```

### Adding Cities

Edit the `cities` object in `config.js` to add new locations or change radius:

```javascript
cities: {
  'USA_TX_Austin': {lat: 30.2672, lon: -97.7431},
  'FRA_Lyon': {lat: 45.7640, lon: 4.8357}
}
```

## API Endpoints

The web server provides several API endpoints:

- `GET /listflightpaths` - List available flight path files
- `GET /api/config` - Get client configuration
- `GET /api/status` - Server status and statistics
- `GET /flightpaths/<filename>` - Download flight path GeoJSON

## Architecture

### Data Pipeline

1. **Download** (`download.js`) - Fetch compressed flight data from ADS-B Exchange
2. **Process** (`index.js`) - Multi-threaded processing to generate flight paths
3. **Serve** (`webserver.js`) - HTTP server with API endpoints
4. **Visualize** (`index.html`, `heatmap.html`) - Interactive web interfaces

### Key Files

```
├── config.js              # Centralized configuration
├── download.js             # Data download script
├── index.js               # Main processing engine
├── sound-heatmap.js       # Noise heatmap generator (WIP)
├── webserver.js           # HTTP server
├── index.html             # Flight path visualization
├── heatmap.html           # Noise heatmap visualization
├── lib/
│   ├── logger.js          # Logging utilities
│   ├── aircraft.js        # Aircraft noise calculations
│   └── airplanes.json     # Aircraft database
├── flightpaths/           # Generated GeoJSON files
├── flight-history/        # Downloaded flight data
└── logs/                  # Application logs
```

## Development

### Available Scripts

```bash
npm start          # Start web server
npm run dev        # Start web server (alias)
npm run download   # Download flight data
npm run process    # Process flight paths
npm run heatmap    # Generate noise heatmap
npm run clean      # Remove generated files
npm run setup      # Create required directories
```

### Development Mode

For development with auto-restart:

```bash
npm install -g nodemon
nodemon webserver.js
```

### Memory Considerations

- Multi-threading duplicates memory usage
- Reduce `WORKER_THREADS` or `CONCURRENCY_LIMIT` if encountering memory issues
- Use `LIGHTWEIGHT_MODE=true` to reduce data processing load

## Data Sources

- **Flight Data**: [ADS-B Exchange](https://www.adsbexchange.com/) historical data
- **Aircraft Database**: IATA/ICAO aircraft specifications
- **Maps**: OpenStreetMap via Leaflet.js

## Limitations

- **Data Size**: Requires significant disk space (~16GB+ for full dataset)
- **Processing Time**: Full data processing takes 15+ minutes
- **Single Date**: Currently configured for September 1, 2023 data

## Data Quality Features

- **Automatic Corruption Detection**: The system automatically detects and removes corrupt flight data files during processing
- **Error Recovery**: Processing continues even when encountering bad files, ensuring robust operation
- **Cleanup Logging**: All file deletions are logged for transparency and debugging

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

This project is licensed under the ISC License.

## Troubleshooting

### Common Issues

**Server won't start:**
- Check if port 3000 is available
- Run `npm run setup` to create required directories

**Download fails:**
- Check internet connection
- Verify ADS-B Exchange availability
- Try reducing `CONCURRENCY_LIMIT`

**Processing takes too long:**
- Enable `LIGHTWEIGHT_MODE=true`
- Reduce the number of cities in config
- Decrease `WORKER_THREADS`

**Web interface shows no data:**
- Ensure you've run `npm run download` and `npm run process`
- Check the `flightpaths/` directory for generated files
- Verify the web server is running

### Logs

Application logs are written to the `logs/` directory. Check the current day's log file for detailed error information.
