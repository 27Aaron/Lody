import { isLocalAppPlatform } from '@/lib/app-platform';

/**
 * Single source of truth for the onboarding step ordering. Keeping the order
 * here means the indicator dots, the eyebrow counter, and the orchestrator's
 * phase enum can never drift from each other.
 *
 * The CLI loading screen sits *before* step 1 — it has no dot of its own.
 *
 * The local (open-source) platform has no cloud account, so the Convex-backed
 * workspace and invite steps do not exist there; the platform decides the
 * step list at this definition level.
 */
const ALL_ONBOARDING_STEPS = [
  'language',
  'theme',
  'workspace',
  'invite',
  'providers',
  'projects',
] as const;

export type OnboardingStepKey = (typeof ALL_ONBOARDING_STEPS)[number];

const LOCAL_PLATFORM_ONBOARDING_STEPS: readonly OnboardingStepKey[] = [
  'language',
  'theme',
  'providers',
  'projects',
];

export const ONBOARDING_STEPS: readonly OnboardingStepKey[] = isLocalAppPlatform()
  ? LOCAL_PLATFORM_ONBOARDING_STEPS
  : ALL_ONBOARDING_STEPS;

export const ONBOARDING_TOTAL_STEPS = ONBOARDING_STEPS.length;

export function isOnboardingStepEnabled(step: OnboardingStepKey): boolean {
  return ONBOARDING_STEPS.includes(step);
}

export function getOnboardingStepPosition(step: OnboardingStepKey): {
  current: number;
  total: number;
} {
  return {
    current: ONBOARDING_STEPS.indexOf(step) + 1,
    total: ONBOARDING_TOTAL_STEPS,
  };
}
