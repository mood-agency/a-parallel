import {
  dropTargetForElements,
  monitorForElements,
} from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { DEFAULT_THREAD_MODE } from '@funny/shared/models';
import { Loader2, LayoutGrid, Grid2x2, Plus, X } from 'lucide-react';
import { useState, useEffect, useRef, useCallback, useMemo, memo, startTransition } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { ThreadPowerline } from '@/components/ThreadPowerline';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { colorFromName } from '@/components/ui/project-chip';
import { ScrollArea } from '@/components/ui/scroll-area';
import { SearchBar } from '@/components/ui/search-bar';
import { TooltipIconButton } from '@/components/ui/tooltip-icon-button';
import { useMinuteTick } from '@/hooks/use-minute-tick';
import { api } from '@/lib/api';
import { createClientLogger } from '@/lib/client-logger';
import { getGridCells, type GridCellAssignments } from '@/lib/grid-storage';
import { statusConfig } from '@/lib/thread-utils';
import { toastError } from '@/lib/toast-error';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/stores/app-store';
import { useProjectStore } from '@/stores/project-store';
import { useSettingsStore, deriveToolLists } from '@/stores/settings-store';
import { useThreadStore, type ThreadWithMessages } from '@/stores/thread-store';

import { ImageLightbox } from './ImageLightbox';
import { PromptInput } from './PromptInput';
import { MessageStream, type MessageStreamHandle } from './thread/MessageStream';

type OpenLightboxFn = (images: { src: string; alt: string }[], index: number) => void;

const log = createClientLogger('LiveColumnsView');

const MAX_GRID_COLS = 5;
const MAX_GRID_ROWS = 5;

/** A small popover that lets the user pick a project. Used by the grid header
 *  and by empty cells to choose which project a new thread should belong to. */
function ProjectPickerPopover({
  trigger,
  onSelect,
  placeholder,
}: {
  trigger: React.ReactNode;
  onSelect: (projectId: string) => void;
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const projects = useProjectStore((s) => s.projects);
  const filtered = search
    ? projects.filter((p) => p.name.toLowerCase().includes(search.toLowerCase()))
    : projects;

  return (
    <Popover
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) setSearch('');
      }}
    >
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-0">
        <div className="border-b border-border/50 px-2 py-1.5">
          <SearchBar
            query={search}
            onQueryChange={setSearch}
            placeholder={placeholder}
            totalMatches={filtered.length}
            resultLabel={search ? `${filtered.length}/${projects.length}` : ''}
            autoFocus
            testIdPrefix="grid-project-picker-search"
          />
        </div>
        <ScrollArea className="max-h-56 py-1">
          {filtered.length === 0 ? (
            <div className="py-3 text-center text-sm text-muted-foreground">—</div>
          ) : (
            filtered.map((p) => (
              <button
                key={p.id}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-accent"
                data-testid={`grid-project-pick-${p.id}`}
                onClick={() => {
                  setOpen(false);
                  setSearch('');
                  onSelect(p.id);
                }}
              >
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: p.color || colorFromName(p.name) }}
                />
                <span className="truncate">{p.name}</span>
              </button>
            ))
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}

function GridPicker({
  cols,
  rows,
  onChange,
}: {
  cols: number;
  rows: number;
  onChange: (cols: number, rows: number) => void;
}) {
  const [hoverCol, setHoverCol] = useState(0);
  const [hoverRow, setHoverRow] = useState(0);
  const [open, setOpen] = useState(false);

  const displayCol = open && hoverCol > 0 ? hoverCol : cols;
  const displayRow = open && hoverRow > 0 ? hoverRow : rows;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" className="h-6 min-w-0 gap-1.5 px-2 text-[10px]">
          <Grid2x2 className="icon-sm" />
          {cols}×{rows}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-3" align="end" sideOffset={4}>
        <div
          className="grid gap-1"
          style={{ gridTemplateColumns: `repeat(${MAX_GRID_COLS}, 1fr)` }}
          onMouseLeave={() => {
            setHoverCol(0);
            setHoverRow(0);
          }}
        >
          {Array.from({ length: MAX_GRID_ROWS }, (_, r) =>
            Array.from({ length: MAX_GRID_COLS }, (_, c) => {
              const isHighlighted = c + 1 <= displayCol && r + 1 <= displayRow;
              return (
                <button
                  key={`${c}-${r}`}
                  className={cn(
                    'w-5 h-5 rounded-sm border transition-colors',
                    isHighlighted
                      ? 'bg-primary border-primary'
                      : 'bg-muted/40 border-border hover:border-muted-foreground/40',
                  )}
                  onMouseEnter={() => {
                    setHoverCol(c + 1);
                    setHoverRow(r + 1);
                  }}
                  onClick={() => {
                    onChange(c + 1, r + 1);
                    setOpen(false);
                  }}
                />
              );
            }),
          )}
        </div>
        <p className="mt-2 text-center text-[10px] text-muted-foreground">
          {displayCol}×{displayRow}
        </p>
      </PopoverContent>
    </Popover>
  );
}

