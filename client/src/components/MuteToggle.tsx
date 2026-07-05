// MuteToggle — small 🔊/🔇 button placed in the score panel.
// Persists mute state in localStorage so it survives reloads.

import { useEffect, useState } from 'react';
import { isMuted, setMuted, initAudio } from '../audio/synth.js';

const LS_KEY = 'gridiron:audio_muted';

export default function MuteToggle({ className = '' }: { className?: string }) {
  const [muted, setMutedLocal] = useState<boolean>(() => {
    try {
      return localStorage.getItem(LS_KEY) === '1';
    } catch {
      return false;
    }
  });

  // Sync to synth + persist
  useEffect(() => {
    setMuted(muted);
    try {
      localStorage.setItem(LS_KEY, muted ? '1' : '0');
    } catch {}
  }, [muted]);

  function handleClick() {
    initAudio(); // unlock on first interaction
    const next = !muted;
    setMutedLocal(next);
    // Play a soft "click" feedback when unmuting so the user knows it's on
    if (!next) {
      try {
        // tiny chirp
        const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
        if (!AC) return;
        const c = isMuted() ? null : new AC();
        if (!c) return;
        const osc = c.createOscillator();
        const g = c.createGain();
        osc.type = 'sine';
        osc.frequency.value = 660;
        const now = c.currentTime;
        g.gain.setValueAtTime(0, now);
        g.gain.linearRampToValueAtTime(0.18, now + 0.01);
        g.gain.linearRampToValueAtTime(0.0001, now + 0.12);
        osc.connect(g);
        g.connect(c.destination);
        osc.start(now);
        osc.stop(now + 0.15);
        c.close?.();
      } catch {}
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={muted ? 'Unmute audio' : 'Mute audio'}
      data-testid="mute-toggle"
      className={`btn-flash btn-ghost !min-h-0 !py-1 !px-2 text-base ${className}`}
      style={{ minHeight: '32px', padding: '4px 10px' }}
      title={muted ? 'Audio muted — click to unmute' : 'Audio on — click to mute'}
    >
      {muted ? '🔇' : '🔊'}
    </button>
  );
}