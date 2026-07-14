import { describe, expect, it } from 'vitest';
import { newGameState } from '@gridiron/shared';
import type {
  ActiveSkillId,
  PositionGroup,
  PositionOption,
  QBOption,
  TeamState,
} from '@gridiron/shared';
import {
  addPlayer,
  newRoom,
  playActiveSkill,
  passActiveSkill,
  respondActiveSkill,
  resolveCurrentPlay,
  resolveShootoutKick,
  snapshot,
} from '../src/socket/game_machine.js';
import type { RoomState } from '../src/socket/game_machine.js';

function position(group: Exclude<PositionGroup, 'QB'>, active_skill?: ActiveSkillId): PositionOption {
  return { id: `${group}-player`, group, skill: 75, name: `${group} Player`, active_skill };
}

function quarterback(active_skill?: ActiveSkillId): QBOption {
  return {
    id: 'QB-player',
    group: 'QB',
    name: 'QB Player',
    modifier: { stat: 'off_skill_pct', value: 1, scope: 'all_plays' },
    active_skill,
  };
}

function team(): TeamState {
  return {
    qb: quarterback(),
    d_line: position('D_LINE'),
    o_line: position('O_LINE'),
    off_skill: position('OFF_SKILL'),
    def_skill: position('DEF_SKILL'),
    kicker: position('KICKER'),
  };
}

function setCard(teamState: TeamState, group: PositionGroup, skill: ActiveSkillId): void {
  if (group === 'QB') teamState.qb = quarterback(skill);
  else if (group === 'D_LINE') teamState.d_line = position(group, skill);
  else if (group === 'O_LINE') teamState.o_line = position(group, skill);
  else if (group === 'OFF_SKILL') teamState.off_skill = position(group, skill);
  else if (group === 'DEF_SKILL') teamState.def_skill = position(group, skill);
  else teamState.kicker = position(group, skill);
}

function readyRoom(): RoomState {
  const room = newRoom('active-test', 'host', 'Host');
  addPlayer(room, 'guest', 'Guest');
  room.game = newGameState(room.session_id, [team(), team()]);
  room.game.phase = 'ready_to_snap';
  room.game.possession_idx = 0;
  room.pending_schemes = {
    host: { parent: 'run', sub: 'inside' },
    guest: { parent: 'pass', sub: 'deep' },
  };
  return room;
}

function reason(result: { ok: true } | { ok: false; reason: string }): string | null {
  return result.ok ? null : result.reason;
}

