export const THEME_IDS = ["obsidian", "pixel-sky"] as const;
export type ThemeId = typeof THEME_IDS[number];

export const ICON_PACK_IDS = ["obsidian", "pixel-blue"] as const;
export type IconPackId = typeof ICON_PACK_IDS[number];

export const COLOR_SCHEME_IDS = ["light", "dark", "system"] as const;
export type ColorSchemeId = typeof COLOR_SCHEME_IDS[number];

export interface WorkspaceColorPalette {
  text: string;
  muted: string;
  todo: string;
  doing: string;
  done: string;
  overdue: string;
}

export interface ThemeSelection {
  theme: ThemeId;
  iconPack: IconPackId;
  colorScheme: ColorSchemeId;
  colors?: WorkspaceColorPalette;
}

export class ThemeManager {
  apply(root: HTMLElement, selection: ThemeSelection): void {
    root.dataset.vwTheme = this.normalizeTheme(selection.theme);
    root.dataset.vwIcons = this.normalizeIconPack(selection.iconPack);
    root.dataset.vwColorScheme = this.resolveColorScheme(root, selection.colorScheme);
    const properties: Array<[string, keyof WorkspaceColorPalette]> = [
      ["--vw-ink", "text"],
      ["--vw-muted", "muted"],
      ["--vw-state-todo", "todo"],
      ["--vw-state-doing", "doing"],
      ["--vw-state-done", "done"],
      ["--vw-state-overdue", "overdue"]
    ];
    properties.forEach(([property, key]) => {
      const value = selection.colors?.[key];
      if (value) root.style.setProperty(property, value);
      else root.style.removeProperty(property);
    });
  }

  private normalizeTheme(theme: string): ThemeId {
    return THEME_IDS.includes(theme as ThemeId) ? theme as ThemeId : "obsidian";
  }

  private normalizeIconPack(iconPack: string): IconPackId {
    return ICON_PACK_IDS.includes(iconPack as IconPackId) ? iconPack as IconPackId : "obsidian";
  }

  private resolveColorScheme(root: HTMLElement, colorScheme: string): "light" | "dark" {
    const normalized = COLOR_SCHEME_IDS.includes(colorScheme as ColorSchemeId)
      ? colorScheme as ColorSchemeId
      : "light";
    if (normalized !== "system") return normalized;
    return root.ownerDocument.body.classList.contains("theme-dark") ? "dark" : "light";
  }
}
