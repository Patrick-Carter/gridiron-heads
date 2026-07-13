import { useEffect, useRef } from 'react';
import type { PlayResult } from '@gridiron/shared';
import {
  buildPlayPlan,
  effectsBetween,
  frameAt,
  type OutcomeBanner,
  type PlayEffect,
  type PlayFrame,
  type PlayPlan,
  type PlayerSprite,
  type SpritePose,
} from './playAnimation.js';

// =============================================================================
// BROWSER BOWL — Field renderer
//
// Retro Bowl-style top-down pixel-art field. The canvas is intentionally
// rendered at a LOW internal resolution (480x270) and upscaled by CSS with
// `image-rendering: pixelated`. This produces the chunky, sharp pixel-art
// look characteristic of early-2010s mobile sports games.
//
// Layout (480x270):
//   y=0  .. y=20  : SCOREBOARD RIBBON  (team names + scores)
//   y=20 .. y=28  : CROWD BAND TOP     (dark + noise pixels)
//   y=28 .. y=242 : MAIN FIELD         (green stripes, numbers, hashes, mid logo)
//   y=242 .. y=250: CROWD BAND BOTTOM
//   y=250 .. y=270 : STATUS BAR        (down/distance/ball spot)
//
// Coordinate system (unchanged from D-n): ball_yardline is absolute 0..100,
// with the LOS drawn at x = (yardline/100) * FIELD_W. Each end zone occupies
// the back 10 yards of the field (48px each side). The direction of attack
// is flipped via the `direction` multiplier on xOffsetYards, NOT by mirroring
// the canvas — labels and yard numbers stay readable from either direction.
// =============================================================================

// =============== Constants ====================================================
const FIELD_W = 480;
const FIELD_H = 270;
const YARD = FIELD_W / 100; // 4.8 px per yard
const ENDZONE_W = 10 * YARD; // 48px

const SCOREBOARD_H = 20;
const CROWD_H = 8;
const FIELD_TOP = SCOREBOARD_H + CROWD_H; // 28
const FIELD_BOTTOM = 242;
const PLAYABLE_H = FIELD_BOTTOM - FIELD_TOP;
const STATUS_BAR_Y = FIELD_BOTTOM + CROWD_H;
const STATUS_BAR_H = FIELD_H - STATUS_BAR_Y;

// =============== Palette ======================================================
const COLORS = {
  ink: '#0a0a18',
  cream: '#fff8dc',
  yellow: '#ffd400',
  lime: '#c8ff00',
  maroon: '#c8102e',
  sky: '#00bfff',
  // Field greens
  greenA: '#1a6e3c', // light stripe
  greenB: '#0e4a28', // dark stripe
  greenDarkest: '#082d18',
  // Lines / marks
  yardLine: 'rgba(255,255,255,0.85)',
  yardLineMid: 'rgba(255,255,255,0.95)',
  hash: 'rgba(255,255,255,0.65)',
  yardNumber: '#fff8dc',
  midfieldLogo: '#5b2a0a',
  midfieldLogoLace: '#fff8dc',
  // Goalposts / end zones
  goalpost: '#ffd400',
  goalpostShadow: '#7a5a00',
  // Crowd
  crowdBg: '#1d0a3d',
  crowdSkinA: '#f5d0a9',
  crowdSkinB: '#cba07a',
  // Scoreboard
  scoreboardBg: '#ffd400',
  scoreboardBorder: '#0a0a18',
  scoreboardShadow: '#c8102e',
  scoreboardInk: '#0a0a18',
  // Player outlines
  outline: '#0a0a18',
  // Team 0 (home — cream/lime uniform)
  t0Helmet: '#ffd400',
  t0Shoulder: '#c8ff00',
  t0Jersey: '#fff8dc',
  t0Pants: '#0a0a18',
  t0Accent: '#c8102e',
  // Team 1 (away — maroon/sky uniform)
  t1Helmet: '#0a0a18',
  t1Shoulder: '#00bfff',
  t1Jersey: '#c8102e',
  t1Pants: '#fff8dc',
  t1Accent: '#ffd400',
};

interface TeamPalette {
  helmet: string;
  shoulder: string;
  jersey: string;
  pants: string;
  accent: string;
}

const TEAM_PALETTES: [TeamPalette, TeamPalette] = [
  { helmet: COLORS.t0Helmet, shoulder: COLORS.t0Shoulder, jersey: COLORS.t0Jersey, pants: COLORS.t0Pants, accent: COLORS.t0Accent },
  { helmet: COLORS.t1Helmet, shoulder: COLORS.t1Shoulder, jersey: COLORS.t1Jersey, pants: COLORS.t1Pants, accent: COLORS.t1Accent },
];

// =============== 3x5 pixel font ==============================================
// Each character is a 3-wide × 5-tall bitmap. '.' = transparent, 'X' = pixel.
// Space = empty 3x5 (no render). We use this for end-zone text + status bar.
const FONT_3x5: Record<string, string> = {
  'A': '.X.|X.X|XXX|X.X|X.X',
  'B': 'XX.|X.X|XX.|X.X|XX.',
  'C': '.XX|X..|X..|X..|.XX',
  'D': 'XX.|X.X|X.X|X.X|XX.',
  'E': 'XXX|X..|XX.|X..|XXX',
  'F': 'XXX|X..|XX.|X..|X..',
  'G': '.XX|X..|X.X|X.X|.X.',
  'H': 'X.X|X.X|XXX|X.X|X.X',
  'I': 'XXX|.X.|.X.|.X.|XXX',
  'J': '.XX|..X|..X|X.X|.X.',
  'K': 'X.X|X.X|XX.|X.X|X.X',
  'L': 'X..|X..|X..|X..|XXX',
  'M': 'X.X|XXX|X.X|X.X|X.X',
  'N': 'X.X|XXX|XXX|XXX|X.X',
  'O': '.X.|X.X|X.X|X.X|.X.',
  'P': 'XX.|X.X|XX.|X..|X..',
  'Q': '.X.|X.X|X.X|XX.|.XX',
  'R': 'XX.|X.X|XX.|X.X|X.X',
  'S': '.XX|X..|.X.|..X|XX.',
  'T': 'XXX|.X.|.X.|.X.|.X.',
  'U': 'X.X|X.X|X.X|X.X|.X.',
  'V': 'X.X|X.X|X.X|X.X|.X.',
  'W': 'X.X|X.X|X.X|XXX|X.X',
  'X': 'X.X|X.X|.X.|X.X|X.X',
  'Y': 'X.X|X.X|.X.|.X.|.X.',
  'Z': 'XXX|..X|.X.|X..|XXX',
  '0': 'XXX|X.X|X.X|X.X|XXX',
  '1': '.X.|XX.|.X.|.X.|XXX',
  '2': 'XX.|..X|.X.|X..|XXX',
  '3': 'XX.|..X|.X.|..X|XX.',
  '4': 'X.X|X.X|XXX|..X|..X',
  '5': 'XXX|X..|XX.|..X|XX.',
  '6': '.XX|X..|XX.|X.X|.X.',
  '7': 'XXX|..X|.X.|X..|X..',
  '8': '.X.|X.X|.X.|X.X|.X.',
  '9': '.X.|X.X|.XX|..X|XX.',
  ' ': '...|...|...|...|...',
  '.': '...|...|...|...|.X.',
  '!': '.X.|.X.|.X.|...|.X.',
  '+': '...|.X.|XXX|.X.|...',
  '-': '...|...|XXX|...|...',
  '/': '..X|..X|.X.|X..|X..',
};

/** Draw text using the 3x5 font. `spacing` controls gap between chars (px).
 *  Returns the x position after the last char (useful for inline layout). */
function drawText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  color: string,
  scale = 1,
  spacing = 1,
): number {
  text = text.toUpperCase();
  ctx.fillStyle = color;
  let cx = x;
  for (const ch of text) {
    const glyph = FONT_3x5[ch] ?? FONT_3x5[' '];
    const rows = glyph.split('|');
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      for (let c = 0; c < row.length; c++) {
        if (row[c] === 'X') {
          ctx.fillRect(cx + c * scale, y + r * scale, scale, scale);
        }
      }
    }
    cx += (3 + spacing) * scale;
  }
  return cx;
}

/** Measure text width in px (for centering/right-aligning). */
function textWidth(text: string, scale = 1, spacing = 1): number {
  if (!text) return 0;
  return text.length * (3 + spacing) * scale - spacing * scale;
}

// =============== Pixel-art player sprites ====================================
// Each sprite is drawn at a fixed size (SPRITE_SIZE x SPRITE_SIZE) using
// fillRect. Position-specific helmet silhouettes distinguish roles at a glance.

const SPRITE_SIZE = 10; // 10x10 sprite → ~2 yards wide at 4.8 px/yard

type SpriteConfig = {
  helmet: string;
  shoulder: string;
  jersey: string;
  pants: string;
  accent: string;
  /** Helmet style: 'round' (D-line), 'flat' (O-line), 'small' (QB), 'big' (RB). */
  helmetStyle: 'round' | 'flat' | 'small' | 'big';
  /** Whether to draw a visor mark on the helmet. */
  visor: boolean;
  /** Whether to draw jersey numbers. */
  showNumber?: boolean;
  /** Jersey number to draw (1-2 digits). */
  number?: number;
};

