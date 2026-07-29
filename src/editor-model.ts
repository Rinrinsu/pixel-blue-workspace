import { EditorDocumentState, NoteAnnotation } from "./types";

export function createDefaultEditorDocumentState(): EditorDocumentState {
  return {
    spacing: "normal",
    headingColors: "level",
    comments: []
  };
}

export function resolveAnnotation(markdown: string, comment: NoteAnnotation): number {
  const exact = `${comment.prefix}${comment.quote}${comment.suffix}`;
  const exactIndex = exact ? markdown.indexOf(exact) : -1;
  if (exactIndex >= 0) return exactIndex + comment.prefix.length;
  return markdown.indexOf(comment.quote);
}
