import {
  CollapsibleCard,
  CollapsibleCardContent,
  CollapsibleCardHeader,
} from '@/ui/collapsible-card';
import { FileIcon } from '@/components/icons/file-icons';
import { cn } from '@/lib/utils';

export type SessionFileDiffNoticeCardProps = {
  filePath: string;
  message: string;
  stickyHeader?: boolean;
  className?: string;
};

export function SessionFileDiffNoticeCard({
  filePath,
  message,
  className,
}: SessionFileDiffNoticeCardProps) {
  // stickyHeader remains on the props type for API compatibility, but sticky is
  // forced off so overflow-hidden can clip the rounded card border.
  return (
    <CollapsibleCard
      className={cn(
        'min-h-8 w-full overflow-hidden rounded-xl border border-foreground/[0.12] bg-background text-[0.8rem] shadow-[0_1px_2px_hsl(0_0%_0%/0.04)] dark:border-border',
        className
      )}
      defaultOpen
      allowStickyChildren={false}
    >
      <CollapsibleCardHeader
        sticky={false}
        position="relative"
        className="inset-x-0 h-8 rounded-none border-b border-foreground/[0.08] bg-background pl-1 pr-4 dark:border-border"
      >
        <FileIcon filePath={filePath} className="h-4 w-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate text-sm text-foreground/90" title={filePath}>
          {filePath}
        </span>
      </CollapsibleCardHeader>
      <CollapsibleCardContent noInternalScroll className="pb-0">
        <div className="px-4 py-3 text-xs text-muted-foreground">{message}</div>
      </CollapsibleCardContent>
    </CollapsibleCard>
  );
}
