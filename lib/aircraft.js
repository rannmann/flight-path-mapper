let aircraftsKeyedByType = {};

// Grid size in degrees.  This determines our precision.
// This is less-precise at the equator than at the poles.
// 0.001 degrees is about 111m at the equator.
// 0.01 degrees is about 1.11km at the equator.
// 0.1 degrees is about 11.1km at the equator.
// TODO: This gets far too precise at the poles, hopefully we don't have many planes there...
const GRID_SIZE_DEGREES = 0.01;
// WIP
const GRID_SIZE_KM = 1;

// Debug data
let sizeMatch = 0;
let typeMatch = 0;
let noMatch = 0;
let missingPlanes = {};

function init() {
    // Load aircraft data from file
    // Data created from: https://aviationstack.com/documentation#airplanes
    let aircraftsData = require('./airplanes.json');

    // Key aircraft data by type, dropping data we don't need.
    aircraftsData.forEach(aircraft => {
        if (!aircraft.engines_type) {
            // If we don't have an engine type, we can't use this data.
            return;
        }

        if (aircraft.iata_code_long in aircraftsKeyedByType) {
            // We've already seen this type, so we don't need to store it again.
            return;
        }

        aircraftsKeyedByType[aircraft.iata_code_long] = {
            //engines_count: aircraft.engines_count,
            engines_type: aircraft.engines_type,
            //plane_age: aircraft.plane_age,
        };
    });
    console.log(`Loaded ${Object.keys(aircraftsKeyedByType).length} aircraft types`);
}

function debugOutput() {
    // Output missing plane types ordered by values
    missingPlanes = Object.keys(missingPlanes).sort((a, b) => missingPlanes[b] - missingPlanes[a]).reduce(
        (obj, key) => {
            obj[key] = missingPlanes[key];
            return obj;
        }
        , {}
    );

    console.log("Missing plane types: " + JSON.stringify(missingPlanes));
    console.log("Size matches: " + sizeMatch);
    console.log("Type matches: " + typeMatch);
    console.log("No matches: " + noMatch);
}

// If we can't find it by hex, try to look it up by type
function getAircraftDataByType(type) {
    return aircraftsKeyedByType[type] || null;
}

function calculateLoudness(plane) {
    let speed = plane.gs;
    let altitude = plane.alt_baro;
    let geom_rate = plane.geom_rate;

    let fullEffectAltitude = 1000; // altitude where plane is at maximum loudness
    let maxSpeed = 575;
    let attenuation = altitude > fullEffectAltitude ? Math.exp(-(altitude - fullEffectAltitude) / 5000) : 1;
    let speedFactor = (1 - speed / maxSpeed);

    let sizeFactor = getSizeFactor(plane) ?? 1;

    let climbFactor = geom_rate > 0 ? 1.1 : 1;
    let maxLoudness = 120 * sizeFactor;

    let loudness = maxLoudness * speedFactor * attenuation * climbFactor;

    return loudness < 0 ? 0 : Math.min(120, loudness); // making sure loudness is within [0, 120]
}

// Function for calculating radius of noise based on altitude
function calculateSoundRadius(plane) {
    let altitude = plane.alt_baro;

    let fullEffectAltitude = 1000; // altitude where plane noise has the maximum radius
    let attenuation = altitude > fullEffectAltitude ? Math.exp(-(altitude - fullEffectAltitude) / 5000) : 1;

    let sizeFactor = getSizeFactor(plane) ?? 1;

    let maxRadius = 10 * sizeFactor;
    let radius = maxRadius * attenuation;

    return radius < 0 ? 0 : radius;
}

/**
 * Get the size factor for a plane, preferring category to type.
 *
 * @param plane
 * @returns {number|null}
 */
function getSizeFactor(plane) {
    // If there is no category or type, we can't calculate the size.
    if (!plane.category && !plane.t) {
        // Don't record stats on this since it's not our data that is missing.
        //console.log(plane);
        return null;
    }

    // Try category first
    let sizeFactor = getSizeFactorByCategory(plane.category);

    if (sizeFactor) {
        sizeMatch++;
        return sizeFactor;
    }

    // If we can't find it by category, try to look it up by type
    let aircraftData = getSizeFactoryByPlaneData(plane);

    if (aircraftData) {
        typeMatch++;
        return aircraftData;
    }
    noMatch++;
    missingPlanes[plane.t] = missingPlanes[plane.t] ? missingPlanes[plane.t] + 1 : 1;
    return null;
}

