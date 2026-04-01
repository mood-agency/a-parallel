import { useVirtualizer } from '@tanstack/react-virtual';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  ensureLanguage,
  filePathToHljsLang,
  highlightLine,
  HIGHLIGHT_MAX_LINES,
} from '@/hooks/use-highlight';
import { cn } from '@/lib/utils';

/* ── Types ── */

interface DiffLine {
  type: 'add' | 'del' | 'ctx';
  text: string;
  oldNo?: number;
  newNo?: number;
}

interface DiffSection {
  kind: 'change' | 'context';
  startIdx: number;
  endIdx: number;
  collapsed: boolean;
}

type VirtualRow =
  | { type: 'line'; lineIdx: number }
  | { type: 'fold'; sectionIdx: number; lineCount: number; oldStart: number; newStart: number }
  | { type: 'hunk'; text: string };

type RenderRow =
  | { type: 'unified-line'; line: DiffLine }
  | { type: 'split-pair'; pair: SplitPair }
  | { type: 'fold'; sectionIdx: number; lineCount: number; oldStart: number; newStart: number }
  | { type: 'hunk'; text: string };

interface SplitPair {
  left?: DiffLine;
  right?: DiffLine;
}

export interface VirtualDiffProps {
  /** Raw unified diff string (from gitoxide or git diff) */
  unifiedDiff: string;
  /** Split view (two columns) or unified (one column). Default: false */
  splitView?: boolean;
  /** File path for syntax highlighting language detection */
  filePath?: string;
  /** Enable code folding for context sections. Default: true */
  codeFolding?: boolean;
  /** Lines of context around each change (default 3) */
  contextLines?: number;
  /** Show a minimap bar on the right with change indicators. Default: false */
  showMinimap?: boolean;
  className?: string;
  'data-testid'?: string;
}

/* ── Parser ── */

const HUNK_RE = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

interface ParsedDiff {
  lines: DiffLine[];
  hunkHeaders: Map<number, string>;
}

function parseUnifiedDiff(diff: string): ParsedDiff {
  const raw = diff.split('\n');
  const lines: DiffLine[] = [];
  const hunkHeaders = new Map<number, string>();
  let oldNo = 0;
  let newNo = 0;
  let inHunk = false;

  for (const line of raw) {
    const hunkMatch = HUNK_RE.exec(line);
    if (hunkMatch) {
      oldNo = parseInt(hunkMatch[1], 10);
      newNo = parseInt(hunkMatch[2], 10);
      inHunk = true;
      hunkHeaders.set(lines.length, line);
      continue;
    }

    if (!inHunk) continue;

    if (line.startsWith('+')) {
      lines.push({ type: 'add', text: line.substring(1), newNo: newNo++ });
    } else if (line.startsWith('-')) {
      lines.push({ type: 'del', text: line.substring(1), oldNo: oldNo++ });
    } else if (line.startsWith('\\')) {
      continue;
    } else {
      const text = line.length > 0 && line[0] === ' ' ? line.substring(1) : line;
      lines.push({ type: 'ctx', text, oldNo: oldNo++, newNo: newNo++ });
    }
  }

  return { lines, hunkHeaders };
}

/* ── Section builder (code folding) ── */

function buildSections(lines: DiffLine[], contextLines: number): DiffSection[] {
  if (lines.length === 0) return [];

  const sections: DiffSection[] = [];
  let currentKind: 'change' | 'context' = lines[0].type === 'ctx' ? 'context' : 'change';
  let startIdx = 0;

  for (let i = 1; i <= lines.length; i++) {
    const kind = i < lines.length ? (lines[i].type === 'ctx' ? 'context' : 'change') : 'other';
    if (kind !== currentKind || i === lines.length) {
      sections.push({ kind: currentKind, startIdx, endIdx: i - 1, collapsed: false });
      currentKind = kind as 'change' | 'context';
      startIdx = i;
    }
  }

  // Auto-collapse large context sections
  for (const section of sections) {
    if (section.kind === 'context') {
      const len = section.endIdx - section.startIdx + 1;
      if (len > contextLines * 2) section.collapsed = true;
    }
  }

  return sections;
}

/* ── Virtual row builder ── */

