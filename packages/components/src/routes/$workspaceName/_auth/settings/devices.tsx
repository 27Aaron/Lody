import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';
import type { MachineId } from '@lody/shared';
import { MachineAgentSettings } from '@/components/settings/machine-agent-settings';

type DevicesSearch = {
  machine?: string;
};

export const Route = createFileRoute('/$workspaceName/_auth/settings/devices')({
  component: DevicesSettingsRoute,
  validateSearch: (search: Record<string, unknown>): DevicesSearch => ({
    machine: typeof search.machine === 'string' ? search.machine : undefined,
  }),
});

function DevicesSettingsRoute() {
  const { workspaceName } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate();
  const selectedMachineId = (search.machine ?? null) as MachineId | null;
  const onSelectedMachineChange = useCallback(
    (next: MachineId | null) => {
      void navigate({
        to: '/$workspaceName/settings/devices',
        params: { workspaceName },
        search: (prev) => ({ ...prev, machine: next ?? undefined }),
        replace: true,
      });
    },
    [navigate, workspaceName]
  );
  return (
    <MachineAgentSettings
      mode="devices"
      selectedMachineId={selectedMachineId}
      onSelectedMachineChange={onSelectedMachineChange}
    />
  );
}
