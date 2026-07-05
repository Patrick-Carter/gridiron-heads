// dev_render.ts — render the canvas with a fake playResult to a PNG so the
// pixel-art field can be eyeballed without a 2-player game.
//
// Usage:  npx tsx scripts/dev_render.ts
// Output: dev_render.png in the repo root.

import { writeFileSync } from 'fs';
import { createCanvas } from 'canvas';
// We re-implement the relevant Field.tsx drawing functions locally so this
// script has zero React dependencies (just node-canvas via the npm `canvas`
// package). For CI / portability we fall back to a pure-JS implementation
// when `canvas` isn't installed.

// First try the real `canvas` package; if it fails, print a hint and exit.
let canvasPkg: any;
try {
  canvasPkg = require('canvas');
} catch {
  console.error(
    'dev_render.ts needs the `canvas` npm package. Install with:\n' +
    '  npm install --no-save canvas\n' +
    'or render the field via the browser at http://localhost:5173.',
  );
  process.exit(1);
}

// === Mirror of the relevant Field.tsx drawing code (no React) =================
// Kept in sync with Field.tsx — if you change one, change the other.
// Inlined here to avoid pulling in React + the full Field component for a CLI script.

const FIELD_W = 480;
const FIELD_H = 270;
const YARD = FIELD_W / 100;
const ENDZONE_W = 10 * YARD;
const SCOREBOARD_H = 20;
const CROWD_H = 8;
const FIELD_TOP = SCOREBOARD_H + CROWD_H;
const FIELD_BOTTOM = FIELD_H - CROWD_H;
const PLAYABLE_H = FIELD_BOTTOM - FIELD_TOP;

const COLORS = {
  ink: '#0a0a18', cream: '#fff8dc', yellow: '#ffd400', lime: '#c8ff00',
  maroon: '#c8102e', sky: '#00bfff',
  greenA: '#1a6e3c', greenB: '#0e4a28', greenDarkest: '#082d18',
  yardLine: 'rgba(255,255,255,0.85)', yardLineMid: 'rgba(255,255,255,0.95)',
  hash: 'rgba(255,255,255,0.65)', yardNumber: '#fff8dc',
  midfieldLogo: '#5b2a0a', midfieldLogoLace: '#fff8dc',
  goalpost: '#ffd400', goalpostShadow: '#7a5a00',
  crowdBg: '#1d0a3d', crowdSkinA: '#f5d0a9', crowdSkinB: '#cba07a',
  scoreboardBg: '#ffd400', scoreboardBorder: '#0a0a18', scoreboardShadow: '#c8102e',
  scoreboardInk: '#0a0a18', outline: '#0a0a18',
  t0Helmet: '#ffd400', t0Shoulder: '#c8ff00', t0Jersey: '#fff8dc',
  t0Pants: '#0a0a18', t0Accent: '#c8102e',
  t1Helmet: '#0a0a18', t1Shoulder: '#00bfff', t1Jersey: '#c8102e',
  t1Pants: '#fff8dc', t1Accent: '#ffd400',
};

// (Reuse the FONT_3x5 from Field.tsx via require — but Field.tsx is React JSX,
// so we can't import it cleanly. Inline the font here.)

