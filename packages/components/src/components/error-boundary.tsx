import { Component, type ErrorInfo, type ReactNode } from 'react';
import { hashAnalyticsId, isConvexError, isConvexUnauthenticatedError } from '@lody/shared';
import { deferredPostHog } from '@/lib/deferred-posthog';
import { capturePostHogEvent } from '@/lib/posthog-analytics';
import { jotaiStore } from '@/lib/utils';
import { currentWorkspaceIdAtom } from '@/atoms/workspace-context';

export type ErrorBoundaryFallbackProps = {
  error: Error;
  resetErrorBoundary: () => void;
};

type ErrorBoundaryVariant = 'page' | 'section' | 'inline';

// Stable, low-cardinality reason code for a caught render error. Keep it derived
// from error shape (name/code) only — never from the message, which carries
// user data and would explode cardinality (spec §2.3/§2.4).
function classifyBoundaryReason(error: Error): string {
  const name = error.name || 'Error';
  const code = (error as { code?: unknown }).code;
  if (typeof code === 'string' && code.length > 0) {
    return code.toLowerCase();
  }
  const message = error.message?.toLowerCase() ?? '';
  if (message.includes('chunk') || message.includes('dynamically imported module')) {
    return 'chunk_load';
  }
  if (name === 'TypeError') return 'type_error';
  if (name === 'RangeError') return 'range_error';
  if (name === 'ReferenceError') return 'reference_error';
  if (name === 'SyntaxError') return 'syntax_error';
  if (name && name !== 'Error') return name.toLowerCase();
  return 'unknown';
}

// Non-PII dedupe key for "same error" grouping on the churn-attribution event.
// Hashes the error shape (name + normalized message head + boundary), NOT the
// raw stack, so it is safe to send and stable across users (spec §7.5:
// error_fingerprint dedupes the product-level signal without re-sending the
// stack, which now lives on the PostHog $exception captured alongside it).
function computeErrorFingerprint(error: Error, boundaryName: string): string {
  const head = (error.message ?? '')
    // Strip URLs, hex/uuid-ish tokens and digit runs so transient ids do not
    // fork the fingerprint for what is conceptually one error.
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[0-9a-f]{8,}/gi, '')
    .replace(/\d+/g, '')
    .trim()
    .slice(0, 120);
  return hashAnalyticsId(`${boundaryName}|${error.name}|${head}`);
}

function readWorkspaceId(): string {
  try {
    return jotaiStore.get(currentWorkspaceIdAtom) ?? '';
  } catch {
    return '';
  }
}

export type ErrorBoundaryProps = {
  children: ReactNode;
  name?: string;
  variant?: ErrorBoundaryVariant;
  resetKeys?: ReadonlyArray<unknown>;
  onReset?: () => void;
  onError?: (error: Error, info: ErrorInfo) => void;
  fallback?: ReactNode;
  fallbackRender?: (props: ErrorBoundaryFallbackProps) => ReactNode;
  showErrorDetails?: boolean;
  propagateAuthErrors?: boolean;
};

type ErrorBoundaryState = {
  error: Error | null;
  componentStack: string | null;
};

function didResetKeysChange(
  prevKeys: ReadonlyArray<unknown> | undefined,
  nextKeys: ReadonlyArray<unknown> | undefined
): boolean {
  if (prevKeys === nextKeys) return false;
  if (!prevKeys || !nextKeys) return true;
  if (prevKeys.length !== nextKeys.length) return true;

  for (let index = 0; index < prevKeys.length; index += 1) {
    if (!Object.is(prevKeys[index], nextKeys[index])) {
      return true;
    }
  }

  return false;
}

