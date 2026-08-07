import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

/**
 * Ambient backdrop for the onboarding overlay. Three slowly-drifting orbs over
 * a faint grid, with a soft vignette that keeps the foreground readable on
 * either theme. Pure decoration — no interactivity, no layout cost.
 */
export function OnboardingBackdrop({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        'pointer-events-none absolute inset-0 overflow-hidden',
        'bg-background',
        className
      )}
    >
      <div
        className={cn(
          'absolute inset-0',
          '[background-image:linear-gradient(to_right,hsl(var(--border)/0.35)_1px,transparent_1px),linear-gradient(to_bottom,hsl(var(--border)/0.35)_1px,transparent_1px)]',
          '[background-size:48px_48px]',
          '[mask-image:radial-gradient(ellipse_at_center,black_20%,transparent_75%)]'
        )}
      />

      <motion.div
        initial={{ opacity: 0 }}
        animate={{
          opacity: [0.55, 0.75, 0.55],
          x: ['-10%', '5%', '-10%'],
          y: ['-5%', '8%', '-5%'],
        }}
        transition={{ duration: 18, repeat: Infinity, ease: 'easeInOut' }}
        className="absolute -left-32 top-[-20%] h-[42rem] w-[42rem] rounded-full blur-[120px]"
        style={{
          background:
            'radial-gradient(circle, hsl(var(--primary) / 0.28), hsl(var(--primary) / 0) 70%)',
        }}
      />
      <motion.div
        initial={{ opacity: 0 }}
        animate={{
          opacity: [0.4, 0.6, 0.4],
          x: ['8%', '-6%', '8%'],
          y: ['10%', '-4%', '10%'],
        }}
        transition={{ duration: 22, repeat: Infinity, ease: 'easeInOut', delay: 1.2 }}
        className="absolute -right-40 bottom-[-25%] h-[38rem] w-[38rem] rounded-full blur-[120px]"
        style={{
          background:
            'radial-gradient(circle, hsl(var(--highlight) / 0.32), hsl(var(--highlight) / 0) 70%)',
        }}
      />
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: [0.25, 0.45, 0.25], scale: [1, 1.08, 1] }}
        transition={{ duration: 14, repeat: Infinity, ease: 'easeInOut', delay: 2.4 }}
        className="absolute left-1/2 top-1/2 h-[28rem] w-[28rem] -translate-x-1/2 -translate-y-1/2 rounded-full blur-[100px]"
        style={{
          background:
            'radial-gradient(circle, hsl(var(--primary) / 0.18), hsl(var(--primary) / 0) 70%)',
        }}
      />

      <div
        className={cn(
          'absolute inset-0',
          '[background:radial-gradient(ellipse_at_center,transparent_40%,hsl(var(--background)/0.7)_100%)]'
        )}
      />
    </div>
  );
}
