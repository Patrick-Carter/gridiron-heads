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
    <div className="panel-flash space-y-2">
      <div className="panel-titlebar !mt-0">
        <span>Recent Plays</span>
        <span className="text-xs">Last {maxEntries}</span>
      </div>
      {recent.length === 0 ? (
        <div className="text-ink/50 text-sm text-center italic">No plays yet — make some noise!</div>
      ) : (
        <ul className="space-y-1 text-sm">
          {recent.map((p, i) => {
            const mineOff = p.off_call && (p as any).offense === myIdx;
            return (
              <li
                key={i}
                className="border-3 border-ink p-2 bg-cream"
                style={{ borderWidth: 3, borderColor: '#0a0a18' }}
              >
                <div className="text-[10px] text-ink/60 uppercase tracking-wide">
                  {p.down === 1 ? '1st' : p.down === 2 ? '2nd' : p.down === 3 ? '3rd' : '4th'} & {p.distance} @ {p.yardline_before}
                </div>
                <div className="font-bold">
                  <span className="chip">{p.off_call?.parent}</span>{' '}
                  <span className="text-xs">{p.off_call?.sub}</span>
                  {p.off_audible && <span className="text-maroon text-xs font-bold"> (AUD → {p.off_audible.sub})</span>}
                  {p.off_fake_audible && <span className="text-sky text-xs font-bold"> (FAKE!)</span>}
                  {' → '}
                  <span
                    className={`font-black ${
                      p.yards > 0 ? 'text-ok' : p.yards < 0 ? 'text-maroon' : 'text-ink/60'
                    }`}
                  >
                    {p.yards > 0 ? `+${p.yards}` : p.yards} yds
                  </span>
                  {p.turnover && <span className="text-maroon font-bold"> TO!</span>}
                  {p.scoring_event === 'td' && <span className="chip !bg-lime ml-1">TD!</span>}
                  {p.scoring_event === 'fg' && <span className="chip !bg-lime ml-1">FG!</span>}
                  {p.scoring_event === 'safety' && <span className="chip !bg-warn ml-1">SAFETY</span>}
                </div>
                <div className="text-ink/70 text-xs italic">{p.text_recap}</div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
