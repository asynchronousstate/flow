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
import { FiArrowLeft } from 'react-icons/fi'

import { db } from '../db'
import {
  createMobilePanelHistory,
  MobilePanelView,
} from '../hooks/panel-history'

import EdgeListeningHelp from './EdgeListeningHelp'
import PreparationStatus from './PreparationStatus'
import QuietBookmarks, {
  BookmarkParagraph,
  sameBookmark,
} from './QuietBookmarks'
import { resolveListeningAppearance, savedReaderAppearance } from './appearance'
import type { ListeningAppearance } from './appearance'
import { chapterForBookmark, resolveListeningChapter } from './chapters'
import {
  buildQuietSession,
  getBookmarkParagraphs,
  getListeningParagraphs,
} from './document'
import type { ListeningPreparationProgress } from './epub'
import {
  LibraryBookmarkChange,
  loadLibraryListeningBook,
  loadQuietLaunch,
  saveLibraryBookmark,
  retryListeningPreparation,
  undoLibraryBookmark,
} from './integrated'
import type { ListeningMarker, LoadedListeningBook } from './integrated'

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
  const [session, setSession] = useState<QuietSession>()
  const [loadError, setLoadError] = useState('')
  const [toolsOpen, setToolsOpen] = useState(false)
  const [saved, setSaved] = useState<BookmarkParagraph>()
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [notice, setNotice] = useState('')
  const [undo, setUndo] = useState<LibraryBookmarkChange>()
  const [listSection, setListSection] = useState('')
  const [appearance, setAppearance] = useState<ListeningAppearance>()
  const [progress, setProgress] = useState<ListeningPreparationProgress>()
  const [retry, setRetry] = useState(0)
  const [toast, setToast] = useState(false)
  const [bookmarkListOpen, setBookmarkListOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const panel = useRef<ReturnType<typeof createMobilePanelHistory>>()
  const panelView = useRef<MobilePanelView>({ bookId, navbar: false })
  panelView.current = {
    bookId,
    navbar: false,
    action: !toolsOpen
      ? undefined
      : bookmarkListOpen
      ? 'bookmark-list'
      : helpOpen
      ? 'help'
      : 'tools',
  }
  const retryPreparation = useCallback(() => {
    retryListeningPreparation(bookId)
    setRetry((value) => value + 1)
  }, [bookId])
  const articleHost = useRef<HTMLDivElement>(null)
  const toolsSummary = useRef<HTMLElement>(null)
  const saveInFlight = useRef(false)
  const fingerprint = useRef<string>()
  const loadedBook = useRef<LoadedListeningBook['book']>()
  const launchEnd = useRef<{ reference: string; title: string }>()
  const mounted = useRef(true)
  const returnHref = `/?book=${encodeURIComponent(bookId)}&listening=1${
    sessionId ? `&session=${encodeURIComponent(sessionId)}` : ''
  }`

  useEffect(() => {
    if (!mobile || !router.isReady) return
    const history = createMobilePanelHistory(
      window.history,
      () => window.location.pathname + window.location.search,
      () => panelView.current,
      (view) => {
        panelView.current = view
        setToolsOpen(!!view.action)
        setBookmarkListOpen(view.action === 'bookmark-list')
        setHelpOpen(view.action === 'help')
        toolsSummary.current?.focus()
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
  }, [bookId, mobile, router, router.isReady, sessionId])

  useEffect(() => {
    panel.current?.sync(panelView.current)
  }, [toolsOpen, bookmarkListOpen, helpOpen])

  useEffect(() => {
    let active = true
    const controller = new AbortController()
    mounted.current = true
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
      setAppearance(
        launch.appearance ||
          resolveListeningAppearance(
            launch.record.appearance,
            reading.settings,
            metadata?.configuration?.typography,
            reading.dark,
          ),
      )
      loadedBook.current = launch.book
      fingerprint.current = launch.record.fingerprint
      launchEnd.current = {
        reference: launch.record.through,
        title: resolveListeningChapter(
          launch.book,
          launch.record.through,
          'through',
        ).title,
      }
      setSaved(
        latest?.fingerprint === launch.record.fingerprint &&
          latest.startAt === 'marker'
          ? bookmarkedParagraph(launch.book, latest.marker)
          : undefined,
      )
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
      mounted.current = false
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

  async function saveParagraph(paragraph: BookmarkParagraph) {
    const book = loadedBook.current
    const end = launchEnd.current
    if (saveInFlight.current || !book || !end || sameBookmark(saved, paragraph))
      return
    saveInFlight.current = true
    setSaving(true)
    setSaveError('')
    setNotice('')
    try {
      const marker: ListeningMarker = {
        sourceHref: paragraph.sourceHref,
        blockId: paragraph.blockId,
        text: paragraph.text,
        savedAt: Date.now(),
      }
      const chapter = chapterForBookmark(book, marker)
      marker.chapterTitle = chapter.title
      const change = await saveLibraryBookmark(
        bookId,
        marker,
        fingerprint.current,
        { from: chapter.id, through: end.reference },
      )
      if (!mounted.current) return
      setSaved({ ...paragraph, chapterTitle: chapter.title })
      setUndo(change)
      setToast(true)
      setNotice(
        `Bookmark saved. Your next session starts in ${chapter.title} and continues through ${end.title}.`,
      )
    } catch (error) {
      if (mounted.current) {
        setToast(true)
        setSaveError(
          error instanceof Error
            ? error.message
            : 'The bookmark could not be saved. Please try again.',
        )
      }
    } finally {
      saveInFlight.current = false
      if (mounted.current) setSaving(false)
    }
  }

  async function undoBookmark() {
    if (saveInFlight.current || !undo || !loadedBook.current) return
    saveInFlight.current = true
    setSaving(true)
    setSaveError('')
    try {
      const restored = await undoLibraryBookmark(
        bookId,
        undo.record,
        undo.previous,
      )
      if (!mounted.current) return
      setSaved(
        restored.startAt === 'marker'
          ? bookmarkedParagraph(loadedBook.current, restored.marker)
          : undefined,
      )
      setUndo(undefined)
      setToast(true)
      setNotice(
        'Bookmark undone. Your previous listening start and range are restored.',
      )
    } catch (error) {
      if (mounted.current) {
        setToast(true)
        setUndo(undefined)
        setSaveError(
          error instanceof Error
            ? error.message
            : 'The bookmark could not be undone.',
        )
        // A newer change in another tab wins. Reflect its current selection.
        const latest = await loadLibraryListeningBook(bookId).catch(
          () => undefined,
        )
        if (mounted.current && latest)
          setSaved(
            latest.record.startAt === 'marker'
              ? bookmarkedParagraph(latest.book, latest.record.marker)
              : undefined,
          )
      }
    } finally {
      saveInFlight.current = false
      if (mounted.current) setSaving(false)
    }
  }

  return (
    <main
      className="flow-quiet"
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
        <title>
          {session ? `${session.title} · Flow` : 'Quiet document · Flow'}
        </title>
      </Head>
      <header className="flow-quiet-toolbar">
        <a className="flow-quiet-return" href={returnHref}>
          <FiArrowLeft aria-hidden="true" size={16} /> Return to book
        </a>
        {session && (
          <details
            className="flow-quiet-tools"
            open={toolsOpen}
            onToggle={(event) => setToolsOpen(event.currentTarget.open)}
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
                        <button
                          type="button"
                          disabled={saving}
                          onClick={undoBookmark}
                        >
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
                              disabled={saving}
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
                    toolsSummary.current?.focus()
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
              saving={saving}
              onBookmark={saveParagraph}
            />
          </div>
          <footer className="flow-quiet-bookmark-status">
            <p>
              {saving
                ? 'Saving bookmark…'
                : notice ||
                  (saved
                    ? `Bookmark: ${saved.chapterTitle}`
                    : 'Bookmark a paragraph to set your next listening start.')}
            </p>
            {undo && (
              <button type="button" disabled={saving} onClick={undoBookmark}>
                Undo bookmark
              </button>
            )}
            {saveError && (
              <p className="flow-quiet-error" role="alert">
                {saveError}
              </p>
            )}
          </footer>
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
        >
          <p role={saveError ? 'alert' : 'status'}>
            {saveError || (undo ? 'Bookmark saved for next time.' : notice)}
          </p>
          {undo && (
            <button type="button" disabled={saving} onClick={undoBookmark}>
              Undo
            </button>
          )}
          <button
            type="button"
            onClick={() => setToast(false)}
            aria-label="Dismiss Bookmark feedback"
          >
            Dismiss
          </button>
        </aside>
      )}
    </main>
  )
}
