// @vitest-environment jsdom
// RollReveal component tests — verify the HUD surfaces the resolver's
// per-play roll values correctly. Uses @testing-library/react.

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import RollReveal from '../src/components/RollReveal.js';

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
  off_line_roll: 54,
  def_line_roll: 32,
  off_line_skill: 85,
  def_line_skill: 70,
  line_winner: 'offense',
  line_regime: 'dominate',
  line_roll_gap: 22,
};

describe('RollReveal — Phase 4 HUD', () => {
  it('renders nothing-actionable when no play result', () => {
    render(<RollReveal playResult={null} progress={null} />);
    expect(screen.getByText(/Snap the ball/i)).toBeTruthy();
  });

  it('renders OFF SKILL and DEF SKILL rolls in flip-cards', () => {
    render(<RollReveal playResult={basePlayResult} progress={1} />);
    expect(screen.getByTestId('roll-off-skill').textContent).toBe('78');
    expect(screen.getByTestId('roll-def-skill').textContent).toBe('65');
  });

  it('renders O-LINE and D-LINE rolls', () => {
    render(<RollReveal playResult={basePlayResult} progress={1} />);
    expect(screen.getByTestId('roll-o-line').textContent).toBe('54');
    expect(screen.getByTestId('roll-d-line').textContent).toBe('32');
  });

  it('renders the verdict label for DOMINATE offense', () => {
    render(<RollReveal playResult={basePlayResult} progress={1} />);
    const verdict = screen.getByTestId('roll-verdict').textContent;
    expect(verdict).toMatch(/LINE DOMINATES/i);
  });

  it('renders the result yards with correct sign', () => {
    render(<RollReveal playResult={basePlayResult} progress={1} />);
    expect(screen.getByText(/\+8/)).toBeTruthy();
  });

  it('FG variant: renders KICKER POWER + BONUS = TOTAL', () => {
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
    render(<RollReveal playResult={fgResult} progress={1} />);
    expect(screen.getByTestId('fg-power').textContent).toBe('61');
    expect(screen.getByTestId('fg-bonus').textContent).toBe('14');
    expect(screen.getByTestId('fg-total').textContent).toBe('75');
  });

  it('Punt variant: renders punt yardage', () => {
    const puntResult: any = {
      ...basePlayResult,
      off_call: { parent: 'punt', sub: 'inside' },
      scoring_event: null,
      punt_roll: 38,
      yards: 38,
    };
    render(<RollReveal playResult={puntResult} progress={1} />);
    // Both the punt card and the result card show "+38"; use getAllByText
    const matches = screen.getAllByText(/\+38/);
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('TD verdict appears with TD scoring_event', () => {
    const tdResult: any = { ...basePlayResult, scoring_event: 'td', yards: 25 };
    render(<RollReveal playResult={tdResult} progress={1} />);
    expect(screen.getByTestId('roll-verdict').textContent).toMatch(/TOUCHDOWN/i);
  });

  it('TURNOVER verdict appears when turnover rolled', () => {
    const toResult: any = { ...basePlayResult, turnover: true, yards: 0 };
    render(<RollReveal playResult={toResult} progress={1} />);
    expect(screen.getByTestId('roll-verdict').textContent).toMatch(/TURNOVER/i);
  });
});