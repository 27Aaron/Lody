import { describe, expect, it } from 'vitest';
import {
  filterMobileInboxItems,
  type MobileInboxItem,
} from '../src/components/mobile/mobile-home-screen';

const items: MobileInboxItem[] = [
  {
    id: 'sharing',
    kind: 'sharing_review',
    title: 'Review team sharing',
    description: 'Two projects are private.',
    actionLabel: 'Review projects',
    updatedAt: 3,
  },
  {
    id: 'permission',
    kind: 'permission_requested',
    title: 'Deploy release',
    description: 'Approval needed: shell',
    actionLabel: 'Open conversation',
    updatedAt: 2,
  },
];

describe('filterMobileInboxItems', () => {
  it('filters inbox items by title, description, and action label', () => {
    expect(filterMobileInboxItems(items, 'deploy').map((item) => item.id)).toEqual(['permission']);
    expect(filterMobileInboxItems(items, 'private').map((item) => item.id)).toEqual(['sharing']);
    expect(filterMobileInboxItems(items, 'conversation').map((item) => item.id)).toEqual([
      'permission',
    ]);
  });

  it('returns all items when the query is empty', () => {
    expect(filterMobileInboxItems(items, '')).toEqual(items);
  });
});
