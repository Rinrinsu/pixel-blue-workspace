import brandIcon from "../assets/pixel-sky/brand-icon.webp";
import heroCollage from "../assets/pixel-sky/hero-collage-v2.webp";
import heroDailyNotes from "../assets/pixel-sky/hero-daily-notes.webp";
import heroKnowledgeCenter from "../assets/pixel-sky/hero-knowledge-center.webp";
import calendarIcon from "../assets/pixel-sky/icons/calendar.webp";
import dailyIcon from "../assets/pixel-sky/icons/daily.webp";
import dashboardIcon from "../assets/pixel-sky/icons/dashboard.webp";
import inspirationIcon from "../assets/pixel-sky/icons/inspiration.webp";
import juicerIcon from "../assets/pixel-sky/icons/juicer.webp";
import knowledgeIcon from "../assets/pixel-sky/icons/knowledge.webp";
import projectsIcon from "../assets/pixel-sky/icons/projects.webp";
import databaseIcon from "../assets/pixel-sky/action-icons/database.webp";
import knowledgeBaseIcon from "../assets/pixel-sky/action-icons/knowledge-base.webp";
import navigationAddIcon from "../assets/pixel-sky/action-icons/navigation-add.webp";
import navigationDeleteIcon from "../assets/pixel-sky/action-icons/navigation-delete.webp";
import navigationRenameIcon from "../assets/pixel-sky/action-icons/navigation-rename.webp";
import openSourceIcon from "../assets/pixel-sky/action-icons/open-source.webp";
import panelToggleIcon from "../assets/pixel-sky/action-icons/panel-toggle.webp";
import refreshIcon from "../assets/pixel-sky/action-icons/refresh.webp";
import searchIcon from "../assets/pixel-sky/action-icons/search.webp";
import settingsThemeIcon from "../assets/pixel-sky/action-icons/settings-theme.webp";
import taskDoneIcon from "../assets/pixel-sky/action-icons/task-done.webp";

const EMBEDDED_ASSETS: Record<string, string> = {
  "assets/pixel-sky/brand-icon.png": brandIcon,
  "assets/pixel-sky/hero-collage-v2.png": heroCollage,
  "assets/pixel-sky/hero-daily-notes.png": heroDailyNotes,
  "assets/pixel-sky/hero-knowledge-center.png": heroKnowledgeCenter,
  "assets/pixel-sky/icons/calendar.png": calendarIcon,
  "assets/pixel-sky/icons/daily.png": dailyIcon,
  "assets/pixel-sky/icons/dashboard.png": dashboardIcon,
  "assets/pixel-sky/icons/inspiration.png": inspirationIcon,
  "assets/pixel-sky/icons/juicer.png": juicerIcon,
  "assets/pixel-sky/icons/knowledge.png": knowledgeIcon,
  "assets/pixel-sky/icons/projects.png": projectsIcon,
  "assets/pixel-sky/action-icons/database.png": databaseIcon,
  "assets/pixel-sky/action-icons/knowledge-base.png": knowledgeBaseIcon,
  "assets/pixel-sky/action-icons/navigation-add.png": navigationAddIcon,
  "assets/pixel-sky/action-icons/navigation-delete.png": navigationDeleteIcon,
  "assets/pixel-sky/action-icons/navigation-rename.png": navigationRenameIcon,
  "assets/pixel-sky/action-icons/open-source.png": openSourceIcon,
  "assets/pixel-sky/action-icons/panel-toggle.png": panelToggleIcon,
  "assets/pixel-sky/action-icons/refresh.png": refreshIcon,
  "assets/pixel-sky/action-icons/search.png": searchIcon,
  "assets/pixel-sky/action-icons/settings-theme.png": settingsThemeIcon,
  "assets/pixel-sky/action-icons/task-done.png": taskDoneIcon
};

export function getEmbeddedAssetUrl(relativePath: string): string | undefined {
  return EMBEDDED_ASSETS[relativePath.replace(/\\/g, "/")];
}
