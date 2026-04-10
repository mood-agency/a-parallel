import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { Button } from '@/components/ui/button';

import { GitProgressModal, type GitProgressStep } from './GitProgressModal';

/* ------------------------------------------------------------------ */
/*  Mock data                                                         */
/* ------------------------------------------------------------------ */

const now = Date.now();

const STEPS_RUNNING: GitProgressStep[] = [
  {
    id: 'commit',
    label: 'Committing changes',
    status: 'completed',
    startedAt: now - 3200,
    completedAt: now - 1800,
  },
  { id: 'push', label: 'Pushing to remote', status: 'running', startedAt: now - 1800 },
  { id: 'pr', label: 'Creating pull request', status: 'pending' },
];

const STEPS_COMPLETED: GitProgressStep[] = [
  {
    id: 'commit',
    label: 'Committing changes',
    status: 'completed',
    startedAt: now - 5000,
    completedAt: now - 3500,
  },
  {
    id: 'push',
    label: 'Pushing to remote',
    status: 'completed',
    startedAt: now - 3500,
    completedAt: now - 1200,
  },
  {
    id: 'pr',
    label: 'Creating pull request',
    status: 'completed',
    startedAt: now - 1200,
    completedAt: now - 200,
    url: 'https://github.com/acme/app/pull/42',
  },
];

const STEPS_FAILED: GitProgressStep[] = [
  {
    id: 'commit',
    label: 'Committing changes',
    status: 'completed',
    startedAt: now - 4000,
    completedAt: now - 2500,
  },
  {
    id: 'push',
    label: 'Pushing to remote',
    status: 'failed',
    error:
      "fatal: unable to access 'https://github.com/acme/app.git/': Could not resolve host: github.com",
    startedAt: now - 2500,
    completedAt: now - 1000,
  },
  { id: 'pr', label: 'Creating pull request', status: 'pending' },
];

const STEPS_WITH_SUBITEMS: GitProgressStep[] = [
  {
    id: 'hooks',
    label: 'Running pre-commit hooks',
    status: 'running',
    startedAt: now - 2000,
    subItems: [
      { label: 'eslint', status: 'completed' },
      { label: 'prettier --check', status: 'running' },
      { label: 'tsc --noEmit', status: 'pending' },
    ],
  },
  { id: 'commit', label: 'Committing changes', status: 'pending' },
  { id: 'push', label: 'Pushing to remote', status: 'pending' },
];

const STEPS_HOOK_FAILED: GitProgressStep[] = [
  {
    id: 'hooks',
    label: 'Running pre-commit hooks',
    status: 'failed',
    startedAt: now - 5000,
    completedAt: now - 1000,
    subItems: [
      { label: 'eslint', status: 'completed' },
      { label: 'prettier --check', status: 'failed', error: 'Formatting issues found in 3 files' },
      { label: 'tsc --noEmit', status: 'pending' },
    ],
  },
  { id: 'commit', label: 'Committing changes', status: 'pending' },
];

const STEPS_SINGLE: GitProgressStep[] = [
  { id: 'push', label: 'Pushing to remote', status: 'running', startedAt: now - 800 },
];

/* ------------------------------------------------------------------ */
/*  Trigger wrapper                                                   */
/* ------------------------------------------------------------------ */

function GitProgressTrigger({
  steps,
  title,
  autoClose,
  label,
}: {
  steps: GitProgressStep[];
  title: string;
  autoClose?: boolean;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" data-testid="git-progress-trigger" onClick={() => setOpen(true)}>
        {label}
      </Button>
      <GitProgressModal
        open={open}
        onOpenChange={setOpen}
        steps={steps}
        title={title}
        autoClose={autoClose}
      />
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Storybook meta                                                    */
/* ------------------------------------------------------------------ */

const meta: Meta = {
  title: 'Components/GitProgressModal',
  component: GitProgressModal,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj;

/* ------------------------------------------------------------------ */
/*  Stories                                                            */
/* ------------------------------------------------------------------ */

/** Default state: one step completed, one running, one pending. */
export const Running: Story = {
  render: () => (
    <GitProgressTrigger
      steps={STEPS_RUNNING}
      title="Commit, push & create PR"
      label="Open (running)"
    />
  ),
};

/** All steps completed with a PR link. */
export const Completed: Story = {
  render: () => (
    <GitProgressTrigger
      steps={STEPS_COMPLETED}
      title="Commit, push & create PR"
      label="Open (completed)"
    />
  ),
};

/** Push step failed with error message. */
export const Failed: Story = {
  render: () => (
    <GitProgressTrigger
      steps={STEPS_FAILED}
      title="Commit, push & create PR"
      label="Open (failed)"
    />
  ),
};

/** Hook step running with individual sub-items. */
export const WithSubItems: Story = {
  render: () => (
    <GitProgressTrigger
      steps={STEPS_WITH_SUBITEMS}
      title="Committing changes"
      label="Open (sub-items)"
    />
  ),
};

/** Hook sub-item failed. */
export const SubItemFailed: Story = {
  render: () => (
    <GitProgressTrigger
      steps={STEPS_HOOK_FAILED}
      title="Committing changes"
      label="Open (hook failed)"
    />
  ),
};

/** Single step running (e.g., push-only workflow). */
export const SingleStep: Story = {
  render: () => (
    <GitProgressTrigger steps={STEPS_SINGLE} title="Pushing to remote" label="Open (single step)" />
  ),
};

/** Auto-close enabled — no Done button on success. */
export const AutoClose: Story = {
  render: () => (
    <GitProgressTrigger
      steps={STEPS_COMPLETED}
      title="Commit, push & create PR"
      label="Open (auto-close)"
      autoClose
    />
  ),
};
