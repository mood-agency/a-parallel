import type { TestFile, TestFileStatus } from '@funny/shared';
import {
  ChevronDown,
  ChevronRight,
  FileCode,
  Play,
  Loader2,
  CheckCircle2,
  XCircle,
  Circle,
} from 'lucide-react';
import { useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

interface TreeNode {
  name: string;
  path: string;
  isFolder: boolean;
  children: TreeNode[];
}

function buildTree(files: TestFile[]): TreeNode[] {
  const root: TreeNode[] = [];

  for (const file of files) {
    const parts = file.path.split('/');
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const name = parts[i];
      const isLast = i === parts.length - 1;
      const path = parts.slice(0, i + 1).join('/');

      let node = current.find((n) => n.name === name);
      if (!node) {
        node = { name, path, isFolder: !isLast, children: [] };
        current.push(node);
      }
      current = node.children;
    }
  }

  return root;
}

function StatusDot({ status }: { status: TestFileStatus | undefined }) {
  switch (status) {
    case 'running':
      return <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" />;
    case 'passed':
      return <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />;
    case 'failed':
      return <XCircle className="h-3.5 w-3.5 text-red-500" />;
    case 'stopped':
      return <Circle className="h-3.5 w-3.5 text-yellow-500" />;
    default:
      return <Circle className="h-3.5 w-3.5 text-muted-foreground/30" />;
  }
}

interface TreeItemProps {
  node: TreeNode;
  depth: number;
  expandedFolders: Set<string>;
  toggleFolder: (path: string) => void;
  fileStatuses: Record<string, TestFileStatus>;
  isRunning: boolean;
  onRunFile: (file: string) => void;
}

function TreeItem({
  node,
  depth,
  expandedFolders,
  toggleFolder,
  fileStatuses,
  isRunning,
  onRunFile,
}: TreeItemProps) {
  const isExpanded = expandedFolders.has(node.path);

  if (node.isFolder) {
    return (
      <>
        <button
          data-testid={`test-folder-${node.path}`}
          onClick={() => toggleFolder(node.path)}
          className="flex w-full items-center gap-1 px-2 py-1 text-sm hover:bg-accent/50"
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
        >
          {isExpanded ? (
            <ChevronDown className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
          )}
          <span className="truncate font-medium text-muted-foreground">{node.name}</span>
        </button>
        {isExpanded &&
          node.children.map((child) => (
            <TreeItem
              key={child.path}
              node={child}
              depth={depth + 1}
              expandedFolders={expandedFolders}
              toggleFolder={toggleFolder}
              fileStatuses={fileStatuses}
              isRunning={isRunning}
              onRunFile={onRunFile}
            />
          ))}
      </>
    );
  }

  const status = fileStatuses[node.path];

  return (
    <div
      data-testid={`test-file-${node.path}`}
      className={cn(
        'group flex items-center gap-1.5 px-2 py-1 text-sm hover:bg-accent/50',
        status === 'running' && 'bg-blue-500/5',
      )}
      style={{ paddingLeft: `${depth * 16 + 8}px` }}
    >
      <FileCode className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
      <span className="flex-1 truncate">{node.name}</span>
      <StatusDot status={status} />
      <Button
        data-testid={`test-play-${node.path}`}
        variant="ghost"
        size="icon"
        className="h-5 w-5 opacity-0 group-hover:opacity-100"
        disabled={isRunning}
        onClick={() => onRunFile(node.path)}
      >
        <Play className="h-3 w-3" />
      </Button>
    </div>
  );
}

interface TestFileBrowserProps {
  files: TestFile[];
  fileStatuses: Record<string, TestFileStatus>;
  isRunning: boolean;
  isLoading: boolean;
  onRunFile: (file: string) => void;
  onRunAll: () => void;
}

export function TestFileBrowser({
  files,
  fileStatuses,
  isRunning,
  isLoading,
  onRunFile,
  onRunAll,
}: TestFileBrowserProps) {
  const [search, setSearch] = useState('');
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());

  const filteredFiles = useMemo(() => {
    if (!search) return files;
    const lower = search.toLowerCase();
    return files.filter((f) => f.path.toLowerCase().includes(lower));
  }, [files, search]);

  const tree = useMemo(() => buildTree(filteredFiles), [filteredFiles]);

  // Auto-expand all folders when searching or when there are few files
  const effectiveExpanded = useMemo(() => {
    if (search || filteredFiles.length <= 20) {
      const all = new Set<string>();
      const collectFolders = (nodes: TreeNode[]) => {
        for (const node of nodes) {
          if (node.isFolder) {
            all.add(node.path);
            collectFolders(node.children);
          }
        }
      };
      collectFolders(tree);
      return all;
    }
    return expandedFolders;
  }, [search, filteredFiles.length, tree, expandedFolders]);

  const toggleFolder = (path: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  return (
    <div className="flex flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-2 border-b px-2 py-1.5">
        <Input
          data-testid="test-search"
          placeholder="Search tests..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-7 text-xs"
        />
        <Button
          data-testid="test-run-all"
          variant="ghost"
          size="sm"
          className="h-7 shrink-0 gap-1 px-2 text-xs"
          disabled={isRunning || files.length === 0}
          onClick={onRunAll}
        >
          <Play className="h-3 w-3" />
          Run All
        </Button>
      </div>

      {/* File tree */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Loading tests...
          </div>
        ) : files.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            No test files found
          </div>
        ) : filteredFiles.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            No tests matching "{search}"
          </div>
        ) : (
          tree.map((node) => (
            <TreeItem
              key={node.path}
              node={node}
              depth={0}
              expandedFolders={effectiveExpanded}
              toggleFolder={toggleFolder}
              fileStatuses={fileStatuses}
              isRunning={isRunning}
              onRunFile={onRunFile}
            />
          ))
        )}
      </div>
    </div>
  );
}
