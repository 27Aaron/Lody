import { describe, expect, it } from 'vitest';
import {
  createVibeloftTelemetryTags,
  VIBELOFT_IDLE_TIMEOUT_MS,
  VIBELOFT_STARTUP_DELAY_MS,
} from '../../../apps/web/vite-plugins/vibeloft-telemetry';

describe('Vibeloft telemetry loader', () => {
  it('injects an inline scheduler instead of an eager external script', () => {
    const [tag] = createVibeloftTelemetryTags(' test-auth-key ');

    expect(tag).toBeDefined();
    expect(tag?.attrs).toMatchObject({
      'data-lody-vibeloft-loader': 'true',
      'data-vl-auth-key': 'test-auth-key',
    });
    expect(tag?.attrs).not.toHaveProperty('src');
    expect(tag?.children).toContain('window.setTimeout');
    expect(tag?.children).toContain(`${VIBELOFT_STARTUP_DELAY_MS}`);
    expect(tag?.children).toContain(`timeout: ${VIBELOFT_IDLE_TIMEOUT_MS}`);
    expect(tag?.children).toContain('https://vibeloft.ai/telemetry/v1.js');
  });

  it('does not inject telemetry when the auth key is absent', () => {
    expect(createVibeloftTelemetryTags('   ')).toEqual([]);
  });
});