/** Draw a single player sprite at (x, y) — top-left corner of the sprite box. */
function drawSprite(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  cfg: SpriteConfig,
) {
  // Helper that paints one pixel-square at sprite-relative coords.
  const px = (rx: number, ry: number, c: string) => {
    if (rx < 0 || ry < 0 || rx >= SPRITE_SIZE || ry >= SPRITE_SIZE) return;
    ctx.fillStyle = c;
    ctx.fillRect(x + rx, y + ry, 1, 1);
  };

  // 1. Helmet — varies by style. All centered at x=3..6, y=0..3.
  switch (cfg.helmetStyle) {
    case 'round': // D-line: wider rounded helmet
      px(3, 0, COLORS.outline);
      px(4, 0, COLORS.outline);
      px(5, 0, COLORS.outline);
      px(2, 1, cfg.helmet); px(3, 1, cfg.helmet); px(4, 1, cfg.helmet);
      px(5, 1, cfg.helmet); px(6, 1, cfg.helmet); px(7, 1, COLORS.outline);
      px(2, 2, cfg.helmet); px(3, 2, COLORS.outline); px(4, 2, COLORS.outline);
      px(5, 2, COLORS.outline); px(6, 2, cfg.helmet); px(7, 2, COLORS.outline);
      px(3, 3, cfg.helmet); px(4, 3, cfg.helmet); px(5, 3, cfg.helmet); px(6, 3, COLORS.outline);
      break;
    case 'flat': // O-line: tall flat-top helmet (5-wide block)
      px(3, 0, COLORS.outline); px(4, 0, COLORS.outline); px(5, 0, COLORS.outline); px(6, 0, COLORS.outline);
      px(2, 1, cfg.helmet); px(3, 1, cfg.helmet); px(4, 1, cfg.helmet);
      px(5, 1, cfg.helmet); px(6, 1, cfg.helmet); px(7, 1, COLORS.outline);
      px(2, 2, cfg.helmet); px(3, 2, COLORS.outline); px(4, 2, COLORS.outline);
      px(5, 2, COLORS.outline); px(6, 2, cfg.helmet); px(7, 2, COLORS.outline);
      px(2, 3, cfg.helmet); px(3, 3, cfg.helmet); px(4, 3, cfg.helmet);
      px(5, 3, cfg.helmet); px(6, 3, cfg.helmet); px(7, 3, COLORS.outline);
      break;
    case 'small': // QB: smaller helmet with visor mark
      px(4, 0, COLORS.outline); px(5, 0, COLORS.outline);
      px(3, 1, cfg.helmet); px(4, 1, cfg.helmet); px(5, 1, cfg.helmet); px(6, 1, COLORS.outline);
      px(3, 2, cfg.helmet); px(4, 2, COLORS.outline); px(5, 2, COLORS.outline); px(6, 2, COLORS.outline);
      px(3, 3, cfg.helmet); px(4, 3, cfg.helmet); px(5, 3, cfg.helmet); px(6, 3, COLORS.outline);
      break;
    case 'big': // RB: bigger, rounder body
      px(2, 0, COLORS.outline); px(3, 0, COLORS.outline);
      px(4, 0, COLORS.outline); px(5, 0, COLORS.outline); px(6, 0, COLORS.outline); px(7, 0, COLORS.outline);
      px(2, 1, cfg.helmet); px(3, 1, cfg.helmet); px(4, 1, cfg.helmet);
      px(5, 1, cfg.helmet); px(6, 1, cfg.helmet); px(7, 1, cfg.helmet); px(8, 1, COLORS.outline);
      px(2, 2, cfg.helmet); px(3, 2, COLORS.outline); px(4, 2, COLORS.outline);
      px(5, 2, COLORS.outline); px(6, 2, cfg.helmet); px(7, 2, cfg.helmet); px(8, 2, COLORS.outline);
      px(2, 3, cfg.helmet); px(3, 3, cfg.helmet); px(4, 3, cfg.helmet);
      px(5, 3, cfg.helmet); px(6, 3, cfg.helmet); px(7, 3, cfg.helmet); px(8, 3, COLORS.outline);
      break;
  }

  // 2. Visor / eye-strip (extra dark line across the helmet for QB and WR/CB)
  if (cfg.visor) {
    // Visor spans cols 3..6 at y=2 — already drawn as black above
  }

  // 3. Accent stripe under helmet (collar)
  px(3, 4, cfg.accent); px(4, 4, cfg.accent);
  px(5, 4, cfg.accent); px(6, 4, cfg.accent);

  // 4. Shoulder pads (wider than helmet)
  px(2, 5, cfg.shoulder); px(3, 5, cfg.shoulder);
  px(4, 5, cfg.shoulder); px(5, 5, cfg.shoulder);
  px(6, 5, cfg.shoulder); px(7, 5, cfg.shoulder);
  // Outline top of shoulder pads
  px(2, 4, COLORS.outline); px(7, 4, COLORS.outline);

  // 5. Jersey body
  px(2, 6, cfg.jersey); px(3, 6, cfg.jersey);
  px(4, 6, cfg.jersey); px(5, 6, cfg.jersey);
  px(6, 6, cfg.jersey); px(7, 6, cfg.jersey);

  px(2, 7, cfg.jersey); px(3, 7, cfg.jersey);
  px(4, 7, cfg.jersey); px(5, 7, cfg.jersey);
  px(6, 7, cfg.jersey); px(7, 7, cfg.jersey);

  // Optional jersey number on the jersey
  if (cfg.showNumber && cfg.number != null) {
    drawJerseyNumber(ctx, x + 3, y + 6, cfg.number, COLORS.outline);
  }

  // 6. Pants / waistband (accent stripe)
  px(3, 8, cfg.accent); px(4, 8, cfg.accent);
  px(5, 8, cfg.accent); px(6, 8, cfg.accent);

  // 7. Legs (pants color)
  px(3, 9, cfg.pants); px(4, 9, cfg.pants);
  px(5, 9, cfg.pants); px(6, 9, cfg.pants);
}

/** Tiny 2-digit number drawn in 3x5 pixels on a 5x3 area (no spacing). */
function drawJerseyNumber(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  num: number,
  color: string,
) {
  const s = String(num);
  ctx.fillStyle = color;
  let cx = x;
  for (const ch of s) {
    const glyph = FONT_3x5[ch];
    if (!glyph) continue;
    const rows = glyph.split('|');
    for (let r = 0; r < 3; r++) { // truncate to top 3 rows for jersey
      const row = rows[r];
      for (let c = 0; c < row.length; c++) {
        if (row[c] === 'X') ctx.fillRect(cx + c, y + r, 1, 1);
      }
    }
    cx += 4; // 3 wide + 1 gap
  }
}

// =============== Position → sprite config ====================================
// Deterministic jersey numbers per slot so the same roster produces the same
// visible numbers across the game (no flicker between plays).
function jerseyNumFor(role: string, slot: number): number {
  switch (role) {
    case 'Q': return 1 + (slot % 19); // QB: 1-19
    case 'R': return 20 + (slot % 30); // RB: 20-49
    case 'W': return 80 + (slot % 10); // WR: 80-89
    case 'C': return 20 + (slot % 10); // CB: 20-29
    case 'O': return 60 + (slot % 20); // O-line: 60-79
    case 'D': return 91 + (slot % 9); // D-line: 91-99
    case 'K': return 4 + (slot % 3); // Kicker: 4,5,6
    case 'P': return 7 + (slot % 3); // Punter: 7,8,9
    case 'H': return 8 + (slot % 2); // Holder: 8,9
    case 'S': return 50 + (slot % 10); // Snapper: 50-59
    case 'G': return 36 + (slot % 4); // Gunner: 36-39
    default: return 99;
  }
}

/** Build a SpriteConfig for a given role + team. */
function spriteConfigFor(role: string, teamIdx: 0 | 1, slot = 0): SpriteConfig {
  const t = TEAM_PALETTES[teamIdx];
  switch (role) {
    case 'Q':
      return { ...t, helmetStyle: 'small', visor: true, showNumber: true, number: jerseyNumFor('Q', slot) };
    case 'R':
      return { ...t, helmetStyle: 'big', visor: false, showNumber: true, number: jerseyNumFor('R', slot) };
    case 'W':
      return { ...t, helmetStyle: 'flat', visor: true, showNumber: false };
    case 'C':
      return { ...t, helmetStyle: 'flat', visor: true, showNumber: false };
    case 'O':
      return { ...t, helmetStyle: 'flat', visor: false, showNumber: false };
    case 'D':
      return { ...t, helmetStyle: 'round', visor: false, showNumber: false };
    case 'K':
    case 'P':
    case 'H':
    case 'S':
    case 'G':
      return { ...t, helmetStyle: 'flat', visor: false, showNumber: false };
    default:
      return { ...t, helmetStyle: 'flat', visor: false, showNumber: false };
  }
}

function teamsForPossession(possessionIdx: 0 | 1): [0 | 1, 0 | 1] {
  return possessionIdx === 0 ? [0, 1] : [1, 0];
}

// =============== Field rendering ==============================================
/** Deterministic pseudo-random for crowd pixels (stable per pixel coord). */
function crowdPixel(x: number, y: number, seed = 1337): boolean {
  let h = (x * 374761393 + y * 668265263 + seed * 1274126177) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  h = h ^ (h >>> 16);
  return ((h >>> 8) & 0xff) > 130; // ~50% density
}

