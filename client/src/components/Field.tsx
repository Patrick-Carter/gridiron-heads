import { useEffect, useRef } from 'react';

interface FieldProps {
  playResult: any | null;
  ballYardline: number;
  isAnimating: boolean;
  onAnimationDone?: () => void;
}

/** Football positions relative to the line of scrimmage.
 *  Each x is in yards OFFSET from LOS (negative = behind LOS, positive = ahead).
 *  Each y is normalized [0,1] vertically.
 *  Field always renders going right — direction = +1. Punt/FG formations
 *  don't field a QB; they have a punter / holder / kicker instead. */
interface Lineup {
  qb?: [number, number];
  oline: [number, number][];
  wr: [number, number][];
  dline: [number, number][];
  cb: [number, number][];
  rb?: [number, number]; // running back — only used for run plays
  punter?: [number, number];
  kicker?: [number, number];
  snapper?: [number, number];
  holder?: [number, number];
  gunner?: [number, number][];
}

const FIELD_W = 800;
const FIELD_H = 400;
const YARD = FIELD_W / 100; // 8 px per yard
const DIRECTION: 1 | -1 = 1; // always attack right

// === Lineup builders — one per play family (D027) ============================
/** Standard pass / run look. QB behind LOS, O-line on LOS, WRs split wide,
 *  D-line on LOS, CBs deep. */
function buildStandard(): Lineup {
  const yMid = 0.50;
  const oline: [number, number][] = [];
  for (let i = 0; i < 5; i++) {
    const t = (i + 0.5) / 5;
    oline.push([0, yMid - 0.04 + t * 0.08]);
  }
  const qb: [number, number] = [-5, yMid];
  const wr: [number, number][] = [
    [-3, 0.18],
    [-3, 0.82],
  ];
  const dline: [number, number][] = [];
  for (let i = 0; i < 4; i++) {
    const t = (i + 0.5) / 4;
    dline.push([0, yMid - 0.03 + t * 0.06]);
  }
  const cb: [number, number][] = [
    [8, 0.15],
    [8, 0.85],
  ];
  return { qb, oline, wr, dline, cb };
}

/** Run formation — adds an RB behind QB so the runner can be highlighted
 *  during the animation. RB picks an off-tackle position based on sub. */
function buildRun(sub: 'inside' | 'outside'): Lineup {
  const base = buildStandard();
  const yMid = 0.50;
  // RB starts 3yds behind QB. For outside runs, push RB to the side he'll
  // sweep (mirrors the WR side).
  const rbY = sub === 'outside' ? (sub === 'outside' ? 0.18 : 0.82) : yMid;
  // (We can't truly know side without a coin flip — alternate by sub choice
  // with a consistent convention: 'outside' = right, mirrored at render time
  // via DIRECTION.)
  return { ...base, rb: [-8, rbY] };
}

/** Punt formation — line of scrimmage, gunners wide, punter deep. */
function buildPunt(): Lineup {
  const yMid = 0.50;
  const oline: [number, number][] = [];
  for (let i = 0; i < 5; i++) {
    const t = (i + 0.5) / 5;
    oline.push([0, yMid - 0.04 + t * 0.08]);
  }
  const snapper: [number, number] = [0, yMid];
  const punter: [number, number] = [-14, yMid];
  const gunner: [number, number][] = [
    [-3, 0.10],
    [-3, 0.90],
  ];
  // No QB in punt formation.
  const dline: [number, number][] = [];
  for (let i = 0; i < 4; i++) {
    const t = (i + 0.5) / 4;
    dline.push([0, yMid - 0.03 + t * 0.06]);
  }
  return { snapper, punter, gunner, oline, dline, wr: [], cb: [] };
}

/** Field-goal formation — snapper, holder 7yds back, kicker 8yds back. */
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

/** Convert a lineup position (yards-offset, y-normalized) + LOS to canvas (x, y). */
function toCanvas(xOffsetYards: number, yNorm: number, losYardline: number): [number, number] {
  const losPx = (losYardline / 100) * FIELD_W;
  const x = losPx + xOffsetYards * YARD * DIRECTION;
  const y = yNorm * FIELD_H;
  return [x, y];
}

