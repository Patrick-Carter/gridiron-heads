import { flipSubtype, mulberry32 } from '@gridiron/shared';
import type { Play, PlayOutcome, PlayResult } from '@gridiron/shared';

export type { PlayOutcome } from '@gridiron/shared';

export const PLAY_TICKS = 96;
export const PLAY_DURATION_MS = 3_200;

export type SpriteRole =
  | 'QB'
  | 'RB'
  | 'WR'
  | 'TE'
  | 'OL'
  | 'DL'
  | 'LB'
  | 'CB'
  | 'S'
  | 'K'
  | 'P'
  | 'H'
  | 'LS'
  | 'G';

export type SpritePose =
  | 'stance'
  | 'run1'
  | 'run2'
  | 'block'
  | 'dive'
  | 'down'
  | 'throw'
  | 'catch'
  | 'kick';

export type SpriteFacing = 'offense' | 'defense';
export type TeamSide = 'offense' | 'defense';

export interface PlayAnimationResult extends Partial<PlayResult> {
  seed: number;
  yards: number;
  off_call: Play;
}

export interface PlayerSprite {
  id: string;
  role: SpriteRole;
  team: 0 | 1;
  side: TeamSide;
  slot: number;
  /** Yards from the LOS, positive toward the offense's target end zone. */
  xOffset: number;
  /** Normalized sideline-to-sideline position. */
  y: number;
  pose: SpritePose;
  facing: SpriteFacing;
}

export interface BallState {
  xOffset: number;
  y: number;
  /** 0 is on the turf/held, 1 is the apex of a long kick. */
  height: number;
  visible: boolean;
  /** Rotation in turns, useful for a pixel-sprite renderer. */
  spin: number;
  carrierId?: string;
}

export type EffectType =
  | 'snap'
  | 'handoff'
  | 'block'
  | 'throw'
  | 'catch'
  | 'kick'
  | 'impact'
  | 'dust'
  | 'loose_ball'
  | 'bounce'
  | 'whistle';

export interface PlayEffect {
  tick: number;
  type: EffectType;
  xOffset: number;
  y: number;
  intensity: number;
}

export interface OutcomeBanner {
  text: string;
  tone: 'good' | 'bad' | 'neutral';
  fromTick: number;
}

export interface PlayFrame {
  tick: number;
  progress: number;
  players: PlayerSprite[];
  ball: BallState;
  effects: PlayEffect[];
  banner?: OutcomeBanner;
}

export interface PlayPlan {
  seed: number;
  tickCount: typeof PLAY_TICKS;
  durationMs: typeof PLAY_DURATION_MS;
  possessionIdx: 0 | 1;
  offenseTeam: 0 | 1;
  defenseTeam: 0 | 1;
  effectiveCall: Play;
  outcome: PlayOutcome;
  /** The only movement value that should be committed to game state. */
  authoritativeAdvance: number;
  frames: PlayFrame[];
  effects: PlayEffect[];
  banner?: OutcomeBanner;
}

interface BasePlayer extends Omit<PlayerSprite, 'xOffset' | 'y' | 'pose' | 'facing'> {
  x: number;
  baseY: number;
}

interface PlanFlavor {
  laneY: number;
  targetSlot: number;
  targetY: number;
  returnY: number;
  returnDistance: number;
  fumbleX: number;
  bounceY: number;
  missSide: -1 | 1;
}

interface FrameContext {
  result: PlayAnimationResult;
  call: Play;
  outcome: PlayOutcome;
  roster: BasePlayer[];
  flavor: PlanFlavor;
  events: PlayEffect[];
  banner?: OutcomeBanner;
}

const clamp = (n: number, min: number, max: number): number => Math.max(min, Math.min(max, n));
const lerp = (a: number, b: number, t: number): number => a + (b - a) * clamp(t, 0, 1);
const phase = (tick: number, from: number, to: number): number => clamp((tick - from) / (to - from), 0, 1);
const smooth = (t: number): number => {
  const n = clamp(t, 0, 1);
  return n * n * (3 - 2 * n);
};
const precision = (n: number): number => Math.round(n * 1_000) / 1_000;
const runPose = (tick: number): SpritePose => Math.floor(tick / 4) % 2 === 0 ? 'run1' : 'run2';

function id(side: TeamSide, role: SpriteRole, slot: number): string {
  return `${side === 'offense' ? 'o' : 'd'}-${role.toLowerCase()}-${slot}`;
}

function addPlayer(
  players: BasePlayer[],
  side: TeamSide,
  team: 0 | 1,
  role: SpriteRole,
  slot: number,
  x: number,
  y: number,
): void {
  players.push({ id: id(side, role, slot), role, team, side, slot, x, baseY: y });
}

