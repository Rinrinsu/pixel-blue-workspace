export type JuicerDiffKind = "equal" | "removed" | "added";

export interface JuicerDiffSegment {
  kind: JuicerDiffKind;
  text: string;
}

export interface JuicerReviewBlock {
  id: string;
  section: string;
  markdown: string;
  text: string;
  sourceText?: string;
  similarity: number;
  accepted: boolean;
  selectable: boolean;
  originalDiff: JuicerDiffSegment[];
  draftDiff: JuicerDiffSegment[];
}

export interface JuicerReviewComparison {
  sourcePath: string;
  sourceBody: string;
  reviewBody: string;
  preamble: string;
  blocks: JuicerReviewBlock[];
}

export type JuicerReviewDecisions = Record<string, boolean>;

interface MarkdownSection {
  title: string;
  heading: string;
  blocks: string[];
}

interface TokenDiff {
  original: JuicerDiffSegment[];
  draft: JuicerDiffSegment[];
}

const FRONTMATTER_PATTERN = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/;
const TOKEN_PATTERN = /\s+|[\p{Script=Han}]|[\p{L}\p{N}_]+|[^\s]/gu;

export function stripMarkdownFrontmatter(content: string): string {
  return content.replace(FRONTMATTER_PATTERN, "").trim();
}

export function createJuicerReviewComparison(
  sourcePath: string,
  sourceContent: string,
  reviewContent: string,
  decisions: JuicerReviewDecisions = {}
): JuicerReviewComparison {
  const sourceBody = stripMarkdownFrontmatter(sourceContent);
  const reviewBody = stripMarkdownFrontmatter(reviewContent);
  const parsed = parseReviewBody(reviewBody);
  const sourceBlocks = parseSourceBlocks(sourceBody);
  const blocks: JuicerReviewBlock[] = [];

  parsed.sections.forEach((section) => {
    section.blocks.forEach((markdown) => {
      const text = markdownToText(markdown);
      const match = findClosestSource(text, sourceBlocks);
      const diff = diffText(match?.text ?? "", text);
      const id = createStableBlockId(section.title, markdown);
      const selectable = !/^来源$/u.test(section.title.trim());
      blocks.push({
        id,
        section: section.title,
        markdown,
        text,
        sourceText: match?.text,
        similarity: match?.score ?? 0,
        accepted: selectable ? decisions[id] !== false : true,
        selectable,
        originalDiff: diff.original,
        draftDiff: diff.draft
      });
    });
  });

  return {
    sourcePath,
    sourceBody,
    reviewBody,
    preamble: parsed.preamble,
    blocks
  };
}

export function composeAcceptedReviewBody(
  comparison: JuicerReviewComparison,
  decisions: JuicerReviewDecisions
): string {
  const sectionOrder: string[] = [];
  const acceptedBySection = new Map<string, JuicerReviewBlock[]>();
  comparison.blocks.forEach((block) => {
    if (!sectionOrder.includes(block.section)) sectionOrder.push(block.section);
    const accepted = block.selectable ? decisions[block.id] !== false : true;
    if (!accepted) return;
    const current = acceptedBySection.get(block.section) ?? [];
    current.push(block);
    acceptedBySection.set(block.section, current);
  });

  const output: string[] = [];
  const preamble = comparison.preamble.trim();
  if (preamble) output.push(preamble);
  sectionOrder.forEach((section) => {
    const blocks = acceptedBySection.get(section);
    if (!blocks?.length) return;
    if (section) output.push(`## ${section}`);
    output.push(...blocks.map((block) => block.markdown.trim()));
  });
  return `${output.filter(Boolean).join("\n\n").trim()}\n`;
}

export function decisionsFromComparison(
  comparison: JuicerReviewComparison
): JuicerReviewDecisions {
  return Object.fromEntries(
    comparison.blocks
      .filter((block) => block.selectable)
      .map((block) => [block.id, block.accepted])
  );
}

function parseReviewBody(body: string): {
  preamble: string;
  sections: MarkdownSection[];
} {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const preamble: string[] = [];
  const sections: MarkdownSection[] = [];
  let current: MarkdownSection | undefined;
  let buffer: string[] = [];

  const flushBlock = (): void => {
    const markdown = buffer.join("\n").trim();
    buffer = [];
    if (!markdown) return;
    if (!current) {
      preamble.push(markdown);
      return;
    }
    current.blocks.push(markdown);
  };

  lines.forEach((line) => {
    const heading = /^##\s+(.+?)\s*$/.exec(line);
    if (heading?.[1]) {
      flushBlock();
      current = {
        title: heading[1],
        heading: line,
        blocks: []
      };
      sections.push(current);
      return;
    }
    if (!line.trim()) {
      flushBlock();
      return;
    }
    if (/^\s*(?:[-*+]|\d+\.)\s+/.test(line) && buffer.length) {
      flushBlock();
    }
    buffer.push(line);
  });
  flushBlock();

  if (!sections.length && preamble.length) {
    sections.push({
      title: "正文",
      heading: "## 正文",
      blocks: [...preamble]
    });
    preamble.length = 0;
  }
  return { preamble: preamble.join("\n\n"), sections };
}

