import { create } from 'zustand';
import { useProjectStore } from './project-store';
import { useThreadStore, invalidateSelectThread } from './thread-store';

interface UIState {
  reviewPaneOpen: boolean;
  settingsOpen: boolean;
  activeSettingsPage: string | null;
  newThreadProjectId: string | null;
  allThreadsProjectId: string | null;
  startupCommandsProjectId: string | null;

  setReviewPaneOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
  setActiveSettingsPage: (page: string | null) => void;
  startNewThread: (projectId: string) => void;
  cancelNewThread: () => void;
  showAllThreads: (projectId: string) => void;
  closeAllThreads: () => void;
  showStartupCommands: (projectId: string) => void;
  closeStartupCommands: () => void;
}

export const useUIStore = create<UIState>((set) => ({
  reviewPaneOpen: false,
  settingsOpen: false,
  activeSettingsPage: null,
  newThreadProjectId: null,
  allThreadsProjectId: null,
  startupCommandsProjectId: null,

  setReviewPaneOpen: (open) => set({ reviewPaneOpen: open }),
  setSettingsOpen: (open) => set(open ? { settingsOpen: true } : { settingsOpen: false, activeSettingsPage: null }),
  setActiveSettingsPage: (page) => set({ activeSettingsPage: page }),

  startNewThread: (projectId: string) => {
    invalidateSelectThread();
    useProjectStore.getState().selectProject(projectId);
    useThreadStore.setState({ selectedThreadId: null, activeThread: null });
    set({ newThreadProjectId: projectId, allThreadsProjectId: null });
  },

  cancelNewThread: () => {
    set({ newThreadProjectId: null });
  },

  showAllThreads: (projectId: string) => {
    invalidateSelectThread();
    useProjectStore.getState().selectProject(projectId);
    useThreadStore.setState({ selectedThreadId: null, activeThread: null });
    set({ allThreadsProjectId: projectId, newThreadProjectId: null });
  },

  closeAllThreads: () => {
    set({ allThreadsProjectId: null });
  },

  showStartupCommands: (projectId: string) => {
    useProjectStore.getState().selectProject(projectId);
    set({ startupCommandsProjectId: projectId });
  },

  closeStartupCommands: () => {
    set({ startupCommandsProjectId: null });
  },
}));
