import { useCallback, useEffect, useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { GitProgressModal, type GitProgressStep } from '@/components/GitProgressModal';
import { api } from '@/lib/api';
import { useProjectStore } from '@/stores/project-store';
import { useSettingsStore, deriveToolLists } from '@/stores/settings-store';
import { useThreadStore } from '@/stores/thread-store';
import { useUIStore } from '@/stores/ui-store';

import { PromptInput } from '../PromptInput';

export function NewThreadInput() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const newThreadProjectId = useUIStore((s) => s.newThreadProjectId);
  const selectedProjectId = useProjectStore((s) => s.selectedProjectId);
  const effectiveProjectId = newThreadProjectId || selectedProjectId;
  const newThreadIdleOnly = useUIStore((s) => s.newThreadIdleOnly);
  const cancelNewThread = useUIStore((s) => s.cancelNewThread);
  const setReviewPaneOpen = useUIStore((s) => s.setReviewPaneOpen);
  const loadThreadsForProject = useThreadStore((s) => s.loadThreadsForProject);
  const projects = useProjectStore((s) => s.projects);
  const project = effectiveProjectId
    ? projects.find((p) => p.id === effectiveProjectId)
    : undefined;
  const defaultThreadMode = project?.defaultMode ?? 'worktree';
  const toolPermissions = useSettingsStore((s) => s.toolPermissions);

  const [creating, setCreating] = useState(false);

  // Worktree setup progress modal state
  const [setupProgressOpen, setSetupProgressOpen] = useState(false);
  const [setupSteps, setSetupSteps] = useState<GitProgressStep[]>([]);
  const worktreeModeRef = useRef(false);

  const updateSetupStep = useCallback(
    (stepId: string, label: string, status: GitProgressStep['status'], error?: string) => {
      setSetupSteps((prev) => {
        const exists = prev.some((s) => s.id === stepId);
        if (exists) {
          return prev.map((s) => (s.id === stepId ? { ...s, label, status, error } : s));
        }
        return [...prev, { id: stepId, label, status, error }];
      });
    },
    [],
  );

  // Listen for worktree:setup WS events while creating
  useEffect(() => {
    if (!creating || !worktreeModeRef.current) return;
    const handler = (e: Event) => {
      const { step, label, status, error } = (e as CustomEvent).detail;
      updateSetupStep(step, label, status, error);
    };
    window.addEventListener('worktree:setup', handler);
    return () => window.removeEventListener('worktree:setup', handler);
  }, [creating, updateSetupStep]);

  const handleCreate = async (
    prompt: string,
    opts: {
      provider?: string;
      model: string;
      mode: string;
      threadMode?: string;
      baseBranch?: string;
      sendToBacklog?: boolean;
      fileReferences?: { path: string }[];
    },
    images?: any[],
  ): Promise<boolean> => {
    if (!effectiveProjectId || creating) return false;
    setCreating(true);

    const threadMode = (opts.threadMode as 'local' | 'worktree') || defaultThreadMode;
    worktreeModeRef.current = threadMode === 'worktree';

    // If idle-only mode or sendToBacklog toggle, create idle thread without executing
    if (newThreadIdleOnly || opts.sendToBacklog) {
      const result = await api.createIdleThread({
        projectId: effectiveProjectId,
        title: prompt.slice(0, 200),
        mode: threadMode,
        baseBranch: opts.baseBranch,
        prompt,
        images,
      });

      if (result.isErr()) {
        toast.error(result.error.message);
        setCreating(false);
        return false;
      }

      await loadThreadsForProject(effectiveProjectId);
      setCreating(false);
      setReviewPaneOpen(false);
      toast.success(t('toast.threadCreated', { title: prompt.slice(0, 200) }));
      cancelNewThread();
      return true;
    }

    // Show progress modal for worktree mode
    if (threadMode === 'worktree') {
      setSetupSteps([]);
      setSetupProgressOpen(true);
    }

    // Normal mode: create and execute thread
    const { allowedTools, disallowedTools } = deriveToolLists(toolPermissions);
    const result = await api.createThread({
      projectId: effectiveProjectId,
      title: prompt.slice(0, 200),
      mode: threadMode,
      provider: opts.provider,
      model: opts.model,
      permissionMode: opts.mode,
      baseBranch: opts.baseBranch,
      prompt,
      images,
      allowedTools,
      disallowedTools,
      fileReferences: opts.fileReferences,
    });

    if (result.isErr()) {
      toast.error(result.error.message);
      setCreating(false);
      setSetupProgressOpen(false);
      return false;
    }

    if (threadMode === 'worktree') {
      // Ensure all steps show as completed since server has finished
      setSetupSteps((prev) => {
        if (prev.length === 0) {
          return [
            {
              id: 'worktree',
              label: t('newThread.worktreeCreated', 'Worktree created'),
              status: 'completed' as const,
            },
          ];
        }
        return prev.map((s) =>
          s.status === 'running' ? { ...s, status: 'completed' as const } : s,
        );
      });

      // Preload thread data while modal is still visible
      useThreadStore.setState({ selectedThreadId: result.value.id });
      await loadThreadsForProject(effectiveProjectId);

      // Now close modal and navigate — thread is ready
      setSetupProgressOpen(false);
      setCreating(false);
      setReviewPaneOpen(false);
      cancelNewThread();
      navigate(`/projects/${effectiveProjectId}/threads/${result.value.id}`);
      return true;
    }

    // Local mode: navigate immediately
    // Set selectedThreadId immediately so WS events are buffered while activeThread loads.
    // This closes the race condition where the server emits events before the client navigates.
    useThreadStore.setState({ selectedThreadId: result.value.id });
    await loadThreadsForProject(effectiveProjectId);
    setCreating(false);
    setReviewPaneOpen(false);
    navigate(`/projects/${effectiveProjectId}/threads/${result.value.id}`);
    return true;
  };

  return (
    <>
      <GitProgressModal
        open={setupProgressOpen}
        onOpenChange={(open) => {
          if (!open) {
            setSetupProgressOpen(false);
            setCreating(false);
          }
        }}
        steps={setupSteps}
        title={t('newThread.settingUpWorktree', 'Setting up worktree')}
        autoClose
      />
      <div className="flex flex-1 items-center justify-center px-4 text-muted-foreground">
        <div className="w-full max-w-3xl">
          <PromptInput
            key={effectiveProjectId}
            onSubmit={handleCreate}
            loading={creating}
            isNewThread
            showBacklog
            projectId={effectiveProjectId || undefined}
          />
        </div>
      </div>
    </>
  );
}
