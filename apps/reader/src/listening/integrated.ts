import { db } from '../db'

import { buildQuietSession } from './document'
import { ListeningBook, prepareListeningBook } from './epub'

export interface ListeningMarker {
  sourceHref: string
  blockId: string
  text: string
  savedAt: number
  cfi?: string
}

export interface IntegratedListeningRecord {
  bookId: string
  fingerprint: string
  from: string
  through: string
  startAt: 'chapter' | 'marker'
  marker?: ListeningMarker
  returnCfi?: string
  updatedAt: number
}

export interface LoadedListeningBook {
  book: ListeningBook
  record: IntegratedListeningRecord
}

export interface LibraryBookmarkChange {
  record: IntegratedListeningRecord
  previous: IntegratedListeningRecord
}

export interface QuietLaunchRecord {
  id: string
  bookId: string
  fingerprint: string
  plan: IntegratedListeningRecord
  createdAt: number
}

export class ListeningSessionUnavailableError extends Error {
  readonly code = 'SESSION_UNAVAILABLE'
  constructor() {
    super(
      'This prepared session is no longer available. Choose a range in the book’s listening setup again.',
    )
    this.name = 'ListeningSessionUnavailableError'
  }
}

const parsedBooks = new Map<string, Promise<ListeningBook>>()

export class ListeningBookChangedError extends Error {
  readonly code = 'BOOK_CHANGED'
  constructor() {
    super(
      'This EPUB has changed. Reset its listening setup and choose a new range and bookmark.',
    )
    this.name = 'ListeningBookChangedError'
  }
}

async function readCanonicalBook(bookId: string) {
  if (!db) throw new Error('Open Flow in your browser to use listening.')
  const stored = await db.files.get(bookId)
  const metadata = await db.books.get(bookId)
  if (!stored || !metadata)
    throw new Error(
      'This book is not available in this browser’s Flow library. Return to the library and import or download it first.',
    )
  const data = await stored.file.arrayBuffer()
  if (!globalThis.crypto?.subtle)
    throw new Error('Open Flow using HTTPS or localhost to prepare this book.')
  const digest = await crypto.subtle.digest('SHA-256', data)
  const fingerprint = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
  const key = bookId + ':' + fingerprint
  let pending = parsedBooks.get(key)
  if (!pending) {
    pending = prepareListeningBook(data)
    parsedBooks.set(key, pending)
    pending.catch(() => parsedBooks.delete(key))
    if (parsedBooks.size > 3)
      parsedBooks.delete(parsedBooks.keys().next().value!)
  }
  return { book: await pending, fingerprint }
}

function defaultRecord(
  bookId: string,
  fingerprint: string,
  book: ListeningBook,
): IntegratedListeningRecord {
  return {
    bookId,
    fingerprint,
    from: book.sections[0]!.sourceHref,
    through: book.sections[book.sections.length - 1]!.sourceHref,
    startAt: 'chapter',
    updatedAt: Date.now(),
  }
}

/** Listening stores locators only; EPUBs and ebook progress stay in Flow. */
export async function loadLibraryListeningBook(
  bookId: string,
): Promise<LoadedListeningBook> {
  const { book, fingerprint } = await readCanonicalBook(bookId)
  const record = await db!.transaction(
    'rw',
    db!.listening,
    db!.books,
    async () => {
      if (!(await db!.books.get(bookId)))
        throw new Error('This book was removed from your library.')
      const existing = await db!.listening.get(bookId)
      if (existing?.fingerprint === fingerprint) return existing
      if (existing) throw new ListeningBookChangedError()
      const next = defaultRecord(bookId, fingerprint, book)
      await db!.listening.put(next)
      return next
    },
  )
  return { book, record }
}

/** Explicit recovery for a user who has replaced the EPUB under this book ID. */
export async function resetLibraryListeningBook(
  bookId: string,
): Promise<LoadedListeningBook> {
  const { book, fingerprint } = await readCanonicalBook(bookId)
  const record = defaultRecord(bookId, fingerprint, book)
  await db!.transaction('rw', db!.books, db!.listening, async () => {
    if (!(await db!.books.get(bookId)))
      throw new Error('This book was removed from your library.')
    await db!.listening.put(record)
  })
  return { book, record }
}

/** Each opened document gets a metadata snapshot, unaffected by other tabs. */
export async function createQuietLaunch(
  bookId: string,
  record: IntegratedListeningRecord,
): Promise<string> {
  const { book, fingerprint } = await readCanonicalBook(bookId)
  if (record.bookId !== bookId || record.fingerprint !== fingerprint)
    throw new ListeningBookChangedError()
  buildQuietSession(book, record)
  const id = crypto.randomUUID()
  const plan: IntegratedListeningRecord = {
    ...record,
    marker: record.marker ? { ...record.marker } : undefined,
  }
  await db!.transaction('rw', db!.books, db!.listeningSessions, async () => {
    if (!(await db!.books.get(bookId)))
      throw new Error('This book was removed from your library.')
    await db!.listeningSessions.put({
      id,
      bookId,
      fingerprint,
      plan,
      createdAt: Date.now(),
    })
  })
  return id
}

export async function loadQuietLaunch(
  bookId: string,
  sessionId: string,
): Promise<LoadedListeningBook> {
  const { book, fingerprint } = await readCanonicalBook(bookId)
  const launch = await db!.listeningSessions.get(sessionId)
  if (!launch || launch.bookId !== bookId)
    throw new ListeningSessionUnavailableError()
  if (launch.fingerprint !== fingerprint) throw new ListeningBookChangedError()
  return { book, record: launch.plan }
}

