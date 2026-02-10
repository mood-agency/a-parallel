import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '@/stores/app-store';
import { ChevronLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ThreadListView } from '@/components/ThreadListView';

const ITEMS_PER_PAGE = 20;

export function AllThreadsView() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const allThreadsProjectId = useAppStore(s => s.allThreadsProjectId);
  const threadsByProject = useAppStore(s => s.threadsByProject);
  const projects = useAppStore(s => s.projects);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const project = projects.find((p) => p.id === allThreadsProjectId);
  const allThreads = allThreadsProjectId ? (threadsByProject[allThreadsProjectId] ?? []) : [];

  const filtered = useMemo(() => {
    if (!search.trim()) return allThreads;
    const q = search.toLowerCase();
    return allThreads.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        (t.branch && t.branch.toLowerCase().includes(q)) ||
        t.status.toLowerCase().includes(q)
    );
  }, [allThreads, search]);

  const currentPage = Math.min(page, Math.max(1, Math.ceil(filtered.length / ITEMS_PER_PAGE)));
  const paginated = filtered.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE
  );

  const handleSearchChange = (value: string) => {
    setSearch(value);
    setPage(1);
  };

  if (!allThreadsProjectId || !project) return null;

  return (
    <div className="flex-1 flex flex-col h-full min-w-0">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => {
            useAppStore.getState().closeAllThreads();
            navigate(`/projects/${allThreadsProjectId}`);
          }}
          className="text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <div>
          <h2 className="text-sm font-medium">{t('allThreads.title')}</h2>
          <p className="text-xs text-muted-foreground">{project.name} &middot; {allThreads.length} {t('allThreads.threads')}</p>
        </div>
      </div>

      {/* Thread list */}
      <div className="flex-1 min-h-0 px-4 py-3">
        <ThreadListView
          className="h-full"
          autoFocusSearch
          threads={paginated}
          totalCount={filtered.length}
          search={search}
          onSearchChange={handleSearchChange}
          searchPlaceholder={t('allThreads.searchPlaceholder')}
          page={currentPage}
          onPageChange={setPage}
          pageSize={ITEMS_PER_PAGE}
          emptyMessage={t('allThreads.noThreads')}
          searchEmptyMessage={t('allThreads.noMatch')}
          onThreadClick={(thread) => navigate(`/projects/${allThreadsProjectId}/threads/${thread.id}`)}
          paginationLabel={({ total }) =>
            `${total} ${t('allThreads.threads')}${search ? ` ${t('allThreads.found')}` : ''}`
          }
        />
      </div>
    </div>
  );
}
