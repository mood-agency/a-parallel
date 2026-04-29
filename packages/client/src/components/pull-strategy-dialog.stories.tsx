import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { fn } from 'storybook/test';

import { Button } from '@/components/ui/button';

import { PullStrategyDialog } from './pull-strategy-dialog';

/* ------------------------------------------------------------------ */
/*  Trigger wrapper                                                   */
/* ------------------------------------------------------------------ */

function PullStrategyTrigger({
  errorMessage,
  label,
  onChoose,
}: {
  errorMessage: string;
  label: string;
  onChoose: (strategy: 'rebase' | 'merge') => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" data-testid="pull-strategy-trigger" onClick={() => setOpen(true)}>
        {label}
      </Button>
      <PullStrategyDialog
        open={open}
        onOpenChange={setOpen}
        errorMessage={errorMessage}
        onChoose={(strategy) => {
          onChoose(strategy);
          setOpen(false);
        }}
      />
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Storybook meta                                                    */
/* ------------------------------------------------------------------ */

const meta: Meta = {
  title: 'Dialogs/PullStrategyDialog',
  component: PullStrategyDialog,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj;

/* ------------------------------------------------------------------ */
/*  Stories                                                            */
/* ------------------------------------------------------------------ */

/** Default — typical "diverging branches" git error. */
export const Default: Story = {
  render: () => (
    <PullStrategyTrigger
      label="Pull (diverged)"
      onChoose={fn()}
      errorMessage={
        'hint: You have divergent branches and need to specify how to reconcile them.\nfatal: Need to specify how to reconcile divergent branches.'
      }
    />
  ),
};

/** Non-fast-forward error variant. */
export const NonFastForward: Story = {
  render: () => (
    <PullStrategyTrigger
      label="Pull (non-fast-forward)"
      onChoose={fn()}
      errorMessage={
        "! [rejected]        main -> main (non-fast-forward)\nerror: failed to push some refs to 'origin'"
      }
    />
  ),
};

/** Long error output that wraps inside the message panel. */
export const LongErrorOutput: Story = {
  render: () => (
    <PullStrategyTrigger
      label="Pull (long error)"
      onChoose={fn()}
      errorMessage={
        'hint: You have divergent branches and need to specify how to reconcile them.\nhint: You can do so by running one of the following commands sometime before\nhint: your next pull:\nhint:\nhint:   git config pull.rebase false  # merge\nhint:   git config pull.rebase true   # rebase\nhint:   git config pull.ff only       # fast-forward only\nfatal: Need to specify how to reconcile divergent branches.'
      }
    />
  ),
};
