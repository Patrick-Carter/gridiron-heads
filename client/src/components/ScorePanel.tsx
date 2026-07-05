import VolumePanel from './VolumePanel.js';
import { ballSpot } from '@gridiron/shared';

function downLabel(d: number): string {
  return d === 1 ? '1st' : d === 2 ? '2nd' : d === 3 ? '3rd' : '4th';
}

function spotText(spot: ReturnType<typeof ballSpot>): string {
  if (spot.label === null) return 'at midfield';
  return `at ${spot.label.toLowerCase()} ${spot.yards}`;
}

/**
 * Compact broadcast-style score strip.
 *
 *   [🏈 Alice  ·  2.0]   2ND & 7 · OPP 35   [Bob  ·  1.0 🏈]   🔊
 *        ↘ clickable                                          ↙ clickable
 *
 * - Possession is shown with a 🏈 next to the active team.
 * - Clicking either team's half opens that team's roster.
 * - Down/distance/ball spot sit in the center (between the two scores).
 * - The whole strip is a single thin row on `lg+`; on smaller viewports
 *   the center chip drops below so the side buttons can stretch full-width.
 */
export default function ScorePanel({
  scores,
  myIdx,
  players,
  possessionIdx,
  down,
  distance,
  ballYardline,
  offenseDirection,
  onOpenRoster,
}: {
  scores: [number, number];
  myIdx: 0 | 1;
  players: { id: string; name: string }[];
  possessionIdx: 0 | 1;
  down: 1 | 2 | 3 | 4;
  distance: number;
  ballYardline: number;
  offenseDirection: 1 | -1;
  onOpenRoster: (idx: 0 | 1) => void;
}) {
  const spot = ballSpot({ ball_yardline: ballYardline } as any);
  return (
    <div
      className="panel-flash !py-1.5 !px-2"
      data-testid="score-strip"
    >
      <div className="flex flex-wrap items-center justify-between gap-1.5">
        {[0, 1].map((i) => {
          const isMe = i === myIdx;
          const hasBall = i === possessionIdx;
          // Active side gets lime tint; inactive side stays cream.
          const sideStyle = hasBall
            ? { background: '#c8ff00', color: '#0a0a18', borderColor: '#0a0a18' }
            : { background: '#fff8dc', color: '#0a0a18', borderColor: '#0a0a18' };
          return (
            <button
              key={i}
              onClick={() => onOpenRoster(i as 0 | 1)}
              data-testid={`roster-trigger-${i}`}
              aria-label={`Open ${players[i]?.name ?? 'team ' + i}'s roster`}
              className="flex items-center gap-1.5 border-2 px-2 py-1 text-sm font-black flex-1 min-w-0 cursor-pointer hover:brightness-110 transition"
              style={sideStyle}
            >
              {i === 0 && hasBall && <span aria-label="has possession">🏈</span>}
              <span className="truncate">
                {players[i]?.name ?? '?'}
                {isMe && (
                  <span className="sticker ml-1 !text-[10px] !py-0 !px-1.5">YOU</span>
                )}
              </span>
              <span className="ml-auto text-base md:text-lg leading-none tabular-nums">
                {scores[i].toFixed(1)}
              </span>
              {i === 1 && hasBall && <span aria-label="has possession">🏈</span>}
            </button>
          );
        })}

        {/* Center chip: down & distance + ball spot. */}
        <div className="basis-full lg:basis-auto lg:flex-none order-3 lg:order-none flex items-center justify-center gap-1.5 px-2 py-1 border-2 border-ink bg-cream text-xs md:text-sm font-black uppercase tracking-wide">
          <span>{downLabel(down)} &amp; {distance}</span>
          <span className="text-ink/60 font-bold normal-case">{spotText(spot)}</span>
          <span className="hidden md:inline text-ink/50 font-bold">
            {offenseDirection === 1 ? '→' : '←'}
          </span>
        </div>

        {/* VolumePanel — tucked into the strip's top-right corner. */}
        <div className="order-2 lg:order-none">
          <VolumePanel />
        </div>
      </div>
    </div>
  );
}