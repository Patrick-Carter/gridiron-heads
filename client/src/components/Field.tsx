import { useEffect, useRef } from 'react';
import { mulberry32 } from '@gridiron/shared';

interface FieldProps {
  playResult: any | null;
  ballYardline: number;
  possessionIdx: number;
  isAnimating: boolean;
  onAnimationDone?: () => void;
}

/** Football positions on a 100x53.3 yard field, line of scrimmage at yardLine. */
interface Lineup {
  qb: [number, number];
  oline: [number, number][]; // 5
  wr: [number, number][]; // 2
  dline: [number, number][]; // 4
  cb: [number, number][]; // 2
}

const FIELD_W = 800;
const FIELD_H = 400;
const YARD_W = FIELD_W / 100; // 8 px per yard

/** Generate lineup positions in [0, 1] canvas-relative coords. */
function buildLineup(yardLine: number, side: 'offense' | 'defense'): Lineup {
  const los = yardLine; // 0..100
  // Offense faces right (toward 100), defense faces left.
  // Positions are normalized [0,1] of canvas dimensions.
  // Line of scrimmage marker y-position
  const yMid = 0.5;
  if (side === 'offense') {
    // O-Line: 5 across, just behind LOS
    const oline: [number, number][] = [];
    for (let i = 0; i < 5; i++) {
      const t = (i + 0.5) / 5; // 0.1, 0.3, 0.5, 0.7, 0.9
      oline.push([0.05 + t * 0.9, yMid - 0.08 + (i % 2) * 0.04]);
    }
    // QB: 5 yards behind center
    const qb: [number, number] = [(los - 5) / 100, yMid];
    // WR: 2 split wide, slightly ahead
    const wr: [number, number][] = [
      [(los + 3) / 100, 0.15], // top wide receiver
      [(los + 3) / 100, 0.85], // bottom wide receiver
    ];
    return { qb, oline, wr, dline: [], cb: [] };
  } else {
    // Defense: D-Line on/near LOS, CBs deep and wide
    const dline: [number, number][] = [];
    for (let i = 0; i < 4; i++) {
      const t = (i + 0.5) / 4;
      dline.push([(los + 0.5) / 100, 0.25 + t * 0.5]);
    }
    const cb: [number, number][] = [
      [(los + 12) / 100, 0.1],
      [(los + 12) / 100, 0.9],
    ];
    return { qb: [0, 0], oline: [], wr: [], dline, cb };
  }
}

