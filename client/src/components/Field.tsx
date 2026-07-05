import { useEffect, useRef } from 'react';
import { mulberry32 } from '@gridiron/shared';

interface FieldProps {
  playResult: any | null;
  ballYardline: number;
  possessionIdx: number;
  isAnimating: boolean;
  onAnimationDone?: () => void;
}

export default function Field({ playResult, ballYardline, isAnimating, onAnimationDone }: FieldProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    drawField(ctx, canvas, ballYardline);
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
      width={800}
      height={400}
      className="w-full bg-emerald-900 rounded border border-border"
    />
  );
}

function drawField(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, ballYardline: number) {
  const w = canvas.width;
  const h = canvas.height;
  // Background field
  ctx.fillStyle = '#0a3d1f';
  ctx.fillRect(0, 0, w, h);
  // Yard lines every 10 yards (10 lines, 0-100)
  ctx.strokeStyle = 'rgba(255,255,255,0.3)';
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
  // Ball marker
  const ballX = (ballYardline / 100) * w;
  ctx.fillStyle = '#f85149';
  ctx.beginPath();
  ctx.arc(ballX, h / 2, 8, 0, Math.PI * 2);
  ctx.fill();
  // Yardline number
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.font = '10px monospace';
  ctx.fillText(`${ballYardline}`, ballX - 6, h - 6);
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
  const rng = mulberry32(seed);

  // 11 offense (white), 11 defense (red)
  const offColor = '#e6edf3';
  const defColor = '#f85149';

  const playType = result.off_call?.parent;
  const sub = result.off_call?.sub;

  // Generate initial positions
  const offYards = result.yards ?? 0;
  const lineOfScrimmage = (result.yardline_before / 100) * w;
  const targetX = ((result.yardline_before + Math.max(0, offYards)) / 100) * w;

  for (let i = 0; i < 11; i++) {
    const startX = lineOfScrimmage - 30 + (i % 5) * 12;
    const startY = 60 + i * 28;
    let endX = startX + offYards * (w / 100);
    if (playType === 'pass' && sub === 'deep' && i === 5) endX = targetX; // receiver
    if (playType === 'run' && i === 4) endX = lineOfScrimmage + offYards * (w / 100); // RB

    const x = startX + (endX - startX) * progress;
    const y = startY + Math.sin(progress * Math.PI) * (sub === 'deep' ? -30 : 10);
    ctx.fillStyle = offColor;
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  for (let i = 0; i < 11; i++) {
    const startX = lineOfScrimmage + 10 + (i % 5) * 12;
    const startY = 50 + i * 28;
    const convergeX = lineOfScrimmage + offYards * (w / 100);
    const x = startX + (convergeX - startX) * progress * 0.6;
    const y = startY;
    ctx.fillStyle = defColor;
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  // Ball trajectory line for pass
  if (playType === 'pass' && result.parent_match === false) {
    ctx.strokeStyle = 'rgba(210,153,34,0.7)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    const fromX = lineOfScrimmage;
    const fromY = h / 2;
    const toX = targetX;
    const toY = sub === 'deep' ? 60 : h / 2;
    const cpX = (fromX + toX) / 2;
    const cpY = Math.min(fromY, toY) - 60;
    ctx.moveTo(fromX + (toX - fromX) * progress, fromY + (toY - fromY) * progress * progress);
    ctx.lineTo(fromX + (toX - fromX) * (progress + 0.01), fromY + (toY - fromY) * (progress + 0.01) * (progress + 0.01));
    ctx.stroke();
  }

  // Turnover flash
  if (result.turnover && progress > 0.5) {
    ctx.fillStyle = `rgba(248,81,73,${(progress - 0.5) * 2})`;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 36px monospace';
    ctx.fillText('TURNOVER!', w / 2 - 100, h / 2);
  }

  // TD banner
  if (result.scoring_event === 'td' && progress > 0.7) {
    ctx.fillStyle = `rgba(63,185,80,${(progress - 0.7) * 3})`;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 36px monospace';
    ctx.fillText('TOUCHDOWN!', w / 2 - 110, h / 2);
  }
}