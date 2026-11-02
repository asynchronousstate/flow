import { db } from '../db'

import {
  normalizeListeningAppearance,
  resolveListeningAppearance,
  savedReaderAppearance,
} from './appearance'
import type {
  ListeningAppearance,
  ListeningAppearanceChoice,
} from './appearance'
import {
  compareListeningPoints,
  getListeningChapters,
  validateListeningRange as validateChapterRange,
} from './chapters'
import { buildQuietSession } from './document'
import { ListeningBook, prepareListeningBook } from './epub'
import type {
  ListeningPreparationOptions,
  ListeningPreparationProgress,
} from './epub'

export interface ListeningMarker {
  sourceHref: string
  blockId: string
  text: string
  savedAt: number
  cfi?: string
  chapterTitle?: string
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
  appearance?: ListeningAppearanceChoice
}

export interface LoadedListeningBook {
  book: ListeningBook
  record: IntegratedListeningRecord
  appearance?: ListeningAppearance
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
  appearance?: ListeningAppearance
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

interface PreparedBook {
  promise: Promise<ListeningBook>
  progress: ListeningPreparationProgress
  listeners: Set<NonNullable<ListeningPreparationOptions['onProgress']>>
}
const parsedBooks = new Map<string, PreparedBook>()

/** An explicit Retry starts a new parse; existing consumers keep their own attempt. */
export function retryListeningPreparation(bookId: string) {
  for (const key of parsedBooks.keys()) {
    if (key.startsWith(bookId + ':')) parsedBooks.delete(key)
  }
}

function checkCanceled(signal?: AbortSignal) {
  if (!signal?.aborted) return
  const error = new Error('Preparation canceled.')
  error.name = 'AbortError'
  throw error
}

/** Cancel a consumer without canceling a parse another tab/component still needs. */
async function waitForPreparation<T>(
  pending: Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  checkCanceled(signal)
  if (!signal) return pending
  return new Promise<T>((resolve, reject) => {
    const aborted = () => {
      const error = new Error('Preparation canceled.')
      error.name = 'AbortError'
      reject(error)
    }
    signal.addEventListener('abort', aborted, { once: true })
    pending
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', aborted))
  })
}

export class ListeningBookChangedError extends Error {
  readonly code = 'BOOK_CHANGED'
  constructor() {
    super(
      'This EPUB has changed. Reset its listening setup and choose a new range and bookmark.',
    )
    this.name = 'ListeningBookChangedError'
  }
}

async function readCanonicalBook(
  bookId: string,
  options: ListeningPreparationOptions = {},
) {
  const started = Date.now()
  checkCanceled(options.signal)
  options.onProgress?.({ stage: 'reading' })
  if (!db) throw new Error('Open Flow in your browser to use listening.')
  const stored = await db.files.get(bookId)
  const metadata = await db.books.get(bookId)
  if (!stored || !metadata)
    throw new Error(
      'This book is not available in this browser’s Flow library. Return to the library and import or download it first.',
    )
  const data = await stored.file.arrayBuffer()
  checkCanceled(options.signal)
  options.onProgress?.({ stage: 'checking' })
  if (!globalThis.crypto?.subtle)
    throw new Error('Open Flow using HTTPS or localhost to prepare this book.')
  const digest = await crypto.subtle.digest('SHA-256', data)
  const fingerprint = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
  const key = bookId + ':' + fingerprint
  let pending = parsedBooks.get(key)
  const reused = !!pending
  if (!pending) {
    const listeners: PreparedBook['listeners'] = new Set()
    const preparation: PreparedBook = {
      promise: Promise.resolve(undefined as unknown as ListeningBook),
      progress: { stage: 'contents' },
      listeners,
    }
    preparation.promise = prepareListeningBook(data, {
      onProgress: (progress) => {
        preparation.progress = progress
        listeners.forEach((listener) => listener(progress))
      },
    })
    pending = preparation
    parsedBooks.set(key, pending)
    pending.promise.catch(() => {
      if (parsedBooks.get(key) === preparation) parsedBooks.delete(key)
    })
    if (parsedBooks.size > 3)
      parsedBooks.delete(parsedBooks.keys().next().value!)
  }
  if (options.onProgress) {
    pending.listeners.add(options.onProgress)
    options.onProgress(pending.progress)
  }
  try {
    const book = await waitForPreparation(pending.promise, options.signal)
    checkCanceled(options.signal)
    options.onProgress?.({ stage: 'ready' })
    // Local, non-content timing evidence for cold/warm preparation diagnostics.
    if (typeof console !== 'undefined')
      console.info(
        '[Flow listening] preparation',
        JSON.stringify({
          durationMs: Date.now() - started,
          reused,
        }),
      )
    return { book, fingerprint }
  } finally {
    if (options.onProgress) pending.listeners.delete(options.onProgress)
  }
}

function defaultRecord(
  bookId: string,
  fingerprint: string,
  book: ListeningBook,
): IntegratedListeningRecord {
  const chapters = getListeningChapters(book).filter(
    (chapter) => !chapter.disabled,
  )
  if (!chapters.length)
    throw new Error('This EPUB has no available chapters for listening.')
  const first = chapters.reduce((earliest, chapter) =>
    compareListeningPoints(chapter.start!, earliest.start!) < 0
      ? chapter
      : earliest,
  )
  const last = chapters.reduce((latest, chapter) =>
    compareListeningPoints(chapter.end!, latest.end!) >= 0 ? chapter : latest,
  )
  return {
    bookId,
    fingerprint,
    from: first.id,
    through: last.id,
    startAt: 'chapter',
    updatedAt: Date.now(),
  }
}

/** Listening stores locators only; EPUBs and ebook progress stay in Flow. */
export async function loadLibraryListeningBook(
  bookId: string,
  options: ListeningPreparationOptions = {},
): Promise<LoadedListeningBook> {
  const { book, fingerprint } = await readCanonicalBook(bookId, options)
  checkCanceled(options.signal)
  const record = await db!.transaction(
    'rw',
    db!.listening,
    db!.books,
    async () => {
      if (!(await db!.books.get(bookId)))
        throw new Error('This book was removed from your library.')
      checkCanceled(options.signal)
      const existing = await db!.listening.get(bookId)
      checkCanceled(options.signal)
      if (existing?.fingerprint === fingerprint) return existing
      if (existing) throw new ListeningBookChangedError()
      const next = defaultRecord(bookId, fingerprint, book)
      await db!.listening.put(next)
      checkCanceled(options.signal)
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
  const metadata = await db!.books.get(bookId)
  const reading = savedReaderAppearance()
  const appearance = resolveListeningAppearance(
    record.appearance,
    reading.settings,
    metadata?.configuration?.typography,
    reading.dark,
  )
  const id = crypto.randomUUID()
  const plan: IntegratedListeningRecord = {
    ...record,
    ...(record.appearance
      ? { appearance: normalizeListeningAppearance(record.appearance) }
      : {}),
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
      appearance,
    })
  })
  return id
}