const FONT_3x5: Record<string, string> = {
  'A': '.X.|X.X|XXX|X.X|X.X', 'B': 'XX.|X.X|XX.|X.X|XX.',
  'C': '.XX|X..|X..|X..|.XX', 'D': 'XX.|X.X|X.X|X.X|XX.',
  'E': 'XXX|X..|XX.|X..|XXX', 'F': 'XXX|X..|XX.|X..|X..',
  'G': '.XX|X..|X.X|X.X|.X.', 'H': 'X.X|X.X|XXX|X.X|X.X',
  'I': 'XXX|.X.|.X.|.X.|XXX', 'J': '.XX|..X|..X|X.X|.X.',
  'K': 'X.X|X.X|XX.|X.X|X.X', 'L': 'X..|X..|X..|X..|XXX',
  'M': 'X.X|XXX|X.X|X.X|X.X', 'N': 'X.X|XXX|XXX|XXX|X.X',
  'O': '.X.|X.X|X.X|X.X|.X.', 'P': 'XX.|X.X|XX.|X..|X..',
  'Q': '.X.|X.X|X.X|XX.|.XX', 'R': 'XX.|X.X|XX.|X.X|X.X',
  'S': '.XX|X..|.X.|..X|XX.', 'T': 'XXX|.X.|.X.|.X.|.X.',
  'U': 'X.X|X.X|X.X|X.X|.X.', 'V': 'X.X|X.X|X.X|X.X|.X.',
  'W': 'X.X|X.X|X.X|XXX|X.X', 'X': 'X.X|X.X|.X.|X.X|X.X',
  'Y': 'X.X|X.X|.X.|.X.|.X.', 'Z': 'XXX|..X|.X.|X..|XXX',
  '0': 'XXX|X.X|X.X|X.X|XXX', '1': '.X.|XX.|.X.|.X.|XXX',
  '2': 'XX.|..X|.X.|X..|XXX', '3': 'XX.|..X|.X.|..X|XX.',
  '4': 'X.X|X.X|XXX|..X|..X', '5': 'XXX|X..|XX.|..X|XX.',
  '6': '.XX|X..|XX.|X.X|.X.', '7': 'XXX|..X|.X.|X..|X..',
  '8': '.X.|X.X|.X.|X.X|.X.', '9': '.X.|X.X|.XX|..X|XX.',
  ' ': '...|...|...|...|...', '.': '...|...|...|...|.X.',
};

function drawText(ctx: any, text: string, x: number, y: number, color: string, scale = 1, spacing = 1): number {
  text = text.toUpperCase();
  ctx.fillStyle = color;
  let cx = x;
  for (const ch of text) {
    const glyph = FONT_3x5[ch] ?? FONT_3x5[' '];
    const rows = glyph.split('|');
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      for (let c = 0; c < row.length; c++) {
        if (row[c] === 'X') ctx.fillRect(cx + c * scale, y + r * scale, scale, scale);
      }
    }
    cx += (3 + spacing) * scale;
  }
  return cx;
}

function textWidth(text: string, scale = 1, spacing = 1): number {
  return text.length * (3 + spacing) * scale - spacing * scale;
}

function crowdPixel(x: number, y: number, seed = 1337): boolean {
  let h = (x * 374761393 + y * 668265263 + seed * 1274126177) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  h = h ^ (h >>> 16);
  return ((h >>> 8) & 0xff) > 130;
}

function drawCrowdBand(ctx: any, y: number) {
  ctx.fillStyle = COLORS.crowdBg;
  ctx.fillRect(0, y, FIELD_W, CROWD_H);
  for (let py = y; py < y + CROWD_H; py++) {
    for (let px = 0; px < FIELD_W; px++) {
      if (!crowdPixel(px, py)) continue;
      const r = py - y;
      const palette = r < CROWD_H / 2
        ? [COLORS.crowdSkinA, COLORS.crowdSkinB, COLORS.cream, '#a07050', '#704030']
        : [COLORS.maroon, COLORS.yellow, COLORS.lime, COLORS.sky, COLORS.cream, '#704080'];
      ctx.fillStyle = palette[(px + py) % palette.length];
      ctx.fillRect(px, py, 1, 1);
    }
  }
}

function drawScoreboard(ctx: any, homeName: string, awayName: string, homeScore: number, awayScore: number) {
  ctx.fillStyle = COLORS.scoreboardBg;
  ctx.fillRect(0, 0, FIELD_W, SCOREBOARD_H);
  ctx.fillStyle = COLORS.scoreboardBorder;
  ctx.fillRect(0, 0, FIELD_W, 1);
  ctx.fillRect(0, SCOREBOARD_H - 1, FIELD_W, 1);
  ctx.fillStyle = COLORS.scoreboardShadow;
  ctx.fillRect(0, SCOREBOARD_H, FIELD_W, 1);
  const textY = 6;
  const homeLabel = homeName.length <= 10 ? homeName : homeName.slice(0, 9) + '.';
  drawText(ctx, homeLabel, 6, textY, COLORS.scoreboardInk);
  const homeScoreStr = homeScore.toFixed(1);
  drawText(ctx, homeScoreStr, 96, textY, COLORS.scoreboardInk);
  drawText(ctx, 'VS', 232, textY, COLORS.maroon);
  const awayScoreStr = awayScore.toFixed(1);
  const awayScoreW = textWidth(awayScoreStr);
  drawText(ctx, awayScoreStr, FIELD_W - 6 - awayScoreW, textY, COLORS.scoreboardInk);
  const awayLabel = awayName.length <= 10 ? awayName : awayName.slice(0, 9) + '.';
  const awayLabelW = textWidth(awayLabel);
  drawText(ctx, awayLabel, FIELD_W - 6 - awayLabelW, textY, COLORS.scoreboardInk);
}