describe('playActiveSkill validation and persistence', () => {
  it('exports active-card state on new rooms and snapshots', () => {
    const room = newRoom('active-test', 'host', 'Host');
    expect(room.active_card_chain).toBeNull();
    expect(snapshot(room).active_card_chain).toBeNull();
    expect(playActiveSkill).toBeTypeOf('function');
    expect(respondActiveSkill).toBeTypeOf('function');
  });

  it('rejects missing games, unknown players, wrong phases, and the defense', () => {
    const noGame = newRoom('active-test', 'host', 'Host');
    expect(reason(playActiveSkill(noGame, 'host', 'QB'))).toBe('no_game');

    const room = readyRoom();
    setCard(room.game!.teams[0], 'QB', 'field_general');
    expect(reason(playActiveSkill(room, 'stranger', 'QB'))).toBe('unknown_player');
    room.game!.phase = 'awaiting_schemes';
    expect(reason(playActiveSkill(room, 'host', 'QB'))).toBe('not_ready_to_snap');
    room.game!.phase = 'ready_to_snap';
    expect(reason(playActiveSkill(room, 'guest', 'QB'))).toBe('not_offense');
  });

  it('derives the card from the player roster and enforces play eligibility', () => {
    const room = readyRoom();
    setCard(room.game!.teams[0], 'QB', 'field_general');
    setCard(room.game!.teams[0], 'D_LINE', 'pin_ears_back');
    setCard(room.game!.teams[0], 'KICKER', 'big_leg');

    expect(reason(playActiveSkill(room, 'host', 'D_LINE'))).toBe('card_not_eligible');
    expect(reason(playActiveSkill(room, 'host', 'KICKER'))).toBe('card_not_eligible');
    const played = playActiveSkill(room, 'host', 'QB');
    expect(played).toEqual({ ok: true, skill: 'field_general' });
    expect(room.active_card_chain).toEqual({
      offense: 'field_general',
      defense: null,
      suppressed: null,
    });
  });

  it('requires a current call and an owned active skill', () => {
    const noCall = readyRoom();
    setCard(noCall.game!.teams[0], 'QB', 'field_general');
    delete noCall.pending_schemes.host;
    expect(reason(playActiveSkill(noCall, 'host', 'QB'))).toBe('no_current_play');

    const noCard = readyRoom();
    expect(reason(playActiveSkill(noCard, 'host', 'QB'))).toBe('no_active_skill');
  });

  it('spends a card once for the whole game and does not reset it after resolution', () => {
    const room = readyRoom();
    setCard(room.game!.teams[0], 'OFF_SKILL', 'breakaway_speed');
    expect(playActiveSkill(room, 'host', 'OFF_SKILL')).toEqual({
      ok: true,
      skill: 'breakaway_speed',
    });
    expect(room.game!.active_skills_used[0]).toEqual(['breakaway_speed']);

    resolveCurrentPlay(room, 11);
    expect(room.active_card_chain).toBeNull();
    expect(room.game!.active_skills_used[0]).toEqual(['breakaway_speed']);

    room.game!.phase = 'ready_to_snap';
    room.game!.possession_idx = 0;
    room.pending_schemes = {
      host: { parent: 'run', sub: 'inside' },
      guest: { parent: 'pass', sub: 'deep' },
    };
    expect(reason(playActiveSkill(room, 'host', 'OFF_SKILL'))).toBe('active_skill_used');
  });

  it('does not permit a second offense card in the same chain', () => {
    const room = readyRoom();
    setCard(room.game!.teams[0], 'QB', 'field_general');
    setCard(room.game!.teams[0], 'OFF_SKILL', 'breakaway_speed');
    playActiveSkill(room, 'host', 'QB');
    room.game!.phase = 'ready_to_snap';
    expect(reason(playActiveSkill(room, 'host', 'OFF_SKILL'))).toBe('card_already_played');
    expect(room.game!.active_skills_used[0]).toEqual(['field_general']);
  });

  it('allows only the current kicker and a KICKER card in a shootout', () => {
    const room = readyRoom();
    setCard(room.game!.teams[0], 'KICKER', 'ice_water');
    setCard(room.game!.teams[1], 'KICKER', 'big_leg');
    room.game!.phase = 'shootout_ready';
    room.game!.shootout = {
      round: 1,
      distance: 25,
      first_kicker_idx: 0,
      next_kicker_idx: 0,
      round_attempts: [null, null],
      attempts: [],
    };

    expect(reason(playActiveSkill(room, 'guest', 'KICKER'))).toBe('not_your_kick');
    expect(reason(playActiveSkill(room, 'host', 'QB'))).toBe('card_not_eligible');
    expect(playActiveSkill(room, 'host', 'KICKER')).toEqual({ ok: true, skill: 'ice_water' });
    const resolved = resolveShootoutKick(room, 0, 3);
    expect(resolved.ok).toBe(true);
    if (resolved.ok) expect(resolved.result.off_active_skill).toBe('ice_water');
    expect(room.active_card_chain).toBeNull();
  });

  it('rejects punt-only and block-only kicker cards in a shootout', () => {
    for (const skill of ['coffin_corner', 'quick_punt', 'perfect_hold'] as const) {
      const room = readyRoom();
      setCard(room.game!.teams[0], 'KICKER', skill);
      room.game!.phase = 'shootout_ready';
      room.game!.shootout = {
        round: 1,
        distance: 25,
        first_kicker_idx: 0,
        next_kicker_idx: 0,
        round_attempts: [null, null],
        attempts: [],
      };
      expect(reason(playActiveSkill(room, 'host', 'KICKER'))).toBe('card_not_eligible');
      expect(room.game!.active_skills_used[0]).toEqual([]);
    }
  });
});

