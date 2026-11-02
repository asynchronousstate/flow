import { saveAs } from 'file-saver'
import JSZip from 'jszip'

import { BookRecord, CoverRecord, db } from './db'
import type {
  IntegratedListeningRecord,
  QuietLaunchRecord,
} from './listening/integrated'

export const BACKUP_MANIFEST = 'flow-listening-backup.json'
const BACKUP_FORMAT = 'flow-listening-library'
const BACKUP_VERSION = 1

interface BackupFile {
  id: string
  name: string
  type: string
  lastModified: number
  path: string
}

interface BackupManifest {
  format: typeof BACKUP_FORMAT
  version: number
  databaseVersion: number
  createdAt: string
  books: BookRecord[]
  covers: CoverRecord[]
  listening: IntegratedListeningRecord[]
  listeningSessions: QuietLaunchRecord[]
  files: BackupFile[]
}

export interface PreparedLibraryBackup {
  summary: { books: number; files: number; bookmarks: number }
  manifest: BackupManifest
  files: { id: string; file: File }[]
}

function libraryDatabase() {
  if (!db || db.name !== 're-reader')
    throw new Error('Open Flow in your browser to manage this library.')
  return db
}

function filePath(id: string) {
  return `files/${encodeURIComponent(id)}.epub`
}

/** Capture all library stores together, including saved starts and launch plans.
 * Files use book IDs rather than filenames, so same-named EPUBs do not collide.
 * Global browser preferences, cookies and authorization tokens are not exported.
 */
export async function createLibraryBackup(): Promise<Blob> {
  const database = libraryDatabase()
  const snapshot = await database.transaction(
    'r',
    database.books,
    database.files,
    database.covers,
    database.listening,
    database.listeningSessions,
    async () => ({
      books: await database.books.toArray(),
      files: await database.files.toArray(),
      covers: await database.covers.toArray(),
      listening: await database.listening.toArray(),
      listeningSessions: await database.listeningSessions.toArray(),
    }),
  )
  const ids = new Set(snapshot.books.map((book) => book.id))
  const zip = new JSZip()
  const files: BackupFile[] = []
  for (const { id, file } of snapshot.files) {
    if (!ids.has(id)) continue
    const path = filePath(id)
    zip.file(path, await file.arrayBuffer())
    files.push({
      id,
      path,
      name: file.name,
      type: file.type,
      lastModified: file.lastModified,
    })
  }
  const manifest: BackupManifest = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    databaseVersion: database.verno,
    createdAt: new Date().toISOString(),
    books: snapshot.books,
    files,
    covers: snapshot.covers.filter((record) => ids.has(record.id)),
    listening: snapshot.listening.filter((record) => ids.has(record.bookId)),
    listeningSessions: snapshot.listeningSessions.filter((record) =>
      ids.has(record.bookId),
    ),
  }
  zip.file(BACKUP_MANIFEST, JSON.stringify(manifest))
  return zip.generateAsync({ type: 'blob' })
}

