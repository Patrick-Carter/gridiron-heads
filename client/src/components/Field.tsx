import { useEffect, useRef } from 'react';
import { mulberry32 } from '@gridiron/shared';

interface FieldProps {
  playResult: any | null;
  ballYardline: number;
  isAnimating: boolean;
  onAnimationDone?: () => void;
}

/** Football positions relative to the line of scrimmage.
 *  Each x is in yards OFFSET from LOS (negative = behind LOS, positive = ahead).
 *  Each y is normalized [0,1] vertically.
 *  Field always renders going right — direction = +1. */
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
const DIRECTION: 1 | -1 = 1; // always attack right

/** Build offensive lineup. Offense lines up BEHIND the LOS. */
function buildOffense(): Lineup {
  const yMid = 0.50;
  const oline: [number, number][] = [];
  for (let i = 0; i < 5; i++) {
    const t = (i + 0.5) / 5;
    oline.push([0, yMid - 0.04 + t * 0.08]);
  }
  const qb: [number, number] = [-5, yMid];
  const wr: [number, number][] = [
    [-3, 0.20],
    [-3, 0.80],
  ];
  return { qb, oline, wr, dline: [], cb: [] };
}

/** Build defensive lineup. Defense lines up AHEAD of the LOS. */
function buildDefense(): Lineup {
  const yMid = 0.50;
  const dline: [number, number][] = [];
  for (let i = 0; i < 4; i++) {
    const t = (i + 0.5) / 4;
    dline.push([0, yMid - 0.03 + t * 0.06]);
  }
  const cb: [number, number][] = [
    [8, 0.15],
    [8, 0.85],
  ];
  return { qb: [0, 0], oline: [], wr: [], dline, cb };
}

/** Convert a lineup position (yards-offset, y-normalized) + LOS to canvas (x, y). */
function toCanvas(xOffsetYards: number, yNorm: number, losYardline: number): [number, number] {
  const losPx = (losYardline / 100) * FIELD_W;
  const x = losPx + xOffsetYards * YARD * DIRECTION;
  const y = yNorm * FIELD_H;
  return [x, y];
}

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
    const off = buildOffense();
    const def = buildDefense();
    drawPlayerSet(ctx, off, ballYardline, '#e6edf3');
    drawPlayerSet(ctx, def, ballYardline, '#f85149');
  }, [ballYardline, playResult]);

  useEffect(() => {
    if (!playResult || !isAnimating) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const seed = playResult.seed ?? 1;
    const start = performance.now();
    const duration = 1800;
    const animLosYardline = playResult.yardline_before ?? ballYardline;

    const animate = (t: number) => {
      const elapsed = t - start;
      const progress = Math.min(1, elapsed / duration);
      drawField(ctx, canvas, animLosYardline);
      drawPlay(ctx, canvas, playResult, seed, progress);
      if (progress < 1) {
        animationRef.current = requestAnimationFrame(animate);
      } else {
        animationRef.current = null;
        onAnimationDone?.();
        // Force an immediate redraw at the new ballYardline
        drawField(ctx, canvas, ballYardline);
        const off = buildOffense();
        const def = buildDefense();
        drawPlayerSet(ctx, off, ballYardline, '#e6edf3');
        drawPlayerSet(ctx, def, ballYardline, '#f85149');
      }
    };
    animationRef.current = requestAnimationFrame(animate);
    return () => {
      if (animationRef.current != null) cancelAnimationFrame(animationRef.current);
    };
  }, [playResult, isAnimating, ballYardline]);

  return (
    <canvas
      ref={canvasRef}
      width={FIELD_W}
      height={FIELD_H}
      className="w-full bg-emerald-900 rounded border border-border"
    />
  );
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

