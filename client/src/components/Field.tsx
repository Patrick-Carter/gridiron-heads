import { useEffect, useRef } from 'react';
import { mulberry32 } from '@gridiron/shared';

interface FieldProps {
  playResult: any | null;
  ballYardline: number;
  possessionIdx: 0 | 1;
  isAnimating: boolean;
  onAnimationDone?: () => void;
}

/** Football positions relative to the line of scrimmage.
 *  Each x is in yards OFFSET from LOS (negative = behind LOS, positive = ahead).
 *  Each y is normalized [0,1] vertically.
 *  Direction of attack is handled at draw time. */
interface Lineup {
  qb: [number, number];       // behind LOS
  oline: [number, number][];  // 5, on the LOS
  wr: [number, number][];     // 2, ahead of LOS, split wide
  dline: [number, number][];  // 4, on the LOS (defense)
  cb: [number, number][];     // 2, deep (defense)
}

const FIELD_W = 800;
const FIELD_H = 400;
const YARD = FIELD_W / 100; // 8 px per yard

/** Build offensive lineup.
 *  Offense lines up BEHIND the LOS (x offsets are negative or zero).
 *  - QB: 5 yards behind LOS
 *  - O-Line: 5 across on the LOS
 *  - WR: slot/tight alignment, 2 yds behind LOS at the sidelines */
function buildOffense(): Lineup {
  const yMid = 0.5;
  const oline: [number, number][] = [];
  // 5 linemen on the LOS, spread across the field vertically for visual interest
  for (let i = 0; i < 5; i++) {
    const t = (i + 0.5) / 5;
    oline.push([0, 0.30 + t * 0.40]); // y range 0.30-0.70
  }
  const qb: [number, number] = [-5, yMid];
  const wr: [number, number][] = [
    [-2, 0.15],  // top slot WR
    [-2, 0.85],  // bottom slot WR
  ];
  return { qb, oline, wr, dline: [], cb: [] };
}

/** Build defensive lineup. Defense is AHEAD of LOS (positive x offsets).
 *  - D-Line: just ahead of LOS (1yd) to avoid overlapping O-Line pixels
 *  - CBs: 8 yds deep, wide */
function buildDefense(): Lineup {
  const dline: [number, number][] = [];
  for (let i = 0; i < 4; i++) {
    const t = (i + 0.5) / 4;
    dline.push([1, 0.30 + t * 0.40]);
  }
  const cb: [number, number][] = [
    [8, 0.12],
    [8, 0.88],
  ];
  return { qb: [0, 0], oline: [], wr: [], dline, cb };
}

/** Convert a lineup position (yards-offset, y-normalized) + LOS + direction to canvas (x, y).
 *  direction: +1 means offense attacks toward larger yardlines (right);
 *              -1 means offense attacks toward smaller yardlines (left). */
function toCanvas(
  xOffsetYards: number,
  yNorm: number,
  losYardline: number,
  direction: 1 | -1,
): [number, number] {
  const losPx = (losYardline / 100) * FIELD_W;
  const x = losPx + xOffsetYards * YARD * direction;
  const y = yNorm * FIELD_H;
  return [x, y];
}

export default function Field({
  playResult,
  ballYardline,
  possessionIdx,
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
    // When playResult becomes null (user clicked Next Play), cancel any in-flight
    // animation and clear the canvas so the static lineups render fresh.
    if (!playResult) {
      if (animationRef.current != null) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    // Direction of attack for the current offense:
    // possession_idx === 0 → offense attacks right (yardline 0→100)
    // possession_idx === 1 → offense attacks left (yardline 100→0)
    const direction: 1 | -1 = possessionIdx === 0 ? 1 : -1;
    drawField(ctx, canvas, ballYardline, direction);
    const off = buildOffense();
    const def = buildDefense();
    drawPlayerSet(ctx, off, ballYardline, direction, '#e6edf3');
    drawPlayerSet(ctx, def, ballYardline, direction, '#f85149');
  }, [ballYardline, possessionIdx, playResult]);

  useEffect(() => {
    if (!playResult || !isAnimating) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const seed = playResult.seed ?? 1;
    const start = performance.now();
    const duration = 1800;
    // Direction comes from the play's offense_direction (captured at snap time on server)
    const direction: 1 | -1 = (playResult.offense_direction ?? 1) as 1 | -1;

    const animate = (t: number) => {
      const elapsed = t - start;
      const progress = Math.min(1, elapsed / duration);
      // During animation: field without lineups, then animated overlays
      drawField(ctx, canvas, ballYardline, direction);
      drawPlay(ctx, canvas, playResult, seed, progress, direction);
      if (progress < 1) {
        animationRef.current = requestAnimationFrame(animate);
      } else {
        animationRef.current = null;
        onAnimationDone?.();
      }
    };
    animationRef.current = requestAnimationFrame(animate);
    return () => {
      if (animationRef.current != null) cancelAnimationFrame(animationRef.current);
    };
  }, [playResult, isAnimating]);

  return (
    <canvas
      ref={canvasRef}
      width={FIELD_W}
      height={FIELD_H}
      className="w-full bg-emerald-900 rounded border border-border"
    />
  );
}

