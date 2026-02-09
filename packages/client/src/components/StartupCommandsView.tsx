import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '@/stores/app-store';
import { useTerminalStore } from '@/stores/terminal-store';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { ChevronLeft, Play, Plus, Pencil, Trash2, X, Check, Square, Loader2, Globe, RefreshCw, XCircle } from 'lucide-react';
import { usePreviewStore } from '@/stores/preview-store';
import { usePreviewWindow } from '@/hooks/use-preview-window';
import type { StartupCommand } from '@a-parallel/shared';

const inputClass =
  'rounded-md border border-input bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring';

export function StartupCommandsView() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const projectId = useAppStore(s => s.startupCommandsProjectId);
  const projects = useAppStore(s => s.projects);
  const [commands, setCommands] = useState<StartupCommand[]>([]);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [command, setCommand] = useState('');
  const [port, setPort] = useState('');
  const [portEnvVar, setPortEnvVar] = useState('');

  const project = projects.find((p) => p.id === projectId);

  const loadCommands = useCallback(async () => {
    if (!projectId) return;
    try {
      const cmds = await api.listCommands(projectId);
      setCommands(cmds);
    } catch {
      // ignore
    }
  }, [projectId]);

  useEffect(() => {
    loadCommands();
  }, [loadCommands]);

  // Sync running state from terminal store
  const tabs = useTerminalStore((s) => s.tabs);
  const runningIds = new Set<string>();
  for (const tab of tabs) {
    if (tab.commandId && tab.alive) runningIds.add(tab.commandId);
  }

  const { openPreview, closePreview, refreshPreview, isTauri } = usePreviewWindow();
  const previewTabs = usePreviewStore((s) => s.tabs);

  const handleAdd = async () => {
    if (!projectId || !label.trim() || !command.trim()) return;
    const portNum = port ? parseInt(port, 10) : null;
    await api.addCommand(projectId, label.trim(), command.trim(), portNum, portEnvVar.trim() || null);
    resetForm();
    setAdding(false);
    loadCommands();
  };

  const handleUpdate = async (cmdId: string) => {
    if (!projectId || !label.trim() || !command.trim()) return;
    const portNum = port ? parseInt(port, 10) : null;
    await api.updateCommand(projectId, cmdId, label.trim(), command.trim(), portNum, portEnvVar.trim() || null);
    setEditingId(null);
    resetForm();
    loadCommands();
  };

  const handleDelete = async (cmdId: string) => {
    if (!projectId) return;
    await api.deleteCommand(projectId, cmdId);
    loadCommands();
  };

  const handleRun = async (cmd: StartupCommand) => {
    if (!projectId) return;
    const store = useTerminalStore.getState();
    store.addTab({
      id: crypto.randomUUID(),
      label: cmd.label,
      cwd: '',
      alive: true,
      commandId: cmd.id,
      projectId,
      port: cmd.port ?? undefined,
    });
    try {
      await api.runCommand(projectId, cmd.id);
    } catch {
      // ignore
    }
  };

  const handleStop = async (cmd: StartupCommand) => {
    if (!projectId) return;
    try {
      await api.stopCommand(projectId, cmd.id);
    } catch {
      // ignore
    }
  };

  const startEditing = (cmd: StartupCommand) => {
    setEditingId(cmd.id);
    setLabel(cmd.label);
    setCommand(cmd.command);
    setPort(cmd.port ? String(cmd.port) : '');
    setPortEnvVar(cmd.portEnvVar || '');
    setAdding(false);
  };

  const resetForm = () => {
    setLabel('');
    setCommand('');
    setPort('');
    setPortEnvVar('');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setAdding(false);
    resetForm();
  };

  if (!projectId) return null;

  return (
    <div className="flex-1 flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-border">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => navigate(`/projects/${projectId}`)}
            className="text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <h2 className="text-sm font-medium flex items-center gap-2">
            {project && (
              <>
                <span className="text-muted-foreground">{project.name}</span>
                <span className="text-muted-foreground/50">/</span>
              </>
            )}
            {t('startup.title')}
          </h2>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs gap-1.5"
          onClick={() => {
            cancelEdit();
            setAdding(true);
          }}
        >
          <Plus className="h-3.5 w-3.5" />
          {t('startup.addCommand')}
        </Button>
      </div>

      {/* Content */}
      <ScrollArea className="flex-1">
        <div className="px-6 py-4 max-w-4xl mx-auto">
          {/* Table header */}
          {commands.length > 0 && (
            <div className="grid grid-cols-[1fr_2fr_240px_80px_auto] gap-3 px-3 pb-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">
              <span>{t('startup.label')}</span>
              <span>{t('startup.command')}</span>
              <span>{t('startup.envVar')}</span>
              <span>{t('startup.port')}</span>
              <span />
            </div>
          )}

          {/* Command rows */}
          {commands.length === 0 && !adding && (
            <div className="text-center py-12">
              <p className="text-sm text-muted-foreground mb-3">{t('startup.noCommands')}</p>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => setAdding(true)}
              >
                <Plus className="h-3.5 w-3.5" />
                {t('startup.addFirst')}
              </Button>
            </div>
          )}

          {commands.map((cmd) => {
            const isRunning = runningIds.has(cmd.id);

            if (editingId === cmd.id) {
              return (
                <div key={cmd.id} className="rounded-lg border border-border bg-muted/30 p-3 mb-2">
                  <div className="grid grid-cols-[1fr_2fr_240px_80px_auto] gap-3 items-center">
                    <input
                      className={inputClass}
                      placeholder={t('startup.label')}
                      value={label}
                      onChange={(e) => setLabel(e.target.value)}
                      autoFocus
                    />
                    <input
                      className={`${inputClass} font-mono`}
                      placeholder={t('startup.command')}
                      value={command}
                      onChange={(e) => setCommand(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleUpdate(cmd.id);
                        if (e.key === 'Escape') cancelEdit();
                      }}
                    />
                    <input
                      className={`${inputClass} font-mono`}
                      placeholder={t('startup.envVar')}
                      value={portEnvVar}
                      onChange={(e) => setPortEnvVar(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleUpdate(cmd.id);
                        if (e.key === 'Escape') cancelEdit();
                      }}
                    />
                    <input
                      inputMode="numeric"
                      pattern="[0-9]*"
                      className={`${inputClass} font-mono`}
                      placeholder={t('startup.port')}
                      value={port}
                      onChange={(e) => setPort(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleUpdate(cmd.id);
                        if (e.key === 'Escape') cancelEdit();
                      }}
                    />
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={cancelEdit}>
                        <X className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="sm" className="h-7 text-xs" onClick={() => handleUpdate(cmd.id)}>
                        <Check className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </div>
              );
            }

            return (
              <div
                key={cmd.id}
                className="group grid grid-cols-[1fr_2fr_240px_80px_auto] gap-3 items-center px-3 py-2.5 rounded-lg hover:bg-accent/50 transition-colors"
              >
                {/* Label */}
                <div className="flex items-center gap-2 min-w-0">
                  {isRunning && (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-green-400 flex-shrink-0" />
                  )}
                  <span className="text-sm font-medium truncate">{cmd.label}</span>
                </div>

                {/* Command */}
                <span className="text-sm text-muted-foreground font-mono truncate">{cmd.command}</span>

                {/* Env Var */}
                <span className="text-sm font-mono">
                  {cmd.portEnvVar ? (
                    <span className="text-purple-400">{cmd.portEnvVar}</span>
                  ) : (
                    <span className="text-muted-foreground/40">&mdash;</span>
                  )}
                </span>

                {/* Port */}
                <span className="text-sm font-mono">
                  {cmd.port ? (
                    <span className="text-blue-400">{cmd.port}</span>
                  ) : (
                    <span className="text-muted-foreground/40">&mdash;</span>
                  )}
                </span>

                {/* Actions */}
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  {isRunning ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => handleStop(cmd)}
                          className="text-red-400 hover:text-red-300"
                        >
                          <Square className="h-3.5 w-3.5" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{t('startup.stop')}</TooltipContent>
                    </Tooltip>
                  ) : (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => handleRun(cmd)}
                          className="text-green-400 hover:text-green-300"
                        >
                          <Play className="h-3.5 w-3.5" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{t('startup.run')}</TooltipContent>
                    </Tooltip>
                  )}
                  {isTauri && isRunning && cmd.port && (
                    <>
                      {previewTabs.some((t) => t.commandId === cmd.id) ? (
                        <>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                onClick={() => refreshPreview(cmd.id)}
                                className="text-blue-400 hover:text-blue-300"
                              >
                                <RefreshCw className="h-3.5 w-3.5" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>{t('preview.refresh')}</TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                onClick={() => closePreview(cmd.id)}
                                className="text-muted-foreground hover:text-red-400"
                              >
                                <XCircle className="h-3.5 w-3.5" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>{t('preview.close')}</TooltipContent>
                          </Tooltip>
                        </>
                      ) : (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => openPreview({
                                commandId: cmd.id,
                                projectId: projectId!,
                                port: cmd.port!,
                                commandLabel: cmd.label,
                              })}
                              className="text-blue-400 hover:text-blue-300"
                            >
                              <Globe className="h-3.5 w-3.5" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>{t('preview.open')}</TooltipContent>
                        </Tooltip>
                      )}
                    </>
                  )}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => startEditing(cmd)}
                        className="text-muted-foreground"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{t('startup.edit')}</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => handleDelete(cmd.id)}
                        className="text-muted-foreground hover:text-red-400"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{t('startup.delete')}</TooltipContent>
                  </Tooltip>
                </div>
              </div>
            );
          })}

          {/* Add form */}
          {adding && (
            <div className="rounded-lg border border-border bg-muted/30 p-3 mt-2">
              <div className="grid grid-cols-[1fr_2fr_240px_80px_auto] gap-3 items-center">
                <input
                  className={inputClass}
                  placeholder={t('startup.label')}
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  autoFocus
                />
                <input
                  className={`${inputClass} font-mono`}
                  placeholder={t('startup.commandPlaceholder')}
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleAdd();
                    if (e.key === 'Escape') cancelEdit();
                  }}
                />
                <input
                  className={`${inputClass} font-mono`}
                  placeholder={t('startup.envVar')}
                  value={portEnvVar}
                  onChange={(e) => setPortEnvVar(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleAdd();
                    if (e.key === 'Escape') cancelEdit();
                  }}
                />
                <input
                  inputMode="numeric"
                  pattern="[0-9]*"
                  className={`${inputClass} font-mono`}
                  placeholder={t('startup.port')}
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleAdd();
                    if (e.key === 'Escape') cancelEdit();
                  }}
                />
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={cancelEdit}>
                    <X className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="sm" className="h-7 text-xs" onClick={handleAdd}>
                    <Check className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
