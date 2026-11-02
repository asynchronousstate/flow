import type { BookRecord } from '../db'
import type { IntegratedListeningRecord } from '../listening/integrated'

function text(value: unknown) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
}

/** Android document providers may report EPUBs as generic ZIPs or no MIME.
 * Extension chooses the parser; the EPUB parser still validates the bytes.
 */
export function libraryImportKind(file: { name: string; type: string }) {
  const name = file.name.toLowerCase()
  const type = file.type.toLowerCase()
  if (/\.epub$/.test(name)) return 'epub'
  if (/\.zip$/.test(name)) return 'backup'
  if (['application/epub+zip', 'application/epub'].includes(type)) return 'epub'
  if (['application/zip', 'application/x-zip-compressed'].includes(type))
    return 'backup'
  return 'unsupported'
}

export function libraryBookDetails(
  book: Pick<BookRecord, 'name'> & {
    metadata?: Partial<BookRecord['metadata']>
  },
) {
  return {
    title: text(book.metadata?.title) || text(book.name) || 'Untitled book',
    author: text(book.metadata?.creator),
    filename: text(book.name),
  }
}

export function readingResumeSummary(
  book: Pick<BookRecord, 'cfi' | 'percentage'>,
) {
  const percentage =
    typeof book.percentage === 'number' && Number.isFinite(book.percentage)
      ? Math.max(0, Math.min(100, Math.round(book.percentage * 100)))
      : undefined
  return percentage !== undefined
    ? `${percentage}%`
    : book.cfi
    ? 'Saved reading position'
    : 'Not started'
}

/** Presentation only. Library views must not parse EPUBs or modify plans.
 * Opening Listen validates the saved locator against the actual EPUB bytes.
 */
export function listeningResumeSummary(
  bookId: string,
  record?: IntegratedListeningRecord,
) {
  if (!record || record.bookId !== bookId)
    return { label: 'Not set yet', excerpt: '', bookmark: false }
  if (!record.marker)
    return { label: 'Chapter beginning', excerpt: '', bookmark: false }
  const marker = record.marker as IntegratedListeningRecord['marker'] & {
    chapterTitle?: string
  }
  const excerpt = text(marker?.text)
  if (!excerpt || !marker?.sourceHref || !marker.blockId)
    return { label: 'Bookmark needs review', excerpt: '', bookmark: false }
  return {
    label: text(marker.chapterTitle) || 'Saved Bookmark',
    excerpt:
      excerpt.length > 140 ? `${excerpt.slice(0, 137).trimEnd()}…` : excerpt,
    // Fresh setup defaults to any valid saved Bookmark, even if the previous
    // workflow explicitly used Chapter beginning. Do not rewrite that choice.
    bookmark: true,
  }
}