export async function exportLibraryBackup() {
  const archive = await createLibraryBackup()
  const date = new Date().toISOString().slice(0, 10)
  saveAs(archive, `flow-listening-backup-${date}.zip`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256
}

function validateManifest(value: unknown): asserts value is BackupManifest {
  const unavailable = () => {
    throw new Error(
      'This Flow backup is incomplete or has an unsupported format.',
    )
  }
  if (!isRecord(value)) return unavailable()
  if (
    value.format !== BACKUP_FORMAT ||
    value.version !== BACKUP_VERSION ||
    typeof value.databaseVersion !== 'number' ||
    !Number.isFinite(value.databaseVersion) ||
    value.databaseVersion < 1 ||
    value.databaseVersion > (db?.verno ?? 7) ||
    !Array.isArray(value.books) ||
    !Array.isArray(value.files) ||
    !Array.isArray(value.covers) ||
    !Array.isArray(value.listening) ||
    !Array.isArray(value.listeningSessions)
  )
    return unavailable()
  const ids = new Set<string>()
  for (const book of value.books) {
    if (
      !isRecord(book) ||
      !isId(book.id) ||
      ids.has(book.id) ||
      typeof book.name !== 'string' ||
      !isRecord(book.metadata) ||
      !Array.isArray(book.annotations) ||
      !Array.isArray(book.definitions)
    )
      return unavailable()
    ids.add(book.id)
  }
  const fileIds = new Set<string>()
  for (const file of value.files) {
    if (
      !isRecord(file) ||
      !isId(file.id) ||
      !ids.has(file.id) ||
      fileIds.has(file.id) ||
      file.path !== filePath(file.id) ||
      typeof file.name !== 'string' ||
      typeof file.type !== 'string' ||
      typeof file.lastModified !== 'number'
    )
      return unavailable()
    fileIds.add(file.id)
  }
  const coverIds = new Set<string>()
  for (const cover of value.covers) {
    if (
      !isRecord(cover) ||
      !isId(cover.id) ||
      !ids.has(cover.id) ||
      coverIds.has(cover.id) ||
      (cover.cover !== null &&
        (typeof cover.cover !== 'string' ||
          (cover.cover !== '' &&
            !/^data:(?:image\/[\w.+-]+|application\/octet-stream)(?:;[^,]*)?,/i.test(
              cover.cover,
            ))))
    )
      return unavailable()
    coverIds.add(cover.id)
  }
  const validPlan = (plan: unknown, bookId: string) =>
    isRecord(plan) &&
    plan.bookId === bookId &&
    typeof plan.fingerprint === 'string' &&
    /^[a-f\d]{64}$/.test(plan.fingerprint) &&
    typeof plan.from === 'string' &&
    typeof plan.through === 'string' &&
    (plan.startAt === 'chapter' || plan.startAt === 'marker') &&
    typeof plan.updatedAt === 'number' &&
    (!plan.marker ||
      (isRecord(plan.marker) &&
        typeof plan.marker.sourceHref === 'string' &&
        typeof plan.marker.blockId === 'string' &&
        typeof plan.marker.text === 'string' &&
        typeof plan.marker.savedAt === 'number'))
  const listeningIds = new Set<string>()
  for (const plan of value.listening) {
    if (
      !isRecord(plan) ||
      !isId(plan.bookId) ||
      !ids.has(plan.bookId) ||
      listeningIds.has(plan.bookId) ||
      !validPlan(plan, plan.bookId)
    )
      return unavailable()
    listeningIds.add(plan.bookId)
  }
  const launchIds = new Set<string>()
  for (const launch of value.listeningSessions) {
    if (
      !isRecord(launch) ||
      !isId(launch.id) ||
      launchIds.has(launch.id) ||
      !isId(launch.bookId) ||
      !ids.has(launch.bookId) ||
      typeof launch.createdAt !== 'number' ||
      !validPlan(launch.plan, launch.bookId) ||
      !isRecord(launch.plan) ||
      launch.fingerprint !== launch.plan.fingerprint
    )
      return unavailable()
    launchIds.add(launch.id)
  }
}

/** null identifies a legacy Flow ZIP, which the existing importer still handles.
 * No writes happen while inspecting or validating a backup.
 */
export async function readLibraryBackup(
  file: Blob,
): Promise<PreparedLibraryBackup | null> {
  let archive: JSZip
  try {
    archive = await JSZip.loadAsync(await file.arrayBuffer())
  } catch {
    throw new Error(
      'This ZIP could not be opened. Choose a complete Flow backup.',
    )
  }
  const entry = archive.file(BACKUP_MANIFEST)
  if (!entry) return null
  let manifest: unknown
  try {
    manifest = JSON.parse(await entry.async('text'))
  } catch {
    throw new Error('This Flow backup has an unreadable manifest.')
  }
  validateManifest(manifest)
  const files = []
  for (const record of manifest.files) {
    const content = archive.file(record.path)
    if (!content)
      throw new Error(`The backup is missing the EPUB file for ${record.name}.`)
    files.push({
      id: record.id,
      file: new File([await content.async('arraybuffer')], record.name, {
        type: record.type,
        lastModified: record.lastModified,
      }),
    })
  }
  return {
    manifest,
    files,
    summary: {
      books: manifest.books.length,
      files: files.length,
      bookmarks: manifest.listening.filter((record) => !!record.marker).length,
    },
  }
}

/** Upgrade the original Flow ZIP in memory, then use the same reviewed merge.
 * Legacy archives never contained listening plans; do not invent those starts.
 */
export async function readLegacyLibraryBackup(
  file: Blob,
): Promise<PreparedLibraryBackup | null> {
  const archive = await JSZip.loadAsync(await file.arrayBuffer())
  const dataEntry = archive.file('data.json')
  const coversEntry = archive.file('covers.json')
  if (!dataEntry || !coversEntry) return null
  let data: unknown
  let covers: unknown
  try {
    data = JSON.parse(await dataEntry.async('text'))
    covers = JSON.parse(await coversEntry.async('text'))
  } catch {
    throw new Error('This older Flow backup has unreadable library data.')
  }
  if (
    !isRecord(data) ||
    data.version !== 1 ||
    !Array.isArray(data.books) ||
    !Array.isArray(covers)
  )
    throw new Error('This older Flow backup has an unsupported format.')
  const ids = new Set(data.books.filter(isRecord).map((book) => book.id))
  const manifest: BackupManifest = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    databaseVersion: data.dbVersion as number,
    createdAt: new Date().toISOString(),
    books: data.books as BookRecord[],
    covers: covers.filter(
      (cover) => isRecord(cover) && ids.has(cover.id),
    ) as CoverRecord[],
    listening: [],
    listeningSessions: [],
    files: [],
  }
  validateManifest(manifest)
  const usedPaths = new Set<string>()
  const files: PreparedLibraryBackup['files'] = []
  for (const book of manifest.books) {
    const path = `files/${book.name}`
    const content = archive.file(path)
    if (!content) continue // Older exports could include metadata-only synced books.
    if (usedPaths.has(path))
      throw new Error(
        'This older backup contains repeated EPUB filenames. Their files cannot be safely distinguished.',
      )
    usedPaths.add(path)
    const record: BackupFile = {
      id: book.id,
      name: book.name,
      type: 'application/epub+zip',
      lastModified: 0,
      path: filePath(book.id),
    }
    manifest.files.push(record)
    files.push({
      id: book.id,
      file: new File([await content.async('arraybuffer')], record.name, {
        type: record.type,
        lastModified: record.lastModified,
      }),
    })
  }
  validateManifest(manifest)
  return {
    manifest,
    files,
    summary: {
      books: manifest.books.length,
      files: files.length,
      bookmarks: 0,
    },
  }
}