function copyListeningRecord(
  record: IntegratedListeningRecord,
): IntegratedListeningRecord {
  return { ...record, marker: record.marker ? { ...record.marker } : undefined }
}

function sameListeningRecord(
  left: IntegratedListeningRecord,
  right: IntegratedListeningRecord,
) {
  const keys = [
    'bookId',
    'fingerprint',
    'from',
    'through',
    'startAt',
    'returnCfi',
    'updatedAt',
  ] as const
  if (!keys.every((key) => left[key] === right[key])) return false
  if (!left.marker || !right.marker) return left.marker === right.marker
  const markerKeys = [
    'sourceHref',
    'blockId',
    'text',
    'savedAt',
    'cfi',
  ] as const
  return markerKeys.every((key) => left.marker![key] === right.marker![key])
}

function validateListeningRange(
  book: ListeningBook,
  record: IntegratedListeningRecord,
) {
  if (
    !book.sections.some((section) => section.sourceHref === record.from) ||
    !book.sections.some((section) => section.sourceHref === record.through)
  )
    throw new Error('Choose chapters that are available in this book.')
}

async function changeListeningRecord(
  bookId: string,
  changes: Partial<
    Omit<IntegratedListeningRecord, 'bookId' | 'fingerprint' | 'updatedAt'>
  >,
  expectedFingerprint?: string,
): Promise<LibraryBookmarkChange> {
  const snapshot = {
    ...changes,
    ...(changes.marker ? { marker: { ...changes.marker } } : {}),
  }
  const loaded = await loadLibraryListeningBook(bookId)
  if (expectedFingerprint && expectedFingerprint !== loaded.record.fingerprint)
    throw new ListeningBookChangedError()
  return db!.transaction('rw', db!.listening, db!.books, async () => {
    if (!(await db!.books.get(bookId)))
      throw new Error('This book was removed from your library.')
    const current = await db!.listening.get(bookId)
    if (current?.fingerprint !== loaded.record.fingerprint)
      throw new Error('The book changed. Reopen listening setup before saving.')
    const next: IntegratedListeningRecord = {
      ...current,
      ...snapshot,
      bookId,
      fingerprint: loaded.record.fingerprint,
      // Strictly increasing revisions also distinguish writes in the same ms.
      updatedAt: Math.max(Date.now(), current.updatedAt + 1),
    }
    validateListeningRange(loaded.book, next)
    await db!.listening.put(next)
    return {
      record: copyListeningRecord(next),
      previous: copyListeningRecord(current),
    }
  })
}

export async function updateListeningRecord(
  bookId: string,
  changes: Partial<
    Omit<IntegratedListeningRecord, 'bookId' | 'fingerprint' | 'updatedAt'>
  >,
  expectedFingerprint?: string,
): Promise<IntegratedListeningRecord> {
  return (await changeListeningRecord(bookId, changes, expectedFingerprint))
    .record
}

export async function saveLibraryMarker(
  bookId: string,
  marker: ListeningMarker,
  expectedFingerprint?: string,
  nextRange?: { from: string; through: string },
): Promise<IntegratedListeningRecord> {
  return updateListeningRecord(
    bookId,
    { ...nextRange, marker, startAt: 'marker' },
    expectedFingerprint,
  )
}

/** Capture the previous plan in the same transaction as the bookmark save. */
export async function saveLibraryBookmark(
  bookId: string,
  marker: ListeningMarker,
  expectedFingerprint?: string,
  nextRange?: { from: string; through: string },
): Promise<LibraryBookmarkChange> {
  return changeListeningRecord(
    bookId,
    { ...nextRange, marker, startAt: 'marker' },
    expectedFingerprint,
  )
}

/** Undo only our own latest save; another tab's newer plan always wins. */
export async function undoLibraryBookmark(
  bookId: string,
  expected: IntegratedListeningRecord,
  previous: IntegratedListeningRecord,
): Promise<IntegratedListeningRecord> {
  const saved = copyListeningRecord(expected)
  const restore = copyListeningRecord(previous)
  if (
    saved.bookId !== bookId ||
    restore.bookId !== bookId ||
    saved.fingerprint !== restore.fingerprint
  )
    throw new ListeningBookChangedError()
  // Unlike loading setup, Undo must never recreate a missing listening plan.
  const loaded = await readCanonicalBook(bookId)
  if (saved.fingerprint !== loaded.fingerprint)
    throw new ListeningBookChangedError()
  return db!.transaction('rw', db!.listening, db!.books, async () => {
    if (!(await db!.books.get(bookId)))
      throw new Error('This book was removed from your library.')
    const current = await db!.listening.get(bookId)
    if (current && current.fingerprint !== loaded.fingerprint)
      throw new ListeningBookChangedError()
    if (!current || !sameListeningRecord(current, saved))
      throw new Error(
        'The bookmark changed in another window. Your newer listening setup was kept. Review it before bookmarking again.',
      )
    const next = {
      ...restore,
      updatedAt: Math.max(Date.now(), current.updatedAt + 1),
    }
    validateListeningRange(loaded.book, next)
    await db!.listening.put(next)
    return copyListeningRecord(next)
  })
}
