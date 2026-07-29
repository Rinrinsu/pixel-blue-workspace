import { NavNode } from "./types";

export function createDefaultNavigation(): NavNode[] {
  return [
    {
      id: "group-execution",
      label: "执行",
      icon: "workflow",
      expanded: true,
      children: [
        { id: "dashboard", label: "工作台", icon: "layout-dashboard", page: "dashboard" },
        { id: "projects", label: "项目档案", icon: "folder-kanban", page: "projects" },
        { id: "database", label: "多维表", icon: "table-properties", page: "database" },
        {
          id: "daily",
          label: "每日笔记",
          icon: "notebook-pen",
          page: "daily",
          expanded: true,
          children: [
            { id: "daily-all", label: "查看全部日期", icon: "calendar-days", page: "daily-all" }
          ]
        }
      ]
    },
    {
      id: "group-knowledge",
      label: "内容",
      icon: "book-open-check",
      expanded: true,
      children: [
        {
          id: "brain",
          label: "知识中心",
          icon: "brain-circuit",
          page: "brain",
          children: [
            { id: "brain-overview", label: "总览", page: "brain" },
            { id: "brain-learning", label: "学习资料", page: "collection", path: "Knowledge/Learning" },
            { id: "brain-work", label: "工作资料", page: "collection", path: "Knowledge/Work" },
            { id: "brain-life", label: "生活记录", page: "collection", path: "Knowledge/Life" }
          ]
        },
        {
          id: "knowledge",
          label: "知识库",
          icon: "library-big",
          page: "knowledge",
          children: [
            { id: "knowledge-all", label: "全部知识", page: "knowledge" },
            { id: "knowledge-unsorted", label: "未分类", page: "collection", path: "Knowledge/Unsorted" }
          ]
        },
        { id: "inspiration", label: "灵感收集", icon: "sparkles", page: "inspiration" }
      ]
    },
    {
      id: "group-tools",
      label: "工具",
      icon: "wrench",
      expanded: true,
      children: [
        { id: "search", label: "全库搜索", icon: "search", page: "search" },
        {
          id: "juicer",
          label: "笔记榨汁机",
          icon: "blender",
          page: "juicer",
          children: [
            { id: "juicer-raw", label: "处理队列", page: "collection", path: "Juicer/Raw" },
            { id: "juicer-review", label: "审阅队列", page: "collection", path: "Juicer/Review" },
            { id: "juicer-category", label: "分类管理", page: "collection", path: "Juicer/Categories" }
          ]
        }
      ]
    }
  ];
}

export interface NavNodeLocation {
  node: NavNode;
  container: NavNode[];
  index: number;
}

export function findNavNode(nodes: NavNode[], id: string): NavNode | undefined {
  return findNavNodeLocation(nodes, id)?.node;
}

export function findNavNodeLocation(
  nodes: NavNode[],
  id: string
): NavNodeLocation | undefined {
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    if (!node) continue;
    if (node.id === id) return { node, container: nodes, index };
    if (node.children) {
      const nested = findNavNodeLocation(node.children, id);
      if (nested) return nested;
    }
  }
  return undefined;
}

export function createNavigationId(): string {
  return `nav-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}
