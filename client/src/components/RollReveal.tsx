// RollReveal — skill-roll HUD below the field.
//
// Shows the actual per-play roll values the resolver computed: off_skill vs
// def_skill, line rolls, FG rolls, punt roll. Reveals are synced to the
// canvas animation via a `progress` prop (0..1) so the player sees:
//
//   0.0 – 0.4 : SNAP banner
//   0.4 – 0.8 : SKILL cards flip in
//   0.8 – 1.2 : LINE cards flip in
//   1.2 – 1.6 : VERDICT line appears
//   1.6 – 2.4 : RESULT card slides in
//
// For plays with no skill roll (punt/fg), the appropriate variant shows.

import type { PlayResult } from '@gridiron/shared';

interface RollRevealProps {
  playResult: PlayResult | null;
  /** Animation progress 0..1. Drives reveal timing. null = static (between plays). */
  progress: number | null;
  /** Compact mode for the static (between plays) recap. */
  compact?: boolean;
}

// Tailwind-style classes (defined in globals.css .panel-flash family — no new CSS needed)
const ROLLCARD = 'border-4 border-ink p-2 bg-cream flex flex-col items-center min-w-0';
// (kept border-4 since Tailwind doesn't ship border-3 by default)
const ROLLCARD_HIDDEN = 'opacity-0 scale-95';
const CHIP_LIME = 'chip !bg-lime !text-ink text-xs';
const CHIP_MAROON = 'chip !bg-maroon !text-cream text-xs';
const CHIP_NEUTRAL = 'chip !bg-cream !text-ink text-xs';

/** Format a number for display: 0..100 with leading-zero padding for digit-flip stability. */
function fmtRoll(n: number | undefined | null): string {
  if (n == null) return '--';
  return String(Math.max(0, Math.floor(n))).padStart(2, '0');
}

/** Per-play verdict text. Mirrors the resolver's tier system. */
function verdictText(p: PlayResult): { label: string; tone: 'good' | 'bad' | 'neutral' } {
  if (p.scoring_event === 'td') return { label: 'TOUCHDOWN!', tone: 'good' };
  if (p.scoring_event === 'fg') return { label: 'FIELD GOAL GOOD', tone: 'good' };
  if (p.scoring_event === 'safety') return { label: 'SAFETY', tone: 'bad' };
  if (p.turnover) return { label: 'TURNOVER — DEFENSE READ IT', tone: 'bad' };
  if (p.line_regime === 'dominate') {
    if (p.line_winner === 'offense') return { label: 'LINE DOMINATES — BLOWN OPEN', tone: 'good' };
    return { label: 'LINE BLOWN UP — STUFFED', tone: 'bad' };
  }
  if (p.line_regime === 'lean') {
    if (p.line_winner === 'offense') return { label: 'LINE LEAN — OFFENSE', tone: 'good' };
    return { label: 'LINE LEAN — DEFENSE', tone: 'bad' };
  }
  if (!p.parent_match) return { label: 'DEFENSE MISREAD — OFFENSE OPEN', tone: 'good' };
  if (!p.sub_match) return { label: 'WRONG DEPTH — SMALL GAIN', tone: 'neutral' };
  return { label: 'PERFECT READ — FAIR RESULT', tone: 'neutral' };
}

function toneClass(tone: 'good' | 'bad' | 'neutral'): string {
  if (tone === 'good') return 'text-ok font-black';
  if (tone === 'bad') return 'text-maroon font-black';
  return 'text-ink font-bold';
}

/** Sub-component: a single roll card with an animated flip-in. */
function FlipCard({
  label,
  roll,
  bound,
  visible,
  side,
}: {
  label: string;
  roll: number | undefined | null;
  bound: number | undefined | null;
  visible: boolean;
  side: 'off' | 'def';
}) {
  const chipClass = side === 'off' ? CHIP_LIME : CHIP_MAROON;
  const ringColor = side === 'off' ? '#c8ff00' : '#c8102e';
  return (
    <div
      className={`${ROLLCARD} transition-all duration-200 ${visible ? '' : ROLLCARD_HIDDEN}`}
      style={{ borderColor: '#0a0a18', boxShadow: `3px 3px 0 0 ${ringColor}` }}
    >
      <span className={chipClass}>{label}</span>
      <div
        className="font-black tabular-nums leading-none mt-1 text-3xl"
        style={{ color: '#0a0a18', fontFamily: 'Trebuchet MS, monospace' }}
        data-testid={`roll-${label.toLowerCase().replace(/\s/g, '-')}`}
      >
        {fmtRoll(roll)}
      </div>
      <div className="text-[10px] font-bold text-ink/60 mt-0.5">
        / {bound ?? '--'}
      </div>
    </div>
  );
}

/** Sub-component: FG roll reveal — shows power + bonus + total vs ytg. */
function FGCard({
  p,
  visible,
}: {
  p: PlayResult;
  visible: boolean;
}) {
  const made = p.scoring_event === 'fg';
  return (
    <div
      className={`${ROLLCARD} col-span-2 transition-all duration-200 ${visible ? '' : ROLLCARD_HIDDEN}`}
      style={{ borderColor: '#0a0a18', boxShadow: '3px 3px 0 0 #00bfff' }}
    >
      <span className={CHIP_NEUTRAL}>FIELD GOAL</span>
      <div className="flex items-center gap-2 mt-1 font-black tabular-nums text-2xl">
        <span style={{ color: '#0a0a18' }} data-testid="fg-power">{p.fg_power_roll ?? '--'}</span>
        <span className="text-ink/50 text-base">+</span>
        <span style={{ color: '#0a0a18' }} data-testid="fg-bonus">{p.fg_bonus_roll ?? '--'}</span>
        <span className="text-ink/50 text-base">=</span>
        <span className={made ? 'text-ok' : 'text-maroon'} data-testid="fg-total">
          {p.fg_total ?? '--'}
        </span>
      </div>
      <div className="text-[10px] font-bold text-ink/60 mt-0.5">
        POWER ({p.fg_power_eff ?? '--'}) + BONUS (20) vs YTG
      </div>
      <div className={`text-sm font-black mt-1 ${made ? 'text-ok' : 'text-maroon'}`}>
        {made ? '✓ MAKE' : '✗ MISS'}
      </div>
    </div>
  );
}

