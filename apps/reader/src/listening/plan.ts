import type { IntegratedListeningRecord } from './integrated'

export interface AppliedListeningPlan {
  updatedAt: number
  startSignature: string
}

/** Saved-at identifies the user's bookmark, not the ordering of plan writes.
 * Undo can restore an older bookmark, or remove it entirely, in a newer plan.
 */
export function captureListeningPlan(
  record: IntegratedListeningRecord,
): AppliedListeningPlan {
  const marker = record.marker
  return {
    updatedAt: record.updatedAt,
    startSignature: JSON.stringify([
      record.startAt,
      marker
        ? [
            marker.sourceHref,
            marker.blockId,
            marker.text,
            marker.savedAt,
            marker.cfi,
          ]
        : null,
    ]),
  }
}

/** Merge an explicit start change from another window without discarding local
 * chapter-range edits. Unrelated plan writes must also preserve an unsaved
 * local Chapter beginning / Bookmark radio choice.
 */
export function reconcileListeningPlan(
  draft: IntegratedListeningRecord,
  stored: IntegratedListeningRecord,
  applied?: AppliedListeningPlan,
) {
  if (
    stored.bookId !== draft.bookId ||
    stored.fingerprint !== draft.fingerprint ||
    (applied && stored.updatedAt <= applied.updatedAt)
  )
    return { draft, applied, changed: false }

  const next = captureListeningPlan(stored)
  if (applied?.startSignature === next.startSignature)
    return { draft, applied: next, changed: false }

  return {
    draft: {
      ...draft,
      marker: stored.marker ? { ...stored.marker } : undefined,
      startAt: stored.startAt,
    },
    applied: next,
    changed: true,
  }
}
