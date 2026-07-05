# Decision log

Append-only. Each entry: `D-NNN — YYYY-MM-DD — title`. Status field:
PROPOSED / ACCEPTED / SUPERSEDED.

---

## D001 — 2026-07-04 — Node + Express + Socket.IO + SQLite (ACCEPTED)
**Decision:** Build on Node 20 + Express 4 + Socket.IO 4 + better-sqlite3 + TypeScript.
**Rationale:** User picked this over FastAPI + WebRTC. Real-time requirements (simul-
reveal scheme picks) match Socket.IO's room model exactly; better-sqlite3 is sync +
zero-config for a 2-player game.
**Alternatives:** FastAPI + WebSockets, FastAPI + WebRTC peer-to-peer.

## D002 — 2026-07-04 — Vite + React + TS + Tailwind monorepo (ACCEPTED)
**Decision:** Frontend is Vite-served React SPA, not vanilla HTML/JS. Monorepo with 3
workspaces (`shared`, `server`, `client`).
**Rationale:** Multi-screen state (lobby → coin → draft → game → gameover) is tractable in
React. Vite gives instant HMR + trivial proxy for /api and /socket.io. Tailwind kills
bespoke-CSS churn. TS shared between client/server eliminates "server says X, client
expects Y" drift.

## D003 — 2026-07-04 — Field goal = 0.5 points, win-by-2 (ACCEPTED)
**Decision:** FG = 0.5; win condition = first to 3 with ≥2-point lead. Accept half-point
arithmetic.
**Rationale:** User-locked during clarification. Creates interesting score math
(0.5 + 0.5 + 0.5 = 1.5) without fractional real numbers.

## D004 — 2026-07-04 — Kicker 2-roll mechanic (power + bonus) (ACCEPTED)
**Decision:** Every FG = `power_roll + bonus_roll > yards_to_endzone`.
- `power_roll` = uniform [0, power_used] (scaled by QB modifier, clamped [1, 100])
- `bonus_roll` = uniform [0, 20], universal — no QB scaling, no stat, no per-kicker variance
**Rationale:** Buffs the kicker stat without eliminating variance.

## D005 — 2026-07-04 — QB modifiers are BUFFS only (ACCEPTED)
**Decision:** No QB in the pool has a negative modifier on the player's own team.
**Rationale:** Future-proofs against feel-bad trap picks.

## D006 — 2026-07-04 — 3 QBs per draft, pool of 22 (ACCEPTED)
**Decision:** Pool of 22 unique QBs; each draft randomly draws 3.

## D007 — 2026-07-04 — Hybrid timing: simultaneous pick + turn-based audibles (ACCEPTED)
**Decision:** Scheme pick is simultaneous (both online). Audibles are turn-based
(offense picks first, defense responds, then snap).

## D008 — 2026-07-04 — Audibles flip sub-type only (ACCEPTED)
**Decision:** Audibles flip only the sub-type (deep↔short, inside↔outside). Never parent.
Defense audibles only in response to offense audible/fake.
**Plus:** No audibles allowed on punt/FG — server validates.

## D009 — 2026-07-04 — Fake audible as separate consumable (ACCEPTED)
**Decision:** 1 real audible + 1 fake audible per possession. Fake does NOT change
the play call — only appears to the defense that something happened.

## D010 — 2026-07-04 — No kickoffs (ACCEPTED)
**Decision:** Standard possessions start at the 25-yard line.

## D011 — 2026-07-04 — Turnover mechanics (ACCEPTED)
**Decision:** Turnover chance = 25% when defense matches parent AND sub correctly,
5% when parent-only. Turnover spot = where the play ended.
**Plus (added later):** Turnover-on-downs: 4th down + insufficient yards → flip
possession, fresh 1st & 10 at the spot.

