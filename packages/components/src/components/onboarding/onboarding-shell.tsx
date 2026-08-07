import { type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { ArrowLeft, ArrowRight, Check, Loader2 } from 'lucide-react';
import { Button } from '@/ui/button';
import { cn } from '@/lib/utils';
import { getOnboardingStepPosition, type OnboardingStepKey } from './onboarding-steps';

export interface OnboardingShellProps {
  /** Step in the flow — drives the eyebrow counter, dot row, and animation key. */
  stepKey: OnboardingStepKey;
  /**
   * Optional override for the eyebrow text. Falls back to the localised
   * "Step X of Y" label so callers don't have to repeat the count.
   */
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  /** Main content beneath the heading. */
  children: ReactNode;
  /** Action row pinned to the bottom-right (Next / Done). */
  primaryAction?: ReactNode;
  /** Optional secondary slot to the left of the primary action. */
  secondaryAction?: ReactNode;
  /** Width preset — wider for screens that show lists. */
  size?: 'narrow' | 'wide';
}

export function OnboardingShell({
  stepKey,
  eyebrow,
  title,
  description,
  children,
  primaryAction,
  secondaryAction,
  size = 'narrow',
}: OnboardingShellProps) {
  const { t } = useTranslation();
  const step = getOnboardingStepPosition(stepKey);
  const eyebrowText =
    eyebrow ??
    t('onboarding.shell.stepCounter', 'Step {{current}} of {{total}}', {
      current: step.current,
      total: step.total,
    });

  return (
    <motion.div
      key={stepKey}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -12 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      className={cn(
        'relative z-10 mx-auto flex w-full flex-col overflow-hidden rounded-2xl border border-border/60',
        'bg-card/80 shadow-2xl shadow-black/[0.08] backdrop-blur-xl',
        'dark:bg-card/60 dark:shadow-black/40',
        size === 'wide' ? 'max-w-3xl' : 'max-w-xl'
      )}
    >
      <div className="flex min-h-0 flex-col gap-6 px-8 pt-7 pb-6 sm:px-10">
        <header className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-4">
            <motion.div
              initial={{ opacity: 0, x: -4 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.4 }}
              className={cn(
                'inline-flex shrink-0 items-center rounded-full border border-border/60',
                'bg-background/60 px-2.5 py-1 text-[11px] font-medium tracking-wide text-muted-foreground'
              )}
            >
              {eyebrowText}
            </motion.div>
            <OnboardingStepDots current={step.current} total={step.total} />
          </div>

          <div className="space-y-1.5">
            <motion.h1
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.04 }}
              className="text-balance text-[1.65rem] font-semibold leading-tight tracking-tight text-foreground sm:text-[1.85rem]"
            >
              {title}
            </motion.h1>
            {description ? (
              <motion.p
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.1 }}
                className="max-w-prose text-pretty text-sm leading-relaxed text-muted-foreground"
              >
                {description}
              </motion.p>
            ) : null}
          </div>
        </header>

        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.14 }}
          className="min-h-0"
        >
          {children}
        </motion.div>
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-border/40 bg-background/40 px-6 py-4 sm:px-8">
        <div className="flex min-w-0 items-center gap-2">{secondaryAction}</div>
        <div className="flex shrink-0 items-center gap-2">{primaryAction}</div>
      </div>
    </motion.div>
  );
}

interface OnboardingBackButtonProps {
  onClick: () => void;
  disabled?: boolean;
  /** Override the default "Back" label (e.g. "Back to list", "Cancel"). */
  label?: ReactNode;
}

export function OnboardingBackButton({ onClick, disabled, label }: OnboardingBackButtonProps) {
  const { t } = useTranslation();
  return (
    <Button variant="ghost" size="lg" onClick={onClick} disabled={disabled} className="gap-2">
      <ArrowLeft className="h-4 w-4" />
      {label ?? t('common.back', 'Back')}
    </Button>
  );
}

interface OnboardingNextButtonProps {
  onClick: () => void;
  disabled?: boolean;
  /** Show a leading spinner and hide the trailing arrow. */
  loading?: boolean;
  /** Override the default "Next" label. */
  label?: ReactNode;
  /** Use a check glyph instead of the arrow (final step). */
  finish?: boolean;
}

export function OnboardingNextButton({
  onClick,
  disabled,
  loading,
  label,
  finish,
}: OnboardingNextButtonProps) {
  const { t } = useTranslation();
  const text = label ?? (finish ? t('common.finish', 'Finish') : t('common.next', 'Next'));
  return (
    <Button size="lg" onClick={onClick} disabled={disabled} className="gap-2">
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : finish ? <Check className="h-4 w-4" /> : null}
      {text}
      {!loading && !finish ? <ArrowRight className="h-4 w-4" /> : null}
    </Button>
  );
}

function OnboardingStepDots({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center gap-1.5" aria-hidden>
      {Array.from({ length: total }).map((_, i) => {
        const position = i + 1;
        const active = position === current;
        const done = position < current;
        return (
          <span
            key={i}
            className={cn(
              'h-1.5 rounded-full transition-all duration-500 ease-out',
              active ? 'w-6 bg-primary' : done ? 'w-1.5 bg-primary/60' : 'w-1.5 bg-border'
            )}
          />
        );
      })}
    </div>
  );
}
