import { useMemo, useRef } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Pencil, X, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { MessageQueueItem, SessionId } from '@lody/shared';
import { normalizeSessionInputBlocks } from '@lody/shared';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip';
import { cn } from '@/lib/utils';
import { QueuedImagePreview, type QueuedImageBlock } from './queued-image-preview';
import { getEditableTaskText } from './use-message-queue-editing';

const MAX_INLINE_IMAGES = 3;

export type MessageQueueRowProps = {
  sessionId: SessionId;
  item: MessageQueueItem;
  index: number;
  isFirst: boolean;
  showSteerAction: boolean;
  canReorder: boolean;
  isEditing: boolean;
  editValue: string;
  isPending: boolean;
  onEditValueChange: (value: string) => void;
  onStartEdit: (item: MessageQueueItem) => void;
  onCancelEdit: (item: MessageQueueItem) => void;
  onSaveEdit: (item: MessageQueueItem) => void;
  onRemove: (cid: string) => void | Promise<void>;
  onSteer: (item: MessageQueueItem) => void | Promise<void>;
};

export function MessageQueueRow(props: MessageQueueRowProps) {
  const { item, canReorder, isEditing } = props;
  const sortable = useSortable({ id: item.$cid, disabled: !canReorder || isEditing });
  const constrainedTransform = sortable.transform
    ? { ...sortable.transform, x: 0, scaleX: 1, scaleY: 1 }
    : null;
  const style = {
    transform: CSS.Transform.toString(constrainedTransform),
    transition: sortable.transition,
  };

  return (
    <div
      ref={sortable.setNodeRef}
      style={style}
      className={cn(
        'group/row relative flex items-start gap-2 px-2 py-1.5',
        'transition-colors',
        sortable.isDragging && 'z-10 bg-muted/40 opacity-90 shadow-sm',
        isEditing && 'bg-background/60'
      )}
    >
      <LeadingHandle {...props} sortable={sortable} />
      <RowBody {...props} />
      <RowActions {...props} />
    </div>
  );
}

function LeadingHandle({
  index,
  canReorder,
  isEditing,
  sortable,
}: MessageQueueRowProps & { sortable: ReturnType<typeof useSortable> }) {
  const { t } = useTranslation();
  const label = t('sessions.messageQueue.dragToReorder', 'Drag to reorder');

  if (!canReorder || isEditing) {
    return (
      <div
        aria-hidden="true"
        className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center text-[10px] font-medium tabular-nums text-muted-foreground/60"
      >
        {index + 1}
      </div>
    );
  }

  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>
        <button
          type="button"
          ref={sortable.setActivatorNodeRef}
          className={cn(
            'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded',
            'text-[10px] font-medium tabular-nums text-muted-foreground/60',
            'cursor-grab transition-colors active:cursor-grabbing',
            'hover:bg-muted hover:text-foreground',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40'
          )}
          aria-label={label}
          {...sortable.attributes}
          {...sortable.listeners}
        >
          <span className="block group-hover/row:hidden group-focus-within/row:hidden">
            {index + 1}
          </span>
          <GripVertical className="hidden h-3 w-3 group-hover/row:block group-focus-within/row:block" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
}

