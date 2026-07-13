import { useEffect, useState } from 'react';
import { initAudio } from '../audio/synth.js';

export default function ConcedeControl({ onConcede }: { onConcede: () => void }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  return (
    <>
      <button
        type="button"
        className="btn-flash btn-grape w-full"
        onClick={() => { initAudio(); setOpen(true); }}
      >
        Concede Game
      </button>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-ink/70 p-3"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="concede-title"
            className="panel-flash w-full max-w-md text-center space-y-4"
          >
            <div className="panel-titlebar !mt-0">
              <span id="concede-title">Concede this game?</span>
              <span className="text-xs">Final decision</span>
            </div>
            <p className="text-sm font-bold">
              Your opponent will win immediately. This cannot be undone.
            </p>
            <div className="flex flex-col sm:flex-row gap-2">
              <button type="button" className="btn-flash btn-primary flex-1" onClick={() => setOpen(false)}>
                Keep Playing
              </button>
              <button
                type="button"
                className="btn-flash btn-grape flex-1"
                onClick={() => { setOpen(false); onConcede(); }}
              >
                Yes, Concede
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
