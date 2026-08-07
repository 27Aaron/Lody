import { useCallbackRef, useComposedRefs } from '@diceui/shared';
import * as React from 'react';
import { observeResizeOnAnimationFrame } from '@/lib/resize-observer';
import { type Mention, useMentionContext } from './mention-root';

const HIGHLIGHTER_NAME = 'MentionHighlighter';

type HighlighterElement = HTMLDivElement;

const defaultHighlighterStyle: React.CSSProperties = {
  position: 'absolute',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  zIndex: 0,
  color: 'transparent',
  whiteSpace: 'pre-wrap',
  wordWrap: 'break-word',
  pointerEvents: 'none',
  userSelect: 'none',
  overflow: 'hidden',
  width: '100%',
};

interface MentionHighlighterProps extends React.HTMLAttributes<HighlighterElement> {}

type MentionHighlightSegment =
  | {
      type: 'text' | 'space';
      key: string;
      text: string;
    }
  | {
      type: 'mention';
      key: string;
      text: string;
      mention: Mention;
    };

export function getMentionHighlightSegments(
  value: string,
  mentions: readonly Mention[]
): MentionHighlightSegment[] {
  const segments: MentionHighlightSegment[] = [];
  let lastIndex = 0;

  for (const mention of [...mentions].sort((a, b) => a.start - b.start)) {
    const { start, end } = mention;
    if (start < lastIndex || start < 0 || end <= start || end > value.length) {
      continue;
    }

    if (start > lastIndex) {
      segments.push({
        type: 'text',
        key: `text-${lastIndex}`,
        text: value.slice(lastIndex, start),
      });
    }

    segments.push({
      type: 'mention',
      key: `mention-${start}-${end}-${mention.kind ?? 'mention'}-${mention.value}`,
      text: value.slice(start, end),
      mention,
    });

    lastIndex = end;
  }

  if (lastIndex < value.length) {
    segments.push({
      type: 'text',
      key: `text-end-${value.length}`,
      text: value.slice(lastIndex),
    });
  }

  segments.push({ type: 'space', key: 'space', text: '\u00a0' });
  return segments;
}

const MentionHighlighter = React.memo(
  React.forwardRef<HighlighterElement, MentionHighlighterProps>((props, forwardedRef) => {
    const { style, ...highlighterProps } = props;
    const context = useMentionContext(HIGHLIGHTER_NAME);
    const highlighterRef = React.useRef<HighlighterElement>(null);
    const composedRef = useComposedRefs(forwardedRef, highlighterRef);
    const [inputStyle, setInputStyle] = React.useState<CSSStyleDeclaration>();
    const onInputStyleChangeCallback = useCallbackRef(setInputStyle);

    const onInputStyleChange = React.useCallback(() => {
      const inputElement = context.inputRef.current;
      if (!inputElement) return;

      const computedStyle = window.getComputedStyle(inputElement);
      onInputStyleChangeCallback(computedStyle);
    }, [context.inputRef, onInputStyleChangeCallback]);

    const onSyncScrollAndResize = React.useCallback(() => {
      const inputElement = context.inputRef.current;
      const highlighterElement = highlighterRef.current;

      if (!inputElement || !highlighterElement) return;

      requestAnimationFrame(() => {
        highlighterElement.scrollTop = inputElement.scrollTop;
        highlighterElement.scrollLeft = inputElement.scrollLeft;
        highlighterElement.style.height = `${inputElement.offsetHeight}px`;
      });
    }, [context.inputRef]);

    React.useEffect(() => {
      const inputElement = context.inputRef.current;
      if (!inputElement) return undefined;

      onInputStyleChange();

      function onResize() {
        onInputStyleChange();
        onSyncScrollAndResize();
      }

      // Create a ResizeObserver to listen for the input's size changes
      const cleanupResizeObserver = observeResizeOnAnimationFrame(inputElement, () => onResize());

      // Create a MutationObserver to listen for the input's class changes
      const mutationObserver = new MutationObserver((mutations) => {
        if (mutations.some((m) => m.type === 'attributes' && m.attributeName === 'class')) {
          onResize();
        }
      });

      inputElement.addEventListener('scroll', onSyncScrollAndResize, {
        passive: true,
      });
      window.addEventListener('resize', onSyncScrollAndResize, {
        passive: true,
      });
      mutationObserver.observe(inputElement, {
        attributes: true,
        attributeFilter: ['class'],
      });

      return () => {
        inputElement.removeEventListener('scroll', onSyncScrollAndResize);
        window.removeEventListener('resize', onSyncScrollAndResize);
        cleanupResizeObserver();
        mutationObserver.disconnect();
      };
    }, [context.inputRef, onInputStyleChange, onSyncScrollAndResize]);

    const highlighterStyle = React.useMemo<React.CSSProperties>(() => {
      if (!inputStyle) return defaultHighlighterStyle;

      return {
        ...defaultHighlighterStyle,
        fontStyle: inputStyle.fontStyle,
        fontVariant: inputStyle.fontVariant,
        fontWeight: inputStyle.fontWeight,
        fontSize: inputStyle.fontSize,
        lineHeight: inputStyle.lineHeight,
        fontFamily: inputStyle.fontFamily,
        letterSpacing: inputStyle.letterSpacing,
        textTransform: inputStyle.textTransform as React.CSSProperties['textTransform'],
        textIndent: inputStyle.textIndent,
        padding: inputStyle.padding,
        borderWidth: inputStyle.borderWidth,
        borderStyle: inputStyle.borderStyle,
        borderColor: 'currentColor',
        borderRadius: inputStyle.borderRadius,
        boxSizing: inputStyle.boxSizing as React.CSSProperties['boxSizing'],
        wordBreak: inputStyle.wordBreak as React.CSSProperties['wordBreak'],
        overflowWrap: inputStyle.overflowWrap as React.CSSProperties['overflowWrap'],
        direction: context.dir,
        ...style,
      };
    }, [inputStyle, style, context.dir]);

    const onSegmentsRender = React.useCallback(
      () =>
        getMentionHighlightSegments(context.inputValue, context.mentions).map((segment) => {
          if (segment.type !== 'mention') {
            return <span key={segment.key}>{segment.text}</span>;
          }

          return (
            <span
              key={segment.key}
              data-tag=""
              data-mention-start={segment.mention.start}
              data-mention-end={segment.mention.end}
              data-mention-kind={segment.mention.kind ?? 'mention'}
              data-mention-value={segment.mention.value}
              className={
                segment.mention.kind === 'pasted_text'
                  ? 'rounded-md bg-foreground/10 box-decoration-clone'
                  : 'rounded-sm bg-primary/15 box-decoration-clone'
              }
            >
              {segment.text}
            </span>
          );
        }),
      [context.inputValue, context.mentions]
    );

    if (!inputStyle) return null;
    return (
      <div
        {...highlighterProps}
        ref={composedRef}
        dir={context.dir}
        data-mention-highlighter="true"
        style={highlighterStyle}
      >
        {onSegmentsRender()}
      </div>
    );
  }),
  (prevProps, nextProps) =>
    prevProps.style === nextProps.style &&
    Object.keys(prevProps).every(
      (key) => prevProps[key as keyof typeof prevProps] === nextProps[key as keyof typeof nextProps]
    )
);

MentionHighlighter.displayName = HIGHLIGHTER_NAME;

export { MentionHighlighter };
