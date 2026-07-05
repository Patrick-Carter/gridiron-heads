export default function ScorePanel({
  scores,
  myIdx,
  players,
}: {
  scores: [number, number];
  myIdx: 0 | 1;
  players: { id: string; name: string }[];
}) {
  return (
    <div className="panel-flash text-center">
      <div className="panel-titlebar !mt-0">
        <span>Scoreboard</span>
        <span className="text-xs">First to 3 (win by 2)</span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {[0, 1].map((i) => {
          const isMe = i === myIdx;
          return (
            <div
              key={i}
              className={`border-4 border-ink py-3 px-2 ${
                isMe ? 'bg-sun' : 'bg-cream'
              }`}
              style={{ borderColor: '#0a0a18' }}
            >
              <div className="text-xs font-bold uppercase tracking-wide text-ink/80 truncate">
                {players[i]?.name}
                {isMe && <span className="sticker ml-1">YOU</span>}
              </div>
              <div className="text-4xl md:text-5xl font-black text-ink leading-none">
                {scores[i].toFixed(1)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
