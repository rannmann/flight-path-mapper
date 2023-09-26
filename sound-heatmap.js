const {calculateLoudness, calculateRadius, addLoudnessToGrid} = require('./lib/aircraft');

// Our grid
let grid = {};

// Function to process all planes
function processPlanes(planes) {
  planes.forEach(plane => {
    addLoudnessToGrid(plane, grid);
  });
}

// TODO: Load plane data points from file
let planes = [];
processPlanes(planes);
