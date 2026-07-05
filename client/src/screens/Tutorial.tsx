// Tutorial / How-to-Play page. Explains the math and decision tree in depth
// so a new player can read the rules before jumping in. Visual walkthrough
// uses small inline field diagrams (svg) so it stays self-contained.
import { Link } from 'react-router-dom';
import FlashHeader from '../components/FlashHeader.js';

/** Tiny svg field. width 400, height 100. Yardlines drawn every 10y. */
function MiniField({
  los,
  toGo,
  direction,
}: {
  los: number; // 0..100
  toGo: number; // yards needed for 1st down (rendered as a tick)
  direction: 1 | -1;
}) {
  const W = 400;
  const H = 100;
  const yard = (y: number) => (y / 100) * W;
  // Direction: +1 attacks right (target end zone on the right). -1 attacks left.
  const targetX = direction === 1 ? W : 0;
  const losX = yard(los);
  const firstDownX = yard(
    direction === 1
      ? Math.min(100, los + toGo)
      : Math.max(0, los - toGo),
  );
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto field-frame block" role="img">
      <rect x="0" y="0" width={W} height={H} fill="#0a3d1f" />
      {/* yardlines */}
      {Array.from({ length: 11 }, (_, i) => i * 10).map((y) => (
        <line
          key={y}
          x1={yard(y)}
          x2={yard(y)}
          y1={0}
          y2={H}
          stroke="#fff8dc"
          strokeOpacity={y === 0 || y === 100 ? 0.9 : 0.25}
          strokeWidth={y === 0 || y === 100 ? 3 : 1}
        />
      ))}
      {/* end zone shading */}
      <rect x="0" y="0" width={yard(10)} height={H} fill="#ffffff" fillOpacity={0.06} />
      <rect x={yard(90)} y="0" width={yard(10)} height={H} fill="#ffffff" fillOpacity={0.06} />
      {/* first-down marker */}
      <line
        x1={firstDownX}
        x2={firstDownX}
        y1={0}
        y2={H}
        stroke="#ffd400"
        strokeWidth={2}
        strokeDasharray="4 3"
      />
      <text
        x={firstDownX + (direction === 1 ? 4 : -4)}
        y={14}
        fill="#ffd400"
        fontSize="10"
        fontWeight="900"
        textAnchor={direction === 1 ? 'start' : 'end'}
      >
        1ST
      </text>
      {/* LOS marker */}
      <line x1={losX} x2={losX} y1={0} y2={H} stroke="#fff8dc" strokeWidth={3} />
      <text
        x={losX + 4}
        y={H - 6}
        fill="#fff8dc"
        fontSize="10"
        fontWeight="900"
      >
        LOS
      </text>
      {/* ball */}
      <circle cx={losX} cy={H / 2} r="6" fill="#c8102e" stroke="#0a0a18" strokeWidth="2" />
      {/* target end zone arrow */}
      <line
        x1={losX}
        y1={H / 2}
        x2={targetX + (direction === 1 ? -10 : 10)}
        y2={H / 2}
        stroke="#c8ff00"
        strokeWidth="2"
        markerEnd="url(#arrow)"
        opacity={0.7}
      />
      <defs>
        <marker
          id="arrow"
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M0,0 L10,5 L0,10 Z" fill="#c8ff00" />
        </marker>
      </defs>
    </svg>
  );
}

/** Small play-call chip pair used in diagrams. */
function CallRow({
  off,
  def,
  effectiveOff,
  effectiveDef,
  label,
}: {
  off: string;
  def: string;
  effectiveOff?: string;
  effectiveDef?: string;
  label: string;
}) {
  return (
    <div className="text-xs md:text-sm flex items-center justify-between gap-2 bg-cream/40 border-2 border-ink/80 px-2 py-1.5">
      <span className="font-black">{label}</span>
      <div className="flex items-center gap-2">
        <span className="chip !bg-lime !text-ink">{off}</span>
        <span className="text-ink/60 font-black">vs</span>
        <span className="chip !bg-maroon !text-cream">{def}</span>
      </div>
      {(effectiveOff || effectiveDef) && (
        <div className="flex items-center gap-2 text-ink/70">
          <span className="font-black">→</span>
          {effectiveOff && <span className="chip !bg-lime !text-ink">{effectiveOff}</span>}
          {effectiveDef && <span className="chip !bg-maroon !text-cream">{effectiveDef}</span>}
        </div>
      )}
    </div>
  );
}

