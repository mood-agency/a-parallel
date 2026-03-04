import { ListOrdered, Zap } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface FollowUpModeDialogProps {
  open: boolean;
  messagePreview: string;
  onInterrupt: () => void;
  onQueue: () => void;
  onCancel: () => void;
}

export function FollowUpModeDialog({
  open,
  messagePreview,
  onInterrupt,
  onQueue,
  onCancel,
}: FollowUpModeDialogProps) {
  const { t } = useTranslation();

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) onCancel();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('followUpDialog.title')}</DialogTitle>
          <DialogDescription>{t('followUpDialog.description')}</DialogDescription>
        </DialogHeader>
        {messagePreview && (
          <div className="max-h-24 overflow-hidden rounded-md border bg-muted/50 px-3 py-2">
            <p className="line-clamp-3 whitespace-pre-wrap text-xs text-muted-foreground">
              {messagePreview}
            </p>
          </div>
        )}
        <DialogFooter className="flex gap-2 sm:flex-row">
          <Button variant="outline" onClick={onCancel}>
            {t('followUpDialog.cancel')}
          </Button>
          <Button variant="secondary" onClick={onQueue}>
            <ListOrdered className="mr-1.5 h-3.5 w-3.5" />
            {t('followUpDialog.queue')}
          </Button>
          <Button variant="destructive" onClick={onInterrupt}>
            <Zap className="mr-1.5 h-3.5 w-3.5" />
            {t('followUpDialog.interrupt')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
