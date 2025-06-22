#!/usr/bin/env node

/**
 * Static Build Generator for Flight Path Mapper
 * 
 * Creates a build directory with static HTML/JSON files that can be served
 * from any static web server (GitHub Pages, Netlify, etc.) without the
 * Node.js backend.
 */

const fs = require('fs');
const path = require('path');
const { promisify } = require('util');

const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const mkdir = promisify(fs.mkdir);
const copyFile = promisify(fs.copyFile);
const readdir = promisify(fs.readdir);
const stat = promisify(fs.stat);

const config = require('./config.js');

class StaticBuildGenerator {
    constructor() {
        this.buildDir = path.join(__dirname, 'build');
        this.sourceDir = __dirname;
    }

    async build() {
        console.log('🚀 Starting static build generation...');
        
        try {
            // Create build directory structure
            await this.createBuildStructure();
            
            // Copy static assets and data
            await this.copyDataFiles();
            
            // Generate static configuration files
            await this.generateStaticConfig();
            
            // Generate static HTML files
            await this.generateStaticHTML();
            
            // Create index page
            await this.createIndexPage();
            
            console.log('✅ Static build completed successfully!');
            console.log(`📁 Build directory: ${this.buildDir}`);
            console.log('🌐 Ready for deployment to any static web server');
            
        } catch (error) {
            console.error('❌ Build failed:', error);
            process.exit(1);
        }
    }

    async createBuildStructure() {
        console.log('📁 Creating build directory structure...');
        
        // Remove existing build directory
        if (fs.existsSync(this.buildDir)) {
            await this.removeDirectory(this.buildDir);
        }
        
        // Create build structure
        await mkdir(this.buildDir, { recursive: true });
        await mkdir(path.join(this.buildDir, 'data'), { recursive: true });
        await mkdir(path.join(this.buildDir, 'data', 'flightpaths'), { recursive: true });
        await mkdir(path.join(this.buildDir, 'data', 'heatmaps'), { recursive: true });
    }

    async copyDataFiles() {
        console.log('📄 Copying data files...');
        
        // Copy flightpaths
        const flightPathsDir = path.join(this.sourceDir, 'data', 'flightpaths');
        if (fs.existsSync(flightPathsDir)) {
            const files = await readdir(flightPathsDir);
            for (const file of files) {
                if (file.endsWith('.json')) {
                    await copyFile(
                        path.join(flightPathsDir, file),
                        path.join(this.buildDir, 'data', 'flightpaths', file)
                    );
                }
            }
            console.log(`   ✓ Copied ${files.length} flight path files`);
        }
        
        // Copy heatmaps
        const heatmapsDir = path.join(this.sourceDir, 'data', 'heatmaps');
        if (fs.existsSync(heatmapsDir)) {
            const files = await readdir(heatmapsDir);
            for (const file of files) {
                if (file.endsWith('.json')) {
                    await copyFile(
                        path.join(heatmapsDir, file),
                        path.join(this.buildDir, 'data', 'heatmaps', file)
                    );
                }
            }
            console.log(`   ✓ Copied ${files.length} heatmap files`);
        }
        
        // Copy aircraft data
        const aircraftDataFile = path.join(this.sourceDir, 'data', 'airplanes.json');
        if (fs.existsSync(aircraftDataFile)) {
            await copyFile(
                aircraftDataFile,
                path.join(this.buildDir, 'data', 'airplanes.json')
            );
            console.log('   ✓ Copied aircraft data file');
        }
    }

    async generateStaticConfig() {
        console.log('⚙️  Generating static configuration...');
        
        // Generate flightpaths listing
        const flightPathsDir = path.join(this.buildDir, 'data', 'flightpaths');
        const flightPathFiles = fs.existsSync(flightPathsDir) 
            ? await readdir(flightPathsDir)
            : [];
        
        const flightPathsConfig = {
            files: flightPathFiles.filter(f => f.endsWith('.json')),
            lastUpdated: new Date().toISOString(),
            source: 'static-build'
        };
        
        await writeFile(
            path.join(this.buildDir, 'data', 'flightpaths.json'),
            JSON.stringify(flightPathsConfig, null, 2)
        );
        
        // Generate heatmaps listing
        const heatmapsDir = path.join(this.buildDir, 'data', 'heatmaps');
        const heatmapFiles = fs.existsSync(heatmapsDir) 
            ? await readdir(heatmapsDir)
            : [];
        
        const heatmapsConfig = {
            files: heatmapFiles.filter(f => f.endsWith('.json')),
            lastUpdated: new Date().toISOString(),
            source: 'static-build'
        };
        
        await writeFile(
            path.join(this.buildDir, 'data', 'heatmaps.json'),
            JSON.stringify(heatmapsConfig, null, 2)
        );
        
        // Generate static app config
        const staticConfig = {
            cities: config.cities,
            defaultRadii: config.defaultRadii,
            defaultDate: config.defaultDate,
            version: require('./package.json').version,
            buildDate: new Date().toISOString(),
            isStatic: true
        };
        
        await writeFile(
            path.join(this.buildDir, 'data', 'config.json'),
            JSON.stringify(staticConfig, null, 2)
        );
        
        console.log('   ✓ Generated static configuration files');
    }

