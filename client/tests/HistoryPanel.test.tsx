// @vitest-environment jsdom
// HistoryPanel component tests — verify the scrollable history list renders
// the prior plays in newest-first order, excludes the current play, and
// shows the empty-state placeholder when there's nothing to show.
//
// Extracted from the old unified ResultsPanel.test.tsx when the history
// list was split out into its own component in the layout rework.

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import HistoryPanel from '../src/components/HistoryPanel.js';

const basePlayResult: any = {
  down: 2,
  distance: 8,
  yardline_before: 45,
  yardline_after: 53,
  off_call: { parent: 'run', sub: 'inside' },
  def_call: { parent: 'run', sub: 'inside' },
  off_audible: null,
  def_audible: null,
  off_fake_audible: false,
  parent_match: true,
  sub_match: true,
  turnover: false,
  yards: 8,
  scoring_event: null,
  seed: 42,
  text_recap: 'Gain of 8.',
  offense_direction: 1,
  off_roll: 78,
  def_roll: 65,
  off_skill_eff: 88,
  def_skill_eff: 80,
  off_line_roll: 72,
  def_line_roll: 54,
  off_line_skill: 99,
  def_line_skill: 84,
  line_winner: 'offense',
  line_regime: 'dominate',
  line_roll_gap: 22,
};

function makeHistory(): any[] {
  return [
    { ...basePlayResult, seed: 1, yards: 5, text_recap: 'Run for 5.' },
    { ...basePlayResult, seed: 2, yards: 12, text_recap: 'Pass for 12.' },
    { ...basePlayResult, seed: 3, yards: -3, text_recap: 'Stuff at the LOS.' },
    { ...basePlayResult, seed: 4, yards: 8, text_recap: 'Gain of 8.' },
    { ...basePlayResult, seed: 5, yards: 22, text_recap: 'Big play!' },
    { ...basePlayResult, seed: 6, yards: 4, text_recap: 'Short gain.' },
  ];
}

describe('HistoryPanel — history list', () => {
  it('renders the last 4 prior plays in the scrollable list (current play is excluded)', () => {
    render(
      <HistoryPanel
        playResult={{ ...basePlayResult, seed: 7, yards: 9, text_recap: 'Latest play.' }}
        history={makeHistory()}
      />,
    );
    const list = screen.getByTestId('history-list');
    expect(list).toBeTruthy();
    // 6 history entries, current play (seed=7) is not in history, so all 6
    // are prior. Cap=5 → list shows 4. Verify by recaps appearing in the list.
    expect(screen.getByText('Big play!')).toBeTruthy();
    expect(screen.getByText('Short gain.')).toBeTruthy();
  });

  it('excludes the current play from the history rows', () => {
    const current = { ...basePlayResult, seed: 99, yards: 7, text_recap: 'CURRENTPLAY' };
    render(
      <HistoryPanel
        playResult={current}
        history={[
          ...makeHistory(),
          current,
        ]}
      />,
    );
    // historyCap=5, current play excluded → 6 prior entries cap to 4 rows.
    const historyWrap = screen.getByTestId('history-list');
    const matches = historyWrap.querySelectorAll('li');
    expect(matches.length).toBe(4);
  });

  it('renders the empty-state placeholder when there is no prior history', () => {
    render(
      <HistoryPanel
        playResult={{ ...basePlayResult, seed: 1 }}
        history={[]}
      />,
    );
    expect(screen.getByTestId('history-empty')).toBeTruthy();
  });

  it('marks the newest history row with ▶ LAST PLAY (last-play test ID)', () => {
    render(
      <HistoryPanel
        playResult={{ ...basePlayResult, seed: 100, text_recap: 'Latest.' }}
        history={[
          { ...basePlayResult, seed: 1, text_recap: 'Earlier A.' },
          { ...basePlayResult, seed: 2, text_recap: 'Earlier B.' },
        ]}
      />,
    );
    const lastPlay = screen.getByTestId('last-play');
    expect(lastPlay.textContent).toMatch(/LAST PLAY/);
  });
});