function drawPlayerSet(
  ctx: CanvasRenderingContext2D,
  lineup: Lineup,
  losYardline: number,
  color: string,
) {
  if (lineup.qb[1] > 0 || lineup.qb[0] !== 0) {
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

function drawPlay(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  result: any,
  seed: number,
  progress: number,
) {
  const w = canvas.width;
  const h = canvas.height;
  const off = buildOffense();
  const def = buildDefense();
  const playType = result.off_call?.parent as string;
  const sub = result.off_call?.sub as string;
  const yards = result.yards ?? 0;
  const losYardline = result.yardline_before;

  drawAnimatedLineup(ctx, off, losYardline, yards, progress, '#e6edf3', playType, sub);
  drawAnimatedLineup(ctx, def, losYardline, yards, progress, '#f85149', playType, sub);

  // Ball animation
  const losPx = (losYardline / 100) * w;
  const yardsPx = yards * YARD * DIRECTION * progress;
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
      const [rx, ry] = toCanvas(wr[0] + yards, wr[1], losYardline);
      ctx.strokeStyle = '#fde047';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(rx, ry, 10 + (progress - 0.6) * 20, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // FG: draw uprights at right end zone
  if (playType === 'fg' && progress > 0.7) {
    const uprightX = w - 30;
    ctx.strokeStyle = result.scoring_event === 'fg' ? '#3fb950' : '#f85149';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(uprightX, h * 0.3);
    ctx.lineTo(uprightX, h * 0.7);
    ctx.stroke();
  }

  // Scoring flashes — priority: FG made > SAFETY > TD > TURNOVER
  if (result.scoring_event === 'fg' && progress > 0.5) {
    ctx.fillStyle = `rgba(63,185,80,${(progress - 0.5) * 2})`;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 36px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('FIELD GOAL GOOD! +0.5', w / 2, h / 2);
    ctx.textAlign = 'start';
  } else if (result.scoring_event === 'safety' && progress > 0.5) {
    ctx.fillStyle = `rgba(210,153,34,${(progress - 0.5) * 2})`;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 36px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('SAFETY!', w / 2, h / 2);
    ctx.textAlign = 'start';
  } else if (result.scoring_event === 'td' && progress > 0.5) {
    ctx.fillStyle = `rgba(63,185,80,${(progress - 0.5) * 2})`;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 36px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('TOUCHDOWN!', w / 2, h / 2);
    ctx.textAlign = 'start';
  } else if (result.turnover && progress > 0.5) {
    ctx.fillStyle = `rgba(248,81,73,${(progress - 0.5) * 2})`;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 36px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('TURNOVER!', w / 2, h / 2);
    ctx.textAlign = 'start';
  }
}

function drawAnimatedLineup(
  ctx: CanvasRenderingContext2D,
  lineup: Lineup,
  losYardline: number,
  yards: number,
  progress: number,
  color: string,
  playType: string,
  sub: string,
) {
  const offShiftYards = yards * progress;
  const defShiftYards = playType === 'run' ? Math.max(0, yards) * 0.3 * progress : 0;
  const defRetreatYards = playType === 'pass' ? Math.max(0, yards) * 0.2 * progress : 0;

  if (lineup.qb[0] !== 0 || lineup.qb[1] !== 0) {
    const [x, y] = toCanvas(lineup.qb[0] + offShiftYards, lineup.qb[1], losYardline);
    drawPlayer(ctx, x, y, color, 7, 'Q');
  }
  for (const [xo, yn] of lineup.oline) {
    const [x, y] = toCanvas(xo + offShiftYards * 0.6, yn, losYardline);
    drawPlayer(ctx, x, y, color, 6, 'O');
  }
  for (const [xo, yn] of lineup.wr) {
    const routeShift = offShiftYards * (playType === 'pass' ? 1.2 : 0.7);
    const arc = sub === 'deep' ? Math.sin(progress * Math.PI) * 25 * DIRECTION : 0;
    const [x, y] = toCanvas(xo + routeShift, yn, losYardline);
    drawPlayer(ctx, x + arc, y - Math.abs(arc) * 0.3, color, 6, 'W');
  }
  for (const [xo, yn] of lineup.dline) {
    const [x, y] = toCanvas(xo + defShiftYards * DIRECTION, yn, losYardline);
    drawPlayer(ctx, x, y, color, 6, 'D');
  }
  for (const [xo, yn] of lineup.cb) {
    const [x, y] = toCanvas(xo + defRetreatYards * DIRECTION, yn, losYardline);
    drawPlayer(ctx, x, y, color, 6, 'C');
  }
}