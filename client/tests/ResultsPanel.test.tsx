// @vitest-environment jsdom
// ResultsPanel component tests — verify the panel renders the
// 2 matchup rectangles + result correctly.
//
// The history list was extracted into HistoryPanel.tsx; those tests live in
// `HistoryPanel.test.tsx` next door.

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import ResultsPanel from '../src/components/ResultsPanel.js';

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
  // Phase 0 fields:
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

describe('ResultsPanel — matchup rectangles', () => {
  it('renders the "Snap the ball…" placeholder when no play result', () => {
    render(<ResultsPanel playResult={null} progress={null} />);
    expect(screen.getByText(/Snap the ball/i)).toBeTruthy();
  });

  it('skill rect renders OFF Skill roll / bound and DEF Skill roll / bound with >', () => {
    render(<ResultsPanel playResult={basePlayResult} progress={1} />);
    const off = screen.getByTestId('matchup-skill-off');
    const def = screen.getByTestId('matchup-skill-def');
    const symbol = screen.getByTestId('matchup-skill-symbol');
    expect(off.textContent).toBe('78/88');
    expect(def.textContent).toBe('65/80');
    expect(symbol.textContent).toBe('>');
  });

  it('skill rect uses < when defense rolls higher', () => {
    const p = { ...basePlayResult, off_roll: 12, def_roll: 47 };
    render(<ResultsPanel playResult={p} progress={1} />);
    expect(screen.getByTestId('matchup-skill-symbol').textContent).toBe('<');
  });

  it('skill rect uses = on tied rolls', () => {
    const p = { ...basePlayResult, off_roll: 30, def_roll: 30 };
    render(<ResultsPanel playResult={p} progress={1} />);
    expect(screen.getByTestId('matchup-skill-symbol').textContent).toBe('=');
  });

  it('line rect renders O-LINE and D-LINE rolls/bounds with the > symbol', () => {
    render(<ResultsPanel playResult={basePlayResult} progress={1} />);
    const off = screen.getByTestId('matchup-line-off');
    const def = screen.getByTestId('matchup-line-def');
    const symbol = screen.getByTestId('matchup-line-symbol');
    expect(off.textContent).toBe('72/99');
    expect(def.textContent).toBe('54/84');
    expect(symbol.textContent).toBe('>');
  });

  it('parent mismatch renders em-dashes and forces > (offense auto-wins)', () => {
    const mismatch = {
      ...basePlayResult,
      off_call: { parent: 'run', sub: 'inside' },
      def_call: { parent: 'pass', sub: 'deep' },
      parent_match: false,
      sub_match: false,
      off_roll: 0,
      def_roll: 0,
    };
    render(<ResultsPanel playResult={mismatch} progress={1} />);
    expect(screen.getByTestId('matchup-skill-off').textContent).toBe('—/88');
    expect(screen.getByTestId('matchup-skill-def').textContent).toBe('—/80');
    expect(screen.getByTestId('matchup-skill-symbol').textContent).toBe('>');
  });
});

describe('ResultsPanel — FG and Punt variants', () => {
  it('FG variant: line rect is hidden, FG rect renders power/bonus/total/ytg', () => {
    const fgResult: any = {
      ...basePlayResult,
      off_call: { parent: 'fg', sub: 'inside' },
      scoring_event: 'fg',
      fg_power_roll: 61,
      fg_bonus_roll: 14,
      fg_total: 75,
      fg_power_eff: 80,
      yards: 0,
    };
    render(<ResultsPanel playResult={fgResult} progress={1} />);
    expect(screen.getByTestId('matchup-fg')).toBeTruthy();
    expect(screen.queryByTestId('matchup-line')).toBeNull();
    expect(screen.getByTestId('fg-power').textContent).toBe('61');
    expect(screen.getByTestId('fg-bonus').textContent).toBe('14');
    expect(screen.getByTestId('fg-total').textContent).toBe('75');
    // YTG at yardline 45 attacking +1 = 100 - 45 = 55
    expect(screen.getByTestId('fg-ytg').textContent).toBe('55');
  });

  it('FG variant: YTG computed from offense_direction = -1', () => {
    const fgResult: any = {
      ...basePlayResult,
      off_call: { parent: 'fg', sub: 'inside' },
      yardline_before: 75,
      offense_direction: -1,
      scoring_event: 'fg',
      fg_power_roll: 50,
      fg_bonus_roll: 10,
      fg_total: 60,
      fg_power_eff: 80,
      yards: 0,
    };
    render(<ResultsPanel playResult={fgResult} progress={1} />);
    // YTG at yardline 75 attacking -1 = 75
    expect(screen.getByTestId('fg-ytg').textContent).toBe('75');
  });

  it('Punt variant: line rect is hidden, punt rect renders punt yardage', () => {
    const puntResult: any = {
      ...basePlayResult,
      off_call: { parent: 'punt', sub: 'inside' },
      scoring_event: null,
      punt_roll: 38,
      yards: 38,
    };
    render(<ResultsPanel playResult={puntResult} progress={1} />);
    expect(screen.getByTestId('matchup-punt')).toBeTruthy();
    expect(screen.queryByTestId('matchup-line')).toBeNull();
    expect(screen.getByTestId('punt-yards').textContent).toBe('+38');
  });
});

describe('ResultsPanel — verdict + result', () => {
  it('renders the verdict label for DOMINATE offense', () => {
    render(<ResultsPanel playResult={basePlayResult} progress={1} />);
    const verdict = screen.getByTestId('roll-verdict').textContent;
    expect(verdict).toMatch(/LINE DOMINATES/i);
  });

  it('renders the result yards with correct sign', () => {
    render(<ResultsPanel playResult={basePlayResult} progress={1} />);
    expect(screen.getByText(/\+8/)).toBeTruthy();
  });

  it('TD verdict appears with TD scoring_event', () => {
    const tdResult = { ...basePlayResult, scoring_event: 'td', yards: 25 };
    render(<ResultsPanel playResult={tdResult} progress={1} />);
    expect(screen.getByTestId('roll-verdict').textContent).toMatch(/TOUCHDOWN/i);
  });

  it('TURNOVER verdict appears when turnover rolled', () => {
    const toResult = { ...basePlayResult, turnover: true, yards: 0 };
    render(<ResultsPanel playResult={toResult} progress={1} />);
    expect(screen.getByTestId('roll-verdict').textContent).toMatch(/TURNOVER/i);
  });
});
