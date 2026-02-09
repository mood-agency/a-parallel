import { create } from 'zustand';
import { toast } from 'sonner';
import type { Thread, Message, MessageRole, ThreadStatus, WaitingReason } from '@a-parallel/shared';
import { api } from '@/lib/api';
import { createActor } from 'xstate';
import { threadMachine, wsEventToMachineEvent, type ThreadContext } from '@/machines/thread-machine';
import { useUIStore } from './ui-store';
import { useProjectStore } from './project-store';

// ── Types ────────────────────────────────────────────────────────

export interface AgentInitInfo {
  tools: string[];
  cwd: string;
  model: string;
}

export interface AgentResultInfo {
  status: 'completed' | 'failed';
  cost: number;
  duration: number;
}

export interface ThreadWithMessages extends Thread {
  messages: (Message & { toolCalls?: any[] })[];
  initInfo?: AgentInitInfo;
  resultInfo?: AgentResultInfo;
  waitingReason?: WaitingReason;
}

// ── Module-level state ───────────────────────────────────────────

// Generation counter to detect stale selectThread calls
let selectGeneration = 0;
/** Invalidate any in-flight selectThread so it won't overwrite newer state */
export function invalidateSelectThread() { selectGeneration++; }

// Buffer init info that arrives before the thread is active
const initInfoBuffer = new Map<string, AgentInitInfo>();

// Buffer WS events that arrive while selectedThreadId is set but activeThread is still loading
const wsEventBuffer = new Map<string, Array<{ type: string; data: any }>>();

function bufferWSEvent(threadId: string, type: string, data: any) {
  const buf = wsEventBuffer.get(threadId) ?? [];
  buf.push({ type, data });
  wsEventBuffer.set(threadId, buf);
}

// Store a navigate function reference so non-React code (like toasts) can navigate
let _navigate: ((path: string) => void) | null = null;
export const setAppNavigate = (fn: (path: string) => void) => { _navigate = fn; };

// Thread state machine registry
const threadActors = new Map<string, ReturnType<typeof createActor<typeof threadMachine>>>();

function getThreadActor(threadId: string, initialStatus: ThreadStatus = 'pending', cost: number = 0) {
  let actor = threadActors.get(threadId);
  if (!actor) {
    actor = createActor(threadMachine, {
      input: { threadId, cost } as ThreadContext,
    });
    actor.start();
    if (initialStatus !== 'pending') {
      actor.send({ type: 'SET_STATUS', status: initialStatus });
    }
    threadActors.set(threadId, actor);
  }
  return actor;
}

function transitionThreadStatus(
  threadId: string,
  event: ReturnType<typeof wsEventToMachineEvent>,
  currentStatus: ThreadStatus,
  cost: number = 0
): ThreadStatus {
  if (!event) return currentStatus;
  const actor = getThreadActor(threadId, currentStatus, cost);
  actor.send(event);
  return actor.getSnapshot().value as ThreadStatus;
}

// ── Store ────────────────────────────────────────────────────────

interface ThreadState {
  threadsByProject: Record<string, Thread[]>;
  selectedThreadId: string | null;
  activeThread: ThreadWithMessages | null;

  loadThreadsForProject: (projectId: string) => Promise<void>;
  selectThread: (threadId: string | null) => Promise<void>;
  archiveThread: (threadId: string, projectId: string) => Promise<void>;
  deleteThread: (threadId: string, projectId: string) => Promise<void>;
  appendOptimisticMessage: (threadId: string, content: string, images?: any[]) => void;
  refreshActiveThread: () => Promise<void>;
  refreshAllLoadedThreads: () => Promise<void>;
  clearProjectThreads: (projectId: string) => void;

  // WebSocket event handlers
  handleWSInit: (threadId: string, data: AgentInitInfo) => void;
  handleWSMessage: (threadId: string, data: { messageId?: string; role: string; content: string }) => void;
  handleWSToolCall: (threadId: string, data: { toolCallId?: string; messageId?: string; name: string; input: unknown }) => void;
  handleWSToolOutput: (threadId: string, data: { toolCallId: string; output: string }) => void;
  handleWSStatus: (threadId: string, data: { status: string }) => void;
  handleWSResult: (threadId: string, data: any) => void;
}

function flushWSBuffer(threadId: string, store: ThreadState) {
  const events = wsEventBuffer.get(threadId);
  if (!events?.length) return;
  wsEventBuffer.delete(threadId);
  for (const event of events) {
    switch (event.type) {
      case 'message': store.handleWSMessage(threadId, event.data); break;
      case 'tool_call': store.handleWSToolCall(threadId, event.data); break;
      case 'tool_output': store.handleWSToolOutput(threadId, event.data); break;
    }
  }
}