/** A single column that loads and streams a thread in real-time */
const ThreadColumn = memo(function ThreadColumn({
  threadId,
  onRemove,
  onOpenLightbox,
}: {
  threadId: string;
  onRemove?: () => void;
  onOpenLightbox?: OpenLightboxFn;
}) {
  const { t } = useTranslation();
  const [thread, setThread] = useState<ThreadWithMessages | null>(null);
  const [loading, setLoading] = useState(true);
  const streamRef = useRef<MessageStreamHandle>(null);
  const projects = useProjectStore((s) => s.projects);

  // Subscribe only to this thread's status — avoids re-rendering when other threads change
  const liveStatus = useThreadStore((s) => {
    for (const threads of Object.values(s.threadsByProject)) {
      const found = threads.find((t) => t.id === threadId);
      if (found) return found.status;
    }
    return null;
  });

  // Keep a ref to onRemove so effects don't re-run when the parent re-creates the callback.
  const onRemoveRef = useRef(onRemove);
  useEffect(() => {
    onRemoveRef.current = onRemove;
  }, [onRemove]);

  // Load thread data
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.getThread(threadId, 50).then((result) => {
      if (cancelled) return;
      if (result.isOk()) {
        setThread(result.value as ThreadWithMessages);
      } else if (result.error.type === 'NOT_FOUND') {
        onRemoveRef.current?.();
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [threadId]);

  // Refresh thread data when status changes (driven by WS events, no polling needed)
  const prevStatusRef = useRef(liveStatus);
  useEffect(() => {
    if (liveStatus === prevStatusRef.current) return;
    prevStatusRef.current = liveStatus;
    api.getThread(threadId, 50).then((result) => {
      if (result.isOk()) {
        setThread(result.value as ThreadWithMessages);
      } else if (result.error.type === 'NOT_FOUND') {
        onRemoveRef.current?.();
      }
    });
  }, [threadId, liveStatus]);

  const threadProjectId = thread?.projectId;
  const threadProject = useMemo(() => {
    if (!threadProjectId) return null;
    return projects.find((p) => p.id === threadProjectId) ?? null;
  }, [threadProjectId, projects]);
  const projectName = threadProject?.name ?? '';

  const [sending, setSending] = useState(false);

  const handleSend = useCallback(
    async (
      prompt: string,
      opts: {
        provider?: string;
        model: string;
        mode: string;
        fileReferences?: { path: string; type?: 'file' | 'folder' }[];
        symbolReferences?: {
          path: string;
          name: string;
          kind: string;
          line: number;
          endLine?: number;
        }[];
      },
      images?: any[],
    ) => {
      if (sending || !thread) return;
      setSending(true);
      // Scroll to bottom when user sends
      streamRef.current?.scrollToBottom();
      startTransition(() => {
        useAppStore
          .getState()
          .appendOptimisticMessage(
            threadId,
            prompt,
            images,
            opts.model as any,
            opts.mode as any,
            opts.fileReferences,
          );
      });
      const { allowedTools, disallowedTools } = deriveToolLists(
        useSettingsStore.getState().toolPermissions,
      );
      const result = await api.sendMessage(
        threadId,
        prompt,
        {
          provider: opts.provider || undefined,
          model: opts.model || undefined,
          permissionMode: opts.mode || undefined,
          allowedTools,
          disallowedTools,
          fileReferences: opts.fileReferences,
          symbolReferences: opts.symbolReferences,
        },
        images,
      );
      if (result.isErr()) {
        const err = result.error;
        if (err.type === 'INTERNAL') {
          toast.error(t('thread.sendFailed'));
        } else {
          toast.error(t('thread.sendFailedGeneric', { error: err.message }));
        }
      }
      setSending(false);
    },
    [sending, threadId, thread, t],
  );

  const handleStop = useCallback(async () => {
    await api.stopThread(threadId);
  }, [threadId]);

  const status = liveStatus ?? thread?.status ?? 'idle';
  const StatusIcon = statusConfig[status]?.icon ?? Loader2;
  const statusClass = statusConfig[status]?.className ?? '';

  if (loading) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center rounded-sm border border-border">
        <Loader2 className="icon-lg animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!thread) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center rounded-sm border border-border text-xs text-muted-foreground">
        {t('thread.notFound', 'Thread not found')}
      </div>
    );
  }

  const isRunning = status === 'running';

  return (
    <div
      className="group/col flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-sm border border-border"
      data-testid={`grid-column-${threadId}`}
    >
      {/* Column header */}
      <div className="flex-shrink-0 border-b border-border bg-sidebar/50 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <StatusIcon className={cn('icon-sm shrink-0', statusClass)} />
          <span className="flex-1 truncate text-sm font-medium" title={thread.title}>
            {thread.title}
          </span>
          {onRemove && (
            <TooltipIconButton
              tooltip={t('live.removeFromGrid', 'Remove from grid')}
              onClick={onRemove}
              className="h-5 w-5 shrink-0 opacity-0 transition-opacity group-hover/col:opacity-100"
              data-testid={`grid-remove-${threadId}`}
            >
              <X className="icon-xs" />
            </TooltipIconButton>
          )}
        </div>
        <ThreadPowerline
          thread={thread}
          projectName={projectName}
          projectColor={threadProject?.color}
          className="mt-1"
          data-testid={`grid-column-powerline-${threadId}`}
        />
      </div>

      {/* Messages — uses the same MessageStream as the main ThreadView */}
      <MessageStream
        ref={streamRef}
        compact
        threadId={thread.id}
        status={status}
        messages={thread.messages ?? []}
        threadEvents={thread.threadEvents}
        compactionEvents={thread.compactionEvents}
        initInfo={thread.initInfo}
        resultInfo={thread.resultInfo}
        waitingReason={thread.waitingReason}
        pendingPermission={thread.pendingPermission}
        isExternal={thread.provider === 'external'}
        model={thread.model}
        permissionMode={thread.permissionMode}
        onSend={handleSend}
        onOpenLightbox={onOpenLightbox}
        className="min-h-0 flex-1"
        footer={
          <PromptInput
            onSubmit={handleSend}
            onStop={handleStop}
            loading={sending}
            running={isRunning}
            threadId={thread.id}
            placeholder={t('thread.nextPrompt')}
          />
        }
      />
    </div>
  );
});

