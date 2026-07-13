// Reusable Flash-game chrome — a chunky banner with a tilted yellow title bar
// and optional star stickers. Used as the page hero on Home / Lobby /
// GameOver. Sits in front of the gradient+splash-star backdrop.

import VolumePanel from './VolumePanel.js';

export default function FlashHeader({
  title,
  kicker,
  star,
}: {
  title: string;
  kicker?: string;
  star?: string;
}) {
  return (
    <div className="relative flex flex-col items-center justify-center py-6">
      <div className="absolute left-0 top-2 z-20">
        <VolumePanel />
      </div>
      {kicker && (
        <div className="sticker mb-3 animate-wobble">{kicker}</div>
      )}
      <div className="flash-banner text-3xl md:text-5xl animate-shout whitespace-nowrap">
        {title}
      </div>
      {star && (
        <div
          aria-hidden
          className="pointer-events-none absolute right-4 top-2 text-4xl animate-star-blink select-none"
        >
          {star}
        </div>
      )}
    </div>
  );
}
