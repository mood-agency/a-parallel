import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '@/stores/app-store';
import { api } from '@/lib/api';
import { PromptInput } from '../PromptInput';

export function NewThreadInput() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const newThreadProjectId = useAppStore(s => s.newThreadProjectId);
  const cancelNewThread = useAppStore(s => s.cancelNewThread);
  const loadThreadsForProject = useAppStore(s => s.loadThreadsForProject);

  const [creating, setCreating] = useState(false);

  const handleCreate = async (prompt: string, opts: { model: string; mode: string }, images?: any[]) => {
    if (!newThreadProjectId || creating) return;
    setCreating(true);

    try {
      const thread = await api.createThread({
        projectId: newThreadProjectId,
        title: prompt.slice(0, 200),
        mode: 'local',
        model: opts.model,
        permissionMode: opts.mode,
        prompt,
        images,
      });

      await loadThreadsForProject(newThreadProjectId);
      setCreating(false);
      navigate(`/projects/${newThreadProjectId}/threads/${thread.id}`);
    } catch (e: any) {
      alert(e.message);
      setCreating(false);
    }
  };

  return (
    <>
      {/* Empty state area */}
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        <div className="text-center">
          <p className="text-sm">{t('thread.whatShouldAgentDo')}</p>
          <p className="text-xs mt-1">{t('thread.describeTask')}</p>
        </div>
      </div>

      <PromptInput
        key={newThreadProjectId}
        onSubmit={handleCreate}
        loading={creating}
      />
    </>
  );
}
