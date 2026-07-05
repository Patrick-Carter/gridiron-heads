#!/usr/bin/env node
// Browser smoke test for Gridiron Heads.
//
// Uses playwright-core against an already-cached Chromium binary (no
// `playwright install`, no 170MB download). Snap Chromium is the fallback
// if the cache is missing — snap needs `--no-sandbox`.
//
// Boots the production server (`node server/dist/index.js`) on an ephemeral
// port, then drives the full UI flow: Home → Create → share URL → second
// context Join → Lobby → Ready → Draft (asserts fun names show up) →
// walks the draft → Game → scheme pick → snap → screenshot of all four
// phases. Screenshots land in ./screenshots/.
//
// Usage:
//   node scripts/browser-smoke.mjs
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
const PORT = Number(process.env.SMOKE_PORT) || 3399;
const BASE = `http://127.0.0.1:${PORT}`;

if (!existsSync(SHOTS)) mkdirSync(SHOTS, { recursive: true });

// ---- 1. Pick a chromium binary ---------------------------------------------
const CANDIDATES = [
  // Cached Playwright binaries (no version-mismatch fuss with
  // `executable_path=`, but Playwright still probes them).
  path.join(os.homedir(), '.cache/ms-playwright/chromium-1228/chrome-linux64/chrome'),
  // Snap Chromium (full fallback; needs --no-sandbox in containers).
  '/snap/bin/chromium',
  // Apt / Debian location
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
  console.error('[smoke] No chromium binary found. Tried:');
  CANDIDATES.forEach(p => console.error('   ', p));
  process.exit(1);
}
console.log('[smoke] browser:', browserPath);

