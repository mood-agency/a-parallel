import {
  Clock,
  Loader2,
  CheckCircle2,
  XCircle,
  Square,
  AlertTriangle,
} from 'lucide-react';
import type { ThreadStatus } from '@a-parallel/shared';

export const statusConfig: Record<ThreadStatus, { icon: typeof Clock; className: string }> = {
  pending: { icon: Clock, className: 'text-yellow-400' },
  running: { icon: Loader2, className: 'text-blue-400 animate-spin' },
  waiting: { icon: Clock, className: 'text-amber-400' },
  completed: { icon: CheckCircle2, className: 'text-green-400' },
  failed: { icon: XCircle, className: 'text-red-400' },
  stopped: { icon: Square, className: 'text-gray-400' },
  interrupted: { icon: AlertTriangle, className: 'text-orange-400' },
};

export function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function getStatusLabels(t: (key: string) => string): Record<ThreadStatus, string> {
  return {
    pending: t('thread.status.pending'),
    running: t('thread.status.running'),
    waiting: t('thread.status.waiting'),
    completed: t('thread.status.completed'),
    failed: t('thread.status.failed'),
    stopped: t('thread.status.stopped'),
    interrupted: t('thread.status.interrupted'),
  };
}
