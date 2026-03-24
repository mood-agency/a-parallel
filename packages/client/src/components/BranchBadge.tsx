import { GitBranch } from 'lucide-react';

import { cn } from '@/lib/utils';

interface BranchBadgeProps {
  branch: string;
  size?: 'xs' | 'sm' | 'md';
  className?: string;
}

const sizeStyles = {
  xs: {
    icon: 'h-2.5 w-2.5',
    text: 'text-[10px]',
  },
  sm: {
    icon: 'h-3 w-3',
    text: 'text-xs',
  },
  md: {
    icon: 'h-3.5 w-3.5',
    text: 'text-sm',
  },
};

export function BranchBadge({ branch, size = 'sm', className }: BranchBadgeProps) {
  const s = sizeStyles[size];

  return (
    <span
      className={cn(
        'inline-flex min-w-0 items-center gap-0.5 rounded bg-muted font-medium text-muted-foreground',
        size === 'xs'
          ? 'text-[10px] leading-tight px-1 py-px'
          : size === 'sm'
            ? 'text-[10px] leading-tight px-1 py-px'
            : 'text-xs px-1.5 py-0.5',
        className,
      )}
      title={branch}
      data-testid="branch-badge"
    >
      <GitBranch className={cn(s.icon, 'shrink-0')} aria-hidden="true" />
      <span className={cn(s.text, 'truncate font-mono')}>{branch}</span>
    </span>
  );
}
