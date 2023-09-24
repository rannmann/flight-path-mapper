const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const pLimit = require('p-limit');

const CONCURRENCY_LIMIT = 10;   // Adjust as needed.

const limit = pLimit(CONCURRENCY_LIMIT);

/**
 * @param url
 * @returns {Promise<any>}
 */
const fetchURL = async (url) => {
    const response = await axios.get(url);
    return response.data;
};

/**
 * @param html
 * @returns {*[]}
 */
const extractLinks = (html) => {
    const $ = cheerio.load(html);
    const fileLinks = [];

    $('a').each((i, link) => {
        const linkHref = $(link).attr('href');
        // Exclude the directory navigation links
        if (linkHref && !linkHref.endsWith('/')) {
            fileLinks.push(linkHref);
        }
    });

    return fileLinks;
};

/**
 * @param fileUrl
 * @param outputFolder
 * @returns {Promise<unknown>}
 */
const downloadFile = async (fileUrl, outputFolder) => {
    try {
        const url = `https://samples.adsbexchange.com/readsb-hist/2023/09/01/${fileUrl}`;
        const outputPath = path.join(outputFolder, fileUrl);
        const writer = fs.createWriteStream(outputPath);
        const response = await axios({
            url,
            method: 'GET',
            responseType: 'stream'
        });

        response.data.pipe(writer);

        return new Promise((resolve, reject) => {
            writer.on('finish', resolve);
            writer.on('error', reject);
        })
    } catch (err) {
        console.error(err.message);
    }
};

/**
 * @returns {Promise<void>}
 */
const main = async () => {
    const url = 'https://samples.adsbexchange.com/readsb-hist/2023/09/01/';
    const outputFolder = 'flight-history/2023-09-01';

    const html = await fetchURL(url);
    const fileUrls = extractLinks(html);
    const downloads = fileUrls.map(fileUrl => limit(async () => {
        const outputPath = path.join(outputFolder, fileUrl);

        if (!fs.existsSync(outputPath)) {
            await downloadFile(fileUrl, outputFolder);
            console.log(`Downloaded ${fileUrl}`);
        } else {
            console.log(`File ${fileUrl} already exists. Skipping.`);
        }
    }));

    await Promise.all(downloads);
};

main().catch(console.error);