function DefaultFallback({
  error,
  resetErrorBoundary,
  variant,
  componentStack,
  showErrorDetails,
}: ErrorBoundaryFallbackProps & {
  variant: ErrorBoundaryVariant;
  componentStack: string | null;
  showErrorDetails: boolean;
}) {
  const isDev = import.meta.env.DEV;
  const containsRawConvexServerDetails =
    isConvexError(error) || error.message.trimStart().startsWith('[CONVEX ');

  const containerClassName =
    variant === 'page'
      ? 'flex min-h-[50vh] w-full flex-col items-center justify-center p-6 text-center'
      : variant === 'section'
        ? 'w-full rounded-lg border border-border/60 bg-background/80 p-4'
        : 'inline-flex w-fit items-center gap-2 rounded-md border border-border/60 bg-background/80 px-3 py-2';

  const titleClassName =
    variant === 'page'
      ? 'text-base font-semibold text-foreground'
      : variant === 'inline'
        ? 'text-xs font-semibold text-foreground'
        : 'text-sm font-semibold text-foreground';

  const descClassName =
    variant === 'page'
      ? 'mt-1 text-sm text-muted-foreground'
      : variant === 'inline'
        ? 'text-xs text-muted-foreground'
        : 'mt-1 text-xs text-muted-foreground';

  const buttonBase =
    'inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50';

  const primaryButton = `${buttonBase} bg-primary px-3 py-2 text-primary-foreground hover:bg-primary/90`;
  const secondaryButton = `${buttonBase} border border-input-border bg-background px-3 py-2 text-foreground hover:bg-hover hover:text-hover-foreground`;
  const formattedErrorDetails = [
    error.name ? `${error.name}: ${error.message}` : error.message,
    componentStack?.trim(),
    isDev ? error.stack?.trim() : null,
  ]
    .filter((part): part is string => Boolean(part))
    .join('\n\n');

  return (
    <div role="alert" className={containerClassName}>
      <div className={titleClassName}>
        {variant === 'inline' ? 'Error' : 'Something went wrong'}
      </div>
      {variant === 'inline' ? (
        <div className={descClassName}>Retry this part.</div>
      ) : (
        <div className={descClassName}>
          The app is still running. You can retry this section, or reload the page.
        </div>
      )}
      {showErrorDetails && !containsRawConvexServerDetails && formattedErrorDetails ? (
        <pre className="mt-3 w-full max-w-3xl overflow-auto rounded-md bg-muted/60 p-3 text-left text-xs text-foreground">
          {formattedErrorDetails}
        </pre>
      ) : null}
      <div
        className={
          variant === 'page'
            ? 'mt-4 flex flex-wrap justify-center gap-2'
            : variant === 'inline'
              ? 'flex gap-2'
              : 'mt-3 flex gap-2'
        }
      >
        <button
          type="button"
          className={variant === 'inline' ? secondaryButton : primaryButton}
          onClick={resetErrorBoundary}
        >
          Try again
        </button>
        {variant === 'inline' ? null : (
          <button
            type="button"
            className={secondaryButton}
            onClick={() => {
              if (typeof window === 'undefined') return;
              window.location.reload();
            }}
          >
            Reload
          </button>
        )}
      </div>
    </div>
  );
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null, componentStack: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error, componentStack: null };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    if (this.props.propagateAuthErrors !== false && isConvexUnauthenticatedError(error)) {
      return;
    }

    this.setState({ componentStack: info.componentStack ?? null });
    this.props.onError?.(error, info);

    const boundaryName = this.props.name ?? 'unknown';
    // Authoritative crash report: send the full exception (stack + component
    // stack) to PostHog error tracking. posthog-js groups by the exception
    // itself; the boundary name and React component stack ride along as
    // properties for triage.
    try {
      deferredPostHog.captureException(error, {
        errorBoundary: boundaryName,
        componentStack: info.componentStack,
      });
    } catch {
      // ignore reporting failures
    }

    // Separate product-level signal: forward only the low-cardinality churn
    // attribution fields (boundary, reason_code, fingerprint) — never the stack
    // — so churn dashboards can attribute crashes without re-sending the raw
    // exception. Tier A (full): error_boundary_triggered is a churn event.
    try {
      capturePostHogEvent(deferredPostHog, 'app/error_boundary_triggered', {
        boundary_name: boundaryName,
        variant: this.props.variant ?? 'section',
        error_type: error.name || 'Error',
        reason_code: classifyBoundaryReason(error),
        error_fingerprint: computeErrorFingerprint(error, boundaryName),
        source: 'error_boundary',
        workspace_id: readWorkspaceId(),
      });
    } catch {
      // Analytics is side-effect-only: must never throw into product code.
    }
  }

  override componentDidUpdate(prevProps: Readonly<ErrorBoundaryProps>) {
    if (!this.state.error) return;
    if (!didResetKeysChange(prevProps.resetKeys, this.props.resetKeys)) return;

    this.reset();
  }

  private reset = () => {
    this.props.onReset?.();
    this.setState({ error: null, componentStack: null });
  };

  override render() {
    const { error } = this.state;
    if (!error) {
      return this.props.children;
    }
    if (this.props.propagateAuthErrors !== false && isConvexUnauthenticatedError(error)) {
      throw error;
    }

    const fallbackProps: ErrorBoundaryFallbackProps = {
      error,
      resetErrorBoundary: this.reset,
    };

    if (this.props.fallbackRender) {
      return this.props.fallbackRender(fallbackProps);
    }

    if (this.props.fallback) {
      return this.props.fallback;
    }

    return (
      <DefaultFallback
        {...fallbackProps}
        variant={this.props.variant ?? 'section'}
        componentStack={this.state.componentStack}
        showErrorDetails={this.props.showErrorDetails ?? import.meta.env.DEV}
      />
    );
  }
}
