/**
 * Dragging a sidebar session onto a chat surface, as a data transfer.
 *
 * The drop turns into a session mention in that surface's composer. Everything
 * here is pure so both ends — the sidebar rows that start the drag and the
 * pages that accept it — agree on the format without importing each other.
 */

/** Marks the drag as ours. Present on every session drag. */
export const SESSION_MENTION_DRAG_TYPE = 'application/x-lody-session-mention';

/**
 * The dragged session id, encoded INTO a second type name.
 *
 * `dragover` may read `dataTransfer.types` but not `getData()` — the payload is
 * protected until drop. Without the id in the type name a surface cannot tell,
 * while the pointer is over it, whether the drag is the conversation the user
 * is already in; it would light up a drop target that then has to do nothing,
 * which reads as a bug. Browsers lowercase type names, so the id round-trips
 * through `.toLowerCase()` on both sides and is compared case-insensitively.
 */
const SESSION_MENTION_DRAG_ID_PREFIX = `${SESSION_MENTION_DRAG_TYPE}+id:`;

export type SessionMentionDragPayload = {
  sessionId: string;
  /** Only for the `text/plain` fallback outside the app. */
  title?: string;
};

type DragTypes = { types?: ArrayLike<string> | Iterable<string> };

function toTypeArray(dataTransfer: DragTypes | null | undefined): string[] {
  if (!dataTransfer?.types) return [];
  return Array.from(dataTransfer.types);
}

/**
 * What a sidebar row's `onDragStart` does. Paired with `draggable` on the row.
 *
 * A row whose whole surface is covered by a navigation `<a>` must ALSO mark
 * that anchor `draggable={false}`: the anchor is the deepest draggable node, so
 * without it the browser starts its own link drag and never reaches this.
 */
export function startSessionMentionDrag(
  event: { dataTransfer: Pick<DataTransfer, 'setData' | 'effectAllowed'> | null },
  payload: SessionMentionDragPayload
): void {
  const dataTransfer = event.dataTransfer;
  if (!dataTransfer) return;
  dataTransfer.effectAllowed = 'copy';
  dataTransfer.setData(SESSION_MENTION_DRAG_TYPE, payload.sessionId);
  dataTransfer.setData(`${SESSION_MENTION_DRAG_ID_PREFIX}${payload.sessionId.toLowerCase()}`, '');
  // A drop outside any of our surfaces still leaves something readable behind.
  dataTransfer.setData('text/plain', payload.title?.trim() || payload.sessionId);
}

/** The dragged session id, readable during `dragover`. */
function peekSessionMentionDragSessionId(
  dataTransfer: DragTypes | null | undefined
): string | null {
  for (const type of toTypeArray(dataTransfer)) {
    const lowered = type.toLowerCase();
    if (lowered.startsWith(SESSION_MENTION_DRAG_ID_PREFIX)) {
      return lowered.slice(SESSION_MENTION_DRAG_ID_PREFIX.length) || null;
    }
  }
  return null;
}

/**
 * Whether this drag is one this surface would accept.
 *
 * `excludeSessionId` is the conversation the surface already is: mentioning
 * itself is never what the user means, and the session mention list excludes it
 * too, so the drop would have nothing to insert.
 */
export function hasAcceptableSessionMentionTransfer(
  dataTransfer: DragTypes | null | undefined,
  options?: { excludeSessionId?: string | null }
): boolean {
  const types = toTypeArray(dataTransfer).map((type) => type.toLowerCase());
  if (!types.includes(SESSION_MENTION_DRAG_TYPE)) return false;
  const exclude = options?.excludeSessionId?.toLowerCase();
  if (!exclude) return true;
  const dragged = peekSessionMentionDragSessionId(dataTransfer);
  // An id-less drag (a browser that dropped the second type) stays acceptable;
  // the drop resolves it against the mention list, which excludes self anyway.
  return dragged === null || dragged !== exclude;
}

/**
 * The dragged session id, readable only on `drop`.
 *
 * Deliberately does not fall back to the id-carrying type name: that one is
 * lowercased by the browser, and a case-folded id resolves to no session at all
 * — a silent no-op is worse than a drop that never had a payload to begin with.
 */
export function readSessionMentionDragSessionId(
  dataTransfer: Pick<DataTransfer, 'getData'>
): string | null {
  return dataTransfer.getData(SESSION_MENTION_DRAG_TYPE) || null;
}
