/**
 * Parses a markdown plan into structured sections based on heading markers (## or #).
 *
 * If the plan has no headings, returns a single section with the entire content.
 */

export interface PlanSection {
  /** Unique index within the plan */
  id: number;
  /** The heading text (without the `#` markers), or empty string for preamble */
  title: string;
  /** Heading level: 1 for `#`, 2 for `##`, etc. 0 for preamble */
  level: number;
  /** The raw markdown content of this section (excluding the heading line itself) */
  content: string;
}

export function parsePlanSections(markdown: string): PlanSection[] {
  const lines = markdown.split('\n');
  const sections: PlanSection[] = [];
  let currentTitle = '';
  let currentLevel = 0;
  let currentLines: string[] = [];
  let idCounter = 0;

  const flush = () => {
    const content = currentLines.join('\n').trim();
    if (content || currentTitle) {
      sections.push({
        id: idCounter++,
        title: currentTitle,
        level: currentLevel,
        content,
      });
    }
  };

  for (const line of lines) {
    const match = line.match(/^(#{1,4})\s+(.+)$/);
    if (match) {
      flush();
      currentLevel = match[1].length;
      currentTitle = match[2].trim();
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }
  flush();

  // If there are no headed sections (only preamble), return the whole thing as one section
  if (sections.length === 1 && sections[0].level === 0) {
    return sections;
  }

  return sections;
}
