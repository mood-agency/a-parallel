import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '@/stores/app-store';
import { cn } from '@/lib/utils';
import { GitCompare, Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import { PromptInput } from './PromptInput';
import { ToolCallCard } from './ToolCallCard';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

function NewThreadInput() {
  const navigate = useNavigate();
  const { newThreadProjectId, cancelNewThread, loadThreadsForProject } =
    useAppStore();

  const [creating, setCreating] = useState(false);

  const handleCreate = async (prompt: string, opts: { model: string; mode: string }, images?: any[]) => {
    if (!newThreadProjectId || creating) return;
    setCreating(true);

    try {
      const thread = await api.createThread({
        projectId: newThreadProjectId,
        title: prompt.slice(0, 60),
        mode: 'local',
        model: opts.model,
        permissionMode: opts.mode,
        prompt,
        images,
      });

      await loadThreadsForProject(newThreadProjectId);
      navigate(`/projects/${newThreadProjectId}/threads/${thread.id}`);
    } catch (e: any) {
      alert(e.message);
      setCreating(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full">
      {/* Empty state area */}
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        <div className="text-center">
          <p className="text-sm">What should the agent do?</p>
          <p className="text-xs mt-1">Describe the task and press Enter to start</p>
        </div>
      </div>

      <PromptInput
        onSubmit={handleCreate}
        loading={creating}
      />
    </div>
  );
}

export function ThreadView() {
  const { activeThread, selectedThreadId, newThreadProjectId, setReviewPaneOpen, reviewPaneOpen } =
    useAppStore();
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeThread?.messages?.length]);


  // Show new thread input when a project's "+" was clicked
  if (newThreadProjectId && !selectedThreadId) {
    return <NewThreadInput />;
  }

  if (!selectedThreadId || !activeThread) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        <div className="text-center">
          <p className="text-sm">Select a thread or create a new one</p>
          <p className="text-xs mt-1">Threads run Claude Code agents in parallel</p>
        </div>
      </div>
    );
  }

  const handleSend = async (prompt: string, opts: { model: string; mode: string }, images?: any[]) => {
    if (sending) return;
    setSending(true);

    useAppStore.getState().appendOptimisticMessage(activeThread.id, prompt);

    try {
      await api.sendMessage(activeThread.id, prompt, { model: opts.model, permissionMode: opts.mode }, images);
    } catch (e: any) {
      console.error('Send failed:', e);
    } finally {
      setSending(false);
    }
  };

  const handleStop = async () => {
    try {
      await api.stopThread(activeThread.id);
    } catch (e: any) {
      console.error('Stop failed:', e);
    }
  };

  const isRunning = activeThread.status === 'running';

  return (
    <div className="flex-1 flex flex-col h-full">
      {/* Thread header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-medium truncate">{activeThread.title}</h2>
          {activeThread.branch && (
            <span className="text-xs text-muted-foreground bg-secondary px-1.5 py-0.5 rounded">
              {activeThread.branch}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {activeThread.cost > 0 && (
            <span className="text-xs text-muted-foreground">
              ${activeThread.cost.toFixed(4)}
            </span>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setReviewPaneOpen(!reviewPaneOpen)}
                className={reviewPaneOpen ? 'text-primary' : 'text-muted-foreground'}
              >
                <GitCompare className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Toggle review pane</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1 p-4">
        <div className="mx-auto w-1/2 min-w-[320px] space-y-3">
          {activeThread.initInfo && (
            <div className="rounded-lg border border-border bg-muted/50 px-3 py-2 text-xs text-muted-foreground space-y-1">
              <div className="flex items-center gap-2">
                <span className="font-medium">Model:</span>
                <span className="font-mono">{activeThread.initInfo.model}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-medium">CWD:</span>
                <span className="font-mono truncate">{activeThread.initInfo.cwd}</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="font-medium shrink-0">Tools:</span>
                <span className="font-mono flex flex-wrap gap-1">
                  {activeThread.initInfo.tools.map((tool) => (
                    <span key={tool} className="bg-secondary px-1.5 py-0.5 rounded text-[10px]">
                      {tool}
                    </span>
                  ))}
                </span>
              </div>
            </div>
          )}

          {activeThread.messages?.map((msg) => (
            <div key={msg.id} className="space-y-1.5">
              {msg.content && (
                <div
                  className={cn(
                    'rounded-lg px-3 py-2 text-sm w-fit max-w-full',
                    msg.role === 'user'
                      ? 'ml-auto bg-primary text-primary-foreground'
                      : 'bg-secondary text-secondary-foreground'
                  )}
                >
                  {msg.role !== 'user' && (
                    <span className="text-[10px] font-medium uppercase text-muted-foreground block mb-0.5">
                      {msg.role}
                    </span>
                  )}
                  {msg.images && msg.images.length > 0 && (
                    <div className="flex flex-wrap gap-2 mb-2">
                      {msg.images.map((img: any, idx: number) => (
                        <img
                          key={idx}
                          src={`data:${img.source.media_type};base64,${img.source.data}`}
                          alt={`Attachment ${idx + 1}`}
                          className="max-h-40 rounded border border-border"
                        />
                      ))}
                    </div>
                  )}
                  <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed break-words overflow-x-auto max-h-96">
                    {msg.content}
                  </pre>
                </div>
              )}
              {msg.toolCalls?.map((tc: any) => (
                <ToolCallCard
                  key={tc.id}
                  name={tc.name}
                  input={tc.input}
                />
              ))}
            </div>
          ))}

          {isRunning && (
            <div className="flex items-center gap-2 text-muted-foreground text-xs">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Agent is working...
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </ScrollArea>

      {/* Input */}
      <PromptInput
        onSubmit={handleSend}
        onStop={handleStop}
        loading={sending}
        running={isRunning}
        placeholder="What do you want to do next?"
      />
    </div>
  );
}
