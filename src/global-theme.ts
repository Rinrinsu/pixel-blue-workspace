import {
  ColorSchemeId,
  WorkspaceColorPalette
} from "./theme-manager";

const GLOBAL_THEME_CLASS = "vw-global-theme";
const GLOBAL_THEME_PROPERTIES = [
  "--vw-global-text",
  "--vw-global-muted",
  "--vw-global-accent",
  "--vw-global-success",
  "--vw-global-error"
] as const;

export interface GlobalThemeSelection {
  enabled: boolean;
  colorScheme: ColorSchemeId;
  colors?: WorkspaceColorPalette;
}

export class GlobalThemeManager {
  apply(body: HTMLElement, selection: GlobalThemeSelection): void {
    if (!selection.enabled) {
      this.clear(body);
      return;
    }

    body.classList.add(GLOBAL_THEME_CLASS);
    body.dataset.vwGlobalTheme = "pixel-sky";
    body.dataset.vwGlobalColorScheme = this.resolveColorScheme(
      body,
      selection.colorScheme
    );

    const properties: Array<[typeof GLOBAL_THEME_PROPERTIES[number], keyof WorkspaceColorPalette]> = [
      ["--vw-global-text", "text"],
      ["--vw-global-muted", "muted"],
      ["--vw-global-accent", "doing"],
      ["--vw-global-success", "done"],
      ["--vw-global-error", "overdue"]
    ];
    properties.forEach(([property, key]) => {
      const value = selection.colors?.[key];
      if (value) body.style.setProperty(property, value);
      else body.style.removeProperty(property);
    });
  }

  clear(body: HTMLElement): void {
    body.classList.remove(GLOBAL_THEME_CLASS);
    delete body.dataset.vwGlobalTheme;
    delete body.dataset.vwGlobalColorScheme;
    GLOBAL_THEME_PROPERTIES.forEach((property) => {
      body.style.removeProperty(property);
    });
  }

  private resolveColorScheme(
    body: HTMLElement,
    colorScheme: ColorSchemeId
  ): "light" | "dark" {
    if (colorScheme !== "system") return colorScheme;
    return body.classList.contains("theme-dark") ? "dark" : "light";
  }
}
