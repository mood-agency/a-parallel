import remarkGfm from 'remark-gfm';

import { cn } from './utils';

export const remarkPlugins = [remarkGfm];

export const baseMarkdownComponents = {
  code: ({ className, children, ...props }: any) => {
    const isBlock = className?.startsWith('language-');
    return isBlock ? (
      <code
        className={cn('block bg-muted p-2 rounded text-xs font-mono overflow-x-auto', className)}
        {...props}
      >
        {children}
      </code>
    ) : (
      <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs" {...props}>
        {children}
      </code>
    );
  },
  pre: ({ children }: any) => (
    <pre className="my-2 overflow-x-auto rounded bg-muted p-2 font-mono">{children}</pre>
  ),
};
