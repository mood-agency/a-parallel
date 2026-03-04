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
  onInterrupt: () => void;
  onQueue: () => void;
  onCancel: () => void;
}

export function FollowUpModeDialog({
  open,
  onInterrupt,
  onQueue,
  onCancel,
}: FollowUpModeDialogProps) {
  const { t } = useTranslation();

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onCancel()}>
      <DialogContent className="sm:max-w-sm" data-testid="followup-mode-dialog">
        <DialogHeader>
          <DialogTitle>{t('thread.followUpDialogTitle')}</DialogTitle>
          <DialogDescription>{t('thread.followUpDialogDesc')}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-col gap-2 sm:flex-col">
          <Button
            data-testid="followup-interrupt"
            variant="default"
            className="w-full"
            onClick={onInterrupt}
          >
            {t('thread.followUpInterrupt')}
          </Button>
          <Button
            data-testid="followup-queue"
            variant="secondary"
            className="w-full"
            onClick={onQueue}
          >
            {t('thread.followUpQueue')}
          </Button>
          <Button
            data-testid="followup-cancel"
            variant="ghost"
            className="w-full"
            onClick={onCancel}
          >
            {t('thread.followUpCancel')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
