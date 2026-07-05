import { useState } from 'react';
import { EVENTS } from '../api/socket.js';
import type { Play, PlaySub, SUB_OPTIONS_BY_PARENT } from '@gridiron/shared';
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
      <div className="bg-panel border border-border rounded p-4 space-y-2">
        <h3 className="font-bold text-accent">Audibles (offense)</h3>
        {!showPicker && (
          <div className="grid grid-cols-2 gap-2">
            <button
              disabled={!realLeft}
              onClick={() => setShowPicker(true)}
              className="bg-warn text-bg font-bold py-2 rounded disabled:opacity-30"
            >
              Audible{!realLeft && ' (used)'}
            </button>
            <button
              disabled={!fakeLeft}
              onClick={onFakeAudible}
              className="bg-bg border border-warn text-warn font-bold py-2 rounded disabled:opacity-30"
            >
              Fake Audible{!fakeLeft && ' (used)'}
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
      <div className="bg-panel border border-border rounded p-4 space-y-2">
        <h3 className="font-bold text-accent">Offense audibled — respond?</h3>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={onDefStay}
            className="bg-bg border border-border text-fg font-bold py-2 rounded hover:border-accent"
          >
            Stay
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
      className="bg-warn text-bg font-bold py-2 rounded hover:opacity-90"
    >
      {label}: flip to {flipped.toUpperCase()}
    </button>
  );
}