import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '@/stores/app-store';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  Trash2,
  Plus,
  Loader2,
  AlertCircle,
  Download,
  Sparkles,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  FolderOpen,
} from 'lucide-react';
import type { Skill } from '@a-parallel/shared';

interface RecommendedSkill {
  name: string;
  description: string;
  identifier: string;
}

function InstalledSkillCard({
  skill,
  onRemove,
  removing,
}: {
  skill: Skill;
  onRemove: () => void;
  removing: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-md border border-border/50 bg-card">
      <div className="flex items-center gap-3 min-w-0">
        <Sparkles className="h-4 w-4 text-amber-500 flex-shrink-0" />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium truncate">{skill.name}</span>
          </div>
          {skill.description && (
            <p className="text-xs text-muted-foreground truncate mt-0.5">
              {skill.description}
            </p>
          )}
          <div className="flex items-center gap-2 mt-1">
            <span className="text-[10px] text-muted-foreground/70">
              {skill.source}
            </span>
            {skill.sourceUrl && (
              <a
                href={skill.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[10px] text-muted-foreground/70 hover:text-foreground inline-flex items-center gap-0.5"
              >
                <ExternalLink className="h-2.5 w-2.5" />
              </a>
            )}
            {skill.installedAt && (
              <span className="text-[10px] text-muted-foreground/70">
                installed {new Date(skill.installedAt).toLocaleDateString()}
              </span>
            )}
          </div>
        </div>
      </div>
      {skill.scope !== 'project' && (
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onRemove}
          disabled={removing}
          className="text-muted-foreground hover:text-destructive flex-shrink-0"
        >
          {removing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Trash2 className="h-3.5 w-3.5" />
          )}
        </Button>
      )}
    </div>
  );
}

function RecommendedSkillCard({
  skill,
  installed,
  onInstall,
  installing,
}: {
  skill: RecommendedSkill;
  installed: boolean;
  onInstall: () => void;
  installing: boolean;
}) {
  const { t } = useTranslation();

  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-md border border-border/50 bg-card">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{skill.name}</span>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">{skill.description}</p>
        <p className="text-[10px] text-muted-foreground/70 mt-0.5 font-mono">
          {skill.identifier}
        </p>
      </div>
      <Button
        variant={installed ? 'ghost' : 'outline'}
        size="sm"
        onClick={onInstall}
        disabled={installed || installing}
        className="flex-shrink-0 text-xs h-7"
      >
        {installing ? (
          <Loader2 className="h-3 w-3 animate-spin mr-1" />
        ) : installed ? null : (
          <Download className="h-3 w-3 mr-1" />
        )}
        {installed ? t('skills.installed') : installing ? t('skills.installing') : t('skills.install')}
      </Button>
    </div>
  );
}

