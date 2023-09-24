# flight-path-mapper
Downloads 24 hours of global flight data in 5-second intervals and produces a map of any local
region of every tracked flight during that period.  In large cities, this is a lot.  In remote
areas, there may be missing data, especially if transponders are not required in your country
(such as the United States).

This was a project I built for my wife to help find potential places to live that may be quiet.
It's basic in scope and was done over morning coffee.  Not maintained, but feel free to fork and
build it into something more useful.

![img.png](img.png)

# Usage

## Downloading data

```
node download.js
```

The default concurrency is 10, and it's set to download data from
adsbexchange.com, on 9/1/2023.  No config options so edit the file to change these.

*Be aware that this will download about 16GB of gzipped json files.*

## Processing data

```
node index.js
```

This will output files called `flighPaths_*_miles.json` where `*` is the number of miles from
the source location.  Edit `SOURCE_COORDINATES` to change the source location, and `radii` to change
the range of output files.

After generation, dump the files into `flightpaths` and rename them however you like. However
you name them is how they'll appear as options in the map.

This will take at least 15 minutes to run.

## Viewing data

```
node server.js
```

Due to COORS restrictions, you'll need to run a webserver.  It's a simple node server that
just serves `index.html` and the `flightpaths` directory.

Open your browser to `http://localhost:3000`.  In the top-right corner, you'll see a dropdown
for all the files you've generated.  Select one and it'll load the path overlay.

Alternatively you can upload `index.html` and the flightpaths directory to a real webserver and view it.