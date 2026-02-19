import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api';
import { CircleDot, CircleCheck, MessageSquare, Loader2, ExternalLink } from 'lucide-react';
import type { GitHubIssue } from '@funny/shared';

interface IssuesDialogProps {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function IssuesDialog({ projectId, open, onOpenChange }: IssuesDialogProps) {
  const { t } = useTranslation();
  const [issues, setIssues] = useState<GitHubIssue[]>([]);
  const [state, setState] = useState<'open' | 'closed'>('open');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [repoInfo, setRepoInfo] = useState<{ owner: string; repo: string } | null>(null);

  const fetchIssues = useCallback(async (pageNum: number, append: boolean) => {
    setLoading(true);
    setError(null);
    const result = await api.githubIssues(projectId, { state, page: pageNum, per_page: 30 });
    result.match(
      (data) => {
        setIssues((prev) => append ? [...prev, ...data.issues] : data.issues);
        setHasMore(data.hasMore);
        setRepoInfo({ owner: data.owner, repo: data.repo });
      },
      (err) => {
        setError(err.message);
      }
    );
    setLoading(false);
  }, [projectId, state]);

  useEffect(() => {
    if (open) {
      setPage(1);
      setIssues([]);
      fetchIssues(1, false);
    }
  }, [open, state, fetchIssues]);

  const loadMore = () => {
    const next = page + 1;
    setPage(next);
    fetchIssues(next, true);
  };

  function timeAgo(dateStr: string): string {
    const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d`;
    const months = Math.floor(days / 30);
    return `${months}mo`;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CircleDot className="h-4 w-4" />
            {t('issues.title')}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {t('issues.title')}
          </DialogDescription>
        </DialogHeader>

        {/* State filter */}
        <div className="flex gap-1">
          <Button
            variant={state === 'open' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setState('open')}
            className="h-7 text-xs"
          >
            <CircleDot className="h-3 w-3 mr-1 text-green-500" />
            {t('issues.open')}
          </Button>
          <Button
            variant={state === 'closed' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setState('closed')}
            className="h-7 text-xs"
          >
            <CircleCheck className="h-3 w-3 mr-1 text-purple-500" />
            {t('issues.closed')}
          </Button>
        </div>

        {/* Content */}
        <ScrollArea className="flex-1 min-h-0 -mx-6 px-6">
          {loading && issues.length === 0 ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="text-center py-12 text-muted-foreground text-sm">
              <p>{t('issues.error')}</p>
              <p className="mt-1 text-xs">{error}</p>
            </div>
          ) : issues.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">
              {t('issues.noIssues')}
            </div>
          ) : (
            <div className="space-y-1">
              {issues.map((issue) => (
                <a
                  key={issue.number}
                  href={issue.html_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-start gap-2 p-2 rounded-md hover:bg-accent/50 transition-colors group"
                >
                  {issue.state === 'open' ? (
                    <CircleDot className="h-4 w-4 mt-0.5 flex-shrink-0 text-green-500" />
                  ) : (
                    <CircleCheck className="h-4 w-4 mt-0.5 flex-shrink-0 text-purple-500" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-sm font-medium group-hover:text-primary transition-colors line-clamp-2">
                        {issue.title}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      <span className="text-xs text-muted-foreground">
                        #{issue.number}
                      </span>
                      {issue.labels.map((label) => (
                        <Badge
                          key={label.name}
                          variant="outline"
                          className="text-[10px] h-4 px-1"
                          style={{
                            borderColor: `#${label.color}`,
                            color: `#${label.color}`,
                          }}
                        >
                          {label.name}
                        </Badge>
                      ))}
                      <span className="text-xs text-muted-foreground">
                        {timeAgo(issue.created_at)}
                      </span>
                      {issue.user && (
                        <span className="text-xs text-muted-foreground">
                          {issue.user.login}
                        </span>
                      )}
                      {issue.comments > 0 && (
                        <span className="text-xs text-muted-foreground flex items-center gap-0.5">
                          <MessageSquare className="h-3 w-3" />
                          {issue.comments}
                        </span>
                      )}
                    </div>
                  </div>
                </a>
              ))}

              {hasMore && (
                <div className="flex justify-center py-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.preventDefault();
                      loadMore();
                    }}
                    disabled={loading}
                    className="text-xs"
                  >
                    {loading ? (
                      <Loader2 className="h-3 w-3 animate-spin mr-1" />
                    ) : null}
                    {t('issues.loadMore')}
                  </Button>
                </div>
              )}
            </div>
          )}
        </ScrollArea>

        {/* Footer */}
        {repoInfo && (
          <div className="flex justify-end pt-2 border-t">
            <a
              href={`https://github.com/${repoInfo.owner}/${repoInfo.repo}/issues`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
            >
              {t('issues.viewOnGithub')}
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
