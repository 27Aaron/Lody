import { atom } from 'jotai';
import type { WorkspaceId } from '@lody/shared';

export const currentWorkspaceIdAtom = atom<WorkspaceId | null>(null);
export const currentWorkspaceSlugAtom = atom<string | null>(null);
