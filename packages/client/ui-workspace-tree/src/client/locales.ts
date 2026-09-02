/** `workspace-tree` namespace dictionary: the file-tree panel's copy. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  title: '工作区',
  noWorkspace: '未打开工作区',
  loading: '加载中…',
  empty: '空文件夹',
  noMatch: '无匹配项',
  collapse: '收起文件树',
  filter: '筛选文件…',
  clearFilter: '清除筛选',
  toggleHidden: '显示 / 隐藏点文件',
  collapseAll: '全部折叠',
  refresh: '刷新',
  openFile: '打开 {name}',
  openFolder: '在文件管理器中打开 {name}',
  openFailed: '无法打开（仅本地运行时可用）。',
}

/** The `workspace-tree` namespace key union. */
export type WorkspaceTreeKey = keyof typeof zh

/** English dictionary (same keys as {@link zh}). */
export const en: { [Key in WorkspaceTreeKey]: string } = {
  title: 'Workspace',
  noWorkspace: 'No workspace open',
  loading: 'Loading…',
  empty: 'Empty folder',
  noMatch: 'No matches',
  collapse: 'Collapse file tree',
  filter: 'Filter files…',
  clearFilter: 'Clear filter',
  toggleHidden: 'Show / hide dotfiles',
  collapseAll: 'Collapse all',
  refresh: 'Refresh',
  openFile: 'Open {name}',
  openFolder: 'Reveal {name} in the file manager',
  openFailed: "Couldn't open — only available on a local run.",
}
