import type { TreeDataItem } from '@/components/tree-view';

export type VirtualFileTreeRow = {
  readonly item: TreeDataItem;
  readonly level: number;
  readonly hasChildren: boolean;
  readonly isOpen: boolean;
};

export const FILE_TREE_VIRTUALIZE_THRESHOLD = 50;

export function countTreeDataItems(items: readonly TreeDataItem[]): number {
  let count = 0;
  const walk = (nodes: readonly TreeDataItem[]) => {
    for (const node of nodes) {
      count += 1;
      if (node.children?.length) {
        walk(node.children);
      }
    }
  };
  walk(items);
  return count;
}

export function shouldVirtualizeFileTreeData(
  items: readonly TreeDataItem[],
  threshold = FILE_TREE_VIRTUALIZE_THRESHOLD
): boolean {
  return countTreeDataItems(items) > threshold;
}

export function shouldVirtualizeVisibleFileTreeRows(
  rowCount: number,
  threshold = FILE_TREE_VIRTUALIZE_THRESHOLD
): boolean {
  return rowCount > threshold;
}

export function flattenVisibleFileTreeRows(
  items: readonly TreeDataItem[],
  expandedIds: ReadonlySet<string>
): VirtualFileTreeRow[] {
  const rows: VirtualFileTreeRow[] = [];
  const walk = (nodes: readonly TreeDataItem[], level: number) => {
    for (const item of nodes) {
      const hasChildren = Boolean(item.children?.length) || item.forceNode === true;
      const isOpen = hasChildren && expandedIds.has(item.id);
      rows.push({ item, level, hasChildren, isOpen });
      if (isOpen && item.children) {
        walk(item.children, level + 1);
      }
    }
  };
  walk(items, 0);
  return rows;
}

export function pruneExpandedFileTreeIds(
  expandedIds: ReadonlySet<string>,
  items: readonly TreeDataItem[]
): Set<string> {
  const validIds = new Set<string>();
  const walk = (nodes: readonly TreeDataItem[]) => {
    for (const node of nodes) {
      if (node.children?.length || node.forceNode === true) {
        validIds.add(node.id);
        walk(node.children ?? []);
      }
    }
  };
  walk(items);
  return new Set([...expandedIds].filter((id) => validIds.has(id)));
}
