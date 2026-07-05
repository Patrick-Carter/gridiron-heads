import { useState } from 'react';
import type { PlayParent, PlaySub } from '@gridiron/shared';
import { initAudio, playSchemeSelect } from '../audio/synth.js';

const SUB_OPTIONS: Record<PlayParent, PlaySub[]> = {
  run: ['inside', 'outside'],
  pass: ['deep', 'short'],
  punt: [],
  fg: [],
};

export default function SchemePicker({
  onPick,
  disabled,
}: {
  onPick: (parent: PlayParent, sub: PlaySub) => void;
  disabled?: boolean;
}) {
  const [parent, setParent] = useState<PlayParent>('run');
  const [sub, setSub] = useState<PlaySub>('inside');

  const subs = SUB_OPTIONS[parent];
  const needsSub = subs.length > 0;

  function selectParent(p: PlayParent) {
    initAudio();
    playSchemeSelect();
    setParent(p);
    setSub(SUB_OPTIONS[p][0] ?? ('inside' as PlaySub));
  }

  function selectSub(s: PlaySub) {
    initAudio();
    playSchemeSelect();
    setSub(s);
  }

  return (
    <div className="panel-flash space-y-3">
      <div className="grid grid-cols-4 gap-2">
        {(['run', 'pass', 'punt', 'fg'] as PlayParent[]).map((p) => (
          <button
            key={p}
            disabled={disabled}
            onClick={() => selectParent(p)}
            className={`btn-flash !min-h-0 py-2 text-sm ${
              parent === p
                ? p === 'fg' || p === 'punt' ? 'btn-danger' : 'btn-primary'
                : 'btn-ghost'
            } ${disabled ? 'opacity-50' : ''}`}
          >
            {p.toUpperCase()}
          </button>
        ))}
      </div>

      {needsSub && (
        <div className="grid grid-cols-2 gap-2">
          {subs.map((s) => (
            <button
              key={s}
              disabled={disabled}
              onClick={() => selectSub(s)}
              className={`btn-flash !min-h-0 py-2 text-sm ${
                sub === s ? 'btn-cool' : 'btn-ghost'
              } ${disabled ? 'opacity-50' : ''}`}
            >
              {s.toUpperCase()}
            </button>
          ))}
        </div>
      )}

      <button
        disabled={disabled}
        onClick={() => { initAudio(); onPick(parent, sub); }}
        className="btn-flash btn-xtra btn-go w-full"
      >
        🔒 Lock In!
      </button>
    </div>
  );
}