## D012 — 2026-07-04 — Skill roll mechanic (ACCEPTED, later refined)
**Decision (original):** Each side rolls `Math.random() * skill` (0 ≤ roll ≤ skill). Higher
wins.
**Refinement (D012.a):** When defense guesses wrong parent, the offense auto-wins
(defense is out of position, can't stop reliably). Match-parent uses fair roll.

## D013 — 2026-07-04 — 25% gap cap at draft generation (ACCEPTED)
**Decision:** Pair's gap must be ≤25% or the pair is regenerated.

## D014 — 2026-07-04 — 4 downs, 10 yards (ACCEPTED)
**Decision:** Standard NFL downs structure.
**Refinement:** Negative yards INCREASE distance (NFL rule):
- 2nd & 10 → lose 3 → 3rd & 13 (not 3rd & 10)
- 2nd & 10 → gain 3 → 3rd & 7
- Positive yards reduce distance; negative yards increase it

## D015 — 2026-07-04 — All plays available on every down (ACCEPTED)
**Decision:** Punt/FG available on 1st-3rd down. Strategic choice, not enforced.

## D016 — 2026-07-04 — Server-authoritative, seeded RNG (ACCEPTED)
**Decision:** All RNG flows through mulberry32 with a per-play seed. Server holds the
canonical state. Replays re-run the same seed → byte-identical animation + recap.

## D017 — 2026-07-04 — Free-group alternating-turn draft (ACCEPTED, replaces strict turn-based)
**Decision (original):** Strict turn-based with each turn locked to a specific group.
**Refinement:** Alternating turns (12 picks, player 0 on even turns, player 1 on odd),
but on each turn the picker chooses ANY unpicked group. Both players see ALL groups +
ALL pool options at all times. Each group visible to one player only when that
player's team hasn't taken it yet.

## D018 — 2026-07-04 — Tiered yardage by match quality (ACCEPTED)
**Decision:** Yardage depends on how well defense read the play:
- Full match (parent + sub): 1..10 yds gain, -1..-4 loss
- Parent match, sub mismatch: 1..8 yds gain, -1..-4 loss
- Parent mismatch: 5..25 yds gain, -1..-2 loss

**Rationale:** Original 2-tier (match/mismatch) was too rewarding when defense got
parent right but sub wrong. User feedback drove the 3-tier split.

## D019 — 2026-07-04 — Yardage clamped at remaining distance to end zone (ACCEPTED)
**Decision:** After computing raw yards (including yards_pct modifiers), clamp:
- Positive gains: ≤ (100 - yardline_before)
- Negative gains: ≥ -(yardline_before)
**Rationale:** A +20 gain from the 75 left the ball at 95 with "Gain of 20" — impossible.

## D020 — 2026-07-04 — Yardline always right-driven (ACCEPTED)
**Decision:** Both teams always attack right toward yardline 100. The canvas never
mirrors. `DIRECTION = 1` hardcoded in Field.tsx. `offense_direction = 1` always in
PlayResult.
**Rationale:** Tried mirroring the canvas when team 1 attacked left (ctx.scale(-1, 1))
— produced unfixable bugs in lineup positions, label placement, LOS marker direction.
Reverted to always-right. Simpler, less buggy.

## D021 — 2026-07-04 — Auto-advance flow (no Next Play click) (ACCEPTED)
**Decision:** Server chains two setTimeouts per snap:
- 2s after snap: play_anim → between_plays
- 4.5s after snap: between_plays → awaiting_schemes
**Rationale:** Defense doesn't need to click anything. Game flows automatically.
"Sky wait" button is optional fast-forward only.

## D022 — 2026-07-04 — Scoring flash priority (ACCEPTED)
**Decision:** When displaying scoring events on the canvas, check scoring_event
BEFORE turnover: `fg > safety > td > turnover`.
**Rationale:** Server sets `turnover: true` on ANY change of possession (TD, safety,
turnover-on-downs, defensive turnover). The flash logic must check scoring_event
first or every scoring play will also flash "TURNOVER!".

## D023 — 2026-07-04 — display_name persisted end-to-end (ACCEPTED)
**Decision:** Client saves display_name to localStorage alongside player_id at
session create/join. SessionRouter reads both. useSession passes display_name in the
session:join socket event. Server updates room.players[].name on hydration.

## D024 — 2026-07-04 — Snap handler must not clobber 'ended' phase (ACCEPTED)
**Decision:** In the `game:snap` socket handler, after `resolveCurrentPlay`,
only set `game.phase = 'play_anim'` when the game hasn't just ended. If
`resolveCurrentPlay` transitioned phase to `'ended'` (win condition met),
skip the phase overwrite AND skip the auto-advance `setTimeout` chain.
**Rationale:** Without this guard, every winning play had its `'ended'`
phase silently overwritten back to `'play_anim'`, hiding the win. Both
clients saw a normal animation continue and never rendered `GameOver`.
The bug was masked by the fact that the auto-advance chain kept the game
flowing for one more cycle, scoring another play, etc. — so the win
condition effectively triggered a zombie game. Fixed with a single
`(game.phase as string) === 'ended'` guard.
**Regression test:** `server/tests/e2e.test.ts` → "does NOT clobber ended
phase after a winning play" drives enough snap cycles to potentially end
the game and asserts no broadcast ever violates the win rule (phase
STAYS `'ended'` whenever leader ≥ 3 AND diff ≥ 2).

## D025 — 2026-07-04 — Early-2000s Flash game aesthetic (ACCEPTED)
**Decision:** Theme overhaul. Saturated primary colors (yellow / red /
hi-vis green / electric blue / grape), thick black borders, chunky 4-6px
hard drop shadows, Comic Sans / Trebuchet / pixel fonts, and a starfield
on a deep purple backdrop. Mobile-first: 320px-friendly widths, touch-
target ≥ 48px, stack layouts on small screens, canvas uses
`aspect-ratio` to scale fluidly while keeping pixelated rendering.
**Rationale:** User request: "early 2000s flashgame fun type site".
The original dark/grey Tailwind panels (bg-panel, border-border) traded
character for restraint — replaced with `.panel-flash`, `.btn-flash`,
`.flash-banner` chunky components. Custom CSS in `globals.css` provides
chunky bevel state (`btn-flash:active` lifts by translating shadow),
rotated/wobbling star stickers (`.sticker`, `animate-wobble`), and an
animated radial-gradient starfield body backdrop with a `::before`
twinkling layer.
**Plus:** Body font + panel sizing now adapt at the 480px breakpoint
(`@media (max-width: 480px)` — reduces shadow size + bumps button
min-height to 52px for fat-finger safety). Field canvas dropped the
fixed height + `rounded` border in favor of `aspect-ratio` 2:1 + a
`.field-frame` parent that hosts the chunky border.

## Open assumptions (flagged for future review)
| # | Assumption |
|---|---|
| A1 | Tie in skill roll = 0 yards, no turnover. |
| A2 | Parent-only match → 5% turnover; parent+sub → 25%. |
| A3 | `yards_pct` modifier is multiplicative on post-roll yards. |
| A4 | Loss of yards on sack/TFL capped at -4 (avoids safety spirals). |
| A5 | Player names shown as entered; no auth. |
| A6 | Replay = last play only; cleared on next play resolve. |
| A7 | `/join/:sessionId` URL pattern shows the join screen pre-filled. |
| A8 | Field always renders going right — no mirror mode, no left-drive. |

## Deferred (not in v1)

- User accounts / login
- League / season play / ELO rating
- Replay library (per-session history of past plays)
- Mobile-first redesign
- Sound effects / commentary
- More than 2 players (would need schema rework)
- Disconnect handling (forfeit / pause)
- Left-drive / mirrored field (attempted, reverted — see D020)