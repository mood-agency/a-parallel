import { useEffect } from 'react';
import { useLocation, matchPath } from 'react-router-dom';
import { useAppStore } from '@/stores/app-store';
import { settingsItems } from '@/components/SettingsPanel';

function parseRoute(pathname: string) {
  const settingsMatch = matchPath('/settings/:pageId', pathname);
  if (settingsMatch) {
    return {
      settingsPage: settingsMatch.params.pageId!,
      projectId: null,
      threadId: null,
      allThreads: false,
      startupCommands: false,
    };
  }

  const threadMatch = matchPath(
    '/projects/:projectId/threads/:threadId',
    pathname
  );
  if (threadMatch) {
    return {
      settingsPage: null,
      projectId: threadMatch.params.projectId!,
      threadId: threadMatch.params.threadId!,
      allThreads: false,
      startupCommands: false,
    };
  }

  // Match /projects/:projectId/threads (all threads view, no specific thread)
  const allThreadsMatch = matchPath('/projects/:projectId/threads', pathname);
  if (allThreadsMatch) {
    return {
      settingsPage: null,
      projectId: allThreadsMatch.params.projectId!,
      threadId: null,
      allThreads: true,
      startupCommands: false,
    };
  }

  const projectMatch = matchPath('/projects/:projectId', pathname);
  if (projectMatch) {
    return {
      settingsPage: null,
      projectId: projectMatch.params.projectId!,
      threadId: null,
      allThreads: false,
      startupCommands: false,
    };
  }

  const commandsMatch = matchPath('/projects/:projectId/commands', pathname);
  if (commandsMatch) {
    return {
      settingsPage: null,
      projectId: commandsMatch.params.projectId!,
      threadId: null,
      allThreads: false,
      startupCommands: true,
    };
  }

  return { settingsPage: null, projectId: null, threadId: null, allThreads: false, startupCommands: false };
}

const validSettingsIds = new Set(settingsItems.map((i) => i.id));

export function useRouteSync() {
  const location = useLocation();

  // Sync URL → store whenever location changes
  useEffect(() => {
    const { settingsPage, projectId, threadId, allThreads, startupCommands } = parseRoute(location.pathname);
    const store = useAppStore.getState();

    if (settingsPage && validSettingsIds.has(settingsPage as any)) {
      if (!store.settingsOpen) store.setSettingsOpen(true);
      if (store.activeSettingsPage !== settingsPage) store.setActiveSettingsPage(settingsPage);
      return;
    }

    // Close settings if navigating away from /settings
    if (store.settingsOpen) {
      store.setSettingsOpen(false);
    }

    if (startupCommands && projectId) {
      if (store.startupCommandsProjectId !== projectId) {
        store.showStartupCommands(projectId);
      }
      return;
    }

    // Clear startup commands view if navigating away
    if (store.startupCommandsProjectId) {
      store.closeStartupCommands();
    }

    if (allThreads && projectId) {
      if (store.allThreadsProjectId !== projectId) {
        store.showAllThreads(projectId);
      }
      return;
    }

    // Clear all-threads view if navigating away
    if (store.allThreadsProjectId) {
      store.closeAllThreads();
    }

    if (threadId) {
      // Re-select if the thread ID changed, or if the thread ID matches but
      // activeThread failed to load (e.g. due to a race condition or API error).
      if (threadId !== store.selectedThreadId || !store.activeThread || store.activeThread.id !== threadId) {
        store.selectThread(threadId);
      }
      if (projectId && projectId !== store.selectedProjectId) {
        store.selectProject(projectId);
      }
    } else if (projectId) {
      if (store.selectedThreadId) {
        store.selectThread(null);
      }
      if (projectId !== store.selectedProjectId) {
        store.selectProject(projectId);
      }
    } else {
      // Root path — clear selection
      if (store.selectedThreadId) store.selectThread(null);
      if (store.selectedProjectId) store.selectProject(null);
    }
  }, [location.pathname]);
}