describe('respondActiveSkill and Quick Counter precedence', () => {
  it('gives defense priority and a card play even when offense passes', () => {
    const room = readyRoom();
    setCard(room.game!.teams[1], 'D_LINE', 'collapse_pocket');

    expect(passActiveSkill(room, 'host')).toEqual({ ok: true });
    expect(room.game!.phase).toBe('awaiting_card_response');
    expect(room.active_card_chain?.offense).toBeNull();
    expect(respondActiveSkill(room, 'guest', 'D_LINE')).toEqual({
      ok: true,
      skill: 'collapse_pocket',
    });
    expect(room.game!.phase).toBe('card_chain_complete');
    expect(room.game!.active_skills_used[1]).toEqual(['collapse_pocket']);
  });

  it('never lets an offensive card suppress the defensive response', () => {
    const room = readyRoom();
    setCard(room.game!.teams[0], 'QB', 'coverage_decoder');
    setCard(room.game!.teams[1], 'D_LINE', 'pin_ears_back');

    playActiveSkill(room, 'host', 'QB');
    respondActiveSkill(room, 'guest', 'D_LINE');

    expect(room.active_card_chain).toEqual({
      offense: 'coverage_decoder',
      defense: 'pin_ears_back',
      suppressed: null,
    });
  });

  it('rejects the wrong phase, offense player, missing card, and spent response', () => {
    const wrongPhase = readyRoom();
    expect(reason(respondActiveSkill(wrongPhase, 'guest', null))).toBe('not_awaiting_card_response');

    const room = readyRoom();
    setCard(room.game!.teams[0], 'QB', 'field_general');
    setCard(room.game!.teams[1], 'DEF_SKILL', 'run_fits');
    playActiveSkill(room, 'host', 'QB');
    expect(room.game!.phase).toBe('awaiting_card_response');
    expect(reason(respondActiveSkill(room, 'host', null))).toBe('not_defense');
    expect(reason(respondActiveSkill(room, 'guest', 'D_LINE'))).toBe('no_active_skill');

    room.game!.active_skills_used[1].push('run_fits');
    expect(reason(respondActiveSkill(room, 'guest', 'DEF_SKILL'))).toBe('active_skill_used');
  });

  it('lets defense pass without spending a card and keeps the chain for result metadata', () => {
    const room = readyRoom();
    setCard(room.game!.teams[0], 'QB', 'field_general');
    setCard(room.game!.teams[1], 'DEF_SKILL', 'run_fits');
    playActiveSkill(room, 'host', 'QB');

    expect(respondActiveSkill(room, 'guest', null)).toEqual({ ok: true, skill: null });
    expect(room.game!.phase).toBe('card_chain_complete');
    expect(room.game!.active_skills_used[1]).toEqual([]);
    expect(room.active_card_chain).toEqual({
      offense: 'field_general',
      defense: null,
      suppressed: null,
    });

    const { result } = resolveCurrentPlay(room, 13);
    expect(result.off_active_skill).toBe('field_general');
    expect(result.def_active_skill).toBeNull();
    expect(result.suppressed_active_skill).toBeNull();
    expect(room.active_card_chain).toBeNull();
  });

  it.each([
    {
      offenseGroup: 'O_LINE' as const,
      offenseSkill: 'pancake_block' as const,
      defenseGroup: 'D_LINE' as const,
      defenseSkill: 'line_stunt' as const,
      suppressed: 'pancake_block' as const,
    },
    {
      offenseGroup: 'QB' as const,
      offenseSkill: 'field_general' as const,
      defenseGroup: 'DEF_SKILL' as const,
      defenseSkill: 'film_study' as const,
      suppressed: 'field_general' as const,
    },
    {
      offenseGroup: 'OFF_SKILL' as const,
      offenseSkill: 'breakaway_speed' as const,
      defenseGroup: 'DEF_SKILL' as const,
      defenseSkill: 'film_study' as const,
      suppressed: 'breakaway_speed' as const,
    },
  ])('resolves $offenseSkill against $defenseSkill with explicit suppression precedence', ({
    offenseGroup,
    offenseSkill,
    defenseGroup,
    defenseSkill,
    suppressed,
  }) => {
    const room = readyRoom();
    setCard(room.game!.teams[0], offenseGroup, offenseSkill);
    setCard(room.game!.teams[1], defenseGroup, defenseSkill);
    expect(playActiveSkill(room, 'host', offenseGroup).ok).toBe(true);
    expect(respondActiveSkill(room, 'guest', defenseGroup)).toEqual({ ok: true, skill: defenseSkill });
    expect(room.active_card_chain).toEqual({
      offense: offenseSkill,
      defense: defenseSkill,
      suppressed,
    });
    expect(room.game!.active_skills_used).toEqual([[offenseSkill], [defenseSkill]]);
  });

  it('records both committed cards and suppression, then clears the chain after the play', () => {
    const room = readyRoom();
    setCard(room.game!.teams[0], 'QB', 'field_general');
    setCard(room.game!.teams[1], 'DEF_SKILL', 'film_study');
    playActiveSkill(room, 'host', 'QB');
    respondActiveSkill(room, 'guest', 'DEF_SKILL');

    const { result } = resolveCurrentPlay(room, 17);
    expect(result.off_active_skill).toBe('field_general');
    expect(result.def_active_skill).toBe('film_study');
    expect(result.suppressed_active_skill).toBe('field_general');
    expect(room.active_card_chain).toBeNull();
    expect(room.pending_schemes).toEqual({});
    expect(room.game!.active_skills_used).toEqual([['field_general'], ['film_study']]);
  });
});

