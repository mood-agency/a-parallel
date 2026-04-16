import { useMemo } from 'react';

function normalize(str: string) {
  return str
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

interface HighlightTextProps {
  text: string;
  query: string;
  className?: string;
}

export function HighlightText({ text, query, className }: HighlightTextProps) {
  const parts = useMemo(() => {
    if (!query.trim()) return [{ text, highlight: false }];

    const q = normalize(query);
    // NFKC ensures fullwidth/compatibility chars map to standard forms
    // and that each display char maps 1:1 with its normalized counterpart,
    // keeping slice positions aligned.
    const displayText = text.normalize('NFKC');
    const normalizedText = normalize(displayText);
    const result: { text: string; highlight: boolean }[] = [];
    let pos = 0;
    let idx = normalizedText.indexOf(q, pos);

    while (idx !== -1) {
      if (idx > pos) {
        result.push({ text: displayText.slice(pos, idx), highlight: false });
      }
      result.push({ text: displayText.slice(idx, idx + q.length), highlight: true });
      pos = idx + q.length;
      idx = normalizedText.indexOf(q, pos);
    }

    if (pos < displayText.length) {
      result.push({ text: displayText.slice(pos), highlight: false });
    }

    return result;
  }, [text, query]);

  if (!query.trim()) {
    return <span className={className}>{text}</span>;
  }

  return (
    <span className={className}>
      {parts.map((part, i) =>
        part.highlight ? (
          <mark
            key={`hl-${i}`}
            style={{ backgroundColor: '#FFE500', color: 'black' }}
            className="rounded-sm px-px font-semibold"
          >
            {part.text}
          </mark>
        ) : (
          <span key={`hl-${i}`}>{part.text}</span>
        ),
      )}
    </span>
  );
}

export { normalize };
