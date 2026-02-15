import { Suspense } from 'react';
import { FileCode } from 'lucide-react';
import { ReactDiffViewer, DIFF_VIEWER_STYLES, getFileName } from './utils';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';

interface ExpandedDiffDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filePath: string;
  oldValue: string;
  newValue: string;
}

export function ExpandedDiffDialog({ open, onOpenChange, filePath, oldValue, newValue }: ExpandedDiffDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[90vw] w-[90vw] h-[85vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-4 py-3 pr-10 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-2">
            <FileCode className="h-4 w-4 flex-shrink-0" />
            <DialogTitle className="font-mono text-sm truncate">{filePath}</DialogTitle>
          </div>
          <DialogDescription className="sr-only">Diff for {getFileName(filePath)}</DialogDescription>
        </DialogHeader>
        <ScrollArea className="flex-1 min-h-0">
          <div className="[&_.diff-container]:font-mono [&_table]:w-full [&_td]:overflow-hidden [&_td]:text-ellipsis">
            <Suspense fallback={<div className="p-4 text-sm text-muted-foreground">Loading diff...</div>}>
              <ReactDiffViewer
                oldValue={oldValue}
                newValue={newValue}
                splitView={true}
                useDarkTheme={true}
                hideLineNumbers={false}
                showDiffOnly={true}
                styles={DIFF_VIEWER_STYLES}
              />
            </Suspense>
          </div>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
