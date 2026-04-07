import { create } from 'zustand';

interface ReviewPaneState {
  /**
   * Monotonically increasing counter. Each increment signals that a
   * file-modifying tool call was detected for `dirtyThreadId`.
   */
  dirtySignal: number;
  /** The threadId that triggered the latest dirty signal. */
  dirtyThreadId: string | null;

  /**
   * Per-thread/project flag indicating an AI commit-message generation is
   * in flight.  Keyed by draftId (threadId or projectModeId).
   */
  generatingCommitMsg: Record<string, boolean>;

  /** Call when a file-modifying tool call is detected for a thread. */
  notifyDirty: (threadId: string) => void;

  /** Set or clear the generating flag for a specific draft. */
  setGeneratingCommitMsg: (id: string, value: boolean) => void;
}

export const useReviewPaneStore = create<ReviewPaneState>((set) => ({
  dirtySignal: 0,
  dirtyThreadId: null,
  generatingCommitMsg: {},

  notifyDirty: (threadId) =>
    set((s) => ({ dirtySignal: s.dirtySignal + 1, dirtyThreadId: threadId })),

  setGeneratingCommitMsg: (id, value) =>
    set((s) => {
      if (value) {
        return { generatingCommitMsg: { ...s.generatingCommitMsg, [id]: true } };
      }
      const { [id]: _, ...rest } = s.generatingCommitMsg;
      return { generatingCommitMsg: rest };
    }),
}));
