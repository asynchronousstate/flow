import { v4 as uuid } from 'uuid'

import type { Annotation } from './annotation'
import { db } from './db'

export type AnnotationDraft = Pick<
  Annotation,
  'cfi' | 'spine' | 'type' | 'color' | 'text' | 'notes'
>

async function changeAnnotations<T>(
  bookId: string,
  change: (annotations: Annotation[], now: number) => T,
) {
  const database = db
  if (!database)
    throw new Error('Open the book in your browser to annotate it.')
  return database.transaction('rw', database.books, async () => {
    const book = await database.books.get(bookId)
    if (!book) throw new Error('This book is no longer in your library.')
    const annotations = [...book.annotations]
    const now = Math.max(Date.now(), (book.updatedAt ?? 0) + 1)
    const result = change(annotations, now)
    await database.books.update(bookId, { annotations, updatedAt: now })
    return result
  })
}

/** Read and update the latest array inside one transaction for both reader views. */
export function saveBookAnnotation(
  bookId: string,
  draft: AnnotationDraft,
  annotationId?: string,
) {
  return changeAnnotations(bookId, (annotations, now) => {
    const index = annotations.findIndex((item) =>
      annotationId ? item.id === annotationId : item.cfi === draft.cfi,
    )
    const existing = annotations[index]
    if (annotationId && !existing)
      throw new Error('This annotation was removed. Select the passage again.')
    const annotation: Annotation = {
      ...draft,
      id: existing?.id ?? uuid(),
      bookId,
      createAt: existing?.createAt ?? now,
      updatedAt: now,
      notes: draft.notes ?? existing?.notes,
    }
    if (index < 0) annotations.push(annotation)
    else annotations[index] = annotation
    return annotation
  })
}

export function deleteBookAnnotation(
  bookId: string,
  locator: { id: string } | { cfi: string },
) {
  return changeAnnotations(bookId, (annotations) => {
    const index = annotations.findIndex((item) =>
      'id' in locator ? item.id === locator.id : item.cfi === locator.cfi,
    )
    if (index >= 0) annotations.splice(index, 1)
  })
}
