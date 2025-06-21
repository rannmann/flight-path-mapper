const asyncLib = require('async');
const fs = require('fs');
const zlib = require("zlib");
const {Worker, isMainThread, parentPort, workerData} = require('worker_threads');
const Aircraft = require('./lib/aircraft');
const Geo = require('./lib/geo');
const path = require("path");
const os = require("os");
const config = require('./config');
const logger = require('./lib/logger');

if (isMainThread) {
    // Main thread
    const run = async () => {
        const CONCURRENCY_LIMIT = Math.min(config.processing.workerThreads || 4, Math.round(os.cpus().length / 1.8));
        const directory = path.join(config.paths.flightHistory, config.defaultDate);

        if (!fs.existsSync(directory)) {
            logger.error('Flight history directory not found', { directory });
            process.exit(1);
        }

        const filesInDir = fs.readdirSync(directory).filter(f => f.endsWith('.json.gz'));

        // Use fewer files for testing, all files for production
        const TEST_MODE = process.env.TEST_MODE === 'true';
        const filesToProcess = TEST_MODE ? filesInDir.slice(0, 500) : filesInDir;

        logger.info('Starting heatmap generation', {
            totalFiles: filesInDir.length,
            processingFiles: filesToProcess.length,
            testMode: TEST_MODE,
            concurrency: CONCURRENCY_LIMIT
        });

        let workerDataList = [];
        let processedFiles = 0;

        await new Promise((resolve, reject) => {
            asyncLib.eachLimit(filesToProcess, CONCURRENCY_LIMIT, (file, cb) => {
                const worker = new Worker(__filename, {workerData: path.join(directory, file)});

                const timeout = setTimeout(() => {
                    logger.warn(`Worker timeout for ${file} - terminating`);
                    worker.terminate();
                    cb();
                }, 30000);

                worker.on('message', workerData => {
                    clearTimeout(timeout);
                    workerDataList.push(workerData);
                    processedFiles++;

                    if (processedFiles % 100 === 0) {
                        logger.progress(processedFiles, filesToProcess.length, 'Processing files');
                    }
                });

                worker.on('exit', () => {
                    clearTimeout(timeout);
                    cb();
                });

                worker.on('error', err => {
                    clearTimeout(timeout);
                    logger.warn(`Worker error for ${file}`, { error: err.message });
                    cb();
                });
            }, (err) => {
                if (!err) resolve();
                else reject(err);
            });
        });

        logger.info('All workers complete, processing results for all cities...');

        const allWorkerResults = workerDataList;

        // Process each configured city
        for (const [cityKey, cityCoords] of Object.entries(config.cities)) {
            logger.info(`Aggregating grid data for ${cityKey}...`);

            const aircraft = new Aircraft(cityCoords.lat, cityCoords.lon);
            let grid = {};

            // Process worker results in batches to manage memory
            const batchSize = 2000; // Process 2000 worker results at a time

            for (let i = 0; i < allWorkerResults.length; i += batchSize) {
                const batch = allWorkerResults.slice(i, i + batchSize);

                logger.info(`Processing batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(allWorkerResults.length/batchSize)} for ${cityKey}`);

                // The grid being returned is only for 1 file.
                // We need to add all the grids together to get the final grid.
                batch.forEach((workerData, batchIndex) => {
                    // Each worker returns results for all cities, get this city's grid
                    const workerGrid = workerData[cityKey] || {};

                    for (let key in workerGrid) {
                        if (grid[key]) {
                            // Combining the total loudness
                            grid[key].totalLoudness += workerGrid[key].totalLoudness;
                        } else {
                            // Making sure we are adding valid entries into the grid only
                            if (workerGrid[key] && workerGrid[key].centralLat != null && workerGrid[key].centralLon != null) {
                                grid[key] = workerGrid[key];
                            }
                        }
                    }
                });

                // Force garbage collection if available
                if (global.gc && i > 0 && i % (batchSize * 2) === 0) {
                    global.gc();
                    logger.info(`Memory cleanup completed for ${cityKey}`);
                }
            }

            logger.info(`Grid aggregation complete for ${cityKey}`, { gridSize: Object.keys(grid).length });

            try {
                // Create output directory
                const outputDir = path.join(__dirname, 'data', 'heatmaps');
                if (!fs.existsSync(outputDir)) {
                    fs.mkdirSync(outputDir, { recursive: true });
                }

                // Convert grid to degrees and save
                let heatmapData = aircraft.convertGridBackToDegrees(grid);

                // Sort by intensity and limit for web performance
                heatmapData.sort((a, b) => b[2] - a[2]);
                const maxPoints = TEST_MODE ? 5000 : 50000; // Limit points for web performance
                if (heatmapData.length > maxPoints) {
                    logger.info(`Limiting ${cityKey} heatmap to top ${maxPoints} points (was ${heatmapData.length})`);
                    heatmapData = heatmapData.slice(0, maxPoints);
                }

                logger.info(`Heatmap data stats for ${cityKey}`, {
                    totalPoints: heatmapData.length,
                    maxLoudness: heatmapData.length > 0 ? Math.max(...heatmapData.map(p => p[2])) : 0,
                    minLoudness: heatmapData.length > 0 ? Math.min(...heatmapData.map(p => p[2])) : 0
                });

                // Save city-specific heatmap using streaming approach for large datasets
                const cityHeatmapPath = path.join(outputDir, `${cityKey}_heatmap.json`);

                // Use streaming write for large datasets to avoid call stack overflow
                const writeStream = fs.createWriteStream(cityHeatmapPath);
                writeStream.write('[');

                for (let i = 0; i < heatmapData.length; i++) {
                    if (i > 0) writeStream.write(',');
                    writeStream.write(JSON.stringify(heatmapData[i]));
                }

                writeStream.write(']');
                writeStream.end();

                // Wait for write to complete
                await new Promise((resolve, reject) => {
                    writeStream.on('finish', resolve);
                    writeStream.on('error', reject);
                });

                logger.info(`Heatmap generation complete for ${cityKey}`, {
                    outputFile: cityHeatmapPath,
                    fileSize: `${(fs.statSync(cityHeatmapPath).size / 1024).toFixed(1)} KB`,
                    dataPoints: heatmapData.length
                });

            } catch (err) {
                logger.error(`Failed to save heatmap data for ${cityKey}`, err);
                console.error(err);
            }
        }

        // Save metadata about all heatmaps
        try {
            const metadataFile = path.join(__dirname, 'data', 'heatmaps', 'metadata.json');
            const metadata = {
                generated: new Date().toISOString(),
                dataDate: config.defaultDate,
                cities: Object.keys(config.cities),
                radiusInMiles: config.defaultRadii[0] || 60,
                testMode: TEST_MODE,
                processedFiles: filesToProcess.length,
                gridSystemType: '1km equal-area grid',
                algorithm: 'sound area distribution',
                note: 'Generated using 1km equal-area grid with sound area distribution algorithm'
            };

            fs.writeFileSync(metadataFile, JSON.stringify(metadata, null, 2));
            logger.info('Metadata saved', { metadataFile });
        } catch (err) {
            logger.warn('Failed to save metadata', err);
        }

        console.log('\\n✅ Heatmap generation complete for all cities!');
        console.log(`📊 Generated heatmaps for ${Object.keys(config.cities).length} cities`);
        console.log(`📁 Output directory: data/heatmaps/`);
        console.log(`🌐 View at: http://localhost:3000/heatmap.html`);
    };

    run().catch(error => {
        logger.error('Heatmap generation failed', { error: error.message, stack: error.stack });
        console.error('\\n❌ Heatmap generation failed:', error.message);
        process.exit(1);
    });
} else {
    // Worker
    const processFile = async fileName => {
        try {
            const gunzip = zlib.createGunzip();
            const fileContent = fs.createReadStream(fileName).pipe(gunzip);
            let dataString = '';

            for await (const chunk of fileContent) {
                dataString += chunk.toString();
            }

            const data = JSON.parse(dataString);
            if (!data.aircraft || !Array.isArray(data.aircraft)) {
                return {};
            }

            const planes = data.aircraft;

            // Pre-filter aircraft that have valid coordinates
            const validPlanes = planes.filter(plane => plane.lat && plane.lon);

            // Process all configured cities
            const cityGrids = {};

            for (const [cityKey, cityCoords] of Object.entries(config.cities)) {
                const aircraft = new Aircraft(cityCoords.lat, cityCoords.lon);
                const radiusInMiles = config.defaultRadii[0] || 60; // Use first radius from config

                // Pre-filter planes within radius for this city (performance optimization)
                const planesInRange = validPlanes.filter(plane =>
                    Geo.distanceInMiles(plane.lat, plane.lon, cityCoords.lat, cityCoords.lon) < radiusInMiles
                );

                // Make a new grid for this city
                let grid = {};

                // Process planes and generate grid (only planes already filtered to be in range)
                planesInRange.forEach(plane => {
                    aircraft.addLoudnessToGrid(plane, grid);
                });

                cityGrids[cityKey] = grid;
            }

            // Return grids for all cities
            return cityGrids;

        } catch (error) {
            // Handle corrupt files
            if (error.code === 'Z_BUF_ERROR' || error.code === 'Z_DATA_ERROR' ||
                error.message.includes('unexpected end of file') ||
                error.message.includes('Unexpected end of JSON input')) {
                console.log(`Deleting corrupt file: ${fileName}`);
                try {
                    fs.unlinkSync(fileName);
                    console.log(`Successfully deleted corrupt file: ${fileName}`);
                } catch (deleteError) {
                    console.error(`Failed to delete corrupt file ${fileName}:`, deleteError.message);
                }
            }
            return {};
        }
    };

    processFile(workerData).then((resultGrid) => {
        parentPort.postMessage(resultGrid);
    }).catch((error) => {
        console.error('Worker error:', error);
        parentPort.postMessage({});
    });
}
