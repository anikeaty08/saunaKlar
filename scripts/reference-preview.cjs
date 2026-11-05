/**
 * Screenshot the dev-only reference sauna page (apps/web/reference-preview.html).
 *
 *   npx vite --config apps/web/vite.config.ts apps/web --port 5178 --strictPort   (in another shell)
 *   node scripts/reference-preview.cjs              # docs/previews/*.png comparison shots
 *   node scripts/reference-preview.cjs catalogue    # apps/web/public/catalogue/<slug>-{exterior,interior}.jpg
 *
 * Side-by-side SKP checks (docs/previews/compare-{iso,front,plan}.png): render the SKP with
 * tools/blender/render_skp_reference.py --view iso|front|plan into docs/previews/source-skp-<view>.png,
 * then run `node scripts/reference-preview.cjs compare` after the default shots.
 *
 * Stop the Vite server afterwards.
 */
const { chromium } = require('playwright');
const path = require('node:path');

const SLUG = 'kide-glass-six';
const BASE = process.env.PREVIEW_URL || 'http://127.0.0.1:5178/reference-preview.html';

const PREVIEWS = [
  ['docs/previews/reference-sauna-3060.png', ''],
  ['docs/previews/reference-sauna-2400.png', '?w=2400&d=2000&h=2100'],
  ['docs/previews/reference-sauna-3600.png', '?w=3600&d=2700&h=2700'],
  // Same orthographic cameras as tools/blender/render_skp_reference.py --view iso|front|plan.
  ['docs/previews/browser-iso.png', '?view=iso'],
  ['docs/previews/browser-front.png', '?view=front'],
  ['docs/previews/browser-plan.png', '?view=plan'],
  ['docs/previews/reference-sauna-interior.png', '?view=interior'],
  ['docs/previews/reference-sauna-interior-lit.png', '?view=interior&lights=1'],
];
const CATALOGUE = [
  [`apps/web/public/catalogue/${SLUG}-exterior.jpg`, '?view=catalogue'],
  [`apps/web/public/catalogue/${SLUG}-interior.jpg`, '?view=interior'],
];

async function compare() {
  const sharp = require('sharp');
  for (const view of ['iso', 'front', 'plan']) {
    const left = path.resolve(`docs/previews/source-skp-${view}.png`), right = path.resolve(`docs/previews/browser-${view}.png`);
    const [a, b] = await Promise.all([left, right].map(f => sharp(f).resize(800, 600).png().toBuffer()));
    await sharp({ create: { width: 1600, height: 600, channels: 3, background: '#ffffff' } })
      .composite([{ input: a, left: 0, top: 0 }, { input: b, left: 800, top: 0 }]).png().toFile(path.resolve(`docs/previews/compare-${view}.png`));
    console.log('wrote', `docs/previews/compare-${view}.png`);
  }
}

(async () => {
  if (process.argv[2] === 'compare') return compare();
  const catalogue = process.argv[2] === 'catalogue';
  const executablePath = process.env.CHROME_PATH || (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : undefined);
  const browser = await chromium.launch({ executablePath, headless: true, args: ['--use-angle=d3d11', '--enable-gpu'] });
  const page = await browser.newPage({ viewport: catalogue ? { width: 1200, height: 800 } : { width: 1200, height: 900 } });
  page.on('pageerror', error => console.error(error.message));
  for (const [file, query] of catalogue ? CATALOGUE : PREVIEWS) {
    await page.goto(`${BASE}${query}`);
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
    await page.waitForTimeout(800);
    const target = path.resolve(file);
    await page.screenshot(file.endsWith('.jpg') ? { path: target, type: 'jpeg', quality: 90 } : { path: target });
    console.log('wrote', file);
  }
  await browser.close();
})().catch(error => { console.error(error); process.exitCode = 1; });