// === Per-play-key animated positions (D027) ================================
// Each returns per-frame (x, y) for every named player, in canvas coords,
// given the live play-state (offset yards = how far the player has moved
// from their starting spot by `progress` of the animation).

type OffColor = string;
type DefColor = string;

interface AnimFrame {
  /** Map of role → [canvasX, canvasY]. */
  positions: Array<{ label: string; x: number; y: number; color: string; r: number; off: boolean }>;
  /** Ball center + rotation + scale (used by drawFootball). */
  ball: { x: number; y: number; angle: number; scale: number };
  /** Optional kick-leg (drawn over the kicker during punt/fg). */
  kick?: { from: [number, number]; to: [number, number]; opacity: number };
}

/** Picks the right animation strategy from a playResult. */
function computeFrame(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  result: any,
  progress: number,
): AnimFrame {
  const w = canvas.width;
  const los = result.yardline_before ?? 50;
  const yards = result.yards ?? 0;
  const parent = result.off_call?.parent ?? 'run';
  const sub = result.off_call?.sub ?? 'inside';
  const playKey = `${parent}-${sub}`;

  const offColor: OffColor = '#fff8dc';
  const defColor: DefColor = '#c8102e';

  // Build the lineup at the LOS (for the snap frame).
  const lineup: Lineup =
    parent === 'punt' ? buildPunt() :
    parent === 'fg'   ? buildFG()   :
    parent === 'run'  ? buildRun(sub as 'inside' | 'outside') :
                        buildStandard();

  // After the snap, each player moves a `offShift` or `defShift` yards
  // forward — set per playKey. Default to "offense advances forward,
  // defense advances proportional" if the playKey isn't handled.
  let offShiftTotal = yards * progress;
  let defShiftTotal = 0;

  const arc: (n: number) => number = (n) => Math.sin(progress * Math.PI) * n;

  // Ball: where does the ball go during the animation? For a gainer,
  // it ends up (los + yards) forward. For punt/fg, the ball arcs.
  let ballXEnd: number, ballYEnd: number;
  // Map LOS → pixel x.
  const losPx = (los / 100) * w;

  // Per-play strategies:
  switch (playKey) {
    case 'run-inside': {
      // QB hands off to RB; offensive line drives straight forward
      // (offShiftTotal = full yards by end of animation); RB follows the
      // line and ends up at the ball spot.
      defShiftTotal = yards * 0.6 * progress; // D-line pursues, retreats less
      // Ball carrier path: behind LOS, peeling up through the line, ending
      // forward. For animation, ball follows the RB.
      ballXEnd = losPx + yards * YARD * DIRECTION; // final ball pos
      // In-progress ball = RB's current spot
      break;
    }
    case 'run-outside': {
      // Sweep. RB swings wide + forward (lateral arc + forward motion).
      defShiftTotal = yards * 0.5 * progress;
      ballXEnd = losPx + yards * YARD * DIRECTION;
      break;
    }
    case 'pass-deep': {
      // QB drops back 7yds then ball arcs forward to a deep WR.
      // No offensive line surge. Offense total motion = 0 net.
      offShiftTotal = 0;
      defShiftTotal = 0;
      ballXEnd = losPx + yards * YARD * DIRECTION;
      break;
    }
    case 'pass-short': {
      // Quick release: ball moves quickly to a WR running a 5y hitch.
      offShiftTotal = 0;
      defShiftTotal = 0;
      ballXEnd = losPx + yards * YARD * DIRECTION;
      break;
    }
    case 'punt': {
      // Long snap arcs 14yds back to punter, then punter kicks the ball
      // forward ~40 yds. Net result: ball ends up ahead by yards.
      offShiftTotal = 0;
      defShiftTotal = 0;
      ballXEnd = losPx + yards * YARD * DIRECTION;
      break;
    }
    case 'fg': {
      // Snap → hold → kick. Ball arcs high and far.
      offShiftTotal = 0;
      defShiftTotal = 0;
      ballXEnd = losPx + yards * YARD * DIRECTION;
      break;
    }
    default: {
      // safety net — should never reach.
      offShiftTotal = yards * progress;
      defShiftTotal = yards * 0.3 * progress;
      ballXEnd = losPx + yards * YARD * DIRECTION;
    }
  }

  // Compute ball mid-flight path. For punt/fg we override the (x,y) over
  // the play with an arc; for run/pass we follow the runner / QB-WR arc.
  let ballX: number, ballY: number, ballAngle = 0, ballScale = 1;
  switch (playKey) {
    case 'run-inside': {
      // Ball follows RB (which is positioned at the runner path)
      const ballRx = losPx + (yards * progress) * YARD * DIRECTION;
      const ballRy = FIELD_H * 0.50 + arc(8 * DIRECTION); // slight wiggle
      ballX = ballRx;
      ballY = ballRy;
      ballAngle = 0;
      ballScale = 1;
      break;
    }
    case 'run-outside': {
      // Sweeping curve. Ball arcs to the side as it moves forward.
      const ballRx = losPx + (yards * progress) * YARD * DIRECTION;
      const sweepDir = (sub === 'outside') ? 1 : -1; // by convention (could flip)
      const ballRy = FIELD_H * 0.50 + arc(40 * sweepDir);
      ballX = ballRx;
      ballY = ballRy;
      ballAngle = 0.4 * sweepDir * arc(1);
      ballScale = 1;
      break;
    }
    case 'pass-deep': {
      // QB drops back, then ball launches to a WR deep. Arc through the air.
      // Until 0.4, ball is behind LOS (with QB at -7yds). After 0.4, ball
      // travels to WR spot.
      const drop = Math.min(progress / 0.4, 1); // 0..1
      const release = Math.max((progress - 0.4) / 0.6, 0); // 0..1
      const qbDropPx = 7 * YARD;
      if (release <= 0) {
        ballX = losPx - qbDropPx * DIRECTION;
        ballY = FIELD_H * 0.50;
        ballAngle = Math.PI / 2; // pointing back (we're being held)
      } else {
        // WR target: (sub === 'deep' ? ahead 25 : ahead 8) yards, plus some lift
        const targetX = losPx + yards * YARD * DIRECTION;
        const targetY = FIELD_H * 0.50 - (sub === 'deep' ? 60 : 30);
        const fromX = losPx - qbDropPx * DIRECTION;
        const fromY = FIELD_H * 0.50;
        // Linear interp from (from) → (to), then apply sin-arc lift.
        const ix = fromX + (targetX - fromX) * release;
        const iy = fromY + (targetY - fromY) * release - Math.sin(release * Math.PI) * 40;
        ballX = ix;
        ballY = iy;
        ballAngle = Math.atan2(targetY - iy, targetX - ix) || 0;
      }
      ballScale = 1;
      break;
    }
    case 'pass-short': {
      // Ball arcs quickly to a WR running a hitch at ~6yds.
      const release = progress; // quick — full arc
      const targetX = losPx + yards * YARD * DIRECTION;
      const targetY = FIELD_H * 0.50 - 12;
      const fromX = losPx;
      const fromY = FIELD_H * 0.50;
      ballX = fromX + (targetX - fromX) * release;
      ballY = fromY + (targetY - fromY) * release - Math.sin(release * Math.PI) * 28;
      ballAngle = Math.atan2(targetY - ballY, targetX - ballX) || 0;
      ballScale = 1;
      break;
    }
    case 'punt': {
      // Phase 1 (0..0.3): long snap arc from snapper to punter (5yds back).
      // Phase 2 (0.3..0.5): punter holds ball low.
      // Phase 3 (0.5..1): punt kick — ball arcs high forward ~40yds.
      if (progress < 0.3) {
        const t = progress / 0.3;
        const fromX = losPx;
        const fromY = FIELD_H * 0.50;
        const toX = losPx + 14 * YARD * DIRECTION;
        const toY = FIELD_H * 0.50;
        ballX = fromX + (toX - fromX) * t;
        ballY = fromY + (toY - fromY) * t - Math.sin(t * Math.PI) * 5;
        ballAngle = Math.PI; // traveling tail-first during snap
      } else if (progress < 0.55) {
        const t = (progress - 0.3) / 0.25;
        const toX = losPx + 14 * YARD * DIRECTION;
        ballX = losPx + 14 * YARD * DIRECTION;
        ballY = FIELD_H * 0.50;
        ballAngle = t * Math.PI; // wind up
      } else {
        const t = (progress - 0.55) / 0.45;
        const fromX = losPx + 14 * YARD * DIRECTION;
        const targetX = losPx + yards * YARD * DIRECTION;
        ballX = fromX + (targetX - fromX) * t;
        ballY = FIELD_H * 0.50 - Math.sin(t * Math.PI) * 90;
        // Velocity vector for orientation
        const dx = targetX - fromX;
        const dy = -Math.cos(t * Math.PI) * 90;
        ballAngle = Math.atan2(dy, dx);
      }
      ballScale = 1;
      break;
    }
    case 'fg': {
      // Snap (0..0.2) → hold (0.2..0.45) → kick (0.45..1) → flight.
      if (progress < 0.2) {
        const t = progress / 0.2;
        const toX = losPx + 7 * YARD * DIRECTION;
        ballX = losPx + (toX - losPx) * t;
        ballY = FIELD_H * 0.50 - Math.sin(t * Math.PI) * 4;
        ballAngle = Math.PI;
      } else if (progress < 0.45) {
        ballX = losPx + 7 * YARD * DIRECTION;
        ballY = FIELD_H * 0.50;
        ballAngle = (progress - 0.2) * 4;
      } else {
        const t = (progress - 0.45) / 0.55;
        const fromX = losPx + 7 * YARD * DIRECTION;
        const targetX = losPx + yards * YARD * DIRECTION;
        ballX = fromX + (targetX - fromX) * t;
        ballY = FIELD_H * 0.50 - Math.sin(t * Math.PI) * 90;
        const dx = targetX - fromX;
        const dy = -Math.cos(t * Math.PI) * 90;
        ballAngle = Math.atan2(dy, dx);
      }
      ballScale = 1;
      break;
    }
    default: {
      ballX = losPx + (yards * progress) * YARD * DIRECTION;
      ballY = FIELD_H * 0.50;
      ballAngle = 0;
      ballScale = 1;
    }
  }

  // Compute positions for each named player, mapping each lineup role
  // through toCanvas after applying per-play motion.
  const positions: AnimFrame['positions'] = [];

  const drawOne = (
    label: string,
    baseX: number,
    baseY: number,
    color: string,
    off: boolean,
    r = 6,
    xShift = 0,
    yShift = 0,
    yCurve = 0,
  ) => {
    const effectiveX = baseX + xShift;
    const effectiveY = baseY + yShift + Math.sin(progress * Math.PI) * yCurve;
    const [x, y] = toCanvas(effectiveX, effectiveY, los);
    positions.push({ label, x, y, color, r, off });
  };

  // Offense (always O-line + WRs + QB, except punt/fg which don't have a QB)
  if (lineup.oline.length) {
    const idx = lineup.oline.length;
    lineup.oline.forEach(([xo, yn], i) => {
      if (parent === 'punt' || parent === 'fg') {
        // O-line holds the LOS during punt/fg
        drawOne('O', xo, yn, offColor, true, 6, 0);
      } else {
        drawOne('O', xo, yn, offColor, true, 6, xo + offShiftTotal * 0.5);
      }
      void i; void idx;
    });
  }
  if (lineup.qb && (lineup.qb[0] !== 0 || lineup.qb[1] !== 0)) {
    if (parent === 'pass-deep') {
      // QB drops back 7yds then doesn't move forward
      const drop = Math.min(progress / 0.4, 1) * 7;
      drawOne('Q', lineup.qb[0] - drop, lineup.qb[1], offColor, true, 7);
    } else if (parent === 'pass-short') {
      // QB quick-steps 3yds back
      drawOne('Q', lineup.qb[0] - 3 * progress, lineup.qb[1], offColor, true, 7);
    } else if (parent === 'run-inside') {
      // QB hands off and watches
      drawOne('Q', lineup.qb[0] + 1 * progress, lineup.qb[1] - 0.02 * progress, offColor, true, 7);
    } else if (parent === 'run-outside') {
      drawOne('Q', lineup.qb[0] + 0.5 * progress, lineup.qb[1], offColor, true, 7);
    } else {
      drawOne('Q', lineup.qb[0], lineup.qb[1], offColor, true, 7);
    }
  }
  if (lineup.wr && lineup.wr.length) {
    lineup.wr.forEach(([xo, yn], i) => {
      if (parent === 'pass-deep') {
        // WR runs a deep post — pushes forward, with a slight diagonal cut
        const deepRoute = 25 * progress;
        drawOne('W', xo + deepRoute, yn - 0.06 * progress, offColor, true, 6);
      } else if (parent === 'pass-short') {
        // WR runs a 5yd hitch
        const shortRoute = 5 * progress;
        drawOne('W', xo + shortRoute, yn - 0.04 * progress, offColor, true, 6);
      } else if (parent === 'run-outside') {
        // WR leads the sweep — runs forward and toward the side the RB is sweeping
        const sweepDir = (sub === 'outside') ? 1 : -1;
        drawOne('W', xo + 6 * progress, yn, offColor, true, 6, 0, sweepDir * 0.04 * progress);
      } else {
        // Run-inside / standard: WRs block — slight forward push
        drawOne('W', xo + 2 * progress, yn, offColor, true, 6);
      }
      void i;
    });
  }
  // RB — only on run plays
  if (lineup.rb) {
    if (parent === 'run-inside') {
      // RB takes handoff, pushes straight through the LOS
      drawOne('R', lineup.rb[0] + offShiftTotal, lineup.rb[1], offColor, true, 7);
    } else if (parent === 'run-outside') {
      // RB swings wide — arc from -8yds back, past the LOS, to outside the tackle box
      const sweepDir = (sub === 'outside') ? 1 : -1;
      drawOne('R', lineup.rb[0] + offShiftTotal, lineup.rb[1] + sweepDir * 0.10 * progress, offColor, true, 7);
    }
  }
  // Snapper / holder / kicker / punter / gunner
  if (lineup.snapper) {
    drawOne('S', lineup.snapper[0], lineup.snapper[1], offColor, true, 6);
  }
  if (lineup.holder) {
    // Holder stays still until the kick, then drops the ball
    if (parent === 'fg' && progress < 0.45) {
      drawOne('H', lineup.holder[0], lineup.holder[1] + 0.02, offColor, true, 6);
    } else if (parent === 'fg' && progress < 0.6) {
      drawOne('H', lineup.holder[0], lineup.holder[1] + 0.04, offColor, true, 6);
    } else {
      drawOne('H', lineup.holder[0], lineup.holder[1], offColor, true, 6);
    }
  }
  if (lineup.kicker) {
    if (parent === 'fg' && progress > 0.4 && progress < 0.5) {
      // Kicker wind-up
      drawOne('K', lineup.kicker[0], lineup.kicker[1] - 0.04, offColor, true, 6);
    } else if (parent === 'fg' && progress >= 0.5 && progress < 0.55) {
      // Kicker kicks — animated leg
      drawOne('K', lineup.kicker[0], lineup.kicker[1] - 0.01, offColor, true, 6);
    } else {
      drawOne('K', lineup.kicker[0], lineup.kicker[1], offColor, true, 6);
    }
  }
  if (lineup.punter) {
    if (parent === 'punt' && progress > 0.25 && progress < 0.55) {
      // Punter catches the snap
      drawOne('P', lineup.punter[0], lineup.punter[1], offColor, true, 6);
    } else if (parent === 'punt' && progress >= 0.55 && progress < 0.6) {
      drawOne('P', lineup.punter[0], lineup.punter[1] + 0.04, offColor, true, 6);
    } else {
      drawOne('P', lineup.punter[0], lineup.punter[1], offColor, true, 6);
    }
  }
  if (lineup.gunner) {
    lineup.gunner.forEach(([xo, yn], i) => {
      // Gunners race downfield
      const race = (parent === 'punt' ? 18 : 0) * progress;
      drawOne('G', xo + race, yn, offColor, true, 6);
      void i;
    });
  }

  // Defense
  if (lineup.dline && lineup.dline.length) {
    lineup.dline.forEach(([xo, yn], i) => {
      let xShift = 0;
      if (parent === 'run-inside') xShift = defShiftTotal;
      else if (parent === 'run-outside') {
        // D-line collapses toward the sweep side
        const sweepDir = (sub === 'outside') ? 1 : -1;
        xShift = defShiftTotal * 0.6;
        drawOne('D', xo + xShift, yn + sweepDir * 0.03 * progress, defColor, false, 6);
        return;
      } else if (parent === 'pass-deep' || parent === 'pass-short') {
        // Pass rush: D-line pushes forward fast (3-4yds)
        const rushX = Math.min(progress * 4, 3);
        drawOne('D', xo + rushX, yn, defColor, false, 6);
        return;
      } else if (parent === 'fg' || parent === 'punt') {
        // B-line tries to block the kick
        if (progress > 0.45 && progress < 0.55) {
          drawOne('D', xo + 3 * (progress - 0.45) / 0.1, yn, defColor, false, 6);
          return;
        }
        drawOne('D', xo, yn, defColor, false, 6);
        return;
      } else {
        xShift = defShiftTotal * 0.5;
      }
      drawOne('D', xo + xShift, yn, defColor, false, 6);
      void i;
    });
  }
  if (lineup.cb && lineup.cb.length) {
    lineup.cb.forEach(([xo, yn], i) => {
      if (parent === 'pass-deep') {
        // CBs drop to deep zone
        const drop = Math.min(progress * 12, 10);
        drawOne('C', xo + drop, yn + (i === 0 ? -0.04 : 0.04) * progress, defColor, false, 6);
      } else if (parent === 'pass-short') {
        const drop = Math.min(progress * 6, 5);
        drawOne('C', xo + drop, yn, defColor, false, 6);
      } else {
        drawOne('C', xo, yn, defColor, false, 6);
      }
    });
  }

  // Kick leg (during fg & punt kicking phases)
  let kick: AnimFrame['kick'] = undefined;
  if (parent === 'fg' && progress > 0.45 && progress < 0.55) {
    const t = (progress - 0.45) / 0.10;
    const kickerPos = toCanvas(-8, 0.45, los);
    const ballPos = [ballX, ballY] as [number, number];
    kick = {
      from: kickerPos,
      to: [kickerPos[0] + (ballPos[0] - kickerPos[0]) * t, kickerPos[1] - Math.sin(t * Math.PI) * 10],
      opacity: 1 - Math.abs(0.5 - t) * 2, // peak at t=0.5
    };
  } else if (parent === 'punt' && progress > 0.45 && progress < 0.6) {
    const t = (progress - 0.45) / 0.15;
    const punterPos = toCanvas(-14, 0.50, los);
    const ballPos = [ballX, ballY] as [number, number];
    kick = {
      from: punterPos,
      to: [punterPos[0] + (ballPos[0] - punterPos[0]) * t, punterPos[1] - Math.sin(t * Math.PI) * 14],
      opacity: 1 - Math.abs(0.5 - t) * 2,
    };
  }
  void ctx; // ctx not needed here — caller draws.

  return {
    positions,
    ball: { x: ballX, y: ballY, angle: ballAngle, scale: ballScale },
    kick,
  };
}

