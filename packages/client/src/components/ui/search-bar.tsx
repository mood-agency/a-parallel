import { ArrowDown, ArrowUp, Loader2, Search, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export interface SearchBarProps {
  /** Current query string */
  query: string;
  /** Called when the user types */
  onQueryChange: (query: string) => void;
  /** Current match index (0-based) */
  currentIndex: number;
  /** Total number of matches */
  totalMatches: number;
  /** Go to the previous match */
  onPrev: () => void;
  /** Go to the next match */
  onNext: () => void;
  /** Close the search bar */
  onClose: () => void;
  /** Show a loading spinner */
  loading?: boolean;
  /** Placeholder text */
  placeholder?: string;
  /** Show a search icon on the left */
  showIcon?: boolean;
  /** Additional class names for the container */
  className?: string;
  /** Prefix for data-testid attributes */
  testIdPrefix?: string;
  /** Auto-focus the input on mount */
  autoFocus?: boolean;
}

export function SearchBar({
  query,
  onQueryChange,
  currentIndex,
  totalMatches,
  onPrev,
  onNext,
  onClose,
  loading = false,
  placeholder = 'Search...',
  showIcon = true,
  className,
  testIdPrefix = 'search',
  autoFocus = true,
}: SearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (autoFocus) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [autoFocus]);

  const startClose = useCallback(() => {
    setClosing(true);
  }, []);

  const handleAnimationEnd = useCallback(() => {
    if (closing) onClose();
  }, [closing, onClose]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        startClose();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (e.shiftKey) onPrev();
        else onNext();
      }
    },
    [startClose, onPrev, onNext],
  );

  const resultLabel = query
    ? totalMatches > 0
      ? `${currentIndex + 1}/${totalMatches}`
      : `0/0`
    : `0/0`;

  return (
    <div
      className={cn(
        'flex items-center gap-1.5 duration-150',
        closing
          ? 'animate-out fade-out slide-out-to-top-2 fill-mode-forwards'
          : 'animate-in fade-in slide-in-from-top-2',
        className,
      )}
      onAnimationEnd={handleAnimationEnd}
      data-testid={`${testIdPrefix}-bar`}
    >
      {showIcon && <Search className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />}
      <Input
        ref={inputRef}
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className="h-7 flex-1 rounded-none border-none bg-transparent text-xs shadow-none focus-visible:ring-0"
        data-testid={`${testIdPrefix}-input`}
      />
      {loading && (
        <Loader2 className="h-3.5 w-3.5 flex-shrink-0 animate-spin text-muted-foreground" />
      )}
      <span
        className="w-12 flex-shrink-0 text-center text-xs tabular-nums text-muted-foreground"
        data-testid={`${testIdPrefix}-count`}
      >
        {resultLabel}
      </span>
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={onPrev}
        disabled={totalMatches === 0}
        data-testid={`${testIdPrefix}-prev`}
      >
        <ArrowUp className="h-3.5 w-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={onNext}
        disabled={totalMatches === 0}
        data-testid={`${testIdPrefix}-next`}
      >
        <ArrowDown className="h-3.5 w-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={startClose}
        data-testid={`${testIdPrefix}-close`}
      >
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
