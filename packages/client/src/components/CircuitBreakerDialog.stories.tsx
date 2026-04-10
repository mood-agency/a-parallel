import type { Meta, StoryObj } from '@storybook/react-vite';

import { useCircuitBreakerStore } from '@/stores/circuit-breaker-store';

import { CircuitBreakerDialog } from './CircuitBreakerDialog';

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

/** Wrapper that forces the circuit-breaker store into a given state before rendering. */
function withState(state: 'open' | 'half-open') {
  return () => {
    useCircuitBreakerStore.setState({ state, failureCount: 3 });
    return <CircuitBreakerDialog />;
  };
}

/* ------------------------------------------------------------------ */
/*  Storybook meta                                                    */
/* ------------------------------------------------------------------ */

const meta = {
  title: 'Components/CircuitBreakerDialog',
  component: CircuitBreakerDialog,
  parameters: { layout: 'fullscreen' },
  tags: ['autodocs'],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/* ------------------------------------------------------------------ */
/*  Stories                                                            */
/* ------------------------------------------------------------------ */

/** Circuit open — shows error screen with retry button. */
export const Open: Story = {
  render: withState('open'),
};

/** Half-open — reconnection attempt in progress (no retry button). */
export const HalfOpen: Story = {
  render: withState('half-open'),
};
