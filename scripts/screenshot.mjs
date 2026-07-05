#!/usr/bin/env node
// Tiny screenshot helper for the new Home + Tutorial pages.
// Boots a browser, navigates to each, saves PNGs to ./screenshots/.

import { chromium } from 'playwright-core';
import { mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SHOTS = path.join(ROOT, 'screenshots');
if (!existsSync(SHOTS)) mkdirSync(SHOTS, { recursive: true });

const CANDIDATES = [
  path.join(os.homedir(), '.cache/ms-playwright/chromium-1228/chrome-linux64/chrome'),
  '/snap/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
];
const browserPath = CANDIDATES.find((p) => existsSync(p));
if (!browserPath) {
  console.error('No browser binary found.');
  process.exit(1);
}
console.log('[shot] browser:', browserPath);

const BASE = process.env.SHOT_BASE || 'http://localhost:5173';
const VIEWPORT = { width: 720, height: 900 };

const targets = [
  { url: '/', file: 'home-with-tutorial.png', full: true },
  { url: '/tutorial', file: 'tutorial-top.png', full: false },
  { url: '/tutorial', file: 'tutorial-full.png', full: true },
];

const browser = await chromium.launch({
  executablePath: browserPath,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const ctx = await browser.newContext({ viewport: VIEWPORT });
const page = await ctx.newPage();

for (const t of targets) {
  console.log('[shot] ->', t.url, 'as', t.file);
  await page.goto(BASE + t.url, { waitUntil: 'networkidle' });
  // small settle for fonts
  await page.waitForTimeout(400);
  await page.screenshot({
    path: path.join(SHOTS, t.file),
    fullPage: t.full,
  });
}

await browser.close();
console.log('[shot] done.');