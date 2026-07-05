// TdConfetti — CSS-only confetti rain overlay for TD / FG / safety moments.
// Pure Tailwind + keyframes; no canvas, no animation libraries. Self-contained
// absolute-positioned overlay with N colored squares that fall from the top
// of the field area to the bottom. Auto-dismisses after a few seconds.

import { useEffect, useState } from 'react';

interface TdConfettiProps {
  /** Pass a key that increments on each scoring event so the effect re-runs. */
  triggerKey: number;
  /** Number of confetti squares to drop. */
  count?: number;
  /** Auto-dismiss duration in ms. */
  durationMs?: number;
}

const COLORS = ['#ffd400', '#c8ff00', '#00bfff', '#c8102e', '#fff8dc', '#ff8b00', '#7e3fb1'];

export default function TdConfetti({ triggerKey, count = 60, durationMs = 3000 }: TdConfettiProps) {
  const [active, setActive] = useState(false);
  const [seed, setSeed] = useState(0);

  useEffect(() => {
    if (triggerKey === 0) return;
    setActive(true);
    setSeed((s) => s + 1);
    const t = setTimeout(() => setActive(false), durationMs);
    return () => clearTimeout(t);
  }, [triggerKey, durationMs]);

  if (!active) return null;

  // Generate confetti pieces deterministically from the seed
  const pieces = [];
  let h = seed * 2654435761 >>> 0;
  for (let i = 0; i < count; i++) {
    h = (h + 0x6d2b79f5) >>> 0;
    const x = (h % 1000) / 10; // 0-100%
    h = (h + 0x6d2b79f5) >>> 0;
    const delay = (h % 800) / 100; // 0-8s
    h = (h + 0x6d2b79f5) >>> 0;
    const dur = 1.5 + (h % 1500) / 1000; // 1.5-3s
    h = (h + 0x6d2b79f5) >>> 0;
    const color = COLORS[h % COLORS.length];
    h = (h + 0x6d2b79f5) >>> 0;
    const size = 6 + (h % 8); // 6-13px
    h = (h + 0x6d2b79f5) >>> 0;
    const rotate = (h % 360);
    pieces.push({ x, delay, dur, color, size, rotate, key: i });
  }

  return (
    <div
      className="pointer-events-none fixed inset-0 z-30 overflow-hidden"
      aria-hidden="true"
      data-testid="td-confetti"
    >
      {pieces.map((p) => (
        <div
          key={p.key}
          style={{
            position: 'absolute',
            left: `${p.x}%`,
            top: '-20px',
            width: `${p.size}px`,
            height: `${p.size}px`,
            backgroundColor: p.color,
            border: '2px solid #0a0a18',
            transform: `rotate(${p.rotate}deg)`,
            animation: `tdConfettiFall ${p.dur}s ${p.delay}s ease-in forwards`,
          }}
        />
      ))}
      <style>{`
        @keyframes tdConfettiFall {
          0%   { transform: translateY(0)        rotate(0deg);   opacity: 1; }
          85%  { opacity: 1; }
          100% { transform: translateY(110vh)    rotate(720deg); opacity: 0; }
        }
      `}</style>
    </div>
  );
}