function standardRoster(offenseTeam: 0 | 1, defenseTeam: 0 | 1, jitter: number[]): BasePlayer[] {
  const p: BasePlayer[] = [];
  addPlayer(p, 'offense', offenseTeam, 'QB', 0, -4.5, 0.5);
  addPlayer(p, 'offense', offenseTeam, 'RB', 0, -7.5, 0.53);
  [0.38, 0.44, 0.5, 0.56, 0.62].forEach((y, slot) => addPlayer(p, 'offense', offenseTeam, 'OL', slot, 0, y));
  addPlayer(p, 'offense', offenseTeam, 'WR', 0, -1.5, 0.12 + jitter[0]);
  addPlayer(p, 'offense', offenseTeam, 'WR', 1, -1.5, 0.88 + jitter[1]);
  addPlayer(p, 'offense', offenseTeam, 'WR', 2, -2, 0.72 + jitter[2]);
  addPlayer(p, 'offense', offenseTeam, 'TE', 0, -0.5, 0.29 + jitter[3]);

  [0.41, 0.47, 0.53, 0.59].forEach((y, slot) => addPlayer(p, 'defense', defenseTeam, 'DL', slot, 0.8, y));
  [0.34, 0.5, 0.66].forEach((y, slot) => addPlayer(p, 'defense', defenseTeam, 'LB', slot, 4, y));
  addPlayer(p, 'defense', defenseTeam, 'CB', 0, 5.5, 0.12 + jitter[4]);
  addPlayer(p, 'defense', defenseTeam, 'CB', 1, 5.5, 0.88 + jitter[5]);
  addPlayer(p, 'defense', defenseTeam, 'S', 0, 10, 0.35 + jitter[6]);
  addPlayer(p, 'defense', defenseTeam, 'S', 1, 10, 0.65 + jitter[7]);
  return p;
}

function puntRoster(offenseTeam: 0 | 1, defenseTeam: 0 | 1): BasePlayer[] {
  const p: BasePlayer[] = [];
  addPlayer(p, 'offense', offenseTeam, 'LS', 0, 0, 0.5);
  [0.39, 0.445, 0.555, 0.61, 0.67].forEach((y, slot) => addPlayer(p, 'offense', offenseTeam, 'OL', slot, 0, y));
  addPlayer(p, 'offense', offenseTeam, 'P', 0, -14, 0.5);
  addPlayer(p, 'offense', offenseTeam, 'G', 0, -2, 0.08);
  addPlayer(p, 'offense', offenseTeam, 'G', 1, -2, 0.92);
  addPlayer(p, 'offense', offenseTeam, 'TE', 0, -1, 0.3);
  addPlayer(p, 'offense', offenseTeam, 'TE', 1, -1, 0.75);

  [0.35, 0.41, 0.47, 0.53, 0.59, 0.65].forEach((y, slot) => addPlayer(p, 'defense', defenseTeam, 'DL', slot, 0.8, y));
  [0.25, 0.5, 0.75].forEach((y, slot) => addPlayer(p, 'defense', defenseTeam, 'LB', slot, 3.5, y));
  addPlayer(p, 'defense', defenseTeam, 'CB', 0, 12, 0.16);
  addPlayer(p, 'defense', defenseTeam, 'CB', 1, 12, 0.84);
  return p;
}

function fieldGoalRoster(offenseTeam: 0 | 1, defenseTeam: 0 | 1): BasePlayer[] {
  const p: BasePlayer[] = [];
  addPlayer(p, 'offense', offenseTeam, 'LS', 0, 0, 0.5);
  [0.33, 0.385, 0.44, 0.56, 0.615, 0.67, 0.725].forEach((y, slot) => addPlayer(p, 'offense', offenseTeam, 'OL', slot, 0, y));
  addPlayer(p, 'offense', offenseTeam, 'H', 0, -7, 0.5);
  addPlayer(p, 'offense', offenseTeam, 'K', 0, -10, 0.43);
  addPlayer(p, 'offense', offenseTeam, 'TE', 0, -0.5, 0.275);

  [0.33, 0.385, 0.44, 0.5, 0.56, 0.615, 0.67].forEach((y, slot) => addPlayer(p, 'defense', defenseTeam, 'DL', slot, 0.8, y));
  [0.22, 0.5, 0.78].forEach((y, slot) => addPlayer(p, 'defense', defenseTeam, 'LB', slot, 3, y));
  addPlayer(p, 'defense', defenseTeam, 'S', 0, 8, 0.5);
  return p;
}

function makeSprite(base: BasePlayer): PlayerSprite {
  return {
    id: base.id,
    role: base.role,
    team: base.team,
    side: base.side,
    slot: base.slot,
    xOffset: base.x,
    y: base.baseY,
    pose: 'stance',
    facing: base.side,
  };
}

