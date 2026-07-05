export default function PlayLog({
  history,
  myIdx,
  maxEntries = 5,
}: {
  history: any[];
  myIdx: 0 | 1;
  maxEntries?: number;
}) {
  const recent = history.slice(-maxEntries).reverse();
  return (
    <div className="bg-panel border border-border rounded p-4 space-y-2">
      <h3 className="font-bold text-accent">Recent Plays</h3>
      {recent.length === 0 ? (
        <div className="text-fg/40 text-sm">No plays yet.</div>
      ) : (
        <ul className="space-y-1 text-sm">
          {recent.map((p, i) => (
            <li key={i} className="border-b border-border pb-1 last:border-0">
              <div className="text-fg/60 text-xs">
                {p.down === 1 ? '1st' : p.down === 2 ? '2nd' : p.down === 3 ? '3rd' : '4th'} & {p.distance} @ {p.yardline_before}
              </div>
              <div className="text-fg">
                {p.off_call?.parent} {p.off_call?.sub}
                {p.off_audible && <span className="text-warn"> (AUD → {p.off_audible.sub})</span>}
                {p.off_fake_audible && <span className="text-err"> (FAKE)</span>}
                {' → '}
                <span className={p.yards > 0 ? 'text-ok' : p.yards < 0 ? 'text-err' : 'text-fg/60'}>
                  {p.yards > 0 ? `+${p.yards}` : p.yards} yds
                </span>
                {p.turnover && <span className="text-err font-bold"> TO</span>}
                {p.scoring_event === 'td' && <span className="text-ok font-bold"> TD!</span>}
                {p.scoring_event === 'fg' && <span className="text-ok font-bold"> FG!</span>}
                {p.scoring_event === 'safety' && <span className="text-warn font-bold"> SAFETY</span>}
              </div>
              <div className="text-fg/40 text-xs">{p.text_recap}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}