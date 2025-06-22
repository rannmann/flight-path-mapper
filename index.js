const zlib = require('zlib');
const fs = require('fs');
const path = require('path');
const {Worker, isMainThread, parentPort, workerData} = require('worker_threads');
const async = require('async');
const os = require('os');
const config = require('./config');

// Get configuration from centralized config
const LIGHTWEIGHT_MODE = config.processing.lightweightMode;
const GENERATOR_COORDINATES = config.cities;
const radii = config.defaultRadii;

/**
 * Function to calculate distance between two geographical coordinates.
 *
 * @param lat1
 * @param lon1
 * @param lat2
 * @param lon2
 * @returns {number}
 */
function distance(lat1, lon1, lat2, lon2) {
    let R = 3958.8; // Radius of the earth in miles
    let φ1 = toRadians(lat1);
    let φ2 = toRadians(lat2);
    let Δφ = toRadians(lat2 - lat1);
    let Δλ = toRadians(lon2 - lon1);

    let a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
        Math.cos(φ1) * Math.cos(φ2) *
        Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    let c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
}

/**
 * Function to convert degrees to radians.
 *
 * @param degrees
 * @returns {number}
 */
function toRadians(degrees) {
    return degrees * Math.PI / 180;
}

/**
 * Function to check if a geographical coordinate is within a given radius.
 * Returns an object with a boolean for each city.
 *
 * @param lat
 * @param lon
 * @param radius
 * @returns {{}}
 */
function isWithinRadius(lat, lon, radius) {
    let result = {};

    for (const city in GENERATOR_COORDINATES) {
        result[city] = distance(GENERATOR_COORDINATES[city].lat, GENERATOR_COORDINATES[city].lon, lat, lon) <= radius;
    }

    return result;
}

if (isMainThread) {
    async function main() {
        // Use config for concurrency control
        const CONCURRENCY_LIMIT = config.processing.workerThreads || Math.round(os.cpus().length / 2);
        const directory = path.join(config.paths.flightHistory, config.defaultDate);
        const files = fs.readdirSync(directory);

        let flightPaths = {};

        for (const city in GENERATOR_COORDINATES) {
            flightPaths[city] = {};
            radii.forEach(radius => {
                flightPaths[city][radius] = {};
            });
        }

        let i = 0;
        async.eachLimit(files, CONCURRENCY_LIMIT, (file, done) => {
            if (LIGHTWEIGHT_MODE && i++ % 2 === 0) {
                console.log(`Skipping ${file}`);
                done();
                return;
            }
            processFile(path.join(directory, file))
                .then(result => {
                    for (const city in result) {
                        radii.forEach(radius => {
                            Object.keys(result[city][radius]).forEach(hex => {
                                if (!flightPaths[city][radius][hex]) {
                                    flightPaths[city][radius][hex] = result[city][radius][hex];
                                } else {
                                    flightPaths[city][radius][hex].geometry.coordinates.push(...result[city][radius][hex].geometry.coordinates);
                                }
                            });
                        });
                    }

                    console.log(`Processed ${file}`);
                    done();
                })
                .catch(error => {
                    console.error(`Error processing ${file}: ${error}`);
                    done();
                });
        }, err => {
            if (err) console.error(err);

            for (const city in flightPaths) {
                radii.forEach(radius => {
                    const outFile = path.join(config.paths.flightPaths, `${city}_${radius}_miles.json`);
                    fs.writeFileSync(outFile, JSON.stringify({
                        type: 'FeatureCollection',
                        features: Object.values(flightPaths[city][radius]),
                    }));
                    console.log(`Flight paths for ${city} at ${radius} miles radius written to ${outFile}`);
                });
            }
        });
    }

    main().catch(console.error);

} else {
    let dataString = '';
    let file = workerData;
    let flightPaths = {};

    for (const city in GENERATOR_COORDINATES) {
        flightPaths[city] = {};
        radii.forEach(radius => {
            flightPaths[city][radius] = {};
        });
    }

    const gunzip = zlib.createGunzip();
    const stream = fs.createReadStream(file).pipe(gunzip);

    stream.on('data', chunk => {
        dataString += chunk.toString();
    });

    stream.on('end', () => {
        try {
            // Process file for each radius
            radii.forEach(radius => {
                const data = JSON.parse(dataString);

                if (data.aircraft && Array.isArray(data.aircraft)) {
                    data.aircraft.forEach(plane => {
                        if (plane.lat && plane.lon) {
                            let cityRadius = isWithinRadius(plane.lat, plane.lon, radius);

                            for (const city in cityRadius) {
                                if (cityRadius[city]) {
                                    if (!flightPaths[city]) flightPaths[city] = {};
                                    if (!flightPaths[city][radius]) flightPaths[city][radius] = {};
                                    if (!flightPaths[city][radius][plane.hex]) {
                                        flightPaths[city][radius][plane.hex] = {
                                            type: 'Feature',
                                            geometry: { type: 'LineString', coordinates: [] }
                                        };
                                    }

                                    flightPaths[city][radius][plane.hex].geometry.coordinates.push([plane.lon, plane.lat]);
                                }
                            }
                        }
                    });
                }
            });

            parentPort.postMessage(flightPaths);
        } catch (error) {
            console.error(`Worker JSON parsing error for ${file}:`, error);
            
            // Check if it's a JSON parsing error indicating corruption
            if (error.message.includes('Unexpected end of JSON input') || 
                error.message.includes('Unexpected token') ||
                error.name === 'SyntaxError') {
                console.log(`Deleting file with corrupt JSON: ${file}`);
                try {
                    const fs = require('fs');
                    fs.unlinkSync(file);
                    console.log(`Successfully deleted corrupt JSON file: ${file}`);
                } catch (deleteError) {
                    console.error(`Failed to delete corrupt JSON file ${file}:`, deleteError.message);
                }
            }
            
            // Send empty result
            parentPort.postMessage({});
        }
    });

    stream.on('error', err => {
        console.error(`Worker stream error for ${file}:`, err);
        
        // Check if it's a corrupt file error
        if (err.code === 'Z_BUF_ERROR' || err.code === 'Z_DATA_ERROR' || err.message.includes('unexpected end of file')) {
            console.log(`Deleting corrupt file: ${file}`);
            try {
                const fs = require('fs');
                fs.unlinkSync(file);
                console.log(`Successfully deleted corrupt file: ${file}`);
            } catch (deleteError) {
                console.error(`Failed to delete corrupt file ${file}:`, deleteError.message);
            }
        }
        
        // Send empty result instead of throwing
        parentPort.postMessage({});
    });
}

function processFile(file) {
    return new Promise((resolve, reject) => {
        const worker = new Worker(__filename, {
            workerData: file
        });
        worker.on('message', resolve);
        worker.on('error', reject);
        worker.on('exit', (code) => {
            if (code !== 0) {
                reject(new Error(`Worker stopped with exit code ${code}`));
            }
        })
    });
}
