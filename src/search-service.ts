import { App, TFile } from "obsidian";

export type SearchMode = "exact" | "relevance" | "semantic";

export interface VaultSearchResult {
  file: TFile;
  filePath: string;
  title: string;
  heading?: string;
  snippet: string;
  mode: SearchMode;
  score: number;
  reasons: string[];
  matchedTerms?: string[];
  semanticSimilarity?: number;
  modifiedAt: number;
}

interface IndexedDocument {
  file: TFile;
  title: string;
  frontmatterTitle: string;
  basename: string;
  path: string;
  aliases: string;
  tags: string;
  h1: string;
  h23: string;
  properties: string;
  body: string;
  linkText: string;
  fullText: string;
  type: string;
  status: string;
  project: string;
  modifiedAt: number;
  length: number;
  termFrequencies: Map<string, number>;
  fieldFrequencies: Record<SearchField, Map<string, number>>;
}

type SearchField =
  | "frontmatterTitle"
  | "basename"
  | "aliases"
  | "tags"
  | "h1"
  | "h23"
  | "properties"
  | "body"
  | "linkText";

const FIELD_WEIGHTS: Record<SearchField, number> = {
  frontmatterTitle: 6,
  basename: 5,
  aliases: 4.5,
  tags: 4,
  h1: 3.5,
  h23: 2.5,
  properties: 2,
  body: 1,
  linkText: 0.8
};

type ExactNode =
  | { type: "term"; value: string }
  | { type: "not"; child: ExactNode }
  | { type: "and" | "or"; left: ExactNode; right: ExactNode };

interface ExactEvaluation {
  matched: boolean;
  conditions: number;
  reasons: string[];
  terms: string[];
}

export class SearchSyntaxError extends Error {}

export class SearchService {
  private documents: IndexedDocument[] = [];
  private documentFrequency = new Map<string, number>();
  private averageLength = 1;
  private dirty = true;
  private buildPromise: Promise<void> | undefined;

  constructor(
    private app: App,
    private excludedFolders: () => string[] = () => []
  ) {}

  invalidate(): void {
    this.dirty = true;
  }

  async search(
    query: string,
    mode: Exclude<SearchMode, "semantic">,
    onProgress?: (completed: number, total: number) => void
  ): Promise<VaultSearchResult[]> {
    const normalized = query.trim();
    if (!normalized) return [];
    await this.ensureIndex(onProgress);
    return mode === "exact"
      ? this.searchExact(normalized)
      : this.searchRelevance(normalized);
  }

  private async ensureIndex(
    onProgress?: (completed: number, total: number) => void
  ): Promise<void> {
    if (!this.dirty && this.documents.length) return;
    if (this.buildPromise) return this.buildPromise;
    this.buildPromise = this.buildIndex(onProgress).finally(() => {
      this.buildPromise = undefined;
    });
    return this.buildPromise;
  }

  private async buildIndex(
    onProgress?: (completed: number, total: number) => void
  ): Promise<void> {
    const files = this.app.vault.getMarkdownFiles()
      .filter((file) => !this.isExcluded(file.path));
    const documents: IndexedDocument[] = [];
    const documentFrequency = new Map<string, number>();
    let totalLength = 0;

    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      if (!file) continue;
      const document = await this.indexFile(file);
      documents.push(document);
      totalLength += document.length;
      new Set(document.termFrequencies.keys()).forEach((term) => {
        documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
      });
      onProgress?.(index + 1, files.length);
      if ((index + 1) % 24 === 0) {
        await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      }
    }

