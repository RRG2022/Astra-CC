const puppeteer = require('puppeteer');
(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  page.on('console', msg => console.log('PAGE LOG:', msg.type(), msg.text()));
  page.on('pageerror', error => console.error('PAGE ERROR:', error.message));
  
  try {
    await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded', timeout: 5000 });
    // wait a bit for react to render
    await new Promise(r => setTimeout(r, 2000));
  } catch (e) {
    console.log('Timeout or error:', e.message);
  }
  await browser.close();
})();
