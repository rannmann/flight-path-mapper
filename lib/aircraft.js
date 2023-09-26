let aircraftsKeyedByType = {};

let aircraftsKeyedByHex = {};

// Load aircraft data from file
// Data created from: https://aviationstack.com/documentation#airplanes
let aircraftsData = require('./airplanes.json');

// Key aircraft data by type and hex, dropping data we don't need.
// And unset the original data to free up memory.
aircraftsData.forEach(aircraft => {
    let simplifiedRecord = {
        engines_count: aircraft.engines_count,
        engines_type: aircraft.engines_type,
        plane_age: aircraft.plane_age,
    };

    // If we already have this record by type, update any data we're missing.
    // Otherwise, initialize the record.
    if (aircraft.iata_code_long in aircraftsKeyedByType) {
        let data = aircraftsKeyedByType[aircraft.iata_code_long];
        if (!data.engines_count) {
            data.engines_count = aircraft.engines_count;
        }
        if (!data.engines_type) {
            data.engines_type = aircraft.engines_type;
        }
        if (!data.plane_age) {
            data.plane_age = aircraft.plane_age;
        }
    } else {
        aircraftsKeyedByType[aircraft.iata_code_long] = simplifiedRecord;
    }

    // Key the same data by hex for this specific plane.
    aircraftsKeyedByHex[aircraft.icao_code_hex] = simplifiedRecord;
});


// WIP Delete me.
console.log("Loaded distinct aircraft types: " + Object.keys(aircraftsKeyedByType).length);
console.log("Loaded distinct aircraft hexes: " + Object.keys(aircraftsKeyedByHex).length);
let hexMatch = 0;
let typeMatch = 0;
let noMatch = 0;
let missingPlanes = {};

function getAircraftDataByHex(hex) {
    if (aircraftsKeyedByHex[hex])
        hexMatch++;
    return aircraftsKeyedByHex[hex] || null;
}

function getAircraftDataByType(type) {
    if (aircraftsKeyedByType[type])
        typeMatch++;
    else {
        noMatch++;
        missingPlanes[type] = missingPlanes[type] ? missingPlanes[type] + 1 : 1;
    }
    return aircraftsKeyedByType[type] || null;
}

// WIP: Delete me.
function outputMatches() {
    // Output missing plane types ordered by values
    missingPlanes = Object.keys(missingPlanes).sort((a, b) => missingPlanes[b] - missingPlanes[a]).reduce(
        (obj, key) => {
            obj[key] = missingPlanes[key];
            return obj;
        }
        , {}
    );

    console.log("Missing plane types: " + JSON.stringify(missingPlanes));
    console.log("Exact matches: " + hexMatch);
    console.log("Type matches: " + typeMatch);
    console.log("No matches: " + noMatch);
}

function getAircraftData(hex, type) {
    return getAircraftDataByHex(hex) || getAircraftDataByType(type);
}

function calculateLoudness(aircraftHex, aircraftType, speed, altitude, geom_rate) {
    let fullEffectAltitude = 1000; // altitude where plane is at maximum loudness
    let maxSpeed = 575;
    let attenuation = altitude > fullEffectAltitude ? Math.exp(-(altitude - fullEffectAltitude) / 5000) : 1;
    let speedFactor = (1 - speed / maxSpeed);

    // fallback defaults
    let engineFactor = 1;
    let ageFactor = 1;

    let aircraftData = getAircraftData(aircraftHex, aircraftType);

    // if we have data for this aircraft type, alter factors accordingly
    if (aircraftData) {
        if (aircraftData.engines_type) {
            engineFactor = (aircraftData.engines_type.toUpperCase() === "JET") ? 1.2 : 1;
        }
        ageFactor = (parseInt(aircraftData.plane_age) < 20) ? 1 : 1.2;  // use a higher factor for older planes
    }

    let climbFactor = geom_rate > 0 ? 1.1 : 1;
    let maxLoudness = 120 * engineFactor * ageFactor;

    let loudness = maxLoudness * speedFactor * attenuation * climbFactor;

    return loudness < 0 ? 0 : Math.min(120, loudness); // making sure loudness is within [0, 120]
}

// Function for calculating radius of noise based on altitude
function calculateSoundRadius(aircraftHex, aircraftType, altitude) {
    let fullEffectAltitude = 1000; // altitude where plane noise has the maximum radius
    let attenuation = altitude > fullEffectAltitude ? Math.exp(-(altitude - fullEffectAltitude) / 5000) : 1;

    // fallback default
    let sizeFactor = 1;

    let aircraftData = getAircraftData(aircraftHex, aircraftType);

    // if we have data for this aircraft type, alter sizeFactor accordingly
    if (aircraftData && aircraftData.engines_type) {
        sizeFactor = (aircraftData.engines_type.toUpperCase() === "JET") ? 1.2 : 1; // expand radius for jet planes
    }

    let maxRadius = 10 * sizeFactor;
    let radius = maxRadius * attenuation;

    return radius < 0 ? 0 : radius;
}

//Function for adding loudness to grid
function addLoudnessToGrid(plane, grid) {
    let loudness = calculateLoudness(plane.hex, plane.t, plane.gs, plane.alt_baro, plane.geom_rate);
    return;
    let radius = calculateSoundRadius(plane.hex, plane.t, plane.alt_baro);
    let gridLon = Math.round(plane.lon / 0.005);
    let gridLat = Math.round(plane.lat / 0.005);

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

module.exports = {
    calculateLoudness,
    calculateRadius: calculateSoundRadius,
    addLoudnessToGrid,
    outputMatches
};
