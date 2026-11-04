import { useBoolean } from '@literal-ui/hooks'
import clsx from 'clsx'
import { useLiveQuery } from 'dexie-react-hooks'
import Head from 'next/head'
import { useRouter } from 'next/router'
import React, { useEffect, useRef, useState } from 'react'
import FocusLock from 'react-focus-lock'
import {
  MdCheckBox,
  MdCheckBoxOutlineBlank,
  MdCheckCircle,
  MdOutlineFileDownload,
  MdOutlineShare,
  MdHeadset,
  MdMenuBook,
} from 'react-icons/md'
import { useSet } from 'react-use'
import { usePrevious } from 'react-use'

import { ReaderGridView, Button, TextField, DropZone } from '../components'
import {
  exportLibraryBackup,
  PreparedLibraryBackup,
  readLegacyLibraryBackup,
  readLibraryBackup,
  restoreLibraryBackup,
} from '../data-safety'
import { BookRecord, CoverRecord, db } from '../db'
import { addFile, BACKUP_REVIEW_EVENT, fetchBook, handleFiles } from '../file'
import {
  useLibrary,
  useMobile,
  useSetAction,
  useRemoteBooks,
  useRemoteFiles,
  useTranslation,
  restoreMobilePanelHistory,
} from '../hooks'
import {
  libraryBookDetails,
  libraryImportKind,
  listeningResumeSummary,
  readingResumeSummary,
} from '../library/presentation'
import {
  loadLibraryListeningBook,
  loadQuietLaunch,
} from '../listening/integrated'
import type { IntegratedListeningRecord } from '../listening/integrated'
import { BookTab, reader, useReaderSnapshot } from '../models'
import { dbx, uploadData } from '../sync'
import { copy } from '../utils'

const placeholder = `data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect fill="gray" fill-opacity="0" width="1" height="1"/></svg>`

const SOURCE = 'src'

