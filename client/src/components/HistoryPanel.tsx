// HistoryPanel — scrollable list of recent plays.
//
// Extracted from the old unified ResultsPanel. Now lives in its own
// full-width row below the 2-col section (play call | results+rolls) on
// desktop, and below the play-call + results stack on mobile.
//
// Test IDs (kept stable where they made sense):
//   - `history-panel`  — outer wrapper
//   - `history-list`   — inner scroll container
//   - `history-empty`  — empty state placeholder
//   - `last-play`      — most recent history row (the "▶ LAST PLAY" entry)

import type { PlayResult } from '@gridiron/shared';
import { ballSpotAt } from '@gridiron/shared';

interface HistoryPanelProps {
  /** The currently-animating / most recent play. Filtered out of the list so
   *  it isn't duplicated between the results card and the top history row. */
  playResult: PlayResult | null;
  /** Full game history from the server. Newest entries are at the end. */
  history: PlayResult[];
  /** How many prior plays to show in the scrollable list (default 5). */
  historyCap?: number;
}

function downLabel(d: number): string {
  return d === 1 ? '1st' : d === 2 ? '2nd' : d === 3 ? '3rd' : '4th';
}

function spotForPlay(p: PlayResult): string {
  const spot = ballSpotAt(p.yardline_before, p.offense_direction);
  if (spot.label === null) return 'at 50';
  return `${spot.label.toLowerCase()} ${spot.yards}`;
}

function HistoryRow({ p, isLast }: { p: PlayResult; isLast: boolean }) {
  const yards = p.yards;
  const yardsColor =
    yards > 0 ? 'text-ok' : yards < 0 ? 'text-maroon' : 'text-ink/70';
  const yardsStr =
    yards > 0 ? `+${yards}` : yards < 0 ? `${yards}` : '0';
  return (
    <li
      data-testid={isLast ? 'last-play' : undefined}
      className={`border-4 p-2 space-y-1 text-center transition-all ${
        isLast ? 'bg-lime' : 'bg-cream'
      }`}
      style={{
        borderColor: '#0a0a18',
        boxShadow: isLast ? '3px 3px 0 0 #c8ff00' : '3px 3px 0 0 #0a0a18',
      }}
    >
      <div className="panel-titlebar !mt-0" style={{ padding: '2px 6px' }}>
        <span className="text-[11px]">
          {isLast ? '▶ LAST PLAY' : 'PLAY'}
        </span>
        <span className="text-[10px]">
          {downLabel(p.down)} & {p.distance} · {spotForPlay(p)}
        </span>
      </div>

      <div className="flex items-center justify-center gap-2 text-sm flex-wrap">
        <span className="chip !bg-lime !text-ink">
          OFF: {p.off_call?.parent?.toUpperCase()} {p.off_call?.sub?.toUpperCase()}
        </span>
        <span className="text-ink/60 font-black">vs</span>
        <span className="chip !bg-maroon !text-cream">
          DEF: {p.def_call?.parent?.toUpperCase()} {p.def_call?.sub?.toUpperCase()}
        </span>
      </div>

      {(p.off_audible || p.off_fake_audible) && (
        <div className="text-[11px] font-bold text-maroon">
          🗣 {p.off_fake_audible ? 'FAKE' : 'AUDIBLE →'}{' '}
          {p.off_audible?.sub?.toUpperCase?.() || ''}
        </div>
      )}

      <div
        className={`text-xs font-bold flex items-center justify-center gap-2 flex-wrap ${
          isLast ? 'text-ink' : 'text-ink/85'
        }`}
      >
        <span className="sticker">PLAY!</span>
        <span className="italic text-left flex-1 min-w-0">{p.text_recap}</span>
        <span className={`chip ${yardsColor}`}>{yardsStr} yds</span>
        {p.scoring_event === 'td' && (
          <span className="chip !bg-lime !text-ink">TD!</span>
        )}
        {p.scoring_event === 'fg' && (
          <span className="chip !bg-lime !text-ink">FG!</span>
        )}
        {p.scoring_event === 'safety' && (
          <span className="chip !bg-warn">SAFETY</span>
        )}
        {p.turnover && !p.scoring_event && (
          <span className="chip !bg-maroon !text-cream">TO</span>
        )}
      </div>
    </li>
  );
}

export default function HistoryPanel({
  playResult,
  history = [],
  historyCap = 5,
}: HistoryPanelProps) {
  // History: exclude the currently animating playResult (it's already shown
  // in the live ResultsPanel above). Then take the last (historyCap - 1)
  // entries. Reverse so newest is first.
  const currentSeed = playResult?.seed ?? null;
  const priorHistory = currentSeed != null
    ? history.filter((h) => h.seed !== currentSeed)
    : history;
  const recent = priorHistory.slice(-(historyCap - 1)).reverse();

  return (
    <div className="panel-flash" data-testid="history-panel">
      <div className="panel-titlebar !mt-0">
        <span>History</span>
        <span className="text-xs">Last {historyCap}</span>
      </div>
      <div
        className="max-h-[320px] overflow-y-auto pr-1"
        data-testid="history-list"
      >
        {recent.length === 0 ? (
          <div
            className="text-ink/50 text-sm text-center italic"
            data-testid="history-empty"
          >
            No prior plays yet.
          </div>
        ) : (
          <ul className="space-y-2">
            {recent.map((p, i) => (
              <HistoryRow key={`${p.seed}-${i}`} p={p} isLast={i === 0} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
