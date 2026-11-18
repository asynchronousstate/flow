import { useMediaQuery } from '@literal-ui/hooks'
import Head from 'next/head'
import { useRouter } from 'next/router'
import {
  CSSProperties,
  memo,
  RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { FiArrowLeft, FiBookmark, FiX } from 'react-icons/fi'
import { useSetRecoilState } from 'recoil'

import { db } from '../db'
import { useSetAction } from '../hooks'
import {
  createMobilePanelHistory,
  MobilePanelView,
} from '../hooks/panel-history'
import { reader } from '../models'
import { navbarState } from '../state'

import EdgeListeningHelp from './EdgeListeningHelp'
import PreparationStatus from './PreparationStatus'
import QuietBookmarks, {
  BookmarkParagraph,
  sameBookmark,
} from './QuietBookmarks'
import {
  normalizeListeningAppearance,
  resolveListeningAppearance,
  savedReaderAppearance,
} from './appearance'
import type {
  ListeningAppearance,
  ListeningAppearanceChoice,
} from './appearance'
import { createBookmarkQueue } from './bookmark-queue'
import type { BookmarkQueue, BookmarkQueueSnapshot } from './bookmark-queue'
import { chapterForBookmark } from './chapters'
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
  saveListeningAppearance,
  retryListeningPreparation,
  undoLibraryBookmark,
} from './integrated'
import type { ListeningMarker, LoadedListeningBook } from './integrated'
import ExcerptTools from './toolbar/ExcerptTools'
import {
  ListeningToolbar,
  listeningToolbarTools,
  LISTENING_TOOLBAR_VARIANT,
} from './toolbar/ListeningToolbar'
import type { ToolbarAction } from './toolbar/ListeningToolbar'

type QuietSession = ReturnType<typeof buildQuietSession>