function RowBody(props: MessageQueueRowProps) {
  const { t } = useTranslation();
  const {
    sessionId,
    item,
    isEditing,
    editValue,
    isPending,
    onEditValueChange,
    onCancelEdit,
    onSaveEdit,
  } = props;

  const imageBlocks = useMemo(
    () =>
      normalizeSessionInputBlocks(item.acpSessionConfig?.inputBlocks, '').filter(
        (block): block is QueuedImageBlock => block.type === 'image'
      ),
    [item.acpSessionConfig?.inputBlocks]
  );
  const inlineImages = imageBlocks.slice(0, MAX_INLINE_IMAGES);
  const overflowImageCount = Math.max(0, imageBlocks.length - inlineImages.length);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  if (isEditing) {
    // Blur is the only commit path: no Save/Cancel buttons. Esc + Cmd/Ctrl+Enter
    // just blur the field, which fires the same commit logic — there is no separate
    // "discard changes" affordance by design.
    const commit = () => {
      const original = getEditableTaskText(item).trim();
      const current = editValue.trim();
      if (current === original) {
        // Nothing changed: just clear isEditing without writing.
        onCancelEdit(item);
        return;
      }
      if (current.length === 0 && imageBlocks.length === 0) {
        // Don't let blur wipe the queued message to an empty prompt; revert instead.
        onCancelEdit(item);
        return;
      }
      onSaveEdit(item);
    };

    return (
      <div className="min-w-0 flex-1">
        <textarea
          ref={textareaRef}
          value={editValue}
          rows={3}
          className={cn(
            'block w-full resize-none rounded-md border border-border/60 bg-background/80',
            'px-2 py-1 text-xs leading-snug text-foreground outline-none',
            'focus:border-ring focus:ring-2 focus:ring-ring/20'
          )}
          autoFocus
          disabled={isPending}
          aria-label={t('sessions.messageQueue.editMessage', 'Edit queued message')}
          onChange={(event) => onEditValueChange(event.currentTarget.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              event.currentTarget.blur();
              return;
            }
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              event.currentTarget.blur();
            }
          }}
        />
        {inlineImages.length > 0 ? (
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {inlineImages.map((image, i) => (
              <QueuedImagePreview
                key={`${image.imageId}-${i}`}
                sessionId={sessionId}
                image={image}
                size={20}
              />
            ))}
            {overflowImageCount > 0 ? (
              <span className="text-[10px] text-muted-foreground/70">+{overflowImageCount}</span>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-1 items-start gap-1.5">
      {inlineImages.length > 0 ? (
        <div className="flex shrink-0 items-center gap-0.5 pt-px">
          {inlineImages.map((image, i) => (
            <QueuedImagePreview
              key={`${image.imageId}-${i}`}
              sessionId={sessionId}
              image={image}
              size={18}
            />
          ))}
          {overflowImageCount > 0 ? (
            <span className="ml-0.5 text-[10px] text-muted-foreground/70 tabular-nums">
              +{overflowImageCount}
            </span>
          ) : null}
        </div>
      ) : null}
      <div
        className="min-w-0 flex-1 overflow-hidden text-xs leading-snug text-foreground/80"
        style={{
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
        }}
      >
        {item.task}
      </div>
    </div>
  );
}

function RowActions(props: MessageQueueRowProps) {
  const { t } = useTranslation();
  const { item, isFirst, showSteerAction, isEditing, onStartEdit, onRemove, onSteer } = props;

  // In edit mode the textarea owns the row: blur is the commit path, so we don't
  // render any actions that would compete for the click and steal focus mid-edit.
  if (isEditing) {
    return null;
  }

  return (
    <div className="flex shrink-0 items-center gap-0.5">
      {isFirst && showSteerAction ? (
        <TextAction
          text={t('sessions.messageQueue.guideAction', 'Steer')}
          ariaLabel={t(
            'sessions.messageQueue.guide',
            'Steer the active response with this message'
          )}
          onClick={() => {
            void onSteer(item);
          }}
        />
      ) : null}
      <IconAction
        icon={Pencil}
        label={t('sessions.messageQueue.editMessage', 'Edit queued message')}
        onClick={() => onStartEdit(item)}
      />
      <IconAction
        icon={X}
        label={t('sessions.messageQueue.remove', 'Remove from queue')}
        destructive
        onClick={() => {
          void onRemove(item.$cid);
        }}
      />
    </div>
  );
}

function TextAction({
  text,
  ariaLabel,
  onClick,
}: {
  text: string;
  ariaLabel: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      className={cn(
        'flex h-5 shrink-0 items-center justify-center rounded px-1.5',
        'text-[11px] font-medium text-muted-foreground transition-colors',
        'hover:bg-muted hover:text-foreground',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40'
      )}
      onClick={onClick}
    >
      {text}
    </button>
  );
}

function IconAction({
  icon: Icon,
  label,
  destructive,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  destructive?: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className={cn(
            'flex h-5 w-5 items-center justify-center rounded',
            'text-muted-foreground/60 transition-colors',
            'hover:bg-muted hover:text-foreground',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
            destructive && 'hover:text-destructive'
          )}
          onClick={onClick}
        >
          <Icon className="h-3 w-3" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
}
