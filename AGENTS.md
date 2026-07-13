# AGENTS.md

> Context for any AI agent (or human) working on this repo.
> Read this before touching anything.

## What this is

A 2-player head-to-head browser football game. **Built and shipped — don't rebuild from scratch.**

**Stack:** Node 22 + Express 4 + Socket.IO 4 + better-sqlite3 (server) · Vite 5 + React 18 + Tailwind 3 + Socket.IO client (client) · TypeScript 5 throughout · Vitest for tests. Monorepo via npm workspaces (`shared/`, `server/`, `client/`).

**Game:** Alternating-turn draft (each player on their turn picks ANY unpicked group) → simultaneous scheme pick (both online, then reveal) → turn-based audibles (offense flips sub-type, defense responds only to audible/fake) → snap → resolve with seeded RNG → animated canvas + text recap → auto-advance. Each team gets exactly 4 completed offensive possessions; high score wins, and a tie enters a paired manual FG shootout.

## How to run

```bash
npm install
npm run dev        # server :3000, client :5173 (Vite proxies /api + /socket.io)
npm test           # 300 vitest tests across all workspaces
npm run build      # builds shared, server, client
npm start          # serves client dist + API from server on :3000
```

## Critical rules (from 18 commits of trial-and-error)

These are the things that **will** trip you up if you don't know them:

### 1. Direction model — possession-based, no canvas mirror
- `ball_yardline` is the ABSOLUTE field position (0..100).
- `possession_idx` decides who attacks which end zone:
  - `possession_idx === 0` → offense attacks right toward yardline 100 (`offense_direction = +1`)
  - `possession_idx === 1` → offense attacks left  toward yardline   0 (`offense_direction = -1`)
- After EVERY change of possession (TD, safety, turnover, turnover-on-downs, punt, or FG attempt) the new offense gets a fresh 1st & 10 from the ball's current absolute spot. They attack the OPPOSITE end zone automatically because `offenseDirection` flips with `possession_idx`.
- The canvas is NEVER mirrored (`ctx.scale(-1, 1)` is still banned — it broke labels in D020). Only the `direction` multiplier on `xOffsetYards * YARD` flips sign in the renderer. Labels (LOS, 1ST) are drawn at pixel coords from absolute positions.
- Helpers in `shared/src/game_state.ts`:
  - `offenseDirection(state)` → `+1 | -1`
  - `yardsToEndzone(state)` → 0..100, direction-aware
  - `flipPossession(state)` → flips idx, sets 1st & 10, preserves `ball_yardline`
- The resolver takes `offense_direction` (defaults to `+1` for back-compat) and caps positive/negative yards against the offense's target/own goal line respectively.
- D020 (always-attack-right) is REVERTED. The bug it tried to fix — `ctx.scale(-1, 1)` breaking label/LOS marker direction — is fixed differently: we don't mirror the canvas, we just flip the sign of the x-offset multiplier, which is a pure number-flip and can't break label placement.

### 2. Downs progression bug class
The `resolveCurrentPlay` function MUST compute `next_possession/next_yardline/next_down/next_distance` BEFORE mutating `game`, then apply them all at once. The original bug discarded `advanceAfterPlay`'s return value and never wrote `game.down` back — ball was stuck at 1st & 10 forever. The fixed version lives in `server/src/socket/game_machine.ts` around `run/pass` branch. Don't refactor it without writing tests for:
- Yardage clamps at remaining distance to end zone (a +20 from the 75 is impossible — capped to 25)
- Negative yards INCREASE distance (NFL rule: `next.distance = max(1, state.distance - yards)`, no clamp to old distance)
- 4th down + insufficient yards → turnover-on-downs (flip possession, fresh 1st & 10)

### 3. Yardage by match-quality tier
In `shared/src/play_resolver.ts` the `yards` calculation now has 3 tiers — DO NOT collapse them back into 2:
- Full match (parent + sub): 1..10 gain
- Parent match, sub mismatch: 1..8 gain
- Full mismatch: 5..25 gain

