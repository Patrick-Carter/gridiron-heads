// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import ScorePanel from '../src/components/ScorePanel.js';
import AudiblePanel from '../src/components/AudiblePanel.js';
import ActiveSkillControls from '../src/components/ActiveSkillControls.js';
import RosterModal from '../src/components/RosterModal.js';

const activeTeam: any = {
  qb: { name: 'QB', active_skill: 'field_general' },
  o_line: { name: 'OL', skill: 80, active_skill: 'pancake_block' },
  off_skill: { name: 'Skill', skill: 80, active_skill: 'sure_hands' },
  d_line: { name: 'DL', skill: 80, active_skill: 'pin_ears_back' },
  def_skill: { name: 'Defense', skill: 80, active_skill: 'ball_hawk' },
  kicker: { name: 'K', skill: 80, active_skill: 'big_leg' },
};

describe('ScorePanel', () => {
  it('uses offenseDirection when formatting the ball spot', () => {
    const view = render(
      <ScorePanel
        scores={[0, 0]}
        possessionsCompleted={[1, 2]}
        shootout={null}
        myIdx={0}
        players={[{ id: 'a', name: 'Alpha' }, { id: 'b', name: 'Beta' }]}
        possessionIdx={0}
        down={1}
        distance={10}
        ballYardline={25}
        offenseDirection={1}
        onOpenRoster={() => {}}
      />,
    );

    expect(screen.getByText('at own 25')).toBeTruthy();
    expect(screen.getByTestId('possessions-0').textContent).toContain('1/3');
    expect(screen.getByTestId('possessions-1').textContent).toContain('2/3');

    view.rerender(
      <ScorePanel
        scores={[0, 0]}
        possessionsCompleted={[1, 2]}
        shootout={null}
        myIdx={1}
        players={[{ id: 'a', name: 'Alpha' }, { id: 'b', name: 'Beta' }]}
        possessionIdx={1}
        down={1}
        distance={10}
        ballYardline={25}
        offenseDirection={-1}
        onOpenRoster={() => {}}
      />,
    );

    expect(screen.getByText('at opp 25')).toBeTruthy();
  });
});

describe('AudiblePanel', () => {
  it.each(['punt', 'fg'] as const)('hides offensive audible controls for %s', (parent) => {
    const { container } = render(
      <AudiblePanel
        role="offense"
        phase="ready_to_snap"
        currentPlay={{ parent, sub: 'inside' }}
      />,
    );

    expect(container.innerHTML).toBe('');
  });

  it('keeps offensive audible controls available for normal plays', () => {
    render(
      <AudiblePanel
        role="offense"
        phase="ready_to_snap"
        currentPlay={{ parent: 'run', sub: 'inside' }}
      />,
    );

    expect(screen.getByRole('button', { name: /audible/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /fake/i })).toBeTruthy();
  });
});

describe('ActiveSkillControls', () => {
  it('shows eligible, unused offensive cards for the current play', () => {
    render(
      <ActiveSkillControls
        phase="ready_to_snap"
        isOffense
        team={activeTeam}
        used={['field_general']}
        currentPlay={{ parent: 'pass', sub: 'deep' }}
        chain={null}
        onOffenseSkill={() => {}}
        onOffensePass={() => {}}
        onDefenseSkill={() => {}}
        onDefensePass={() => {}}
      />,
    );

    expect(screen.queryByText('Field General')).toBeNull();
    expect(screen.getByText('Pancake Block')).toBeTruthy();
    expect(screen.getByText('Sure Hands')).toBeTruthy();
    expect(screen.queryByText('Big Leg')).toBeNull();
    expect(screen.getByRole('button', { name: /pass priority to defense/i })).toBeTruthy();
  });

  it('shows defensive responses and pass during the counter window', () => {
    render(
      <ActiveSkillControls
        phase="awaiting_card_response"
        isOffense={false}
        team={activeTeam}
        used={[]}
        currentPlay={{ parent: 'run', sub: 'inside' }}
        chain={{ offense: 'field_general', defense: null, suppressed: null }}
        onOffenseSkill={() => {}}
        onOffensePass={() => {}}
        onDefenseSkill={() => {}}
        onDefensePass={() => {}}
      />,
    );

    expect(screen.getByText('Pin Ears Back')).toBeTruthy();
    expect(screen.getByText('Ball Hawk')).toBeTruthy();
    expect(screen.getByRole('button', { name: /pass · keep cards/i })).toBeTruthy();
  });

  it('offers defensive cards when offense passed without playing a card', () => {
    render(
      <ActiveSkillControls
        phase="awaiting_card_response"
        isOffense={false}
        team={activeTeam}
        used={[]}
        currentPlay={{ parent: 'run', sub: 'inside' }}
        chain={{ offense: null, defense: null, suppressed: null }}
        onOffenseSkill={() => {}}
        onOffensePass={() => {}}
        onDefenseSkill={() => {}}
        onDefensePass={() => {}}
      />,
    );

    expect(screen.getByText('OFF: PASS')).toBeTruthy();
    expect(screen.getByText('Pin Ears Back')).toBeTruthy();
    expect(screen.getByText('Ball Hawk')).toBeTruthy();
  });
});

describe('RosterModal active skills', () => {
  it('shows card rules and distinguishes a committed card from a used card', () => {
    render(
      <RosterModal
        open
        team={activeTeam}
        teamName="Alpha"
        ownerLabel="YOU"
        myIdx={0}
        focusIdx={0}
        onClose={() => {}}
        onSwitch={() => {}}
        activeSkillsUsed={[['field_general', 'pancake_block'], []]}
        activeCardChain={{ offense: 'field_general', defense: null, suppressed: null }}
      />,
    );

    expect(screen.getByText('Field General')).toBeTruthy();
    expect(screen.getByText('Your OFF SKILL roll has advantage.')).toBeTruthy();
    expect(screen.getByText('PLAYED')).toBeTruthy();
    expect(screen.getByText('USED')).toBeTruthy();
  });
});
