import '../src/globals.css';
import type { Preview } from '@storybook/react-vite';

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
  },
  decorators: [
    (Story) => (
      <div className="dark bg-background p-8 font-sans text-foreground">
        <Story />
      </div>
    ),
  ],
};

export default preview;
