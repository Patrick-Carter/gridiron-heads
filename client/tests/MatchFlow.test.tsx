// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ConcedeControl from '../src/components/ConcedeControl.js';
import ShootoutPanel from '../src/components/ShootoutPanel.js';
import GameOver from '../src/screens/GameOver.js';
import { newGameState } from '@gridiron/shared';

vi.mock('../src/audio/synth.js', () => ({
  initAudio: vi.fn(),
  playVictory: vi.fn(),
  playDefeat: vi.fn(),
  playUiClick: vi.fn(),
}));
vi.mock('../src/audio/crowd.js', () => ({ playCrowdRoar: vi.fn() }));

const shootout = {
  round: 2,
  distance: 35,
  first_kicker_idx: 1 as const,
  next_kicker_idx: 0 as const,
  round_attempts: [null, null] as [null, null],
  attempts: [],
};

describe('ShootoutPanel', () => {
  it('shows the round, distance, and kick only to the current kicker', () => {
    const onKick = vi.fn();
    const view = render(
      <ShootoutPanel
        shootout={shootout}
        players={[{ name: 'Alpha' }, { name: 'Beta' }]}
        myIdx={0}
        ready
        onKick={onKick}
      />,
    );
    expect(screen.getByText('Round 2')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /kick 35-yard fg/i }));
    expect(onKick).toHaveBeenCalledOnce();

    view.rerender(
      <ShootoutPanel
        shootout={shootout}
        players={[{ name: 'Alpha' }, { name: 'Beta' }]}
        myIdx={1}
        ready
        onKick={onKick}
      />,
    );
    expect(screen.queryByRole('button', { name: /kick/i })).toBeNull();
    expect(screen.getByText(/waiting for alpha/i)).toBeTruthy();
  });
});

describe('ConcedeControl', () => {
  it('requires confirmation before conceding', () => {
    const onConcede = vi.fn();
    render(<ConcedeControl onConcede={onConcede} />);
    fireEvent.click(screen.getByRole('button', { name: 'Concede Game' }));
    expect(onConcede).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Yes, Concede' }));
    expect(onConcede).toHaveBeenCalledOnce();
  });
});

describe('GameOver', () => {
  it('uses the authoritative shootout winner when regulation was tied', () => {
    const game = newGameState('s', [
      { qb: null, d_line: null, o_line: null, off_skill: null, def_skill: null, kicker: null },
      { qb: null, d_line: null, o_line: null, off_skill: null, def_skill: null, kicker: null },
    ]);
    game.scores = [2, 2.5];
    game.phase = 'ended';
    render(
      <MemoryRouter>
        <GameOver
          state={{
            session_id: 's',
            players: [{ id: 'a', name: 'Alpha', ready: false }, { id: 'b', name: 'Beta', ready: false }],
            game,
            outcome: { winner_idx: 1, reason: 'shootout', conceded_by_idx: null },
          }}
          meId="b"
          onRematch={() => {}}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText('YOU WIN!')).toBeTruthy();
    expect(screen.getByText(/beta wins the fg shootout/i)).toBeTruthy();
  });
});