/** Drop target wrapper for grid cells — highlights when a sidebar thread is dragged over */
const GridCellDropTarget = memo(function GridCellDropTarget({
  cellIndex,
  children,
}: {
  cellIndex: number;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [isOver, setIsOver] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    return dropTargetForElements({
      element: el,
      getData: () => ({ type: 'grid-cell', cellIndex }),
      canDrop: ({ source }) => source.data.type === 'grid-thread',
      onDragEnter: () => setIsOver(true),
      onDragLeave: () => setIsOver(false),
      onDrop: () => setIsOver(false),
    });
  }, [cellIndex]);

  return (
    <div
      ref={ref}
      className={cn('flex min-h-0 flex-1 flex-col', isOver && 'rounded-sm ring-2 ring-primary')}
      data-testid={`grid-drop-target-${cellIndex}`}
    >
      {children}
    </div>
  );
});

/** Vertical drop strip rendered between/around grid columns. Dropping a thread here
 *  inserts a new grid column at that position and shifts existing columns to the right. */
const GridColumnInsertDropTarget = memo(function GridColumnInsertDropTarget({
  insertIndex,
  isDragging,
  disabled,
}: {
  insertIndex: number;
  isDragging: boolean;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [isOver, setIsOver] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    return dropTargetForElements({
      element: el,
      getData: () => ({ type: 'grid-col-insert', insertIndex }),
      canDrop: ({ source }) => !disabled && source.data.type === 'grid-thread',
      onDragEnter: () => setIsOver(true),
      onDragLeave: () => setIsOver(false),
      onDrop: () => setIsOver(false),
    });
  }, [insertIndex, disabled]);

  const active = isDragging && !disabled;
  return (
    <div
      ref={ref}
      className={cn(
        'shrink-0 self-stretch rounded-sm transition-all duration-150 overflow-hidden',
        isOver
          ? 'w-10 bg-primary/60 ring-2 ring-primary'
          : active
            ? 'w-6 bg-primary/10 hover:bg-primary/20'
            : 'w-1',
      )}
      data-testid={`grid-col-insert-${insertIndex}`}
    >
      {active && (
        <div className="flex h-full items-center justify-center">
          <Plus className="h-4 w-4 text-primary/60" />
        </div>
      )}
    </div>
  );
});