function drawCrowdBand(ctx: CanvasRenderingContext2D, y: number) {
  ctx.fillStyle = COLORS.crowdBg;
  ctx.fillRect(0, y, FIELD_W, CROWD_H);
  // Sprinkle colored pixels for "fans"
  for (let py = y; py < y + CROWD_H; py++) {
    for (let px = 0; px < FIELD_W; px++) {
      if (!crowdPixel(px, py)) continue;
      // Vary by row (head vs body silhouette)
      const r = py - y;
      const palette = r < CROWD_H / 2
        ? [COLORS.crowdSkinA, COLORS.crowdSkinB, COLORS.cream, '#a07050', '#704030']
        : [COLORS.maroon, COLORS.yellow, COLORS.lime, COLORS.sky, COLORS.cream, '#704080'];
      ctx.fillStyle = palette[(px + py) % palette.length];
      ctx.fillRect(px, py, 1, 1);
    }
  }
}

function drawScoreboard(
  ctx: CanvasRenderingContext2D,
  homeName: string,
  awayName: string,
  homeScore: number,
  awayScore: number,
) {
  // Solid yellow band with black border
  ctx.fillStyle = COLORS.scoreboardBg;
  ctx.fillRect(0, 0, FIELD_W, SCOREBOARD_H);
  ctx.fillStyle = COLORS.scoreboardBorder;
  ctx.fillRect(0, 0, FIELD_W, 1);
  ctx.fillRect(0, SCOREBOARD_H - 1, FIELD_W, 1);
  // Drop-shadow line under scoreboard
  ctx.fillStyle = COLORS.scoreboardShadow;
  ctx.fillRect(0, SCOREBOARD_H, FIELD_W, 1);

  const textY = 6;
  const scale = 1;

  // Home (left)
  const homeLabel = truncate(homeName, 10);
  drawText(ctx, homeLabel, 6, textY, COLORS.scoreboardInk, scale);

  // Home score (right-aligned, ~ column 100)
  const homeScoreStr = homeScore.toFixed(1);
  drawText(ctx, homeScoreStr, 96, textY, COLORS.scoreboardInk, scale);

  // Center "VS" indicator
  drawText(ctx, 'VS', 232, textY, COLORS.maroon, scale);

  // Away score
  const awayScoreStr = awayScore.toFixed(1);
  const awayScoreW = textWidth(awayScoreStr, scale);
  drawText(ctx, awayScoreStr, FIELD_W - 6 - awayScoreW, textY, COLORS.scoreboardInk, scale);

  // Away name (right-aligned)
  const awayLabel = truncate(awayName, 10);
  const awayLabelW = textWidth(awayLabel, scale);
  drawText(ctx, awayLabel, FIELD_W - 6 - awayLabelW, textY, COLORS.scoreboardInk, scale);
}

function drawStatusBar(
  ctx: CanvasRenderingContext2D,
  down: 1 | 2 | 3 | 4,
  distance: number,
  ballYardline: number,
  direction: 1 | -1,
) {
  // Dark bar with white text
  ctx.fillStyle = COLORS.ink;
  ctx.fillRect(0, STATUS_BAR_Y, FIELD_W, STATUS_BAR_H);

  const textY = STATUS_BAR_Y + 7;
  const scale = 1;

  // Down + distance (left)
  const downStr = down === 1 ? '1ST' : down === 2 ? '2ND' : down === 3 ? '3RD' : '4TH';
  drawText(ctx, downStr, 8, textY, COLORS.yellow, scale);
  const dnW = textWidth(downStr, scale);
  drawText(ctx, '& ' + distance, 8 + dnW + 6, textY, COLORS.cream, scale);

  // Ball spot (center): "AT OWN XX" / "AT OPP XX" / "AT 50" — NFL convention.
  // Number is distance to the NEAR end zone; OWN/OPP tells you which side the
  // near end zone belongs to from the offense's perspective.
  const displayYard = Math.min(ballYardline, 100 - ballYardline);
  let spot: string;
  if (ballYardline === 50) {
    spot = 'AT 50';
  } else {
    const nearIsOppEnd =
      (direction === 1 && ballYardline > 50) ||
      (direction === -1 && ballYardline < 50);
    spot = `AT ${nearIsOppEnd ? 'OPP' : 'OWN'} ${displayYard}`;
  }
  const spotW = textWidth(spot, scale);
  drawText(ctx, spot, (FIELD_W - spotW) / 2, textY, COLORS.cream, scale);

  // Direction indicator (right): ">>>" or "<<<"
  const arrow = direction === 1 ? 'ATTACK >>>' : '<<< ATTACK';
  const arrowW = textWidth(arrow, scale);
  drawText(ctx, arrow, FIELD_W - 8 - arrowW, textY, COLORS.lime, scale);
}

/** Render the green striped field background + yard lines + hashes +
 *  numbers + midfield logo + goal lines. */
