// ResultsPanel — matchup rectangles + verdict + result card.
//
// Sits in the right column of the 2-col section below the canvas, next to
// the play call panel. Renders:
//   ┌─ Skill matchup rect ─┐  ┌─ Line matchup rect ─┐
//   │ OFF 28/64 < DEF 47/70│  │ O-LINE 72/99 > D-LINE 54/84 │
//   └──────────────────────┘  └──────────────────────────┘
//   [verdict line]
//   ┌─ Result rect ─────────────────┐
//   │ +8 YDS · Gain of 8.            │
//   └────────────────────────────────┘
//
// FG and punt plays skip the LINE rectangle (no line roll happens) and
// adapt the SKILL rectangle to show FG power+bonus vs YTG / punt yardage.
//
// The scrollable history list that used to live at the bottom of this panel
// has been extracted into its own component (`HistoryPanel.tsx`), placed in
// a full-width row below this 2-col section on desktop (and below the
// results+rolls row on mobile).

import type { PlayResult } from '@gridiron/shared';

interface ResultsPanelProps {
  playResult: PlayResult | null;
  /** Animation progress 0..1. Drives reveal timing. null = static (between plays). */
  progress: number | null;
}

// Tailwind-style classes (defined in globals.css .panel-flash family — no new CSS needed)
const RECT = 'border-4 border-ink p-2 bg-cream flex flex-col items-center min-w-0';
const RECT_HIDDEN = 'opacity-0 scale-95';
const CHIP_LIME = 'chip !bg-lime !text-ink text-xs';
const CHIP_MAROON = 'chip !bg-maroon !text-cream text-xs';
const CHIP_NEUTRAL = 'chip !bg-cream !text-ink text-xs';

/** Pad a number to 2 digits so the flip-in animations don't jitter the layout. */
function pad2(n: number | undefined | null): string {
  if (n == null) return '--';
  return String(Math.max(0, Math.floor(n))).padStart(2, '0');
}

/** Decide the comparison symbol between two rolls.
 *  Returns '>' if off > def, '<' if def > off, '=' if equal. null when both
 *  are zero (parent mismatch — offense auto-wins, no roll fired). */
