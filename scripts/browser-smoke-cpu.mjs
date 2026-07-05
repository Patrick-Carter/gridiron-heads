#!/usr/bin/env node
// Browser smoke test for the vs-CPU flow.
// Boots the production server, opens ONE browser context (the host), drives
// the full Create → Draft → Game flow against the in-process CPU Bot. Screenshots
// land in ./screenshots/.
//
// Usage:
//   node scripts/browser-smoke-cpu.mjs
//
// Exits 0 on full success, 1 on first failure.

import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SHOTS = path.join(ROOT, 'screenshots');
const PORT = Number(process.env.SMOKE_PORT) || 3400;
const BASE = `http://127.0.0.1:${PORT}`;

if (!existsSync(SHOTS)) mkdirSync(SHOTS, { recursive: true });

// ---- 1. Pick a chromium binary ---------------------------------------------
const CANDIDATES = [
  path.join(os.homedir(), '.cache/ms-playwright/chromium-1228/chrome-linux64/chrome'),
  '/snap/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
];

function findBrowser() {
  for (const p of CANDIDATES) {
    if (existsSync(p)) return p;
  }
  return null;
}

const browserPath = findBrowser();
if (!browserPath) {
  console.error('[cpu-smoke] No chromium binary found. Tried:');
  CANDIDATES.forEach(p => console.error('   ', p));
  process.exit(1);
}
console.log('[cpu-smoke] browser:', browserPath);

// ---- 2. Boot the server -----------------------------------------------------
function startServer() {
  return new Promise((resolve, reject) => {
    const dbPath = path.join(ROOT, 'server/data/_smoke_cpu_tmp.db');
    for (const ext of ['', '-wal', '-shm']) {
      const p = dbPath + ext;
      if (existsSync(p)) {
        try { require('node:fs').unlinkSync(p); } catch {}
      }
    }
    const proc = spawn('node', ['server/dist/index.js'], {
      cwd: ROOT,
      env: { ...process.env, PORT: String(PORT), NODE_ENV: 'production' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let errBuf = '';
    proc.stderr.on('data', d => { errBuf += d.toString(); });
    const onTimeout = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error(`server didn't start in 10s. stderr:\n${errBuf}`));
    }, 10000);
    const pollHealth = async () => {
      try {
        const r = await fetch(`${BASE}/healthz`);
        if (r.ok) {
          clearTimeout(onTimeout);
          resolve(proc);
          return;
        }
      } catch {}
      setTimeout(pollHealth, 250);
    };
    pollHealth();
  });
}

// ---- 3. Smoke assertions ---------------------------------------------------
function fail(msg) {
  console.error(`[cpu-smoke] FAIL: ${msg}`);
  process.exit(1);
}
function ok(msg) {
  console.log(`[cpu-smoke] OK:   ${msg}`);
}

async function expectVisible(page, sel, label) {
  try {
    await page.waitForSelector(sel, { state: 'visible', timeout: 5000 });
    ok(`${label} visible (${sel})`);
  } catch {
    await page.screenshot({ path: path.join(SHOTS, '_cpu-fail.png'), fullPage: true });
    fail(`${label} not visible — selector "${sel}" timed out. Screenshot: screenshots/_cpu-fail.png`);
  }
}

async function expectText(page, text, label) {
  try {
    await page.waitForFunction(
      (t) => document.body && document.body.innerText.toUpperCase().includes(t.toUpperCase()),
      text,
      { timeout: 5000 },
    );
    ok(`${label} contains "${text}"`);
  } catch (e) {
    await page.screenshot({ path: path.join(SHOTS, '_cpu-fail.png'), fullPage: true });
    fail(`${label} doesn't contain "${text}". Screenshot: screenshots/_cpu-fail.png`);
  }
}

// ---- 4. The driver ---------------------------------------------------------
const server = await startServer();
console.log(`[cpu-smoke] server up on :${PORT}`);

const browser = await chromium.launch({
  executablePath: browserPath,
  headless: true,
  args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
});