function parseSourceBlocks(body: string): string[] {
  const normalized = body
    .replace(/\r\n/g, "\n")
    .replace(/^#{1,6}\s+/gm, "")
    .trim();
  return normalized
    .split(/\n\s*\n|(?=^\s*(?:[-*+]|\d+\.)\s+)/gm)
    .map(markdownToText)
    .filter((value) => value.length >= 2);
}

function markdownToText(markdown: string): string {
  return markdown
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*(?:[-*+]|\d+\.)\s+/gm, "")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(
      /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,
      (_match: string, target: string, alias?: string) => alias || target
    )
    .replace(/[*_~`>|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function findClosestSource(
  draft: string,
  sourceBlocks: string[]
): { text: string; score: number } | undefined {
  let best: { text: string; score: number } | undefined;
  sourceBlocks.forEach((source) => {
    const score = similarity(source, draft);
    if (!best || score > best.score) best = { text: source, score };
  });
  return best && best.score >= 0.08 ? best : undefined;
}

function similarity(left: string, right: string): number {
  const leftTokens = new Set(searchTokens(left));
  const rightTokens = new Set(searchTokens(right));
  if (!leftTokens.size || !rightTokens.size) return 0;
  let intersection = 0;
  leftTokens.forEach((token) => {
    if (rightTokens.has(token)) intersection += 1;
  });
  return intersection / Math.max(leftTokens.size, rightTokens.size);
}

function searchTokens(value: string): string[] {
  const normalized = value.toLocaleLowerCase();
  const words = normalized.match(/[\p{L}\p{N}_]+/gu) ?? [];
  const han = [...normalized.replace(/[^\p{Script=Han}]/gu, "")];
  const bigrams = han.slice(0, -1).map((char, index) => `${char}${han[index + 1] ?? ""}`);
  return [...words, ...bigrams].filter(Boolean);
}

function diffText(original: string, draft: string): TokenDiff {
  if (!original) {
    return {
      original: [],
      draft: draft ? [{ kind: "added", text: draft }] : []
    };
  }
  const originalTokens = tokenize(original);
  const draftTokens = tokenize(draft);
  if (originalTokens.length > 320 || draftTokens.length > 320) {
    return {
      original: [{ kind: "removed", text: original }],
      draft: [{ kind: "added", text: draft }]
    };
  }

  const rows = originalTokens.length + 1;
  const columns = draftTokens.length + 1;
  const table = Array.from(
    { length: rows },
    () => new Uint16Array(columns)
  );
  for (let left = originalTokens.length - 1; left >= 0; left -= 1) {
    for (let right = draftTokens.length - 1; right >= 0; right -= 1) {
      table[left]![right] = originalTokens[left] === draftTokens[right]
        ? (table[left + 1]![right + 1] ?? 0) + 1
        : Math.max(table[left + 1]![right] ?? 0, table[left]![right + 1] ?? 0);
    }
  }

  const originalSegments: JuicerDiffSegment[] = [];
  const draftSegments: JuicerDiffSegment[] = [];
  let left = 0;
  let right = 0;
  while (left < originalTokens.length && right < draftTokens.length) {
    if (originalTokens[left] === draftTokens[right]) {
      pushSegment(originalSegments, "equal", originalTokens[left] ?? "");
      pushSegment(draftSegments, "equal", draftTokens[right] ?? "");
      left += 1;
      right += 1;
    } else if ((table[left + 1]![right] ?? 0) >= (table[left]![right + 1] ?? 0)) {
      pushSegment(originalSegments, "removed", originalTokens[left] ?? "");
      left += 1;
    } else {
      pushSegment(draftSegments, "added", draftTokens[right] ?? "");
      right += 1;
    }
  }
  while (left < originalTokens.length) {
    pushSegment(originalSegments, "removed", originalTokens[left] ?? "");
    left += 1;
  }
  while (right < draftTokens.length) {
    pushSegment(draftSegments, "added", draftTokens[right] ?? "");
    right += 1;
  }
  return { original: originalSegments, draft: draftSegments };
}

function tokenize(value: string): string[] {
  return value.match(TOKEN_PATTERN) ?? [];
}

function pushSegment(
  segments: JuicerDiffSegment[],
  kind: JuicerDiffKind,
  text: string
): void {
  if (!text) return;
  const previous = segments[segments.length - 1];
  if (previous?.kind === kind) {
    previous.text += joinToken(previous.text, text);
    return;
  }
  segments.push({ kind, text });
}

function joinToken(previous: string, next: string): string {
  const needsSpace = /[\p{L}\p{N}_]$/u.test(previous)
    && /^[\p{L}\p{N}_]/u.test(next)
    && !/[\p{Script=Han}]$/u.test(previous)
    && !/^[\p{Script=Han}]/u.test(next);
  return `${needsSpace ? " " : ""}${next}`;
}

function createStableBlockId(section: string, markdown: string): string {
  const input = `${section}\n${markdown.trim()}`;
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `block-${(hash >>> 0).toString(36)}`;
}
