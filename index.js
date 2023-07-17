const puppeteer = require('puppeteer');
const Redis = require('ioredis');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config();

const redis = new Redis();
const keysLimit = process.env.keysLimit ?? 0;
console.log('keysLimit', keysLimit)

async function savePageAsHTML(url, content) {
    const folderName = 'result';
    const fileName = `${encodeURIComponent(url)}.html`;
    const filePath = path.join(__dirname, folderName, fileName);

    // Create the "result" folder if it doesn't exist
    if (!fs.existsSync(folderName)) {
        fs.mkdirSync(folderName);
    }

    fs.writeFileSync(filePath, content);
    console.log(`Page saved as ${filePath}`);
}

async function crawl(url) {
    console.log('starting crawl ' + url);
    
    // Step 1: Launch a Puppeteer browser instance
    console.log('step 1');
    const browser = await puppeteer.launch({
        headless: "new",
        executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe'
    });
    const page = await browser.newPage();

    // Step 2: Navigate to the main page
    console.log('step 2');
    await page.goto(url);

    // Step 3: Mark the current URL as visited
    console.log('step 3');
    await redis.set(url, true);
    await redis.expire(url, 18000);

    // Step 4: check limit
    let addMoreLink = false;
    const redisKeys = await redis.keys('*');
    if (redisKeys.length <= keysLimit) {
        addMoreLink = true;
    }

    // Step 5: Save the current page as HTML
    console.log('step 5');
    const content = await page.content();
    await savePageAsHTML(url, content);

    // Step 6: Extract all links from the main page
    console.log('step 6');
    const links = await page.evaluate(() =>
        Array.from(document.querySelectorAll('a[href]'), (element) => element.href)
    );

    // Step 7: Filter and save unique links to Redis
    console.log('step 7');
    let newUniqueLinks = 0;
    const filteredLinks = links.filter((link) => link.startsWith(url));
    for (const link of filteredLinks) {
        const exists = await redis.exists(link);
        if (!exists && redisKeys.length + newUniqueLinks < keysLimit && addMoreLink ) {
            console.log(redisKeys.length + newUniqueLinks < keysLimit, addMoreLink)
            await redis.set(link, false);
            await redis.expire(link, 18000);
            newUniqueLinks++;
        }
    }

    // Step 8: Close the Puppeteer browser
    console.log('step 8');
    await browser.close();
}

async function getNextUrl() {
    // Step 7: Get the next false key from Redis
    const redisKeys = await redis.keys('*');
    for (const key of redisKeys) {
        const value = await redis.get(key);
        if (value === 'false') {
            return key;
        }
    }
    return null;
}

(async () => {
    try {
        // Get the last crawled URL from Redis
        const lastCrawledUrl = await redis.get('lastcrawled');

        // Starting URL is either the last crawled URL or the initial URL
        let url = lastCrawledUrl || process.env.site || 'https://cmlabs.co/';
        await crawl(url);

        let nextUrl = await getNextUrl();
        while (nextUrl) {
            try {
                await crawl(nextUrl);
            } catch (error) {
                console.error('Timeout error occurred. Retrying from the last crawled URL...', error);
                const lastCrawledUrl = await redis.get('lastcrawled');
                // Retry from the last crawled URL if available
                nextUrl = lastCrawledUrl || nextUrl; 
                continue;
            }

            nextUrl = await getNextUrl();
        }

        console.log('Crawling completed!');
        process.exit(0);
        
    } catch (error) {
        console.error('An error occurred:', error);
        process.exit(1);
    }
})();
