import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

import { stripOrgPrefix } from '@/lib/url';
import { useThreadHistoryStore } from '@/stores/thread-history-store';

const THREAD_ROUTE = /^\/projects\/([^/]+)\/threads\/([^/]+)/;

/**
 * Pushes `(projectId, threadId)` into the thread-history stack whenever the
 * location resolves to a thread route. Entries matching the current head are
 * a no-op, so Alt+Left/Right navigations (which mutate `past`/`future` to
 * already match the target) don't get re-pushed.
 */
export function useThreadHistoryTracker() {
  const location = useLocation();

  useEffect(() => {
    const [, cleanPath] = stripOrgPrefix(location.pathname);
    const match = cleanPath.match(THREAD_ROUTE);
    if (!match) return;
    const [, projectId, threadId] = match;
    useThreadHistoryStore.getState().pushThread({ projectId, threadId });
  }, [location.pathname]);
}
