// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import ScorePanel from '../src/components/ScorePanel.js';
import AudiblePanel from '../src/components/AudiblePanel.js';

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