The original "matched = 1..15" was too rewarding when defense guessed run/pass correctly but guessed the wrong sub. User feedback: "if the defense correctly picks the correct play but not the correct sub play, it's still possible for the offense to make yards" — the fix is the tier system above.

### 4. Scoring flash priority
`shared/src/types.ts` `ScoringEvent` is `'td' | 'fg' | 'safety' | null`. The server sets `turnover: true` on ANY change of possession (TD, safety, turnover-on-downs, defensive turnover). **The canvas flash logic MUST check scoring_event BEFORE turnover** or every scoring play will flash "TURNOVER!" too. Priority: `fg > safety > td > turnover`. The flash code lives in `client/src/components/Field.tsx` `drawPlay`.

### 5. Audible system rules
- Offense has **1 real audible + 1 fake audible** per possession
- Audible flips only the sub-type, never the parent
- Defense can only audible **in response to** an offense audible/fake
- Server rejects `game:audible`, `game:fake_audible`, `game:def_audible` on punt/FG (no sub-type to flip)
- Server state for pending audibles lives on `(game as any)._pending_off_audible / _pending_def_audible / _pending_off_fake` (cleared after each play via `clearAudibles`)

### 6. Auto-advance flow (no Next Play click needed)
The snap handler chains TWO `setTimeout`s:
- 2s after snap: `play_anim → between_plays`
- 4.5s after snap: `between_plays → awaiting_schemes`

The client's "Skip wait" button is optional fast-forward. Both players see the game flow automatically — defense doesn't need to click anything. Do NOT remove the setTimeouts or one player gets stuck.

### 7. Client socket: pass display_name
The server's `session:join` handler requires the client to send the joining player's `display_name`. The `useSession` hook must read it from `localStorage` (`gridiron:player_name:<sessionId>`) — `Create.tsx` and `Join.tsx` save it. Without this, the server shows empty player names.

### 8. Session hydration from DB
HTTP `POST /api/sessions` and `/api/sessions/:id/join` write to SQLite. When the WebSocket connects, the `session:join` handler hydrates the in-memory RoomState from the DB row. The `rooms` Map is per-process (cleared on server restart). SQLite persists across restarts.