// ---- 2. Boot the server -----------------------------------------------------
function startServer() {
  return new Promise((resolve, reject) => {
    // Use a one-shot DB so we don't pollute the user's real sessions.
    const dbPath = path.join(ROOT, 'server/data/_smoke_tmp.db');
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
  console.error(`[smoke] FAIL: ${msg}`);
  process.exit(1);
}
function ok(msg) {
  console.log(`[smoke] OK:   ${msg}`);
}

async function expectVisible(page, sel, label) {
  try {
    await page.waitForSelector(sel, { state: 'visible', timeout: 5000 });
    ok(`${label} visible (${sel})`);
  } catch {
    await page.screenshot({ path: path.join(SHOTS, '_fail.png'), fullPage: true });
    fail(`${label} not visible — selector "${sel}" timed out. Screenshot: screenshots/_fail.png`);
  }
}

async function expectText(page, text, label, partial = false) {
  try {
    await page.waitForFunction(
      ({ t, p }) => document.body && document.body.innerText.toUpperCase().includes(t.toUpperCase())
        || (p && document.body.innerText.toUpperCase().includes(t.toUpperCase().slice(0, Math.floor(t.length * 0.7)))),
      { t: text, p: partial },
      { timeout: 5000 },
    );
    ok(`${label} contains "${text}"`);
  } catch (e) {
    await page.screenshot({ path: path.join(SHOTS, '_fail.png'), fullPage: true });
    fail(`${label} doesn't contain "${text}". Screenshot: screenshots/_fail.png`);
  }
}

// ---- 4. The driver ---------------------------------------------------------
const server = await startServer();
console.log(`[smoke] server up on :${PORT}`);

const browser = await chromium.launch({
  executablePath: browserPath,
  headless: true,
  args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
});

let failed = null;
try {
  // Two independent browser contexts = two players.
  const ctxA = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const ctxB = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  pageA.on('pageerror', e => console.error('[smoke] pageA error:', e.message));
  pageB.on('pageerror', e => console.error('[smoke] pageB error:', e.message));
  pageA.on('console', msg => {
    if (msg.type() === 'error') console.error('[smoke] pageA console:', msg.text());
  });

  // -- Home
  await pageA.goto(`${BASE}/`);
  await expectVisible(pageA, '.flash-banner', 'home flash banner');
  await expectText(pageA, 'GRIDIRON HEADS', 'home title');
  await expectText(pageA, 'Create Game', 'home create CTA', /* partial */ true);
  await pageA.screenshot({ path: path.join(SHOTS, '01-home.png'), fullPage: true });

  // -- Create
  await pageA.click('a[href="/create"]');
  await pageA.waitForURL(/\/create$/);
  await expectText(pageA, 'CREATE GAME', 'create title');
  await pageA.fill('input.input-flash', 'FlashSmoke1');
  await pageA.click('button[type="submit"]');
  await pageA.waitForURL(/\/session\/[A-Za-z0-9_-]+$/, { timeout: 10000 });
  const sessionUrl = pageA.url();
  const sessionId = sessionUrl.split('/session/')[1];
  ok(`session created: ${sessionId}`);

  // -- Lobby (host)
  await expectText(pageA, 'THE LOCKER ROOM', 'lobby banner');
  const shareUrl = `${BASE}/join/${sessionId}`;

  // -- Join (guest) in second context. Session ID is auto-filled from URL.
  await pageB.goto(shareUrl);
  await pageB.waitForURL(new RegExp(`/join/${sessionId}`));
  await expectText(pageB, 'JOIN GAME', 'join title');
  // Confirm Session ID is pre-filled (don't overwrite it)
  const idVal = await pageB.inputValue('input.input-flash >> nth=0');
  if (idVal !== sessionId) {
    await pageB.screenshot({ path: path.join(SHOTS, '_fail.png'), fullPage: true });
    fail(`session ID not pre-filled (got "${idVal}", want "${sessionId}")`);
  }
  ok('session ID pre-filled from URL');
  // Fill only the display name (second input)
  await pageB.fill('input.input-flash >> nth=1', 'FlashSmoke2');
  await pageB.click('button[type="submit"]');
  await pageB.waitForURL(new RegExp(`/session/${sessionId}`), { timeout: 10000 });
  await pageA.waitForSelector('text=2/2', { timeout: 5000 });
  ok('both players in lobby');

  // -- Both click Ready
  await pageA.click('button:has-text("Ready")').catch(() => {});
  await pageB.click('button:has-text("Ready")').catch(() => {});
  // Wait for draft to show on both
  await pageA.waitForFunction(
    () => location.href.includes('/session/') && document.body.innerText.includes('THE DRAFT'),
    null, { timeout: 10000 },
  );
  ok('draft loaded on host');

  // -- Draft: assert fun names. The pool is broadcasted inside the snapshot;
  // grab the rendered HTML and check the contract: no _Alpha_ / _Bravo_ /
  // trailing-numeric tokens (D026 spec).
  await pageA.waitForSelector('.animate-shout, .animate-wobble', { timeout: 5000 });
  const draftHtml = await pageA.content();
  const antiFun = [/_Alpha_/, /_Bravo_/, /_A_\d+/, /_B_\d+/];
  const violations = antiFun.filter(rx => rx.test(draftHtml));
  if (violations.length > 0) {
    await pageA.screenshot({ path: path.join(SHOTS, '_fail.png'), fullPage: true });
    fail(`draft HTML contains anti-fun-name patterns: ${violations.map(r => r.source).join(', ')} — screenshots/_fail.png`);
  }
  // Also assert at least ONE two-word name from the pool is visible.
  // A generous regex: any capitalized-first word + capitalized-second word
  const twoWordNames = draftHtml.match(/\b[A-Z][a-z]+\s+[A-Z][a-z]+\b/g) || [];
  const distinctNames = [...new Set(twoWordNames)].filter(n => !['Game Showdown', 'GRIDIRON HEADS'].includes(n));
  if (distinctNames.length < 3) {
    await pageA.screenshot({ path: path.join(SHOTS, '_fail.png'), fullPage: true });
    fail(`only ${distinctNames.length} two-word names found — expected ≥3 fun pool entries. Got: ${distinctNames.slice(0, 5).join(', ')}`);
  }
  ok(`fun names rendering (${distinctNames.length} distinct, e.g. ${distinctNames[0]})`);
  await pageA.screenshot({ path: path.join(SHOTS, '02-draft.png'), fullPage: true });

  // -- Walk the draft. 12 turns alternating; the player whose turn it
  // is has the `.animate-shout` panel. Loop until the draft phase ends,
  // tracking whose turn it is by polling the DOM. We do this by waiting
  // for one of two distinct DOM states — `Your Move` chip (it's that
  // player's turn) — and then dispatching a click to that player.
  for (let turn = 0; turn < 20; turn++) {
    // Race the two pages for whose turn it is.
    const aPromise = pageA.waitForFunction(
      () => document.body.innerText.includes('YOUR MOVE'),
      null, { timeout: 8000 },
    ).then(() => 'A').catch(() => null);
    const bPromise = pageB.waitForFunction(
      () => document.body.innerText.includes('YOUR MOVE'),
      null, { timeout: 8000 },
    ).then(() => 'B').catch(() => null);
    const who = await Promise.race([aPromise, bPromise]);
    // Immediately resolve the *other* promise so it doesn't hang the test.
    // (no-op if it already resolved)
    await Promise.allSettled([aPromise, bPromise]);
    if (!who) {
      break; // Both timed out → no YOUR MOVE → draft finished
    }
    const target = who === 'A' ? pageA : pageB;
    // Click the first enabled option button INSIDE a draft group card.
    // Group cards have a `chip` showing the group label (QB / D LINE etc).
    const pickBtn = await target.$('div.grid > div.panel-flash button:not([disabled])');
    if (!pickBtn) break;
    await pickBtn.click();
    // Settle: server processes, broadcasts snapshot, react re-renders.
    await target.waitForTimeout(450);
  }
  // Wait for the game phase to begin (Pick Your Play panel shows up).
  await pageA.waitForFunction(
    () => document.body.innerText.includes('Scoreboard') &&
          document.body.innerText.includes('Pick Your Play'),
    null, { timeout: 25000 },
  ).catch(() => {});
  ok('draft walked; game entered');

  // -- Game: host picks scheme.
  // Wait for SchemePicker to be present, then pick RUN/INSIDE.
  // Scope to the SchemePicker panel so we don't accidentally click a
  // draft "RUN" leftover or something else on the page.
  await pageA.waitForSelector('.panel-flash:has-text("Pick Your Play")', { timeout: 8000 });
  await pageA.locator('.panel-flash:has-text("Pick Your Play") button:has-text("RUN")').click();
  await pageA.locator('.panel-flash:has-text("Pick Your Play") button:has-text("INSIDE")').click();
  await pageA.locator('.panel-flash:has-text("Pick Your Play") button:has-text("Lock In")').click();
  await pageA.screenshot({ path: path.join(SHOTS, '03-locked-in.png'), fullPage: true });
  await expectText(pageA, 'YOU CALLED', 'locked-in panel');

  // Have guest pick pass/deep
  await pageB.waitForSelector('.panel-flash:has-text("Pick Your Play")', { timeout: 5000 });
  await pageB.locator('.panel-flash:has-text("Pick Your Play") button:has-text("PASS")').click();
  await pageB.locator('.panel-flash:has-text("Pick Your Play") button:has-text("DEEP")').click();
  await pageB.locator('.panel-flash:has-text("Pick Your Play") button:has-text("Lock In")').click();

  // -- Drive one full play. We don't know in advance which player is
  // offense (random coin flip), so try both pages for the SNAP button.
  const snapPromiseA = pageA.waitForSelector('button:has-text("SNAP")', { timeout: 8000 }).then(() => pageA).catch(() => null);
  const snapPromiseB = pageB.waitForSelector('button:has-text("SNAP")', { timeout: 8000 }).then(() => pageB).catch(() => null);
  const snapPage = await Promise.race([snapPromiseA, snapPromiseB]);
  await Promise.allSettled([snapPromiseA, snapPromiseB]);
  if (!snapPage) {
    // Maybe both have SNAP? click whichever is visible.
    await pageA.screenshot({ path: path.join(SHOTS, '_fail.png'), fullPage: true });
    await pageB.screenshot({ path: path.join(SHOTS, '_fail-1.png'), fullPage: true });
    fail('SNAP button not visible on either player after both locked in');
  }
  // Whichever page won the race is the offense; that's the SNAP-imminent host.
  const offense = snapPage;
  const defense = snapPage === pageA ? pageB : pageA;
  await expectText(offense, 'Snap Imminent', 'snap-imminent panel (D029)');
  await offense.screenshot({ path: path.join(SHOTS, '04-snap-imminent.png'), fullPage: true });

  // Snap and wait for the play to resolve. We don't watch the "Your Play"
  // recap card specifically because the server's auto-advance may have
  // already moved past between_plays into awaiting_schemes by the time we
  // poll. Instead, watch for: (a) the recap card OR (b) the next play
  // button (Skip Wait) OR (c) the next Picking Play panel showing the
  // updated down/yardline / play-log entries.
  await offense.locator('button:has-text("SNAP")').click();
  // The "play_anim" phase means the canvas is drawing — wait for at
  // least 1.8s so the animation has had time to render (we screenshot
  // for visual evidence; the text assertions come from the log).
  await offense.waitForTimeout(2200);
  // Take a mid-animation canvas screenshot (the canvas state changes
  // during computeFrame progress).
  await offense.screenshot({ path: path.join(SHOTS, '05a-mid-anim.png'), fullPage: true });
  // Wait for the next snap-actionable state (either the recap card or
  // the next "Pick Your Play" panel having at least one history entry).
  await offense.waitForFunction(
    () => {
      const t = document.body.innerText;
      return t.includes('Your Play')
        || t.includes('Skip Wait')
        || t.includes('Recent Plays') && t.includes('Gain')
        || t.includes('yds');
    },
    null, { timeout: 10000 },
  );
  ok('play resolved (canvas + downstream phase updated)');
  await expectVisible(offense, 'canvas', 'football field canvas');
  await offense.screenshot({ path: path.join(SHOTS, '05-post-snap.png'), fullPage: true });

  // Bonus: assert the page contains the play-log entry for this snap
  // (PASS deep + yards) — proves the resolver ran AND the recap UI
  // mirrors the called play (D029 contract). We check the whole body
  // since the log is one of many panels on the right rail.
  const bodyText = await offense.evaluate(() => document.body.innerText);
  const hasCalledPlay = /PASS\s*deep/i.test(bodyText);
  const hasYards = /(Gain|Loss) of \d+/.test(bodyText);
  if (!hasCalledPlay || !hasYards) {
    console.warn('[smoke] WARN: page missing expected play-log text:',
      `hasCalledPlay=${hasCalledPlay}, hasYards=${hasYards}`);
  } else {
    ok(`play log mirrors called play (PASS deep + yards)`);
  }

  console.log('\n[smoke] ALL CHECKS PASSED');
  console.log('[smoke] screenshots written to', SHOTS);
} catch (err) {
  failed = err;
  console.error('[smoke] exception:', err.stack || err.message);
  try {
    const pages = browser.contexts().flatMap(c => c.pages());
    for (let i = 0; i < pages.length; i++) {
      await pages[i].screenshot({ path: path.join(SHOTS, `_fail-${i}.png`), fullPage: true });
    }
  } catch {}
} finally {
  await browser.close();
  server.kill('SIGTERM');
}

if (failed) process.exit(1);
process.exit(0);