export default function Index() {
  const { focusedTab } = useReaderSnapshot()
  const router = useRouter()
  const setAction = useSetAction()
  const openedBook = useRef<string>()
  const [openError, setOpenError] = useState('')
  const [backupReviews, setBackupReviews] = useState<PreparedLibraryBackup[]>(
    [],
  )
  const [backupReviewBusy, setBackupReviewBusy] = useState(false)
  const [backupReviewError, setBackupReviewError] = useState('')
  const src = new URL(window.location.href).searchParams.get(SOURCE)
  const [loading, setLoading] = useState(!!src)

  useEffect(() => {
    const reviewBackup = (event: Event) => {
      const backup = (event as CustomEvent<PreparedLibraryBackup>).detail
      if (!backup) return
      event.preventDefault()
      setBackupReviews((current) => [...current, backup])
      setBackupReviewError('')
    }
    window.addEventListener(BACKUP_REVIEW_EVENT, reviewBackup)
    return () => window.removeEventListener(BACKUP_REVIEW_EVENT, reviewBackup)
  }, [])

  async function restoreReviewedBackup() {
    if (!backupReviews[0] || backupReviewBusy) return
    setBackupReviewBusy(true)
    setBackupReviewError('')
    try {
      await restoreLibraryBackup(backupReviews[0])
      setBackupReviews((current) => current.slice(1))
    } catch (error) {
      setBackupReviewError(
        error instanceof Error
          ? error.message
          : 'This backup could not be restored.',
      )
    } finally {
      setBackupReviewBusy(false)
    }
  }

  useEffect(() => {
    const bookId = router.query.book
    if (!router.isReady || typeof bookId !== 'string') return
    const sessionId = router.query.session
    if (sessionId !== undefined && typeof sessionId !== 'string') {
      setOpenError('This listening session link is incomplete.')
      return
    }
    const requestKey = JSON.stringify([bookId, sessionId])
    if (openedBook.current === requestKey) {
      if (router.query.listening === '1') setAction('listening')
      return
    }
    let cancelled = false
    setLoading(true)
    setOpenError('')
    Promise.all([
      db?.books.get(bookId),
      (sessionId !== undefined
        ? loadQuietLaunch(bookId, sessionId)
        : loadLibraryListeningBook(bookId)
      ).catch((error: unknown) => {
        const code = (error as { code?: string })?.code
        if (code === 'BOOK_CHANGED' || code === 'SESSION_UNAVAILABLE')
          return undefined
        throw error
      }),
    ])
      .then(([book, listening]) => {
        if (cancelled) return
        if (!book)
          throw new Error('This book is no longer in your Flow library.')
        // Only restore a locator verified against the current EPUB bytes.
        // A changed book keeps its canonical reading position and opens recovery.
        const returnCfi = book.cfi ?? listening?.record.returnCfi
        const tab = reader.addTab({
          ...book,
          cfi: returnCfi ?? book.cfi,
        })
        if (tab instanceof BookTab && tab.rendered && returnCfi) {
          tab.display(returnCfi, false)
        }
        openedBook.current = requestKey
        if (!listening || router.query.listening === '1') setAction('listening')
      })
      .catch((error) => {
        if (!cancelled)
          setOpenError(
            error instanceof Error ? error.message : 'Could not open book.',
          )
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [
    router.isReady,
    router.query.book,
    router.query.listening,
    router.query.session,
    setAction,
  ])

  useEffect(() => {
    let src = router.query[SOURCE]
    if (!src) return
    if (!Array.isArray(src)) src = [src]

    Promise.all(
      src.map((s) =>
        fetchBook(s).then((b) => {
          reader.addTab(b)
        }),
      ),
    )
      .catch((error) =>
        setOpenError(
          error instanceof Error
            ? error.message
            : 'This EPUB could not be downloaded.',
        ),
      )
      .finally(() => setLoading(false))
  }, [router.query])

  useEffect(() => {
    if ('launchQueue' in window && 'LaunchParams' in window) {
      window.launchQueue.setConsumer((params) => {
        if (params.files.length) {
          Promise.all(params.files.map((f) => f.getFile()))
            .then((files) => handleFiles(files))
            .then((books) => books.forEach((b) => reader.addTab(b)))
            .catch((error) =>
              setOpenError(
                error instanceof Error
                  ? error.message
                  : 'This file could not be imported.',
              ),
            )
        }
      })
    }
  }, [])

  useEffect(() => {
    router.beforePopState((state) => {
      if (restoreMobilePanelHistory(state)) return false
      if (state.url === '/') {
        reader.clear()
      }
      return true
    })
    return () => router.beforePopState(() => true)
  }, [router])

  return (
    <>
      <Head>
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1.0, viewport-fit=cover"
        />
        <title>{focusedTab?.title ?? 'Flow'}</title>
      </Head>
      <ReaderGridView />
      {openError && (
        <p className="flow-listening-route-error" role="alert">
          {openError}
        </p>
      )}
      {loading || <Library />}
      {!!backupReviews.length && (
        <div className="flow-backup-review-overlay">
          <FocusLock returnFocus>
            <section
              className="flow-library-review flow-backup-review"
              role="dialog"
              aria-modal="true"
              aria-labelledby="flow-backup-review-title"
              onKeyDown={(event) => {
                if (event.key === 'Escape' && !backupReviewBusy)
                  setBackupReviews((current) => current.slice(1))
              }}
            >
              <h2 id="flow-backup-review-title">Restore this Flow backup?</h2>
              <p>
                {backupReviews[0]!.summary.books} books,{' '}
                {backupReviews[0]!.summary.files} EPUB files and{' '}
                {backupReviews[0]!.summary.bookmarks} listening Bookmarks. Add
                only missing books; existing books keep their current reading
                progress, notes and listening Bookmarks. Older backups restore
                only the data they contain.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  autoFocus
                  variant="secondary"
                  disabled={backupReviewBusy}
                  onClick={() =>
                    setBackupReviews((current) => current.slice(1))
                  }
                >
                  Cancel
                </Button>
                <Button
                  disabled={backupReviewBusy}
                  onClick={restoreReviewedBackup}
                >
                  {backupReviewBusy ? 'Restoring…' : 'Add missing books'}
                </Button>
              </div>
              {backupReviewError && <p role="alert">{backupReviewError}</p>}
            </section>
          </FocusLock>
        </div>
      )}
    </>
  )
}

const Library: React.FC = () => {
  const books = useLibrary()
  const covers = useLiveQuery(() => db?.covers.toArray() ?? [])
  const listening = useLiveQuery(() => db?.listening.toArray() ?? [])
  const localFileIds = useLiveQuery(
    () => db?.files.toCollection().primaryKeys() ?? [],
  )
  const t = useTranslation('home')

  const { data: remoteBooks, mutate: mutateRemoteBooks } = useRemoteBooks()
  const { data: remoteFiles, mutate: mutateRemoteFiles } = useRemoteFiles()
  const previousRemoteBooks = usePrevious(remoteBooks)
  const previousRemoteFiles = usePrevious(remoteFiles)

  const [select, toggleSelect] = useBoolean(false)
  const [selectedBookIds, { add, has, toggle, reset }] = useSet<string>()

  const [loading, setLoading] = useState<string | undefined>()
  const [readyToSync, setReadyToSync] = useState(false)
  const [backupBusy, setBackupBusy] = useState(false)
  const [libraryError, setLibraryError] = useState('')
  const [libraryNotice, setLibraryNotice] = useState('')
  const [pendingBackup, setPendingBackup] = useState<PreparedLibraryBackup>()
  const [reviewDelete, setReviewDelete] = useState(false)

  const { groups } = useReaderSnapshot()

  useEffect(() => {
    if (previousRemoteFiles && remoteFiles) {
      // to remove effect dependency `books`
      db?.books.toArray().then((books) => {
        if (books.length === 0) return

        const newRemoteBooks = remoteFiles.map((f) =>
          books.find((b) => b.name === f.name),
        ) as BookRecord[]

        uploadData(newRemoteBooks)
        mutateRemoteBooks(newRemoteBooks, { revalidate: false })
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mutateRemoteBooks, remoteFiles])

  useEffect(() => {
    if (!previousRemoteBooks && remoteBooks) {
      db?.books.bulkPut(remoteBooks).then(() => setReadyToSync(true))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remoteBooks])

  useEffect(() => {
    if (!remoteFiles || !readyToSync) return

    db?.books.toArray().then(async (books) => {
      for (const remoteFile of remoteFiles) {
        const book = books.find((b) => b.name === remoteFile.name)
        if (!book) continue

        const file = await db?.files.get(book.id)
        if (file) continue

        setLoading(book.id)
        try {
          await dbx
            .filesDownload({ path: `/files/${remoteFile.name}` })
            .then((d) => {
              const blob: Blob = (d.result as any).fileBlob
              return addFile(book.id, new File([blob], book.name))
            })
        } catch (error) {
          setLibraryError(
            error instanceof Error
              ? error.message
              : 'This book could not be downloaded. Import its EPUB here to try again.',
          )
        } finally {
          setLoading(undefined)
        }
      }
    })
  }, [readyToSync, remoteFiles])

  useEffect(() => {
    if (!select) reset()
    setReviewDelete(false)
  }, [reset, select])

  async function exportBackup() {
    setBackupBusy(true)
    setLibraryError('')
    try {
      await exportLibraryBackup()
      setLibraryNotice(
        'Backup downloaded with EPUBs, reading progress, notes and listening Bookmarks. Keep it somewhere safe.',
      )
    } catch (error) {
      setLibraryError(
        error instanceof Error ? error.message : 'Could not export the backup.',
      )
    } finally {
      setBackupBusy(false)
    }
  }

  async function importFiles(files: Iterable<File>) {
    setLibraryError('')
    setLibraryNotice('')
    setBackupBusy(true)
    try {
      for (const file of files) {
        const kind = libraryImportKind(file)
        if (kind === 'backup') {
          const backup =
            (await readLibraryBackup(file)) ||
            (await readLegacyLibraryBackup(file))
          if (backup) {
            setPendingBackup(backup)
            continue
          }
          throw new Error(
            'This ZIP is not a supported Flow backup. Import an EPUB or a Flow library backup.',
          )
        }
        if (kind !== 'epub')
          throw new Error('Choose an EPUB file or a Flow backup ZIP.')
        const epub =
          file.type === 'application/epub+zip'
            ? file
            : new File([file], file.name, {
                type: 'application/epub+zip',
                lastModified: file.lastModified,
              })
        await handleFiles([epub])
      }
    } catch (error) {
      setLibraryError(
        error instanceof Error ? error.message : 'Could not import this file.',
      )
    } finally {
      setBackupBusy(false)
    }
  }

  async function restoreBackup() {
    if (!pendingBackup) return
    setBackupBusy(true)
    setLibraryError('')
    try {
      const result = await restoreLibraryBackup(pendingBackup)
      setPendingBackup(undefined)
      setLibraryNotice(
        `Books restored: ${result.restored}. Existing books kept: ${result.skipped}. Their current progress and Bookmarks are unchanged.`,
      )
    } catch (error) {
      setLibraryError(
        error instanceof Error
          ? error.message
          : 'Could not restore this backup.',
      )
    } finally {
      setBackupBusy(false)
    }
  }

  if (groups.length) return null
  if (!books) return null

  const selectedBooks = [...selectedBookIds].map(
    (id) => books.find((b) => b.id === id)!,
  )
  const allSelected = selectedBookIds.size === books.length

  async function deleteSelectedBooks() {
    const ids = [...selectedBookIds]
    const deleting = books!.filter((book) => ids.includes(book.id))
    setBackupBusy(true)
    setLibraryError('')
    try {
      const libraryDb = db
      if (libraryDb)
        await libraryDb.transaction(
          'rw',
          [
            libraryDb.books,
            libraryDb.covers,
            libraryDb.files,
            libraryDb.listening,
            libraryDb.listeningSessions,
          ],
          async () => {
            await libraryDb.books.bulkDelete(ids)
            await libraryDb.covers.bulkDelete(ids)
            await libraryDb.files.bulkDelete(ids)
            await libraryDb.listening.bulkDelete(ids)
            await libraryDb.listeningSessions
              .where('bookId')
              .anyOf(ids)
              .delete()
          },
        )
      const remoteDeleting = deleting.filter((book) =>
        remoteFiles?.some((file) => file.name === book.name),
      )
      if (remoteDeleting.length)
        await mutateRemoteFiles(
          async (data) => {
            await dbx.filesDeleteBatch({
              entries: remoteDeleting.map((book) => ({
                path: `/files/${book.name}`,
              })),
            })
            return data?.filter(
              (file) => !remoteDeleting.some((book) => book.name === file.name),
            )
          },
          { revalidate: false },
        )
      setReviewDelete(false)
      toggleSelect()
      setLibraryNotice(
        `Deleted ${deleting.length} selected books. Other books were kept.`,
      )
    } catch (error) {
      setLibraryError(
        error instanceof Error
          ? error.message
          : 'Some selected books could not be deleted. Review your library before retrying.',
      )
    } finally {
      setBackupBusy(false)
    }
  }

  return (
    <DropZone
      className="flow-library scroll-parent h-full"
      onDrop={(e) => {
        const bookId = e.dataTransfer.getData('text/plain')
        const book = books.find((b) => b.id === bookId)
        if (book) reader.addTab(book)

        importFiles(e.dataTransfer.files)
      }}
    >
      <div className="flow-library-heading">
        <h1>Your library</h1>
        <p className="flow-library-local-note">
          Books and Bookmarks stay in this browser on this device. Export a
          backup before clearing browser data or switching devices.
        </p>
      </div>
      <div className="mb-4 space-y-2.5">
        <div>
          <TextField
            name={SOURCE}
            placeholder="https://link.to/remote.epub"
            type="url"
            hideLabel
            actions={[
              {
                title: t('share'),
                Icon: MdOutlineShare,
                onClick(el) {
                  if (el?.reportValidity()) {
                    copy(`${window.location.origin}/?${SOURCE}=${el.value}`)
                  }
                },
              },
              {
                title: t('download'),
                Icon: MdOutlineFileDownload,
                onClick(el) {
                  if (el?.reportValidity()) {
                    setLibraryError('')
                    fetchBook(el.value).catch((error) =>
                      setLibraryError(
                        error instanceof Error
                          ? error.message
                          : 'This EPUB could not be downloaded. Import its file here to try again.',
                      ),
                    )
                  }
                },
              },
            ]}
          />
        </div>
        <div className="flow-library-controls">
          <div>
            {books.length ? (
              <Button variant="secondary" onClick={toggleSelect}>
                {t(select ? 'cancel' : 'select')}
              </Button>
            ) : (
              <Button
                variant="secondary"
                disabled={!books}
                onClick={() => {
                  fetchBook(
                    'https://epubtest.org/books/Fundamental-Accessibility-Tests-Basic-Functionality-v1.0.0.epub',
                  )
                }}
              >
                {t('download_sample_book')}
              </Button>
            )}
            {select &&
              (allSelected ? (
                <Button variant="secondary" onClick={reset}>
                  {t('deselect_all')}
                </Button>
              ) : (
                <Button
                  variant="secondary"
                  onClick={() => books.forEach((b) => add(b.id))}
                >
                  {t('select_all')}
                </Button>
              ))}
          </div>

          <div>
            {select ? (
              <>
                <Button
                  onClick={async () => {
                    toggleSelect()

                    for (const book of selectedBooks) {
                      const remoteFile = remoteFiles?.find(
                        (f) => f.name === book.name,
                      )
                      if (remoteFile) continue

                      const file = await db?.files.get(book.id)
                      if (!file) continue

                      setLoading(book.id)
                      await dbx.filesUpload({
                        path: `/files/${book.name}`,
                        contents: file.file,
                      })
                      setLoading(undefined)

                      mutateRemoteFiles()
                    }
                  }}
                >
                  {t('upload')}
                </Button>
                <Button
                  disabled={!selectedBookIds.size || backupBusy}
                  onClick={() => setReviewDelete(true)}
                >
                  {t('delete')}
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="secondary"
                  disabled={!books.length || backupBusy}
                  onClick={exportBackup}
                >
                  {t('export')}
                </Button>
                <Button className="relative" disabled={backupBusy}>
                  <input
                    type="file"
                    accept=".epub,application/epub+zip,application/epub,application/zip"
                    className="absolute inset-0 cursor-pointer opacity-0"
                    aria-label="Import EPUBs or a Flow backup"
                    disabled={backupBusy}
                    onChange={(e) => {
                      const files = e.target.files
                      if (files) importFiles(Array.from(files))
                      e.target.value = ''
                    }}
                    multiple
                  />
                  {t('import')}
                </Button>
              </>
            )}
          </div>
        </div>
      </div>

      {pendingBackup && (
        <section
          className="flow-library-review"
          aria-label="Review backup restore"
        >
          <h2>Restore this Flow backup?</h2>
          <p>
            Books: {pendingBackup.summary.books} · EPUB files:{' '}
            {pendingBackup.summary.files} · Listening Bookmarks:{' '}
            {pendingBackup.summary.bookmarks}. Only missing books will be added;
            existing books and their saved progress stay unchanged.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              autoFocus
              variant="secondary"
              disabled={backupBusy}
              onClick={() => setPendingBackup(undefined)}
            >
              Cancel
            </Button>
            <Button disabled={backupBusy} onClick={restoreBackup}>
              Add missing books
            </Button>
          </div>
        </section>
      )}
      {reviewDelete && select && (
        <section
          className="flow-library-review"
          aria-label="Review selected book deletion"
        >
          <h2>
            Delete {selectedBooks.length} selected{' '}
            {selectedBooks.length === 1 ? 'book' : 'books'}?
          </h2>
          <p>
            This removes their EPUBs, notes, reading progress, listening
            Bookmarks and prepared sessions from this browser. Selected files
            also present in connected Dropbox will be deleted there. Other books
            and browser data stay unchanged. Export a backup first if you want
            to restore these books later.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              autoFocus
              variant="secondary"
              disabled={backupBusy}
              onClick={() => setReviewDelete(false)}
            >
              Cancel
            </Button>
            <Button
              variant="secondary"
              disabled={backupBusy}
              onClick={exportBackup}
            >
              Export backup first
            </Button>
            <Button
              disabled={backupBusy || !selectedBooks.length}
              onClick={deleteSelectedBooks}
            >
              Delete selected books
            </Button>
          </div>
        </section>
      )}
      {backupBusy && (
        <p className="flow-library-notice" role="status">
          Working with your library…
        </p>
      )}
      {libraryNotice && (
        <p className="flow-library-notice" role="status">
          {libraryNotice}
        </p>
      )}
      {libraryError && (
        <p className="flow-library-notice flow-library-error" role="alert">
          {libraryError}
        </p>
      )}
      <div className="flow-library-scroll scroll">
        {!books.length && (
          <section className="flow-library-empty">
            <h2>Add your first book</h2>
            <p>
              Import an EPUB or Flow backup, drop a file here, or download a
              sample. Read resumes the ebook; Listen uses its own chapter range
              and saved Bookmark.
            </p>
          </section>
        )}
        <ul className="flow-library-grid">
          {books.map((book) => (
            <Book
              key={book.id}
              book={book}
              covers={covers}
              listening={listening?.find((record) => record.bookId === book.id)}
              hasLocalFile={localFileIds?.includes(book.id)}
              select={select}
              selected={has(book.id)}
              loading={loading === book.id}
              toggle={toggle}
            />
          ))}
        </ul>
      </div>
    </DropZone>
  )
}

interface BookProps {
  book: BookRecord
  covers?: CoverRecord[]
  listening?: IntegratedListeningRecord
  hasLocalFile?: boolean
  select?: boolean
  selected?: boolean
  loading?: boolean
  toggle: (id: string) => void
}
const Book: React.FC<BookProps> = ({
  book,
  covers,
  listening,
  hasLocalFile,
  select,
  selected,
  loading,
  toggle,
}) => {
  const remoteFiles = useRemoteFiles()

  const router = useRouter()
  const mobile = useMobile()
  const setAction = useSetAction()
  const [listenError, setListenError] = useState('')
  const [opening, setOpening] = useState(false)
  const details = libraryBookDetails(book)
  const readingStart = readingResumeSummary(book)
  const listeningStart = listeningResumeSummary(book.id, listening)

  const cover = covers?.find((c) => c.id === book.id)?.cover
  const remoteFile = remoteFiles.data?.find((f) => f.name === book.name)

  const Icon = selected ? MdCheckBox : MdCheckBoxOutlineBlank

  async function openBook(listen = false) {
    if (opening) return
    setListenError('')
    if (hasLocalFile === false) {
      setListenError(
        'This EPUB is not downloaded in this browser. Import it here to read or listen.',
      )
      return
    }
    setOpening(true)
    try {
      if (mobile) await router.push('/_')
      reader.addTab(book)
      if (listen) setAction('listening')
      else if (mobile) setAction(undefined)
    } catch (error) {
      setListenError(
        error instanceof Error ? error.message : 'Could not open book.',
      )
    } finally {
      setOpening(false)
    }
  }

  return (
    <li className="flow-library-card">
      <button
        type="button"
        className="flow-library-cover border-inverse-on-surface relative border"
        disabled={loading || opening || hasLocalFile === undefined}
        aria-label={
          select
            ? `${selected ? 'Deselect' : 'Select'} ${details.title}`
            : `Read ${details.title}`
        }
        aria-pressed={select ? !!selected : undefined}
        onClick={() => {
          if (select) {
            toggle(book.id)
          } else {
            openBook()
          }
        }}
      >
        <div
          className={clsx(
            'absolute bottom-0 h-1 bg-blue-500',
            loading && 'progress-bit w-[5%]',
          )}
        />
        {readingStart.endsWith('%') && (
          <div className="typescale-body-large absolute right-0 bg-gray-500/60 px-2 text-gray-100">
            {readingStart}
          </div>
        )}
        <img
          src={cover ?? placeholder}
          alt=""
          className="mx-auto aspect-[9/12] object-cover"
          draggable={false}
        />
        {select && (
          <div className="absolute bottom-1 right-1">
            <Icon
              size={24}
              className={clsx(
                '-m-1',
                selected ? 'text-tertiary' : 'text-outline',
              )}
            />
          </div>
        )}
      </button>

      <div className="flow-library-card-content">
        <h2 title={details.filename}>{details.title}</h2>
        {details.author && (
          <p className="flow-library-author">{details.author}</p>
        )}
        <p className="flow-library-availability">
          {remoteFile && (
            <MdCheckCircle
              className="text-tertiary mr-1 inline"
              size={14}
              aria-label="Available in connected Dropbox"
            />
          )}
          {loading
            ? 'Downloading…'
            : hasLocalFile === undefined
            ? 'Checking this browser…'
            : hasLocalFile
            ? 'On this browser'
            : 'Import needed on this browser'}
        </p>
        {!select && (
          <dl className="flow-library-resume">
            <div>
              <dt>Reading</dt>
              <dd>{readingStart}</dd>
            </div>
            <div>
              <dt>Next listening start</dt>
              <dd>
                {listeningStart.label}
                {listeningStart.excerpt && (
                  <p className="flow-library-excerpt">
                    “{listeningStart.excerpt}”
                  </p>
                )}
              </dd>
            </div>
          </dl>
        )}
        {!select && listeningStart.bookmark && (
          <p className="flow-library-context-note">
            Bookmark and range are checked when you open Listen.
          </p>
        )}
      </div>
      {!select && (
        <div className="flow-library-actions">
          <button
            type="button"
            disabled={loading || opening || hasLocalFile === undefined}
            aria-label={`Read ${details.title}`}
            onClick={() => openBook()}
          >
            <MdMenuBook aria-hidden="true" /> Read
          </button>
          <button
            type="button"
            disabled={loading || opening || hasLocalFile === undefined}
            aria-label={`Listen to ${details.title}`}
            onClick={() => openBook(true)}
          >
            <MdHeadset aria-hidden="true" /> Listen
          </button>
        </div>
      )}
      {listenError && (
        <p className="flow-library-error" role="alert">
          {listenError}
        </p>
      )}
    </li>
  )
}
