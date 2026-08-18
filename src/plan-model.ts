export function normalizePlanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function formatPlanTaskLine(text: string, due?: string, project?: string): string {
  const normalizedText = normalizePlanText(text);
  if (!normalizedText) throw new Error("计划内容不能为空");
  const normalizedDue = due?.trim();
  const normalizedProject = project?.replace(/[\[\]]/g, "").trim();
  return `- [ ] ${normalizedText}${normalizedDue ? ` 📅 ${normalizedDue}` : ""}${normalizedProject ? ` project:: [[${normalizedProject}]]` : ""}`;
}