/** Sub-component: punt roll card. */
function PuntCard({
  p,
  visible,
}: {
  p: PlayResult;
  visible: boolean;
}) {
  return (
    <div
      className={`${ROLLCARD} col-span-2 transition-all duration-200 ${visible ? '' : ROLLCARD_HIDDEN}`}
      style={{ borderColor: '#0a0a18', boxShadow: '3px 3px 0 0 #7e3fb1' }}
    >
      <span className="chip !bg-grape !text-cream text-xs">PUNT</span>
      <div className="font-black tabular-nums text-3xl mt-1" style={{ color: '#0a0a18' }}>
        +{p.punt_roll ?? '--'} <span className="text-base text-ink/60">YDS</span>
      </div>
      <div className="text-[10px] font-bold text-ink/60 mt-0.5">
        ROLL (30-50 NET FORWARD)
      </div>
    </div>
  );
}

/** Result card: yards gained/lost + new down/distance + scoring. */
function ResultCard({
  p,
  visible,
}: {
  p: PlayResult;
  visible: boolean;
}) {
  const yards = p.yards;
  const yardsColor =
    yards > 0 ? 'text-ok' : yards < 0 ? 'text-maroon' : 'text-ink';
  const yardsStr =
    yards > 0 ? `+${yards}` : yards < 0 ? `${yards}` : '0';
  return (
    <div
      className={`${ROLLCARD} col-span-2 transition-all duration-200 ${visible ? '' : ROLLCARD_HIDDEN}`}
      style={{ borderColor: '#0a0a18', boxShadow: '3px 3px 0 0 #ffd400' }}
    >
      <span className="chip !bg-sun !text-ink text-xs">RESULT</span>
      <div className={`font-black tabular-nums text-3xl mt-1 ${yardsColor}`}>
        {yardsStr} <span className="text-base text-ink/60">YDS</span>
      </div>
      <div className="text-xs font-bold text-ink/80 mt-0.5">
        {p.text_recap}
      </div>
      {p.scoring_event && (
        <div className="chip !bg-lime mt-1 text-xs">
          {p.scoring_event.toUpperCase()}+{(p.scoring_event === 'td' ? 1 : 0.5).toFixed(1)}
        </div>
      )}
    </div>
  );
}

export default function RollReveal({ playResult, progress, compact }: RollRevealProps) {
  if (!playResult) {
    return (
      <div className="panel-flash text-center text-sm">
        <div className="panel-titlebar !mt-0">
          <span>Skill Roll</span>
          <span className="text-xs">Waiting</span>
        </div>
        <div className="text-ink/60 italic">Snap the ball to see what each position rolled.</div>
      </div>
    );
  }

  const parent = playResult.off_call?.parent;
  const isFG = parent === 'fg';
  const isPunt = parent === 'punt';
  const isLive = progress != null;

  // Visibility thresholds (matched to the canvas animation timeline).
  const vSkill = !isLive || progress >= 0.20;
  const vLine = !isLive || progress >= 0.40;
  const vVerdict = !isLive || progress >= 0.55;
  const vResult = !isLive || progress >= 0.70;

  const verdict = verdictText(playResult);

  return (
    <div className="panel-flash" data-testid="roll-reveal">
      <div className="panel-titlebar !mt-0">
        <span>
          {isFG ? 'FG Roll' : isPunt ? 'Punt Roll' : 'Skill Roll'}
        </span>
        <span className="text-xs">
          {isLive ? `Anim ${Math.round((progress ?? 0) * 100)}%` : 'Recap'}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 mt-1">
        {isFG ? (
          <FGCard p={playResult} visible={vSkill} />
        ) : isPunt ? (
          <PuntCard p={playResult} visible={vSkill} />
        ) : (
          <>
            <FlipCard
              label="OFF SKILL"
              roll={playResult.off_roll}
              bound={playResult.off_skill_eff}
              visible={vSkill}
              side="off"
            />
            <FlipCard
              label="DEF SKILL"
              roll={playResult.def_roll}
              bound={playResult.def_skill_eff}
              visible={vSkill}
              side="def"
            />
            <FlipCard
              label="O-LINE"
              roll={playResult.off_line_roll}
              bound={playResult.off_line_skill}
              visible={vLine}
              side="off"
            />
            <FlipCard
              label="D-LINE"
              roll={playResult.def_line_roll}
              bound={playResult.def_line_skill}
              visible={vLine}
              side="def"
            />
          </>
        )}
      </div>

      {!compact && (
        <>
          <div
            className={`text-center mt-2 text-sm transition-opacity duration-200 ${vVerdict ? 'opacity-100' : 'opacity-0'}`}
          >
            <span className={toneClass(verdict.tone)} data-testid="roll-verdict">
              {verdict.label}
            </span>
            {playResult.line_roll_gap != null && playResult.line_roll_gap > 0 && (
              <span className="ml-2 text-xs font-bold text-ink/60">
                line gap {playResult.line_roll_gap}
                {playResult.line_winner ? ` (${playResult.line_winner})` : ''}
              </span>
            )}
          </div>

          <div className="mt-2">
            <ResultCard p={playResult} visible={vResult} />
          </div>
        </>
      )}
    </div>
  );
}