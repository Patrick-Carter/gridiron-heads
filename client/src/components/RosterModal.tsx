import { useEffect } from 'react';
import type { TeamState, PositionGroup } from '@gridiron/shared';
import { modifierDescription } from '@gridiron/shared';

// Position group order + human-readable labels (matches Draft screen).
const GROUPS: Array<{ key: PositionGroup; label: string; emoji: string }> = [
  { key: 'QB',         label: 'Quartback', emoji: '🏈' },
  { key: 'D_LINE',     label: 'D-Line',    emoji: '🛡️' },
  { key: 'O_LINE',     label: 'O-Line',    emoji: '🏗️' },
  { key: 'OFF_SKILL',  label: 'Off Skill', emoji: '⚡' },
  { key: 'DEF_SKILL',  label: 'Def Skill', emoji: '🔒' },
  { key: 'KICKER',     label: 'Kicker',    emoji: '🦵' },
];

/**
 * RosterModal — overlay that shows all 6 position groups for one team.
 * Caller passes their `myIdx` so we can highlight the active team's side-
 * bar (lime) vs the opponent's (maroon).
 *
 * Dismiss: ESC key, click backdrop, or X button. Clicking switches teams
 * when the other player is clicked; clicking the same one re-focuses.
 */
export default function RosterModal({
  open,
  team,
  teamName,
  ownerLabel,
  myIdx,
  focusIdx,
  onClose,
  onSwitch,
}: {
  open: boolean;
  team: TeamState | null;
  teamName: string;
  ownerLabel: 'YOU' | 'OPP';
  myIdx: 0 | 1;
  focusIdx: 0 | 1;
  onClose: () => void;
  onSwitch: (idx: 0 | 1) => void;
}) {
  // Escape to close
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Lock body scroll while open
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  if (!open || !team) return null;

  const filledCount = (Object.keys(team) as Array<keyof TeamState>).filter(
    (k) => team[k] != null,
  ).length;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${teamName} roster`}
      data-testid={`roster-modal-${focusIdx}`}
      className="fixed inset-0 z-50 flex items-end md:items-center justify-center p-2 md:p-4"
      style={{ background: 'rgba(10, 10, 24, 0.78)' }}
      onClick={(e) => {
        // Click on backdrop closes; click inside the panel does not (handled
        // by stopPropagation on the panel below).
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="panel-flash max-w-lg w-full max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
        style={myIdx === focusIdx ? { borderColor: '#c8ff00' } : { borderColor: '#c8102e' }}
      >
        <div
          className="panel-titlebar !mt-0"
          style={myIdx === focusIdx ? { background: '#c8ff00', color: '#0a0a18' } : undefined}
        >
          <span>{teamName}'s roster</span>
          <span className="text-xs">{filledCount}/6 · {ownerLabel}</span>
        </div>

        <div className="space-y-3 pt-1">
          {GROUPS.map(({ key, label, emoji }) => {
            // Map group key → TeamState property
            const opt = (team as any)[key.toLowerCase() as keyof TeamState] as any;
            return (
              <div
                key={key}
                className="border-3 p-2 flex items-start gap-3"
                style={{
                  borderWidth: 3,
                  borderColor: '#0a0a18',
                  background: opt ? '#fff8dc' : 'rgba(0,0,0,0.04)',
                }}
              >
                <span
                  aria-hidden
                  className="text-2xl leading-none mt-1"
                  style={{ minWidth: '2rem', textAlign: 'center' }}
                >
                  {emoji}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="chip text-xs">{label}</span>
                    {!opt && (
                      <span className="text-xs font-bold text-ink/40">— empty —</span>
                    )}
                  </div>
                  {opt && (
                    <div className="mt-1">
                      <div className="font-bold text-ink text-base leading-tight">
                        {opt.name}
                      </div>
                      {opt.skill != null && (
                        <div className="text-xs text-ink/70 font-bold">
                          ⚡ skill {opt.skill}
                          {(key === 'O_LINE' || key === 'D_LINE') && (
                            <span className="ml-1 text-maroon">
                              · trench gap ≥ {(key === 'O_LINE' ? 20 : 20)} = line rolls
                            </span>
                          )}
                        </div>
                      )}
                      {opt.modifier && (
                        <div className="text-xs text-maroon mt-0.5">
                          ✦ {modifierDescription(opt.modifier)}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer: switch teams + close */}
        <div className="mt-4 flex flex-col sm:flex-row gap-2">
          <button
            onClick={() => onSwitch(focusIdx === 0 ? 1 : 0)}
            className="btn-flash btn-cool flex-1"
          >
            ⇄ {focusIdx === 0 ? 'See OPP' : 'See YOU'}
          </button>
          <button
            onClick={onClose}
            className="btn-flash btn-danger flex-1"
            aria-label="Close roster"
          >
            ✕ Close (Esc)
          </button>
        </div>
      </div>
    </div>
  );
}