// === Drawing helpers ========================================================
function drawPlayer(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: string,
  r: number,
  label: string,
) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = '#000';
  ctx.font = 'bold 9px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x, y);
}

/** Draw a football-shaped ball (D028). Oriented prolate spheroid with
 *  a laces stripe. Rotation is applied via ctx.translate/rotate around
 *  the ball's own center. */
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
  // Body — 16 long × 9 short axis prolate (canvas pixels), but we shrink
  // slightly so it reads well at the standard 5-px radius scale.
  const len = 14;
  const wid = 7;
  ctx.fillStyle = '#5b2a0a';
  ctx.beginPath();
  ctx.ellipse(0, 0, len, wid, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#2c1505';
  ctx.lineWidth = 1.2;
  ctx.stroke();
  // Laces — a stripe near the right point + 3 short stitches.
  ctx.strokeStyle = '#fff8dc';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(4, 0);
  ctx.lineTo(11, 0);
  ctx.stroke();
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.moveTo(5 + i * 2.5, -2.5);
    ctx.lineTo(5 + i * 2.5, 2.5);
    ctx.stroke();
  }
  // Tip highlight
  ctx.fillStyle = 'rgba(255, 248, 220, 0.18)';
  ctx.beginPath();
  ctx.ellipse(-3, -1.5, 5, 1.4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawKickLeg(
  ctx: CanvasRenderingContext2D,
  from: [number, number],
  to: [number, number],
  opacity: number,
) {
  ctx.save();
  ctx.strokeStyle = `rgba(91, 42, 10, ${opacity})`;
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(from[0], from[1]);
  ctx.lineTo(to[0], to[1]);
  ctx.stroke();
  ctx.restore();
}

function drawField(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, ballYardline: number) {
  const w = canvas.width;
  const h = canvas.height;
  // Field background
  ctx.fillStyle = '#0a3d1f';
  ctx.fillRect(0, 0, w, h);
  // Yard lines every 10 yards
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 10; i++) {
    const x = (i / 10) * w;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  // End zones
  ctx.fillStyle = 'rgba(88,166,255,0.2)';
  ctx.fillRect(0, 0, w / 20, h);
  ctx.fillRect(w - w / 20, 0, w / 20, h);
  // Line of scrimmage (only if we're in pre-snap — when animating, drawPlay
  // skips this and just re-uses drawField() with the LOS indicator hidden)
  const losX = (ballYardline / 100) * w;
  ctx.strokeStyle = '#fde047';
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.moveTo(losX, 0);
  ctx.lineTo(losX, h);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = '#fde047';
  ctx.font = 'bold 11px monospace';
  ctx.fillText('LOS', losX - 28, 14);
  // First down marker — 10 yards AHEAD of LOS
  const fdX = ((ballYardline + 10) / 100) * w;
  if (fdX > 0 && fdX < w) {
    ctx.strokeStyle = '#fb923c';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(fdX, 0);
    ctx.lineTo(fdX, h);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#fb923c';
    ctx.fillText('1ST', fdX + 4, h - 6);
  }
  // Hash marks
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 10; i++) {
    const x = (i / 10) * w;
    ctx.beginPath();
    ctx.moveTo(x, h * 0.32);
    ctx.lineTo(x, h * 0.34);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x, h * 0.66);
    ctx.lineTo(x, h * 0.68);
    ctx.stroke();
  }
}