describe('server-applied special-team cards', () => {
  it('Perfect Hold prevents a seeded field-goal block', () => {
    let blockSeed: number | null = null;
    for (let seed = 1; seed <= 500 && blockSeed === null; seed++) {
      const baseline = readyRoom();
      baseline.game!.ball_yardline = 99;
      baseline.game!.teams[0].kicker = position('KICKER');
      baseline.game!.teams[0].kicker.skill = 100;
      baseline.pending_schemes = {
        host: { parent: 'fg', sub: 'inside' },
        guest: { parent: 'fg', sub: 'inside' },
      };
      const result = resolveCurrentPlay(baseline, seed).result;
      if (result.play_outcome === 'field_goal_blocked' && (result.fg_total ?? 0) > 1) blockSeed = seed;
    }
    expect(blockSeed).not.toBeNull();

    const protectedKick = readyRoom();
    protectedKick.game!.ball_yardline = 99;
    setCard(protectedKick.game!.teams[0], 'KICKER', 'perfect_hold');
    protectedKick.game!.teams[0].kicker!.skill = 100;
    protectedKick.pending_schemes = {
      host: { parent: 'fg', sub: 'inside' },
      guest: { parent: 'fg', sub: 'inside' },
    };
    expect(playActiveSkill(protectedKick, 'host', 'KICKER').ok).toBe(true);
    const result = resolveCurrentPlay(protectedKick, blockSeed!).result;
    expect(result.play_outcome).toBe('field_goal_good');
    expect(result.off_active_skill).toBe('perfect_hold');
    expect(protectedKick.active_card_chain).toBeNull();
  });

  it('Coffin Corner adds ten net punt yards before the receiving-five cap', () => {
    const makePuntRoom = (withCard: boolean) => {
      const room = readyRoom();
      room.game!.ball_yardline = 25;
      if (withCard) setCard(room.game!.teams[0], 'KICKER', 'coffin_corner');
      room.pending_schemes = {
        host: { parent: 'punt', sub: 'inside' },
        guest: { parent: 'run', sub: 'inside' },
      };
      if (withCard) playActiveSkill(room, 'host', 'KICKER');
      return room;
    };

    const baseline = resolveCurrentPlay(makePuntRoom(false), 41).result;
    const boosted = resolveCurrentPlay(makePuntRoom(true), 41).result;
    expect(boosted.yards).toBe(baseline.yards + 10);
    expect(boosted.off_active_skill).toBe('coffin_corner');
  });
});