function setSprite(
  sprite: PlayerSprite,
  x: number,
  y: number,
  pose: SpritePose,
  facing: SpriteFacing = sprite.facing,
): void {
  sprite.xOffset = precision(x);
  sprite.y = precision(clamp(y, 0.04, 0.96));
  sprite.pose = pose;
  sprite.facing = facing;
}

function sprite(players: PlayerSprite[], side: TeamSide, role: SpriteRole, slot: number): PlayerSprite {
  const found = players.find((p) => p.side === side && p.role === role && p.slot === slot);
  if (!found) throw new Error(`Missing animation sprite: ${side} ${role} ${slot}`);
  return found;
}

function movingBall(x: number, y: number, height: number, spin: number, carrierId?: string): BallState {
  return {
    xOffset: precision(x),
    y: precision(clamp(y, 0.02, 0.98)),
    height: precision(clamp(height, 0, 1)),
    visible: true,
    spin: precision(spin),
    ...(carrierId ? { carrierId } : {}),
  };
}

export function effectiveOffensiveCall(result: Pick<PlayAnimationResult, 'off_call' | 'off_audible' | 'effective_off_call'>): Play {
  if (result.effective_off_call) return { ...result.effective_off_call };
  if (result.off_audible) return flipSubtype(result.off_call);
  return { ...result.off_call };
}

export function inferPlayOutcome(result: PlayAnimationResult, call = effectiveOffensiveCall(result)): PlayOutcome {
  if (result.play_outcome) return result.play_outcome;
  const recap = (result.text_recap ?? '').toUpperCase();
  if (call.parent === 'punt') return recap.includes('BLOCK') ? 'punt_blocked' : 'punt';
  if (call.parent === 'fg') {
    if (recap.includes('BLOCK')) return 'field_goal_blocked';
    return result.scoring_event === 'fg' || recap.includes('GOOD')
      ? 'field_goal_good'
      : 'field_goal_missed';
  }
  if (result.scoring_event === 'td') return call.parent === 'pass' ? 'pass_complete' : 'run';
  if (result.scoring_event === 'safety') return call.parent === 'pass' ? 'pass_sack' : 'run';
  if (call.parent === 'pass') {
    if (recap.includes('SACK')) return 'pass_sack';
    if (result.turnover) return 'interception';
    if (result.yards === 0 || recap.includes('INCOMPLETE')) return 'pass_incomplete';
    return 'pass_complete';
  }
  return result.turnover ? 'fumble' : 'run';
}

function makeBanner(result: PlayAnimationResult, outcome: PlayOutcome): OutcomeBanner | undefined {
  if (result.scoring_event === 'td') return { text: 'TOUCHDOWN!', tone: 'good', fromTick: 76 };
  if (result.scoring_event === 'safety') return { text: 'SAFETY!', tone: 'bad', fromTick: 72 };
  const banners: Partial<Record<PlayOutcome, [string, OutcomeBanner['tone']]>> = {
    fumble: ['FUMBLE!', 'bad'],
    pass_incomplete: ['INCOMPLETE', 'neutral'],
    pass_sack: ['SACK!', 'bad'],
    interception: ['INTERCEPTION!', 'bad'],
    punt_blocked: ['PUNT BLOCKED!', 'bad'],
    field_goal_good: ['FIELD GOAL GOOD!', 'good'],
    field_goal_missed: ['NO GOOD', 'bad'],
    field_goal_blocked: ['KICK BLOCKED!', 'bad'],
  };
  if (result.turnover_on_downs || (result.text_recap ?? '').toUpperCase().includes('TURNOVER ON DOWNS')) {
    return { text: 'TURNOVER ON DOWNS', tone: 'bad', fromTick: 74 };
  }
  const value = banners[outcome];
  return value ? { text: value[0], tone: value[1], fromTick: 74 } : undefined;
}

