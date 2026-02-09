import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { FolderOpen, Loader2, Plus } from 'lucide-react';
import { FolderPicker } from '../FolderPicker';
import { api } from '@/lib/api';

interface AddProjectFormProps {
  onProjectAdded: () => Promise<void>;
}

export function AddProjectForm({ onProjectAdded }: AddProjectFormProps) {
  const { t } = useTranslation();
  const [addingProject, setAddingProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectPath, setNewProjectPath] = useState('');
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  const handleAddProject = async () => {
    if (!newProjectName || !newProjectPath || isCreating) return;
    setIsCreating(true);
    try {
      await api.createProject(newProjectName, newProjectPath);
      await onProjectAdded();
      setAddingProject(false);
      setNewProjectName('');
      setNewProjectPath('');
    } catch (e: any) {
      if (e.message?.includes('Not a git repository')) {
        const init = confirm(
          t('confirm.notGitRepo', { path: newProjectPath })
        );
        if (init) {
          try {
            await fetch('/api/browse/git-init', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ path: newProjectPath }),
            });
            await api.createProject(newProjectName, newProjectPath);
            await onProjectAdded();
            setAddingProject(false);
            setNewProjectName('');
            setNewProjectPath('');
          } catch (initErr: any) {
            alert(initErr.message);
          }
        }
      } else {
        alert(e.message);
      }
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <>
      <div className="px-2 pt-2 pb-1">
        <div className="group/projects flex items-center justify-between mb-1">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            {t('sidebar.projects')}
          </span>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => setAddingProject(!addingProject)}
                className="text-muted-foreground opacity-0 group-hover/projects:opacity-100 transition-opacity"
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">{t('sidebar.addProject')}</TooltipContent>
          </Tooltip>
        </div>

        {addingProject && (
          <div className="space-y-1.5 mb-2 animate-slide-down">
            <input
              className="w-full rounded-md border border-input bg-background px-2 py-1 text-xs transition-[border-color,box-shadow] duration-150 focus:outline-none focus:ring-1 focus:ring-ring"
              placeholder={t('sidebar.projectName')}
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
            />
            <div className="flex gap-1">
              <input
                className="flex-1 rounded-md border border-input bg-background px-2 py-1 text-xs transition-[border-color,box-shadow] duration-150 focus:outline-none focus:ring-1 focus:ring-ring"
                placeholder={t('sidebar.absolutePath')}
                value={newProjectPath}
                onChange={(e) => setNewProjectPath(e.target.value)}
              />
              <Button
                variant="outline"
                size="icon-xs"
                onClick={() => setFolderPickerOpen(true)}
                title={t('sidebar.browseFolder')}
              >
                <FolderOpen className="h-3.5 w-3.5" />
              </Button>
            </div>
            <Button
              size="sm"
              className="w-full h-7 text-xs"
              onClick={handleAddProject}
              disabled={isCreating || !newProjectName || !newProjectPath}
            >
              {isCreating ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin mr-1" />
                  {t('common.loading')}
                </>
              ) : (
                t('sidebar.add')
              )}
            </Button>
          </div>
        )}
      </div>

      {folderPickerOpen && (
        <FolderPicker
          onSelect={async (path) => {
            setNewProjectPath(path);
            setFolderPickerOpen(false);
            if (!newProjectName) {
              try {
                const res = await fetch(`/api/browse/repo-name?path=${encodeURIComponent(path)}`);
                const data = await res.json();
                if (data.name) setNewProjectName(data.name);
              } catch {
                const folderName = path.split(/[\\/]/).filter(Boolean).pop() || '';
                setNewProjectName(folderName);
              }
            }
          }}
          onClose={() => setFolderPickerOpen(false)}
        />
      )}
    </>
  );
}
