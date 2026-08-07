import { createFileRoute } from '@tanstack/react-router';
import { ProjectSettingsComponent } from '@/components/settings/project-settings';

export const Route = createFileRoute('/$workspaceName/_auth/settings/projects')({
  component: ProjectSettingsRoute,
});

function ProjectSettingsRoute() {
  return <ProjectSettingsComponent />;
}