function makeEvents(result: PlayAnimationResult, call: Play, outcome: PlayOutcome, f: PlanFlavor): PlayEffect[] {
  const events: PlayEffect[] = [{ tick: 4, type: 'snap', xOffset: 0, y: 0.5, intensity: 0.5 }];
  if (call.parent === 'run') {
    events.push({ tick: 19, type: 'handoff', xOffset: -3.2, y: f.laneY, intensity: 0.55 });
    events.push({ tick: 12, type: 'block', xOffset: 0.4, y: 0.44, intensity: 0.5 });
    events.push({ tick: 25, type: 'block', xOffset: 0.8, y: 0.56, intensity: 0.6 });
    events.push({ tick: 38, type: 'block', xOffset: 1, y: f.laneY, intensity: 0.72 });
    if (outcome === 'fumble') {
      events.push({ tick: 61, type: 'impact', xOffset: f.fumbleX, y: f.laneY, intensity: 1 });
      events.push({ tick: 61, type: 'dust', xOffset: f.fumbleX, y: f.laneY, intensity: 0.9 });
      events.push({ tick: 62, type: 'loose_ball', xOffset: f.fumbleX, y: f.laneY, intensity: 1 });
      events.push({ tick: 68, type: 'bounce', xOffset: f.fumbleX + 1.2, y: f.bounceY, intensity: 0.8 });
    } else {
      events.push({ tick: 78, type: 'impact', xOffset: result.yards, y: f.laneY, intensity: 0.7 });
      events.push({ tick: 78, type: 'dust', xOffset: result.yards, y: f.laneY, intensity: 0.6 });
    }
  } else if (call.parent === 'pass') {
    const release = call.sub === 'deep' ? 42 : 34;
    events.push({ tick: 13, type: 'block', xOffset: -0.3, y: 0.42, intensity: 0.48 });
    events.push({ tick: 25, type: 'block', xOffset: -1, y: 0.57, intensity: 0.58 });
    events.push({ tick: 37, type: 'block', xOffset: -1.8, y: 0.5, intensity: 0.66 });
    if (outcome === 'pass_sack') {
      events.push({ tick: 56, type: 'impact', xOffset: result.yards, y: 0.5, intensity: 1 });
    } else {
      events.push({ tick: release, type: 'throw', xOffset: call.sub === 'deep' ? -8 : -6, y: 0.5, intensity: 0.5 });
      if (outcome === 'pass_incomplete') {
        events.push({ tick: call.sub === 'deep' ? 70 : 61, type: 'bounce', xOffset: Math.max(5, result.yards + 8), y: f.targetY, intensity: 0.6 });
      } else {
        const catchX = outcome === 'interception'
          ? call.sub === 'deep' ? 18 : 9
          : Math.max(0, result.yards - Math.min(8, Math.max(0, result.yards * 0.4)));
        events.push({ tick: call.sub === 'deep' ? 68 : 58, type: 'catch', xOffset: catchX, y: f.targetY, intensity: 0.75 });
        events.push({ tick: 84, type: 'impact', xOffset: result.yards, y: f.targetY, intensity: 0.8 });
      }
    }
  } else if (call.parent === 'punt') {
    events.push({ tick: 12, type: 'block', xOffset: 0.5, y: 0.43, intensity: 0.55 });
    events.push({ tick: 22, type: 'block', xOffset: 0.8, y: 0.58, intensity: 0.68 });
    events.push({ tick: 30, type: outcome === 'punt_blocked' ? 'impact' : 'kick', xOffset: -13, y: 0.5, intensity: 0.9 });
    if (outcome === 'punt_blocked') events.push({ tick: 39, type: 'bounce', xOffset: -2, y: f.bounceY, intensity: 1 });
  } else {
    events.push({ tick: 10, type: 'block', xOffset: 0.4, y: 0.41, intensity: 0.58 });
    events.push({ tick: 20, type: 'block', xOffset: 0.7, y: 0.59, intensity: 0.72 });
    events.push({ tick: 28, type: outcome === 'field_goal_blocked' ? 'impact' : 'kick', xOffset: -7, y: 0.5, intensity: 0.9 });
    if (outcome === 'field_goal_blocked') events.push({ tick: 38, type: 'bounce', xOffset: -1, y: f.bounceY, intensity: 1 });
  }
  events.push({ tick: 92, type: 'whistle', xOffset: result.yards, y: 0.5, intensity: 0.35 });
  return events.sort((a, b) => a.tick - b.tick);
}

