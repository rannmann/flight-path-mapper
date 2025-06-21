function calculateLoudness(aircraftCategory, speed, altitude, geom_rate) {
    let fullEffectAltitude = 1000; // altitude where plane is at maximum loudness
    let maxSpeed = 575;
    let attenuation = altitude > fullEffectAltitude ? Math.exp(-(altitude - fullEffectAltitude) / 5000) : 1;
    let speedFactor = (1 - speed / maxSpeed);

    let sizeFactor = getSizeFactor(aircraftCategory);

    let climbFactor = geom_rate > 0 ? 1.1 : 1;
    let maxLoudness = 120 * sizeFactor;

    let loudness = maxLoudness * speedFactor * attenuation * climbFactor;

    return loudness < 0 ? 0 : Math.min(120, loudness); // making sure loudness is within [0, 120]
}

// Function for calculating radius of noise based on altitude
function calculateSoundRadius(aircraftCategory, altitude) {
    let fullEffectAltitude = 1000; // altitude where plane noise has the maximum radius
    let attenuation = altitude > fullEffectAltitude ? Math.exp(-(altitude - fullEffectAltitude) / 5000) : 1;

    let sizeFactor = getSizeFactor(aircraftCategory);

    let maxRadius = 10 * sizeFactor;
    let radius = maxRadius * attenuation;

    return radius < 0 ? 0 : radius;
}

// Rather than fetching aircraft data based on the model name, the easiest way is
// to check the size of the aircraft based on reported transponder.
// https://www.adsbexchange.com/emitter-category-ads-b-do-260b-2-2-3-2-5-2/
function getSizeFactor(aircraftCategory) {
    switch(aircraftCategory) {
        // Light
        case 'A1':
            return 0.8;

        // Small
        case 'A2':
        // Large
        case 'A3':
            return 1;

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

//Function for adding loudness to grid
function addLoudnessToGrid(plane, grid) {
    let loudness = calculateLoudness(
        plane.category,
        plane.gs,
        plane.alt_baro,
        plane.geom_rate
    );
    let radius = calculateSoundRadius(plane.category, plane.alt_baro);
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

// Class-based export for worker thread compatibility
class Aircraft {
    constructor(centerLat, centerLon) {
        this.centerLat = centerLat;
        this.centerLon = centerLon;
    }

    calculateLoudness(aircraftCategory, speed, altitude, geom_rate) {
        return calculateLoudness(aircraftCategory, speed, altitude, geom_rate);
    }

    calculateSoundRadius(aircraftCategory, altitude) {
        return calculateSoundRadius(aircraftCategory, altitude);
    }

    getSizeFactor(aircraftCategory) {
        return getSizeFactor(aircraftCategory);
    }

    addLoudnessToGrid(plane, grid) {
        return addLoudnessToGridOriginal(plane, grid, this.centerLat, this.centerLon);
    }
    
    findContainingGridSquare(plane) {
        return findContainingGridSquare(plane, this.centerLat, this.centerLon);
    }
    
    convertGridBackToDegrees(grid) {
        return convertGridBackToDegrees(grid);
    }
}

// Export both class and individual functions
module.exports = Aircraft;
module.exports.calculateLoudness = calculateLoudness;
module.exports.calculateRadius = calculateSoundRadius;
// Original grid-based methods for heatmap generation
function findContainingGridSquare(plane, middleLat, middleLon) {
    const earthCircumference = 40075; // Earth's circumference at equator in km
    const latitudeDistPerDeg = earthCircumference / 360;
    const longitudeDistPerDeg = Math.cos(degreesToRadians(middleLat)) * earthCircumference / 360;  // computed at Seattle's latitude

    let xIndex = Math.floor((plane.lon - middleLon) * longitudeDistPerDeg);
    let yIndex = Math.floor((plane.lat - middleLat) * latitudeDistPerDeg);

    // grid central coordinates for each 1km square grid
    let centralLon = middleLon + (xIndex + 0.5) / longitudeDistPerDeg;
    let centralLat = middleLat + (yIndex + 0.5) / latitudeDistPerDeg;

    return {
        x: xIndex,
        y: yIndex,
        centralLon: centralLon,
        centralLat: centralLat
    };
}

function addLoudnessToGridOriginal(plane, grid, middleLat, middleLon) {
    if (!plane.lat || !plane.lon) {
        // No location data, nothing to graph.
        return;
    }

    let loudness = calculateLoudness(plane.category, plane.gs, plane.alt_baro, plane.geom_rate);

    if (!loudness || loudness <= 0) {
        // No loudness, nothing to graph.
        return;
    }

    let loudnessRadius = calculateSoundRadius(plane.category, plane.alt_baro);
    let soundArea = Math.PI * loudnessRadius * loudnessRadius; // Sound area in km²
    let loudnessPerSquareKm = loudness / soundArea; // The loudness distributed over the area where the sound reaches.

    let gridPos = findContainingGridSquare(plane, middleLat, middleLon);
    let key = `${gridPos.y}_${gridPos.x}`;
    grid[key] = {
        totalLoudness: (grid[key] ? grid[key].totalLoudness : 0) + loudnessPerSquareKm,
        centralLon: gridPos.centralLon,
        centralLat: gridPos.centralLat
    };
}

function convertGridBackToDegrees(grid) {
    let heatmapData = [];

    for (let key in grid) {
        let gridValue = grid[key];
        if (gridValue && gridValue.centralLat != null && gridValue.centralLon != null) {
            heatmapData.push([gridValue.centralLat, gridValue.centralLon, gridValue.totalLoudness]);
        }
    }

    return heatmapData;
}

function degreesToRadians(degrees) {
    return degrees * Math.PI / 180;
}


module.exports = Aircraft;
module.exports.calculateLoudness = calculateLoudness;
module.exports.calculateSoundRadius = calculateSoundRadius;
module.exports.addLoudnessToGrid = addLoudnessToGrid;
module.exports.getSizeFactor = getSizeFactor;
module.exports.findContainingGridSquare = findContainingGridSquare;
module.exports.addLoudnessToGridOriginal = addLoudnessToGridOriginal;
module.exports.convertGridBackToDegrees = convertGridBackToDegrees;