function buildVirtualRows(
  sections: DiffSection[],
  lines: DiffLine[],
  hunkHeaders: Map<number, string>,
  contextLines: number,
): VirtualRow[] {
  const rows: VirtualRow[] = [];

  for (let si = 0; si < sections.length; si++) {
    const section = sections[si];

    if (hunkHeaders.has(section.startIdx)) {
      rows.push({ type: 'hunk', text: hunkHeaders.get(section.startIdx)! });
    }

    if (section.kind === 'change' || !section.collapsed) {
      for (let i = section.startIdx; i <= section.endIdx; i++) {
        rows.push({ type: 'line', lineIdx: i });
      }
    } else {
      const topEnd = Math.min(section.startIdx + contextLines - 1, section.endIdx);
      const botStart = Math.max(section.endIdx - contextLines + 1, topEnd + 1);
      const foldedCount = botStart - topEnd - 1;

      for (let i = section.startIdx; i <= topEnd; i++) {
        rows.push({ type: 'line', lineIdx: i });
      }

      if (foldedCount > 0) {
        rows.push({
          type: 'fold',
          sectionIdx: si,
          lineCount: foldedCount,
          oldStart: lines[topEnd + 1]?.oldNo ?? 0,
          newStart: lines[topEnd + 1]?.newNo ?? 0,
        });
      }

      for (let i = botStart; i <= section.endIdx; i++) {
        rows.push({ type: 'line', lineIdx: i });
      }
    }
  }

  return rows;
}

/* ── Split view pairing ── */

function buildSplitPairs(lines: DiffLine[], startIdx: number, endIdx: number): SplitPair[] {
  const pairs: SplitPair[] = [];
  let i = startIdx;

  while (i <= endIdx) {
    const line = lines[i];

    if (line.type === 'ctx') {
      pairs.push({ left: line, right: line });
      i++;
    } else if (line.type === 'del') {
      const dels: DiffLine[] = [];
      while (i <= endIdx && lines[i].type === 'del') {
        dels.push(lines[i]);
        i++;
      }
      const adds: DiffLine[] = [];
      while (i <= endIdx && lines[i].type === 'add') {
        adds.push(lines[i]);
        i++;
      }
      const maxLen = Math.max(dels.length, adds.length);
      for (let j = 0; j < maxLen; j++) {
        pairs.push({ left: dels[j], right: adds[j] });
      }
    } else {
      pairs.push({ right: line });
      i++;
    }
  }

  return pairs;
}

/* ── Highlight cache ── */

const ROW_HEIGHT = 20;
const highlightCache = new Map<string, string>();

function getCachedHighlight(text: string, lang: string): string {
  const key = `${lang}:${text}`;
  let cached = highlightCache.get(key);
  if (cached === undefined) {
    cached = highlightLine(text, lang);
    highlightCache.set(key, cached);
    if (highlightCache.size > 20_000) {
      const iter = highlightCache.keys();
      for (let i = 0; i < 5_000; i++) {
        const k = iter.next();
        if (k.done) break;
        highlightCache.delete(k.value);
      }
    }
  }
  return cached;
}

/* ── Row components ── */

const UnifiedRow = memo(function UnifiedRow({ line, lang }: { line: DiffLine; lang: string }) {
  const bgStyle =
    line.type === 'add'
      ? { backgroundColor: 'hsl(var(--diff-added) / 0.12)' }
      : line.type === 'del'
        ? { backgroundColor: 'hsl(var(--diff-removed) / 0.12)' }
        : undefined;

  const textClass =
    line.type === 'add'
      ? 'text-diff-added'
      : line.type === 'del'
        ? 'text-diff-removed'
        : 'text-foreground/80';

  const prefix = line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' ';

  return (
    <div
      className="flex items-center font-mono text-[11px]"
      style={{ height: ROW_HEIGHT, ...bgStyle }}
    >
      <span className="w-11 flex-shrink-0 select-none pr-1 text-right text-muted-foreground/40">
        {line.oldNo ?? ''}
      </span>
      <span className="w-11 flex-shrink-0 select-none pr-1 text-right text-muted-foreground/40">
        {line.newNo ?? ''}
      </span>
      <span className={cn('w-4 flex-shrink-0 select-none text-center', textClass)}>{prefix}</span>
      <span
        className={cn('whitespace-pre pr-4', textClass)}
        dangerouslySetInnerHTML={{ __html: getCachedHighlight(line.text, lang) }}
      />
    </div>
  );
});