export default function Field({ playResult, ballYardline, isAnimating, onAnimationDone }: FieldProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    // Between plays: draw field + static lineups
    drawField(ctx, canvas, ballYardline);
    const off = buildLineup(ballYardline, 'offense');
    const def = buildLineup(ballYardline, 'defense');
    drawPlayerSet(ctx, off, canvas.width, canvas.height, '#e6edf3');
    drawPlayerSet(ctx, def, canvas.width, canvas.height, '#f85149');
  }, [ballYardline]);

  useEffect(() => {
    if (!playResult || !isAnimating) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const seed = playResult.seed ?? 1;
    const start = performance.now();
    const duration = 1800;

    const animate = (t: number) => {
      const elapsed = t - start;
      const progress = Math.min(1, elapsed / duration);
      // During animation: draw field WITHOUT lineups, then overlay animated lineups
      drawField(ctx, canvas, ballYardline);
      drawPlay(ctx, canvas, playResult, seed, progress);
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
  ctx.strokeStyle = '#fde047'; // bright yellow
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.moveTo(losX, 0);
  ctx.lineTo(losX, h);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = '#fde047';
  ctx.font = 'bold 11px monospace';
  ctx.fillText('LOS', losX + 4, 14);
  // First down marker (10 yards ahead)
  const fdX = ((ballYardline + 10) / 100) * w;
  if (fdX < w) {
    ctx.strokeStyle = '#fb923c';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(fdX, 0);
    ctx.lineTo(fdX, h);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#fb923c';
    ctx.fillText('1ST', fdX - 22, h - 6);
  }
  // Hash marks (top + bottom) — drawn here so they're visible during animation too
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
  // NOTE: lineups are drawn separately by the caller (either static via useEffect,
  // or animated overlays via drawPlay during animation).
}

function drawPlayerSet(ctx: CanvasRenderingContext2D, lineup: Lineup, w: number, h: number, color: string) {
  if (lineup.qb[0] > 0) drawPlayer(ctx, lineup.qb[0] * w, lineup.qb[1] * h, color, 6, 'Q');
  for (const [x, y] of lineup.oline) drawPlayer(ctx, x * w, y * h, color, 5, 'O');
  for (const [x, y] of lineup.wr) drawPlayer(ctx, x * w, y * h, color, 5, 'W');
  for (const [x, y] of lineup.dline) drawPlayer(ctx, x * w, y * h, color, 5, 'D');
  for (const [x, y] of lineup.cb) drawPlayer(ctx, x * w, y * h, color, 5, 'C');
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
  ctx.fillStyle = '#000';
  ctx.font = 'bold 8px monospace';
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
) {
  const w = canvas.width;
  const h = canvas.height;
  const off = buildLineup(result.yardline_before, 'offense');
  const def = buildLineup(result.yardline_before, 'defense');
  const playType = result.off_call?.parent as string;
  const sub = result.off_call?.sub as string;
  const yards = result.yards ?? 0;
  const turnover = result.turnover;

  // Animate offense advancing by yards
  drawAnimatedLineup(ctx, off, w, h, yards, progress, '#e6edf3', playType, sub);
  drawAnimatedLineup(ctx, def, w, h, 0, progress, '#f85149', playType, sub);

  // Ball animation
  const ballStartX = (result.yardline_before / 100) * w;
  const ballEndX = ((result.yardline_before + Math.max(0, yards)) / 100) * w;
  let ballX = ballStartX + (ballEndX - ballStartX) * progress;
  let ballY = h * 0.5;
  if (playType === 'pass') {
    // Arc trajectory
    ballY = h * 0.5 - Math.sin(progress * Math.PI) * (sub === 'deep' ? h * 0.4 : h * 0.15);
  } else if (playType === 'fg') {
    ballY = h * 0.5 - Math.sin(progress * Math.PI) * h * 0.45;
    ballX = ballStartX + (w * 0.9 - ballStartX) * progress;
  }
  ctx.fillStyle = '#92400e';
  ctx.beginPath();
  ctx.arc(ballX, ballY, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Receiver/WR catches ball at progress 1
  if (playType === 'pass' && progress > 0.6) {
    // Flash at receiver location
    const targetIdx = sub === 'deep' ? 0 : 0; // both WRs run same routes for simplicity
    const wr = off.wr[targetIdx];
    if (wr) {
      const rx = (wr[0] + (yards / 100)) * w;
      const ry = wr[1] * h;
      ctx.strokeStyle = '#fde047';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(rx, ry, 10 + (progress - 0.6) * 20, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // FG: ball near uprights at end
  if (playType === 'fg' && progress > 0.7) {
    // Draw uprights at right end zone
    ctx.strokeStyle = result.scoring_event === 'fg' ? '#3fb950' : '#f85149';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(w - 30, h * 0.3);
    ctx.lineTo(w - 30, h * 0.7);
    ctx.stroke();
  }

  // Turnover flash
  if (turnover && progress > 0.5) {
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
  w: number,
  h: number,
  yards: number,
  progress: number,
  color: string,
  playType: string,
  sub: string,
) {
  // Offense moves forward by yards (proportional to progress)
  // Defense mostly stays put; D-Line may surge on run plays
  const yardShift = (yards / 100) * w * progress;

  if (lineup.qb[0] > 0) {
    const x = lineup.qb[0] * w + yardShift;
    const y = lineup.qb[1] * h;
    drawPlayer(ctx, x, y, color, 6, 'Q');
  }
  for (const [nx, ny] of lineup.oline) {
    const x = nx * w + yardShift * 0.5; // O-line moves slower
    const y = ny * h;
    drawPlayer(ctx, x, y, color, 5, 'O');
  }
  for (const [nx, ny] of lineup.wr) {
    const x = nx * w + yardShift * (playType === 'pass' ? 1.2 : 0.6);
    const y = ny * h - (sub === 'deep' ? Math.sin(progress * Math.PI) * 30 : 0);
    drawPlayer(ctx, x, y, color, 5, 'W');
  }
  for (const [nx, ny] of lineup.dline) {
    const x = nx * w - (playType === 'run' ? yardShift * 0.3 * progress : 0);
    const y = ny * h;
    drawPlayer(ctx, x, y, color, 5, 'D');
  }
  for (const [nx, ny] of lineup.cb) {
    const x = nx * w - (playType === 'pass' ? yardShift * 0.2 * progress : 0);
    const y = ny * h;
    drawPlayer(ctx, x, y, color, 5, 'C');
  }
}