function animateRun(ctx: FrameContext, tick: number, players: PlayerSprite[]): BallState {
  const { result, outcome, flavor } = ctx;
  const laneY = flavor.laneY;
  const outside = ctx.call.sub === 'outside';
  const handoff = smooth(phase(tick, 7, 20));
  const advance = smooth(phase(tick, 18, 78));

  const qb = sprite(players, 'offense', 'QB', 0);
  const rb = sprite(players, 'offense', 'RB', 0);
  setSprite(qb, lerp(-4.5, -2.8, handoff), lerp(0.5, laneY, handoff), tick >= 17 && tick <= 21 ? 'throw' : runPose(tick));

  let carrierX = advance < 0.01 ? lerp(-7.5, -3.1, handoff) : lerp(-3.1, result.yards, advance);
  let carrierY = lerp(0.53, laneY, handoff);
  if (outside) carrierY += Math.sin(advance * Math.PI) * (laneY < 0.5 ? -0.055 : 0.055);
  if (outcome === 'fumble') carrierX = lerp(-3.1, flavor.fumbleX, smooth(phase(tick, 18, 61)));
  setSprite(rb, carrierX, carrierY, tick > 80 || (outcome === 'fumble' && tick >= 62) ? 'down' : runPose(tick));

  players.filter((p) => p.side === 'offense' && p.role === 'OL').forEach((p, i) => {
    const lineForce = result.line_regime === 'dominate' ? 2.6 : result.line_regime === 'lean' ? 1.8 : 1.1;
    const push = result.line_winner === 'offense'
      ? lineForce
      : result.line_winner === 'defense'
        ? -lineForce * 0.7
        : result.yards >= 0 ? 1.1 : -0.7;
    setSprite(p, lerp(0, push, smooth(phase(tick, 8, 42))), lerp(p.y, laneY + (i - 2) * 0.035, 0.3), tick < 8 ? 'stance' : 'block');
  });
  players.filter((p) => p.side === 'offense' && (p.role === 'WR' || p.role === 'TE')).forEach((p) => {
    setSprite(p, lerp(p.xOffset, 4 + p.slot, smooth(phase(tick, 8, 48))), p.y, tick < 10 ? 'stance' : 'block');
  });

  players.filter((p) => p.side === 'defense').forEach((p, i) => {
    const readPenalty = !result.parent_match ? 12 : !result.sub_match ? 5 : 0;
    const delay = (p.role === 'DL' ? 8 : p.role === 'LB' ? 18 : 28) + readPenalty;
    const chase = smooth(phase(tick, delay, 82));
    const stagger = ((i % 3) - 1) * 0.035;
    setSprite(p, lerp(p.xOffset, carrierX + 0.35 + (i % 4) * 0.22, chase), lerp(p.y, carrierY + stagger, chase), tick > 76 && i === 4 ? 'dive' : runPose(tick));
  });

  if (outcome === 'fumble' && tick >= 62) {
    const loose = phase(tick, 62, 72);
    const recover = phase(tick, 72, 91);
    const recoverer = sprite(players, 'defense', 'LB', flavor.targetSlot % 3);
    const looseX = lerp(flavor.fumbleX, flavor.fumbleX + 1.2, loose);
    const looseY = lerp(carrierY, flavor.bounceY, loose);
    const returnX = flavor.fumbleX - flavor.returnDistance;
    if (tick >= 72) {
      setSprite(recoverer, lerp(looseX, returnX, smooth(recover)), lerp(looseY, flavor.returnY, recover), runPose(tick), 'defense');
      return movingBall(recoverer.xOffset, recoverer.y, 0, tick / 5, recoverer.id);
    }
    return movingBall(looseX, looseY, Math.sin(loose * Math.PI) * 0.25, tick / 3);
  }

  if (tick < 11) {
    const snap = phase(tick, 4, 11);
    return movingBall(lerp(0, qb.xOffset, snap), lerp(0.5, qb.y, snap), Math.sin(snap * Math.PI) * 0.12, tick / 3);
  }
  return tick < 19
    ? movingBall(qb.xOffset, qb.y, 0, 0, qb.id)
    : movingBall(rb.xOffset, rb.y, 0, tick / 12, rb.id);
}