export function SkillsSettings() {
  const { t } = useTranslation();
  const projects = useAppStore(s => s.projects);
  const selectedProjectId = useAppStore(s => s.selectedProjectId);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [recommended, setRecommended] = useState<RecommendedSkill[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removingName, setRemovingName] = useState<string | null>(null);
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [showCustom, setShowCustom] = useState(false);
  const [customId, setCustomId] = useState('');
  const [addingCustom, setAddingCustom] = useState(false);

  // Derive project path synchronously to avoid race conditions
  const projectPath = selectedProjectId
    ? projects.find((p) => p.id === selectedProjectId)?.path ?? null
    : projects[0]?.path ?? null;

  const loadSkills = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.listSkills(projectPath || undefined);
      setSkills(res.skills);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [projectPath]);

  const loadRecommended = useCallback(async () => {
    try {
      const res = await api.getRecommendedSkills();
      setRecommended(res.skills as unknown as RecommendedSkill[]);
    } catch {
      // Silently fail
    }
  }, []);

  useEffect(() => {
    loadSkills();
  }, [loadSkills]);

  useEffect(() => {
    loadRecommended();
  }, [loadRecommended]);

  const handleRemove = async (name: string) => {
    setRemovingName(name);
    try {
      await api.removeSkill(name);
      await loadSkills();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setRemovingName(null);
    }
  };

  const handleInstallRecommended = async (skill: RecommendedSkill) => {
    setInstallingId(skill.identifier);
    try {
      await api.addSkill(skill.identifier);
      await loadSkills();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setInstallingId(null);
    }
  };

  const handleAddCustom = async () => {
    if (!customId.trim()) return;
    setAddingCustom(true);
    setError(null);
    try {
      await api.addSkill(customId.trim());
      await loadSkills();
      setCustomId('');
      setShowCustom(false);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setAddingCustom(false);
    }
  };

  const projectSkills = skills.filter((s) => s.scope === 'project');
  const globalSkills = skills.filter((s) => s.scope !== 'project');
  const installedNames = new Set(skills.map((s) => s.name));

  return (
    <div className="space-y-6">
      {/* Project indicator */}
      {projectPath && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Sparkles className="h-3.5 w-3.5" />
          <span>
            {t('skills.showingFor')}{' '}
            <span className="font-medium text-foreground">
              {projects.find((p) => p.path === projectPath)?.name || projectPath}
            </span>
          </span>
        </div>
      )}

      {/* Error banner */}
      {error && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-destructive/10 text-destructive text-xs">
          <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-auto text-xs underline">
            {t('skills.dismiss')}
          </button>
        </div>
      )}

      {/* Project skills */}
      {projectSkills.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            {t('skills.projectSkills')}
          </h3>
          <div className="space-y-1.5">
            {projectSkills.map((skill) => (
              <InstalledSkillCard
                key={`project-${skill.name}`}
                skill={skill}
                onRemove={() => {}}
                removing={false}
              />
            ))}
          </div>
        </div>
      )}

      {/* Global skills */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            {t('skills.globalSkills')}
          </h3>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowCustom(!showCustom)}
            className="text-xs h-6 px-2"
          >
            {showCustom ? (
              <ChevronUp className="h-3 w-3 mr-1" />
            ) : (
              <Plus className="h-3 w-3 mr-1" />
            )}
            {showCustom ? t('skills.cancel') : t('skills.addCustom')}
          </Button>
        </div>

        {/* Custom install form */}
        {showCustom && (
          <div className="rounded-lg border border-border/50 p-3 mb-3 space-y-2 bg-muted/30">
            <label className="text-xs text-muted-foreground block">
              {t('skills.skillIdentifier')} (e.g. <code className="text-[10px] bg-muted px-1 py-0.5 rounded">owner/repo@skill-name</code>)
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={customId}
                onChange={(e) => setCustomId(e.target.value)}
                placeholder="vercel-labs/agent-skills@nextjs-best-practices"
                className="flex-1 h-8 px-2 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-ring font-mono text-xs"
                onKeyDown={(e) => e.key === 'Enter' && handleAddCustom()}
              />
              <Button
                size="sm"
                onClick={handleAddCustom}
                disabled={!customId.trim() || addingCustom}
                className="text-xs h-8"
              >
                {addingCustom ? (
                  <Loader2 className="h-3 w-3 animate-spin mr-1" />
                ) : (
                  <Plus className="h-3 w-3 mr-1" />
                )}
                {t('skills.install')}
              </Button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="flex items-center gap-2 py-6 justify-center text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t('skills.loadingSkills')}
          </div>
        ) : globalSkills.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            {t('skills.noGlobalSkills')}
          </div>
        ) : (
          <div className="space-y-1.5">
            {globalSkills.map((skill) => (
              <InstalledSkillCard
                key={skill.name}
                skill={skill}
                onRemove={() => handleRemove(skill.name)}
                removing={removingName === skill.name}
              />
            ))}
          </div>
        )}
      </div>

      {/* Recommended skills */}
      {recommended.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            {t('skills.recommendedSkills')}
          </h3>
          <div className="space-y-1.5">
            {recommended.map((skill) => (
              <RecommendedSkillCard
                key={skill.identifier}
                skill={skill}
                installed={installedNames.has(skill.name)}
                onInstall={() => handleInstallRecommended(skill)}
                installing={installingId === skill.identifier}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
