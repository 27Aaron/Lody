import { ImagePlus, Paperclip, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/ui/button';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu';

export interface AttachmentAddMenuProps {
  /** Larger trigger + roomier items for touch; desktop and mobile both use the
   * same upward popover dropdown. */
  isMobile: boolean;
  /** Smaller trigger for the landing composer variant. */
  isLanding?: boolean;
  /** Disables the whole trigger (e.g. the prompt is disabled). */
  disabled?: boolean;
  /** Omit a callback to hide that menu item entirely. */
  onAddImage?: () => void;
  onAddFile?: () => void;
  /** Per-item disabled (e.g. that type's pending-count limit is reached). */
  imageDisabled?: boolean;
  fileDisabled?: boolean;
}

/**
 * The single bottom-left "+" attachment entry point for the composer. Replaces
 * the previous always-on image + paperclip icons: one rounded "+" that opens an
 * upward popover dropdown with "upload image" / "upload file". Same dropdown on
 * desktop and mobile (mobile just gets larger touch targets).
 *
 * Pure/presentational: the file pickers live in onAddImage/onAddFile (image
 * picker scopes to accept="image/*"; file is unfiltered). Drag/drop and paste
 * bypass this menu entirely. Items are hidden when their callback is absent, so
 * the menu degrades to a single action if a surface only allows one type.
 */
export function AttachmentAddMenu({
  isMobile,
  isLanding,
  disabled,
  onAddImage,
  onAddFile,
  imageDisabled,
  fileDisabled,
}: AttachmentAddMenuProps) {
  const { t } = useTranslation();
  const triggerLabel = t('sessions.addAttachmentMenu', 'Add attachment');
  const imageLabel = t('sessions.uploadImage', 'Upload image');
  const fileLabel = t('sessions.uploadFile', 'Upload file');

  if (!onAddImage && !onAddFile) {
    return null;
  }

  const triggerSize = !isLanding && isMobile ? 'size-9' : 'size-7';
  const itemClass = cn('cursor-pointer', isMobile && 'gap-2.5 py-2.5 text-[15px]');
  const iconClass = 'size-4 shrink-0 text-muted-foreground';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={disabled}
          aria-label={triggerLabel}
          className={cn(
            triggerSize,
            // Light-stroke "+" with a circular hover/open fill. `bg-hover` (not
            // `bg-accent`/`bg-muted`) because those equal the background in the
            // dark theme and paint nothing.
            'rounded-full text-foreground transition-colors',
            'hover:bg-hover hover:text-foreground',
            'data-[state=open]:bg-hover data-[state=open]:text-foreground'
          )}
        >
          <Plus strokeWidth={1.5} className={isMobile ? 'size-6' : 'size-5'} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        side="top"
        /* Size to the widest item (`w-max`) so short labels like "Upload
           image" don't leave a wide blank gutter; a small floor keeps it from
           collapsing too narrow. */
        className={cn('w-max', isMobile ? 'min-w-[160px]' : 'min-w-[140px]')}
      >
        {onAddImage ? (
          <DropdownMenuItem onSelect={onAddImage} disabled={imageDisabled} className={itemClass}>
            <ImagePlus className={iconClass} />
            {imageLabel}
          </DropdownMenuItem>
        ) : null}
        {onAddFile ? (
          <DropdownMenuItem onSelect={onAddFile} disabled={fileDisabled} className={itemClass}>
            <Paperclip className={iconClass} />
            {fileLabel}
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