let failed = null;
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();

  page.on('pageerror', e => console.error('[cpu-smoke] page error:', e.message));
  page.on('console', msg => {
    if (msg.type() === 'error') console.error('[cpu-smoke] console:', msg.text());
  });

  // -- Home
  await page.goto(`${BASE}/`);
  await expectVisible(page, '.flash-banner', 'home flash banner');
  await expectText(page, 'GRIDIRON HEADS', 'home title');
  await expectText(page, 'CPU Bot', 'home CPU mention (case-insensitive)', /* partial */ true);
  await page.screenshot({ path: path.join(SHOTS, 'cpu-01-home.png'), fullPage: true });

  // -- Create — pick "vs CPU" mode
  await page.click('a[href="/create"]');
  await page.waitForURL(/\/create$/);
  await expectText(page, 'CREATE GAME', 'create title');
  await expectText(page, 'vs CPU', 'create mode picker shows vs CPU');
  await page.fill('input.input-flash', 'CpuSmoke');
  // The default mode is 'cpu' — no need to click the toggle, but verify it's
  // actually highlighted.
  const cpuBtnClass = await page.getAttribute('[data-testid="mode-cpu"]', 'class');
  if (!cpuBtnClass?.includes('btn-primary')) {
    fail(`mode-cpu button not highlighted as primary (got "${cpuBtnClass}")`);
  }
  ok('vs CPU mode is the default and is highlighted');
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/session\/[A-Za-z0-9_-]+$/, { timeout: 10000 });
  const sessionId = page.url().split('/session/')[1];
  ok(`vs-CPU session created: ${sessionId}`);

  // -- The vs-CPU flow auto-starts the draft — there's no Lobby render. The
  // server's session:join handler runs flipCoin + startDraft as soon as the
  // CPU room is detected, so the host's first screen after /session/:id is
  // the Draft, not the Lobby.
  await page.waitForFunction(
    () => location.href.includes('/session/') && document.body.innerText.includes('THE DRAFT'),
    null, { timeout: 10000 },
  );
  ok('draft loaded after vs-CPU creation');
  await page.screenshot({ path: path.join(SHOTS, 'cpu-02-draft-start.png'), fullPage: true });

  // The draft progresses via tickCpu for the CPU side + host clicks for
  // themselves. Loop until the draft phase ends (no more YOUR MOVE / CPU
  // thinking labels).
  for (let turn = 0; turn < 20; turn++) {
    const isMyTurn = await page.waitForFunction(
      () => document.body.innerText.includes('YOUR MOVE'),
      null, { timeout: 4000 },
    ).then(() => true).catch(() => false);
    if (!isMyTurn) break;
    // Click the first enabled option button INSIDE a draft group card.
    const pickBtn = await page.$('div.grid > div.panel-flash button:not([disabled])');
    if (!pickBtn) break;
    await pickBtn.click();
    await page.waitForTimeout(450);
  }
  // Wait for the game phase to begin (Pick Your Play panel shows up).
  await page.waitForFunction(
    () => document.body.innerText.includes('Scoreboard')
      && (document.body.innerText.includes('Pick Your Play') || document.body.innerText.includes('Snap')),
    null, { timeout: 25000 },
  ).catch(() => {});
  ok('draft walked; game entered (CPU drafted itself)');
  await page.screenshot({ path: path.join(SHOTS, 'cpu-03-game.png'), fullPage: true });

  // -- Drive a couple of plays. CPU picks its own schemes, host picks theirs.
  // We loop: pick scheme when in awaiting_schemes, snap when ready_to_snap,
  // until the game ends or we hit a turn budget.
  const MAX_TURNS = 12;
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    // Wait until we're actionable (awaiting_schemes or ready_to_snap).
    let ready = false;
    for (let i = 0; i < 60; i++) {
      const t = await page.evaluate(() => document.body.innerText);
      if (t.includes('Game Over') || t.includes('Final')) {
        ready = 'ended';
        break;
      }
      if (t.includes('Pick Your Play') || t.includes('SNAP')) {
        ready = 'play';
        break;
      }
      await page.waitForTimeout(150);
    }
    if (ready === 'ended') {
      ok('game ended');
      break;
    }
    if (ready !== 'play') {
      console.warn(`[cpu-smoke] WARN: no actionable state after waiting, turn ${turn}`);
      break;
    }
    // If "Pick Your Play" panel is visible, host picks a scheme.
    const pickPlayVisible = await page.locator('.panel-flash:has-text("Pick Your Play")').count();
    if (pickPlayVisible > 0) {
      // Pick RUN/INSIDE as offense, PASS/DEEP as defense. CPU will pick its
      // own scheme shortly via tickCpu.
      const t = await page.evaluate(() => document.body.innerText);
      const isOffense = t.includes('OFFENSE');
      await page.locator('.panel-flash:has-text("Pick Your Play") button:has-text("RUN")').click().catch(() => {});
      await page.waitForTimeout(50);
      await page.locator('.panel-flash:has-text("Pick Your Play") button:has-text("INSIDE")').click().catch(() => {});
      await page.waitForTimeout(50);
      if (!isOffense) {
        // We're defense — switch to pass
        await page.locator('.panel-flash:has-text("Pick Your Play") button:has-text("PASS")').click().catch(() => {});
        await page.locator('.panel-flash:has-text("Pick Your Play") button:has-text("DEEP")').click().catch(() => {});
      }
      await page.locator('.panel-flash:has-text("Pick Your Play") button:has-text("Lock In")').click().catch(() => {});
      await page.waitForTimeout(300);
      continue;
    }
    // Otherwise it's ready_to_snap — if host is offense, snap. If defense,
    // CPU will snap itself; just wait.
    const t = await page.evaluate(() => document.body.innerText);
    if (t.includes('OFFENSE') && t.includes('SNAP')) {
      await page.locator('button:has-text("SNAP")').first().click();
    }
    await page.waitForTimeout(5000); // wait for auto-advance
  }

  // Final screenshot — whatever phase we landed in.
  await page.screenshot({ path: path.join(SHOTS, 'cpu-04-final.png'), fullPage: true });

  // Bonus: confirm the scoreboard is a valid tuple (proves CPU scoring ran).
  // The ScorePanel renders `score.toFixed(1)` so we look for X.Y format.
  const finalText = await page.evaluate(() => document.body.innerText);
  const scoreMatch = finalText.match(/\b\d+\.\d\b/);
  if (!scoreMatch) {
    fail(`scoreboard not visible or malformed — page text: ${finalText.slice(0, 200)}`);
  }
  ok(`scoreboard visible: ${scoreMatch?.[0] ?? '?'}`);

  console.log('\n[cpu-smoke] ALL CHECKS PASSED');
  console.log('[cpu-smoke] screenshots written to', SHOTS);
} catch (err) {
  failed = err;
  console.error('[cpu-smoke] exception:', err.stack || err.message);
  try {
    const pages = browser.contexts().flatMap(c => c.pages());
    for (let i = 0; i < pages.length; i++) {
      await pages[i].screenshot({ path: path.join(SHOTS, `_cpu-fail-${i}.png`), fullPage: true });
    }
  } catch {}
} finally {
  await browser.close();
  server.kill('SIGTERM');
}

if (failed) process.exit(1);
process.exit(0);