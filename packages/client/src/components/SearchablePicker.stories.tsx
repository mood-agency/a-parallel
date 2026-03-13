import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';

import { BranchPicker, SearchablePicker } from '@/components/SearchablePicker';

/* ------------------------------------------------------------------ */
/*  SearchablePicker (generic)                                         */
/* ------------------------------------------------------------------ */

const searchablePickerMeta: Meta<typeof SearchablePicker> = {
  title: 'Components/SearchablePicker',
  component: SearchablePicker,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
};

export default searchablePickerMeta;
type SearchablePickerStory = StoryObj<typeof searchablePickerMeta>;

export const Default: SearchablePickerStory = {
  args: {
    items: [
      { key: 'main', label: 'main', isSelected: true },
      { key: 'develop', label: 'develop', isSelected: false },
      { key: 'feature/auth', label: 'feature/auth', isSelected: false },
      { key: 'feature/dark-mode', label: 'feature/dark-mode', isSelected: false },
      { key: 'fix/login-bug', label: 'fix/login-bug', isSelected: false },
    ],
    label: 'Select item',
    displayValue: 'main',
    searchPlaceholder: 'Search...',
    noMatchText: 'No matches found',
    onSelect: fn(),
    side: 'bottom',
  },
};

export const WithCopy: SearchablePickerStory = {
  args: {
    ...Default.args,
    onCopy: fn(),
  },
};

export const WithBadges: SearchablePickerStory = {
  args: {
    items: [
      { key: 'main', label: 'main', isSelected: true, badge: 'default' },
      { key: 'develop', label: 'develop', isSelected: false, badge: 'protected' },
      { key: 'feature/auth', label: 'feature/auth', isSelected: false },
      {
        key: 'feature/notifications',
        label: 'feature/notifications',
        isSelected: false,
        detail: '3 commits ahead',
      },
    ],
    label: 'Branch',
    displayValue: 'main',
    searchPlaceholder: 'Search branches...',
    noMatchText: 'No branches match',
    onSelect: fn(),
    onCopy: fn(),
    side: 'bottom',
  },
};

export const Loading: SearchablePickerStory = {
  args: {
    items: [],
    label: 'Branch',
    displayValue: 'Loading...',
    searchPlaceholder: 'Search...',
    noMatchText: 'No matches',
    loadingText: 'Loading branches...',
    loading: true,
    onSelect: fn(),
    side: 'bottom',
  },
};

export const Empty: SearchablePickerStory = {
  args: {
    items: [],
    label: 'Branch',
    displayValue: 'No branches',
    searchPlaceholder: 'Search...',
    noMatchText: 'No branches match',
    emptyText: 'No branches available',
    onSelect: fn(),
    side: 'bottom',
  },
};

export const ManyItems: SearchablePickerStory = {
  args: {
    items: Array.from({ length: 50 }, (_, i) => ({
      key: `branch-${i}`,
      label: `feature/JIRA-${1000 + i}-${['auth', 'ui', 'api', 'db', 'infra'][i % 5]}-improvements`,
      isSelected: i === 0,
    })),
    label: 'Branch',
    displayValue: 'feature/JIRA-1000-auth-improvements',
    searchPlaceholder: 'Search branches...',
    noMatchText: 'No branches match',
    onSelect: fn(),
    onCopy: fn(),
    side: 'bottom',
  },
};

/* ------------------------------------------------------------------ */
/*  BranchPicker (specialized)                                         */
/* ------------------------------------------------------------------ */

export const BranchPickerDefault: StoryObj<typeof BranchPicker> = {
  name: 'BranchPicker',
  render: (args) => <BranchPicker {...args} />,
  args: {
    branches: [
      'main',
      'develop',
      'feature/auth',
      'feature/dark-mode',
      'fix/login-bug',
      'release/v2.0',
    ],
    selected: 'main',
    onChange: fn(),
    side: 'bottom',
  },
};

export const BranchPickerMany: StoryObj<typeof BranchPicker> = {
  name: 'BranchPicker / Many Branches',
  render: (args) => <BranchPicker {...args} />,
  args: {
    branches: Array.from({ length: 30 }, (_, i) => `feature/PROJ-${100 + i}`),
    selected: 'feature/PROJ-100',
    onChange: fn(),
    side: 'bottom',
  },
};

export const BranchPickerNoCopy: StoryObj<typeof BranchPicker> = {
  name: 'BranchPicker / No Copy',
  render: (args) => <BranchPicker {...args} />,
  args: {
    branches: ['main', 'develop', 'staging'],
    selected: 'develop',
    onChange: fn(),
    showCopy: false,
    side: 'bottom',
  },
};