    async generateStaticHTML() {
        console.log('📝 Generating static HTML files...');
        
        // Generate static flight paths viewer
        await this.generateStaticFlightPathsHTML();
        
        // Generate static heatmap viewer
        await this.generateStaticHeatmapHTML();
    }

    async generateStaticFlightPathsHTML() {
        const originalHTML = await readFile(path.join(this.sourceDir, 'index.html'), 'utf8');
        
        // Replace server API calls with static data loading
        const staticHTML = originalHTML
            .replace(/await fetch\('\/api\/config'\)/, "await fetch('data/config.json')")
            .replace(/await fetch\('\/listflightpaths'\)/, "await fetch('data/flightpaths.json').then(r => r.json()).then(config => config.files)")
            .replace(/await fetch\('\/api\/status'\)/, "Promise.resolve({ flightPathsCount: 'unknown' })")
            .replace(/const baseUrl = `\${window\.location\.protocol}\/\/\${window\.location\.host}\${window\.location\.pathname}flightpaths\/`;/, 
                     "const baseUrl = 'data/flightpaths/';")
            .replace(/<title>Flight Path Mapper<\/title>/, '<title>Flight Path Mapper - Static Build</title>');
        
        await writeFile(path.join(this.buildDir, 'index.html'), staticHTML);
        console.log('   ✓ Generated static flight paths viewer');
    }

    async generateStaticHeatmapHTML() {
        const originalHTML = await readFile(path.join(this.sourceDir, 'heatmap.html'), 'utf8');
        
        // The heatmap.html is already mostly static, just update the title
        const staticHTML = originalHTML
            .replace(/<title>Flight Path Noise Heatmap<\/title>/, '<title>Flight Path Noise Heatmap - Static Build</title>');
        
        await writeFile(path.join(this.buildDir, 'heatmap.html'), staticHTML);
        console.log('   ✓ Generated static heatmap viewer');
    }

    async createIndexPage() {
        console.log('🏠 Creating index page...');
        
        // Read available data files
        const flightPathsConfig = JSON.parse(
            await readFile(path.join(this.buildDir, 'data', 'flightpaths.json'), 'utf8')
        );
        const heatmapsConfig = JSON.parse(
            await readFile(path.join(this.buildDir, 'data', 'heatmaps.json'), 'utf8')
        );
        const appConfig = JSON.parse(
            await readFile(path.join(this.buildDir, 'data', 'config.json'), 'utf8')
        );
        
        // Generate flight path entries
        const flightPathEntries = flightPathsConfig.files.map(file => {
            const parts = file.replace('.json', '').split('_');
            const city = parts.slice(0, -2).join(' ').replace(/_/g, ' ');
            const radius = parts[parts.length - 2];
            return { file, city, radius };
        });
        
        // Generate heatmap entries
        const heatmapEntries = heatmapsConfig.files
            .filter(file => file !== 'metadata.json')
            .map(file => {
                const city = file.replace('_heatmap.json', '').replace(/_/g, ' ');
                return { file, city };
            });
        
        const indexHTML = this.generateIndexHTML(appConfig, flightPathEntries, heatmapEntries);
        
        await writeFile(path.join(this.buildDir, 'landing.html'), indexHTML);
        console.log('   ✓ Created index page');
    }

    generateIndexHTML(config, flightPaths, heatmaps) {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Flight Path Mapper - Static Build</title>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css" />
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            line-height: 1.6;
            color: #333;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
        }

        .container {
            max-width: 1200px;
            margin: 0 auto;
            padding: 2rem;
        }

        .header {
            text-align: center;
            color: white;
            margin-bottom: 3rem;
        }

        .header h1 {
            font-size: 3rem;
            margin-bottom: 1rem;
            text-shadow: 0 2px 4px rgba(0,0,0,0.3);
        }

        .header p {
            font-size: 1.2rem;
            opacity: 0.9;
        }

