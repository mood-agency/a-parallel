import { useState, useEffect, useMemo, memo, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '@/stores/app-store';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { ReactDiffViewer, DIFF_VIEWER_STYLES } from './tool-cards/utils';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  X,
  RefreshCw,
  Plus,
  Minus,
  Undo2,
  GitCommit,
  Upload,
  GitPullRequest,
  FileCode,
  FilePlus,
  FileX,
} from 'lucide-react';
import type { FileDiff } from '@a-parallel/shared';

const fileStatusIcons: Record<string, typeof FileCode> = {
  added: FilePlus,
  modified: FileCode,
  deleted: FileX,
  renamed: FileCode,
};

function parseDiffOld(unifiedDiff: string): string {
  const lines = unifiedDiff.split('\n');
  const oldLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith('---') || line.startsWith('+++') || line.startsWith('@@')) {
      continue;
    }
    if (line.startsWith('-')) {
      oldLines.push(line.substring(1));
    } else if (!line.startsWith('+')) {
      oldLines.push(line);
    }
  }

  return oldLines.join('\n');
}

function parseDiffNew(unifiedDiff: string): string {
  const lines = unifiedDiff.split('\n');
  const newLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith('---') || line.startsWith('+++') || line.startsWith('@@')) {
      continue;
    }
    if (line.startsWith('+')) {
      newLines.push(line.substring(1));
    } else if (!line.startsWith('-')) {
      newLines.push(line);
    }
  }

  return newLines.join('\n');
}

const MemoizedDiffView = memo(function MemoizedDiffView({ diff }: { diff: string }) {
  const oldValue = useMemo(() => parseDiffOld(diff), [diff]);
  const newValue = useMemo(() => parseDiffNew(diff), [diff]);

  return (
    <ReactDiffViewer
      oldValue={oldValue}
      newValue={newValue}
      splitView={false}
      useDarkTheme={true}
      hideLineNumbers={false}
      showDiffOnly={true}
      styles={DIFF_VIEWER_STYLES}
    />
  );
});