function drawFieldBase(
  ctx: CanvasRenderingContext2D,
  ballYardline: number,
  direction: 1 | -1,
  distance: number,
  homeName: string,
  awayName: string,
) {
  // Base green
  ctx.fillStyle = COLORS.greenB;
  ctx.fillRect(0, FIELD_TOP, FIELD_W, PLAYABLE_H);

  // Alternating 5-yard stripes (light/dark)
  const stripeW = 5 * YARD; // 24px
  for (let i = 0; i < 20; i++) {
    if (i % 2 === 0) continue; // only odd stripes are lighter
    const x = Math.floor(i * stripeW);
    ctx.fillStyle = COLORS.greenA;
    ctx.fillRect(x, FIELD_TOP, Math.ceil(stripeW), PLAYABLE_H);
  }

  // End zones — back 10 yards on each side
  const leftEndPx = 0;
  const rightEndPx = FIELD_W - ENDZONE_W;
  const isTeam0Left = true; // team 0 always defends the left end zone
  const leftColor = COLORS.greenDarkest;
  const rightColor = COLORS.greenDarkest;

  // Solid end-zone band on each side
  ctx.fillStyle = leftColor;
  ctx.fillRect(leftEndPx, FIELD_TOP, ENDZONE_W, PLAYABLE_H);
  ctx.fillStyle = rightColor;
  ctx.fillRect(rightEndPx, FIELD_TOP, ENDZONE_W, PLAYABLE_H);

  // Subtle different tint for the team that DEFENDS each end zone
  ctx.fillStyle = 'rgba(255, 212, 0, 0.10)';
  ctx.fillRect(leftEndPx, FIELD_TOP, ENDZONE_W, PLAYABLE_H);
  ctx.fillStyle = 'rgba(200, 16, 46, 0.10)';
  ctx.fillRect(rightEndPx, FIELD_TOP, ENDZONE_W, PLAYABLE_H);

  // Goal lines (at x=0 and x=FIELD_W)
  ctx.fillStyle = COLORS.yellow;
  ctx.fillRect(0, FIELD_TOP, 1, PLAYABLE_H);
  ctx.fillRect(FIELD_W - 1, FIELD_TOP, 1, PLAYABLE_H);

  // End-zone text — team names painted diagonally across end zones
  drawEndZoneText(ctx, homeName, leftEndPx, ENDZONE_W, true);
  drawEndZoneText(ctx, awayName, rightEndPx, ENDZONE_W, false);

  // Goalposts at each end zone (yellow uprights + crossbar)
  drawGoalpost(ctx, leftEndPx + 2, direction);
  drawGoalpost(ctx, rightEndPx - 3, direction);

  // Yard lines every 10 yards (NOT at 0 or 100 — those are the goal lines)
  ctx.fillStyle = COLORS.yardLine;
  for (let yd = 10; yd < 100; yd += 10) {
    const x = Math.round((yd / 100) * FIELD_W);
    const is50 = yd === 50;
    ctx.fillStyle = is50 ? COLORS.yardLineMid : COLORS.yardLine;
    ctx.fillRect(x, FIELD_TOP, 1, PLAYABLE_H);
  }

  // Yard numbers — paint at every 10 yard line, both top and bottom of field
  // Real football convention: numbers show the distance to the NEAREST end
  // zone, so 10..50 mirror across midfield (yardline 60 reads "40", etc.).
  for (let yd = 10; yd < 100; yd += 10) {
    // Skip the 50 — that's where the midfield logo lives
    if (yd === 50) continue;
    const x = Math.round((yd / 100) * FIELD_W);
    const displayYd = Math.min(yd, 100 - yd);
    const numStr = String(displayYd);
    const topY = FIELD_TOP + 6;
    const botY = FIELD_BOTTOM - 11;
    drawText(ctx, numStr, x - textWidth(numStr) / 2, topY, COLORS.yardNumber);
    drawText(ctx, numStr, x - textWidth(numStr) / 2, botY, COLORS.yardNumber);
  }

  // Midfield logo (a small football icon at the 50)
  drawMidfieldLogo(ctx, 50);

  // Hash marks at every yard crossing (NFL-style, short ticks)
  ctx.fillStyle = COLORS.hash;
  for (let yd = 1; yd < 100; yd++) {
    if (yd % 10 === 0) continue; // skip yard lines
    const x = Math.round((yd / 100) * FIELD_W);
    ctx.fillRect(x, FIELD_TOP + PLAYABLE_H * 0.32, 1, 4);
    ctx.fillRect(x, FIELD_TOP + PLAYABLE_H * 0.65, 1, 4);
  }

  // LOS dashed line + label (only when between plays)
  if (ballYardline > 0 && ballYardline < 100) {
    const losX = Math.round((ballYardline / 100) * FIELD_W);
    // Dashed yellow vertical line
    ctx.fillStyle = COLORS.yellow;
    for (let py = FIELD_TOP; py < FIELD_BOTTOM; py += 4) {
      ctx.fillRect(losX, py, 1, 2);
    }
    // LOS label at top
    drawText(ctx, 'LOS', losX + 3, FIELD_TOP + 2, COLORS.yellow);

    // First-down marker (distance yards ahead of LOS in offense's direction)
    const fdYard = ballYardline + distance * direction;
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

function drawGoalpost(
  ctx: CanvasRenderingContext2D,
  xBase: number,
  _direction: 1 | -1,
) {
  // Yellow goalpost: 2 vertical uprights + crossbar at top
  // Draw as 1-pixel-wide bars in goalpost yellow with shadow
  ctx.fillStyle = COLORS.goalpostShadow;
  ctx.fillRect(xBase, FIELD_TOP + 2, 1, 12);
  ctx.fillRect(xBase + 3, FIELD_TOP + 2, 1, 12);
  ctx.fillStyle = COLORS.goalpost;
  ctx.fillRect(xBase + 1, FIELD_TOP + 2, 1, 12);
  ctx.fillRect(xBase + 4, FIELD_TOP + 2, 1, 12);
  // Crossbar
  ctx.fillStyle = COLORS.goalpostShadow;
  ctx.fillRect(xBase, FIELD_TOP + 2, 5, 1);
  ctx.fillStyle = COLORS.goalpost;
  ctx.fillRect(xBase + 1, FIELD_TOP + 1, 4, 1);
}

function drawMidfieldLogo(ctx: CanvasRenderingContext2D, yardline: number) {
  const cx = Math.round((yardline / 100) * FIELD_W);
  const cy = Math.round(FIELD_TOP + PLAYABLE_H / 2);
  // Football icon: brown ellipse with white laces, ~16x8 px
  ctx.fillStyle = COLORS.midfieldLogo;
  // Ellipse approximation via fillRect sweep
  for (let dx = -8; dx <= 8; dx++) {
    const dy = Math.round(3 * Math.cos((dx / 8) * Math.PI / 2));
    ctx.fillRect(cx + dx, cy - dy, 1, dy * 2 + 1);
  }
  // Lace stripe
  ctx.fillStyle = COLORS.midfieldLogoLace;
  ctx.fillRect(cx + 2, cy - 3, 5, 1);
  ctx.fillRect(cx + 2, cy + 3, 5, 1);
  // Stitch marks
  for (let i = 0; i < 3; i++) {
    ctx.fillRect(cx + 3 + i * 2, cy - 1, 1, 3);
  }
}

/** Draw the end-zone team name text. Painted vertically down the end zone,
 *  one character per row, so it reads as a stack of letters (like real
 *  NFL end zones when viewed from the press box). */
function drawEndZoneText(
  ctx: CanvasRenderingContext2D,
  name: string,
  endZoneX: number,
  endZoneW: number,
  isLeft: boolean,
) {
  const text = truncate(name, 8).toUpperCase();
  const charH = 6; // 5px font + 1px gap
  const totalH = text.length * charH;
  const startY = FIELD_TOP + (PLAYABLE_H - totalH) / 2;
  // Center horizontally in end zone
  const charW = 4; // 3px font + 1px gap
  const startX = endZoneX + (endZoneW - charW) / 2;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    drawText(ctx, ch, startX, startY + i * charH, COLORS.yardNumber);
  }
}

function truncate(s: string, max: number): string {
  if (!s) return '';
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '.';
}

// =============== Football =====================================================
function drawFootball(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  angle: number,
  scale = 1,
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.scale(scale, scale);
  const len = 4;
  const wid = 2;
  ctx.fillStyle = '#5b2a0a';
  for (let dx = -len; dx <= len; dx++) {
    const dy = Math.round(wid * Math.cos((dx / len) * Math.PI / 2));
    ctx.fillRect(dx, -dy, 1, dy * 2 + 1);
  }
  ctx.strokeStyle = '#2c1505';
  ctx.lineWidth = 1;
  ctx.strokeRect(-len, -wid, len * 2 + 1, wid * 2 + 1);
  // Laces
  ctx.fillStyle = '#fff8dc';
  ctx.fillRect(0, -1, 3, 1);
  ctx.fillRect(0, 1, 3, 1);
  for (let i = 0; i < 2; i++) {
    ctx.fillRect(1 + i * 2, -1, 1, 3);
  }
  // Highlight
  ctx.fillStyle = 'rgba(255, 248, 220, 0.2)';
  ctx.fillRect(-len, -wid, len, 1);
  ctx.restore();
}

// =============== Kick leg =====================================================
function drawKickLeg(
  ctx: CanvasRenderingContext2D,
  from: [number, number],
  to: [number, number],
  opacity: number,
) {
  ctx.save();
  ctx.strokeStyle = `rgba(91, 42, 10, ${opacity})`;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(from[0], from[1]);
  ctx.lineTo(to[0], to[1]);
  ctx.stroke();
  ctx.restore();
}

// =============== Lineups =====================================================
interface Lineup {
  qb?: [number, number];
  oline: [number, number][];
  wr: [number, number][];
  dline: [number, number][];
  cb: [number, number][];
  rb?: [number, number];
  punter?: [number, number];
  kicker?: [number, number];
  snapper?: [number, number];
  holder?: [number, number];
  gunner?: [number, number][];
}

function buildStandard(): Lineup {
  const yMid = 0.50;
  const oline: [number, number][] = [];
  for (let i = 0; i < 5; i++) {
    const t = (i + 0.5) / 5;
    oline.push([0, yMid - 0.04 + t * 0.08]);
  }
  const qb: [number, number] = [-5, yMid];
  const wr: [number, number][] = [[-3, 0.18], [-3, 0.82]];
  const dline: [number, number][] = [];
  for (let i = 0; i < 4; i++) {
    const t = (i + 0.5) / 4;
    dline.push([0, yMid - 0.03 + t * 0.06]);
  }
  const cb: [number, number][] = [[8, 0.15], [8, 0.85]];
  return { qb, oline, wr, dline, cb };
}

function buildRun(sub: 'inside' | 'outside'): Lineup {
  const base = buildStandard();
  const yMid = 0.50;
  const rbY = sub === 'outside' ? 0.20 : yMid;
  return { ...base, rb: [-8, rbY] };
}

function buildPunt(): Lineup {
  const yMid = 0.50;
  const oline: [number, number][] = [];
  for (let i = 0; i < 5; i++) {
    const t = (i + 0.5) / 5;
    oline.push([0, yMid - 0.04 + t * 0.08]);
  }
  const snapper: [number, number] = [0, yMid];
  const punter: [number, number] = [-14, yMid];
  const gunner: [number, number][] = [[-3, 0.10], [-3, 0.90]];
  const dline: [number, number][] = [];
  for (let i = 0; i < 4; i++) {
    const t = (i + 0.5) / 4;
    dline.push([0, yMid - 0.03 + t * 0.06]);
  }
  return { snapper, punter, gunner, oline, dline, wr: [], cb: [] };
}

function buildFG(): Lineup {
  const yMid = 0.50;
  const oline: [number, number][] = [];
  for (let i = 0; i < 5; i++) {
    const t = (i + 0.5) / 5;
    oline.push([0, yMid - 0.04 + t * 0.08]);
  }
  const snapper: [number, number] = [0, yMid];
  const holder: [number, number] = [-7, yMid];
  const kicker: [number, number] = [-8, yMid - 0.05];
  const dline: [number, number][] = [];
  for (let i = 0; i < 4; i++) {
    const t = (i + 0.5) / 4;
    dline.push([0, yMid - 0.03 + t * 0.06]);
  }
  return { snapper, holder, kicker, oline, dline, wr: [], cb: [] };
}

/** Convert lineup position (yards-offset, y-normalized) + LOS to canvas (x, y).
 *  Returns integer coords so sprite fillRect calls land on pixel boundaries. */
function toCanvas(
  xOffsetYards: number,
  yNorm: number,
  losYardline: number,
  direction: 1 | -1,
): [number, number] {
  const losPx = (losYardline / 100) * FIELD_W;
  const x = Math.round(losPx + xOffsetYards * YARD * direction);
  const y = Math.round(FIELD_TOP + yNorm * PLAYABLE_H);
  return [x, y];
}

// =============== Per-play-key animation ======================================
interface AnimFrame {
  positions: Array<{ label: string; x: number; y: number; role: string; team: 0 | 1; slot: number }>;
  ball: { x: number; y: number; angle: number; scale: number };
  kick?: { from: [number, number]; to: [number, number]; opacity: number };
  /** Ball trail positions (last 4 frames), for pass/fg/punt arcs. */
  ballTrail: Array<{ x: number; y: number; opacity: number }>;
  /** Optional particle bursts (yardline dust on big plays, etc.). */
  particles: Array<{ x: number; y: number; vx: number; vy: number; life: number; color: string; size: number }>;
}

interface Particle {
  x: number; y: number; vx: number; vy: number; life: number; color: string; size: number;
}

/** Persistent particle store across frames so motion is continuous. */
let particles: Particle[] = [];

function computeFrame(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  result: any,
  progress: number,
  direction: 1 | -1,
  possessionIdx: 0 | 1,
): AnimFrame {
  const w = canvas.width;
  const los = result.yardline_before ?? 50;
  const yards = result.yards ?? 0;
  const parent = result.off_call?.parent ?? 'run';
  const sub = result.off_call?.sub ?? 'inside';
  const playKey = parent === 'punt' || parent === 'fg' ? parent : `${parent}-${sub}`;
  const [offenseTeam, defenseTeam] = teamsForPossession(possessionIdx);

  // Build the lineup at the LOS (for the snap frame).
  const lineup: Lineup =
    parent === 'punt' ? buildPunt() :
    parent === 'fg'   ? buildFG()   :
    parent === 'run'  ? buildRun(sub as 'inside' | 'outside') :
                        buildStandard();

  let offShiftTotal = yards * progress;
  let defShiftTotal = 0;

  const arc: (n: number) => number = (n) => Math.sin(progress * Math.PI) * n;

  const losPx = (los / 100) * w;

  switch (playKey) {
    case 'run-inside':
      defShiftTotal = yards * 0.6 * progress;
      break;
    case 'run-outside':
      defShiftTotal = yards * 0.5 * progress;
      break;
    case 'pass-deep':
      offShiftTotal = 0;
      defShiftTotal = 0;
      break;
    case 'pass-short':
      offShiftTotal = 0;
      defShiftTotal = 0;
      break;
    case 'punt':
      offShiftTotal = 0;
      defShiftTotal = 0;
      break;
    case 'fg':
      offShiftTotal = 0;
      defShiftTotal = 0;
      break;
    default:
      offShiftTotal = yards * progress;
      defShiftTotal = yards * 0.3 * progress;
  }

  let ballX: number, ballY: number, ballAngle = 0, ballScale = 1;
  switch (playKey) {
    case 'run-inside': {
      const ballRx = losPx + (yards * progress) * YARD * direction;
      const ballRy = FIELD_H * 0.50 + arc(4 * direction);
      ballX = ballRx;
      ballY = ballRy;
      ballAngle = 0;
      break;
    }
    case 'run-outside': {
      const ballRx = losPx + (yards * progress) * YARD * direction;
      const sweepDir = (sub === 'outside') ? 1 : -1;
      const ballRy = FIELD_H * 0.50 + arc(20 * sweepDir);
      ballX = ballRx;
      ballY = ballRy;
      ballAngle = 0.4 * sweepDir * arc(1);
      break;
    }
    case 'pass-deep': {
      const release = Math.max((progress - 0.4) / 0.6, 0);
      const qbDropPx = 7 * YARD;
      if (release <= 0) {
        ballX = losPx - qbDropPx * direction;
        ballY = FIELD_H * 0.50;
        ballAngle = Math.PI / 2;
      } else {
        const targetX = losPx + yards * YARD * direction;
        const targetY = FIELD_H * 0.50 - (sub === 'deep' ? 40 : 20);
        const fromX = losPx - qbDropPx * direction;
        const fromY = FIELD_H * 0.50;
        ballX = fromX + (targetX - fromX) * release;
        ballY = fromY + (targetY - fromY) * release - Math.sin(release * Math.PI) * 24;
        ballAngle = Math.atan2(targetY - ballY, targetX - ballX) || 0;
      }
      break;
    }
    case 'pass-short': {
      const release = progress;
      const targetX = losPx + yards * YARD * direction;
      const targetY = FIELD_H * 0.50 - 8;
      ballX = losPx + (targetX - losPx) * release;
      ballY = FIELD_H * 0.50 + (targetY - FIELD_H * 0.50) * release - Math.sin(release * Math.PI) * 18;
      ballAngle = Math.atan2(targetY - ballY, targetX - ballX) || 0;
      break;
    }
    case 'punt': {
      if (progress < 0.3) {
        const t = progress / 0.3;
        const toX = losPx - 14 * YARD * direction;
        ballX = losPx + (toX - losPx) * t;
        ballY = FIELD_H * 0.50 - Math.sin(t * Math.PI) * 3;
        ballAngle = Math.PI;
      } else if (progress < 0.55) {
        ballX = losPx - 14 * YARD * direction;
        ballY = FIELD_H * 0.50;
        ballAngle = (progress - 0.3) * 4;
      } else {
        const t = (progress - 0.55) / 0.45;
        const fromX = losPx - 14 * YARD * direction;
        const targetX = ((result.yardline_after ?? los) / 100) * FIELD_W;
        ballX = fromX + (targetX - fromX) * t;
        ballY = FIELD_H * 0.50 - Math.sin(t * Math.PI) * 50;
        const dx = targetX - fromX;
        const dy = -Math.cos(t * Math.PI) * 50;
        ballAngle = Math.atan2(dy, dx);
      }
      break;
    }
    case 'fg': {
      if (progress < 0.2) {
        const t = progress / 0.2;
        const toX = losPx - 7 * YARD * direction;
        ballX = losPx + (toX - losPx) * t;
        ballY = FIELD_H * 0.50 - Math.sin(t * Math.PI) * 2;
        ballAngle = Math.PI;
      } else if (progress < 0.45) {
        ballX = losPx - 7 * YARD * direction;
        ballY = FIELD_H * 0.50;
        ballAngle = (progress - 0.2) * 4;
      } else {
        const t = (progress - 0.45) / 0.55;
        const fromX = losPx - 7 * YARD * direction;
        const targetX = direction === 1 ? FIELD_W : 0;
        ballX = fromX + (targetX - fromX) * t;
        ballY = FIELD_H * 0.50 - Math.sin(t * Math.PI) * 50;
        const dx = targetX - fromX;
        const dy = -Math.cos(t * Math.PI) * 50;
        ballAngle = Math.atan2(dy, dx);
      }
      break;
    }
    default: {
      ballX = losPx + (yards * progress) * YARD * direction;
      ballY = FIELD_H * 0.50;
    }
  }

  const positions: AnimFrame['positions'] = [];

  const drawOne = (
    label: string,
    baseX: number,
    baseY: number,
    role: string,
    team: 0 | 1,
    slot: number,
    xShift = 0,
    yShift = 0,
    yCurve = 0,
  ) => {
    const effectiveX = baseX + xShift;
    const effectiveY = baseY + yShift + Math.sin(progress * Math.PI) * yCurve;
    const [x, y] = toCanvas(effectiveX, effectiveY, los, direction);
    positions.push({ label, x, y, role, team, slot });
  };

  // Offense
  if (lineup.oline.length) {
    lineup.oline.forEach(([xo, yn], i) => {
      if (parent === 'punt' || parent === 'fg') {
        drawOne('O', xo, yn, 'O', offenseTeam, i, 0);
      } else {
        drawOne('O', xo, yn, 'O', offenseTeam, i, xo + offShiftTotal * 0.5);
      }
    });
  }
  if (lineup.qb && (lineup.qb[0] !== 0 || lineup.qb[1] !== 0)) {
    if (playKey === 'pass-deep') {
      const drop = Math.min(progress / 0.4, 1) * 7;
      drawOne('Q', lineup.qb[0] - drop, lineup.qb[1], 'Q', offenseTeam, 0);
    } else if (playKey === 'pass-short') {
      drawOne('Q', lineup.qb[0] - 3 * progress, lineup.qb[1], 'Q', offenseTeam, 0);
    } else if (playKey === 'run-inside') {
      drawOne('Q', lineup.qb[0] + 1 * progress, lineup.qb[1] - 0.02 * progress, 'Q', offenseTeam, 0);
    } else if (playKey === 'run-outside') {
      drawOne('Q', lineup.qb[0] + 0.5 * progress, lineup.qb[1], 'Q', offenseTeam, 0);
    } else {
      drawOne('Q', lineup.qb[0], lineup.qb[1], 'Q', offenseTeam, 0);
    }
  }
  if (lineup.wr && lineup.wr.length) {
    lineup.wr.forEach(([xo, yn], i) => {
      if (playKey === 'pass-deep') {
        const deepRoute = 25 * progress;
        drawOne('W', xo + deepRoute, yn - 0.06 * progress, 'W', offenseTeam, i);
      } else if (playKey === 'pass-short') {
        const shortRoute = 5 * progress;
        drawOne('W', xo + shortRoute, yn - 0.04 * progress, 'W', offenseTeam, i);
      } else if (playKey === 'run-outside') {
        const sweepDir = (sub === 'outside') ? 1 : -1;
        drawOne('W', xo + 6 * progress, yn, 'W', offenseTeam, i, 0, sweepDir * 0.04 * progress);
      } else {
        drawOne('W', xo + 2 * progress, yn, 'W', offenseTeam, i);
      }
    });
  }
  if (lineup.rb) {
    if (playKey === 'run-inside') {
      drawOne('R', lineup.rb[0] + offShiftTotal, lineup.rb[1], 'R', offenseTeam, 0);
    } else if (playKey === 'run-outside') {
      const sweepDir = (sub === 'outside') ? 1 : -1;
      drawOne('R', lineup.rb[0] + offShiftTotal, lineup.rb[1] + sweepDir * 0.10 * progress, 'R', offenseTeam, 0);
    }
  }
  if (lineup.snapper) drawOne('S', lineup.snapper[0], lineup.snapper[1], 'S', offenseTeam, 0);
  if (lineup.holder) {
    if (parent === 'fg' && progress < 0.45) {
      drawOne('H', lineup.holder[0], lineup.holder[1] + 0.02, 'H', offenseTeam, 0);
    } else if (parent === 'fg' && progress < 0.6) {
      drawOne('H', lineup.holder[0], lineup.holder[1] + 0.04, 'H', offenseTeam, 0);
    } else {
      drawOne('H', lineup.holder[0], lineup.holder[1], 'H', offenseTeam, 0);
    }
  }
  if (lineup.kicker) {
    if (parent === 'fg' && progress > 0.4 && progress < 0.5) {
      drawOne('K', lineup.kicker[0], lineup.kicker[1] - 0.04, 'K', offenseTeam, 0);
    } else if (parent === 'fg' && progress >= 0.5 && progress < 0.55) {
      drawOne('K', lineup.kicker[0], lineup.kicker[1] - 0.01, 'K', offenseTeam, 0);
    } else {
      drawOne('K', lineup.kicker[0], lineup.kicker[1], 'K', offenseTeam, 0);
    }
  }
  if (lineup.punter) {
    if (parent === 'punt' && progress > 0.25 && progress < 0.55) {
      drawOne('P', lineup.punter[0], lineup.punter[1], 'P', offenseTeam, 0);
    } else if (parent === 'punt' && progress >= 0.55 && progress < 0.6) {
      drawOne('P', lineup.punter[0], lineup.punter[1] + 0.04, 'P', offenseTeam, 0);
    } else {
      drawOne('P', lineup.punter[0], lineup.punter[1], 'P', offenseTeam, 0);
    }
  }
  if (lineup.gunner) {
    lineup.gunner.forEach(([xo, yn], i) => {
      const race = (parent === 'punt' ? 18 : 0) * progress;
      drawOne('G', xo + race, yn, 'G', offenseTeam, i);
    });
  }

  // Defense
  if (lineup.dline && lineup.dline.length) {
    lineup.dline.forEach(([xo, yn], i) => {
      let xShift = 0;
      if (playKey === 'run-inside') xShift = defShiftTotal;
      else if (playKey === 'run-outside') {
        const sweepDir = (sub === 'outside') ? 1 : -1;
        drawOne('D', xo + defShiftTotal * 0.6, yn + sweepDir * 0.03 * progress, 'D', defenseTeam, i);
        return;
      } else if (playKey === 'pass-deep' || playKey === 'pass-short') {
        const rushX = Math.min(progress * 4, 3);
        drawOne('D', xo + rushX, yn, 'D', defenseTeam, i);
        return;
      } else if (parent === 'fg' || parent === 'punt') {
        if (progress > 0.45 && progress < 0.55) {
          drawOne('D', xo + 3 * (progress - 0.45) / 0.1, yn, 'D', defenseTeam, i);
          return;
        }
        drawOne('D', xo, yn, 'D', defenseTeam, i);
        return;
      } else {
        xShift = defShiftTotal * 0.5;
      }
      drawOne('D', xo + xShift, yn, 'D', defenseTeam, i);
    });
  }
  if (lineup.cb && lineup.cb.length) {
    lineup.cb.forEach(([xo, yn], i) => {
      if (playKey === 'pass-deep') {
        const drop = Math.min(progress * 12, 10);
        drawOne('C', xo + drop, yn + (i === 0 ? -0.04 : 0.04) * progress, 'C', defenseTeam, i);
      } else if (playKey === 'pass-short') {
        const drop = Math.min(progress * 6, 5);
        drawOne('C', xo + drop, yn, 'C', defenseTeam, i);
      } else {
        drawOne('C', xo, yn, 'C', defenseTeam, i);
      }
    });
  }

  // Kick leg
  let kick: AnimFrame['kick'] = undefined;
  if (parent === 'fg' && progress > 0.45 && progress < 0.55) {
    const t = (progress - 0.45) / 0.10;
    const kickerPos = toCanvas(-8, 0.45, los, direction);
    const ballPos: [number, number] = [ballX, ballY];
    kick = {
      from: kickerPos,
      to: [kickerPos[0] + (ballPos[0] - kickerPos[0]) * t, kickerPos[1] - Math.sin(t * Math.PI) * 6],
      opacity: 1 - Math.abs(0.5 - t) * 2,
    };
  } else if (parent === 'punt' && progress > 0.45 && progress < 0.6) {
    const t = (progress - 0.45) / 0.15;
    const punterPos = toCanvas(-14, 0.50, los, direction);
    const ballPos: [number, number] = [ballX, ballY];
    kick = {
      from: punterPos,
      to: [punterPos[0] + (ballPos[0] - punterPos[0]) * t, punterPos[1] - Math.sin(t * Math.PI) * 10],
      opacity: 1 - Math.abs(0.5 - t) * 2,
    };
  }

  // Ball trail (last 4 frames) — for pass/fg/punt arcs only
  const ballTrail: AnimFrame['ballTrail'] = [];
  if (playKey === 'pass-deep' || playKey === 'pass-short' || parent === 'punt' || parent === 'fg') {
    for (let i = 1; i <= 4; i++) {
      const pastProgress = Math.max(0, progress - i * 0.04);
      // Recompute ball position at pastProgress (approximate)
      let px = ballX, py = ballY;
      // Simple approximation: ball moves along its trajectory
      // For better accuracy we could re-run the switch, but a linear
      // back-projection gives a decent ghost trail.
      const backRatio = pastProgress / Math.max(progress, 0.001);
      px = losPx + (ballX - losPx) * backRatio;
      py = FIELD_H * 0.50 + (ballY - FIELD_H * 0.50) * backRatio;
      ballTrail.push({ x: px, y: py, opacity: 0.35 - i * 0.07 });
    }
  }

  // Particles — emit dust when RB crosses the LOS on a run, on TDs, on sacks
  if (playKey === 'run-inside' && progress > 0.45 && progress < 0.55 && particles.length < 30) {
    const losPxNow = losPx;
    for (let i = 0; i < 3; i++) {
      particles.push({
        x: losPxNow + (Math.random() - 0.5) * 6,
        y: FIELD_H * 0.50 + (Math.random() - 0.5) * 30,
        vx: (Math.random() - 0.5) * 0.8,
        vy: -Math.random() * 1.2 - 0.3,
        life: 1,
        color: COLORS.cream,
        size: 1,
      });
    }
  }
  if ((result.scoring_event === 'td' || result.scoring_event === 'safety') && progress > 0.5 && particles.length < 80) {
    if (Math.random() < 0.5) {
      const colors = [COLORS.yellow, COLORS.lime, COLORS.sky, COLORS.maroon, COLORS.cream];
      particles.push({
        x: ballX + (Math.random() - 0.5) * 30,
        y: ballY + (Math.random() - 0.5) * 20,
        vx: (Math.random() - 0.5) * 3,
        vy: Math.random() * 2 + 0.5,
        life: 1,
        color: colors[Math.floor(Math.random() * colors.length)],
        size: 2,
      });
    }
  }

  // Advance + render particles
  const liveParticles: AnimFrame['particles'] = [];
  for (const p of particles) {
    p.x += p.vx;
    p.y += p.vy;
    p.vy += 0.08;
    p.life -= 0.02;
    if (p.life > 0 && p.y < FIELD_BOTTOM) {
      liveParticles.push({ ...p });
    }
  }
  particles = particles.filter((p) => p.life > 0 && p.y < FIELD_BOTTOM);
  // Cap to avoid runaway
  if (particles.length > 120) particles = particles.slice(-120);

  void ctx;
  return {
    positions,
    ball: { x: ballX, y: ballY, angle: ballAngle, scale: ballScale },
    kick,
    ballTrail,
    particles: liveParticles,
  };
}

// =============== Build lineup based on play key (same as before) ============
// NOTE: lineup is computed per-frame from the play key inside computeFrame.
// This module-level helper is no longer needed.

// =============== Render one frame's players + ball ============================
function drawAnimFrame(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  frame: AnimFrame,
) {
  // Ball trail (behind ball)
  for (const t of frame.ballTrail) {
    if (t.opacity <= 0) continue;
    ctx.save();
    ctx.globalAlpha = t.opacity;
    drawFootball(ctx, t.x, t.y, frame.ball.angle, 0.7);
    ctx.restore();
  }

  // Players (sprites centered on their anchor point)
  for (const p of frame.positions) {
    const cfg = spriteConfigFor(p.role, p.team, p.slot);
    const sx = Math.round(p.x - SPRITE_SIZE / 2);
    const sy = Math.round(p.y - SPRITE_SIZE / 2);
    drawSprite(ctx, sx, sy, cfg);
  }

  // Ball on top
  drawFootball(ctx, frame.ball.x, frame.ball.y, frame.ball.angle, frame.ball.scale);

  // Kick leg
  if (frame.kick) {
    drawKickLeg(ctx, frame.kick.from, frame.kick.to, frame.kick.opacity);
  }

  // Particles on top
  for (const p of frame.particles) {
    ctx.fillStyle = p.color;
    ctx.globalAlpha = Math.max(0, p.life);
    ctx.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
  }
  ctx.globalAlpha = 1;
}

function spriteRole(role: PlayerSprite['role']): string {
  switch (role) {
    case 'QB': return 'Q';
    case 'RB': return 'R';
    case 'WR':
    case 'TE': return 'W';
    case 'OL': return 'O';
    case 'CB': return 'C';
    case 'K': return 'K';
    case 'P': return 'P';
    case 'H': return 'H';
    case 'LS': return 'S';
    case 'G': return 'G';
    default: return 'D';
  }
}

function drawPoseSprite(
  ctx: CanvasRenderingContext2D,
  player: PlayerSprite,
  x: number,
  y: number,
  direction: 1 | -1,
  tick: number,
) {
  const cfg = spriteConfigFor(spriteRole(player.role), player.team, player.slot);
  const screenFacing = (player.facing === 'offense' ? direction : -direction);

  if (player.pose === 'down' || player.pose === 'dive') {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(player.pose === 'down' ? Math.PI / 2 : screenFacing * Math.PI / 3);
    drawSprite(ctx, -SPRITE_SIZE / 2, -SPRITE_SIZE / 2, cfg);
    ctx.restore();
    return;
  }

  drawSprite(ctx, Math.round(x - SPRITE_SIZE / 2), Math.round(y - SPRITE_SIZE / 2), cfg);
  const step = player.pose === 'run1' ? -1 : player.pose === 'run2' ? 1 : 0;
  const frontX = Math.round(x + screenFacing * 5);
  const backX = Math.round(x - screenFacing * 5);
  ctx.fillStyle = COLORS.outline;

  if (player.pose === 'run1' || player.pose === 'run2') {
    ctx.fillRect(frontX, Math.round(y - 2 + step), 2, 2);
    ctx.fillRect(backX - 1, Math.round(y + 2 - step), 2, 2);
    ctx.fillStyle = cfg.pants;
    ctx.fillRect(Math.round(x - 2 * screenFacing), Math.round(y + 5 + step), 2, 1);
    ctx.fillRect(Math.round(x + 2 * screenFacing), Math.round(y + 5 - step), 2, 1);
  } else if (player.pose === 'block') {
    ctx.fillStyle = cfg.shoulder;
    ctx.fillRect(frontX - (screenFacing < 0 ? 2 : 0), Math.round(y - 3), 3, 2);
    ctx.fillRect(frontX - (screenFacing < 0 ? 2 : 0), Math.round(y + 2), 3, 2);
  } else if (player.pose === 'throw') {
    ctx.fillStyle = cfg.shoulder;
    ctx.fillRect(frontX - (screenFacing < 0 ? 3 : 0), Math.round(y - 4), 4, 2);
  } else if (player.pose === 'catch') {
    ctx.fillStyle = cfg.shoulder;
    ctx.fillRect(frontX - (screenFacing < 0 ? 3 : 0), Math.round(y - 5), 4, 2);
    ctx.fillRect(frontX - (screenFacing < 0 ? 3 : 0), Math.round(y + 4), 4, 2);
  } else if (player.pose === 'kick') {
    ctx.fillStyle = cfg.pants;
    const kickReach = 5 + (tick % 2);
    ctx.fillRect(Math.round(x + screenFacing * kickReach), Math.round(y + 3), 4, 2);
  }
}

function planPoint(
  xOffset: number,
  yNorm: number,
  losYardline: number,
  direction: 1 | -1,
): [number, number] {
  return [
    Math.round((losYardline / 100) * FIELD_W + xOffset * YARD * direction),
    Math.round(FIELD_TOP + yNorm * PLAYABLE_H),
  ];
}

function effectNoise(seed: number, tick: number, index: number): number {
  let n = (seed ^ Math.imul(tick + 1, 0x45d9f3b) ^ Math.imul(index + 7, 0x27d4eb2d)) >>> 0;
  n ^= n >>> 16;
  n = Math.imul(n, 0x7feb352d);
  n ^= n >>> 15;
  return (n >>> 0) / 0xffffffff;
}

function drawPlanEffects(
  ctx: CanvasRenderingContext2D,
  plan: PlayPlan,
  frame: PlayFrame,
  losYardline: number,
  direction: 1 | -1,
) {
  for (const effect of plan.effects) {
    const age = frame.tick - effect.tick;
    if (age < 0 || age > 8) continue;
    const [x, y] = planPoint(effect.xOffset, effect.y, losYardline, direction);
    const radius = 2 + age * effect.intensity;
    const fade = 1 - age / 9;
    ctx.save();
    ctx.globalAlpha = fade;

    if (effect.type === 'impact' || effect.type === 'block') {
      ctx.strokeStyle = effect.type === 'impact' ? COLORS.yellow : COLORS.cream;
      ctx.lineWidth = 1;
      ctx.strokeRect(Math.round(x - radius), Math.round(y - radius), Math.round(radius * 2), Math.round(radius * 2));
      ctx.fillStyle = COLORS.cream;
      ctx.fillRect(x - radius - 2, y, 3, 1);
      ctx.fillRect(x + radius, y, 3, 1);
      ctx.fillRect(x, y - radius - 2, 1, 3);
      ctx.fillRect(x, y + radius, 1, 3);
    } else if (effect.type === 'catch' || effect.type === 'handoff' || effect.type === 'throw') {
      ctx.strokeStyle = effect.type === 'catch' ? COLORS.lime : COLORS.sky;
      ctx.strokeRect(Math.round(x - radius), Math.round(y - radius), Math.round(radius * 2), Math.round(radius * 2));
    } else if (effect.type === 'loose_ball' || effect.type === 'bounce') {
      drawText(ctx, effect.type === 'loose_ball' ? '!' : '*', x + 5, y - 8 - age, COLORS.yellow, 2);
    } else if (effect.type === 'dust' || effect.type === 'kick') {
      ctx.fillStyle = COLORS.cream;
      for (let i = 0; i < 8; i++) {
        const nx = effectNoise(plan.seed, effect.tick, i) - 0.5;
        const ny = effectNoise(plan.seed, effect.tick + 17, i) - 0.5;
        ctx.fillRect(Math.round(x + nx * radius * 5), Math.round(y + ny * radius * 3), 1, 1);
      }
    }
    ctx.restore();
  }
}

function drawPlanBanner(
  ctx: CanvasRenderingContext2D,
  banner: OutcomeBanner | undefined,
  tick: number,
) {
  if (!banner) return;
  const age = tick - banner.fromTick;
  if (age < 0) return;
  const scale = banner.text.length > 17 ? 2 : 3;
  const width = textWidth(banner.text, scale);
  const x = Math.round((FIELD_W - width) / 2);
  const y = Math.round(FIELD_TOP + PLAYABLE_H * 0.43);
  const color = banner.tone === 'good' ? COLORS.lime : banner.tone === 'bad' ? COLORS.yellow : COLORS.cream;
  const pulse = age < 5 && age % 2 === 0 ? 3 : 0;
  ctx.fillStyle = banner.tone === 'bad' ? 'rgba(200,16,46,0.88)' : 'rgba(10,10,24,0.86)';
  ctx.fillRect(x - 8 - pulse, y - 7 - pulse, width + 16 + pulse * 2, 5 * scale + 14 + pulse * 2);
  ctx.fillStyle = COLORS.outline;
  ctx.fillRect(x - 8 - pulse, y - 7 - pulse, width + 16 + pulse * 2, 2);
  ctx.fillRect(x - 8 - pulse, y + 5 * scale + 5 + pulse, width + 16 + pulse * 2, 2);
  drawText(ctx, banner.text, x, y, color, scale);
}

function drawPlayFrame(
  ctx: CanvasRenderingContext2D,
  plan: PlayPlan,
  frame: PlayFrame,
  losYardline: number,
  direction: 1 | -1,
) {
  for (const player of frame.players) {
    const [x, y] = planPoint(player.xOffset, player.y, losYardline, direction);
    drawPoseSprite(ctx, player, x, y, direction, frame.tick);
  }

  if (frame.ball.visible) {
    const [groundX, groundY] = planPoint(frame.ball.xOffset, frame.ball.y, losYardline, direction);
    if (frame.ball.height > 0.03) {
      ctx.fillStyle = `rgba(10,10,24,${0.35 - frame.ball.height * 0.18})`;
      ctx.fillRect(groundX - 3, groundY + 2, 7, 2);
    }
    drawFootball(
      ctx,
      groundX,
      groundY - Math.round(frame.ball.height * 18),
      frame.ball.spin * Math.PI * 2,
      0.55 + frame.ball.height * 0.25,
    );
  }

  drawPlanEffects(ctx, plan, frame, losYardline, direction);
  drawPlanBanner(ctx, frame.banner, frame.tick);
}

// =============== Static lineup (between plays) ===============================
function drawStaticLineup(
  ctx: CanvasRenderingContext2D,
  ballYardline: number,
  direction: 1 | -1,
  possessionIdx: 0 | 1,
) {
  const off = buildStandard();
  const [offenseTeam, defenseTeam] = teamsForPossession(possessionIdx);
  // Offense at LOS
  if (off.qb) {
    const [x, y] = toCanvas(off.qb[0], off.qb[1], ballYardline, direction);
    drawSprite(ctx, Math.round(x - SPRITE_SIZE / 2), Math.round(y - SPRITE_SIZE / 2),
      spriteConfigFor('Q', offenseTeam, 0));
  }
  off.oline.forEach(([xo, yn], i) => {
    const [x, y] = toCanvas(xo, yn, ballYardline, direction);
    drawSprite(ctx, Math.round(x - SPRITE_SIZE / 2), Math.round(y - SPRITE_SIZE / 2),
      spriteConfigFor('O', offenseTeam, i));
  });
  off.wr.forEach(([xo, yn], i) => {
    const [x, y] = toCanvas(xo, yn, ballYardline, direction);
    drawSprite(ctx, Math.round(x - SPRITE_SIZE / 2), Math.round(y - SPRITE_SIZE / 2),
      spriteConfigFor('W', offenseTeam, i));
  });
  // Defense
  off.dline.forEach(([xo, yn], i) => {
    const [x, y] = toCanvas(xo, yn, ballYardline, direction);
    drawSprite(ctx, Math.round(x - SPRITE_SIZE / 2), Math.round(y - SPRITE_SIZE / 2),
      spriteConfigFor('D', defenseTeam, i));
  });
  off.cb.forEach(([xo, yn], i) => {
    const [x, y] = toCanvas(xo, yn, ballYardline, direction);
    drawSprite(ctx, Math.round(x - SPRITE_SIZE / 2), Math.round(y - SPRITE_SIZE / 2),
      spriteConfigFor('C', defenseTeam, i));
  });
}

// =============== Scoring flash effects =======================================
function shouldShake(result: PlayResult): boolean {
  const scrimmagePlay = result.off_call.parent === 'run' || result.off_call.parent === 'pass';
  return result.scoring_event === 'td'
    || result.scoring_event === 'safety'
    || (scrimmagePlay && Math.abs(result.yards ?? 0) >= 15)
    || result.play_outcome === 'fumble'
    || result.play_outcome === 'interception'
    || result.play_outcome === 'punt_blocked'
    || result.play_outcome === 'field_goal_blocked';
}

function getFlashMessage(result: any): { text: string; color: string } | null {
  if (result.scoring_event === 'fg') return { text: 'FIELD GOAL GOOD! +0.5', color: COLORS.lime };
  if (result.scoring_event === 'safety') return { text: 'SAFETY!', color: COLORS.maroon };
  if (result.scoring_event === 'td') return { text: 'TOUCHDOWN!', color: COLORS.lime };
  if (result.turnover) return { text: 'TURNOVER!', color: COLORS.maroon };
  return null;
}

function drawFlashOverlay(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  result: any,
  progress: number,
) {
  // Background tint fade
  let bgColor: string | null = null;
  if (result.scoring_event === 'fg' || result.scoring_event === 'td') bgColor = `rgba(63,185,80,${(progress - 0.5) * 2})`;
  else if (result.scoring_event === 'safety') bgColor = `rgba(210,153,34,${(progress - 0.5) * 2})`;
  else if (result.turnover) bgColor = `rgba(248,81,73,${(progress - 0.5) * 2})`;
  if (bgColor && progress > 0.5) {
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  // Big chunky text overlay (uses our 3x5 font scaled up)
  const flash = getFlashMessage(result);
  if (flash && progress > 0.55) {
    const scale = 4;
    const w = textWidth(flash.text, scale);
    const cx = (canvas.width - w) / 2;
    const cy = canvas.height / 2 - 10;
    // Background bar for legibility
    ctx.fillStyle = 'rgba(10, 10, 24, 0.7)';
    ctx.fillRect(cx - 8, cy - 6, w + 16, 5 * scale + 12);
    drawText(ctx, flash.text, cx, cy, flash.color, scale);
  }
}

// =============== Component ====================================================
export interface FieldProps {
  playResult: PlayResult | null;
  ballYardline: number;
  offenseDirection: 1 | -1;
  possessionIdx: 0 | 1;
  isAnimating: boolean;
  onAnimationDone?: () => void;
  homeName: string;
  awayName: string;
  homeScore: number;
  awayScore: number;
  down: 1 | 2 | 3 | 4;
  distance: number;
  /** Called every animation frame with progress 0..1. Used by RollReveal
   *  to sync reveal timing with the canvas animation. */
  onProgress?: (p: number) => void;
  /** Fires deterministic sound-design cues when their animation tick is
   * crossed, even if requestAnimationFrame skips over that exact tick. */
  onEffect?: (effect: PlayEffect) => void;
}

export default function Field({
  playResult,
  ballYardline,
  offenseDirection,
  possessionIdx,
  isAnimating,
  onAnimationDone,
  homeName,
  awayName,
  homeScore,
  awayScore,
  down,
  distance,
  onProgress,
  onEffect,
}: FieldProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | null>(null);
  const onEffectRef = useRef(onEffect);
  onEffectRef.current = onEffect;

  // Static between-plays render
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    if (!playResult) {
      if (animationRef.current != null) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
      particles = [];
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    // Scoreboard + crowds + field + status bar (chrome)
    drawScoreboard(ctx, homeName, awayName, homeScore, awayScore);
    drawCrowdBand(ctx, SCOREBOARD_H);
    drawFieldBase(ctx, ballYardline, offenseDirection, distance, homeName, awayName);
    drawCrowdBand(ctx, FIELD_BOTTOM);
    drawStatusBar(ctx, down, distance, ballYardline, offenseDirection);
    drawStaticLineup(ctx, ballYardline, offenseDirection, possessionIdx);
  }, [ballYardline, playResult, offenseDirection, possessionIdx, homeName, awayName, homeScore, awayScore, down, distance]);

  // Animation effect
  useEffect(() => {
    if (!playResult || !isAnimating) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const direction: 1 | -1 = playResult.offense_direction ?? offenseDirection;
    const playPossessionIdx: 0 | 1 = direction === 1 ? 0 : 1;
    const plan = buildPlayPlan(playResult, playPossessionIdx);
    const start = performance.now();
    const duration = plan.durationMs;
    const animLosYardline = playResult.yardline_before ?? ballYardline;
    const shake = shouldShake(playResult);
    let lastTick = -1;

    particles = []; // reset particles on new play

    const animate = (t: number) => {
      const elapsed = t - start;
      const progress = Math.min(1, elapsed / duration);

      const frame = frameAt(plan, progress);
      for (const effect of effectsBetween(plan.effects, lastTick, frame.tick)) {
        onEffectRef.current?.(effect);
      }
      lastTick = frame.tick;

      // Fixed-tick shake keeps seeded replays identical on every machine.
      ctx.save();
      if (shake && frame.tick > 42 && frame.tick < 72) {
        const intensity = frame.tick < 56 ? (frame.tick - 42) / 14 : (72 - frame.tick) / 16;
        const amp = Math.max(0, intensity) * 3;
        const xNoise = effectNoise(plan.seed, frame.tick, 91) - 0.5;
        const yNoise = effectNoise(plan.seed, frame.tick, 92) - 0.5;
        ctx.translate(
          Math.round(xNoise * amp),
          Math.round(yNoise * amp),
        );
      }

      drawScoreboard(ctx, homeName, awayName, homeScore, awayScore);
      drawCrowdBand(ctx, SCOREBOARD_H);
      drawFieldBase(ctx, animLosYardline, direction, playResult.distance, homeName, awayName);
      drawCrowdBand(ctx, FIELD_BOTTOM);
      drawStatusBar(ctx, playResult.down as 1 | 2 | 3 | 4, playResult.distance, animLosYardline, direction);

      drawPlayFrame(ctx, plan, frame, animLosYardline, direction);

      ctx.restore();

      // Notify the parent so the RollReveal HUD can sync reveals
      onProgress?.(progress);

      if (progress < 1) {
        animationRef.current = requestAnimationFrame(animate);
      } else {
        animationRef.current = null;
        onAnimationDone?.();
        // Force an immediate redraw at the new ballYardline + new direction.
        particles = [];
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        drawScoreboard(ctx, homeName, awayName, homeScore, awayScore);
        drawCrowdBand(ctx, SCOREBOARD_H);
        drawFieldBase(ctx, ballYardline, offenseDirection, distance, homeName, awayName);
        drawCrowdBand(ctx, FIELD_BOTTOM);
        drawStatusBar(ctx, down, distance, ballYardline, offenseDirection);
        drawStaticLineup(ctx, ballYardline, offenseDirection, possessionIdx);
      }
    };
    animationRef.current = requestAnimationFrame(animate);
    return () => {
      if (animationRef.current != null) cancelAnimationFrame(animationRef.current);
    };
  }, [playResult, isAnimating, ballYardline, offenseDirection, possessionIdx, homeName, awayName, homeScore, awayScore, down, distance]);

  return (
    <div
      className="w-full md:!w-auto md:!max-h-[clamp(280px,42vh,480px)] mx-auto"
      style={{ aspectRatio: `${FIELD_W} / ${FIELD_H}` }}
    >
      <canvas
        ref={canvasRef}
        width={FIELD_W}
        height={FIELD_H}
        className="block w-full h-full"
        style={{ imageRendering: 'pixelated' }}
      />
    </div>
  );
}

// Test export — exposed for unit testing the sprite renderer in Phase 2
export const __test = {
  FIELD_W,
  FIELD_H,
  YARD,
  SPRITE_SIZE,
  FONT_3x5,
  spriteConfigFor,
  teamsForPossession,
  computeFrame,
  jerseyNumFor,
  drawSprite,
};
