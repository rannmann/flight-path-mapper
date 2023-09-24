const zlib = require('zlib');
const fs = require('fs');
const path = require('path');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const async = require('async');
const os = require('os');

//const SEATTLE_COORDINATES = {lat: 47.6097, lon: -122.3331};  // Seattle coordinates
//const ANCHORAGE_AK_COORDINATES = {lat: 61.2181, lon: -149.9003};  // Anchorage, AK coordinates
const BELLINGHAM_WA_COORDINATES = {lat: 48.7519, lon: -122.4787};  // Bellingham, WA coordinates

const SEARCH_COORDINATES = BELLINGHAM_WA_COORDINATES;
let radii = [10, 20, 40, 60];  // Array of Radii in miles to generate multiple paths in one iteration.

// Object to hold flight paths
let flightPaths = {};

// Initialize flightPaths object for each radius
radii.forEach(radius => {
    flightPaths[radius] = {};
});

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
 *
 * @param lat
 * @param lon
 * @param radius
 * @returns {boolean}
 */
function isWithinRadius(lat, lon, radius) {
    return distance(SEARCH_COORDINATES.lat, SEARCH_COORDINATES.lon, lat, lon) <= radius;
}
if(isMainThread) {
    async function main() {
        const CONCURRENCY_LIMIT = os.cpus().length;
        const directory = 'flight-history/2023-09-01';
        const files = fs.readdirSync(directory);

        let flightPaths = {};

        radii.forEach(radius => {
            flightPaths[radius] = {};
        });

        async.eachLimit(files, CONCURRENCY_LIMIT, (file, done) => {
            processFile(path.join(directory, file))
                .then(result => {
                    radii.forEach(radius => {
                        Object.keys(result[radius]).forEach(hex => {
                            if(!flightPaths[radius][hex]) {
                                flightPaths[radius][hex] = result[radius][hex];
                            } else {
                                flightPaths[radius][hex].geometry.coordinates.push(...result[radius][hex].geometry.coordinates);
                            }
                        });
                    });

                    console.log(`Processed ${file}`);
                    done();
                })
                .catch(error => {
                    console.error(`Error processing ${file}: ${error}`);
                    done();
                });
        }, err => {
            if(err) console.error(err);

            radii.forEach(radius => {
                const outFile = `./flightPaths_${radius}_miles.json`;
                fs.writeFileSync(outFile, JSON.stringify({
                    type: 'FeatureCollection',
                    features: Object.values(flightPaths[radius]),
                }));
                console.log(`Flight paths for ${radius} miles radius written to ${outFile}`);
            });
        });
    }

    main().catch(console.error);

} else {
    let dataString = '';
    let file = workerData;
    let flightPaths = {};

    radii.forEach(radius => {
        flightPaths[radius] = {};
    });

    const gunzip = zlib.createGunzip();
    const stream = fs.createReadStream(file).pipe(gunzip);

    stream.on('data', chunk => {
        dataString += chunk.toString();
    });

    stream.on('end', () => {
        // Process file for each radius
        radii.forEach(radius => {
            const data = JSON.parse(dataString);
            data.aircraft
                .filter(plane => isWithinRadius(plane.lat, plane.lon, radius))
                .forEach(plane => {
                    if (!flightPaths[radius][plane.hex]) {
                        flightPaths[radius][plane.hex] = {
                            type: 'Feature',
                            geometry: {
                                type: 'LineString',
                                coordinates: []
                            }
                        };
                    }
                    flightPaths[radius][plane.hex].geometry.coordinates.push([plane.lon, plane.lat]);
                });
        });
        parentPort.postMessage(flightPaths);
    });

    stream.on('error', err => {
        throw err;
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
            if(code !== 0) {
                reject(new Error(`Worker stopped with exit code ${code}`));
            }
        })
    });
}