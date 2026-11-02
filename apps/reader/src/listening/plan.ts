import type { ListeningChapter } from './chapters'
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
  {
    preserveStartChoice = false,
    bookmarkAvailable = !!stored.marker,
  }: { preserveStartChoice?: boolean; bookmarkAvailable?: boolean } = {},
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
      startAt: !bookmarkAvailable
        ? 'chapter'
        : preserveStartChoice
        ? draft.startAt
        : stored.startAt,
    },
    applied: next,
    changed: true,
  }
}

/** A real entry defaults to a valid saved Bookmark, without persisting a plan
 * change. Renders and returns from the current preview keep the local choice.
 */
export function defaultListeningStart(
  draft: IntegratedListeningRecord,
  bookmarkAvailable: boolean,
  freshOpening: boolean,
): IntegratedListeningRecord {
  const startAt = !bookmarkAvailable
    ? 'chapter'
    : freshOpening
    ? 'marker'
    : draft.startAt
  return startAt === draft.startAt ? draft : { ...draft, startAt }
}

/** Show an existing TOC option for an equivalent legacy range, while retaining
 * the original persisted reference. Partial-file chapters are never equivalent
 * to a whole-file endpoint merely because they share a source path or label.
 */
export function displayListeningChapterReference(
  reference: string,
  resolved: Pick<ListeningChapter, 'start' | 'end'>,
  chapters: Pick<ListeningChapter, 'id' | 'disabled' | 'start' | 'end'>[],
) {
  if (chapters.some((chapter) => chapter.id === reference)) return reference
  const start = resolved.start
  const end = resolved.end
  if (!start || !end) return reference
  const equivalent = chapters.find(
    (chapter) =>
      !chapter.disabled &&
      chapter.start?.sectionIndex === start.sectionIndex &&
      chapter.start?.offset === start.offset &&
      chapter.end?.sectionIndex === end.sectionIndex &&
      chapter.end?.offset === end.offset,
  )
  return equivalent?.id || reference
}