function animatePass(ctx: FrameContext, tick: number, players: PlayerSprite[]): BallState {
  const { result, outcome, flavor, call } = ctx;
  const deep = call.sub === 'deep';
  const releaseTick = deep ? 42 : 34;
  const catchTick = deep ? 68 : 58;
  const qbDrop = deep ? -8 : -6;
  const qb = sprite(players, 'offense', 'QB', 0);
  const routeRoles: Array<[SpriteRole, number]> = [['WR', 0], ['WR', 1], ['WR', 2], ['TE', 0]];
  const targetRole: SpriteRole = flavor.targetSlot === 3 ? 'TE' : 'WR';
  const targetSlot = flavor.targetSlot === 3 ? 0 : flavor.targetSlot;
  const target = sprite(players, 'offense', targetRole, targetSlot);
  const targetIndex = flavor.targetSlot;
  const completed = outcome === 'pass_complete';
  const route = smooth(phase(tick, 8, catchTick));
  const yacEnd = result.yards;
  const yac = result.yards <= 0
    ? 0
    : deep
      ? Math.min(8, result.yards * 0.3)
      : Math.min(10, result.yards * 0.45);
  const catchX = outcome === 'interception'
    ? (deep ? 18 : 9)
    : outcome === 'pass_incomplete'
      ? Math.max(deep ? 14 : 6, result.yards + 8)
      : result.yards - (result.yards >= 0 ? yac : 0);

  setSprite(qb, lerp(-4.5, qbDrop, smooth(phase(tick, 7, releaseTick - 5))), 0.5,
    tick >= releaseTick - 3 && outcome !== 'pass_sack' ? 'throw' : tick < 8 ? 'stance' : runPose(tick));

  players.filter((p) => p.side === 'offense' && p.role === 'OL').forEach((p, i) => {
    const lineDepth = result.line_regime === 'dominate'
      ? result.line_winner === 'offense' ? 0.35 : -1.35
      : result.line_winner === 'defense' ? -0.8 : -0.5;
    const pocketX = lineDepth - Math.abs(i - 2) * 0.18;
    setSprite(p, lerp(0, pocketX, smooth(phase(tick, 8, 35))), p.y + (i - 2) * 0.004, tick < 8 ? 'stance' : 'block');
  });
  players.filter((p) => p.side === 'defense' && p.role === 'DL').forEach((p, i) => {
    const rushDepth = result.line_regime === 'dominate' && result.line_winner === 'offense'
      ? -0.5
      : result.line_regime === 'dominate' && result.line_winner === 'defense'
        ? -4
        : -2.4;
    const rushX = outcome === 'pass_sack' && i === flavor.targetSlot % 4 ? result.yards : rushDepth - (i % 2);
    setSprite(p, lerp(0.8, rushX, smooth(phase(tick, 8 + i, outcome === 'pass_sack' ? 55 : 62))), lerp(p.y, 0.5 + (i - 1.5) * 0.035, 0.65), tick > 48 && outcome === 'pass_sack' && i === flavor.targetSlot % 4 ? 'dive' : runPose(tick));
  });

  routeRoles.forEach(([role, slot], index) => {
    const receiver = sprite(players, 'offense', role, slot);
    const isTarget = index === targetIndex;
    const sign = receiver.y < 0.5 ? -1 : 1;
    const routeDistance = deep ? 25 - index * 2 : 8 + index * 1.5;
    let x = lerp(receiver.xOffset, isTarget ? catchX : routeDistance, route);
    let y = lerp(receiver.y, isTarget ? flavor.targetY : clamp(receiver.y + sign * (deep ? 0.035 : -0.12), 0.07, 0.93), route);
    let pose: SpritePose = tick < 8 ? 'stance' : runPose(tick);
    if (isTarget && completed && tick >= catchTick) {
      const afterCatch = smooth(phase(tick, catchTick, 84));
      x = lerp(catchX, yacEnd, afterCatch);
      y = lerp(flavor.targetY, flavor.returnY, afterCatch * 0.35);
      pose = tick <= catchTick + 3 ? 'catch' : tick >= 85 ? 'down' : runPose(tick);
    } else if (isTarget && tick >= catchTick - 2 && tick <= catchTick + 3) {
      pose = outcome === 'pass_incomplete' ? 'dive' : 'catch';
    }
    setSprite(receiver, x, y, pose);
  });

  players.filter((p) => p.side === 'defense' && p.role !== 'DL').forEach((p, i) => {
    const coverIndex = i % routeRoles.length;
    const covered = sprite(players, 'offense', routeRoles[coverIndex][0], routeRoles[coverIndex][1]);
    const coverage = smooth(phase(tick, 10 + i, 70));
    const cushion = result.parent_match ? 0.7 : -2.5;
    setSprite(p, lerp(p.xOffset, covered.xOffset + cushion, coverage), lerp(p.y, covered.y + (i % 2 ? 0.025 : -0.025), coverage), runPose(tick));
  });

  if (outcome === 'pass_sack') {
    const sack = smooth(phase(tick, 40, 56));
    setSprite(qb, lerp(qbDrop, result.yards, sack), 0.5, tick >= 56 ? 'down' : runPose(tick));
    return movingBall(qb.xOffset, qb.y, 0, tick / 10, qb.id);
  }

  if (outcome === 'interception') {
    const defenderRole: SpriteRole = flavor.targetSlot % 2 === 0 ? 'CB' : 'S';
    const defender = sprite(players, 'defense', defenderRole, flavor.targetSlot % 2);
    const arrive = smooth(phase(tick, 18, catchTick));
    setSprite(defender, lerp(defender.xOffset, catchX, arrive), lerp(defender.y, flavor.targetY, arrive), tick >= catchTick - 2 && tick <= catchTick + 3 ? 'catch' : runPose(tick));
    if (tick >= catchTick) {
      const returning = smooth(phase(tick, catchTick, 91));
      setSprite(defender, lerp(catchX, catchX - flavor.returnDistance, returning), lerp(flavor.targetY, flavor.returnY, returning), tick <= catchTick + 3 ? 'catch' : runPose(tick), 'defense');
      return movingBall(defender.xOffset, defender.y, 0, tick / 8, defender.id);
    }
  }

  if (tick < 11) {
    const snap = phase(tick, 4, 11);
    return movingBall(lerp(0, qb.xOffset, snap), lerp(0.5, qb.y, snap), Math.sin(snap * Math.PI) * 0.12, tick / 3);
  }
  if (tick < releaseTick) return movingBall(qb.xOffset, qb.y, 0, 0, qb.id);
  const flight = phase(tick, releaseTick, catchTick);
  const ballY = lerp(qb.y, flavor.targetY, flight);
  const ballX = lerp(qb.xOffset, catchX, flight);
  if (tick <= catchTick) return movingBall(ballX, ballY, Math.sin(flight * Math.PI) * (deep ? 0.85 : 0.5), tick / 2.4);

  if (completed) return movingBall(target.xOffset, target.y, 0, tick / 10, target.id);
  if (outcome === 'pass_incomplete') {
    const bounce = phase(tick, catchTick, 80);
    return movingBall(catchX + bounce * 1.5, flavor.targetY + Math.sin(bounce * Math.PI) * 0.025, Math.sin(bounce * Math.PI) * 0.12, tick / 2);
  }
  return movingBall(target.xOffset, target.y, 0, tick / 10, target.id);
}