export async function loadQuietLaunch(
  bookId: string,
  sessionId: string,
  options: ListeningPreparationOptions = {},
): Promise<LoadedListeningBook> {
  const { book, fingerprint } = await readCanonicalBook(bookId, options)
  checkCanceled(options.signal)
  const launch = await db!.listeningSessions.get(sessionId)
  if (!launch || launch.bookId !== bookId)
    throw new ListeningSessionUnavailableError()
  if (launch.fingerprint !== fingerprint) throw new ListeningBookChangedError()
  return { book, record: launch.plan, appearance: launch.appearance }
}

function copyListeningRecord(
  record: IntegratedListeningRecord,
): IntegratedListeningRecord {
  return {
    ...record,
    ...(record.appearance ? { appearance: { ...record.appearance } } : {}),
    marker: record.marker ? { ...record.marker } : undefined,
  }
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
  if (JSON.stringify(left.appearance) !== JSON.stringify(right.appearance))
    return false
  if (!left.marker || !right.marker) return left.marker === right.marker
  const markerKeys = [
    'sourceHref',
    'blockId',
    'text',
    'savedAt',
    'cfi',
    'chapterTitle',
  ] as const
  return markerKeys.every((key) => left.marker![key] === right.marker![key])
}

function validateListeningRange(
  book: ListeningBook,
  record: IntegratedListeningRecord,
) {
  const problem = validateChapterRange(book, record)
  if (problem) throw new Error(problem)
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
    ...(changes.appearance
      ? { appearance: normalizeListeningAppearance(changes.appearance) }
      : {}),
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
