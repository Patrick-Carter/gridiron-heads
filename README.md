# Gridiron Heads

> 2-player head-to-head browser football. Draft asymmetric position groups, then play
> simultaneous scheme picks with turn-based audibles. First to 3 (win by 2).

Built with React + TypeScript + Tailwind on the front, Node + Express + Socket.IO +
SQLite on the back. Game logic is shared pure TypeScript in `@gridiron/shared` so
both client and server use the same types and resolvers.

## Quick start

```bash
# install
npm install

# dev — server :3000, client :5173 (Vite proxy to :3000 for /api + /socket.io)
npm run dev

# tests (106 tests across all workspaces)
npm test

# prod build
npm run build
npm start            # serves client dist + API from one process on :3000

# cleanup stale sessions (7+ days old) — run via cron
node --import tsx scripts/cleanup_sessions.ts
```

## How to play

1. **Create** — Open <http://localhost:5173>, click "Create Game", enter a name.
2. **Share** — Copy the share URL. Open it in a second browser window/incognito.
3. **Lobby** — Both players click "Ready".
4. **Coin flip** — Server flips; one player picks first in the draft.
5. **Draft** — 12 alternating picks. On your turn you can pick ANY unpicked group
   (QB, D_LINE, O_LINE, OFF_SKILL, DEF_SKILL, KICKER). First to pick removes the
   option from the shared pool. All 6 groups + all pool options are visible to both
   players at all times.
6. **Game** — Each play:
   - **Scheme pick** — Both players simultaneously pick a play (Run/Pass/Punt/FG)
     + sub-type (inside/outside for run, deep/short for pass). After both commit, the
     offense sees the defense's call.
   - **Audibles** — Turn-based. Offense may flip sub-type (1 real + 1 fake per
     possession). Defense may only audible in response to an offense audible/fake.
     Audibles not allowed on punt/FG.
   - **Snap** — Offense clicks SNAP; server resolves with seeded RNG.
   - **Result** — Animated canvas + text recap. Last play can be replayed.
   - **Auto-advance** — Server auto-transitions play_anim → between_plays → awaiting_schemes
     over 4.5s. Both players see the game flow without clicking.

**Yardage tiers** (defense accuracy matters):
- Full match (parent + sub): offense gains 1..10 yds
- Parent match, sub mismatch: 1..8 yds (defense had the right idea)
- Parent mismatch: 5..25 yds (defense out of position)

**Turnover chance:** full match 25%, parent-only 5%, mismatch 0%.

**Win condition:** first to **3 points**, must **win by ≥2**. Field goals = 0.5 each.

## Architecture

```
shared/   # @gridiron/shared — pure TS game logic (RNG, draft, kicker, resolver, scoring)
server/   # @gridiron/server — Express + Socket.IO + SQLite
client/   # @gridiron/client — Vite + React + Tailwind
```

- **Server-authoritative.** All RNG seeded from per-play seed → replays are
  byte-identical.
- **Real-time.** Socket.IO rooms per session; both players see state diffs as they
  happen.
- **Persistence.** SQLite (`./server/data/gridiron.db`) — sessions auto-expire 7 days
  after last activity (run `scripts/cleanup_sessions.ts` via cron).

## Tech stack

- **Backend**: Node 22 + Express 4 + Socket.IO 4 + better-sqlite3 + nanoid + TypeScript 5
- **Frontend**: Vite 5 + React 18 + TypeScript 5 + Tailwind 3 + Socket.IO client 4
- **Rendering**: raw Canvas 2D API for the play field
- **Testing**: Vitest — 106 tests across 12 files

## Agent / contributor notes

See `AGENTS.md` for the durable context future agents need (architecture rules,
bug history, things-not-to-do).

See `DECISIONS.md` for the append-only decision log (D-NNN format).

## File map

| Path | Purpose |
|---|---|
| `shared/src/types.ts` | All game types (Play, GameState, TeamState, PlayResult, etc.) |
| `shared/src/rng.ts` | mulberry32 + d100/d21 rolls |
| `shared/src/draft.ts` | Position group pair generation + 25% gap cap |
| `shared/src/qb_pool.ts` | 22-QB pool (buffs only per D26), draw-3 per draft |
| `shared/src/kicker.ts` | 2-roll FG resolver (power + bonus ∈ [0,20]) |
| `shared/src/play_resolver.ts` | Skill roll + turnover + tiered yardage + yard-clamp |
| `shared/src/scoring.ts` | Win-by-2 + 0.5 increment math |
| `shared/src/game_state.ts` | Downs, distance, ball spot (negative yards increase distance) |
| `server/src/routes/sessions.ts` | HTTP `/api/sessions` create/join/get |
| `server/src/socket/handlers.ts` | All Socket.IO event handlers |
| `server/src/socket/game_machine.ts` | Server-authoritative state machine + auto-advance |
| `client/src/screens/*.tsx` | Home / Create / Join / Lobby / CoinFlip / Draft / Game / GameOver |
| `client/src/components/*.tsx` | Field (canvas) / SchemePicker / AudiblePanel / ScorePanel / PlayLog |
| `client/src/hooks/useSession.ts` | Single source of truth React hook for socket state |