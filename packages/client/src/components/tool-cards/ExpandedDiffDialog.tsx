import { FileCode, Loader2 } from 'lucide-react';
import { type ComponentType, Suspense } from 'react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { useDiffHighlight } from '@/hooks/use-diff-highlight';

import { ReactDiffViewer, DIFF_VIEWER_STYLES, getFileName } from './utils';

interface ExpandedDiffDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filePath: string;
  oldValue: string;
  newValue: string;
  /** Optional icon override (defaults to FileCode) */
  icon?: ComponentType<{ className?: string }>;
  /** When true, shows a loading spinner instead of the diff */
  loading?: boolean;
  /** Screen-reader description override */
  description?: string;
}

export function ExpandedDiffDialog({
  open,
  onOpenChange,
  filePath,
  oldValue,
  newValue,
  icon: Icon = FileCode,
  loading = false,
  description,
}: ExpandedDiffDialogProps) {
  const { renderContent } = useDiffHighlight(oldValue, newValue, filePath);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[85vh] w-[90vw] max-w-[90vw] flex-col gap-0 p-0">
        <DialogHeader className="flex-shrink-0 overflow-hidden border-b border-border px-4 py-3">
          <DialogTitle className="flex min-w-0 items-center gap-2 overflow-hidden font-mono text-sm">
            <Icon className="h-4 w-4 flex-shrink-0" />
            <span
              className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap"
              style={{ direction: 'rtl', textAlign: 'left' }}
            >
              {filePath}
            </span>
          </DialogTitle>
          <DialogDescription className="sr-only">
            {description || `Diff for ${getFileName(filePath)}`}
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="min-h-0 flex-1">
          {loading ? (
            <div className="flex items-center gap-2 p-4 text-xs text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading diff…
            </div>
          ) : oldValue || newValue ? (
            <div className="[&_.diff-container]:font-mono [&_table]:w-full [&_td]:overflow-hidden [&_td]:text-ellipsis">
              <Suspense
                fallback={<div className="p-4 text-xs text-muted-foreground">Loading diff…</div>}
              >
                <ReactDiffViewer
                  oldValue={oldValue}
                  newValue={newValue}
                  splitView={true}
                  useDarkTheme={true}
                  hideLineNumbers={false}
                  showDiffOnly={true}
                  styles={DIFF_VIEWER_STYLES}
                  renderContent={renderContent}
                />
              </Suspense>
            </div>
          ) : (
            <p className="p-4 text-xs text-muted-foreground">No diff available</p>
          )}
          <ScrollBar orientation="horizontal" />
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
