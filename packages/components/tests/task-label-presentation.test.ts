import { describe, expect, it } from 'vitest';
import { getTaskLabelHsl } from '../src/components/tasks/task-label-presentation';

describe('getTaskLabelHsl', () => {
  it('is case-insensitive for free-form names', () => {
    expect(getTaskLabelHsl('CI')).toBe(getTaskLabelHsl('ci'));
  });
});
