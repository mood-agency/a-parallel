import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';

import { PromptInputUI } from '@/components/PromptInputUI';

const defaultModes = [
  { value: 'ask', label: 'Ask' },
  { value: 'plan', label: 'Plan' },
  { value: 'autoEdit', label: 'Auto-edit' },
  { value: 'confirmEdit', label: 'Ask before edits' },
];

const defaultModelGroups = [
  {
    provider: 'anthropic',
    providerLabel: 'Anthropic',
    models: [
      { value: 'anthropic:claude-sonnet-4-20250514', label: 'Sonnet 4' },
      { value: 'anthropic:claude-opus-4-20250514', label: 'Opus 4' },
      { value: 'anthropic:claude-haiku-3-5-20241022', label: 'Haiku 3.5' },
    ],
  },
  {
    provider: 'openai',
    providerLabel: 'OpenAI',
    models: [
      { value: 'openai:gpt-4o', label: 'GPT-4o' },
      { value: 'openai:o3', label: 'o3' },
    ],
  },
];

/* ------------------------------------------------------------------ */
/*  Meta                                                               */
/* ------------------------------------------------------------------ */

const meta: Meta<typeof PromptInputUI> = {
  title: 'Components/PromptInput',
  component: PromptInputUI,
  parameters: { layout: 'padded' },
  tags: ['autodocs'],
  args: {
    onSubmit: fn(),
    onStop: fn(),
    loading: false,
    running: false,
    unifiedModel: 'anthropic:claude-sonnet-4-20250514',
    onUnifiedModelChange: fn(),
    modelGroups: defaultModelGroups,
    mode: 'autoEdit',
    onModeChange: fn(),
    modes: defaultModes,
  },
  decorators: [
    (Story) => (
      <div className="mx-auto max-w-3xl">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof meta>;

/* ------------------------------------------------------------------ */
/*  Stories                                                            */
/* ------------------------------------------------------------------ */

/** Default idle state for a new thread. */
export const Default: Story = {
  args: {
    isNewThread: true,
    placeholder: 'Describe a task...',
  },
};

/** Follow-up prompt on an existing thread. */
export const FollowUp: Story = {
  args: {
    isNewThread: false,
    effectiveCwd: '/home/user/projects/my-app',
    activeThreadBranch: 'feature/dark-mode',
    followUpBranches: ['main', 'develop', 'feature/dark-mode'],
    followUpSelectedBranch: 'main',
    onFollowUpSelectedBranchChange: fn(),
  },
};

/** Agent is running — shows the stop button when editor is empty. */
export const Running: Story = {
  args: {
    running: true,
    isQueueMode: true,
    placeholder: 'Type to queue a follow-up...',
  },
};

/** Submit button in loading state. */
export const Loading: Story = {
  args: {
    loading: true,
  },
};

/** New thread with branches and worktree toggle visible. */
export const NewThreadWithBranches: Story = {
  args: {
    isNewThread: true,
    branches: ['main', 'develop', 'feature/auth', 'fix/login-bug'],
    selectedBranch: 'main',
    onSelectedBranchChange: fn(),
    createWorktree: false,
    onCreateWorktreeChange: fn(),
    remoteUrl: 'https://github.com/acme/my-app.git',
  },
};

/** New thread with worktree enabled. */
export const WorktreeMode: Story = {
  args: {
    isNewThread: true,
    branches: ['main', 'develop'],
    selectedBranch: 'main',
    onSelectedBranchChange: fn(),
    createWorktree: true,
    onCreateWorktreeChange: fn(),
    remoteUrl: 'git@github.com:acme/my-app.git',
  },
};

/** With queued messages. */
export const WithQueue: Story = {
  args: {
    running: true,
    isQueueMode: true,
    queuedMessages: [
      {
        id: 'q1',
        threadId: 't1',
        content: 'Add error handling to the API endpoints',
        sortOrder: 0,
        createdAt: '2026-03-13T10:00:00Z',
      },
      {
        id: 'q2',
        threadId: 't1',
        content: 'Write tests for the new auth middleware',
        sortOrder: 1,
        createdAt: '2026-03-13T10:01:00Z',
      },
      {
        id: 'q3',
        threadId: 't1',
        content: 'Update the README with setup instructions',
        sortOrder: 2,
        createdAt: '2026-03-13T10:02:00Z',
      },
    ],
    onQueueEditSave: fn(),
    onQueueDelete: fn(),
  },
};

/** With dictation button visible. */
export const WithDictation: Story = {
  args: {
    hasDictation: true,
    isRecording: false,
    isTranscribing: false,
    onToggleRecording: fn(),
    onStopRecording: fn(),
  },
};

/** Dictation actively recording. */
export const DictationRecording: Story = {
  args: {
    hasDictation: true,
    isRecording: true,
    isTranscribing: false,
    onToggleRecording: fn(),
    onStopRecording: fn(),
  },
};

/** With backlog toggle visible. */
export const WithBacklog: Story = {
  args: {
    isNewThread: true,
    showBacklog: true,
    sendToBacklog: false,
    onSendToBacklogChange: fn(),
    branches: ['main'],
    selectedBranch: 'main',
    onSelectedBranchChange: fn(),
  },
};

/** With remote launcher (shows local/remote runtime selector). */
export const WithLauncher: Story = {
  args: {
    isNewThread: true,
    hasLauncher: true,
    runtime: 'local',
    onRuntimeChange: fn(),
    branches: ['main'],
    selectedBranch: 'main',
    onSelectedBranchChange: fn(),
  },
};
