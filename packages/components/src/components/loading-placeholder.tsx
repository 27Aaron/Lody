import { Loader2 } from 'lucide-react';

export function LoadingPlaceholder({
  title = 'Loading',
  description = '',
}: {
  title?: string;
  description?: string;
}) {
  return (
    <div className="flex min-h-[100dvh] w-full items-center justify-center bg-background p-6 text-muted-foreground">
      <div
        className="flex max-w-sm flex-col items-center gap-3 text-center"
        role="status"
        aria-live="polite"
      >
        <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
        <div className="space-y-1">
          <div className="text-sm font-medium text-foreground">{title}</div>
          {description ? (
            <div className="mx-auto max-w-[320px] text-xs leading-5">{description}</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
