// TODO: https://aviationstack.com/documentation#airplanes
let aircraftData = {
  "B733": {
    "engines_count": "2",
    "engines_type": "JET",
    "plane_age": "31",
    /*...other data...*/
  },
  /*...other aircrafts...*/
};

function calculateLoudness(speed, altitude, aircraftType, geom_rate) {
  let fullEffectAltitude = 1000; // altitude where plane is at maximum loudness
  let maxSpeed = 575;
  let attenuation = altitude > fullEffectAltitude ? Math.exp(-(altitude - fullEffectAltitude) / 5000) : 1;
  let speedFactor = (1 - speed / maxSpeed);

  // fallback defaults
  let engineFactor = 1;
  let ageFactor = 1;

  // if we have data for this aircraft type, alter factors accordingly
  if (aircraftType in aircraftData) {
    let data = aircraftData[aircraftType];
    engineFactor = (data.engines_type.toUpperCase() === "JET") ? 1.2 : 1;
    ageFactor = (parseInt(data.plane_age) < 20) ? 1 : 1.2;  // use a higher factor for older planes
  }

  let climbFactor = geom_rate > 0 ? 1.1 : 1;
  let maxLoudness = 120 * engineFactor * ageFactor;

  let loudness = maxLoudness * speedFactor * attenuation * climbFactor;

  return loudness < 0 ? 0 : Math.min(120, loudness); // making sure loudness is within [0, 120]
}

// Function for calculating radius of noise based on altitude
function calculateSoundRadius(altitude, aircraftType) {
  let fullEffectAltitude = 1000; // altitude where plane noise has the maximum radius
  let attenuation = altitude > fullEffectAltitude ? Math.exp(-(altitude - fullEffectAltitude) / 5000) : 1;

  // fallback default
  let sizeFactor = 1;

  // if we have data for this aircraft type, alter sizeFactor accordingly
  if (aircraftType in aircraftData) {
    let data = aircraftData[aircraftType];
    sizeFactor = (data.engines_type.toUpperCase() === "JET") ? 1.2 : 1; // expand radius for jet planes
  }

  let maxRadius = 10 * sizeFactor;
  let radius = maxRadius * attenuation;

  return radius < 0 ? 0 : radius;
}

//Function for adding loudness to grid
function addLoudnessToGrid(plane, grid) {
  let loudness = calculateLoudness(plane.gs, plane.alt_baro, plane.t, plane.geom_rate);
  let radius = calculateSoundRadius(plane.alt_baro, plane.t);
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
  addLoudnessToGrid
};
