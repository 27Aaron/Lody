import { atom } from 'jotai';
import { atomWithStorage } from 'jotai/utils';

/**
 * Persists whether the desktop first-run onboarding has finished. Stored
 * locally so a reinstall on the same machine re-runs the flow naturally.
 */
export const desktopOnboardingCompletedAtom = atomWithStorage<boolean>(
  'lody-desktop-onboarding-completed',
  false
);

/**
 * Set to true while the user is actively in the onboarding overlay so other
 * surfaces (electron menu, deep links, popovers) can suspend interruptions.
 */
export const desktopOnboardingActiveAtom = atom<boolean>(false);

/**
 * The phases the user can resume into. CLI/bootstrap readiness is intentionally
 * not an onboarding phase; the desktop CLI starts in the background, and only
 * local CLI-dependent actions add their own waiting states. The "Connect GitHub"
 * action opens an external browser and brings the user back, so persisting the
 * current step is what keeps them on the projects screen instead of bouncing
 * back to step 1.
 */
export type DesktopOnboardingResumePhase =
  | 'language'
  | 'theme'
  | 'workspace'
  | 'invite'
  | 'providers'
  | 'projects';

/**
 * Last reached phase in the onboarding flow. Persisted so reload / external
 * redirect (GitHub install, OAuth) returns the user to the same screen
 * instead of restarting from language. `null` means the flow has not begun.
 */
export const desktopOnboardingPhaseAtom = atomWithStorage<DesktopOnboardingResumePhase | null>(
  'lody-desktop-onboarding-phase',
  null
);
