import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useThreadStore } from '@/stores/thread-store';
import { useProjectStore } from '@/stores/project-store';
import { cn } from '@/lib/utils';
import { statusConfig } from '@/lib/thread-utils';
import type { Thread, ThreadStatus } from '@a-parallel/shared';

interface RunningThread extends Thread {
  projectName: string;
}

export function RunningThreads() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const threadsByProject = useThreadStore(s => s.threadsByProject);
  const selectedThreadId = useThreadStore(s => s.selectedThreadId);
  const projects = useProjectStore(s => s.projects);

  const runningThreads = useMemo(() => {
    const result: RunningThread[] = [];
    const projectMap = new Map(projects.map(p => [p.id, p.name]));

    for (const [projectId, threads] of Object.entries(threadsByProject)) {
      for (const thread of threads) {
        if (thread.status === 'running' || thread.status === 'waiting') {
          result.push({
            ...thread,
            projectName: projectMap.get(projectId) ?? projectId,
          });
        }
      }
    }
    return result;
  }, [threadsByProject, projects]);

  if (runningThreads.length === 0) return null;

  return (
    <div className="px-2 pb-1">
      <div className="flex items-center gap-1.5 px-2 py-1.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
        <span className="h-1.5 w-1.5 rounded-full bg-blue-400 animate-pulse" />
        {t('sidebar.activeThreads')} ({runningThreads.length})
      </div>
      <div className="space-y-0.5">
        {runningThreads.map((thread) => {
          const s = statusConfig[thread.status as ThreadStatus] ?? statusConfig.running;
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
            </button>
          );
        })}
      </div>
    </div>
  );
}