function animatePunt(ctx: FrameContext, tick: number, players: PlayerSprite[]): BallState {
  const blocked = ctx.outcome === 'punt_blocked';
  players.filter((p) => p.side === 'offense' && (p.role === 'OL' || p.role === 'LS' || p.role === 'TE')).forEach((p) => {
    setSprite(p, lerp(p.xOffset, 1.3, smooth(phase(tick, 5, 28))), p.y, tick < 5 ? 'stance' : 'block');
  });
  players.filter((p) => p.side === 'offense' && p.role === 'G').forEach((p) => {
    setSprite(p, lerp(p.xOffset, ctx.result.yards * 0.72, smooth(phase(tick, 15, 82))), p.y, runPose(tick));
  });
  players.filter((p) => p.side === 'defense').forEach((p, i) => {
    const destination = blocked && i < 2 ? -12 : ctx.result.yards * 0.68 + (i % 3);
    setSprite(p, lerp(p.xOffset, destination, smooth(phase(tick, 7 + i, 84))), lerp(p.y, 0.5 + ((i % 5) - 2) * 0.08, 0.35), blocked && i === 0 && tick > 27 && tick < 38 ? 'dive' : runPose(tick));
  });
  const punter = sprite(players, 'offense', 'P', 0);
  setSprite(punter, -14, 0.5, tick >= 27 && tick <= 34 ? 'kick' : 'stance');

  if (tick < 18) {
    const snap = phase(tick, 4, 18);
    return movingBall(lerp(0, -14, snap), 0.5, Math.sin(snap * Math.PI) * 0.15, tick / 3, tick < 4 ? undefined : punter.id);
  }
  if (tick < 30) return movingBall(-14, 0.5, 0, 0, punter.id);
  if (blocked) {
    const hit = phase(tick, 30, 39);
    const roll = phase(tick, 39, 78);
    return movingBall(lerp(-13, -2 + roll * 2, hit < 1 ? hit : 1), lerp(0.5, ctx.flavor.bounceY, hit), Math.sin((hit < 1 ? hit : roll) * Math.PI) * 0.22, tick / 2);
  }
  const flight = phase(tick, 30, 82);
  return movingBall(lerp(-13, ctx.result.yards, flight), lerp(0.5, ctx.flavor.targetY, flight), Math.sin(flight * Math.PI), tick / 1.7);
}

function animateFieldGoal(ctx: FrameContext, tick: number, players: PlayerSprite[]): BallState {
  const blocked = ctx.outcome === 'field_goal_blocked';
  players.filter((p) => p.side === 'offense' && (p.role === 'OL' || p.role === 'LS' || p.role === 'TE')).forEach((p) => {
    setSprite(p, lerp(p.xOffset, 0.7, smooth(phase(tick, 5, 25))), p.y, tick < 5 ? 'stance' : 'block');
  });
  players.filter((p) => p.side === 'defense').forEach((p, i) => {
    setSprite(p, lerp(p.xOffset, blocked && i === 3 ? -5 : -0.8, smooth(phase(tick, 5 + (i % 3), 34))), lerp(p.y, 0.5 + ((i % 5) - 2) * 0.045, 0.5), blocked && i === 3 && tick > 25 && tick < 36 ? 'dive' : runPose(tick));
  });
  const holder = sprite(players, 'offense', 'H', 0);
  const kicker = sprite(players, 'offense', 'K', 0);
  setSprite(holder, -7, 0.5, tick >= 16 ? 'down' : 'stance');
  setSprite(kicker, lerp(-10, -7.7, smooth(phase(tick, 12, 28))), lerp(0.43, 0.48, phase(tick, 12, 28)), tick >= 25 && tick <= 32 ? 'kick' : tick < 12 ? 'stance' : runPose(tick));

  if (tick < 16) {
    const snap = phase(tick, 4, 16);
    return movingBall(lerp(0, -7, snap), 0.5, Math.sin(snap * Math.PI) * 0.1, tick / 3, tick < 4 ? undefined : holder.id);
  }
  if (tick < 28) return movingBall(-7, 0.5, 0, 0, holder.id);
  if (blocked) {
    const hit = phase(tick, 28, 38);
    const roll = phase(tick, 38, 76);
    return movingBall(lerp(-7, -1 + roll * 1.5, hit < 1 ? hit : 1), lerp(0.5, ctx.flavor.bounceY, hit), Math.sin((hit < 1 ? hit : roll) * Math.PI) * 0.25, tick / 2);
  }
  const flight = phase(tick, 28, 88);
  const kickDistance = clamp(ctx.result.fg_total ?? 38, 18, 55);
  const endY = ctx.outcome === 'field_goal_missed' ? (ctx.flavor.missSide < 0 ? 0.06 : 0.94) : 0.5;
  return movingBall(lerp(-7, kickDistance, flight), lerp(0.5, endY, smooth(flight)), Math.sin(flight * Math.PI) * 0.95, tick / 1.5);
}

