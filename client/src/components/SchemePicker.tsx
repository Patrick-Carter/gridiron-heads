import { useState } from 'react';
import type { PlayParent, PlaySub } from '@gridiron/shared';

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
    setParent(p);
    setSub(SUB_OPTIONS[p][0] ?? ('inside' as PlaySub));
  }

  return (
    <div className="bg-panel border border-border rounded p-4 space-y-3">
      <h3 className="font-bold text-accent">Pick Your Play</h3>
      <div className="grid grid-cols-4 gap-2">
        {(['run', 'pass', 'punt', 'fg'] as PlayParent[]).map((p) => (
          <button
            key={p}
            disabled={disabled}
            onClick={() => selectParent(p)}
            className={`py-2 rounded font-bold ${
              parent === p
                ? 'bg-accent text-bg'
                : 'bg-bg border border-border text-fg hover:border-accent'
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
              onClick={() => setSub(s)}
              className={`py-2 rounded ${
                sub === s
                  ? 'bg-accent text-bg font-bold'
                  : 'bg-bg border border-border text-fg hover:border-accent'
              } ${disabled ? 'opacity-50' : ''}`}
            >
              {s.toUpperCase()}
            </button>
          ))}
        </div>
      )}
      <button
        disabled={disabled}
        onClick={() => onPick(parent, sub)}
        className="w-full bg-ok text-bg font-bold py-3 rounded hover:opacity-90 disabled:opacity-50"
      >
        Lock In
      </button>
    </div>
  );
}