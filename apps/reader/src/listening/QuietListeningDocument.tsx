import Head from 'next/head'
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { FiArrowLeft } from 'react-icons/fi'

import QuietBookmarks, {
  BookmarkParagraph,
  sameBookmark,
} from './QuietBookmarks'
import {
  buildQuietSession,
  getBookmarkParagraphs,
  getListeningParagraphs,
} from './document'
import {
  LibraryBookmarkChange,
  loadLibraryListeningBook,
  loadQuietLaunch,
  saveLibraryBookmark,
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
  return (
    paragraph && {
      ...paragraph,
      sectionId: section.id,
      sourceHref: section.sourceHref,
      chapterTitle: section.title,
    }
  )
}

export default function QuietListeningDocument({
  bookId,
  sessionId,
}: {
  bookId: string
  sessionId?: string
}) {
  const [session, setSession] = useState<QuietSession>()
  const [loadError, setLoadError] = useState('')
  const [toolsOpen, setToolsOpen] = useState(false)
  const [saved, setSaved] = useState<BookmarkParagraph>()
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [notice, setNotice] = useState('')
  const [undo, setUndo] = useState<LibraryBookmarkChange>()
  const [listSection, setListSection] = useState('')
  const articleHost = useRef<HTMLDivElement>(null)
  const toolsSummary = useRef<HTMLElement>(null)
  const saveInFlight = useRef(false)
  const fingerprint = useRef<string>()
  const loadedBook = useRef<LoadedListeningBook['book']>()
  const mounted = useRef(true)
  const returnHref = `/?book=${encodeURIComponent(bookId)}&listening=1${
    sessionId ? `&session=${encodeURIComponent(sessionId)}` : ''
  }`

  useEffect(() => {
    let active = true
    mounted.current = true
    async function load() {
      const launch = sessionId
        ? await loadQuietLaunch(bookId, sessionId)
        : await loadLibraryListeningBook(bookId)
      const prepared = buildQuietSession(launch.book, launch.record)
      // Keep the launch immutable, but show the bookmark for the NEXT session.
      const latest = sessionId ? await loadLibraryListeningBook(bookId) : launch
      if (!active) return
      loadedBook.current = launch.book
      fingerprint.current = launch.record.fingerprint
      setSaved(
        latest.record.startAt === 'marker'
          ? bookmarkedParagraph(launch.book, latest.record.marker)
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
      mounted.current = false
    }
  }, [bookId, sessionId])

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
  const finalSection = session?.sections[session.sections.length - 1]
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
    if (saveInFlight.current || !finalSection || sameBookmark(saved, paragraph))
      return
    saveInFlight.current = true
    setSaving(true)
    setSaveError('')
    setNotice('')
    try {
      const change = await saveLibraryBookmark(
        bookId,
        {
          sourceHref: paragraph.sourceHref,
          blockId: paragraph.blockId,
          text: paragraph.text,
          savedAt: Date.now(),
        },
        fingerprint.current,
        { from: paragraph.sourceHref, through: finalSection.sourceHref },
      )
      if (!mounted.current) return
      setSaved(paragraph)
      setUndo(change)
      setNotice(
        `Bookmark saved. Your next session starts in ${paragraph.chapterTitle} and continues through ${finalSection.title}.`,
      )
    } catch (error) {
      if (mounted.current)
        setSaveError(
          error instanceof Error
            ? error.message
            : 'The bookmark could not be saved. Please try again.',
        )
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
      setNotice(
        'Bookmark undone. Your previous listening start and range are restored.',
      )
    } catch (error) {
      if (mounted.current) {
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
    <main className="flow-quiet">
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
                <p>Start Read aloud from Edge’s menu.</p>
                <p className="flow-quiet-muted">
                  On Android, Edge’s menu controls Read aloud. If an installed
                  view hides that menu, open this same quiet document URL in the
                  Edge browser. Use the same Edge profile where you imported the
                  book.
                </p>
                <p className="flow-quiet-muted">
                  Return to the book to change the range or use notes and other
                  reading tools. Close these tools before listening.
                </p>
                <div className="flow-quiet-actions">
                  <a href={returnHref}>Edit session in Flow</a>
                </div>
                <div className="flow-quiet-marker-tools">
                  <h2>Bookmark</h2>
                  <p>
                    Pause Read aloud in Edge, then tap the bookmark before a
                    paragraph to set your next listening start. This document’s
                    text and current session stay unchanged.
                  </p>
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
                  <details className="flow-quiet-paragraph-list">
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
                <button
                  type="button"
                  className="flow-quiet-close"
                  onClick={() => {
                    setToolsOpen(false)
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
            <p role="status">
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
        <p className="flow-quiet-loading" role="status">
          Preparing the quiet document…
        </p>
      )}
    </main>
  )
}
