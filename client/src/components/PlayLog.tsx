import type { PlayResult } from '@gridiron/shared';

function yardsFromOwnForPlay(p: PlayResult): number {
  const dir = p.offense_direction;
  return dir === 1 ? p.yardline_before : 100 - p.yardline_before;
}

function downLabel(d: number): string {
  return d === 1 ? '1st' : d === 2 ? '2nd' : d === 3 ? '3rd' : '4th';
}

export default function PlayLog({
  history,
  maxEntries = 5,
}: {
  history: PlayResult[];
  maxEntries?: number;
}) {
  const recent = history.slice(-maxEntries).reverse();
  const total = recent.length;
  return (
    <div className="panel-flash space-y-2">
      <div className="panel-titlebar !mt-0">
        <span>Recent Plays</span>
        <span className="text-xs">Last {maxEntries}</span>
      </div>
      {recent.length === 0 ? (
        <div className="text-ink/50 text-sm text-center italic">No plays yet — make some noise!</div>
      ) : (
        <ul className="space-y-2">
          {recent.map((p, i) => {
            const isLast = i === 0;
            const playNum = total - i; // 1 = newest, total = oldest in window
            const yards = p.yards;
            const yardsColor =
              yards > 0 ? 'text-ok' : yards < 0 ? 'text-maroon' : 'text-ink/70';
            const yardsStr =
              yards > 0 ? `+${yards}` : yards < 0 ? `${yards}` : '0';
            return (
              <li
                key={i}
                data-testid={isLast ? 'last-play' : `play-${playNum}`}
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
                    {isLast ? '▶ LAST PLAY' : `Play #${playNum}`}
                  </span>
                  <span className="text-[10px]">
                    {downLabel(p.down)} & {p.distance} · own {yardsFromOwnForPlay(p)}
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
          })}
        </ul>
      )}
    </div>
  );
}