/** Merge missing book IDs only. Existing books, including newer range / Bookmark
 * changes in another tab, are checked inside the same write transaction and kept.
 */
export async function restoreLibraryBackup(backup: PreparedLibraryBackup) {
  const database = libraryDatabase()
  validateManifest(backup.manifest)
  const expectedFiles = new Map(
    backup.manifest.files.map((record) => [record.id, record]),
  )
  if (backup.files.length !== expectedFiles.size)
    throw new Error(
      'This prepared backup is missing EPUB files. Choose the ZIP again.',
    )
  for (const { id, file } of backup.files) {
    const expected = expectedFiles.get(id)
    if (
      !expected ||
      !(file instanceof File) ||
      file.name !== expected.name ||
      file.type !== expected.type ||
      file.lastModified !== expected.lastModified
    )
      throw new Error('This prepared backup has changed. Choose the ZIP again.')
    expectedFiles.delete(id)
  }
  return database.transaction(
    'rw',
    database.books,
    database.files,
    database.covers,
    database.listening,
    database.listeningSessions,
    async () => {
      const existing = new Set(
        (await database.books.toArray()).map((book) => book.id),
      )
      const adding = new Set(
        backup.manifest.books
          .filter((book) => !existing.has(book.id))
          .map((book) => book.id),
      )
      // A launch ID can already belong to an unrelated book. Never overwrite it.
      const sessions = []
      for (const launch of backup.manifest.listeningSessions) {
        if (
          adding.has(launch.bookId) &&
          !(await database.listeningSessions.get(launch.id))
        )
          sessions.push(launch)
      }
      await database.books.bulkPut(
        backup.manifest.books.filter((book) => adding.has(book.id)),
      )
      await database.files.bulkPut(
        backup.files.filter((file) => adding.has(file.id)),
      )
      await database.covers.bulkPut(
        backup.manifest.covers.filter((cover) => adding.has(cover.id)),
      )
      await database.listening.bulkPut(
        backup.manifest.listening.filter((plan) => adding.has(plan.bookId)),
      )
      await database.listeningSessions.bulkPut(sessions)
      return {
        restored: adding.size,
        skipped: backup.manifest.books.length - adding.size,
      }
    },
  )
}

const ASSET_CACHES = new Set([
  'static-js-assets',
  'static-style-assets',
  'static-image-assets',
  'next-image',
])

/** Remove only recognized Flow app assets. Never touch IndexedDB, localStorage,
 * cookies, EPUB downloads, API caches, unknown cache names or foreign origins.
 */
export async function clearTemporaryFlowCache(
  storage: CacheStorage | undefined = typeof caches === 'undefined'
    ? undefined
    : caches,
  origin = typeof location === 'undefined' ? '' : location.origin,
) {
  if (!storage) return 0
  let removed = 0
  for (const name of await storage.keys()) {
    if (!ASSET_CACHES.has(name) && name !== `workbox-precache-v2-${origin}/`)
      continue
    const cache = await storage.open(name)
    for (const request of await cache.keys()) {
      const url = new URL(request.url)
      const appAsset =
        url.pathname.startsWith('/_next/static/') ||
        url.pathname.startsWith('/icons/') ||
        ['/manifest.json', '/favicon.ico'].includes(url.pathname)
      if (url.origin === origin && appAsset && (await cache.delete(request)))
        removed++
    }
  }
  return removed
}

/** This explicit operation affects only Flow's library tables on this origin.
 * App preferences, other databases, cookies and remote Dropbox files are kept.
 */
export async function deleteLocalFlowLibrary(confirmation: string) {
  if (confirmation !== 'DELETE')
    throw new Error('Type DELETE to confirm removing this local library.')
  const database = libraryDatabase()
  await database.transaction(
    'rw',
    database.books,
    database.files,
    database.covers,
    database.listening,
    database.listeningSessions,
    async () => {
      await database.listeningSessions.clear()
      await database.listening.clear()
      await database.covers.clear()
      await database.files.clear()
      await database.books.clear()
    },
  )
}
