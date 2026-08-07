import { useEffect, useLayoutEffect } from 'react';
import { useSetAtom } from 'jotai';
import { currentWorkspaceIdAtom, currentWorkspaceSlugAtom } from '@/atoms';
import { writePreferredWorkspaceSlug } from '@/lib/workspace';
import type { WorkspaceId } from '@lody/shared';

/** Minimal shape of `convexApi.auth.getWorkspaceAccessBySlug`'s result we depend on. */
type WorkspaceAccessForContext =
  | { status?: string; organizationId?: string }
  | null
  | undefined;

/**
 * Establish the workspace-context atoms (`currentWorkspaceSlugAtom` +
 * `currentWorkspaceIdAtom`) from a slug. The `RuntimeProvider` keys the
 * workspace runtime off these atoms — it does NOT read the router — so any
 * surface can drive a workspace by setting them, not only the `$workspaceName`
 * route.
 *
 * Mirrors the slug→atoms sync in `routes/$workspaceName.tsx`; keep the two in step.
 */
export function useWorkspaceContextAtoms(
  workspaceSlug: string | null,
  access: WorkspaceAccessForContext
): void {
  const setWorkspaceSlug = useSetAtom(currentWorkspaceSlugAtom);
  const setWorkspaceId = useSetAtom(currentWorkspaceIdAtom);

  // Optimistic, before paint — so the runtime can start booting from the cached
  // workspace id while the access query resolves.
  useLayoutEffect(() => {
    setWorkspaceSlug(workspaceSlug);
  }, [setWorkspaceSlug, workspaceSlug]);

  useEffect(() => {
    if (workspaceSlug && access?.status === 'member' && access.organizationId) {
      writePreferredWorkspaceSlug(workspaceSlug);
      setWorkspaceId(access.organizationId as WorkspaceId);
    }
  }, [access, setWorkspaceId, workspaceSlug]);

  // Clear the slug when the consumer unmounts so a stale workspace runtime
  // doesn't linger.
  useEffect(() => {
    return () => {
      setWorkspaceSlug(null);
    };
  }, [setWorkspaceSlug]);
}
