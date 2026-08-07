import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { cn } from '@/lib/utils';
import { useActiveVSCodeThemeId, useResolvedTheme } from '../../theme-provider';

export type AgentActivityTone = 'primary' | 'warning' | 'success' | 'destructive' | 'neutral';

type AgentActivityIndicatorProps = {
  color?: string;
  tone?: AgentActivityTone;
  displaySize?: number;
  canvasSize?: number;
  label?: string;
  className?: string;
  labelClassName?: string;
  labelHighlightCount?: number;
  labelHighlightIntervalMs?: number;
  labelHighlightPauseMs?: number;
};

const DEFAULT_DISPLAY_SIZE = 24;
const DEFAULT_CANVAS_SCALE = 2;
const LOOP_MS = 7_000;
const TWO_PI = Math.PI * 2;
const DEFAULT_COLOR = '#7dd3fc';

const getPhase = (elapsedMs: number): number => ((elapsedMs % LOOP_MS) / LOOP_MS) * TWO_PI;

const ACTIVITY_TONE_VARIABLE_MAP: Record<AgentActivityTone, string> = {
  primary: '--primary',
  warning: '--status-warning',
  success: '--status-success',
  destructive: '--destructive',
  neutral: '--muted-foreground',
};

const ACTIVITY_TONE_LABEL_STYLES: Record<
  AgentActivityTone,
  { baseColor: string; highlightColor: string; highlightGlow: string }
> = {
  primary: {
    baseColor: 'hsl(var(--primary) / 0.68)',
    highlightColor: 'hsl(var(--primary) / 0.96)',
    highlightGlow: '0 0 0.7rem hsl(var(--primary) / 0.2)',
  },
  warning: {
    baseColor: 'hsl(var(--status-warning) / 0.72)',
    highlightColor: 'hsl(var(--status-warning) / 0.96)',
    highlightGlow: '0 0 0.7rem hsl(var(--status-warning) / 0.18)',
  },
  success: {
    baseColor: 'hsl(var(--status-success) / 0.72)',
    highlightColor: 'hsl(var(--status-success) / 0.96)',
    highlightGlow: '0 0 0.7rem hsl(var(--status-success) / 0.18)',
  },
  destructive: {
    baseColor: 'hsl(var(--destructive) / 0.72)',
    highlightColor: 'hsl(var(--destructive) / 0.96)',
    highlightGlow: '0 0 0.7rem hsl(var(--destructive) / 0.18)',
  },
  neutral: {
    baseColor: 'hsl(var(--muted-foreground) / 0.7)',
    highlightColor: 'hsl(var(--foreground) / 0.9)',
    highlightGlow: '0 0 0.65rem hsl(var(--foreground) / 0.08)',
  },
};

const readRootHslVariable = (variableName: string, fallback: string): string => {
  if (typeof window === 'undefined') {
    return fallback;
  }
  const channel = window
    .getComputedStyle(document.documentElement)
    .getPropertyValue(variableName)
    .trim();
  return channel ? `hsl(${channel})` : fallback;
};

