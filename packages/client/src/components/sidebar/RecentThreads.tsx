import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useThreadStore } from '@/stores/thread-store';
import { useProjectStore } from '@/stores/project-store';
import { cn } from '@/lib/utils';
import { statusConfig } from '@/lib/thread-utils';
import { History } from 'lucide-react';
import type { Thread, ThreadStatus } from '@a-parallel/shared';

const FINISHED_STATUSES: ThreadStatus[] = ['completed', 'failed', 'stopped', 'interrupted'];

interface FinishedThread extends Thread {
  projectName: string;
}

export function RecentThreads() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const threadsByProject = useThreadStore(s => s.threadsByProject);
  const selectedThreadId = useThreadStore(s => s.selectedThreadId);
  const projects = useProjectStore(s => s.projects);

  const recentThreads = useMemo(() => {
    const result: FinishedThread[] = [];
    const projectMap = new Map(projects.map(p => [p.id, p.name]));

    for (const [projectId, threads] of Object.entries(threadsByProject)) {
      for (const thread of threads) {
        if (FINISHED_STATUSES.includes(thread.status)) {
          result.push({
            ...thread,
            projectName: projectMap.get(projectId) ?? projectId,
          });
        }
      }
    }

    result.sort((a, b) => {
      const dateA = a.completedAt ?? a.createdAt;
      const dateB = b.completedAt ?? b.createdAt;
      return new Date(dateB).getTime() - new Date(dateA).getTime();
    });

    return result.slice(0, 10);
  }, [threadsByProject, projects]);

  if (recentThreads.length === 0) return null;

  return (
    <div className="px-2 pb-1">
      <div className="flex items-center gap-1.5 px-2 py-1.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
        <History className="h-3 w-3" />
        {t('sidebar.recentThreads')}
      </div>
      <div className="space-y-0.5">
        {recentThreads.map((thread) => {
          const s = statusConfig[thread.status as ThreadStatus] ?? statusConfig.completed;
          const Icon = s.icon;
          const isSelected = selectedThreadId === thread.id;

          return (
            <button
              key={thread.id}
              onClick={() => {
                const store = useThreadStore.getState();
                if (store.selectedThreadId === thread.id && (!store.activeThread || store.activeThread.id !== thread.id)) {
                  store.selectThread(thread.id);
                }
                navigate(`/projects/${thread.projectId}/threads/${thread.id}`);
              }}
              className={cn(
                'w-full flex items-center gap-1.5 rounded-md px-2 py-1.5 text-left transition-colors min-w-0',
                isSelected
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
              )}
            >
              <Icon className={cn('h-3 w-3 flex-shrink-0', s.className)} />
              <div className="flex flex-col gap-0 min-w-0 flex-1">
                <span className="text-[11px] leading-tight truncate">{thread.title}</span>
                <span className="text-[10px] text-muted-foreground truncate">{thread.projectName}</span>
              </div>
              {thread.completedAt && (
                <span className="text-[10px] text-muted-foreground flex-shrink-0 tabular-nums">
                  {new Date(thread.completedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
