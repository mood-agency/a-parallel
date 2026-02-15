export interface ParsedCatOutput {
  /** Clean source code with line numbers stripped */
  code: string;
  /** Starting line number from the cat output (typically 1) */
  startLine: number;
}

/**
 * Parses output from `cat -n` format used by Claude's Read tool.
 * Each line has the format: `     1\tcontent here`
 * The separator can be a tab (\t) or the arrow character → (U+2192).
 */
export function parseCatOutput(output: string): ParsedCatOutput {
  const lines = output.split('\n');
  const parsed: string[] = [];
  let startLine = 1;
  let firstLineParsed = false;

  for (const line of lines) {
    // Match: optional spaces, digits, then tab or → separator, then content
    const match = line.match(/^\s*(\d+)[\t\u2192](.*)$/);
    if (match) {
      if (!firstLineParsed) {
        startLine = parseInt(match[1], 10);
        firstLineParsed = true;
      }
      parsed.push(match[2]);
    } else {
      parsed.push(line);
    }
  }

  // Remove trailing empty line (cat -n often ends with newline)
  if (parsed.length > 0 && parsed[parsed.length - 1] === '') {
    parsed.pop();
  }

  return {
    code: parsed.join('\n'),
    startLine,
  };
}