const SplitRow = memo(function SplitRow({
  left,
  right,
  lang,
}: {
  left?: DiffLine;
  right?: DiffLine;
  lang: string;
}) {
  return (
    <div className="flex font-mono text-[11px]" style={{ height: ROW_HEIGHT }}>
      {/* Left (old) */}
      <div
        className="flex flex-1 items-center overflow-hidden border-r border-border/30"
        style={
          left?.type === 'del' ? { backgroundColor: 'hsl(var(--diff-removed) / 0.12)' } : undefined
        }
      >
        <span className="w-11 flex-shrink-0 select-none pr-1 text-right text-muted-foreground/40">
          {left?.oldNo ?? ''}
        </span>
        <span
          className={cn(
            'w-4 flex-shrink-0 select-none text-center',
            left?.type === 'del' ? 'text-diff-removed' : 'text-foreground/80',
          )}
        >
          {left?.type === 'del' ? '-' : left ? ' ' : ''}
        </span>
        {left && (
          <span
            className={cn(
              'whitespace-pre pr-4',
              left.type === 'del' ? 'text-diff-removed' : 'text-foreground/80',
            )}
            dangerouslySetInnerHTML={{ __html: getCachedHighlight(left.text, lang) }}
          />
        )}
      </div>
      {/* Right (new) */}
      <div
        className="flex flex-1 items-center overflow-hidden"
        style={
          right?.type === 'add' ? { backgroundColor: 'hsl(var(--diff-added) / 0.12)' } : undefined
        }
      >
        <span className="w-11 flex-shrink-0 select-none pr-1 text-right text-muted-foreground/40">
          {right?.newNo ?? ''}
        </span>
        <span
          className={cn(
            'w-4 flex-shrink-0 select-none text-center',
            right?.type === 'add' ? 'text-diff-added' : 'text-foreground/80',
          )}
        >
          {right?.type === 'add' ? '+' : right ? ' ' : ''}
        </span>
        {right && (
          <span
            className={cn(
              'whitespace-pre pr-4',
              right.type === 'add' ? 'text-diff-added' : 'text-foreground/80',
            )}
            dangerouslySetInnerHTML={{ __html: getCachedHighlight(right.text, lang) }}
          />
        )}
      </div>
    </div>
  );
});

/* ── Minimap component ── */

const MINIMAP_WIDTH = 48;

/**
 * Vertical minimap bar showing where changes are in the file.
 * Each line is rendered as a 1px-high colored strip.
 * A viewport indicator shows the currently visible region.
 * Clicking on the minimap scrolls to that position.
 */
