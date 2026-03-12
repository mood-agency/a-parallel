import { Square } from 'lucide-react';
import { useCallback, useEffect } from 'react';

import { BrowserPreview } from '@/components/test-runner/BrowserPreview';
import { TestFileBrowser } from '@/components/test-runner/TestFileBrowser';
import { Button } from '@/components/ui/button';
import { useProjectStore } from '@/stores/project-store';
import { useTestStore } from '@/stores/test-store';

export function TestRunnerPane() {
  const selectedProjectId = useProjectStore((s) => s.selectedProjectId);
  const {
    files,
    isRunning,
    isLoading,
    fileStatuses,
    outputLines,
    isStreaming,
    activeProjectId,
    loadFiles,
    startRun,
    stopRun,
  } = useTestStore();

  // Load test files when the selected project changes
  useEffect(() => {
    if (selectedProjectId && selectedProjectId !== activeProjectId) {
      loadFiles(selectedProjectId);
    }
  }, [selectedProjectId, activeProjectId, loadFiles]);

  const handleRunFile = useCallback(
    (file: string) => {
      if (!selectedProjectId) return;
      startRun(selectedProjectId, file);
    },
    [selectedProjectId, startRun],
  );

  const handleRunAll = useCallback(() => {
    if (!selectedProjectId || files.length === 0) return;
    // Run the first file — sequential execution would need a queue
    startRun(selectedProjectId, files[0].path);
  }, [selectedProjectId, files, startRun]);

  const handleStop = useCallback(() => {
    if (!selectedProjectId) return;
    stopRun(selectedProjectId);
  }, [selectedProjectId, stopRun]);

  if (!selectedProjectId) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Select a project to run tests
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="text-sm font-medium">Test Runner</span>
        {isRunning && (
          <Button
            data-testid="test-stop"
            variant="destructive"
            size="sm"
            className="h-7 gap-1 px-2 text-xs"
            onClick={handleStop}
          >
            <Square className="h-3 w-3" />
            Stop
          </Button>
        )}
      </div>

      {/* Two-section layout: file browser (top) and preview (bottom) */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* File browser — takes about 40% */}
        <div className="h-[40%] min-h-[150px] overflow-hidden border-b">
          <TestFileBrowser
            files={files}
            fileStatuses={fileStatuses}
            isRunning={isRunning}
            isLoading={isLoading}
            onRunFile={handleRunFile}
            onRunAll={handleRunAll}
          />
        </div>

        {/* Browser preview + output log — takes remaining space */}
        <BrowserPreview isRunning={isRunning} isStreaming={isStreaming} outputLines={outputLines} />
      </div>
    </div>
  );
}