export const useThreadStore = create<ThreadState>((set, get) => ({
  threadsByProject: {},
  selectedThreadId: null,
  activeThread: null,

  loadThreadsForProject: async (projectId: string) => {
    const threads = await api.listThreads(projectId);
    set((state) => ({
      threadsByProject: { ...state.threadsByProject, [projectId]: threads },
    }));
  },

  selectThread: async (threadId) => {
    const gen = ++selectGeneration;
    set({ selectedThreadId: threadId, activeThread: null });
    useUIStore.setState({ newThreadProjectId: null, allThreadsProjectId: null });

    if (!threadId) return;

    try {
      const thread = await api.getThread(threadId);

      // Bail out if user navigated away while we were loading
      if (selectGeneration !== gen) {
        wsEventBuffer.delete(threadId);
        return;
      }

      const projectId = thread.projectId;

      // Ensure project is expanded and threads are loaded
      const projectStore = useProjectStore.getState();
      if (!projectStore.expandedProjects.has(projectId)) {
        const next = new Set(projectStore.expandedProjects);
        next.add(projectId);
        useProjectStore.setState({ expandedProjects: next });
      }
      if (!get().threadsByProject[projectId]) {
        get().loadThreadsForProject(projectId);
      }

      const buffered = initInfoBuffer.get(threadId);
      if (buffered) initInfoBuffer.delete(threadId);
      const resultInfo = (thread.status === 'completed' || thread.status === 'failed')
        ? { status: thread.status as 'completed' | 'failed', cost: thread.cost, duration: 0 }
        : undefined;

      // Derive waitingReason from the last tool call when reloading a waiting thread
      let waitingReason: WaitingReason | undefined;
      if (thread.status === 'waiting' && thread.messages?.length) {
        for (let i = thread.messages.length - 1; i >= 0; i--) {
          const tcs = thread.messages[i].toolCalls;
          if (tcs?.length) {
            const lastTC = tcs[tcs.length - 1];
            if (lastTC.name === 'AskUserQuestion') waitingReason = 'question';
            else if (lastTC.name === 'ExitPlanMode') waitingReason = 'plan';
            break;
          }
        }
      }

      set({ activeThread: { ...thread, initInfo: buffered || undefined, resultInfo, waitingReason } });
      useProjectStore.setState({ selectedProjectId: projectId });

      // Replay any WS events that arrived while activeThread was loading
      flushWSBuffer(threadId, get());
    } catch {
      if (selectGeneration === gen) {
        wsEventBuffer.delete(threadId!);
        set({ activeThread: null, selectedThreadId: null });
      }
    }
  },

  archiveThread: async (threadId, projectId) => {
    await api.archiveThread(threadId, true);
    const { threadsByProject, selectedThreadId } = get();
    const projectThreads = threadsByProject[projectId] ?? [];
    set({
      threadsByProject: {
        ...threadsByProject,
        [projectId]: projectThreads.filter((t) => t.id !== threadId),
      },
    });
    if (selectedThreadId === threadId) {
      set({ selectedThreadId: null, activeThread: null });
      useProjectStore.setState({ selectedProjectId: null });
    }
  },

  deleteThread: async (threadId, projectId) => {
    await api.deleteThread(threadId);
    const { threadsByProject, selectedThreadId } = get();
    const projectThreads = threadsByProject[projectId] ?? [];
    set({
      threadsByProject: {
        ...threadsByProject,
        [projectId]: projectThreads.filter((t) => t.id !== threadId),
      },
    });
    if (selectedThreadId === threadId) {
      set({ selectedThreadId: null, activeThread: null });
    }
  },

  appendOptimisticMessage: (threadId, content, images) => {
    const { activeThread, threadsByProject } = get();
    if (activeThread?.id === threadId) {
      const pid = activeThread.projectId;
      const projectThreads = threadsByProject[pid] ?? [];

      const machineEvent = { type: 'START' as const };
      const newStatus = transitionThreadStatus(threadId, machineEvent, activeThread.status, activeThread.cost);

      set({
        activeThread: {
          ...activeThread,
          status: newStatus,
          waitingReason: undefined,
          messages: [
            ...activeThread.messages,
            {
              id: crypto.randomUUID(),
              threadId,
              role: 'user' as MessageRole,
              content,
              images,
              timestamp: new Date().toISOString(),
            },
          ],
        },
        threadsByProject: {
          ...threadsByProject,
          [pid]: projectThreads.map((t) =>
            t.id === threadId ? { ...t, status: newStatus } : t
          ),
        },
      });
    }
  },

  refreshActiveThread: async () => {
    const { activeThread } = get();
    if (!activeThread) return;
    try {
      const thread = await api.getThread(activeThread.id);
      const resultInfo = activeThread.resultInfo
        ?? ((thread.status === 'completed' || thread.status === 'failed')
          ? { status: thread.status as 'completed' | 'failed', cost: thread.cost, duration: 0 }
          : undefined);
      set({ activeThread: { ...thread, initInfo: activeThread.initInfo, resultInfo } });
    } catch {
      // silently ignore
    }
  },

  refreshAllLoadedThreads: async () => {
    const { threadsByProject, loadThreadsForProject, refreshActiveThread } = get();
    const projectIds = Object.keys(threadsByProject);
    await Promise.all(projectIds.map((pid) => loadThreadsForProject(pid)));
    await refreshActiveThread();
  },

  clearProjectThreads: (projectId: string) => {
    const { threadsByProject, activeThread } = get();
    const nextThreads = { ...threadsByProject };
    delete nextThreads[projectId];
    const clearSelection = activeThread?.projectId === projectId;
    set({
      threadsByProject: nextThreads,
      ...(clearSelection ? { selectedThreadId: null, activeThread: null } : {}),
    });
  },

  // ── WebSocket event handlers ─────────────────────────────────

  handleWSInit: (threadId, data) => {
    const { activeThread } = get();
    if (activeThread?.id === threadId) {
      set({ activeThread: { ...activeThread, initInfo: data } });
    } else {
      initInfoBuffer.set(threadId, data);
    }
  },

  handleWSMessage: (threadId, data) => {
    const { activeThread, selectedThreadId } = get();

    if (activeThread?.id === threadId) {
      const messageId = data.messageId;

      if (messageId) {
        const existingIdx = activeThread.messages.findIndex((m) => m.id === messageId);
        if (existingIdx >= 0) {
          const updated = [...activeThread.messages];
          updated[existingIdx] = { ...updated[existingIdx], content: data.content };
          set({ activeThread: { ...activeThread, messages: updated } });
          return;
        }
      }

      set({
        activeThread: {
          ...activeThread,
          messages: [
            ...activeThread.messages,
            {
              id: messageId || crypto.randomUUID(),
              threadId,
              role: data.role as MessageRole,
              content: data.content,
              timestamp: new Date().toISOString(),
            },
          ],
        },
      });
    } else if (selectedThreadId === threadId) {
      bufferWSEvent(threadId, 'message', data);
    }
  },

  handleWSToolCall: (threadId, data) => {
    const { activeThread, selectedThreadId } = get();

    if (activeThread?.id === threadId) {
      const toolCallId = data.toolCallId || crypto.randomUUID();
      const messages = [...activeThread.messages];
      const tcEntry = { id: toolCallId, messageId: data.messageId || '', name: data.name, input: JSON.stringify(data.input) };

      if (messages.some(m => m.toolCalls?.some((tc: any) => tc.id === toolCallId))) return;

      if (data.messageId) {
        const msgIdx = messages.findIndex((m) => m.id === data.messageId);
        if (msgIdx >= 0) {
          const msg = messages[msgIdx];
          messages[msgIdx] = {
            ...msg,
            toolCalls: [...(msg.toolCalls ?? []), tcEntry],
          };
          set({ activeThread: { ...activeThread, messages } });
          return;
        }
      }

      set({
        activeThread: {
          ...activeThread,
          messages: [
            ...messages,
            {
              id: data.messageId || crypto.randomUUID(),
              threadId,
              role: 'assistant' as MessageRole,
              content: '',
              timestamp: new Date().toISOString(),
              toolCalls: [tcEntry],
            },
          ],
        },
      });
    } else if (selectedThreadId === threadId) {
      bufferWSEvent(threadId, 'tool_call', data);
    }
  },

  handleWSToolOutput: (threadId, data) => {
    const { activeThread, selectedThreadId } = get();
    if (activeThread?.id !== threadId) {
      if (selectedThreadId === threadId) bufferWSEvent(threadId, 'tool_output', data);
      return;
    }

    const messages = activeThread.messages.map((msg) => {
      if (!msg.toolCalls) return msg;
      const updatedTCs = msg.toolCalls.map((tc: any) =>
        tc.id === data.toolCallId ? { ...tc, output: data.output } : tc
      );
      return { ...msg, toolCalls: updatedTCs };
    });

    set({ activeThread: { ...activeThread, messages } });
  },

  handleWSStatus: (threadId, data) => {
    const { threadsByProject, activeThread, loadThreadsForProject } = get();

    const machineEvent = wsEventToMachineEvent('agent:status', data);
    if (!machineEvent) {
      console.warn(`[thread-store] Invalid status transition for thread ${threadId}:`, data.status);
      return;
    }

    // Only update the project that contains this thread (avoid cloning all projects)
    let foundInSidebar = false;
    let updatedProject: { pid: string; threads: Thread[] } | null = null;

    for (const [pid, threads] of Object.entries(threadsByProject)) {
      const idx = threads.findIndex((t) => t.id === threadId);
      if (idx >= 0) {
        foundInSidebar = true;
        const t = threads[idx];
        const newStatus = transitionThreadStatus(threadId, machineEvent, t.status, t.cost);
        if (newStatus !== t.status) {
          const copy = [...threads];
          copy[idx] = { ...t, status: newStatus };
          updatedProject = { pid, threads: copy };
        }
        break;
      }
    }

    const stateUpdate: Partial<ThreadState> = {};

    if (updatedProject) {
      stateUpdate.threadsByProject = { ...threadsByProject, [updatedProject.pid]: updatedProject.threads };
    }

    if (activeThread?.id === threadId) {
      const newStatus = transitionThreadStatus(threadId, machineEvent, activeThread.status, activeThread.cost);
      if (newStatus !== activeThread.status) {
        stateUpdate.activeThread = { ...activeThread, status: newStatus };
      }
    }

    if (Object.keys(stateUpdate).length > 0) {
      set(stateUpdate as any);
    }

    if (!foundInSidebar && activeThread?.id === threadId) {
      loadThreadsForProject(activeThread.projectId);
    }
  },

  handleWSResult: (threadId, data) => {
    const { threadsByProject, activeThread, loadThreadsForProject } = get();

    const machineEvent = wsEventToMachineEvent('agent:result', data);
    if (!machineEvent) {
      console.warn(`[thread-store] Invalid result event for thread ${threadId}:`, data);
      return;
    }

    let resultStatus: ThreadStatus = data.status ?? 'completed';
    let foundInSidebar = false;
    let updatedProject: { pid: string; threads: Thread[] } | null = null;

    for (const [pid, threads] of Object.entries(threadsByProject)) {
      const idx = threads.findIndex((t) => t.id === threadId);
      if (idx >= 0) {
        foundInSidebar = true;
        const t = threads[idx];
        const newStatus = transitionThreadStatus(threadId, machineEvent, t.status, data.cost ?? t.cost);
        resultStatus = newStatus;
        const copy = [...threads];
        copy[idx] = { ...t, status: newStatus, cost: data.cost ?? t.cost };
        updatedProject = { pid, threads: copy };
        break;
      }
    }

    const stateUpdate: Partial<ThreadState> = {};
    if (updatedProject) {
      stateUpdate.threadsByProject = { ...threadsByProject, [updatedProject.pid]: updatedProject.threads };
    }

    if (activeThread?.id === threadId) {
      const isWaiting = resultStatus === 'waiting';

      if (isWaiting) {
        stateUpdate.activeThread = {
          ...activeThread,
          status: resultStatus,
          cost: data.cost ?? activeThread.cost,
          waitingReason: data.waitingReason,
        };
      } else {
        const actor = getThreadActor(threadId, activeThread.status, activeThread.cost);
        const snapshot = actor.getSnapshot();

        stateUpdate.activeThread = {
          ...activeThread,
          status: resultStatus,
          cost: data.cost ?? activeThread.cost,
          waitingReason: undefined,
          resultInfo: snapshot.context.resultInfo ?? {
            status: resultStatus as 'completed' | 'failed',
            cost: data.cost ?? activeThread.cost,
            duration: data.duration ?? 0,
          },
        };
      }
    }

    set(stateUpdate as any);

    if (resultStatus === 'waiting') return;

    const projectIdForRefresh = activeThread?.id === threadId
      ? activeThread.projectId
      : Object.keys(threadsByProject).find((pid) =>
          threadsByProject[pid]?.some((t) => t.id === threadId)
        );

    if (projectIdForRefresh) {
      setTimeout(() => loadThreadsForProject(projectIdForRefresh), 500);
    }

    // Toast notification
    let threadTitle = 'Thread';
    let projectId: string | null = null;
    if (updatedProject) {
      const found = updatedProject.threads.find((t) => t.id === threadId);
      if (found) {
        threadTitle = found.title ?? threadTitle;
        projectId = updatedProject.pid;
      }
    }

    const navigateToThread = () => {
      if (projectId && _navigate) {
        _navigate(`/projects/${projectId}/threads/${threadId}`);
        toast.dismiss(`result-${threadId}`);
      }
    };

    const toastOpts: Parameters<typeof toast.success>[1] = {
      id: `result-${threadId}`,
      action: { label: 'View', onClick: navigateToThread },
      duration: 8000,
    };
    if (resultStatus === 'completed') {
      toast.success(`"${threadTitle}" completed`, toastOpts);
    } else if (resultStatus === 'failed') {
      toast.error(`"${threadTitle}" failed`, toastOpts);
    }
  },
}));