const DiffMinimap = memo(function DiffMinimap({
  lines,
  scrollElement,
  totalSize,
}: {
  lines: DiffLine[];
  scrollElement: HTMLDivElement | null;
  /** Total virtual scroll height in px (from virtualizer.getTotalSize()) */
  totalSize: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [viewportTop, setViewportTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [containerHeight, setContainerHeight] = useState(0);

  // Build a flat array of line types for the minimap
  // This maps each rendered row index → 'add' | 'del' | 'ctx'
  const lineTypes = useMemo(() => {
    const types: Array<'add' | 'del' | 'ctx'> = [];
    for (const line of lines) {
      types.push(line.type);
    }
    return types;
  }, [lines]);

  // Observe container height changes
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerHeight(entry.contentRect.height);
      }
    });
    ro.observe(container);
    setContainerHeight(container.clientHeight);
    return () => ro.disconnect();
  }, []);

  // Draw the minimap canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || containerHeight === 0) return;

    const height = containerHeight;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = MINIMAP_WIDTH * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${MINIMAP_WIDTH}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, MINIMAP_WIDTH, height);

    const totalLines = lineTypes.length;
    if (totalLines === 0) return;

    // Each line gets at least 1px, but we cap at the available height
    const lineHeight = Math.max(1, height / totalLines);
    // Use the inner area (leave padding on sides)
    const barX = 4;
    const barWidth = MINIMAP_WIDTH - 8;

    for (let i = 0; i < totalLines; i++) {
      const type = lineTypes[i];
      if (type === 'ctx') continue; // Don't draw context lines — keep it clean

      const y = (i / totalLines) * height;
      const h = Math.max(lineHeight, 2); // minimum 2px so changes are visible

      if (type === 'add') {
        ctx.fillStyle = 'hsl(142, 40%, 45%)'; // --diff-added
      } else {
        ctx.fillStyle = 'hsl(0, 45%, 55%)'; // --diff-removed
      }
      ctx.fillRect(barX, y, barWidth, h);
    }
  }, [lineTypes, containerHeight]);

  // Track viewport position via scroll events
  useEffect(() => {
    if (!scrollElement) return;

    const updateViewport = () => {
      const totalHeight = totalSize;
      if (totalHeight === 0 || containerHeight === 0) return;

      const scrollTop = scrollElement.scrollTop;
      const clientHeight = scrollElement.clientHeight;

      const ratio = containerHeight / totalHeight;
      setViewportTop(scrollTop * ratio);
      setViewportHeight(Math.max(clientHeight * ratio, 20)); // min 20px handle
    };

    updateViewport();
    scrollElement.addEventListener('scroll', updateViewport, { passive: true });
    const ro = new ResizeObserver(updateViewport);
    ro.observe(scrollElement);

    return () => {
      scrollElement.removeEventListener('scroll', updateViewport);
      ro.disconnect();
    };
  }, [scrollElement, totalSize, containerHeight]);

  // Handle click → scroll to position
  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      if (!scrollElement || containerHeight === 0) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const clickY = e.clientY - rect.top;
      const ratio = clickY / containerHeight;

      const clientHeight = scrollElement.clientHeight;
      const targetScroll = ratio * totalSize - clientHeight / 2;

      scrollElement.scrollTo({
        top: Math.max(0, Math.min(targetScroll, totalSize - clientHeight)),
      });
    },
    [scrollElement, containerHeight, totalSize],
  );

  // Handle drag on viewport indicator
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      if (!scrollElement || containerHeight === 0) return;

      const startY = e.clientY;
      const startScroll = scrollElement.scrollTop;
      const scale = totalSize / containerHeight;

      const onMove = (ev: MouseEvent) => {
        const deltaY = ev.clientY - startY;
        scrollElement.scrollTop = startScroll + deltaY * scale;
      };

      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [scrollElement, containerHeight, totalSize],
  );

  return (
    <div
      ref={containerRef}
      className="relative flex-shrink-0 cursor-pointer border-l border-border/50 bg-muted/20"
      style={{ width: MINIMAP_WIDTH }}
      onClick={handleClick}
      data-testid="diff-minimap"
    >
      <canvas ref={canvasRef} className="block" />
      {/* Viewport indicator */}
      <div
        className="absolute left-0 right-0 rounded-sm border border-foreground/20 bg-foreground/10"
        style={{
          top: viewportTop,
          height: viewportHeight,
        }}
        onMouseDown={handleMouseDown}
        data-testid="diff-minimap-viewport"
      />
    </div>
  );
});

/* ── Main component ── */