function drawField(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  ballYardline: number,
  direction: 1 | -1,
) {
  const w = canvas.width;
  const h = canvas.height;
  // Field background — fillRect clears any previous frame
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
  // Line of scrimmage
  const losX = (ballYardline / 100) * w;
  ctx.strokeStyle = '#fde047';
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.moveTo(losX, 0);
  ctx.lineTo(losX, h);
  ctx.stroke();
  ctx.setLineDash([]);
  // LOS label — placed on the "behind" side of the LOS (where the offense stands)
  ctx.fillStyle = '#fde047';
  ctx.font = 'bold 11px monospace';
  ctx.fillText('LOS', losX + (direction === 1 ? -28 : 4), 14);
  // First down marker — 10 yards AHEAD of LOS in direction of attack
  const fdYardline = ballYardline + 10 * direction;
  const fdX = (fdYardline / 100) * w;
  if (fdX > 0 && fdX < w) {
    ctx.strokeStyle = '#fb923c';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(fdX, 0);
    ctx.lineTo(fdX, h);
    ctx.stroke();
    ctx.setLineDash([]);
    // 1ST label — placed on the "ahead" side of the marker (further from LOS)
    ctx.fillStyle = '#fb923c';
    ctx.fillText('1ST', fdX + (direction === 1 ? 4 : -28), h - 6);
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

function drawPlayerSet(
  ctx: CanvasRenderingContext2D,
  lineup: Lineup,
  losYardline: number,
  direction: 1 | -1,
  color: string,
) {
  if (lineup.qb[1] > 0 || lineup.qb[0] !== 0) {
    const [x, y] = toCanvas(lineup.qb[0], lineup.qb[1], losYardline, direction);
    drawPlayer(ctx, x, y, color, 7, 'Q');
  }
  for (const [xo, yn] of lineup.oline) {
    const [x, y] = toCanvas(xo, yn, losYardline, direction);
    drawPlayer(ctx, x, y, color, 6, 'O');
  }
  for (const [xo, yn] of lineup.wr) {
    const [x, y] = toCanvas(xo, yn, losYardline, direction);
    drawPlayer(ctx, x, y, color, 6, 'W');
  }
  for (const [xo, yn] of lineup.dline) {
    const [x, y] = toCanvas(xo, yn, losYardline, direction);
    drawPlayer(ctx, x, y, color, 6, 'D');
  }
  for (const [xo, yn] of lineup.cb) {
    const [x, y] = toCanvas(xo, yn, losYardline, direction);
    drawPlayer(ctx, x, y, color, 6, 'C');
  }
}

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
  // Black outline so dots stand out against the green field
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = '#000';
  ctx.font = 'bold 9px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x, y);
  ctx.textAlign = 'start';
  ctx.textBaseline = 'alphabetic';
}

function drawPlay(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  result: any,
  seed: number,
  progress: number,
  direction: 1 | -1,
) {
  const w = canvas.width;
  const h = canvas.height;
  const off = buildOffense();
  const def = buildDefense();
  const playType = result.off_call?.parent as string;
  const sub = result.off_call?.sub as string;
  const yards = result.yards ?? 0;
  const losYardline = result.yardline_before;

  // Draw animated offense + defense from the play's starting LOS
  // For positive yards, offense advances in direction; for losses, retreats (negative).
  drawAnimatedLineup(ctx, off, losYardline, direction, yards, progress, '#e6edf3', playType, sub);
  drawAnimatedLineup(ctx, def, losYardline, direction, yards, progress, '#f85149', playType, sub);

  // Ball animation
  const losPx = (losYardline / 100) * w;
  const yardsPx = yards * YARD * direction * progress;
  const ballX = losPx + yardsPx;
  let ballY = h * 0.5;
  if (playType === 'pass') {
    ballY = h * 0.5 - Math.sin(progress * Math.PI) * (sub === 'deep' ? h * 0.4 : h * 0.15);
  } else if (playType === 'fg') {
    ballY = h * 0.5 - Math.sin(progress * Math.PI) * h * 0.45;
  }
  ctx.fillStyle = '#92400e';
  ctx.beginPath();
  ctx.arc(ballX, ballY, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Catch flash on pass plays
  if (playType === 'pass' && progress > 0.6) {
    const wr = off.wr[0];
    if (wr) {
      const [rx, ry] = toCanvas(wr[0] + yards, wr[1], losYardline, direction);
      ctx.strokeStyle = '#fde047';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(rx, ry, 10 + (progress - 0.6) * 20, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // FG: draw uprights at end zone in direction of attack
  if (playType === 'fg' && progress > 0.7) {
    const uprightX = direction === 1 ? w - 30 : 30;
    ctx.strokeStyle = result.scoring_event === 'fg' ? '#3fb950' : '#f85149';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(uprightX, h * 0.3);
    ctx.lineTo(uprightX, h * 0.7);
    ctx.stroke();
  }

  // Turnover flash
  if (result.turnover && progress > 0.5) {
    ctx.fillStyle = `rgba(248,81,73,${(progress - 0.5) * 2})`;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 36px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('TURNOVER!', w / 2, h / 2);
    ctx.textAlign = 'start';
  }

  // TD banner
  if (result.scoring_event === 'td' && progress > 0.7) {
    ctx.fillStyle = `rgba(63,185,80,${(progress - 0.7) * 3})`;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 36px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('TOUCHDOWN!', w / 2, h / 2);
    ctx.textAlign = 'start';
  }
}

function drawAnimatedLineup(
  ctx: CanvasRenderingContext2D,
  lineup: Lineup,
  losYardline: number,
  direction: 1 | -1,
  yards: number,
  progress: number,
  color: string,
  playType: string,
  sub: string,
) {
  // Offense advances by yards*progress (negative for losses, retreats)
  const offShiftYards = yards * progress;
  // Defense surge on run plays
  const defShiftYards = playType === 'run' ? Math.max(0, yards) * 0.3 * progress : 0;
  const defRetreatYards = playType === 'pass' ? Math.max(0, yards) * 0.2 * progress : 0;

  // QB
  if (lineup.qb[0] !== 0 || lineup.qb[1] !== 0) {
    const [x, y] = toCanvas(lineup.qb[0] + offShiftYards, lineup.qb[1], losYardline, direction);
    drawPlayer(ctx, x, y, color, 7, 'Q');
  }
  // O-Line (slower shift than skill positions)
  for (const [xo, yn] of lineup.oline) {
    const [x, y] = toCanvas(xo + offShiftYards * 0.6, yn, losYardline, direction);
    drawPlayer(ctx, x, y, color, 6, 'O');
  }
  // WR (run full routes)
  for (const [xo, yn] of lineup.wr) {
    const routeShift = offShiftYards * (playType === 'pass' ? 1.2 : 0.7);
    const arc = sub === 'deep' ? Math.sin(progress * Math.PI) * 25 * direction : 0;
    const [x, y] = toCanvas(xo + routeShift, yn, losYardline, direction);
    // Apply arc as y offset (positive arc = up the field visually)
    drawPlayer(ctx, x + arc, y - Math.abs(arc) * 0.3, color, 6, 'W');
  }
  // D-Line (surge forward on run plays)
  for (const [xo, yn] of lineup.dline) {
    const [x, y] = toCanvas(xo + defShiftYards * direction, yn, losYardline, direction);
    drawPlayer(ctx, x, y, color, 6, 'D');
  }
  // CBs (retreat on pass plays)
  for (const [xo, yn] of lineup.cb) {
    const [x, y] = toCanvas(xo + defRetreatYards * direction, yn, losYardline, direction);
    drawPlayer(ctx, x, y, color, 6, 'C');
  }
}