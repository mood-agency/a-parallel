import { memo } from 'react';
import { motion } from 'motion/react';
import { MessageSquare } from 'lucide-react';

interface StickyUserMessageProps {
  content: string;
  onScrollTo: () => void;
}

export const StickyUserMessage = memo(function StickyUserMessage({
  content,
  onScrollTo,
}: StickyUserMessageProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      className="absolute top-0 left-0 right-0 z-20 px-4 pointer-events-none"
    >
      <div className="mx-auto max-w-3xl min-w-[320px] pointer-events-auto">
        <button
          onClick={onScrollTo}
          className="w-full flex items-start gap-2 rounded-b-lg bg-muted/95 backdrop-blur-sm px-3 py-2 shadow-md cursor-pointer hover:bg-muted transition-colors text-left"
        >
          <MessageSquare className="h-3 w-3 text-foreground/60 flex-shrink-0 mt-0.5" />
          <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-foreground line-clamp-3 break-words">
            {content.trim()}
          </pre>
        </button>
      </div>
    </motion.div>
  );
});
