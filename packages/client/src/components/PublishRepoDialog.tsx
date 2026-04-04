import { Globe, Loader2, Lock } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

interface PublishRepoDialogProps {
  projectId: string;
  /** Directory name used to prefill the repo name */
  projectPath: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: (repoUrl: string) => void;
}

export function PublishRepoDialog({
  projectId,
  projectPath,
  open,
  onOpenChange,
  onSuccess,
}: PublishRepoDialogProps) {
  const defaultName = projectPath.split('/').filter(Boolean).pop() ?? '';

  const [repoName, setRepoName] = useState(defaultName);
  const [description, setDescription] = useState('');
  const [isPrivate, setIsPrivate] = useState(true);
  const [selectedOrg, setSelectedOrg] = useState('__personal__');
  const [orgs, setOrgs] = useState<string[]>([]);
  const [orgsLoading, setOrgsLoading] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch orgs when dialog opens
  useEffect(() => {
    if (!open) return;
    setRepoName(defaultName);
    setDescription('');
    setIsPrivate(true);
    setSelectedOrg('__personal__');
    setError(null);

    const controller = new AbortController();
    setOrgsLoading(true);
    api
      .projectGetGhOrgs(projectId, controller.signal)
      .then((r) => {
        if (r.isOk()) setOrgs(r.value.orgs);
      })
      .then(
        () => setOrgsLoading(false),
        () => setOrgsLoading(false),
      );

    return () => controller.abort();
  }, [open, projectId, defaultName]);

  const handlePublish = useCallback(async () => {
    if (!repoName.trim()) return;
    setPublishing(true);
    setError(null);

    const result = await api.projectPublish(projectId, {
      name: repoName.trim(),
      description: description.trim() || undefined,
      org: selectedOrg === '__personal__' ? undefined : selectedOrg,
      private: isPrivate,
    });

    setPublishing(false);

    if (result.isErr()) {
      const msg = String((result.error as any)?.message ?? result.error);
      if (msg.includes('already exists')) {
        setError(`Repository "${repoName}" already exists. Choose a different name.`);
      } else if (msg.includes('GitHub token')) {
        setError('GitHub token required. Set one in Settings > Profile.');
      } else {
        setError(msg);
      }
      return;
    }

    onSuccess(result.value.repoUrl);
  }, [projectId, repoName, description, selectedOrg, isPrivate, onSuccess]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]" data-testid="publish-repo-dialog">
        <DialogHeader>
          <DialogTitle>Publish Repository</DialogTitle>
          <DialogDescription>Create a new GitHub repository and push your code.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          {/* Owner / Org selector */}
          <div className="grid gap-1.5">
            <label className="text-sm font-medium">Owner</label>
            <Select
              value={selectedOrg}
              onValueChange={setSelectedOrg}
              disabled={orgsLoading || publishing}
            >
              <SelectTrigger data-testid="publish-repo-owner">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__personal__">Personal account</SelectItem>
                {orgs.map((org) => (
                  <SelectItem key={org} value={org}>
                    {org}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Repository name */}
          <div className="grid gap-1.5">
            <label className="text-sm font-medium">Repository name</label>
            <Input
              data-testid="publish-repo-name"
              value={repoName}
              onChange={(e) => setRepoName(e.target.value)}
              placeholder="my-repo"
              disabled={publishing}
              autoFocus
            />
          </div>

          {/* Description */}
          <div className="grid gap-1.5">
            <label className="text-sm font-medium">
              Description <span className="font-normal text-muted-foreground">(optional)</span>
            </label>
            <Input
              data-testid="publish-repo-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Short description"
              disabled={publishing}
            />
          </div>

          {/* Visibility toggle */}
          <div
            className={cn(
              'flex items-center justify-between rounded-md border px-3 py-2.5',
              'bg-muted/30',
            )}
          >
            <div className="flex items-center gap-2">
              {isPrivate ? (
                <Lock className="h-4 w-4 text-muted-foreground" />
              ) : (
                <Globe className="h-4 w-4 text-muted-foreground" />
              )}
              <span className="text-sm">{isPrivate ? 'Private' : 'Public'}</span>
            </div>
            <Switch
              data-testid="publish-repo-private"
              checked={isPrivate}
              onCheckedChange={setIsPrivate}
              disabled={publishing}
            />
          </div>

          {/* Error message */}
          {error && (
            <p className="text-sm text-destructive" data-testid="publish-repo-error">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={publishing}
            data-testid="publish-repo-cancel"
          >
            Cancel
          </Button>
          <Button
            onClick={handlePublish}
            disabled={publishing || !repoName.trim()}
            data-testid="publish-repo-submit"
          >
            {publishing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Publish repository
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
