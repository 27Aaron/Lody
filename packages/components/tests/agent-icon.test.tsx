import { describe, expect, it } from 'vitest';

import { getAgentDisplayName } from '../src/components/icons/agent-icon';

describe('getAgentDisplayName', () => {
  it('uses the product name for builtin Kimi', () => {
    expect(getAgentDisplayName('builtin', 'kimi')).toBe('Kimi Code');
  });
});