export function AgentActivityIndicator({
  color,
  tone = 'primary',
  displaySize = DEFAULT_DISPLAY_SIZE,
  canvasSize,
  label,
  className,
  labelClassName,
  labelHighlightCount = 5,
  labelHighlightIntervalMs = 50,
  labelHighlightPauseMs = 2000,
}: AgentActivityIndicatorProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const startRef = useRef<number | null>(null);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const [resolvedColor, setResolvedColor] = useState(() => color ?? DEFAULT_COLOR);
  const resolvedTheme = useResolvedTheme();
  const activeVSCodeThemeId = useActiveVSCodeThemeId();

  const resolvedCanvasSize = canvasSize ?? displaySize * DEFAULT_CANVAS_SCALE;
  const labelChars = useMemo(() => (label ? Array.from(label) : []), [label]);

  useEffect(() => {
    if (color) {
      setResolvedColor(color);
      return;
    }
    // ThemeProvider applies CSS variables in a layout effect; read them after that commit.
    void activeVSCodeThemeId;
    void resolvedTheme;
    setResolvedColor(readRootHslVariable(ACTIVITY_TONE_VARIABLE_MAP[tone], DEFAULT_COLOR));
  }, [activeVSCodeThemeId, color, resolvedTheme, tone]);

  const labelToneStyle = ACTIVITY_TONE_LABEL_STYLES[tone];

  const config = useMemo(
    () => ({
      size: resolvedCanvasSize,
      baseRadius: resolvedCanvasSize * 0.12,
      radiusGrow: resolvedCanvasSize * 0.05,
    }),
    [resolvedCanvasSize]
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return undefined;
    }

    const context = canvas.getContext('2d');
    if (!context) {
      return undefined;
    }

    const devicePixelRatio = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    canvas.width = config.size * devicePixelRatio;
    canvas.height = config.size * devicePixelRatio;
    canvas.style.width = `${displaySize}px`;
    canvas.style.height = `${displaySize}px`;
    context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);

    const tick = (time: number) => {
      if (startRef.current === null) {
        startRef.current = time;
      }

      const elapsed = time - startRef.current;
      const phase = getPhase(elapsed);
      const pulse = 0.5 + 0.5 * Math.sin(phase * 2 + Math.PI * 0.5);
      const radius = config.baseRadius + config.radiusGrow * pulse;
      const center = config.size / 2;

      context.clearRect(0, 0, config.size, config.size);
      context.globalCompositeOperation = 'lighter';
      const y = center;
      context.beginPath();
      context.fillStyle = resolvedColor;
      context.globalAlpha = 0.35 + pulse * 0.45;
      context.arc(center, y, radius, 0, TWO_PI);
      context.fill();

      context.globalAlpha = 1;
      rafRef.current = window.requestAnimationFrame(tick);
      return undefined;
    };

    rafRef.current = window.requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
      }
    };
  }, [config, displaySize, resolvedColor]);

  useEffect(() => {
    if (labelChars.length === 0) {
      setHighlightIndex(-1);
      return undefined;
    }

    let cancelled = false;
    let timeoutId: number | null = null;
    let currentIndex = 0;

    const intervalMs = Math.max(60, labelHighlightIntervalMs);
    const pauseMs = Math.max(200, labelHighlightPauseMs);
    // lastIndex needs to go beyond text length so the window can slide completely off
    const lastIndex = labelChars.length + labelHighlightCount - 1;

    const clearTimer = () => {
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
        timeoutId = null;
      }
    };

    const runStep = () => {
      if (cancelled) {
        return;
      }
      setHighlightIndex(currentIndex);
      if (currentIndex >= lastIndex) {
        timeoutId = window.setTimeout(() => {
          setHighlightIndex(-1);
          timeoutId = window.setTimeout(() => {
            currentIndex = 0;
            runStep();
          }, pauseMs);
        }, intervalMs);
        return;
      }
      currentIndex += 1;
      timeoutId = window.setTimeout(runStep, intervalMs);
    };

    runStep();

    return () => {
      cancelled = true;
      clearTimer();
    };
  }, [labelChars.length, labelHighlightCount, labelHighlightIntervalMs, labelHighlightPauseMs]);

  return (
    <div className={cn('inline-flex items-center gap-1.5', className)}>
      <canvas ref={canvasRef} aria-hidden="true" />
      {labelChars.length > 0 ? (
        <span className={cn('text-sm', labelClassName)}>
          {labelChars.map((char, index) => {
            // highlightIndex is the right edge of the highlight window (inclusive)
            // Window starts at max(0, highlightIndex - labelHighlightCount + 1)
            // This naturally creates the growing effect: at index 0, only char 0 is highlighted;
            // as index increases, window grows until it reaches labelHighlightCount, then slides.
            const highlightStart = Math.max(0, highlightIndex - labelHighlightCount + 1);
            const isHighlighted =
              highlightIndex >= 0 && index >= highlightStart && index <= highlightIndex;
            const charStyle: CSSProperties = {
              color: isHighlighted ? labelToneStyle.highlightColor : labelToneStyle.baseColor,
              textShadow: isHighlighted ? labelToneStyle.highlightGlow : 'none',
            };
            return (
              <span
                key={`${char}-${index}`}
                className="transition-[color,text-shadow] duration-200"
                style={charStyle}
              >
                {char}
              </span>
            );
          })}
        </span>
      ) : null}
    </div>
  );
}