// Rather than fetching aircraft data based on the model name, the easiest way is
// to check the size of the aircraft based on reported transponder.
// https://www.adsbexchange.com/emitter-category-ads-b-do-260b-2-2-3-2-5-2/
function getSizeFactorByCategory(aircraftCategory) {
    switch (aircraftCategory) {
        // Light
        case 'A1':
            return 0.8;

        // Small
        case 'A2':
            return 1;

        // Large
        case 'A3':
            return 1.1;

        // Boeing 757
        case 'A4':
        // Heavy
        case 'A5':
            return 1.2;

        // > 5Gs
        case 'A6':
        // Helicopters
        case 'A7':
            return 1.4;

        // Gliders
        case 'B1':
        // Lighter than air
        case 'B2':
        // Parachutists
        case 'B3':
            return 0;

        // Ultralights
        case 'B4':
            return 0.1;

        // UAV
        case 'B6':
            return 1;

        // Spacecraft
        case 'B7':
            return 1.6;

        // Obstacles. Not sure why these would be reported.
        case 'C1':
        case 'C2':
        case 'C3':
        case 'C4':
        case 'C5':
            return 0;

        // Unknown
        default:
            // TODO: Fallback to fetch plane information.
            return null;
    }
}

/**
 * Get the size factor for a plane from the airplanes database.
 *
 * @param plane
 * @returns {number|null}
 */
function getSizeFactoryByPlaneData(plane) {
    let aircraftData = getAircraftDataByType(plane.t);
    if (!aircraftData) {
        return null;
    }

    if (aircraftData.engines_type === 'JET') {
        return 1.2;
    }

    // We can't make many assumptions about remaining aircraft, so we'll just
    // assume turboprops are small planes but not as small as a light aircraft.
    return 1;
}

//Function for adding loudness to grid
function addLoudnessToGrid(plane, grid) {
    return alternativeAddLoudnessToGrid(plane, grid);
    if (!plane.lat || !plane.lon) {
        // No location data, nothing to graph.
        return;
    }

    let loudness = calculateLoudness(plane);
    let radius = calculateSoundRadius(plane);
    let gridLon = Math.round(plane.lon / GRID_SIZE_DEGREES);
    let gridLat = Math.round(plane.lat / GRID_SIZE_DEGREES);

    for (let dx = -radius; dx <= radius; dx++) {
        for (let dy = -radius; dy <= radius; dy++) {
            let dist2 = dx * dx + dy * dy;
            if (dist2 <= radius * radius) {
                let key = `${gridLat + dx}_${gridLon + dy}`;

                grid[key] = grid[key] || 0;

                let actualDist = Math.sqrt(dist2 + Math.pow(plane.alt_baro / 3280.84, 2)); // Convert altitude from feet to
                                                                                           // grid units
                let decay = (actualDist <= 1) ? 1 : 1 / (actualDist * actualDist);

                grid[key] += loudness * decay;
            }
        }
    }
}

function alternativeAddLoudnessToGrid(plane, grid) {
    if (!plane.lat || !plane.lon) {
        // No location data, nothing to graph.
        return;
    }

    let loudness = calculateLoudness(plane);
    let radius = calculateSoundRadius(plane);
    let gridPos = roundToNearestKm(plane.lat, plane.lon);

    // each bin (grid) can impact several grids around it.
    // In this case, we don't want to add the bleed data to the spatial bin that the plane
    // is above but rather add it to surrounding bins based on the distance
    // (the effect of distance decay is included).
    for (let dx = -radius; dx <= radius; dx++) {
        for (let dy = -radius; dy <= radius; dy++) {
            let dist2 = dx * dx + dy * dy;
            let key = `${gridPos.y + dx}_${gridPos.x + dy}`;

            let actualDist = Math.sqrt(dist2 + Math.pow(plane.alt_baro / 3280.84, 2)); // Convert altitude from feet to grid units
            let decay = (actualDist <= 1) ? 1 : 1 / (actualDist * actualDist);  // Decay function

            // add decayed loudness to the grid
            if (dist2 <= radius * radius) {
                grid[key] = (grid[key] || 0) + loudness * decay;
            }
        }
    }
}

function convertGridBackToDegrees(grid) {
    var earthCircumference = 40075; // Earth's circumference at equator in km
    var latitudeDistPerDeg = earthCircumference / 360;
    let heatmapData = [];

    for (let key in grid) {
        let [lat, lon] = key.split("_");
        let weight = grid[key];

        // Transform km back to degrees
        var longitudeDistPerDeg = Math.cos(degreesToRadians(lat)) * earthCircumference / 360;

        let lonDegrees = lon / longitudeDistPerDeg;
        let latDegrees = lat / latitudeDistPerDeg;
        heatmapData.push([latDegrees, lonDegrees, weight]);
    }

    return heatmapData;
}

function roundToNearestKm(latitude, longitude) {
    var earthCircumference = 40075; // Earth's circumference at equator in km
    var latitudeDistPerDeg = earthCircumference / 360;
    var longitudeDistPerDeg = Math.cos(degreesToRadians(latitude)) * earthCircumference / 360;

    return {
        x: Math.round(longitude * longitudeDistPerDeg),
        y: Math.round(latitude * latitudeDistPerDeg)
    };
}

function degreesToRadians(degrees) {
    return degrees * Math.PI / 180;
}

init();

module.exports = {
    calculateLoudness,
    calculateSoundRadius,
    addLoudnessToGrid,
    debugOutput,
    convertGridBackToDegrees,
};
