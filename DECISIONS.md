# Decision log

Append-only. Each entry: `D-NNN — YYYY-MM-DD — title`. Status field:
PROPOSED / ACCEPTED / SUPERSEDED.

---

## D001 — 2026-07-04 — Node + Express + Socket.IO + SQLite (ACCEPTED)
**Decision:** Build on Node 20 + Express 4 + Socket.IO 4 + better-sqlite3 + TypeScript.
**Rationale:** User picked this over FastAPI + WebRTC. Real-time requirements (simul-
reveal scheme picks) match Socket.IO's room model exactly; better-sqlite3 is sync + zero-
config for a 2-player game.
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
**Rationale:** Buffs the kicker stat without eliminating variance. Even a low-power
kicker (50) can occasionally hit long FGs with lucky 20-bonus. Even a high-power kicker
(100) misses short FGs with low rolls.

## D005 — 2026-07-04 — QB modifiers are BUFFS only (ACCEPTED)
**Decision:** No QB in the pool has a negative modifier on the player's own team. Every
QB brings strictly positive effects (`+X% off_skill`, `+Y kicker_power`, `-Z% turnover`,
etc.).
**Rationale:** Future-proofs against feel-bad trap picks. Pool still feels diverse via
combinations of stat × scope.

## D006 — 2026-07-04 — 3 QBs per draft, pool of 22 (ACCEPTED)
**Decision:** Pool of 22 unique QBs; each draft randomly draws 3.
**Rationale:** 22 is large enough to feel fresh across multiple drafts; 3 keeps the
draft tractable.

## D007 — 2026-07-04 — Hybrid timing: simultaneous pick + turn-based audibles (ACCEPTED)
**Decision:** Initial parent + sub scheme pick is simultaneous (both online). Once both
commit, audibles are turn-based (offense picks first, defense responds, then snap).
**Rationale:** Scheme reveal is the strategic core — both players must commit before
seeing the other. Audibles are reactive — they layer onto the locked-in scheme.

## D008 — 2026-07-04 — Audibles flip sub-type only (ACCEPTED)
**Decision:** Offense audible can only flip sub-type (deep↔short, inside↔outside).
Never parent type. Defense audibles same constraint, AND only allowed in response to
offense audible or offense fake audible.
**Rationale:** Audible = mid-play adjustment, not full re-pick.

## D009 — 2026-07-04 — Fake audible as separate consumable (ACCEPTED)
**Decision:** Offense has 1 real audible + 1 fake audible per possession. Fake does NOT
change the play call — only appears to the defense that something happened. Defense may
burn their audible responding to a fake. Defense doesn't learn it was fake until play
resolves.
**Rationale:** Bluff mechanic adds a strategic layer. Separate consumable from real
audible so offenses have to choose carefully.

## D010 — 2026-07-04 — No kickoffs (ACCEPTED)
**Decision:** Standard possessions start at the 25-yard line. Turnover-driven possessions
start at the spot of the turnover. Made FGs → opponent gets ball at their 25.
**Rationale:** Eliminates a play type entirely. Simplifies the game.

## D011 — 2026-07-04 — Turnover mechanics (ACCEPTED)
**Decision:** Turnover chance = 25% when defense matches parent AND sub correctly, 5%
when parent-only. Turnover spot = where the play ended (yardline_before + yards).

## D012 — 2026-07-04 — Skill roll mechanic (ACCEPTED)
**Decision:** Each side rolls `Math.random() * skill` (0 ≤ roll ≤ skill). Higher wins.
Skill range: 50–100.
**Rationale:** High-skill teams win more, low-skill teams have upset potential. Matches
the user's locked mechanic.

## D013 — 2026-07-04 — 25% gap cap at draft generation (ACCEPTED)
**Decision:** For each position group's two options, regenerate the pair if
`(max - min) / max > 0.25`. Ensures no draft option is auto-pick vs junk.
**Rationale:** Keeps the draft interesting — no obvious "must-pick" because the better
option is always within 25% of the worse one.

## D014 — 2026-07-04 — 4 downs, 10 yards (ACCEPTED)
**Decision:** Standard NFL downs structure. 4 downs to gain 10 yards.

## D015 — 2026-07-04 — All plays available on every down (ACCEPTED)
**Decision:** Punt/FG available on 1st-3rd down. Strategic choice, not enforced.
**Rationale:** Adds tension. Coach can go for it on 4th-and-1 with a Run Inside.

## D016 — 2026-07-04 — Server-authoritative, seeded RNG (ACCEPTED)
**Decision:** All RNG flows through mulberry32 with a per-play seed. Server holds the
canonical state. Replays re-run the same seed → byte-identical animation + recap.
**Rationale:** Eliminates "did the animation lie about what happened?" disputes. The
last-play seed is stored in GameState.last_play_seed; client can replay by re-running
the animation loop with the stored seed.

---

## Open assumptions (flagged for future review)

| # | Assumption |
|---|---|
| A1 | Tie in skill roll = 0 yards, no turnover. (Plan default.) |
| A2 | Parent-only match → 5% turnover; parent+sub → 25%. (Interpretation of plan text.) |
| A3 | `yards_pct` modifier is multiplicative on post-roll yards. |
| A4 | Loss of yards on sack/TFL capped at -4 (avoids safety spirals). |
| A5 | Player names shown as entered; no auth. |
| A6 | Replay = last play only; cleared on next play resolve. |
| A7 | `/join/:sessionId` URL pattern shows the join screen pre-filled. |

## Deferred (not in v1)
- User accounts / login
- League / season play / ELO rating
- Replay library (per-session history of past plays)
- Mobile-first redesign
- Sound effects / commentary
- More than 2 players (would need schema rework)
- Disconnect handling (forfeit / pause)