export const VirtualDiff = memo(function VirtualDiff({
  unifiedDiff,
  splitView = false,
  filePath,
  codeFolding = true,
  contextLines = 3,
  showMinimap = false,
  className,
  ...props
}: VirtualDiffProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null);
  const scrollCallbackRef = useCallback((node: HTMLDivElement | null) => {
    scrollRef.current = node;
    setScrollElement(node);
  }, []);
  const [langReady, setLangReady] = useState(false);
  const [collapsedState, setCollapsedState] = useState<Map<number, boolean>>(new Map());

  const parsed = useMemo(() => parseUnifiedDiff(unifiedDiff), [unifiedDiff]);

  const lang = useMemo(() => (filePath ? filePathToHljsLang(filePath) : 'plaintext'), [filePath]);

  useEffect(() => {
    if (lang === 'plaintext' || lang === 'text') {
      setLangReady(true);
      return;
    }
    let cancelled = false;
    ensureLanguage(lang).then(() => {
      if (!cancelled) setLangReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [lang]);

  const sections = useMemo(
    () => (codeFolding ? buildSections(parsed.lines, contextLines) : []),
    [parsed.lines, codeFolding, contextLines],
  );

  const effectiveSections = useMemo(() => {
    if (!codeFolding) return sections;
    return sections.map((s, i) => ({
      ...s,
      collapsed: collapsedState.has(i) ? collapsedState.get(i)! : s.collapsed,
    }));
  }, [sections, collapsedState, codeFolding]);

  // Build intermediate VirtualRow list
  const rows = useMemo((): VirtualRow[] => {
    if (!codeFolding) {
      const r: VirtualRow[] = [];
      const sortedHunks = [...parsed.hunkHeaders.entries()].sort((a, b) => a[0] - b[0]);
      let nextHunkI = 0;
      for (let i = 0; i < parsed.lines.length; i++) {
        if (nextHunkI < sortedHunks.length && sortedHunks[nextHunkI][0] === i) {
          r.push({ type: 'hunk', text: sortedHunks[nextHunkI][1] });
          nextHunkI++;
        }
        r.push({ type: 'line', lineIdx: i });
      }
      return r;
    }
    return buildVirtualRows(effectiveSections, parsed.lines, parsed.hunkHeaders, contextLines);
  }, [codeFolding, effectiveSections, parsed.lines, parsed.hunkHeaders, contextLines]);

  // Build final render rows (handles split view pairing)
  const renderRows = useMemo((): RenderRow[] => {
    if (splitView) {
      const result: RenderRow[] = [];
      let i = 0;
      while (i < rows.length) {
        const row = rows[i];
        if (row.type === 'hunk') {
          result.push({ type: 'hunk', text: row.text });
          i++;
        } else if (row.type === 'fold') {
          result.push(row);
          i++;
        } else {
          // Collect consecutive line rows
          const lineStart = row.lineIdx;
          let lineEnd = row.lineIdx;
          let j = i + 1;
          while (j < rows.length && rows[j].type === 'line') {
            lineEnd = (rows[j] as { type: 'line'; lineIdx: number }).lineIdx;
            j++;
          }
          for (const pair of buildSplitPairs(parsed.lines, lineStart, lineEnd)) {
            result.push({ type: 'split-pair', pair });
          }
          i = j;
        }
      }
      return result;
    }

    return rows.map((row): RenderRow => {
      if (row.type === 'hunk') return { type: 'hunk', text: row.text };
      if (row.type === 'fold') return row;
      return { type: 'unified-line', line: parsed.lines[row.lineIdx] };
    });
  }, [splitView, rows, parsed.lines]);

  const toggleFold = useCallback(
    (sectionIdx: number) => {
      setCollapsedState((prev) => {
        const next = new Map(prev);
        const isCollapsed = next.has(sectionIdx)
          ? next.get(sectionIdx)!
          : sections[sectionIdx].collapsed;
        next.set(sectionIdx, !isCollapsed);
        return next;
      });
    },
    [sections],
  );

  const virtualizer = useVirtualizer({
    count: renderRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 30,
  });

  const effectiveLang = langReady ? lang : 'plaintext';
  const tooManyLines = parsed.lines.length > HIGHLIGHT_MAX_LINES;
  const highlightLang = tooManyLines ? 'plaintext' : effectiveLang;

  if (parsed.lines.length === 0) {
    return (
      <p className="p-4 text-xs text-muted-foreground" data-testid={props['data-testid']}>
        No diff available
      </p>
    );
  }

  const gutterWidth = splitView ? 'w-[54px]' : 'w-[88px]';

  const diffContent = (
    <div
      ref={scrollCallbackRef}
      className={cn('overflow-auto', showMinimap ? 'flex-1 min-w-0' : className)}
      data-testid={props['data-testid']}
    >
      <div
        style={{
          height: virtualizer.getTotalSize(),
          width: '100%',
          position: 'relative',
        }}
      >
        {virtualizer.getVirtualItems().map((vItem) => {
          const row = renderRows[vItem.index];

          return (
            <div
              key={vItem.index}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: ROW_HEIGHT,
                transform: `translateY(${vItem.start}px)`,
              }}
            >
              {row.type === 'hunk' ? (
                <div
                  className="flex items-center bg-accent/50 px-2 font-mono text-[11px] text-muted-foreground"
                  style={{ height: ROW_HEIGHT }}
                >
                  <span className={cn(gutterWidth, 'flex-shrink-0 select-none')} />
                  <span className="truncate">{row.text}</span>
                </div>
              ) : row.type === 'fold' ? (
                <button
                  className="flex w-full items-center bg-muted/50 px-2 font-mono text-[11px] text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
                  style={{ height: ROW_HEIGHT }}
                  onClick={() => toggleFold(row.sectionIdx)}
                  data-testid="diff-fold-toggle"
                >
                  <span className={cn(gutterWidth, 'flex-shrink-0 select-none')} />
                  <span className="truncate">
                    @@ -{row.oldStart},{row.lineCount} +{row.newStart},{row.lineCount} @@ —{' '}
                    {row.lineCount} lines hidden
                  </span>
                </button>
              ) : row.type === 'split-pair' ? (
                <SplitRow left={row.pair.left} right={row.pair.right} lang={highlightLang} />
              ) : (
                <UnifiedRow line={row.line} lang={highlightLang} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );

  if (!showMinimap) return diffContent;

  return (
    <div className={cn('flex', className)}>
      {diffContent}
      <DiffMinimap
        lines={parsed.lines}
        scrollElement={scrollElement}
        totalSize={virtualizer.getTotalSize()}
      />
    </div>
  );
});
