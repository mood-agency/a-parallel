import type { Meta, StoryObj } from '@storybook/react-vite';
import { okAsync } from 'neverthrow';
import { useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { Toaster } from 'sonner';

import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';

import { CreateDesignDialog } from './CreateDesignDialog';

/* ------------------------------------------------------------------ */
/*  API mocking                                                       */
/* ------------------------------------------------------------------ */

function mockApi(opts: { fail?: boolean } = {}) {
  api.createDesign = ((_projectId: string, input: { name: string; type: string }) => {
    if (opts.fail) {
      return okAsync({ id: 'design-1', name: input.name, type: input.type } as never).map(() => {
        throw new Error('mock failure');
      });
    }
    return okAsync({
      id: 'design-1',
      name: input.name,
      type: input.type,
      projectId: 'proj-1',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as never);
  }) as typeof api.createDesign;

  api.createDesignDirectory = (() =>
    okAsync({ ok: true, path: '/tmp/design-1' })) as typeof api.createDesignDirectory;
}

/* ------------------------------------------------------------------ */
/*  Trigger wrapper                                                   */
/* ------------------------------------------------------------------ */

function CreateDesignTrigger({ label, setupMocks }: { label: string; setupMocks: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <MemoryRouter>
      <Toaster />
      <Button
        variant="outline"
        data-testid="create-design-trigger"
        onClick={() => {
          setupMocks();
          setOpen(true);
        }}
      >
        {label}
      </Button>
      <CreateDesignDialog
        open={open}
        onOpenChange={setOpen}
        projectId="proj-1"
        projectName="my-awesome-app"
      />
    </MemoryRouter>
  );
}

/* ------------------------------------------------------------------ */
/*  Storybook meta                                                    */
/* ------------------------------------------------------------------ */

const meta: Meta = {
  title: 'Dialogs/CreateDesignDialog',
  component: CreateDesignDialog,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj;

/* ------------------------------------------------------------------ */
/*  Stories                                                            */
/* ------------------------------------------------------------------ */

/** Default — Prototype tab with high-fidelity selected. */
export const Default: Story = {
  render: () => <CreateDesignTrigger label="Create design" setupMocks={() => mockApi()} />,
};
