import '../src/globals.css';
import './storybook.css';
import '../src/i18n/config';
import type { Preview } from '@storybook/react-vite';
import { ThemeProvider } from 'next-themes';

import { TooltipProvider } from '../src/components/ui/tooltip';

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
      <ThemeProvider attribute="class" defaultTheme="one-dark">
        <TooltipProvider>
          <Story />
        </TooltipProvider>
      </ThemeProvider>
    ),
  ],
};

export default preview;
