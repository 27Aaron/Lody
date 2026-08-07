import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { AnimatePresence } from 'framer-motion';
import { useAtom, useSetAtom } from 'jotai';
import { usePostHog } from '@posthog/react';
import type { BuiltinAgentType } from '@lody/shared';
import {
  desktopOnboardingActiveAtom,
  desktopOnboardingCompletedAtom,
  desktopOnboardingPhaseAtom,
  type DesktopOnboardingResumePhase,
} from '@/atoms/onboarding';
import { capturePostHogEvent } from '@/lib/posthog-analytics';
import { OnboardingBackdrop } from './onboarding-backdrop';
import { isOnboardingStepEnabled } from './onboarding-steps';
import { LanguageScreen } from './screens/language-screen';
import { ThemeScreen } from './screens/theme-screen';
import { WorkspaceScreen } from './screens/workspace-screen';
import { InviteScreen } from './screens/invite-screen';
import { ProvidersScreen } from './screens/providers-screen';
import { ProjectsScreen } from './screens/projects-screen';
import { useOnboardingBuiltinRuntimePrefetch } from './use-onboarding-builtin-runtime-prefetch';

export function OnboardingOverlay() {
  const setActive = useSetAtom(desktopOnboardingActiveAtom);
  const setCompleted = useSetAtom(desktopOnboardingCompletedAtom);
  const [persistedPhase, setPersistedPhase] = useAtom(desktopOnboardingPhaseAtom);
  const [preferredBuiltinRuntime, setPreferredBuiltinRuntime] = useState<BuiltinAgentType | null>(
    null
  );
  const postHog = usePostHog();
  useOnboardingBuiltinRuntimePrefetch(preferredBuiltinRuntime);
  // A persisted phase pointing at a step this platform does not have (e.g. a
  // cloud-profile 'workspace'/'invite' phase on the local platform) resumes at
  // the next enabled step instead.
  const rawPhase: DesktopOnboardingResumePhase = persistedPhase ?? 'language';
  const phase: DesktopOnboardingResumePhase = isOnboardingStepEnabled(rawPhase)
    ? rawPhase
    : 'providers';

  useEffect(() => {
    setActive(true);
    return () => setActive(false);
  }, [setActive]);

  useEffect(() => {
    capturePostHogEvent(postHog, 'onboarding/desktop_started');
  }, [postHog]);

  useEffect(() => {
    capturePostHogEvent(postHog, 'onboarding/desktop_step_viewed', { step: phase });
  }, [phase, postHog]);

  const advanceTo = useCallback(
    (next: DesktopOnboardingResumePhase) => {
      setPersistedPhase(next);
    },
    [setPersistedPhase]
  );

  const goLanguage = useCallback(() => advanceTo('language'), [advanceTo]);
  const goTheme = useCallback(() => advanceTo('theme'), [advanceTo]);
  const goWorkspace = useCallback(() => advanceTo('workspace'), [advanceTo]);
  const goInvite = useCallback(() => advanceTo('invite'), [advanceTo]);
  const goProviders = useCallback(() => advanceTo('providers'), [advanceTo]);
  const goProjects = useCallback(() => advanceTo('projects'), [advanceTo]);
  // The workspace/invite pair is absent on the local platform; theme and
  // providers link past it in both directions.
  const hasWorkspaceSteps = isOnboardingStepEnabled('workspace');
  const goAfterTheme = hasWorkspaceSteps ? goWorkspace : goProviders;
  const goBeforeProviders = hasWorkspaceSteps ? goInvite : goTheme;

  const handleComplete = useCallback(() => {
    capturePostHogEvent(postHog, 'onboarding/desktop_completed');
    setCompleted(true);
    setPersistedPhase(null);
  }, [postHog, setCompleted, setPersistedPhase]);

  const screens: Record<DesktopOnboardingResumePhase, ReactNode> = {
    language: <LanguageScreen key="language" onNext={goTheme} />,
    theme: <ThemeScreen key="theme" onBack={goLanguage} onNext={goAfterTheme} />,
    workspace: <WorkspaceScreen key="workspace" onBack={goTheme} onNext={goInvite} />,
    invite: (
      <InviteScreen
        key="invite"
        onBack={goWorkspace}
        onSkip={goProviders}
        onCompleted={goProviders}
      />
    ),
    providers: (
      <ProvidersScreen
        key="providers"
        onBack={goBeforeProviders}
        onSkip={goProjects}
        onNext={goProjects}
        onManagedRuntimeSelected={setPreferredBuiltinRuntime}
      />
    ),
    projects: <ProjectsScreen key="projects" onBack={goProviders} onComplete={handleComplete} />,
  };

  return (
    // Sit between MainLayout content (max z-30) and Radix Dialogs/AlertDialogs
    // (z-50). Anything higher would trap focus to a hidden dialog when the
    // provider step opens AgentConfigDialog from inside this overlay.
    <div className="fixed inset-0 z-40 flex items-center justify-center overflow-y-auto px-4 py-8">
      <OnboardingBackdrop />
      <AnimatePresence mode="wait" initial={false}>
        {screens[phase]}
      </AnimatePresence>
    </div>
  );
}
