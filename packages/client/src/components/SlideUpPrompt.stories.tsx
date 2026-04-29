import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { fn } from 'storybook/test';

import { Button } from '@/components/ui/button';

import { SlideUpPrompt } from './SlideUpPrompt';

/* ------------------------------------------------------------------ */
/*  Trigger wrapper                                                   */
/* ------------------------------------------------------------------ */

function SlideUpPromptTrigger({
  loading,
  label,
  onSubmit,
}: {
  loading?: boolean;
  label: string;
  onSubmit: (prompt: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" data-testid="slide-up-prompt-trigger" onClick={() => setOpen(true)}>
        {label}
      </Button>
      <SlideUpPrompt
        open={open}
        onClose={() => setOpen(false)}
        loading={loading}
        projectId="proj-1"
        onSubmit={(prompt) => {
          onSubmit(prompt);
          return true;
        }}
      />
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Storybook meta                                                    */
/* ------------------------------------------------------------------ */

const meta: Meta = {
  title: 'Dialogs/SlideUpPrompt',
  component: SlideUpPrompt,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj;

/* ------------------------------------------------------------------ */
/*  Stories                                                            */
/* ------------------------------------------------------------------ */

/** Default — empty prompt input ready for the user to describe a new thread. */
export const Default: Story = {
  render: () => <SlideUpPromptTrigger label="New thread" onSubmit={fn()} />,
};

/** Submission in progress — submit button shows loading state. */
export const Loading: Story = {
  render: () => <SlideUpPromptTrigger label="New thread (loading)" loading onSubmit={fn()} />,
};