    this.documents = documents;
    this.documentFrequency = documentFrequency;
    this.averageLength = documents.length ? totalLength / documents.length : 1;
    this.dirty = false;
  }

  private isExcluded(path: string): boolean {
    const normalizedPath = path.replace(/\\/g, "/").toLocaleLowerCase();
    const excluded = [this.app.vault.configDir, ".trash", ...this.excludedFolders()]
      .filter((folder): folder is string => Boolean(folder))
      .map((folder) => folder.trim().replace(/^\/+|\/+$/g, "").toLocaleLowerCase())
      .filter(Boolean);
    return excluded.some((folder) => (
      normalizedPath === folder || normalizedPath.startsWith(`${folder}/`)
    ));
  }

  private async indexFile(file: TFile): Promise<IndexedDocument> {
    const content = await this.app.vault.cachedRead(file);
    const cache = this.app.metadataCache.getFileCache(file);
    const frontmatter = cache?.frontmatter ?? {};
    const headings = cache?.headings ?? [];
    const tags = [
      ...(cache?.tags?.map((tag) => tag.tag.replace(/^#/, "")) ?? []),
      ...normalizeArray(frontmatter.tags)
    ].map((tag) => tag.replace(/^#/, ""));
    const aliases = normalizeArray(frontmatter.aliases ?? frontmatter.alias);
    const h1 = headings
      .filter((heading) => heading.level === 1)
      .map((heading) => heading.heading)
      .join(" ");
    const h23 = headings
      .filter((heading) => heading.level === 2 || heading.level === 3)
      .map((heading) => heading.heading)
      .join(" ");
    const linkText = [...content.matchAll(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g)]
      .map((match) => match[2] ?? match[1] ?? "")
      .join(" ");
    const properties = Object.entries(frontmatter)
      .map(([key, value]) => `${key} ${normalizeProperty(value)}`)
      .join(" ");
    const body = stripMarkdown(content);
    const frontmatterTitle = String(frontmatter.title ?? "");
    const title = frontmatterTitle
      || headings.find((heading) => heading.level === 1)?.heading
      || file.basename;

    const fields: Record<SearchField, string> = {
      frontmatterTitle,
      basename: file.basename,
      aliases: aliases.join(" "),
      tags: tags.join(" "),
      h1,
      h23,
      properties,
      body,
      linkText
    };
    const fieldFrequencies = {} as Record<SearchField, Map<string, number>>;
    const termFrequencies = new Map<string, number>();
    (Object.keys(fields) as SearchField[]).forEach((field) => {
      const frequencies = countTerms(tokenize(fields[field]));
      fieldFrequencies[field] = frequencies;
      frequencies.forEach((count, term) => {
        termFrequencies.set(term, (termFrequencies.get(term) ?? 0) + count);
      });
    });
    const length = Math.max(1, [...termFrequencies.values()].reduce(
      (sum, count) => sum + count,
      0
    ));

    return {
      file,
      title,
      frontmatterTitle,
      basename: file.basename,
      path: file.path,
      aliases: aliases.join(" "),
      tags: tags.join(" "),
      h1,
      h23,
      properties,
      body,
      linkText,
      fullText: normalizeText([
        frontmatterTitle,
        file.basename,
        aliases.join(" "),
        tags.join(" "),
        h1,
        h23,
        properties,
        body,
        linkText
      ].join("\n")),
      type: String(frontmatter.type ?? ""),
      status: String(frontmatter.status ?? ""),
      project: String(frontmatter.project ?? ""),
      modifiedAt: file.stat.mtime,
      length,
      termFrequencies,
      fieldFrequencies
    };
  }

  private searchRelevance(query: string): VaultSearchResult[] {
    const queryTerms = [...new Set(tokenize(query))];
    if (!queryTerms.length) return [];
    const normalizedPhrase = normalizeText(query);
    const documentCount = Math.max(1, this.documents.length);

    return this.documents
      .map((document) => {
        let score = 0;
        const matchedTerms: string[] = [];
        const fieldHits = new Map<SearchField, number>();

        queryTerms.forEach((term) => {
          const frequency = this.documentFrequency.get(term) ?? 0;
          const idf = Math.log(1 + (documentCount - frequency + 0.5) / (frequency + 0.5));
          let weightedFrequency = 0;
          (Object.keys(FIELD_WEIGHTS) as SearchField[]).forEach((field) => {
            const count = document.fieldFrequencies[field].get(term) ?? 0;
            if (!count) return;
            weightedFrequency += count * FIELD_WEIGHTS[field];
            fieldHits.set(field, (fieldHits.get(field) ?? 0) + count);
          });
          if (!weightedFrequency) return;
          matchedTerms.push(term);
          const lengthFactor = 0.25 + 0.75 * document.length / this.averageLength;
          score += idf * (
            weightedFrequency * 2.2
            / (weightedFrequency + 1.2 * lengthFactor)
          );
        });

        if (!score) return undefined;
        if (normalizedPhrase.length > 1 && document.fullText.includes(normalizedPhrase)) {
          score += 1.5;
        }
        if (matchedTerms.length === queryTerms.length) score += 1;
        const ageDays = Math.max(0, (Date.now() - document.modifiedAt) / 86400000);
        score += Math.max(0, 0.8 * (1 - ageDays / 30));

        return this.toResult(
          document,
          "relevance",
          score,
          buildRelevanceReasons(fieldHits, document, queryTerms, normalizedPhrase),
          matchedTerms,
          queryTerms
        );
      })
      .filter((result): result is VaultSearchResult => Boolean(result))
      .sort((a, b) => b.score - a.score || b.modifiedAt - a.modifiedAt)
      .slice(0, 100);
  }

  private searchExact(query: string): VaultSearchResult[] {
    const tokens = lexExactQuery(query);
    const ast = new ExactParser(tokens).parse();
    return this.documents
      .map((document) => {
        const evaluation = evaluateExactNode(ast, document);
        if (!evaluation.matched) return undefined;
        const recency = Math.max(
          0,
          0.8 * (1 - (Date.now() - document.modifiedAt) / (30 * 86400000))
        );
        return this.toResult(
          document,
          "exact",
          evaluation.conditions + recency,
          evaluation.reasons,
          evaluation.terms,
          evaluation.terms
        );
      })
      .filter((result): result is VaultSearchResult => Boolean(result))
      .sort((a, b) => b.score - a.score
        || b.modifiedAt - a.modifiedAt
        || a.filePath.localeCompare(b.filePath))
      .slice(0, 100);
  }

  private toResult(
    document: IndexedDocument,
    mode: Exclude<SearchMode, "semantic">,
    score: number,
    reasons: string[],
    matchedTerms: string[],
    snippetTerms: string[]
  ): VaultSearchResult {
    return {
      file: document.file,
      filePath: document.path,
      title: document.title,
      snippet: createSnippet(document.body, snippetTerms),
      mode,
      score: Math.round(score * 100) / 100,
      reasons,
      matchedTerms,
      modifiedAt: document.modifiedAt
    };
  }
}

class ExactParser {
  private position = 0;

  constructor(private tokens: string[]) {}

  parse(): ExactNode {
    if (!this.tokens.length) throw new SearchSyntaxError("请输入查询条件");
    const node = this.parseOr();
    if (this.position < this.tokens.length) {
      throw new SearchSyntaxError(`无法识别：${this.tokens[this.position]}`);
    }
    return node;
  }

  private parseOr(): ExactNode {
    let node = this.parseAnd();
    while (this.peekUpper() === "OR") {
      this.position += 1;
      node = { type: "or", left: node, right: this.parseAnd() };
    }
    return node;
  }

  private parseAnd(): ExactNode {
    let node = this.parseUnary();
    while (this.position < this.tokens.length) {
      const next = this.peekUpper();
      if (next === "OR" || next === ")") break;
      if (next === "AND") this.position += 1;
      node = { type: "and", left: node, right: this.parseUnary() };
    }
    return node;
  }

  private parseUnary(): ExactNode {
    if (this.peekUpper() === "NOT") {
      this.position += 1;
      return { type: "not", child: this.parseUnary() };
    }
    if (this.tokens[this.position] === "(") {
      this.position += 1;
      const node = this.parseOr();
      if (this.tokens[this.position] !== ")") {
        throw new SearchSyntaxError("缺少右括号 )");
      }
      this.position += 1;
      return node;
    }
    const token = this.tokens[this.position];
    if (!token || token === ")") {
      throw new SearchSyntaxError("查询条件不完整");
    }
    this.position += 1;
    return { type: "term", value: token };
  }

  private peekUpper(): string | undefined {
    return this.tokens[this.position]?.toUpperCase();
  }
}

function evaluateExactNode(
  node: ExactNode,
  document: IndexedDocument
): ExactEvaluation {
  if (node.type === "term") return evaluateExactTerm(node.value, document);
  if (node.type === "not") {
    const child = evaluateExactNode(node.child, document);
    return {
      matched: !child.matched,
      conditions: child.matched ? 0 : 1,
      reasons: child.matched ? [] : [`已排除：${child.terms.join("、")}`],
      terms: child.terms
    };
  }
  const left = evaluateExactNode(node.left, document);
  const right = evaluateExactNode(node.right, document);
  return {
    matched: node.type === "and"
      ? left.matched && right.matched
      : left.matched || right.matched,
    conditions: left.conditions + right.conditions,
    reasons: [...left.reasons, ...right.reasons],
    terms: [...new Set([...left.terms, ...right.terms])]
  };
}

function evaluateExactTerm(
  rawTerm: string,
  document: IndexedDocument
): ExactEvaluation {
  const separator = rawTerm.indexOf(":");
  const field = separator > 0 ? rawTerm.slice(0, separator).toLowerCase() : "";
  const rawValue = separator > 0 ? rawTerm.slice(separator + 1) : rawTerm;
  const value = unquote(rawValue);
  const normalizedValue = normalizeText(value.replace(/^#/, ""));
  let matched = false;
  let reason = "";

  switch (field) {
    case "title":
      matched = normalizeText(`${document.frontmatterTitle} ${document.h1} ${document.h23}`)
        .includes(normalizedValue);
      reason = `标题：${value}`;
      break;
    case "file":
      matched = normalizeText(document.basename).includes(normalizedValue);
      reason = `文件名：${value}`;
      break;
    case "path":
      matched = normalizeText(document.path).includes(normalizedValue);
      reason = `路径：${value}`;
      break;
    case "tag":
      matched = normalizeText(document.tags).split(/\s+/).includes(normalizedValue);
      reason = `标签：${value}`;
      break;
    case "type":
      matched = normalizeText(document.type) === normalizedValue;
      reason = `类型：${value}`;
      break;
    case "status":
      matched = normalizeText(document.status) === normalizedValue;
      reason = `状态：${value}`;
      break;
    case "project":
      matched = normalizeText(document.project).includes(normalizedValue);
      reason = `项目：${value}`;
      break;
    case "before": {
      const time = parseDateBoundary(value, "before");
      matched = document.modifiedAt < time;
      reason = `修改早于 ${value}`;
      break;
    }
    case "after": {
      const time = parseDateBoundary(value, "after");
      matched = document.modifiedAt >= time;
      reason = `修改晚于 ${value}`;
      break;
    }
    default:
      if (field) {
        throw new SearchSyntaxError(`不支持的字段：${field}:`);
      }
      matched = document.fullText.includes(normalizedValue);
      reason = `包含：${value}`;
  }

  return {
    matched,
    conditions: matched ? 1 : 0,
    reasons: matched ? [reason] : [],
    terms: normalizedValue ? [normalizedValue] : []
  };
}

function lexExactQuery(query: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote = false;
  for (let index = 0; index < query.length; index += 1) {
    const char = query[index];
    if (char === "\"") {
      quote = !quote;
      current += char;
      continue;
    }
    if (!quote && (char === "(" || char === ")")) {
      if (current.trim()) tokens.push(current.trim());
      tokens.push(char);
      current = "";
      continue;
    }
    if (!quote && /\s/.test(char ?? "")) {
      if (current.trim()) tokens.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  if (quote) throw new SearchSyntaxError("引号没有闭合");
  if (current.trim()) tokens.push(current.trim());
  return tokens;
}

function parseDateBoundary(value: string, field: "before" | "after"): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new SearchSyntaxError(`${field}: 日期必须使用 YYYY-MM-DD`);
  }
  const time = new Date(`${value}T00:00:00`).getTime();
  if (Number.isNaN(time)) throw new SearchSyntaxError(`无效日期：${value}`);
  return time;
}

function tokenize(value: string): string[] {
  const normalized = normalizeText(value);
  const tokens: string[] = [];
  const latin = normalized.match(/[a-z0-9][a-z0-9._-]*/g) ?? [];
  tokens.push(...latin);
  const hanRuns = normalized.match(/\p{Script=Han}+/gu) ?? [];
  hanRuns.forEach((run) => {
    if (run.length <= 2) {
      tokens.push(run);
      return;
    }
    tokens.push(run);
    for (let index = 0; index < run.length - 1; index += 1) {
      tokens.push(run.slice(index, index + 2));
    }
  });
  return tokens.filter(Boolean);
}

function countTerms(terms: string[]): Map<string, number> {
  const frequencies = new Map<string, number>();
  terms.forEach((term) => {
    frequencies.set(term, (frequencies.get(term) ?? 0) + 1);
  });
  return frequencies;
}

function buildRelevanceReasons(
  hits: Map<SearchField, number>,
  document: IndexedDocument,
  queryTerms: string[],
  phrase: string
): string[] {
  const reasons: string[] = [];
  const titleHits = (hits.get("frontmatterTitle") ?? 0) + (hits.get("h1") ?? 0);
  if (titleHits) reasons.push(`标题命中 ${titleHits} 次`);
  const filenameHits = hits.get("basename") ?? 0;
  if (filenameHits) reasons.push(`文件名命中 ${filenameHits} 次`);
  const tagHits = hits.get("tags") ?? 0;
  if (tagHits) reasons.push(`标签命中 ${tagHits} 次`);
  const bodyHits = hits.get("body") ?? 0;
  if (bodyHits) reasons.push(`正文出现 ${bodyHits} 次`);
  if (phrase.length > 1 && document.fullText.includes(phrase)) {
    reasons.push("包含完整短语");
  }
  const matchedAll = queryTerms.every((term) => document.termFrequencies.has(term));
  if (matchedAll) reasons.push("所有查询词均出现");
  const ageDays = Math.floor((Date.now() - document.modifiedAt) / 86400000);
  if (ageDays <= 7) reasons.push("最近 7 天更新");
  return reasons.slice(0, 4);
}

function createSnippet(body: string, terms: string[]): string {
  const compact = body.replace(/\s+/g, " ").trim();
  if (!compact) return "该笔记没有可显示的正文片段。";
  const normalized = normalizeText(compact);
  let index = -1;
  for (const term of terms) {
    index = normalized.indexOf(normalizeText(term));
    if (index >= 0) break;
  }
  if (index < 0) return compact.slice(0, 180);
  const start = Math.max(0, index - 60);
  const end = Math.min(compact.length, index + 140);
  return `${start > 0 ? "…" : ""}${compact.slice(start, end)}${end < compact.length ? "…" : ""}`;
}

function normalizeArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (value === undefined || value === null || value === "") return [];
  return String(value).split(/[,\s]+/).filter(Boolean);
}

function normalizeProperty(value: unknown): string {
  if (Array.isArray(value)) return value.map(String).join(" ");
  if (value && typeof value === "object") return JSON.stringify(value);
  return String(value ?? "");
}

function stripMarkdown(content: string): string {
  return content
    .replace(/^---[\s\S]*?---\s*/u, "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*]\([^)]+\)/g, " ")
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?]]/g, "$2 $1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_~`>|]/g, " ");
}

function normalizeText(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("zh-CN").trim();
}

function unquote(value: string): string {
  return value.startsWith("\"") && value.endsWith("\"")
    ? value.slice(1, -1)
    : value;
}