// The session is a snapshot. Saving the next start must never replace the DOM
// that native Read aloud may still be using for the current session.
const QuietArticle = memo(function QuietArticle({
  session,
  article,
}: {
  session: QuietSession
  article: RefObject<HTMLElement>
}) {
  return (
    <article
      ref={article}
      className="flow-quiet-article"
      lang={session.language || undefined}
      aria-label={session.title}
      tabIndex={-1}
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
  const setReaderAction = useSetAction()
  const setNavbar = useSetRecoilState(navbarState)
  const [toolAction, setToolAction] = useState<ToolbarAction>()
  const [leaving, setLeaving] = useState(false)
  const [navigationError, setNavigationError] = useState('')
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
  const [appearanceChoice, setAppearanceChoice] =
    useState<ListeningAppearanceChoice>()
  const [appearanceStatus, setAppearanceStatus] = useState('')
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
      toolAction ||
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
  const article = useRef<HTMLElement>(null)
  const toolsSummary = useRef<HTMLElement>(null)
  const bookmarkQueue = useRef<BookmarkQueue<BookmarkParagraph>>()
  const fingerprint = useRef<string>()
  const appearanceInputs = useRef<{
    choice: ListeningAppearanceChoice
    reading: ReturnType<typeof savedReaderAppearance>
    typography?: Parameters<typeof resolveListeningAppearance>[2]
  }>()
  const appearanceOperation = useRef(0)
  const saves = useRef(new Set<Promise<unknown>>())
  const scrollAnchor = useRef<{ node: HTMLElement; top: number }>()
  const feedbackOperation = useRef(0)
  const returnRequested = useRef(false)
  const returnHref = `/?book=${encodeURIComponent(bookId)}&listening=1${
    sessionId ? `&session=${encodeURIComponent(sessionId)}` : ''
  }`

  useEffect(() => {
    setNavbar(false)
    setReaderAction(undefined)
    return () => setReaderAction(undefined)
  }, [bookId, setNavbar, setReaderAction])

  function closeTools() {
    setToolAction(undefined)
  }

  function chooseTool(next?: ToolbarAction) {
    if (!next) {
      closeTools()
      return
    }
    setToolsOpen(false)
    setBookmarkListOpen(false)
    setHelpOpen(false)
    setToolAction(next)
  }

  function track(task: Promise<unknown>) {
    const pending = saves.current
    pending.add(task)
    const done = () => pending.delete(task)
    void task.then(done, done)
  }

  function updateAppearance(changes: Partial<ListeningAppearanceChoice>) {
    const inputs = appearanceInputs.current
    if (!inputs || !fingerprint.current || returnRequested.current) return
    setNavigationError('')
    setAppearanceStatus('Saving listening preferences…')
    const operation = ++appearanceOperation.current
    const node = Array.from(
      article.current?.querySelectorAll<HTMLElement>(
        '[data-listening-paragraph]',
      ) ?? [],
    ).find((element) => element.getBoundingClientRect().bottom > 85)
    if (node)
      scrollAnchor.current = { node, top: node.getBoundingClientRect().top }
    inputs.choice = normalizeListeningAppearance({
      ...inputs.choice,
      ...changes,
    })
    setAppearanceChoice(inputs.choice)
    setAppearance(
      resolveListeningAppearance(
        inputs.choice,
        inputs.reading.settings,
        inputs.typography,
        inputs.reading.dark,
      ),
    )
    const task = saveListeningAppearance(
      bookId,
      fingerprint.current,
      sessionId,
      changes,
    )
    track(task)
    void task.then(
      () => {
        if (operation === appearanceOperation.current)
          setAppearanceStatus('Listening preferences saved.')
      },
      (error: unknown) => {
        if (operation !== appearanceOperation.current) return
        setAppearanceStatus('')
        setNavigationError(
          error instanceof Error
            ? error.message
            : 'Could not save listening appearance.',
        )
      },
    )
  }

  useLayoutEffect(() => {
    const anchor = scrollAnchor.current
    if (!anchor) return
    scrollAnchor.current = undefined
    if (anchor.node.isConnected)
      window.scrollBy(0, anchor.node.getBoundingClientRect().top - anchor.top)
  }, [appearance])

  async function leaveListening(href: string, home = false) {
    if (returnRequested.current) return
    returnRequested.current = true
    setLeaving(true)
    setNavigationError('')
    try {
      await bookmarkQueue.current?.settled()
      while (saves.current.size) await Promise.all([...saves.current])
      await bookmarkQueue.current?.settled()
      if (home) reader.clear()
      setNavbar(false)
      const navigated = await router.push(href)
      if (!navigated)
        throw new Error(
          'Navigation was canceled. Your saved changes are kept; try Home again.',
        )
    } catch (problem) {
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
        const previous = panelView.current.action
        const restored = restoredView.action
        const nextTool = listeningToolbarTools.find(
          (tool) => tool.action === restored,
        )
        panelView.current = restoredView
        setToolAction(nextTool?.action)
        setToolsOpen(
          ['tools', 'bookmark-list', 'help'].includes(restored || ''),
        )
        setBookmarkListOpen(restored === 'bookmark-list')
        setHelpOpen(restored === 'help')
        if (!restored && previous) {
          const destination = listeningToolbarTools.find(
            (tool) => tool.action === previous,
          )
          requestAnimationFrame(() => {
            if (
              panelView.current.action ||
              document.activeElement === article.current
            )
              return
            if (destination)
              document
                .querySelector<HTMLElement>(
                  '[data-listening-tool="' + destination.action + '"]',
                )
                ?.focus({ preventScroll: true })
            else toolsSummary.current?.focus({ preventScroll: true })
          })
        }
      },
      (previous, next) =>
        previous.action === 'tools' &&
        ['bookmark-list', 'help'].includes(next.action || ''),
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
  }, [bookId, mobile, router, router.isReady, sessionId, variant])

  useEffect(() => {
    panel.current?.sync(panelView.current)
  }, [toolsOpen, bookmarkListOpen, helpOpen, toolAction])

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
      // Keep the launch immutable, but show the bookmark for the NEXT session.
      // The fingerprint is already verified. Read metadata instead of hashing
      // and loading the full EPUB a second time before showing its prose.
      const latest = sessionId ? await db?.listening.get(bookId) : launch.record
      const metadata = await db?.books.get(bookId)
      const reading = savedReaderAppearance()
      if (!active) return
      fingerprint.current = launch.record.fingerprint
      const choice = normalizeListeningAppearance(launch.record.appearance)
      appearanceInputs.current = {
        choice,
        reading,
        typography: metadata?.configuration?.typography,
      }
      setAppearanceChoice(choice)
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
              ...(appearance.textWidth
                ? { '--quiet-text-width': `${appearance.textWidth}ch` }
                : {}),
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
            event.preventDefault()
            await leaveListening(returnHref)
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
              if (event.currentTarget.open) closeTools()
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
            <QuietArticle session={session} article={article} />
            {appearance && (
              <ExcerptTools
                bookId={bookId}
                session={session}
                article={article}
                host={articleHost}
                action={toolAction}
                onAction={chooseTool}
                onClose={closeTools}
                appearance={appearance}
                appearanceChoice={appearanceChoice}
                appearanceStatus={appearanceStatus}
                onAppearance={updateAppearance}
                bookmarkBlock={
                  paragraphs.find((item) => sameBookmark(item, saved))?.blockId
                }
                rangeHref={returnHref}
                onRange={() => void leaveListening(returnHref)}
                track={track}
              />
            )}
            {appearance?.quickBookmarks !== false && (
              <QuietBookmarks
                host={articleHost}
                paragraphs={paragraphs}
                saved={saved}
                onBookmark={saveParagraph}
                layout={appearance}
              />
            )}
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
