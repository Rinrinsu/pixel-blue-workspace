import { ProjectStage } from "./types";

export function normalizeProjectStages(value: unknown): ProjectStage[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item, index): ProjectStage | undefined => {
      if (typeof item === "string") {
        const name = item.trim();
        return name
          ? { id: createProjectStageId(index), name, progress: 0 }
          : undefined;
      }
      if (!item || typeof item !== "object") return undefined;
      const raw = item as Record<string, unknown>;
      const name = String(raw.name ?? raw.title ?? "").trim();
      if (!name) return undefined;
      return {
        id: String(raw.id ?? createProjectStageId(index)),
        name,
        progress: clampProgress(Number(raw.progress ?? 0))
      };
    })
    .filter((stage): stage is ProjectStage => Boolean(stage));
}

export function calculateStageProgress(stages: ProjectStage[]): number {
  if (!stages.length) return 0;
  return Math.round(
    stages.reduce((sum, stage) => sum + clampProgress(stage.progress), 0)
      / stages.length
  );
}

export function clampProgress(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : 0;
}

export function createProjectStageId(index = 0): string {
  return `stage-${Date.now().toString(36)}-${index}-${Math.random().toString(36).slice(2, 7)}`;
}
