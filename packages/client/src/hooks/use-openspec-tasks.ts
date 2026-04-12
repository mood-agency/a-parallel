import { useEffect, useRef, useState } from 'react';

import { api } from '@/lib/api';

interface TaskProgress {
  done: number;
  total: number;
}

interface UseOpenSpecTasksResult {
  content: string | null;
  progress: TaskProgress;
  loading: boolean;
}

const POLL_INTERVAL_MS = 5_000;
const EMPTY_PROGRESS: TaskProgress = { done: 0, total: 0 };

function parseProgress(content: string): TaskProgress {
  let done = 0;
  let total = 0;
  for (const line of content.split('\n')) {
    const trimmed = line.trimStart();
    if (trimmed.startsWith('- [x]') || trimmed.startsWith('- [X]')) {
      done++;
      total++;
    } else if (trimmed.startsWith('- [ ]')) {
      total++;
    }
  }
  return { done, total };
}

export function useOpenSpecTasks(
  arcId: string | undefined,
  projectId: string | undefined,
  threadStatus: string | undefined,
): UseOpenSpecTasksResult {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [arcName, setArcName] = useState<string | null>(null);
  const arcIdRef = useRef(arcId);
  const hasFetchedRef = useRef(false);

  // Fetch arc name + tasks in a single effect (avoids render-cycle waterfall)
  useEffect(() => {
    if (arcId !== arcIdRef.current) {
      arcIdRef.current = arcId;
      hasFetchedRef.current = false;
      setContent(null);
      setArcName(null);
    }

    if (!arcId || !projectId) return;

    let cancelled = false;
    // Cache resolved name in a local variable to avoid waiting for state update
    let resolvedName = arcName;

    const fetchTasks = async () => {
      if (!hasFetchedRef.current) setLoading(true);

      // Resolve arc name if we don't have it yet
      if (!resolvedName) {
        const arcResult = await api.getArc(arcId);
        if (cancelled) return;
        if (arcResult.isOk()) {
          resolvedName = arcResult.value.name;
          setArcName(resolvedName);
        } else {
          setLoading(false);
          return;
        }
      }

      // Fetch tasks immediately — no re-render needed between name and tasks
      const tasksResult = await api.getArcArtifacts(arcId, resolvedName, projectId);
      if (cancelled) return;
      if (tasksResult.isOk()) {
        hasFetchedRef.current = true;
        setContent(tasksResult.value.artifacts.tasks ?? null);
      }
      setLoading(false);
    };

    fetchTasks();

    // Poll while thread is running
    let interval: ReturnType<typeof setInterval> | undefined;
    if (threadStatus === 'running') {
      interval = setInterval(fetchTasks, POLL_INTERVAL_MS);
    }

    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
    };
  }, [arcId, arcName, projectId, threadStatus]);

  const progress = content ? parseProgress(content) : EMPTY_PROGRESS;

  return { content, progress, loading };
}