export function ReviewPane() {
  const { t } = useTranslation();
  const activeThread = useAppStore(s => s.activeThread);
  const setReviewPaneOpen = useAppStore(s => s.setReviewPaneOpen);
  const [diffs, setDiffs] = useState<FileDiff[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [commitMsg, setCommitMsg] = useState('');
  const [loading, setLoading] = useState(false);

  const threadId = activeThread?.id;

  const refresh = async () => {
    if (!threadId) return;
    setLoading(true);
    try {
      const data = await api.getDiff(threadId);
      setDiffs(data);
      if (data.length > 0 && !selectedFile) {
        setSelectedFile(data[0].path);
      }
    } catch (e: any) {
      console.error('Failed to load diff:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, [threadId]);

  const selectedDiff = diffs.find((d) => d.path === selectedFile);

  const handleStage = async (paths: string[]) => {
    if (!threadId) return;
    await api.stageFiles(threadId, paths);
    await refresh();
  };

  const handleUnstage = async (paths: string[]) => {
    if (!threadId) return;
    await api.unstageFiles(threadId, paths);
    await refresh();
  };

  const handleRevert = async (paths: string[]) => {
    if (!threadId) return;
    if (!confirm(t('review.revertConfirm', { paths: paths.join(', ') }))) return;
    await api.revertFiles(threadId, paths);
    await refresh();
  };

  const handleCommit = async () => {
    if (!threadId || !commitMsg.trim()) return;
    try {
      await api.commit(threadId, commitMsg);
      setCommitMsg('');
      await refresh();
    } catch (e: any) {
      alert(t('review.commitFailed', { message: e.message }));
    }
  };

  const handlePush = async () => {
    if (!threadId) return;
    try {
      await api.push(threadId);
      alert(t('review.pushedSuccess'));
    } catch (e: any) {
      alert(t('review.pushFailed', { message: e.message }));
    }
  };

  return (
    <div className="flex flex-col h-full animate-slide-in-right">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium">{t('review.title')}</h3>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={refresh}
                className="text-muted-foreground"
              >
                <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('review.refresh')}</TooltipContent>
          </Tooltip>
        </div>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => setReviewPaneOpen(false)}
          className="text-muted-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* File list */}
      <ScrollArea className="border-b border-border max-h-48">
        {diffs.length === 0 ? (
          <p className="text-xs text-muted-foreground p-3">{t('review.noChanges')}</p>
        ) : (
          diffs.map((f) => {
            const Icon = fileStatusIcons[f.status] || FileCode;
            return (
              <div
                key={f.path}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 text-xs cursor-pointer transition-colors',
                  selectedFile === f.path
                    ? 'bg-accent text-accent-foreground'
                    : 'hover:bg-accent/50 text-muted-foreground'
                )}
                onClick={() => setSelectedFile(f.path)}
              >
                <Icon className="h-3.5 w-3.5 flex-shrink-0" />
                <span className="flex-1 truncate font-mono">{f.path}</span>
                <span className={cn('text-[10px]', f.staged ? 'text-green-400' : 'text-yellow-400')}>
                  {f.staged ? t('review.staged') : t('review.unstaged')}
                </span>
                <div className="flex gap-0.5">
                  {f.staged ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          onClick={(e) => { e.stopPropagation(); handleUnstage([f.path]); }}
                        >
                          <Minus className="h-3 w-3" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{t('review.unstage')}</TooltipContent>
                    </Tooltip>
                  ) : (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          onClick={(e) => { e.stopPropagation(); handleStage([f.path]); }}
                        >
                          <Plus className="h-3 w-3" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{t('review.stage')}</TooltipContent>
                    </Tooltip>
                  )}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={(e) => { e.stopPropagation(); handleRevert([f.path]); }}
                        className="text-destructive"
                      >
                        <Undo2 className="h-3 w-3" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{t('review.revert')}</TooltipContent>
                  </Tooltip>
                </div>
              </div>
            );
          })
        )}
      </ScrollArea>

      {/* Diff viewer */}
      <ScrollArea className="flex-1">
        {selectedDiff ? (
          selectedDiff.diff ? (
            <div className="text-xs [&_.diff-container]:font-mono [&_.diff-container]:text-[11px]">
              <Suspense fallback={<div className="p-2 text-xs text-muted-foreground">Loading diff...</div>}>
                <MemoizedDiffView diff={selectedDiff.diff} />
              </Suspense>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground p-2">{t('review.binaryOrNoDiff')}</p>
          )
        ) : (
          <p className="text-xs text-muted-foreground p-2">{t('review.selectFile')}</p>
        )}
      </ScrollArea>

      {/* Git actions */}
      <div className="p-3 border-t border-border space-y-2">
        <div className="flex gap-1.5">
          <input
            className="flex-1 rounded-md border border-input bg-background px-2 py-1.5 text-xs placeholder:text-muted-foreground transition-[border-color,box-shadow] duration-150 focus:outline-none focus:ring-1 focus:ring-ring"
            placeholder={t('review.commitMessage')}
            value={commitMsg}
            onChange={(e) => setCommitMsg(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCommit()}
          />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon-sm"
                onClick={handleCommit}
                disabled={!commitMsg.trim()}
              >
                <GitCommit className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('review.commit')}</TooltipContent>
          </Tooltip>
        </div>
        <div className="flex gap-1.5">
          <Button
            variant="outline"
            size="sm"
            className="flex-1 h-8 text-xs"
            onClick={handlePush}
          >
            <Upload className="h-3 w-3 mr-1" />
            {t('review.push')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="flex-1 h-8 text-xs"
            onClick={() => {
              const title = prompt(t('review.prTitle'));
              if (!title || !threadId) return;
              api.createPR(threadId, title, '').then(() => alert(t('review.prCreated'))).catch((e: any) => alert(e.message));
            }}
          >
            <GitPullRequest className="h-3 w-3 mr-1" />
            {t('review.createPR')}
          </Button>
        </div>
      </div>
    </div>
  );
}