export default function Tutorial() {
  return (
    <div className="min-h-full flex flex-col items-center p-4 md:p-8">
      <FlashHeader title="HOW TO PLAY" kicker="Tutorial" star="📖" />

      <div className="max-w-3xl w-full space-y-4">
        {/* === 30-SECOND PITCH === */}
        <section className="panel-flash">
          <div className="panel-titlebar">
            <span>30-Second Pitch</span>
            <span className="text-xs">TL;DR</span>
          </div>
          <p className="text-base leading-snug">
            Two players. Each <strong>drafts 6 position groups</strong> from a
            pool, then on every down both sides secretly call a play
            (<em>run/pass/punt/fg</em>) plus a sub-call. Plays resolve with
            seeded skill rolls. Whoever is ahead by <span className="chip">2</span>{' '}
            when someone reaches <span className="chip">3</span> points.
          </p>
        </section>

        {/* === DRAFT === */}
        <section className="panel-flash">
          <div className="panel-titlebar">
            <span>1 · The Draft</span>
            <span className="text-xs">12 picks</span>
          </div>
          <p className="text-sm leading-snug mb-3">
            You draft <strong>6 groups</strong> in alternating turns:
          </p>
          <ul className="text-sm space-y-1 pl-4 list-disc">
            <li>
              <strong>QB</strong> — adds one buff (e.g.{' '}
              <code className="font-mono">+15% yards on pass plays</code>).{' '}
              <em>Buffs only — never penalties.</em>
            </li>
            <li>
              <strong>O_LINE / D_LINE</strong> — the trench stat (50..100).
              Both lines <strong>roll [0, skill] every run/pass play</strong>,
              same as every other position group. The <em>per-play roll
              gap</em> decides the regime (not your draft-time skill gap —
              bad-draft teams can still catch a break per play).
            </li>
            <li>
              <strong>OFF_SKILL / DEF_SKILL</strong> — the skill number rolled on
              every run/pass play. Higher = wins more skill rolls.
            </li>
            <li>
              <strong>KICKER</strong> — power value (50..100) for FG attempts.
              Drives the FG success chance.
            </li>
          </ul>
          <p className="text-xs mt-3 text-ink/70">
            <strong>Draft gap cap:</strong> within each pool the two options
            are capped so they stay competitive. Skill groups cap at{' '}
            <span className="chip">25%</span>; line groups cap tighter at{' '}
            <span className="chip">15%</span> — since they roll head-to-head
            every play, a tighter cap keeps the trenches from being
            oppressive.
          </p>
          <p className="text-xs mt-1 text-ink/70">
            On each turn you can pick <em>any unpicked group</em>. The QB pool
            draws 3 random QBs out of 22 every game — pool-of-22 keeps
            re-drafts fresh.
          </p>
        </section>

        {/* === ANATOMY OF A PLAY === */}
        <section className="panel-flash">
          <div className="panel-titlebar">
            <span>2 · Anatomy of a Play</span>
            <span className="text-xs">Step by step</span>
          </div>
          <ol className="text-sm space-y-2 pl-4 list-decimal">
            <li>
              Both sides simultaneously pick a play + sub from the SchemePicker.
            </li>
            <li>
              <strong>Offense can AUDIBLE.</strong> Once per possession, the
              offense flips just the sub-type (inside↔outside, deep↔short).
              Also one <em>fake</em> audible per possession (flips the sub
              visually but doesn't actually flip it — burns the defense's
              counter-audible).
            </li>
            <li>
              <strong>Defense can only audible IN RESPONSE</strong> to an
              offense audible or fake. They cannot initiate.
            </li>
            <li>
              <strong>SNAP.</strong> The seed RNG rolls skill contests and
              yardage.
            </li>
            <li>
              The recap shows offense vs defense call, yardage, and the next
              down. <strong>Auto-advance</strong> takes you to the next down —
              no "next play" click needed.
            </li>
          </ol>
          <div className="mt-4 space-y-2">
            <p className="text-xs font-black text-ink/70">EXAMPLE LINEUP:</p>
            <CallRow
              label="Pre-snap"
              off="RUN INSIDE"
              def="PASS SHORT"
            />
            <CallRow
              label="After audible"
              off="RUN INSIDE"
              def="PASS SHORT"
              effectiveOff="RUN OUTSIDE"
            />
          </div>
        </section>

        {/* === THE MATH === */}
        <section className="panel-flash">
          <div className="panel-titlebar">
            <span>3 · The Math</span>
            <span className="text-xs">How yards are decided</span>
          </div>

          <h3 className="font-black mt-2 mb-1">Skill roll</h3>
          <p className="text-sm leading-snug mb-2">
            For run/pass, each side rolls{' '}
            <code className="font-mono">[0, skill]</code> (with QB modifiers
            applied). <strong>Higher roll wins</strong>. Ties → 0 yards, no
            turnover.
          </p>

          <h3 className="font-black mt-3 mb-1">Yardage by match quality</h3>
          <p className="text-sm leading-snug mb-2">
            The kicker is how well the defense <em>read</em> the play:
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs md:text-sm border-2 border-ink">
              <thead className="bg-sun text-ink">
                <tr>
                  <th className="text-left p-2">Defense read</th>
                  <th className="text-left p-2">Outcome</th>
                  <th className="text-left p-2">Yards</th>
                </tr>
              </thead>
              <tbody className="bg-cream">
                <tr className="border-t-2 border-ink">
                  <td className="p-2">Wrong parent (run vs pass)</td>
                  <td className="p-2">Offense auto-wins skill roll</td>
                  <td className="p-2 font-black">+5 to +25</td>
                </tr>
                <tr className="border-t-2 border-ink/40">
                  <td className="p-2">Right parent, wrong sub</td>
                  <td className="p-2">Defense had the right idea</td>
                  <td className="p-2 font-black">+1 to +8</td>
                </tr>
                <tr className="border-t-2 border-ink/40">
                  <td className="p-2">Right parent, right sub</td>
                  <td className="p-2">Perfect read — fair skill roll</td>
                  <td className="p-2 font-black">+1 to +10</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-xs text-ink/70 mt-2">
            If the defense wins the roll, offense loses 1–4 yards (capped at the
            distance to their own goal line). On a full mismatch this shouldn't
            happen — but if a QB mod flips the roll, the loss is still capped at
            −2.
          </p>

          <h3 className="font-black mt-4 mb-1">Turnover chance</h3>
          <p className="text-sm leading-snug">
            When the defense reads the play <em>perfectly</em> (parent + sub
            both match), the resolver rolls a <strong>25% turnover</strong>.
            A right-parent / wrong-sub read is <strong>5%</strong>. Full
            mismatch → 0%. (QB <code>turnover_chance_pct</code> mods reduce
            these.)
          </p>

          <h3 className="font-black mt-4 mb-1">Field goals (2-roll mechanic)</h3>
          <p className="text-sm leading-snug">
            FG resolves as{' '}
            <code className="font-mono">power_roll + bonus_roll &gt; yards_to_endzone</code>.
          </p>
          <ul className="text-xs mt-1 pl-4 list-disc space-y-0.5">
            <li>
              <code className="font-mono">power_roll</code> ={' '}
              <code className="font-mono">[0, kicker_power]</code>, scaled by QB
              <code> kicker_power_pct</code>.
            </li>
            <li>
              <code className="font-mono">bonus_roll</code> ={' '}
              <code className="font-mono">[0, 20]</code>, universal, no scaling.
            </li>
            <li>
              Make on <code className="font-mono">&gt;</code> (strictly greater).
              Worth <strong>0.5 points</strong>.
            </li>
          </ul>

          <h3 className="font-black mt-4 mb-1">Punts</h3>
          <p className="text-sm leading-snug">
            Punt advances the ball <strong>30–50 yards</strong> in the offense's
            direction (capped at the receiving team's 5). Perfect-read defense
            has a 25% chance to <strong>block</strong> the punt (turnover). Punt
            never scores points directly.
          </p>

          <h3 className="font-black mt-4 mb-1">Downs &amp; distance</h3>
          <p className="text-sm leading-snug">
            <strong>1st &amp; 10</strong> at every fresh possession. Pick up{' '}
            <code className="font-mono">distance</code> yards or more → new 1st
            down. <strong>4th down</strong> with insufficient yards = turnover
            on downs (defense takes the ball at the LOS). Negative yards{' '}
            <em>increase</em> distance — bad for the offense.
          </p>
        </section>

        {/* === TRENCHES === */}
        <section className="panel-flash">
          <div className="panel-titlebar">
            <span>3b · The Trenches (O_LINE vs D_LINE)</span>
            <span className="text-xs">New</span>
          </div>
          <p className="text-sm leading-snug">
            Every run/pass play also runs a <strong>line roll</strong> when the
            gap between O_LINE skill and D_LINE skill is wide enough. The line
            roll decides the play <em>before</em> the skill rolls even start —
            the trenches always have a say.
          </p>

          <h3 className="font-black mt-3 mb-1">How the roll works</h3>
          <p className="text-sm leading-snug">
            Every run/pass play, both lines roll{' '}
            <code className="font-mono">[0, line_skill]</code> — the same pattern
            as OFF_SKILL / DEF_SKILL / KICKER. The <em>per-play</em> roll gap
            (not the draft-time skill gap) decides the regime. A bad-draft line
            can still catch a break per play; a great-draft line can still get
            stuffed.
          </p>

          <h3 className="font-black mt-3 mb-1">Two regimes</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs md:text-sm border-2 border-ink">
              <thead className="bg-sun text-ink">
                <tr>
                  <th className="text-left p-2">Regime</th>
                  <th className="text-left p-2">Roll gap</th>
                  <th className="text-left p-2">Effect</th>
                </tr>
              </thead>
              <tbody className="bg-cream">
                <tr className="border-t-2 border-ink">
                  <td className="p-2 font-black">Lean</td>
                  <td className="p-2">5..14</td>
                  <td className="p-2">
                    Yardage nudge: line winner gets <code>+3</code> on
                    offense, <code>−2</code> on defense.
                  </td>
                </tr>
                <tr className="border-t-2 border-ink/40">
                  <td className="p-2 font-black">Dominate</td>
                  <td className="p-2">≥ 15</td>
                  <td className="p-2">
                    Line winner <strong>flips the outcome</strong>. Offense
                    dominates → <code>+5..+15</code> yards, no turnover.
                    Defense dominates → <code>−1..−6</code> yards + bumped
                    fumble rate.
                  </td>
                </tr>
                <tr className="border-t-2 border-ink/40">
                  <td className="p-2 text-ink/70">No effect</td>
                  <td className="p-2 text-ink/70">0..4</td>
                  <td className="p-2 text-ink/70">
                    Lines tied or close — fall through to parent/sub math.
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <h3 className="font-black mt-3 mb-1">Examples</h3>
          <ul className="text-sm pl-4 list-disc space-y-1">
            <li>
              Defense wrong parent (auto-offense win), but D-line roll wins
              by 15+ → <strong>BLOWN UP BY THE LINE!</strong> Loss.
            </li>
            <li>
              Defense perfect read, but O-line roll wins by 15+ →{' '}
              <strong>LINE OPENS THE HOLE!</strong> Gain of 5–15.
            </li>
            <li>
              Both lines tied or close (roll gap &lt; 5) → trenches are a
              non-event, the existing parent/sub math runs unchanged.
            </li>
          </ul>

          <p className="text-xs text-ink/70 mt-3">
            The line roll fires on <strong>run and pass only</strong>. Punts and
            field goals aren't decided in the trenches — they have their own
            mechanics.
          </p>
        </section>

        {/* === VISUAL WALKTHROUGH === */}
        <section className="panel-flash">
          <div className="panel-titlebar">
            <span>4 · Visual Walkthrough</span>
            <span className="text-xs">LOS, 1st down, target</span>
          </div>
          <p className="text-sm leading-snug mb-3">
            The field is 100 yards end-to-end. The white line is the
            <strong> line of scrimmage (LOS)</strong>, the dashed yellow line is
            the <strong>1st-down marker</strong>, the ball sits on the LOS, and
            the green arrow points at the offense's <strong>target end zone</strong>.
          </p>
          <div className="space-y-4">
            <div>
              <p className="text-xs font-black mb-1">
                Offense drives right · 1st &amp; 10 at the 35
              </p>
              <MiniField los={35} toGo={10} direction={1} />
            </div>
            <div>
              <p className="text-xs font-black mb-1">
                After +6 yd gain → 2nd &amp; 4 at the 41
              </p>
              <MiniField los={41} toGo={4} direction={1} />
            </div>
            <div>
              <p className="text-xs font-black mb-1">
                Possession flips · new offense attacks the OTHER end zone
              </p>
              <MiniField los={25} toGo={10} direction={-1} />
            </div>
          </div>
        </section>

        {/* === DECISION CHART === */}
        <section className="panel-flash">
          <div className="panel-titlebar">
            <span>5 · Decision Chart</span>
            <span className="text-xs">Pick smarter</span>
          </div>

          <h3 className="font-black mt-2 mb-2">📋 On OFFENSE</h3>
          <div className="text-sm leading-snug space-y-2 pl-2 border-l-4 border-lime">
            <p>
              <strong>Down &amp; distance matter more than anything.</strong>
            </p>
            <ul className="pl-4 list-disc space-y-1">
              <li>
                <strong>1st down</strong> — predict the defense's read. Run
                inside is the default "see what they call" call.
              </li>
              <li>
                <strong>2nd/3rd &amp; short (≤3)</strong> — run, ideally
                outside if you think they're in run-D.
              </li>
              <li>
                <strong>2nd/3rd &amp; long (≥7)</strong> — pass. If the defense
                calls pass, audible the sub on a real audible to flip the
                mismatch in your favor.
              </li>
              <li>
                <strong>4th down</strong> — go for it if you're close, otherwise
                <strong> FG inside their ~35</strong> (if kicker is good) or{' '}
                <strong>punt</strong> to flip the field.
              </li>
              <li>
                <strong>Holding a real audible?</strong> Save it for a play
                where you've already called one side and you want to flip the
                sub. Use a <strong>fake</strong> when you want to bait the
                defense into burning their counter-audible.
              </li>
            </ul>
          </div>

          <h3 className="font-black mt-4 mb-2">🛡️ On DEFENSE</h3>
          <div className="text-sm leading-snug space-y-2 pl-2 border-l-4 border-maroon">
            <p>
              <strong>Your read determines the yardage tier.</strong> A wrong
              parent gives up 5–25 yards. A right parent + right sub holds
              them to 1–10 and gives you a turnover roll.
            </p>
            <ul className="pl-4 list-disc space-y-1">
              <li>
                <strong>1st down</strong> — guess based on formation + down.
                The first play of a drive is the most unpredictable.
              </li>
              <li>
                <strong>2nd &amp; short</strong> — they ran it once, expect run
                again. Call run + the <em>opposite</em> sub from what you'd
                default to.
              </li>
              <li>
                <strong>3rd &amp; long</strong> — pass is more likely, but
                picking the wrong sub still costs you 1–8 yards. Read the
                situation.
              </li>
              <li>
                <strong>4th down</strong> — match the offense's call so your
                25% turnover roll / block chance can fire.
              </li>
              <li>
                <strong>Offense audibles?</strong> You get one counter-audible.
                Only burn it if the audible is clearly exploitable (e.g., they
                flipped from pass-short to pass-deep and you had pass-short
                locked).
              </li>
            </ul>
          </div>

          <h3 className="font-black mt-4 mb-2">🎯 Tier summary</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs md:text-sm border-2 border-ink">
              <thead className="bg-sun text-ink">
                <tr>
                  <th className="text-left p-2">Your read</th>
                  <th className="text-left p-2">Yardage range</th>
                  <th className="text-left p-2">Turnover roll</th>
                </tr>
              </thead>
              <tbody className="bg-cream">
                <tr className="border-t-2 border-ink">
                  <td className="p-2 font-black">❌ Wrong parent</td>
                  <td className="p-2">+5 to +25 (offense auto-wins)</td>
                  <td className="p-2">—</td>
                </tr>
                <tr className="border-t-2 border-ink/40">
                  <td className="p-2">🟡 Right parent, wrong sub</td>
                  <td className="p-2">+1 to +8</td>
                  <td className="p-2">5%</td>
                </tr>
                <tr className="border-t-2 border-ink/40">
                  <td className="p-2 font-black">✅ Perfect read</td>
                  <td className="p-2">+1 to +10 (or offense loss)</td>
                  <td className="p-2">25%</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        {/* === SCORING === */}
        <section className="panel-flash">
          <div className="panel-titlebar">
            <span>6 · Scoring &amp; Win Condition</span>
            <span className="text-xs">First to 3 by 2</span>
          </div>
          <ul className="text-sm space-y-1 pl-4 list-disc">
            <li>
              <strong>Touchdown (TD)</strong> = reach the opponent's end zone.{' '}
              <span className="chip">+1</span>
            </li>
            <li>
              <strong>Field goal (FG)</strong> = made kick.{' '}
              <span className="chip">+0.5</span>
            </li>
            <li>
              <strong>Safety</strong> = tackled in your own end zone.{' '}
              <span className="chip">+0.5</span> to the defense.
            </li>
            <li>
              <strong>Win:</strong> leader has <span className="chip">≥ 3</span>{' '}
              AND leads by <span className="chip">≥ 2</span>. Half-points mean
              scores can be 2.5 vs 1.
            </li>
          </ul>
        </section>

        {/* === AUDIBLES CHEAT SHEET === */}
        <section className="panel-flash">
          <div className="panel-titlebar">
            <span>7 · Audibles Cheat Sheet</span>
            <span className="text-xs">Per possession</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs md:text-sm border-2 border-ink">
              <thead className="bg-sun text-ink">
                <tr>
                  <th className="text-left p-2">Who</th>
                  <th className="text-left p-2">What it does</th>
                  <th className="text-left p-2">Limit</th>
                </tr>
              </thead>
              <tbody className="bg-cream">
                <tr className="border-t-2 border-ink">
                  <td className="p-2">Offense <strong>Real Audible</strong></td>
                  <td className="p-2">
                    Flips sub (inside↔outside, deep↔short). Parent unchanged.
                  </td>
                  <td className="p-2">1 per possession (refreshable via QB)</td>
                </tr>
                <tr className="border-t-2 border-ink/40">
                  <td className="p-2">Offense <strong>Fake Audible</strong></td>
                  <td className="p-2">
                    <em>Looks</em> like a real audible but actually plays the
                    original sub. Burns the defense's counter.
                  </td>
                  <td className="p-2">1 per possession (refreshable via QB)</td>
                </tr>
                <tr className="border-t-2 border-ink/40">
                  <td className="p-2">Defense <strong>Counter-Audible</strong></td>
                  <td className="p-2">
                    Only allowed if offense audibles or fakes. Flips the
                    defense's own sub.
                  </td>
                  <td className="p-2">1 per audible round</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-xs text-ink/70 mt-2">
            Audibles can't be used on punt/FG (no sub to flip).
          </p>
        </section>

        {/* === FOOTER NAV === */}
        <div className="space-y-3 pt-2">
          <Link
            to="/create"
            className="btn-flash btn-xtra btn-primary w-full text-center"
          >
            Create Game →
          </Link>
          <Link
            to="/join"
            className="btn-flash btn-xtra btn-cool w-full text-center"
          >
            Join Game →
          </Link>
          <Link
            to="/"
            className="btn-flash w-full text-center"
          >
            ← Back to Home
          </Link>
        </div>

        <p className="text-center text-xs text-cream/70 pt-2">
          Quick rules reference — built into the game itself.
        </p>
      </div>
    </div>
  );
}