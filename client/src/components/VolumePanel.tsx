// VolumePanel — master mute button + popover with 3 channel sliders
// (Music / Crowd / SFX). Master is implicit (clicking the speaker toggles it).
// Sliders update the respective gain nodes in real time and persist to
// localStorage via setVolume().

import { useEffect, useRef, useState } from 'react';
import {
  getVolumes,
  initAudio,
  setVolume,
  type Volumes,
} from '../audio/synth.js';

export default function VolumePanel({ className = '' }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const [volumes, setVolumesState] = useState<Volumes>(() => getVolumes());
  const containerRef = useRef<HTMLDivElement>(null);
  const muted = volumes.master === 0;

  // Click-outside to close
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  function toggleMaster() {
    initAudio();
    const next = muted ? 0.7 : 0;
    setVolume('master', next);
    setVolumesState((v) => ({ ...v, master: next }));
  }

  function setChan(channel: 'crowd' | 'sfx', value: number) {
    // Touching a sub-channel also unlocks master (if it was muted)
    if (muted && value > 0) {
      setVolume('master', 0.7);
      setVolumesState((v) => ({ ...v, master: 0.7 }));
    }
    setVolume(channel, value);
    setVolumesState((v) => ({ ...v, [channel]: value }));
  }

  function openPanel() {
    initAudio();
    // Refresh from bus (in case something changed it externally)
    setVolumesState(getVolumes());
    setOpen((o) => !o);
  }

  return (
    <div ref={containerRef} className={`relative inline-block ${className}`}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          if (open) {
            // Toggle the speaker closes the panel without flipping master
            setOpen(false);
            return;
          }
          openPanel();
        }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          toggleMaster();
        }}
        aria-label={open ? 'Close audio panel' : 'Open audio panel'}
        aria-expanded={open}
        data-testid="volume-toggle"
        className="btn-flash btn-ghost !min-h-0 !py-1 !px-2 text-base"
        style={{ minHeight: '32px', padding: '4px 10px' }}
        title="Click to open audio panel · Double-click to mute"
      >
        {muted ? '🔇' : '🔊'}
      </button>

      {open && (
        <div
          className="panel-flash absolute right-0 mt-2 w-56 z-50 text-left space-y-2"
          style={{ padding: '12px' }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="panel-titlebar !mt-0" style={{ margin: '-12px -12px 8px -12px' }}>
            <span>Audio</span>
            <span className="text-xs">
              <button
                type="button"
                onClick={toggleMaster}
                className="underline hover:no-underline"
                title="Toggle master mute"
              >
                {muted ? 'Unmute' : 'Mute'}
              </button>
            </span>
          </div>

          <SliderRow
            label="👥 Crowd"
            value={volumes.crowd}
            onChange={(v) => setChan('crowd', v)}
            testId="vol-crowd"
          />
          <SliderRow
            label="💥 SFX"
            value={volumes.sfx}
            onChange={(v) => setChan('sfx', v)}
            testId="vol-sfx"
          />

          <div className="text-[10px] text-ink/50 text-center pt-1">
            Master: {muted ? 'muted' : `${Math.round(volumes.master * 100)}%`}
          </div>
        </div>
      )}
    </div>
  );
}

function SliderRow({
  label,
  value,
  onChange,
  testId,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  testId: string;
}) {
  return (
    <label className="block">
      <div className="flex items-center justify-between text-xs font-bold mb-0.5">
        <span>{label}</span>
        <span className="text-ink/60">{Math.round(value * 100)}</span>
      </div>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        data-testid={testId}
        className="w-full accent-sun"
        style={{ accentColor: '#ffd400' }}
      />
    </label>
  );
}