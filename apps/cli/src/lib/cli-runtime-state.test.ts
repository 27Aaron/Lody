import { describe, expect, it } from 'vitest';
import { CliRuntimeStateReporter } from './cli-runtime-state';

describe('CliRuntimeStateReporter backend state', () => {
  it('starts with backend authorization pending and no connected workspaces', () => {
    const reporter = new CliRuntimeStateReporter({ pid: 123 });

    expect(reporter.snapshot()).toMatchObject({
      backend: {
        authorization: 'pending',
        connection: 'connecting',
      },
      connectedWorkspaces: [],
    });
  });

  it('publishes backend authorization and workspace connection details', () => {
    const reporter = new CliRuntimeStateReporter({ pid: 123 });
    reporter.setBackendAuthorization('authorized');
    reporter.setBackendConnection('connected');
    reporter.setConnectedWorkspaces([
      {
        id: 'workspace-1',
        name: 'Alpha',
        slug: 'alpha',
        role: 'owner',
        backendConnection: 'connected',
      },
    ]);

    expect(reporter.snapshot()).toMatchObject({
      backend: {
        authorization: 'authorized',
        connection: 'connected',
      },
      connectedWorkspaces: [
        {
          id: 'workspace-1',
          name: 'Alpha',
          backendConnection: 'connected',
        },
      ],
    });
  });
});
