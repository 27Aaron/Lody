import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';
import type { MachineId } from '@lody/shared';
import { MachineAgentSettings } from '@/components/settings/machine-agent-settings';

export type AgentConfigSearch = {
  machine?: string;
};

export const Route = createFileRoute('/$workspaceName/_auth/settings/agent-config')({
  component: AgentSettingsRoute,
  validateSearch: (search: Record<string, unknown>): AgentConfigSearch => ({
    machine: typeof search.machine === 'string' ? search.machine : undefined,
  }),
});

function AgentSettingsRoute() {
  const { workspaceName } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate();

  const selectedMachineId = (search.machine ?? null) as MachineId | null;

  const onSelectedMachineChange = useCallback(
    (next: MachineId | null) => {
      void navigate({
        to: '/$workspaceName/settings/agent-config',
        params: { workspaceName },
        search: (prev) => ({ ...prev, machine: next ?? undefined }),
        replace: true,
      });
    },
    [navigate, workspaceName]
  );

  return (
    <MachineAgentSettings
      selectedMachineId={selectedMachineId}
      onSelectedMachineChange={onSelectedMachineChange}
    />
  );
}