function buildFrame(ctx: FrameContext, tick: number): PlayFrame {
  const players = ctx.roster.map(makeSprite);
  let ball: BallState;
  if (ctx.call.parent === 'run') ball = animateRun(ctx, tick, players);
  else if (ctx.call.parent === 'pass') ball = animatePass(ctx, tick, players);
  else if (ctx.call.parent === 'punt') ball = animatePunt(ctx, tick, players);
  else ball = animateFieldGoal(ctx, tick, players);
  if (tick < 4) players.forEach((player) => { player.pose = 'stance'; });
  const effects = ctx.events.filter((event) => event.tick === tick);
  return {
    tick,
    progress: tick / (PLAY_TICKS - 1),
    players,
    ball,
    effects,
    ...(ctx.banner && tick >= ctx.banner.fromTick ? { banner: ctx.banner } : {}),
  };
}

export function buildPlayPlan(result: PlayAnimationResult, possessionIdx: 0 | 1): PlayPlan {
  const call = effectiveOffensiveCall(result);
  const outcome = inferPlayOutcome(result, call);
  const rng = mulberry32(result.seed);
  const offenseTeam = possessionIdx;
  const defenseTeam = possessionIdx === 0 ? 1 : 0;
  const outsideSign: -1 | 1 = rng() < 0.5 ? -1 : 1;
  const flavor: PlanFlavor = {
    laneY: call.sub === 'outside' ? (outsideSign < 0 ? 0.22 : 0.78) : 0.46 + rng() * 0.08,
    targetSlot: Math.floor(rng() * 4),
    targetY: 0.14 + rng() * 0.72,
    returnY: 0.25 + rng() * 0.5,
    returnDistance: 6 + Math.floor(rng() * 9),
    fumbleX: result.yards + (rng() - 0.5) * 2,
    bounceY: 0.32 + rng() * 0.36,
    missSide: rng() < 0.5 ? -1 : 1,
  };
  const jitter = Array.from({ length: 8 }, () => (rng() - 0.5) * 0.012);
  const roster = call.parent === 'punt'
    ? puntRoster(offenseTeam, defenseTeam)
    : call.parent === 'fg'
      ? fieldGoalRoster(offenseTeam, defenseTeam)
      : standardRoster(offenseTeam, defenseTeam, jitter);
  const banner = makeBanner(result, outcome);
  const effects = makeEvents(result, call, outcome, flavor);
  const context: FrameContext = { result, call, outcome, roster, flavor, events: effects, banner };
  const frames = Array.from({ length: PLAY_TICKS }, (_, tick) => buildFrame(context, tick));
  return {
    seed: result.seed,
    tickCount: PLAY_TICKS,
    durationMs: PLAY_DURATION_MS,
    possessionIdx,
    offenseTeam,
    defenseTeam,
    effectiveCall: call,
    outcome,
    authoritativeAdvance: result.yards,
    frames,
    effects,
    ...(banner ? { banner } : {}),
  };
}

/** Selects a fixed simulation tick; there is intentionally no interpolation. */
export function frameAt(plan: PlayPlan, progress: number): PlayFrame {
  const safeProgress = Number.isFinite(progress) ? clamp(progress, 0, 1) : 0;
  return plan.frames[Math.round(safeProgress * (plan.frames.length - 1))];
}

/** Returns every event crossed since the prior rendered tick. RAF commonly
 * skips simulation ticks, but sound cues must still fire exactly once. */
export function effectsBetween(
  effects: PlayEffect[],
  previousTick: number,
  currentTick: number,
): PlayEffect[] {
  return effects.filter((effect) => effect.tick > previousTick && effect.tick <= currentTick);
}
