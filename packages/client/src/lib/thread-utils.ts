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

export function timeAgo(dateStr: string, t: (key: string, opts?: any) => string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return t('time.now');
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return t('time.minutes', { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('time.hours', { count: hours });
  const days = Math.floor(hours / 24);
  if (days < 30) return t('time.days', { count: days });
  return t('time.months', { count: Math.floor(days / 30) });
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