// === Main component ========================================================
export default function Field({
  playResult,
  ballYardline,
  isAnimating,
  onAnimationDone,
}: FieldProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    // Cancel any in-flight animation if playResult becomes null
    if (!playResult) {
      if (animationRef.current != null) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    drawField(ctx, canvas, ballYardline);
    const off = buildStandard();
    const def = { ...buildStandard(), dline: off.dline, cb: off.cb };
    drawPlayerSet(ctx, off, ballYardline, '#fff8dc');
    drawPlayerSet(ctx, def, ballYardline, '#c8102e');
  }, [ballYardline, playResult]);

  useEffect(() => {
    if (!playResult || !isAnimating) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const start = performance.now();
    const duration = 1800;
    const animLosYardline = playResult.yardline_before ?? ballYardline;

    const animate = (t: number) => {
      const elapsed = t - start;
      const progress = Math.min(1, elapsed / duration);
      // Draw the field WITHOUT LOS marker overlay so the play animation owns
      // the screen. Static lineups are also NOT drawn here — the per-frame
      // positions are computed in computeFrame.
      drawField(ctx, canvas, animLosYardline);
      // Hide the LOS label during animation by drawing a bar over it.
      ctx.fillStyle = '#0a3d1f';
      ctx.fillRect(((animLosYardline / 100) * canvas.width) - 32, 0, 32, 18);
      const frame = computeFrame(ctx, canvas, playResult, progress);
      for (const p of frame.positions) {
        drawPlayer(ctx, p.x, p.y, p.color, p.r, p.label);
      }
      drawFootball(ctx, frame.ball.x, frame.ball.y, frame.ball.angle, frame.ball.scale);
      if (frame.kick) {
        drawKickLeg(ctx, frame.kick.from, frame.kick.to, frame.kick.opacity);
      }

      // Scoring flashes — priority: FG made > SAFETY > TD > TURNOVER
      if (playResult.scoring_event === 'fg' && progress > 0.5) {
        ctx.fillStyle = `rgba(63,185,80,${(progress - 0.5) * 2})`;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 36px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('FIELD GOAL GOOD! +0.5', canvas.width / 2, canvas.height / 2);
        ctx.textAlign = 'start';
      } else if (playResult.scoring_event === 'safety' && progress > 0.5) {
        ctx.fillStyle = `rgba(210,153,34,${(progress - 0.5) * 2})`;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 36px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('SAFETY!', canvas.width / 2, canvas.height / 2);
        ctx.textAlign = 'start';
      } else if (playResult.scoring_event === 'td' && progress > 0.5) {
        ctx.fillStyle = `rgba(63,185,80,${(progress - 0.5) * 2})`;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 36px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('TOUCHDOWN!', canvas.width / 2, canvas.height / 2);
        ctx.textAlign = 'start';
      } else if (playResult.turnover && progress > 0.5) {
        ctx.fillStyle = `rgba(248,81,73,${(progress - 0.5) * 2})`;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 36px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('TURNOVER!', canvas.width / 2, canvas.height / 2);
        ctx.textAlign = 'start';
      }

      if (progress < 1) {
        animationRef.current = requestAnimationFrame(animate);
      } else {
        animationRef.current = null;
        onAnimationDone?.();
        // Force an immediate redraw at the new ballYardline
        drawField(ctx, canvas, ballYardline);
        const off = buildStandard();
        const def = { ...buildStandard(), dline: off.dline, cb: off.cb };
        drawPlayerSet(ctx, off, ballYardline, '#fff8dc');
        drawPlayerSet(ctx, def, ballYardline, '#c8102e');
      }
    };
    animationRef.current = requestAnimationFrame(animate);
    return () => {
      if (animationRef.current != null) cancelAnimationFrame(animationRef.current);
    };
  }, [playResult, isAnimating, ballYardline]);

  return (
    <div className="w-full" style={{ aspectRatio: `${FIELD_W} / ${FIELD_H}` }}>
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

function drawPlayerSet(
  ctx: CanvasRenderingContext2D,
  lineup: Lineup,
  losYardline: number,
  color: string,
) {
  // Minimal static rendering for between-plays view. Uses default positions
  // (buildStandard) so the look is uniform regardless of last play.
  if (lineup.qb && (lineup.qb[0] !== 0 || lineup.qb[1] !== 0)) {
    const [x, y] = toCanvas(lineup.qb[0], lineup.qb[1], losYardline);
    drawPlayer(ctx, x, y, color, 7, 'Q');
  }
  for (const [xo, yn] of lineup.oline) {
    const [x, y] = toCanvas(xo, yn, losYardline);
    drawPlayer(ctx, x, y, color, 6, 'O');
  }
  for (const [xo, yn] of lineup.wr) {
    const [x, y] = toCanvas(xo, yn, losYardline);
    drawPlayer(ctx, x, y, color, 6, 'W');
  }
  for (const [xo, yn] of lineup.dline) {
    const [x, y] = toCanvas(xo, yn, losYardline);
    drawPlayer(ctx, x, y, color, 6, 'D');
  }
  for (const [xo, yn] of lineup.cb) {
    const [x, y] = toCanvas(xo, yn, losYardline);
    drawPlayer(ctx, x, y, color, 6, 'C');
  }
}
