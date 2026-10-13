/** Replace prose dashes when requested. Preserve code and link targets. */
export function formatPromptText(markdown: string, asciiDashes = false): string {
  if (!asciiDashes) return markdown;
  let fence: { character: string; length: number } | undefined;
  let codeSpan = 0;
  return markdown.split('\n').map(line => {
    const marker = /^(?:\s*>\s*)* {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      if (marker && marker[1][0] === fence.character && marker[1].length >= fence.length && !marker[2].trim()) fence = undefined;
      return line;
    }
    if (marker && !codeSpan) {
      fence = { character: marker[1][0], length: marker[1].length };
      return line;
    }
    if (/^(?: {4}|\t| {0,3}\[[^\]]+\]:)/.test(line)) return line;
    return line.split(/(`+|!?\[[^\]]*\]\([^)]*\)|<[^>]*>|https?:\/\/[^\s<>]+)/g).map(part => {
      if (/^`+$/.test(part)) {
        if (!codeSpan) codeSpan = part.length;
        else if (codeSpan === part.length) codeSpan = 0;
        return part;
      }
      if (codeSpan || /^(?:!?\[|<|https?:\/\/)/.test(part)) return part;
      return part.replaceAll('\u2014', '-');
    }).join('');
  }).join('\n');
}