/** Creates an idle (draft) thread for the given project. The thread starts
 *  empty so the user can write the first prompt directly in its own column. */
async function createDraftThread(
  projectId: string,
  defaultMode: 'local' | 'worktree' | undefined,
): Promise<string | null> {
  const result = await api.createIdleThread({
    projectId,
    title: 'New thread',
    mode: defaultMode || DEFAULT_THREAD_MODE,
  });
  if (result.isErr()) {
    toastError(result.error);
    return null;
  }
  return result.value.id;
}

/** Empty grid cell — pick a project and a draft thread is created automatically
 *  in this cell, ready for the user to write the first prompt. */
const EmptyGridCell = memo(function EmptyGridCell({
  cellIndex,
  onCreated,
}: {
  cellIndex: number;
  onCreated: (threadId: string) => void;
}) {
  const { t } = useTranslation();
  const projects = useProjectStore((s) => s.projects);
  const loadThreadsForProject = useThreadStore((s) => s.loadThreadsForProject);
  const [creating, setCreating] = useState(false);

  const handleSelectProject = useCallback(
    async (pid: string) => {
      if (creating) return;
      setCreating(true);
      const project = projects.find((p) => p.id === pid);
      const threadId = await createDraftThread(pid, project?.defaultMode);
      if (threadId) {
        log.info({ cellIndex, projectId: pid, threadId }, 'inline grid draft thread created');
        await loadThreadsForProject(pid);
        onCreated(threadId);
      }
      setCreating(false);
    },
    [creating, projects, loadThreadsForProject, onCreated, cellIndex],
  );

  return (
    <div
      className="flex h-full w-full flex-col items-center justify-center gap-3 rounded-sm border-2 border-dashed border-border/60 bg-muted/10 p-4 transition-colors hover:border-primary/50 hover:bg-muted/30"
      data-testid={`grid-empty-cell-${cellIndex}`}
    >
      {creating ? (
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground/40" />
      ) : (
        <>
          <Plus className="h-8 w-8 text-muted-foreground/40" />
          <ProjectPickerPopover
            placeholder={t('kanban.searchProject', 'Search project...')}
            onSelect={handleSelectProject}
            trigger={
              <Button
                variant="default"
                size="sm"
                className="h-7"
                data-testid={`grid-empty-new-${cellIndex}`}
              >
                <Plus className="icon-sm" />
                {t('live.selectProject', 'Select project')}
              </Button>
            }
          />
        </>
      )}
    </div>
  );
});

