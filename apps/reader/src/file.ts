import { v4 as uuidv4 } from 'uuid'

import ePub, { Book } from '@flow/epubjs'

import {
  PreparedLibraryBackup,
  readLegacyLibraryBackup,
  readLibraryBackup,
} from './data-safety'
import { BookRecord, db } from './db'
import { libraryImportKind } from './library/presentation'

export const BACKUP_REVIEW_EVENT = 'flow:review-library-backup'

export async function fileToEpub(file: File) {
  const data = await file.arrayBuffer()
  return ePub(data)
}

function libraryDatabase() {
  if (!db) throw new Error('Open Flow in your browser to import a book.')
  return db
}

/** ZIP entry points request the same explicit merge review as library import.
 * Neither a reader drop nor an OS file launch may silently restore a backup.
 */
export function requestLibraryBackupReview(backup: PreparedLibraryBackup) {
  const event = new CustomEvent<PreparedLibraryBackup>(BACKUP_REVIEW_EVENT, {
    detail: backup,
    cancelable: true,
  })
  if (typeof window === 'undefined' || window.dispatchEvent(event))
    throw new Error(
      'Open the Flow library and import this backup to review its contents first.',
    )
}

export async function handleFiles(files: Iterable<File>) {
  const imported: BookRecord[] = []
  for (const file of files) {
    const kind = libraryImportKind(file)
    if (kind === 'backup') {
      const backup =
        (await readLibraryBackup(file)) || (await readLegacyLibraryBackup(file))
      if (!backup)
        throw new Error('This ZIP is not a supported Flow library backup.')
      requestLibraryBackupReview(backup)
      continue
    }
    if (kind !== 'epub')
      throw new Error('Choose an EPUB file or a Flow backup ZIP.')
    imported.push(await addBook(file))
  }
  return imported
}

async function prepareImportedFile(file: File, supplied?: Book) {
  const epub = supplied || (await fileToEpub(file))
  try {
    // Invalid ZIP/container input can reject opened before metadata resolves.
    // Promise.all observes each possible failure without leaving rejections.
    const [, , metadata] = await Promise.all([
      epub.opened,
      epub.ready,
      epub.loaded.metadata,
    ])
    let cover: string | null = null
    try {
      const url = await epub.coverUrl()
      if (url) cover = await toDataUrl(url)
    } catch {
      // A missing optional image must not prevent a valid EPUB from importing.
    }
    return { metadata, cover }
  } finally {
    if (!supplied) {
      try {
        epub.destroy()
      } catch {
        /* Opening may have failed partway through. */
      }
    }
  }
}

function sameBookIdentity(current: BookRecord, expected: BookRecord) {
  return (
    current.id === expected.id &&
    current.name === expected.name &&
    current.createdAt === expected.createdAt
  )
}

async function attachMissingFile(
  expected: BookRecord,
  file: File,
  cover: string | null,
) {
  const database = libraryDatabase()
  return database.transaction(
    'rw',
    database.books,
    database.files,
    database.covers,
    async () => {
      const current = await database.books.get(expected.id)
      if (!current || !sameBookIdentity(current, expected))
        throw new Error(
          'This book was removed or replaced while importing. Choose it again from the library.',
        )
      // A concurrent importer may have won during parsing. Its current copy wins.
      if (await database.files.get(current.id)) return current
      await database.files.add({ id: current.id, file })
      if (!(await database.covers.get(current.id)))
        await database.covers.add({ id: current.id, cover })
      return current
    },
  )
}

/** Recover metadata-only books without replacing identity or saved state.
 * Commit new metadata and its validated EPUB atomically, after cover preparation.
 */
export async function addBook(file: File): Promise<BookRecord> {
  const database = libraryDatabase()
  const existing = file.name
    ? (await database.books.toArray()).find((book) => book.name === file.name)
    : undefined
  if (existing && (await database.files.get(existing.id))) return existing
  const { metadata, cover } = await prepareImportedFile(file)
  if (existing) return attachMissingFile(existing, file, cover)
  const book: BookRecord = {
    id: uuidv4(),
    name: file.name || `${metadata.title || 'Untitled book'}.epub`,
    size: file.size,
    metadata,
    createdAt: Date.now(),
    definitions: [],
    annotations: [],
  }
  return database.transaction(
    'rw',
    database.books,
    database.files,
    database.covers,
    async () => {
      const current = (await database.books.toArray()).find(
        (candidate) => candidate.name === book.name,
      )
      if (current) {
        if (!(await database.files.get(current.id))) {
          await database.files.add({ id: current.id, file })
          if (!(await database.covers.get(current.id)))
            await database.covers.add({ id: current.id, cover })
        }
        return current
      }
      await database.books.add(book)
      await database.files.add({ id: book.id, file })
      await database.covers.add({ id: book.id, cover })
      return book
    },
  )
}

/** Dropbox and local recovery use fill-only semantics; an existing file wins. */
export async function addFile(id: string, file: File, epub?: Book) {
  const database = libraryDatabase()
  const expected = await database.books.get(id)
  if (!expected)
    throw new Error('This book was removed before its file was downloaded.')
  if (await database.files.get(id)) return
  const { cover } = await prepareImportedFile(file, epub)
  await attachMissingFile(expected, file, cover)
}

export function readBlob(fn: (reader: FileReader) => void) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener('load', () => {
      resolve(reader.result as string)
    })
    reader.addEventListener('error', () =>
      reject(new Error('This file could not be read. Choose it again.')),
    )
    reader.addEventListener('abort', () =>
      reject(new Error('File reading was canceled.')),
    )
    fn(reader)
  })
}

async function toDataUrl(url: string) {
  const res = await fetch(url)
  if (!res.ok) throw new Error('The cover image could not be read.')
  const buffer = await res.blob()
  return readBlob((r) => r.readAsDataURL(buffer))
}

export async function fetchBook(url: string): Promise<BookRecord> {
  const database = libraryDatabase()
  const filename = decodeURIComponent(
    /\/([^/?#]*\.epub)(?:[?#].*)?$/i.exec(url)?.[1] ?? '',
  )
  const existing = filename
    ? (await database.books.toArray()).find((book) => book.name === filename)
    : undefined
  if (existing && (await database.files.get(existing.id))) return existing
  const response = await fetch(url)
  if (!response.ok)
    throw new Error(
      `The EPUB download failed (${response.status}). Try the link again or import the file.`,
    )
  const file = new File([await response.blob()], filename, {
    type: 'application/epub+zip',
  })
  if (existing) {
    const { cover } = await prepareImportedFile(file)
    return attachMissingFile(existing, file, cover)
  }
  return addBook(file)
}
