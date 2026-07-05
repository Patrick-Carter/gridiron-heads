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
    <div className="bg-panel border border-border rounded p-4">
      <div className="grid grid-cols-2 gap-4 text-center">
        {[0, 1].map((i) => (
          <div key={i}>
            <div className="text-xs text-fg/60">
              {players[i]?.name}{i === myIdx && ' (you)'}
            </div>
            <div className="text-3xl font-bold text-accent">
              {scores[i].toFixed(1)}
            </div>
          </div>
        ))}
      </div>
      <div className="text-xs text-fg/40 text-center mt-2">
        First to 3 (win by 2)
      </div>
    </div>
  );
}