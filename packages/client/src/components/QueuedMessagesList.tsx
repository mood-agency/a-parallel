import type { QueuedMessage } from '@funny/shared';
import { AnimatePresence, motion } from 'motion/react';
import { ListOrdered, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

interface QueuedMessagesListProps {
  threadId: string;
  queuedCount: number;
}

export function QueuedMessagesList({ threadId, queuedCount }: QueuedMessagesListProps) {
  const { t } = useTranslation();
  const [messages, setMessages] = useState<QueuedMessage[]>([]);

  useEffect(() => {
    if (queuedCount <= 0) {
      setMessages([]);
      return;
    }
    api.listQueue(threadId).then((result) => {
      if (result.isOk()) setMessages(result.value);
    });
  }, [threadId, queuedCount]);

  if (messages.length === 0) return null;

  const handleCancel = async (messageId: string) => {
    const result = await api.cancelQueuedMessage(threadId, messageId);
    if (result.isOk()) {
      setMessages((prev) => prev.filter((m) => m.id !== messageId));
    }
  };

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-2">
      <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
        <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <ListOrdered className="h-3 w-3" />
          {t('queue.title')}
          <span className="rounded bg-muted px-1 text-[10px]">{messages.length}</span>
        </div>
        <AnimatePresence initial={false}>
          {messages.map((msg, i) => (
            <motion.div
              key={msg.id}
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.15 }}
              className={cn(
                'flex items-center gap-2 rounded px-2 py-1',
                i > 0 && 'border-t border-border/30',
              )}
            >
              <span className="min-w-4 text-center text-[10px] font-medium text-muted-foreground/60">
                {i + 1}
              </span>
              <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                {msg.content.slice(0, 120)}
              </span>
              <button
                onClick={() => handleCancel(msg.id)}
                className="shrink-0 rounded p-0.5 text-muted-foreground/60 transition-colors hover:bg-destructive/10 hover:text-destructive"
                aria-label={t('queue.cancelMessage')}
              >
                <X className="h-3 w-3" />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