export function LiveColumnsView() {
  const { t } = useTranslation();
  useMinuteTick();
  const projects = useProjectStore((s) => s.projects);
  const loadThreadsForProject = useThreadStore((s) => s.loadThreadsForProject);
  const [gridCols, setGridCols] = useState(() => {
    const saved = localStorage.getItem('funny:grid-cols');
    return saved ? Math.min(Math.max(Number(saved), 1), MAX_GRID_COLS) : 2;
  });
  const [gridRows, setGridRows] = useState(() => {
    const saved = localStorage.getItem('funny:grid-rows');
    return saved ? Math.min(Math.max(Number(saved), 1), MAX_GRID_ROWS) : 2;
  });

  // Load threads once for any project that hasn't been loaded yet (no polling —
  // WS events like thread:created, thread:updated, and agent:status keep the
  // store in sync after the initial load).
  const projectIdsKey = useMemo(() => projects.map((p) => p.id).join(','), [projects]);
  useEffect(() => {
    const state = useThreadStore.getState();
    for (const project of projects) {
      if (!state.threadsByProject[project.id]) {
        loadThreadsForProject(project.id);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectIdsKey]);

  // --- Image lightbox (shared across all columns) ---
  const [lightboxImages, setLightboxImages] = useState<{ src: string; alt: string }[]>([]);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const openLightbox = useCallback<OpenLightboxFn>((images, index) => {
    setLightboxImages(images);
    setLightboxIndex(index);
    setLightboxOpen(true);
  }, []);

  // --- Grid cell assignments (manual selection) ---
  const [gridCells, setGridCells] = useState<GridCellAssignments>(getGridCells);

  const assignThreadToCell = useCallback((cellIndex: number, threadId: string) => {
    setGridCells((prev) => {
      const updated = { ...prev };
      // Avoid duplicates: if the thread already sits in another cell, move it.
      for (const [key, val] of Object.entries(updated)) {
        if (val === threadId) delete updated[key];
      }
      updated[String(cellIndex)] = threadId;
      localStorage.setItem('funny:grid-cells', JSON.stringify(updated));
      return updated;
    });
  }, []);

  const handleRemoveFromGrid = useCallback(
    (cellIndex: number) => {
      setGridCells((prev) => {
        const updated = { ...prev };
        delete updated[String(cellIndex)];

        const col = cellIndex % gridCols;

        if (gridCols <= 1) {
          localStorage.setItem('funny:grid-cells', JSON.stringify(updated));
          return updated;
        }

        const columnEmpty = Array.from({ length: gridRows }).every((_, r) => {
          const idx = r * gridCols + col;
          return !updated[String(idx)];
        });

        if (!columnEmpty) {
          localStorage.setItem('funny:grid-cells', JSON.stringify(updated));
          return updated;
        }

        const newCols = gridCols - 1;
        const collapsed: GridCellAssignments = {};
        for (const [key, val] of Object.entries(updated)) {
          const oldIdx = Number(key);
          const oldCol = oldIdx % gridCols;
          const oldRow = Math.floor(oldIdx / gridCols);
          if (oldCol === col) continue;
          const newCol = oldCol > col ? oldCol - 1 : oldCol;
          collapsed[String(oldRow * newCols + newCol)] = val;
        }
        setGridCols(newCols);
        localStorage.setItem('funny:grid-cols', String(newCols));
        localStorage.setItem('funny:grid-cells', JSON.stringify(collapsed));
        return collapsed;
      });
    },
    [gridCols, gridRows],
  );

  // Header "+" flow: pick a project, then a draft thread is created automatically
  // and placed in a brand-new column appended at the right of the grid.
  const [headerCreating, setHeaderCreating] = useState(false);
  const handleAddColumnWithProject = useCallback(
    async (pid: string) => {
      if (headerCreating) return;
      if (gridCols >= MAX_GRID_COLS) {
        toast.info(t('live.gridFull', 'Grid is full'));
        return;
      }
      setHeaderCreating(true);
      const project = projects.find((p) => p.id === pid);
      const threadId = await createDraftThread(pid, project?.defaultMode);
      if (!threadId) {
        setHeaderCreating(false);
        return;
      }
      log.info({ projectId: pid, threadId }, 'header new draft thread created');
      await loadThreadsForProject(pid);

      const oldCols = gridCols;
      const newCols = oldCols + 1;
      const insertIndex = oldCols; // append at the right
      setGridCells((prev) => {
        const updated: GridCellAssignments = {};
        for (const [key, val] of Object.entries(prev)) {
          if (val === threadId) continue;
          const oldIdx = Number(key);
          const oldCol = oldIdx % oldCols;
          const oldRow = Math.floor(oldIdx / oldCols);
          updated[String(oldRow * newCols + oldCol)] = val;
        }
        // Place new thread at the top cell of the newly appended column
        updated[String(insertIndex)] = threadId;
        localStorage.setItem('funny:grid-cells', JSON.stringify(updated));
        return updated;
      });
      setGridCols(newCols);
      localStorage.setItem('funny:grid-cols', String(newCols));
      setHeaderCreating(false);
    },
    [headerCreating, gridCols, projects, loadThreadsForProject, t],
  );

  // Track whether a sidebar thread is currently being dragged so column-insert
  // strips can highlight themselves as available drop targets.
  const [isDragging, setIsDragging] = useState(false);

  // Monitor drag-and-drop: assign sidebar threads dropped onto grid cells, or
  // insert a new column when dropped on a column-insert strip.
  useEffect(() => {
    return monitorForElements({
      onDragStart: ({ source }) => {
        if (source.data.type === 'grid-thread') setIsDragging(true);
      },
      onDrop: ({ source, location }) => {
        setIsDragging(false);
        if (source.data.type !== 'grid-thread') return;
        const targets = location.current.dropTargets;
        if (!targets.length) return;

        const targetData = targets[0].data;
        const threadId = source.data.threadId as string;

        if (targetData.type === 'grid-cell') {
          const cellIndex = targetData.cellIndex as number;
          setGridCells((prev) => {
            // If thread is already assigned to another cell, remove it first
            const updated = { ...prev };
            for (const [key, val] of Object.entries(updated)) {
              if (val === threadId) delete updated[key];
            }
            updated[String(cellIndex)] = threadId;
            localStorage.setItem('funny:grid-cells', JSON.stringify(updated));
            return updated;
          });
          return;
        }

        if (targetData.type === 'grid-col-insert') {
          const insertIndex = targetData.insertIndex as number;
          if (gridCols >= MAX_GRID_COLS) {
            toast.info(t('live.gridFull', 'Grid is full'));
            return;
          }
          const oldCols = gridCols;
          const newCols = oldCols + 1;
          setGridCells((prev) => {
            const updated: GridCellAssignments = {};
            for (const [key, val] of Object.entries(prev)) {
              if (val === threadId) continue;
              const oldIdx = Number(key);
              const oldCol = oldIdx % oldCols;
              const oldRow = Math.floor(oldIdx / oldCols);
              const newCol = oldCol < insertIndex ? oldCol : oldCol + 1;
              const newIdx = oldRow * newCols + newCol;
              updated[String(newIdx)] = val;
            }
            updated[String(insertIndex)] = threadId;
            localStorage.setItem('funny:grid-cells', JSON.stringify(updated));
            return updated;
          });
          setGridCols(newCols);
          localStorage.setItem('funny:grid-cols', String(newCols));
        }
      },
    });
  }, [gridCols, t]);

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden" data-testid="grid-view">
      {/* Header */}
      <div className="flex flex-shrink-0 items-center gap-2 border-b border-border px-4 py-2">
        <span className="flex items-center gap-2 text-sm font-medium">
          <LayoutGrid className="icon-sm text-muted-foreground" /> {t('live.title', 'Grid')}
        </span>
        {/* Pick a project → a draft thread is auto-created in a brand-new column */}
        <ProjectPickerPopover
          placeholder={t('kanban.searchProject', 'Search project...')}
          onSelect={handleAddColumnWithProject}
          trigger={
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              data-testid="grid-new-thread"
              disabled={gridCols >= MAX_GRID_COLS || headerCreating}
            >
              {headerCreating ? (
                <Loader2 className="icon-base animate-spin" />
              ) : (
                <Plus className="icon-base" />
              )}
            </Button>
          }
        />

        {/* Grid size picker */}
        <div className="ml-auto">
          <GridPicker
            cols={gridCols}
            rows={gridRows}
            onChange={(c, r) => {
              setGridCols(c);
              setGridRows(r);
              localStorage.setItem('funny:grid-cols', String(c));
              localStorage.setItem('funny:grid-rows', String(r));
            }}
          />
        </div>
      </div>

      {/* Grid */}
      <div
        data-testid="grid-container"
        className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden p-2"
      >
        <div className="flex h-full">
          <GridColumnInsertDropTarget
            insertIndex={0}
            isDragging={isDragging}
            disabled={gridCols >= MAX_GRID_COLS}
          />
          {Array.from({ length: gridCols }).flatMap((_, c) => [
            <div
              key={`col-${c}`}
              className="flex h-full min-w-[280px] flex-1 flex-col gap-2"
              data-testid={`grid-col-${c}`}
            >
              {Array.from({ length: gridRows }, (_, r) => {
                const cellIndex = r * gridCols + c;
                const threadId = gridCells[String(cellIndex)];
                return (
                  <GridCellDropTarget
                    key={threadId ? `col-${threadId}` : `empty-${cellIndex}`}
                    cellIndex={cellIndex}
                  >
                    {threadId ? (
                      <ThreadColumn
                        threadId={threadId}
                        onRemove={() => handleRemoveFromGrid(cellIndex)}
                        onOpenLightbox={openLightbox}
                      />
                    ) : (
                      <EmptyGridCell
                        cellIndex={cellIndex}
                        onCreated={(newThreadId) => assignThreadToCell(cellIndex, newThreadId)}
                      />
                    )}
                  </GridCellDropTarget>
                );
              })}
            </div>,
            <GridColumnInsertDropTarget
              key={`insert-${c + 1}`}
              insertIndex={c + 1}
              isDragging={isDragging}
              disabled={gridCols >= MAX_GRID_COLS}
            />,
          ])}
        </div>
      </div>

      <ImageLightbox
        images={lightboxImages}
        initialIndex={lightboxIndex}
        open={lightboxOpen}
        onClose={() => setLightboxOpen(false)}
      />
    </div>
  );
}
