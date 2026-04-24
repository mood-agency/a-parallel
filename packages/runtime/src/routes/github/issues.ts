import { getRemoteUrl, listBranches } from '@funny/core/git';
import type { GitHubIssue, GitHubPR, EnrichedGitHubIssue } from '@funny/shared';
import { Hono } from 'hono';

import { getServices } from '../../services/service-registry.js';
import type { HonoEnv } from '../../types/hono-env.js';
import { GITHUB_API, githubApiFetch, parseGithubOwnerRepo, resolveGithubToken } from './helpers.js';

export const issueRoutes = new Hono<HonoEnv>();

// ── GET /issues — list GitHub issues for a project ──────

issueRoutes.get('/issues', async (c) => {
  const userId = c.get('userId') as string;
  const projectId = c.req.query('projectId');
  if (!projectId) {
    return c.json({ error: 'projectId is required' }, 400);
  }

  const project = await getServices().projects.getProject(projectId);
  if (!project) {
    return c.json({ error: 'Project not found' }, 404);
  }

  // Get remote URL from the project's git repo
  const remoteResult = await getRemoteUrl(project.path);
  if (remoteResult.isErr() || !remoteResult.value) {
    return c.json({ error: 'Could not determine remote URL for this project' }, 400);
  }

  const parsed = parseGithubOwnerRepo(remoteResult.value);
  if (!parsed) {
    return c.json({ error: 'This project is not hosted on GitHub' }, 400);
  }

  const state = c.req.query('state') || 'open';
  const page = Number(c.req.query('page')) || 1;
  const perPage = Math.min(Number(c.req.query('per_page')) || 30, 100);

  try {
    const apiPath = `/repos/${parsed.owner}/${parsed.repo}/issues?state=${state}&page=${page}&per_page=${perPage}&sort=created&direction=desc`;
    const resolved = await resolveGithubToken(userId);
    const token = resolved?.token ?? null;

    let res: Response;
    if (token) {
      res = await githubApiFetch(apiPath, token);
    } else {
      // Public access (works for public repos, rate-limited to ~60 req/hr)
      res = await fetch(`${GITHUB_API}${apiPath}`, {
        headers: {
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      });
    }

    if (!res.ok) {
      const _body = await res.text();
      return c.json({ error: `GitHub API error: ${res.status}` }, 502);
    }

    const rawIssues = (await res.json()) as GitHubIssue[];
    // Filter out pull requests (GitHub API returns PRs as issues too)
    const issues = rawIssues.filter((i) => !i.pull_request);

    const linkHeader = res.headers.get('Link') || '';
    const hasMore = linkHeader.includes('rel="next"');

    return c.json({ issues, hasMore, owner: parsed.owner, repo: parsed.repo });
  } catch (error: any) {
    return c.json({ error: error.message }, 502);
  }
});

// ── GET /issues-enriched — issues with linked branch/PR detection ──────

/** Generate a branch name suggestion from an issue number and title. */
function suggestBranchName(number: number, title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
    .replace(/-$/, '');
  return `issue-${number}-${slug}`;
}

issueRoutes.get('/issues-enriched', async (c) => {
  const userId = c.get('userId') as string;
  const projectId = c.req.query('projectId');
  if (!projectId) {
    return c.json({ error: 'projectId is required' }, 400);
  }

  const project = await getServices().projects.getProject(projectId);
  if (!project) {
    return c.json({ error: 'Project not found' }, 404);
  }

  const remoteResult = await getRemoteUrl(project.path);
  if (remoteResult.isErr() || !remoteResult.value) {
    return c.json({ error: 'Could not determine remote URL for this project' }, 400);
  }

  const parsed = parseGithubOwnerRepo(remoteResult.value);
  if (!parsed) {
    return c.json({ error: 'This project is not hosted on GitHub' }, 400);
  }

  const state = c.req.query('state') || 'open';
  const page = Number(c.req.query('page')) || 1;
  const perPage = Math.min(Number(c.req.query('per_page')) || 30, 100);

  try {
    const resolved = await resolveGithubToken(userId);
    const token = resolved?.token ?? null;

    // Fetch issues, local branches, and open PRs in parallel
    const [issuesData, branchesResult, prsData] = await Promise.all([
      // Issues
      (async () => {
        const apiPath = `/repos/${parsed.owner}/${parsed.repo}/issues?state=${state}&page=${page}&per_page=${perPage}&sort=created&direction=desc`;
        const res = token
          ? await githubApiFetch(apiPath, token)
          : await fetch(`${GITHUB_API}${apiPath}`, {
              headers: {
                Accept: 'application/vnd.github+json',
                'X-GitHub-Api-Version': '2022-11-28',
              },
            });
        if (!res.ok) return null;
        const raw = (await res.json()) as GitHubIssue[];
        return {
          issues: raw.filter((i) => !i.pull_request),
          hasMore: (res.headers.get('Link') || '').includes('rel="next"'),
        };
      })(),
      // Local branches
      listBranches(project.path),
      // Open PRs (for linking)
      (async () => {
        if (!token) return [] as GitHubPR[];
        const res = await githubApiFetch(
          `/repos/${parsed.owner}/${parsed.repo}/pulls?state=open&per_page=100`,
          token,
        );
        return res.ok ? ((await res.json()) as GitHubPR[]) : ([] as GitHubPR[]);
      })(),
    ]);

    if (!issuesData) {
      return c.json({ error: 'Failed to fetch issues' }, 502);
    }

    const branches = branchesResult.isOk() ? branchesResult.value : [];
    const prs = Array.isArray(prsData) ? prsData : [];

    // Build lookup: issue number → branch name (match issue number in branch names)
    const branchByIssue = new Map<number, string>();
    for (const branch of branches) {
      // Match patterns like "issue-42-fix-bug", "42-fix-bug", "fix/42-description"
      const match = branch.match(/(?:^|[/-])(\d+)(?:[/-]|$)/);
      if (match) {
        const issueNum = parseInt(match[1], 10);
        // Only match if the issue number is plausible (exists in current page)
        if (!branchByIssue.has(issueNum)) branchByIssue.set(issueNum, branch);
      }
    }

    // Build lookup: branch → PR
    const prByBranch = new Map<string, { number: number; url: string; state: string }>();
    for (const pr of prs) {
      prByBranch.set(pr.head.ref, {
        number: pr.number,
        url: pr.html_url,
        state: pr.state,
      });
    }

    // Enrich issues
    const enrichedIssues: EnrichedGitHubIssue[] = issuesData.issues.map((issue) => {
      const linkedBranch = branchByIssue.get(issue.number) ?? null;
      const linkedPR = linkedBranch ? (prByBranch.get(linkedBranch) ?? null) : null;
      return {
        ...issue,
        linkedBranch,
        linkedPR,
        suggestedBranchName: suggestBranchName(issue.number, issue.title),
      };
    });

    return c.json({
      issues: enrichedIssues,
      hasMore: issuesData.hasMore,
      owner: parsed.owner,
      repo: parsed.repo,
    });
  } catch (error: any) {
    return c.json({ error: error.message }, 502);
  }
});
