import { useState } from 'react';
import type { Play, PlaySub } from '@gridiron/shared';
import { flipSubtype } from '@gridiron/shared';

export default function AudiblePanel({
  role,
  currentPlay,
  audiblesUsed,
  fakeAudiblesUsed,
  onAudible,
  onFakeAudible,
  onDefAudible,
  onDefStay,
  phase,
}: {
  role: 'offense' | 'defense';
  currentPlay?: Play;
  audiblesUsed?: number;
  fakeAudiblesUsed?: number;
  onAudible?: (sub: PlaySub) => void;
  onFakeAudible?: () => void;
  onDefAudible?: (sub: PlaySub) => void;
  onDefStay?: () => void;
  phase: string;
}) {
  const [showPicker, setShowPicker] = useState(false);

  if (role === 'offense' && phase === 'ready_to_snap') {
    const realLeft = (audiblesUsed ?? 0) === 0;
    const fakeLeft = (fakeAudiblesUsed ?? 0) === 0;
    return (
      <div className="panel-flash space-y-2">
        <div className="panel-titlebar !mt-0">
          <span>Audibles (offense)</span>
          <span className="text-xs">Tactical!</span>
        </div>
        {!showPicker && (
          <div className="grid grid-cols-2 gap-2">
            <button
              disabled={!realLeft}
              onClick={() => setShowPicker(true)}
              className={`btn-flash ${realLeft ? 'btn-danger' : '!bg-cream/40 !text-ink/40'}`}
            >
              🗣 Audible{!realLeft && ' (used)'}
            </button>
            <button
              disabled={!fakeLeft}
              onClick={onFakeAudible}
              className={`btn-flash ${fakeLeft ? 'btn-cool' : '!bg-cream/40 !text-ink/40'}`}
            >
              🎭 Fake{!fakeLeft && ' (used)'}
            </button>
          </div>
        )}
        {showPicker && currentPlay && (
          <AudibleSubPicker
            currentSub={currentPlay.sub}
            onPick={(s) => {
              setShowPicker(false);
              onAudible?.(s);
            }}
          />
        )}
      </div>
    );
  }

  if (role === 'defense' && phase === 'awaiting_def_response') {
    return (
      <div className="panel-flash space-y-3">
        <div className="panel-titlebar !mt-0">
          <span>Offense audibled!</span>
          <span className="text-xs">React!</span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={onDefStay}
            className="btn-flash btn-ghost"
          >
            🛡 Stay
          </button>
          {currentPlay && (
            <AudibleSubPicker
              currentSub={currentPlay.sub}
              onPick={(s) => onDefAudible?.(s)}
              label="Respond"
            />
          )}
        </div>
      </div>
    );
  }

  return null;
}

function AudibleSubPicker({
  currentSub,
  onPick,
  label = 'Pick',
}: {
  currentSub: PlaySub;
  onPick: (s: PlaySub) => void;
  label?: string;
}) {
  const flipped = flipSubtype({ parent: 'pass', sub: currentSub }).sub;
  return (
    <button
      onClick={() => onPick(flipped)}
      className="btn-flash btn-danger w-full"
    >
      ↻ {label}: → {flipped.toUpperCase()}
    </button>
  );
}