function drawFieldBase(ctx: any, ballYardline: number, direction: 1 | -1, homeName: string, awayName: string) {
  ctx.fillStyle = COLORS.greenB;
  ctx.fillRect(0, FIELD_TOP, FIELD_W, PLAYABLE_H);
  const stripeW = 5 * YARD;
  for (let i = 0; i < 20; i++) {
    if (i % 2 === 0) continue;
    const x = Math.floor(i * stripeW);
    ctx.fillStyle = COLORS.greenA;
    ctx.fillRect(x, FIELD_TOP, Math.ceil(stripeW), PLAYABLE_H);
  }
  const rightEndPx = FIELD_W - ENDZONE_W;
  ctx.fillStyle = COLORS.greenDarkest;
  ctx.fillRect(0, FIELD_TOP, ENDZONE_W, PLAYABLE_H);
  ctx.fillRect(rightEndPx, FIELD_TOP, ENDZONE_W, PLAYABLE_H);
  ctx.fillStyle = 'rgba(255, 212, 0, 0.10)';
  ctx.fillRect(0, FIELD_TOP, ENDZONE_W, PLAYABLE_H);
  ctx.fillStyle = 'rgba(200, 16, 46, 0.10)';
  ctx.fillRect(rightEndPx, FIELD_TOP, ENDZONE_W, PLAYABLE_H);
  ctx.fillStyle = COLORS.yellow;
  ctx.fillRect(0, FIELD_TOP, 1, PLAYABLE_H);
  ctx.fillRect(FIELD_W - 1, FIELD_TOP, 1, PLAYABLE_H);
  drawEndZoneText(ctx, homeName, 0, ENDZONE_W, true);
  drawEndZoneText(ctx, awayName, rightEndPx, ENDZONE_W, false);
  drawGoalpost(ctx, 2);
  drawGoalpost(ctx, rightEndPx - 3);
  for (let yd = 10; yd < 100; yd += 10) {
    const x = Math.round((yd / 100) * FIELD_W);
    const is50 = yd === 50;
    ctx.fillStyle = is50 ? COLORS.yardLineMid : COLORS.yardLine;
    ctx.fillRect(x, FIELD_TOP, 1, PLAYABLE_H);
  }
  for (let yd = 10; yd < 100; yd += 10) {
    if (yd === 50) continue;
    const x = Math.round((yd / 100) * FIELD_W);
    const numStr = String(yd);
    const topY = FIELD_TOP + 6;
    const botY = FIELD_BOTTOM - 11;
    drawText(ctx, numStr, x - textWidth(numStr) / 2, topY, COLORS.yardNumber);
    drawText(ctx, numStr, x - textWidth(numStr) / 2, botY, COLORS.yardNumber);
  }
  // Midfield logo
  const cx = Math.round((50 / 100) * FIELD_W);
  const cy = Math.round(FIELD_TOP + PLAYABLE_H / 2);
  ctx.fillStyle = COLORS.midfieldLogo;
  for (let dx = -8; dx <= 8; dx++) {
    const dy = Math.round(3 * Math.cos((dx / 8) * Math.PI / 2));
    ctx.fillRect(cx + dx, cy - dy, 1, dy * 2 + 1);
  }
  ctx.fillStyle = COLORS.midfieldLogoLace;
  ctx.fillRect(cx + 2, cy - 3, 5, 1);
  ctx.fillRect(cx + 2, cy + 3, 5, 1);
  for (let i = 0; i < 3; i++) {
    ctx.fillRect(cx + 3 + i * 2, cy - 1, 1, 3);
  }
  // Hash marks
  ctx.fillStyle = COLORS.hash;
  for (let yd = 1; yd < 100; yd++) {
    if (yd % 10 === 0) continue;
    const x = Math.round((yd / 100) * FIELD_W);
    ctx.fillRect(x, FIELD_TOP + PLAYABLE_H * 0.32, 1, 4);
    ctx.fillRect(x, FIELD_TOP + PLAYABLE_H * 0.65, 1, 4);
  }
  // LOS
  if (ballYardline > 0 && ballYardline < 100) {
    const losX = Math.round((ballYardline / 100) * FIELD_W);
    ctx.fillStyle = COLORS.yellow;
    for (let py = FIELD_TOP; py < FIELD_BOTTOM; py += 4) {
      ctx.fillRect(losX, py, 1, 2);
    }
    drawText(ctx, 'LOS', losX + 3, FIELD_TOP + 2, COLORS.yellow);
    const fdYard = ballYardline + 10 * direction;
    if (fdYard > 0 && fdYard < 100) {
      const fdX = Math.round((fdYard / 100) * FIELD_W);
      ctx.fillStyle = COLORS.goalpost;
      for (let py = FIELD_TOP; py < FIELD_BOTTOM; py += 4) {
        ctx.fillRect(fdX, py, 1, 2);
      }
      drawText(ctx, '1ST', fdX + 3, FIELD_BOTTOM - 9, COLORS.goalpost);
    }
  }
}