        .apps-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(400px, 1fr));
            gap: 2rem;
            margin-bottom: 3rem;
        }

        .app-card {
            background: white;
            border-radius: 12px;
            padding: 2rem;
            box-shadow: 0 8px 24px rgba(0,0,0,0.1);
            transition: transform 0.3s ease, box-shadow 0.3s ease;
        }

        .app-card:hover {
            transform: translateY(-4px);
            box-shadow: 0 12px 32px rgba(0,0,0,0.15);
        }

        .app-card h2 {
            font-size: 1.5rem;
            margin-bottom: 1rem;
            color: #2c3e50;
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }

        .app-card p {
            color: #7f8c8d;
            margin-bottom: 1.5rem;
        }

        .launch-btn {
            display: inline-block;
            background: #3498db;
            color: white;
            padding: 0.75rem 1.5rem;
            text-decoration: none;
            border-radius: 6px;
            font-weight: 500;
            transition: background 0.3s ease;
            margin-bottom: 1rem;
        }

        .launch-btn:hover {
            background: #2980b9;
        }

        .data-list {
            background: #f8f9fa;
            border-radius: 8px;
            padding: 1rem;
            margin-top: 1rem;
        }

        .data-list h4 {
            margin-bottom: 0.5rem;
            color: #2c3e50;
            font-size: 0.9rem;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }

        .data-list ul {
            list-style: none;
            margin: 0;
            padding: 0;
        }

        .data-list li {
            padding: 0.25rem 0;
            color: #5a6c7d;
            font-size: 0.9rem;
        }

        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 1.5rem;
            margin-top: 2rem;
        }

        .stat-card {
            background: rgba(255,255,255,0.1);
            border-radius: 8px;
            padding: 1.5rem;
            text-align: center;
            color: white;
            backdrop-filter: blur(10px);
        }

        .stat-card h3 {
            font-size: 2rem;
            margin-bottom: 0.5rem;
        }

        .stat-card p {
            opacity: 0.9;
            font-size: 0.9rem;
        }

        .footer {
            text-align: center;
            color: rgba(255,255,255,0.8);
            margin-top: 3rem;
            padding: 2rem 0;
            border-top: 1px solid rgba(255,255,255,0.1);
        }

        @media (max-width: 768px) {
            .header h1 {
                font-size: 2rem;
            }
            
            .apps-grid {
                grid-template-columns: 1fr;
            }
            
            .stats-grid {
                grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1><i class="fas fa-plane"></i> Flight Path Mapper</h1>
            <p>Interactive visualization of aircraft flight paths and noise levels</p>
        </div>

        <div class="apps-grid">
            <div class="app-card">
                <h2><i class="fas fa-route"></i> Flight Path Viewer</h2>
                <p>Explore historical flight paths around major cities. Visualize aircraft routes, altitude patterns, and traffic density.</p>
                <a href="index.html" class="launch-btn">
                    <i class="fas fa-external-link-alt"></i> Launch Viewer
                </a>
                
                <div class="data-list">
                    <h4>Available Flight Paths</h4>
                    <ul>
                        ${flightPaths.map(fp => `<li>${fp.city} (${fp.radius} miles)</li>`).join('')}
                    </ul>
                </div>
            </div>

            <div class="app-card">
                <h2><i class="fas fa-fire"></i> Noise Heatmap</h2>
                <p>View aircraft noise intensity heatmaps based on research-based acoustic modeling. Explore sound levels across different areas.</p>
                <a href="heatmap.html" class="launch-btn">
                    <i class="fas fa-external-link-alt"></i> Launch Heatmap
                </a>
                
                <div class="data-list">
                    <h4>Available Heatmaps</h4>
                    <ul>
                        ${heatmaps.map(hm => `<li>${hm.city}</li>`).join('')}
                    </ul>
                </div>
            </div>
        </div>

        <div class="stats-grid">
            <div class="stat-card">
                <h3>${flightPaths.length}</h3>
                <p>Flight Path Datasets</p>
            </div>
            <div class="stat-card">
                <h3>${heatmaps.length}</h3>
                <p>Noise Heatmaps</p>
            </div>
            <div class="stat-card">
                <h3>${Object.keys(config.cities).length}</h3>
                <p>Cities Configured</p>
            </div>
            <div class="stat-card">
                <h3>${config.version || 'N/A'}</h3>
                <p>Build Version</p>
            </div>
        </div>

        <div class="footer">
            <p>Generated on ${new Date(config.buildDate).toLocaleString()}</p>
            <p>Data from ${config.defaultDate} • Static build for deployment</p>
        </div>
    </div>
</body>
</html>`;
    }

    async removeDirectory(dir) {
        if (fs.existsSync(dir)) {
            const files = await readdir(dir);
            await Promise.all(files.map(async file => {
                const filePath = path.join(dir, file);
                const fileStat = await stat(filePath);
                if (fileStat.isDirectory()) {
                    await this.removeDirectory(filePath);
                } else {
                    await fs.promises.unlink(filePath);
                }
            }));
            await fs.promises.rmdir(dir);
        }
    }
}

// CLI interface
if (require.main === module) {
    const generator = new StaticBuildGenerator();
    generator.build().catch(console.error);
}

module.exports = StaticBuildGenerator;