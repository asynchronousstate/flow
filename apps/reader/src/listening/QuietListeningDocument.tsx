import { useMediaQuery } from '@literal-ui/hooks'
import Head from 'next/head'
import { useRouter } from 'next/router'
import {
  CSSProperties,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { FiArrowLeft, FiBookmark, FiX } from 'react-icons/fi'
import { useSetRecoilState } from 'recoil'

import { db } from '../db'
import { useAction } from '../hooks'
import {
  createMobilePanelHistory,
  MobilePanelView,
} from '../hooks/panel-history'
import { navbarState } from '../state'

import EdgeListeningHelp from './EdgeListeningHelp'
import PreparationStatus from './PreparationStatus'
import QuietBookmarks, {
  BookmarkParagraph,
  sameBookmark,
} from './QuietBookmarks'
import { resolveListeningAppearance, savedReaderAppearance } from './appearance'
import type { ListeningAppearance } from './appearance'
import { createBookmarkQueue } from './bookmark-queue'
import type { BookmarkQueue, BookmarkQueueSnapshot } from './bookmark-queue'
import { chapterForBookmark, isBookmarkInListeningRange } from './chapters'
import {
  buildQuietSession,
  getBookmarkParagraphs,
  getListeningParagraphs,
} from './document'
import type { ListeningPreparationProgress } from './epub'
import {
  loadLibraryListeningBook,
  loadQuietLaunch,
  saveLibraryBookmark,
  retryListeningPreparation,
  undoLibraryBookmark,
} from './integrated'
import type { ListeningMarker, LoadedListeningBook } from './integrated'
import {
  ListeningToolbar,
  listeningToolbarTools,
  LISTENING_TOOLBAR_VARIANT,
} from './toolbar/ListeningToolbar'
import type { ToolbarAction } from './toolbar/ListeningToolbar'
import { OriginalFeatures } from './toolbar/OriginalFeatures'
import type { OriginalFeaturesHandle } from './toolbar/OriginalFeatures'

type QuietSession = ReturnType<typeof buildQuietSession>

// The session is a snapshot. Saving the next start must never replace the DOM
// that native Read aloud may still be using for the current session.
const QuietArticle = memo(function QuietArticle({
  session,
}: {
  session: QuietSession
}) {
  return (
    <article
      className="flow-quiet-article"
      lang={session.language || undefined}
      aria-label={session.title}
    >
      {session.sections.map((section) => (
        <section
          key={section.id}
          id={section.id}
          data-flow-quiet-section={section.id}
          dangerouslySetInnerHTML={{ __html: section.html }}
        />
      ))}
    </article>
  )
})

function bookmarkedParagraph(
  book: LoadedListeningBook['book'],
  marker?: ListeningMarker,
): BookmarkParagraph | undefined {
  if (!marker) return
  const section = book.sections.find((s) => s.sourceHref === marker.sourceHref)
  if (!section) return
  const paragraph = getListeningParagraphs(section).find((p) =>
    sameBookmark({ ...p, sourceHref: section.sourceHref }, marker),
  )
  if (!paragraph) return
  try {
    return {
      ...paragraph,
      sectionId: section.id,
      sourceHref: section.sourceHref,
      chapterTitle: chapterForBookmark(book, marker).title,
    }
  } catch {
    // Stale locators must not appear to be a valid saved listening start.
    return undefined
  }
}

export default function QuietListeningDocument({
  bookId,
  sessionId,
}: {
  bookId: string
  sessionId?: string
}) {
  const router = useRouter()
  const mobile = useMediaQuery('(max-width: 640px)')
  const variant = LISTENING_TOOLBAR_VARIANT
  const [readerAction, setReaderAction] = useAction()
  const setNavbar = useSetRecoilState(navbarState)
  const toolAction =
    variant && readerAction && readerAction !== 'listening'
      ? (readerAction as ToolbarAction)
      : undefined
  const [sourceOpen, setSourceOpen] = useState(false)
  const [sourceOverlay, setSourceOverlay] = useState<string>()
  const [leaving, setLeaving] = useState(false)
  const [navigationError, setNavigationError] = useState('')
  const originalFeatures = useRef<OriginalFeaturesHandle>(null)
  const [session, setSession] = useState<QuietSession>()
  const [loadError, setLoadError] = useState('')
  const [toolsOpen, setToolsOpen] = useState(false)
  const [bookmark, setBookmark] = useState<
    BookmarkQueueSnapshot<BookmarkParagraph>
  >({
    pending: false,
    canUndo: false,
    operation: 0,
    action: null,
    status: 'idle',
  })
  const saved = bookmark.selection
  const saving = bookmark.pending
  const undo = bookmark.canUndo
  const saveError =
    bookmark.status !== 'error'
      ? ''
      : bookmark.error instanceof Error
      ? bookmark.error.message
      : 'The Bookmark could not be saved. Please try again.'
  const [listSection, setListSection] = useState('')
  const [appearance, setAppearance] = useState<ListeningAppearance>()
  const [progress, setProgress] = useState<ListeningPreparationProgress>()
  const [retry, setRetry] = useState(0)
  const [toast, setToast] = useState(false)
  const [toastPaused, setToastPaused] = useState(false)
  const [bookmarkListOpen, setBookmarkListOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const panel = useRef<ReturnType<typeof createMobilePanelHistory>>()
  const panelView = useRef<MobilePanelView>({ bookId, navbar: false })
  panelView.current = {
    bookId,
    navbar: false,
    action:
      (sourceOverlay
        ? `overlay:${toolAction || 'source'}:${sourceOverlay}`
        : undefined) ||
      toolAction ||
      (sourceOpen ? 'source' : undefined) ||
      (!toolsOpen
        ? undefined
        : bookmarkListOpen
        ? 'bookmark-list'
        : helpOpen
        ? 'help'
        : 'tools'),
  }
  const retryPreparation = useCallback(() => {
    retryListeningPreparation(bookId)
    setRetry((value) => value + 1)
  }, [bookId])
  const articleHost = useRef<HTMLDivElement>(null)
  const toolsSummary = useRef<HTMLElement>(null)
  const bookmarkQueue = useRef<BookmarkQueue<BookmarkParagraph>>()
  const loadedBook = useRef<LoadedListeningBook['book']>()
  const launchRange = useRef<{ from: string; through: string }>()
  const closeRevision = useRef(0)
  const feedbackOperation = useRef(0)
  const returnRequested = useRef(false)
  const returnHref = `/?book=${encodeURIComponent(bookId)}&listening=1${
    sessionId ? `&session=${encodeURIComponent(sessionId)}` : ''
  }`

  useEffect(() => {
    setNavbar(false)
    setReaderAction(undefined)
    setSourceOpen(false)
    return () => setReaderAction(undefined)
  }, [bookId, setNavbar, setReaderAction])

  useEffect(() => {
    if (!variant || readerAction !== 'listening') return
    setReaderAction(undefined)
    setSourceOpen(false)
    setToolsOpen(true)
  }, [readerAction, setReaderAction, variant])

  async function closeEbookTools() {
    const revision = ++closeRevision.current
    try {
      await originalFeatures.current?.settled()
    } catch (problem) {
      setNavigationError(
        problem instanceof Error
          ? problem.message
          : 'Could not save the ebook position.',
      )
      return
    }
    if (revision !== closeRevision.current) return
    originalFeatures.current?.dismissOverlay()
    setSourceOverlay(undefined)
    setReaderAction(undefined)
    setSourceOpen(false)
  }

  function chooseTool(next?: ToolbarAction) {
    if (!next) {
      void closeEbookTools()
      return
    }
    closeRevision.current++
    originalFeatures.current?.dismissOverlay()
    setToolsOpen(false)
    setBookmarkListOpen(false)
    setHelpOpen(false)
    setReaderAction(next)
    setSourceOpen(!!next)
  }

  async function bookmarkSource(marker: ListeningMarker) {
    const paragraph =
      loadedBook.current && bookmarkedParagraph(loadedBook.current, marker)
    const queue = bookmarkQueue.current
    if (!paragraph || !queue)
      throw new Error(
        'This paragraph is not available for a listening Bookmark.',
      )
    const range = launchRange.current
    if (
      !range ||
      !isBookmarkInListeningRange(
        loadedBook.current!,
        marker,
        range.from,
        range.through,
      )
    )
      throw new Error(
        'This paragraph is outside this listening range. Return to the book to change the From / Through chapters first.',
      )
    queue.select(paragraph)
    await queue.settled()
    const result = queue.getSnapshot()
    if (result.status === 'error') throw result.error
  }

  async function leaveListening(href: string, home = false) {
    if (returnRequested.current) return
    returnRequested.current = true
    setLeaving(true)
    setNavigationError('')
    try {
      await bookmarkQueue.current?.settled()
      if (home) await originalFeatures.current?.leave()
      else await originalFeatures.current?.settled()
      // Tool writes may yield while another Bookmark is accepted. Drain again
      // immediately before routing so that last accepted tap is included.
      await bookmarkQueue.current?.settled()
      setNavbar(false)
      const navigated = await router.push(href)
      if (!navigated)
        throw new Error(
          'Navigation was canceled. Your saved changes are kept; try Home again.',
        )
    } catch (problem) {
      void closeEbookTools()
      setNavigationError(
        problem instanceof Error
          ? problem.message
          : 'Could not return to Flow. Please try again.',
      )
    } finally {
      returnRequested.current = false
      setLeaving(false)
    }
  }

  useEffect(() => {
    if ((!mobile && !variant) || !router.isReady) return
    const history = createMobilePanelHistory(
      window.history,
      () => window.location.pathname + window.location.search,
      () => panelView.current,
      (restoredView) => {
        let view = restoredView
        const overlay = /^overlay:([^:]+):(selection|note|image)$/.exec(
          view.action || '',
        )
        const restoredAction = overlay?.[1] || view.action
        const quietTool = ['tools', 'bookmark-list', 'help'].includes(
          restoredAction || '',
        )
        const ebookTool = listeningToolbarTools.some(
          (tool) => tool.action === restoredAction,
        )
          ? (restoredAction as ToolbarAction)
          : undefined
        const nextSource = !!ebookTool || restoredAction === 'source'
        // A canceled selection/editor is not recreated by Forward. Normalize
        // that old entry to its reader surface rather than restoring a ghost.
        const hasOverlay = !!overlay && originalFeatures.current?.hasOverlay()
        if (overlay && !hasOverlay) {
          view = { ...view, action: ebookTool || 'source' }
          history.replace(view)
        }
        const revision = ++closeRevision.current
        const apply = () => {
          if (revision !== closeRevision.current) return
          if (!hasOverlay) originalFeatures.current?.dismissOverlay()
          panelView.current = view
          setSourceOverlay(hasOverlay ? overlay![2] : undefined)
          setReaderAction(ebookTool)
          setSourceOpen(nextSource)
          setToolsOpen(quietTool)
          setBookmarkListOpen(restoredAction === 'bookmark-list')
          setHelpOpen(restoredAction === 'help')
          requestAnimationFrame(() => {
            if (revision !== closeRevision.current) return
            const destination = nextSource
              ? document.querySelector<HTMLElement>('.flow-toolkit-source h2')
              : toolsSummary.current
            destination?.focus({ preventScroll: true })
          })
        }
        const wasSource =
          panelView.current.action &&
          !['tools', 'bookmark-list', 'help'].includes(panelView.current.action)
        if (wasSource && !nextSource) {
          void originalFeatures.current
            ?.settled()
            .then(apply)
            .catch((problem: unknown) => {
              setNavigationError(
                problem instanceof Error
                  ? problem.message
                  : 'Could not save the ebook position.',
              )
            })
        } else apply()
      },
      (previous, next) =>
        (previous.action === 'tools' &&
          ['bookmark-list', 'help'].includes(next.action || '')) ||
        (!!next.action?.startsWith('overlay:') &&
          !previous.action?.startsWith('overlay:')),
    )
    panel.current = history
    const onPop = (event: PopStateEvent) => history.restore(event.state)
    router.beforePopState((state) => !history.restore(state))
    window.addEventListener('popstate', onPop)
    history.sync(panelView.current)
    return () => {
      window.removeEventListener('popstate', onPop)
      router.beforePopState(() => true)
      panel.current = undefined
    }
  }, [
    bookId,
    mobile,
    router,
    router.isReady,
    sessionId,
    setReaderAction,
    variant,
  ])

  useEffect(() => {
    panel.current?.sync(panelView.current)
  }, [
    toolsOpen,
    bookmarkListOpen,
    helpOpen,
    sourceOpen,
    sourceOverlay,
    toolAction,
  ])

  useEffect(() => {
    if (!toast || saving || saveError || toastPaused) return
    const timer = window.setTimeout(() => setToast(false), 8000)
    return () => window.clearTimeout(timer)
  }, [bookmark.operation, saveError, saving, toast, toastPaused])

  useEffect(() => {
    let active = true
    let queue: BookmarkQueue<BookmarkParagraph> | undefined
    const controller = new AbortController()
    setToast(false)
    setToastPaused(false)
    feedbackOperation.current = 0
    setLoadError('')
    setProgress(undefined)
    async function load() {
      const options = {
        signal: controller.signal,
        onProgress: (next: ListeningPreparationProgress) => {
          if (active) setProgress(next)
        },
      }
      const launch = sessionId
        ? await loadQuietLaunch(bookId, sessionId, options)
        : await loadLibraryListeningBook(bookId, options)
      const prepared = buildQuietSession(launch.book, launch.record)
      loadedBook.current = launch.book
      launchRange.current = {
        from: launch.record.from,
        through: launch.record.through,
      }
      // Keep the launch immutable, but show the bookmark for the NEXT session.
      // The fingerprint is already verified. Read metadata instead of hashing
      // and loading the full EPUB a second time before showing its prose.
      const latest = sessionId ? await db?.listening.get(bookId) : launch.record
      const metadata = await db?.books.get(bookId)
      const reading = savedReaderAppearance()
      if (!active) return
      setAppearance(
        launch.appearance ||
          resolveListeningAppearance(
            launch.record.appearance,
            reading.settings,
            metadata?.configuration?.typography,
            reading.dark,
          ),
      )
      const initialSelection =
        latest?.fingerprint === launch.record.fingerprint
          ? bookmarkedParagraph(launch.book, latest.marker)
          : undefined
      queue = createBookmarkQueue({
        initialSelection,
        sameSelection: sameBookmark,
        save: async (paragraph: BookmarkParagraph) => {
          const marker: ListeningMarker = {
            sourceHref: paragraph.sourceHref,
            blockId: paragraph.blockId,
            text: paragraph.text,
            savedAt: Date.now(),
          }
          const chapter = chapterForBookmark(launch.book, marker)
          marker.chapterTitle = chapter.title
          return saveLibraryBookmark(
            bookId,
            marker,
            launch.record.fingerprint,
            {
              from: chapter.id,
              through: launch.record.through,
            },
          )
        },
        restore: (change) =>
          undoLibraryBookmark(bookId, change.record, change.previous),
        selectionFromRecord: (record) =>
          record.fingerprint === launch.record.fingerprint
            ? bookmarkedParagraph(launch.book, record.marker)
            : undefined,
        recover: async () => (await loadLibraryListeningBook(bookId)).record,
        onChange: (next) => {
          if (!active) return
          setBookmark(next)
          if (
            next.operation !== feedbackOperation.current ||
            next.status === 'error'
          ) {
            feedbackOperation.current = next.operation
            setToastPaused(false)
            setToast(true)
          }
        },
      })
      bookmarkQueue.current = queue
      setBookmark(queue.getSnapshot())
      setSession(prepared)
      setListSection(prepared.sections[0]?.id || '')
    }
    load().catch((error: unknown) => {
      if (active)
        setLoadError(
          error instanceof Error
            ? error.message
            : 'This listening session could not be prepared.',
        )
    })
    return () => {
      active = false
      controller.abort()
      queue?.dispose()
      if (bookmarkQueue.current === queue) bookmarkQueue.current = undefined
    }
  }, [bookId, retry, sessionId])

  const paragraphs = useMemo(
    () =>
      session?.sections.flatMap((section) =>
        getBookmarkParagraphs(section).map((paragraph) => ({
          ...paragraph,
          sectionId: section.id,
          sourceHref: section.sourceHref,
          chapterTitle: section.title,
        })),
      ) || [],
    [session],
  )
  const listParagraphs = useMemo(
    () =>
      session?.sections.flatMap((section) =>
        getListeningParagraphs(section).map((paragraph) => ({
          ...paragraph,
          sectionId: section.id,
          sourceHref: section.sourceHref,
          chapterTitle: section.title,
        })),
      ) || [],
    [session],
  )

  function saveParagraph(paragraph: BookmarkParagraph) {
    bookmarkQueue.current?.select(paragraph)
  }

  function undoBookmark() {
    bookmarkQueue.current?.undo()
  }

  return (
    <main
      className={`flow-quiet${variant ? ' flow-listening-toolkit' : ''}`}
      data-variant={variant}
      data-quiet-theme={appearance?.theme || 'light'}
      style={
        appearance
          ? ({
              '--quiet-font-size': `${appearance.fontSize}px`,
              '--quiet-line-height': appearance.lineHeight,
              '--quiet-font-family': appearance.fontFamily,
              '--quiet-font-weight': appearance.fontWeight,
            } as CSSProperties)
          : undefined
      }
    >
      <Head>
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1.0, viewport-fit=cover"
        />
        <title>
          {session ? `${session.title} · Flow` : 'Quiet document · Flow'}
        </title>
      </Head>
      <header className="flow-quiet-toolbar">
        <a
          className="flow-quiet-return"
          href={returnHref}
          onClick={async (event) => {
            if (
              event.button !== 0 ||
              event.metaKey ||
              event.ctrlKey ||
              event.shiftKey ||
              event.altKey
            )
              return
            if (variant) {
              event.preventDefault()
              await leaveListening(returnHref)
              return
            }
            const queue = bookmarkQueue.current
            if (!queue?.getSnapshot().pending && !returnRequested.current)
              return
            event.preventDefault()
            if (!queue || returnRequested.current) return
            returnRequested.current = true
            await queue.settled()
            returnRequested.current = false
            if (bookmarkQueue.current === queue) void router.push(returnHref)
          }}
        >
          <FiArrowLeft aria-hidden="true" size={16} /> Return to book
        </a>
        {session && (
          <details
            className="flow-quiet-tools"
            open={toolsOpen}
            onToggle={(event) => {
              setToolsOpen(event.currentTarget.open)
              if (event.currentTarget.open) closeEbookTools()
            }}
          >
            <summary ref={toolsSummary}>Session / Tools</summary>
            {toolsOpen && (
              <div className="flow-quiet-panel">
                <h1>{session.title}</h1>
                <div className="flow-quiet-marker-tools">
                  <h2>Bookmark</h2>
                  {saved && (
                    <div className="flow-quiet-choice">
                      <p className="flow-quiet-label">
                        Bookmarked on this device
                      </p>
                      <p>{saved.chapterTitle}</p>
                      <blockquote>{saved.text}</blockquote>
                      <p>
                        This bookmark is for your next session. It does not
                        track Edge’s spoken position.
                      </p>
                      {undo && (
                        <button type="button" onClick={undoBookmark}>
                          Undo bookmark
                        </button>
                      )}
                    </div>
                  )}
                  {!saved && (
                    <p>
                      No saved listening Bookmark yet. Pause Edge, then use a
                      paragraph’s Bookmark icon or the list below to save your
                      next start.
                    </p>
                  )}
                  <details
                    className="flow-quiet-paragraph-list"
                    open={bookmarkListOpen}
                    onToggle={(event) => {
                      setBookmarkListOpen(event.currentTarget.open)
                      if (event.currentTarget.open) setHelpOpen(false)
                    }}
                  >
                    <summary>Bookmark from a list</summary>
                    <label htmlFor="flow-quiet-chapter">Chapter</label>
                    <select
                      id="flow-quiet-chapter"
                      value={listSection}
                      onChange={(event) => setListSection(event.target.value)}
                    >
                      {session.sections.map((section) => (
                        <option key={section.id} value={section.id}>
                          {section.title}
                        </option>
                      ))}
                    </select>
                    <ol>
                      {listParagraphs
                        .filter(
                          (paragraph) => paragraph.sectionId === listSection,
                        )
                        .map((paragraph) => (
                          <li key={paragraph.blockId}>
                            <p>{paragraph.text}</p>
                            <button
                              type="button"
                              aria-pressed={sameBookmark(saved, paragraph)}
                              onClick={() => saveParagraph(paragraph)}
                            >
                              {sameBookmark(saved, paragraph)
                                ? 'Bookmarked'
                                : 'Bookmark this paragraph'}
                            </button>
                          </li>
                        ))}
                    </ol>
                  </details>
                </div>
                <details
                  className="flow-quiet-help"
                  open={helpOpen}
                  onToggle={(event) => {
                    setHelpOpen(event.currentTarget.open)
                    if (event.currentTarget.open) setBookmarkListOpen(false)
                  }}
                >
                  <summary>Read aloud help and appearance</summary>
                  <EdgeListeningHelp />
                  <p>
                    Pause Edge before saving a Bookmark. It sets the next
                    session’s start; it does not follow Edge’s spoken position
                    or replace the active text.
                  </p>
                  <p>
                    Appearance: {appearance?.fontSize || 22}px text ·{' '}
                    {appearance?.theme || 'light'} theme. Change the next view’s
                    appearance in listening setup.
                  </p>
                  <a href={returnHref}>Review range and next-view appearance</a>
                </details>
                <button
                  type="button"
                  className="flow-quiet-close"
                  onClick={() => {
                    setToolsOpen(false)
                    setBookmarkListOpen(false)
                    setHelpOpen(false)
                    toolsSummary.current?.focus({ preventScroll: true })
                  }}
                >
                  Close tools
                </button>
              </div>
            )}
          </details>
        )}
      </header>
      {loadError ? (
        <section className="flow-quiet-recovery" role="alert">
          <h1>This listening session needs attention</h1>
          <p>{loadError}</p>
          <p>Return to Flow to review the book, range and bookmark.</p>
          <p>
            Books are stored in the browser profile where you imported them.
            Open this link there, or import the EPUB in this browser before
            preparing a new session.
          </p>
          <button type="button" onClick={retryPreparation}>
            Retry preparation
          </button>
          <a href={returnHref}>Review this book in Flow</a>
          <a href="/">Return to Flow library</a>
        </section>
      ) : session ? (
        <>
          <div ref={articleHost} className="flow-quiet-article-host">
            <QuietArticle session={session} />
            <QuietBookmarks
              host={articleHost}
              paragraphs={paragraphs}
              saved={saved}
              onBookmark={saveParagraph}
            />
          </div>
        </>
      ) : (
        <section className="flow-quiet-loading">
          <PreparationStatus
            key={retry}
            progress={progress}
            onRetry={retryPreparation}
          />
        </section>
      )}
      {session && toast && (
        <aside
          className="flow-quiet-save-toast"
          aria-label="Bookmark feedback"
          data-nosnippet
          onMouseEnter={() => setToastPaused(true)}
          onMouseLeave={() => setToastPaused(false)}
          onFocusCapture={() => setToastPaused(true)}
          onBlurCapture={(event) => {
            if (
              !event.currentTarget.contains(event.relatedTarget as Node | null)
            )
              setToastPaused(false)
          }}
        >
          <div
            key={bookmark.operation}
            className="flow-quiet-save-feedback"
            role={saveError ? 'alert' : 'status'}
            aria-atomic="true"
          >
            <p className="flow-quiet-save-heading">
              <FiBookmark aria-hidden="true" />
              <strong>
                {saveError
                  ? 'Bookmark needs attention'
                  : bookmark.action === 'undo'
                  ? 'Previous Bookmark restored'
                  : 'Bookmark moved'}
              </strong>
            </p>
            {saved && <blockquote>{saved.text}</blockquote>}
            <p
              className={
                saveError ? 'flow-quiet-error' : 'flow-quiet-save-state'
              }
            >
              {saveError ||
                (saving ? 'Saving…' : 'Saved for your next session')}
            </p>
          </div>
          <div className="flow-quiet-save-actions">
            {undo && (
              <button type="button" onClick={undoBookmark}>
                Undo
              </button>
            )}
            <button
              type="button"
              className="flow-quiet-toast-dismiss"
              onClick={() => {
                setToast(false)
                setToastPaused(false)
              }}
              aria-label="Dismiss Bookmark feedback"
            >
              <FiX aria-hidden="true" />
            </button>
          </div>
        </aside>
      )}
      {variant && session && (
        <>
          <OriginalFeatures
            ref={originalFeatures}
            bookId={bookId}
            action={toolAction}
            sourceOpen={sourceOpen}
            onClosePanel={() => setReaderAction(undefined)}
            onClose={closeEbookTools}
            onAppearanceChange={(patch) =>
              setAppearance((current) =>
                current ? { ...current, ...patch } : current,
              )
            }
            onOverlayChange={(type) => {
              setSourceOverlay(type)
              if (type && mobile) {
                setReaderAction(undefined)
                setSourceOpen(true)
              }
            }}
            onBookmark={bookmarkSource}
          />
          <ListeningToolbar
            variant={variant}
            action={toolAction}
            onAction={chooseTool}
            onHome={() => void leaveListening('/', true)}
            busy={leaving}
          />
          {navigationError && (
            <p className="flow-toolkit-navigation-error" role="alert">
              {navigationError}
            </p>
          )}
        </>
      )}
    </main>
  )
}