### 9. Canvas quirks — Field.tsx
- ALWAYS call `ctx.clearRect(0, 0, canvas.width, canvas.height)` when `playResult` becomes null (Next Play button). Otherwise the last frame of the previous animation stays on screen.
- During animation, draw the field at `playResult.yardline_before` (play's starting LOS), NOT at the prop `ballYardline` (which may already be the post-play yardline for TDs/turnovers).
- After animation completes, immediately redraw the static lineups at the NEW `ballYardline` + new `possessionIdx` direction. Don't wait for a re-render.
- The O-Line and D-Line use a tight 8% vertical band centered on `y=0.5` so they form a horizontal line, NOT a vertical column.
- `drawPlayer` size: QB=7px, others=6px. All have a black outline so they stand out against green.
- `FIELD_W=800, FIELD_H=400, YARD=8` (8px per yard). Lines are `0..10` mapped to `0..800` px.

### 10. Audio architecture (all generated via Web Audio API)
- **Single AudioContext**, `initAudio()` once per page (call from any user click). All other modules call into the shared bus.
- **4-channel mix bus** (`client/src/audio/_audioBus.ts`): Master / Music / Crowd / SFX. VolumePanel reads/writes these gains in [0,1]. Persists to localStorage `gridiron:audio_volumes`.
- **Modules**:
  - `_audioBus.ts` — context init, 4 gains, volume API, localStorage persistence. Exposes `__test` for tests.
  - `music.ts` — original looping 16-bit football march (square lead, triangle bass, noise drums) with a lookahead sequencer. Starts after a user gesture and stops when Music is muted.
  - `synth.ts` — ~20 one-shot SFX (snap, thud, TD siren, FG bell/miss, turnover, **UI click, UI hover, scheme select, audible, draft pick, coin flip, possession change, down change, kickoff, victory, defeat, point scored, incomplete pass whistle, error**).
  - `crowd.ts` — `playCrowdRoar(intensity)` one-shot crowd swell + pure `isBigPlay(playResult)` predicate.
- **Background music is user-controlled.** `App.tsx` starts it on the first valid interaction. The Audio panel has an independent Music slider and mute toggle; all pages with `FlashHeader` expose the panel, and the in-game score strip does too.
- **Crowd noise has two layers.** A low looped stadium bed runs only while `Game.tsx` is mounted; animation-timed reactions handle catches/contact and `playCrowdRoar()` handles big plays:
  - Scoring plays (TD/FG/safety) → strongest swells (TD = 1.5, FG/safety = 0.8)
  - Turnovers → 0.8
  - 1st-down conversions OR 20+ yard gains → roar scaled to yardage (0..1.5)
  - Routine plays get the stadium bed plus restrained catch/tackle reactions.
- **Wiring**:
  - `isBigPlay(r)` predicate in `crowd.ts` — Game.tsx checks it before firing the largest `playCrowdRoar`.
  - TD/FG/Safety use their distinctive sting + a delayed crowd roar.
  - Possession change + down change get `playPossessionChange` / `playDownChange`.
  - Global click handler in `App.tsx` fires `playUiClick` on every `.btn-*` press + `playUiHover` on `[data-sfx="hover"]`.
  - `VolumePanel.tsx` (replaces `MuteToggle.tsx`) — speaker toggle + popover with 3 sliders (Music + Crowd + SFX) and a dedicated Music mute. Click speaker = open panel; double-click = master mute.
- **Never** create an `AudioContext` outside `_audioBus.ts`. All sound modules route through `busFor(channel)` / `crowdBus()` so the panel can mute independently.
- **Never** play a sound during render — gate everything in event handlers / useEffect. Web Audio browsers require user-gesture unlock.

### 11. tests — what works, what doesn't
- 300 tests, stable.
- The `inside run vs deep pass` test asserts >80% positive yards — passes because mismatch auto-wins.
- The `low-yard play advances down` test uses MATCHED parents with skill 1 vs 100 because mismatch auto-wins for offense (no negative yards possible).
- The `FG made` test searches seeds 1..200 to find one that produces a make (it doesn't always make).
- The `TD scores 1 point` test searches seeds for one where off_roll 100 > def_roll 50 at yardline 99 — only succeeds on specific seeds.
- The CPU e2e test (`server/tests/cpu_e2e.test.ts`) is **timing-flaky** — it depends on a 5s setTimeout chain in `game_machine.ts`. Re-runs usually pass; if it fails, retry once. None of the audio work touches server code.

### 12. Draft design
- Free-group alternating turns: 12 picks, player 0 picks on even turns, player 1 on odd. On each turn the picker chooses ANY unpicked group.
- Server validates: it's your turn (`pick_order[current_turn]`), you haven't already picked that group, option still in pool.
- Client shows ALL groups + ALL pool options to both players at all times (visibility, not lock-step).
- The "Next" button is gone — replaced with a "Skip wait" fast-forward button + countdown text.
- `pick_order` is the authoritative list; `current_turn` is the index.

### 13. Regulation, shootout, and concession
- Each team gets exactly **4 completed offensive possessions**. A possession ends on TD, safety, turnover, turnover on downs, punt, or any FG attempt (made or missed).
- The higher score after both teams complete all 4 possessions wins.
- A regulation tie enters a paired manual FG shootout. Both teams attempt the same distance each round: 25, 35, 45, 55, 65 yards, then 65 again for every later round.
- One make and one miss decides the game. If both make or both miss, advance to the next round.
- The team with the first regulation possession kicks first in round 1; kicking order alternates each round.
- Drafted kicker skill and QB FG buffs apply in the shootout. There is no defensive call or block attempt. Each make adds 0.5 points.
- Players may concede during the draft, regulation, or shootout.

## What NOT to do

- ❌ Don't mirror the canvas with `ctx.scale(-1, 1)` (broke labels in D020 — reverted). The direction-flip is achieved by multiplying the x-offset by `direction`, not by mirroring.
- ❌ Don't clamp negative-yard distance to the old distance (loses NFL rule).
- ❌ Don't check `result.turnover` first in the scoring flash — always check `scoring_event` first.
- ❌ Don't write `game.down` directly in `resolveCurrentPlay` — always go through `advanceAfterPlay`'s `next` object.
- ❌ Don't show the "Next Play" button as required — game auto-advances.
- ❌ Don't allow audibles on punt/FG — server rejects, client UI should hide them.
- ❌ Don't hardcode yardage ranges in the resolver without considering sub-match tier.
- ❌ Don't draw the O-Line spread across multiple yardlines (vertical column) — keep tight band.
- ❌ Don't hardcode `offense_direction: 1` in PlayResult — derive from `offenseDirection(game)`.
- ❌ Don't reset `ball_yardline = 100 - old` on turnover — the field is absolute now; the direction flip is what changes who drives how far.

## File map

```
shared/src/
  types.ts          # All game types: Play, GameState, TeamState, PlayResult (with offense_direction), QBOption
  rng.ts            # mulberry32 + d100/d21 roll helpers
  draft.ts          # generateDraft (25% cap), drawFromPool, remainingGroups
  qb_pool.ts        # 22 QB pool (buffs-only per D26), drawQBs
  kicker.ts         # 2-roll FG (power + bonus ∈ [0,20])
  play_resolver.ts  # Skill roll + turnover + yardage (TIERED by match quality) + yard-clamp
  scoring.ts        # point math + regulation/shootout winner checks
  game_state.ts     # newGameState, advanceAfterPlay (negative yards increase distance)

server/src/
  index.ts          # Entry — PORT=3000
  app.ts            # createApp + createServer with createApp({db}) factory
  db.ts             # better-sqlite3 init + schema (sessions, session_players)
  routes/sessions.ts # POST /api/sessions, POST /api/sessions/:id/join, GET /api/sessions/:id
  socket/handlers.ts # All Socket.IO events (12 handlers total)
  socket/game_machine.ts # Server-authoritative state machine (resolveCurrentPlay is here)

client/src/
  App.tsx           # BrowserRouter + routes
  api/http.ts       # createSession, joinSession
  api/socket.ts     # getSocket + EVENTS constants
  hooks/useSession.ts # Single source of truth React hook
  screens/
    Home.tsx, Create.tsx, Join.tsx, Lobby.tsx
    SessionRouter.tsx # Decides which screen based on game state
    CoinFlip.tsx     # Coin spin animation (auto-advances)
    Draft.tsx        # Grid of all groups + pool options
    Game.tsx         # Main game screen: field + score + scheme picker + audibles + play log
    GameOver.tsx     # Winner screen
  components/
    Field.tsx        # Canvas: field + lineups + animations + flash text
    SchemePicker.tsx # Parent + sub-type picker
    AudiblePanel.tsx # Audible buttons (real + fake + defensive respond)
    ScorePanel.tsx   # Current scores
    PlayLog.tsx      # Last 5 plays sidebar

scripts/
  cleanup_sessions.ts # Cron: delete sessions inactive >7 days
```

## Security model (Cloudflare Tunnel-era defaults)

The deployment is exposed publicly through a Cloudflare Tunnel (bb.carterhub.net
as of this writing). The server treats every incoming connection as hostile
unless proven otherwise. These rules are non-negotiable — do not soften them
without a security review:

1. **Auth token = identity.** `POST /api/sessions` and `/api/sessions/:id/join`
   return a 256-bit `auth_token` alongside `player_id`. The client persists
   the token to `localStorage` (`gridiron:auth_token:<session_id>`) and sends
   it on `session:join`. The server resolves the token back to
   (session_id, player_id) on every connect — `player_id` from the client
   alone is **never** trusted. This kills impersonation where a 3rd party who
   learned both share-URL + a player's id could submit picks/audibles as them.

2. **Origin allowlist.** `ALLOWED_ORIGINS` env var (comma-separated) gates
   both Express `cors()` and the Socket.IO handshake. Default is
   `https://bb.carterhub.net`. Requests with no `Origin` header (curl,
   bots, server-to-server) are still allowed through so external machines
   can keep connecting.

3. **Rate limits.** 20 req/min/IP on `/api/sessions` (express-rate-limit)
   and 30 socket connects/min/IP via a sliding-window limiter in
   `server/src/security.ts`. Both gate on the actual TCP source — but
   through Cloudflare the limiter counts the `CF-Connecting-IP`, which is
   what `trust proxy` (see below) feeds Express.

4. **`trust proxy` is a function, not a number.** It only trusts hops from
   private/loopback IPs (RFC1918 + RFC4193), so cloudflared over the docker
   bridge is honored but anything claiming to be a public-IP proxy is
   ignored. Spiked in `server/src/security.ts:trustProxyFn`.

5. **`display_name` is sanitized server-side.** Trim + collapse whitespace,
   cap at 32 chars, allow only Unicode letters/marks/digits/punctuation/
   symbols/separators via `normalizeDisplayName` in `server/src/security.ts`.
   Length & char class are enforced — the route ignores whatever the client
   sent.

6. **`maxHttpBufferSize`** on Socket.IO is 64 KB (down from the 1 MB
   default). Game payloads never exceed a few hundred bytes; the cap
   prevents a malicious client from parking large buffers on a long-lived
   socket.

7. **Helmet + CORS + static SPA.** Helmet adds the standard security
   headers (X-Content-Type-Options, X-DNS-Prefetch-Control,
   Referrer-Policy: no-referrer, etc.). CSP is intentionally disabled
   because the SPA + Tailwind combo relies on inline styles that a strict
   CSP would break — we serve only our own bundle, so same-origin policy
   is the defense-in-depth layer there.

8. **In-memory room GC.** `server/src/app.ts:startRoomReaper` drops rooms
   that have had no sockets for 90s. The DB row is the long-term canonical
   state; the in-memory cache is purely transient. `last_activity_at`
   is bumped on every meaningful event.

9. **`GET /api/sessions/:id` is auth-gated.** No Bearer token → summary
   only (phase + player ids, no names/draft/scores/history). With a valid
   token → full state. This stops the endpoint from being a free session
   probe.

## Test command cheat sheet

```bash
# Run all tests (300 expected). The previous `server/tests/cpu_e2e.test.ts` (cpu-vs-human solo end-to-end driver) was retired because it was timing-flaky on the 2s + 4.5s server chain and inconsistent across hosts. The vs-CPU logic is still covered by the per-tick CPU unit tests under `server/tests/cpu.test.ts`.
npx vitest run

# Run a single file
npx vitest run server/tests/game_machine.test.ts

# Run with verbose output
npx vitest run --reporter=verbose

# Run only matching
npx vitest run -t "yards"
```

If tests pass once but flake on rerun, the test is probably probabilistic. Add `for (let s = 1; s < N; s++)` seed-search loops or strengthen the assertion threshold (e.g., `>0.80` instead of `>0.99`).

## Plan / spec

The original implementation plan is at `.hermes/plans/2026-07-04_193753-gridiron-heads-2p-football.md` — useful context for *why* decisions were made, but it doesn't reflect all the bugs we hit during implementation. This AGENTS.md is the post-mortem.
