import { describe, expect, it } from 'vitest';
import {
  getTaskLabelHsl,
  taskLabelDotStyle,
  taskLabelPillStyle,
} from '../src/components/tasks/task-label-presentation';

describe('getTaskLabelHsl', () => {
  it('assigns fixed hues to suggested labels', () => {
    expect(getTaskLabelHsl('bug')).toBe('0 78% 58%');
    expect(getTaskLabelHsl('feature')).toBe('262 68% 58%');
    expect(getTaskLabelHsl('document')).toBe('214 78% 54%');
  });

  it('is case-insensitive and stable for free-form names', () => {
    expect(getTaskLabelHsl('CI')).toBe(getTaskLabelHsl('ci'));
    expect(getTaskLabelHsl('enhancement')).toBe(getTaskLabelHsl('enhancement'));
  });

  it('exposes styles that embed the same HSL', () => {
    const hsl = getTaskLabelHsl('bug');
    expect(taskLabelDotStyle('bug').backgroundColor).toBe(`hsl(${hsl})`);
    expect(taskLabelPillStyle('bug').color).toBe(`hsl(${hsl})`);
  });
});