function drawEndZoneText(ctx: any, name: string, endZoneX: number, endZoneW: number, isLeft: boolean) {
  const text = (name.length <= 8 ? name : name.slice(0, 7) + '.').toUpperCase();
  const charH = 6;
  const totalH = text.length * charH;
  const startY = FIELD_TOP + (PLAYABLE_H - totalH) / 2;
  const charW = 4;
  const startX = endZoneX + (endZoneW - charW) / 2;
  for (let i = 0; i < text.length; i++) {
    drawText(ctx, text[i], startX, startY + i * charH, COLORS.yardNumber);
  }
}

function drawGoalpost(ctx: any, xBase: number) {
  ctx.fillStyle = COLORS.goalpostShadow;
  ctx.fillRect(xBase, FIELD_TOP + 2, 1, 12);
  ctx.fillRect(xBase + 3, FIELD_TOP + 2, 1, 12);
  ctx.fillStyle = COLORS.goalpost;
  ctx.fillRect(xBase + 1, FIELD_TOP + 2, 1, 12);
  ctx.fillRect(xBase + 4, FIELD_TOP + 2, 1, 12);
  ctx.fillStyle = COLORS.goalpostShadow;
  ctx.fillRect(xBase, FIELD_TOP + 2, 5, 1);
  ctx.fillStyle = COLORS.goalpost;
  ctx.fillRect(xBase + 1, FIELD_TOP + 1, 4, 1);
}

function drawStatusBar(ctx: any, down: number, distance: number, ballYardline: number, direction: 1 | -1) {
  const STATUS_BAR_Y = FIELD_BOTTOM + CROWD_H;
  ctx.fillStyle = COLORS.ink;
  ctx.fillRect(0, STATUS_BAR_Y, FIELD_W, FIELD_H - STATUS_BAR_Y);
  const textY = STATUS_BAR_Y + 7;
  const downStr = down === 1 ? '1ST' : down === 2 ? '2ND' : down === 3 ? '3RD' : '4TH';
  drawText(ctx, downStr, 8, textY, COLORS.yellow);
  const dnW = textWidth(downStr);
  drawText(ctx, '& ' + distance, 8 + dnW + 6, textY, COLORS.cream);
  const ownYard = direction === 1 ? ballYardline : 100 - ballYardline;
  const spot = `AT OWN ${ownYard}`;
  const spotW = textWidth(spot);
  drawText(ctx, spot, (FIELD_W - spotW) / 2, textY, COLORS.cream);
  const arrow = direction === 1 ? 'ATTACK >>>' : '<<< ATTACK';
  const arrowW = textWidth(arrow);
  drawText(ctx, arrow, FIELD_W - 8 - arrowW, textY, COLORS.lime);
}

// === Render ==================================================================
const canvas = createCanvas(FIELD_W, FIELD_H);
const ctx = canvas.getContext('2d');

drawScoreboard(ctx, 'ALICE', 'BOB', 1.5, 2.0);
drawCrowdBand(ctx, SCOREBOARD_H);
drawFieldBase(ctx, 35, 1, 'ALICE', 'BOB');
drawCrowdBand(ctx, FIELD_BOTTOM);
drawStatusBar(ctx, 2, 7, 35, 1);

const buf = canvas.toBuffer('image/png');
writeFileSync('dev_render.png', buf);
console.log('Wrote dev_render.png — open it to eyeball the new field.');