/** `workspace-tree` namespace dictionary: the file-tree panel's copy. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  title: '工作区',
  noWorkspace: '未打开工作区',
  loading: '加载中…',
  empty: '空文件夹',
  collapse: '收起文件树',
}

/** The `workspace-tree` namespace key union. */
export type WorkspaceTreeKey = keyof typeof zh

/** English dictionary (same keys as {@link zh}). */
export const en: { [Key in WorkspaceTreeKey]: string } = {
  title: 'Workspace',
  noWorkspace: 'No workspace open',
  loading: 'Loading…',
  empty: 'Empty folder',
  collapse: 'Collapse file tree',
}
