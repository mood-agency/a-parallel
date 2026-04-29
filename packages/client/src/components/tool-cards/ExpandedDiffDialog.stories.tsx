import type { FileDiffSummary } from '@funny/shared';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { fn } from 'storybook/test';

import { Button } from '@/components/ui/button';

import { ExpandedDiffDialog } from './ExpandedDiffDialog';

/* ------------------------------------------------------------------ */
/*  Mock data                                                         */
/* ------------------------------------------------------------------ */

const OLD_VALUE = `import { useState } from 'react';

export function Counter() {
  const [count, setCount] = useState(0);
  return (
    <button onClick={() => setCount(count + 1)}>
      Count: {count}
    </button>
  );
}
`;

const NEW_VALUE = `import { useState, useCallback } from 'react';

export function Counter({ initial = 0 }: { initial?: number }) {
  const [count, setCount] = useState(initial);
  const increment = useCallback(() => setCount((c) => c + 1), []);
  return (
    <button onClick={increment} data-testid="counter">
      Count: {count}
    </button>
  );
}
`;

const FILES: FileDiffSummary[] = [
  {
    path: 'src/components/Counter.tsx',
    status: 'modified',
    staged: false,
    additions: 4,
    deletions: 2,
  },
  {
    path: 'src/components/Sidebar.tsx',
    status: 'modified',
    staged: true,
    additions: 12,
    deletions: 3,
  },
  { path: 'src/lib/utils.ts', status: 'modified', staged: false, additions: 1, deletions: 1 },
  { path: 'src/styles/new-theme.css', status: 'added', staged: false, additions: 48, deletions: 0 },
  {
    path: 'src/legacy/old-helper.ts',
    status: 'deleted',
    staged: false,
    additions: 0,
    deletions: 30,
  },
];

/* ------------------------------------------------------------------ */
/*  Trigger wrapper                                                   */
/* ------------------------------------------------------------------ */

function ExpandedDiffTrigger({
  filePath = 'src/components/Counter.tsx',
  oldValue = OLD_VALUE,
  newValue = NEW_VALUE,
  files,
  loading,
  label,
}: {
  filePath?: string;
  oldValue?: string;
  newValue?: string;
  files?: FileDiffSummary[];
  loading?: boolean;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState(filePath);
  return (
    <>
      <Button variant="outline" data-testid="expanded-diff-trigger" onClick={() => setOpen(true)}>
        {label}
      </Button>
      <ExpandedDiffDialog
        open={open}
        onOpenChange={setOpen}
        filePath={selectedFile}
        oldValue={oldValue}
        newValue={newValue}
        loading={loading}
        files={files}
        onFileSelect={setSelectedFile}
        onToggleFile={fn()}
        onRevertFile={fn()}
        onIgnore={fn()}
      />
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Storybook meta                                                    */
/* ------------------------------------------------------------------ */

const meta: Meta = {
  title: 'Dialogs/ExpandedDiffDialog',
  component: ExpandedDiffDialog,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj;

/* ------------------------------------------------------------------ */
/*  Stories                                                            */
/* ------------------------------------------------------------------ */

/** Single-file diff (no sidebar). */
export const SingleFile: Story = {
  render: () => <ExpandedDiffTrigger label="Open diff (single file)" />,
};

/** Diff with a file-tree sidebar listing multiple files. */
export const WithFileSidebar: Story = {
  render: () => <ExpandedDiffTrigger label="Open diff (with sidebar)" files={FILES} />,
};

/** Loading state — diff content not yet available. */
export const Loading: Story = {
  render: () => <ExpandedDiffTrigger label="Open diff (loading)" loading oldValue="" newValue="" />,
};

/** Newly added file — view mode is forced to unified. */
export const AddedFile: Story = {
  render: () => (
    <ExpandedDiffTrigger
      label="Open diff (added file)"
      filePath="src/styles/new-theme.css"
      oldValue=""
      newValue=":root {\n  --color-primary: hsl(220 90% 56%);\n  --color-secondary: hsl(280 65% 60%);\n}\n\nbody {\n  background: var(--color-primary);\n}\n"
      files={FILES}
    />
  ),
};
