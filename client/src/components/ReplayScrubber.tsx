// ReplayScrubber — frame-step control below the field.
//
// Lets the user pause and step through the play frame-by-frame after the
// animation completes. Reuses computeFrame's determinism (same playResult +
// same progress = same frame) so we don't need to store frames.
//
// Keyboard shortcuts (when the scrubber is focused):
//   Space : play/pause
//   ←/→  : step one frame back/forward
//   Home/End : jump to start/end
//
// Speed selector: 0.25x, 0.5x, 1x, 2x.

import { useEffect, useState, useRef } from 'react';

interface ReplayScrubberProps {
  /** Play result to scrub. If null, the scrubber is hidden. */
  playResult: any | null;
  /** Whether the canvas is currently animating. Scrubber is hidden during live anim. */
  isAnimating: boolean;
  /** Current scrub progress (0..1). null = not scrubbing. */
  scrubProgress: number | null;
  setScrubProgress: (p: number | null) => void;
}

const SPEEDS = [0.25, 0.5, 1, 2];
const FRAME_STEP = 1 / 60; // one "frame" = 1/60 of total progress

export default function ReplayScrubber({
  playResult,
  isAnimating,
  scrubProgress,
  setScrubProgress,
}: ReplayScrubberProps) {
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const lastTickRef = useRef<number>(performance.now());
  const reqRef = useRef<number | null>(null);

  // Auto-play loop: advance scrubProgress at `speed` rate
  useEffect(() => {
    if (!playing || scrubProgress == null) {
      if (reqRef.current != null) cancelAnimationFrame(reqRef.current);
      reqRef.current = null;
      return;
    }
    lastTickRef.current = performance.now();
    const tick = () => {
      const now = performance.now();
      const dt = (now - lastTickRef.current) / 1000;
      lastTickRef.current = now;
      // Animation total duration is 2400ms (matches Field.tsx).
      // Advance scrubProgress by (dt / 2.4) * speed
      const next = (scrubProgress ?? 0) + (dt / 2.4) * speed;
      if (next >= 1) {
        setScrubProgress(1);
        setPlaying(false);
      } else {
        setScrubProgress(next);
        reqRef.current = requestAnimationFrame(tick);
      }
    };
    reqRef.current = requestAnimationFrame(tick);
    return () => {
      if (reqRef.current != null) cancelAnimationFrame(reqRef.current);
    };
  }, [playing, scrubProgress, speed, setScrubProgress]);

  // Keyboard shortcuts
  useEffect(() => {
    if (scrubProgress == null) return;
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        setPlaying((p) => !p);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setPlaying(false);
        setScrubProgress(Math.max(0, (scrubProgress ?? 0) - FRAME_STEP));
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        setPlaying(false);
        setScrubProgress(Math.min(1, (scrubProgress ?? 0) + FRAME_STEP));
      } else if (e.key === 'Home') {
        e.preventDefault();
        setPlaying(false);
        setScrubProgress(0);
      } else if (e.key === 'End') {
        e.preventDefault();
        setPlaying(false);
        setScrubProgress(1);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [scrubProgress, setScrubProgress]);

  // Hide during live animation OR when no play result
  if (!playResult || isAnimating) return null;

  const isScrubbing = scrubProgress != null;
  const pct = Math.round((scrubProgress ?? 0) * 100);

  function toggleScrub() {
    if (isScrubbing) {
      setScrubProgress(null);
      setPlaying(false);
    } else {
      setScrubProgress(0);
      setPlaying(true);
    }
  }

  return (
    <div
      className="panel-flash flex flex-wrap items-center gap-2 !py-2 text-sm"
      data-testid="replay-scrubber"
    >
      <span className="chip !bg-cream !text-ink text-xs">REPLAY</span>

      <button
        type="button"
        onClick={toggleScrub}
        className="btn-flash btn-cool !min-h-0 !py-1 !px-3 text-sm"
        data-testid="replay-toggle"
      >
        {isScrubbing ? '✕ Exit' : '↻ Scrub'}
      </button>

      {isScrubbing && (
        <>
          <button
            type="button"
            onClick={() => { setPlaying((p) => !p); }}
            className="btn-flash btn-go !min-h-0 !py-1 !px-3 text-sm"
            aria-label={playing ? 'Pause' : 'Play'}
            data-testid="replay-play"
          >
            {playing ? '⏸' : '▶'}
          </button>

          <input
            type="range"
            min={0}
            max={1000}
            value={Math.round((scrubProgress ?? 0) * 1000)}
            onChange={(e) => {
              setPlaying(false);
              setScrubProgress(Number(e.target.value) / 1000);
            }}
            className="flex-1 min-w-[120px]"
            aria-label="Scrub progress"
            data-testid="replay-scrub"
          />

          <span className="font-black tabular-nums text-xs" data-testid="replay-pct">
            {pct}%
          </span>

          <div className="flex items-center gap-1">
            <span className="text-xs font-bold text-ink/60">SPEED</span>
            {SPEEDS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSpeed(s)}
                className={`!min-h-0 !py-1 !px-2 text-xs font-black border-2 border-ink ${
                  speed === s ? 'bg-lime text-ink' : 'bg-cream text-ink/70'
                }`}
                style={{ boxShadow: '2px 2px 0 0 #0a0a18' }}
              >
                {s}x
              </button>
            ))}
          </div>

          <span className="text-xs text-ink/50 ml-auto hidden md:inline">
            ⌨ Space ←/→ Home/End
          </span>
        </>
      )}
    </div>
  );
}