function compareSymbol(offRoll: number, defRoll: number): '>' | '<' | '=' | null {
  if (offRoll === 0 && defRoll === 0) return null;
  if (offRoll > defRoll) return '>';
  if (defRoll > offRoll) return '<';
  return '=';
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

// === Matchup rectangles ====================================================

interface MatchupRectProps {
  testId: string;
  offLabel: string;
  offRoll: number | undefined;
  offBound: number | undefined;
  defLabel: string;
  defRoll: number | undefined;
  defBound: number | undefined;
  /** When true (parent mismatch auto-win), render em-dashes for the rolls and
   *  force the symbol to '>' since the offense is credited with the win. */
  forceOffWins?: boolean;
  visible: boolean;
  ringColor: string;
  /** Background tint of the rect's chip row. */
  offChipClass?: string;
  defChipClass?: string;
}

/** A single matchup rectangle. The shape is:
 *    [OFF chip]  offRoll/offBound [symbol] defRoll/defBound  [DEF chip]
 *    ────────────────────────────────────────────────────────────────
 *    OFF Skill 28/64  <  DEF Skill 47/70
 */
function MatchupRect({
  testId,
  offLabel,
  offRoll,
  offBound,
  defLabel,
  defRoll,
  defBound,
  forceOffWins,
  visible,
  ringColor,
  offChipClass,
  defChipClass,
}: MatchupRectProps) {
  const offChip = offChipClass ?? CHIP_LIME;
  const defChip = defChipClass ?? CHIP_MAROON;
  const symbol =
    forceOffWins
      ? '>'
      : compareSymbol(offRoll ?? 0, defRoll ?? 0) ?? '>';
  const offRollText = forceOffWins ? '—' : pad2(offRoll);
  const defRollText = forceOffWins ? '—' : pad2(defRoll);
  return (
    <div
      className={`${RECT} transition-all duration-200 ${visible ? '' : RECT_HIDDEN}`}
      style={{ borderColor: '#0a0a18', boxShadow: `3px 3px 0 0 ${ringColor}` }}
      data-testid={testId}
    >
      <div className="flex items-center gap-2 font-black tabular-nums text-sm w-full justify-center flex-wrap">
        <span className={offChip}>{offLabel}</span>
        <span data-testid={`${testId}-off`}>
          {offRollText}<span className="text-ink/50">/{offBound ?? '--'}</span>
        </span>
        <span
          className="text-2xl leading-none"
          style={{ color: '#0a0a18' }}
          data-testid={`${testId}-symbol`}
        >
          {symbol}
        </span>
        <span data-testid={`${testId}-def`}>
          {defRollText}<span className="text-ink/50">/{defBound ?? '--'}</span>
        </span>
        <span className={defChip}>{defLabel}</span>
      </div>
    </div>
  );
}

/** FG-specific matchup: KICKER power+bonus=total vs YTG. */
function FgMatchupRect({ p, visible }: { p: PlayResult; visible: boolean }) {
  const made = p.scoring_event === 'fg';
  const ytg = p.offense_direction === 1
    ? Math.max(0, 100 - p.yardline_before)
    : Math.max(0, p.yardline_before);
  return (
    <div
      className={`${RECT} transition-all duration-200 ${visible ? '' : RECT_HIDDEN}`}
      style={{ borderColor: '#0a0a18', boxShadow: '3px 3px 0 0 #00bfff' }}
      data-testid="matchup-fg"
    >
      <div className="flex items-center gap-2 font-black tabular-nums text-sm w-full justify-center flex-wrap">
        <span className={CHIP_NEUTRAL}>KICKER</span>
        <span data-testid="fg-power">{p.fg_power_roll ?? '--'}</span>
        <span className="text-ink/50">+</span>
        <span data-testid="fg-bonus">{p.fg_bonus_roll ?? '--'}</span>
        <span className="text-ink/50">=</span>
        <span className={made ? 'text-ok' : 'text-maroon'} data-testid="fg-total">
          {p.fg_total ?? '--'}
        </span>
        <span className="text-ink/50 text-base">vs</span>
        <span data-testid="fg-ytg">{ytg}</span>
        <span className={CHIP_NEUTRAL}>YTG</span>
      </div>
      <div className={`text-sm font-black mt-1 ${made ? 'text-ok' : 'text-maroon'}`}>
        {made ? '✓ MAKE' : '✗ MISS'}
      </div>
    </div>
  );
}

/** Punt-specific matchup: punt yardage. */
function PuntMatchupRect({ p, visible }: { p: PlayResult; visible: boolean }) {
  return (
    <div
      className={`${RECT} transition-all duration-200 ${visible ? '' : RECT_HIDDEN}`}
      style={{ borderColor: '#0a0a18', boxShadow: '3px 3px 0 0 #7e3fb1' }}
      data-testid="matchup-punt"
    >
      <div className="flex items-center gap-2 font-black tabular-nums text-base w-full justify-center flex-wrap">
        <span className="chip !bg-grape !text-cream text-xs">PUNT</span>
        <span style={{ color: '#0a0a18' }} data-testid="punt-yards">
          +{p.punt_roll ?? '--'}
        </span>
        <span className="text-ink/60 text-sm">YDS NET</span>
      </div>
    </div>
  );
}

// === Result card ===========================================================

function ResultCard({ p, visible }: { p: PlayResult; visible: boolean }) {
  const yards = p.yards;
  const yardsColor =
    yards > 0 ? 'text-ok' : yards < 0 ? 'text-maroon' : 'text-ink';
  const yardsStr =
    yards > 0 ? `+${yards}` : yards < 0 ? `${yards}` : '0';
  return (
    <div
      className={`${RECT} transition-all duration-200 ${visible ? '' : RECT_HIDDEN}`}
      style={{ borderColor: '#0a0a18', boxShadow: '3px 3px 0 0 #ffd400' }}
      data-testid="result-card"
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

// === Top-level component ===================================================

export default function ResultsPanel({
  playResult,
  progress,
}: ResultsPanelProps) {
  const showMatchup = !!playResult;
  const isFG = playResult?.off_call?.parent === 'fg';
  const isPunt = playResult?.off_call?.parent === 'punt';
  const isLive = progress != null;

  // Visibility thresholds (matched to the canvas animation timeline).
  const vMatchup1 = !isLive || progress >= 0.20;
  const vMatchup2 = !isLive || progress >= 0.40;
  const vVerdict = !isLive || progress >= 0.55;
  const vResult = !isLive || progress >= 0.70;

  const verdict = playResult ? verdictText(playResult) : null;
  // Detect parent-mismatch auto-win: both skill rolls are 0.
  const mismatchAutoWin =
    !!playResult &&
    !playResult.parent_match &&
    (playResult.off_roll ?? 0) === 0 &&
    (playResult.def_roll ?? 0) === 0;

  return (
    <div className="panel-flash" data-testid="results-panel">
      <div className="panel-titlebar !mt-0">
        <span>Results</span>
        <span className="text-xs">
          {showMatchup
            ? isLive
              ? `Anim ${Math.round((progress ?? 0) * 100)}%`
              : 'Recap'
            : 'Waiting'}
        </span>
      </div>

      {!showMatchup ? (
        <div className="text-center text-sm">
          <div className="text-ink/60 italic">Snap the ball to see what each position rolled.</div>
        </div>
      ) : (
        <>
          {/* Top: matchup rectangles + verdict + result */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-1">
            {isFG ? (
              <FgMatchupRect p={playResult!} visible={vMatchup1} />
            ) : isPunt ? (
              <PuntMatchupRect p={playResult!} visible={vMatchup1} />
            ) : (
              <MatchupRect
                testId="matchup-skill"
                offLabel="OFF SKILL"
                offRoll={playResult!.off_roll}
                offBound={playResult!.off_skill_eff}
                defLabel="DEF SKILL"
                defRoll={playResult!.def_roll}
                defBound={playResult!.def_skill_eff}
                forceOffWins={mismatchAutoWin}
                visible={vMatchup1}
                ringColor="#c8ff00"
              />
            )}
            {!isFG && !isPunt && (
              <MatchupRect
                testId="matchup-line"
                offLabel="O-LINE"
                offRoll={playResult!.off_line_roll}
                offBound={playResult!.off_line_skill}
                defLabel="D-LINE"
                defRoll={playResult!.def_line_roll}
                defBound={playResult!.def_line_skill}
                visible={vMatchup2}
                ringColor="#7e3fb1"
                offChipClass="chip !bg-grape !text-cream text-xs"
                defChipClass="chip !bg-cream !text-ink text-xs border-2 border-ink"
              />
            )}
          </div>

          <div
            className={`text-center mt-2 text-sm transition-opacity duration-200 ${vVerdict ? 'opacity-100' : 'opacity-0'}`}
          >
            <span className={toneClass(verdict!.tone)} data-testid="roll-verdict">
              {verdict!.label}
            </span>
            {playResult!.line_roll_gap != null && playResult!.line_roll_gap > 0 && (
              <span className="ml-2 text-xs font-bold text-ink/60">
                line gap {playResult!.line_roll_gap}
                {playResult!.line_winner ? ` (${playResult!.line_winner})` : ''}
              </span>
            )}
          </div>

          <div className="mt-2">
            <ResultCard p={playResult!} visible={vResult} />
          </div>
        </>
      )}
    </div>
  );
}
