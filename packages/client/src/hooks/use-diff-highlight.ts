import { type ReactElement, createElement, useState, useEffect, useCallback, useMemo } from 'react';

import { extToShikiLang, getFileExtension } from '@/components/tool-cards/utils';
import { useShiki } from '@/hooks/use-shiki';

/**
 * Extract per-line inner HTML from Shiki's output.
 * Shiki wraps each line in `<span class="line">...</span>`.
 *
 * We split on the opening `<span class="line">` markers and then strip
 * the trailing `</span>` that closes each line wrapper. This avoids
 * issues with nested `<span>` tags inside each line (a simple `.*?`
 * regex would stop at the first inner `</span>`).
 */
function splitHighlightedLines(html: string): string[] {
  const parts = html.split('<span class="line">');
  // First part is everything before the first line (the <pre><code> wrapper) — skip it
  const lines: string[] = [];
  for (let i = 1; i < parts.length; i++) {
    let part = parts[i];
    // Remove the closing </span> that belongs to the <span class="line"> wrapper.
    // It's the last </span> in the part (there may be others from nested token spans).
    const lastClose = part.lastIndexOf('</span>');
    if (lastClose !== -1) {
      part = part.substring(0, lastClose);
    }
    lines.push(part);
  }
  return lines;
}

/**
 * Pre-highlights old/new diff sides with Shiki and returns a `renderContent`
 * callback compatible with react-diff-viewer-continued.
 *
 * The viewer calls `renderContent(sourceLine)` synchronously per line.
 * We highlight both sides upfront and look up each line by text content.
 * Identical source lines always produce identical highlighting, so a simple
 * text-based lookup is correct (even for duplicates and empty lines).
 */
export function useDiffHighlight(
  oldValue: string,
  newValue: string,
  filePath: string,
): { renderContent: ((source: string) => ReactElement) | undefined } {
  const { highlight, ready } = useShiki();
  const [oldLines, setOldLines] = useState<string[] | null>(null);
  const [newLines, setNewLines] = useState<string[] | null>(null);

  const lang = useMemo(() => {
    if (!filePath) return 'text';
    const ext = getFileExtension(filePath);
    return extToShikiLang(ext);
  }, [filePath]);

  useEffect(() => {
    if (!ready || !filePath) return;

    let cancelled = false;

    Promise.all([highlight(oldValue, lang), highlight(newValue, lang)]).then(
      ([oldHtml, newHtml]) => {
        if (cancelled) return;
        setOldLines(splitHighlightedLines(oldHtml));
        setNewLines(splitHighlightedLines(newHtml));
      },
    );

    return () => {
      cancelled = true;
    };
  }, [oldValue, newValue, lang, ready, highlight, filePath]);

  // Build a Map<sourceText, highlightedHtml> from both sides.
  // Identical source text always produces identical highlighting,
  // so first-match wins and is always correct.
  const lineMap = useMemo(() => {
    if (!oldLines || !newLines) return null;

    const map = new Map<string, string>();
    const oldSrc = oldValue.split('\n');
    const newSrc = newValue.split('\n');

    for (let i = 0; i < oldSrc.length; i++) {
      if (!map.has(oldSrc[i]) && oldLines[i] !== undefined) {
        map.set(oldSrc[i], oldLines[i]);
      }
    }
    for (let i = 0; i < newSrc.length; i++) {
      if (!map.has(newSrc[i]) && newLines[i] !== undefined) {
        map.set(newSrc[i], newLines[i]);
      }
    }
    return map;
  }, [oldLines, newLines, oldValue, newValue]);

  const renderContent = useCallback(
    (source: string): ReactElement => {
      const html = lineMap?.get(source);
      if (html !== undefined) {
        return createElement('span', { dangerouslySetInnerHTML: { __html: html } });
      }
      return createElement('span', null, source);
    },
    [lineMap],
  );

  return {
    renderContent: lineMap ? renderContent : undefined,
  };
}
