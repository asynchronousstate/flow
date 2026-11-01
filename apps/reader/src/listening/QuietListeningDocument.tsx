import Head from 'next/head'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FiArrowLeft } from 'react-icons/fi'

import { buildQuietSession, getListeningParagraphs } from './document'
import {
  loadLibraryListeningBook,
  loadQuietLaunch,
  saveLibraryMarker,
} from './integrated'

type QuietSession = ReturnType<typeof buildQuietSession>

interface ParagraphChoice {
  sectionId: string
  sourceHref: string
  chapterTitle: string
  blockId: string
  text: string
}

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
  const [marking, setMarking] = useState(false)
  const [chosen, setChosen] = useState<ParagraphChoice>()
  const [saved, setSaved] = useState<ParagraphChoice>()
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [listSection, setListSection] = useState('')
  const articleHost = useRef<HTMLDivElement>(null)
  const saveButton = useRef<HTMLButtonElement>(null)
  const savedNotice = useRef<HTMLDivElement>(null)
  const markerError = useRef<HTMLParagraphElement>(null)
  const toolsSummary = useRef<HTMLElement>(null)
  const saveInFlight = useRef(false)
  const fingerprint = useRef<string>()
  const mounted = useRef(true)
  const returnHref = `/?book=${encodeURIComponent(bookId)}&listening=1${
    sessionId ? `&session=${encodeURIComponent(sessionId)}` : ''
  }`

  useEffect(() => {
    let active = true
    mounted.current = true
    const loading = sessionId
      ? loadQuietLaunch(bookId, sessionId)
      : loadLibraryListeningBook(bookId)
    loading
      .then(({ book, record }) => {
        const prepared = buildQuietSession(book, record)
        if (!active) return
        fingerprint.current = record.fingerprint
        setSession(prepared)
        setListSection(prepared.sections[0]?.id || '')
      })
      .catch((error: unknown) => {
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
        getListeningParagraphs(section).map((paragraph) => ({
          ...paragraph,
          sectionId: section.id,
          sourceHref: section.sourceHref,
          chapterTitle: section.title,
        })),
      ) || [],
    [session],
  )
  const finalSection = session?.sections[session.sections.length - 1]

  const chooseForPreview = useCallback((paragraph: ParagraphChoice) => {
    setChosen(paragraph)
    setSaved(undefined)
    setSaveError('')
    // Also focus when the same list row is chosen a second time.
    saveButton.current?.focus()
  }, [])

  useEffect(() => {
    const host = articleHost.current
    if (!host || !marking || saving) return
    const chooseParagraph = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return
      let block = event.target.closest('[data-listening-paragraph]')
      if (!block) {
        const sourceBlock = event.target.closest('[data-listening-block]')
        const candidates = sourceBlock?.querySelectorAll(
          '[data-listening-paragraph]',
        )
        if (candidates?.length === 1) block = candidates[0] || null
        else if (candidates && candidates.length > 1) {
          event.preventDefault()
          setChosen(undefined)
          setSaveError(
            'This text block contains several paragraphs. Tap the exact text, or choose a paragraph from the list.',
          )
          return
        }
      }
      const section = block?.closest('[data-flow-quiet-section]')
      if (!block || !section || !host.contains(block)) return
      const blockId = block.getAttribute('data-listening-paragraph')
      const choice = paragraphs.find(
        (paragraph) =>
          paragraph.sectionId ===
            section.getAttribute('data-flow-quiet-section') &&
          paragraph.blockId === blockId,
      )
      if (!choice) return
      event.preventDefault()
      chooseForPreview(choice)
    }
    host.addEventListener('click', chooseParagraph)
    return () => host.removeEventListener('click', chooseParagraph)
  }, [chooseForPreview, marking, paragraphs, saving])

  useEffect(() => {
    if (chosen) saveButton.current?.focus()
  }, [chosen])

  useEffect(() => {
    if (saved) savedNotice.current?.focus()
  }, [saved])

  useEffect(() => {
    if (saveError) markerError.current?.focus()
  }, [saveError])

  async function saveParagraph(paragraph: ParagraphChoice) {
    if (saveInFlight.current || !finalSection) return
    saveInFlight.current = true
    setSaving(true)
    setSaveError('')
    try {
      await saveLibraryMarker(
        bookId,
        {
          sourceHref: paragraph.sourceHref,
          blockId: paragraph.blockId,
          text: paragraph.text,
          savedAt: Date.now(),
        },
        fingerprint.current,
        {
          from: paragraph.sourceHref,
          through: finalSection.sourceHref,
        },
      )
      if (!mounted.current) return
      setSaved(paragraph)
      setChosen(undefined)
      setMarking(false)
    } catch (error) {
      if (mounted.current)
        setSaveError(
          error instanceof Error
            ? error.message
            : 'The paragraph could not be saved. Please try again.',
        )
    } finally {
      saveInFlight.current = false
      if (mounted.current) setSaving(false)
    }
  }

  return (
    <main className={`flow-quiet${marking ? ' flow-quiet-marking' : ''}`}>
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
            onToggle={(event) => {
              const open = event.currentTarget.open
              setToolsOpen(open)
              if (!open) setMarking(false)
            }}
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
                  <button
                    type="button"
                    disabled={saving || !paragraphs.length}
                    aria-pressed={marking}
                    onClick={() => {
                      setMarking(!marking)
                      setChosen(undefined)
                      setSaved(undefined)
                      setSaveError('')
                    }}
                  >
                    {marking ? 'Cancel marking' : 'Mark a paragraph'}
                  </button>
                </div>
                {marking && (
                  <div className="flow-quiet-marker-tools">
                    <h2>Choose your next start</h2>
                    <p>
                      Pause Read aloud in Edge first. Then tap a paragraph in
                      the document, or choose one from the list below.
                    </p>
                    {chosen && (
                      <div className="flow-quiet-choice">
                        <p className="flow-quiet-label">Selected by you</p>
                        <p>{chosen.chapterTitle}</p>
                        <blockquote>{chosen.text}</blockquote>
                        <p>
                          Your next session will start at {chosen.chapterTitle}{' '}
                          and continue through {finalSection?.title}.
                        </p>
                        <button
                          ref={saveButton}
                          type="button"
                          className="flow-quiet-primary"
                          disabled={saving}
                          onClick={() => saveParagraph(chosen)}
                        >
                          {saving ? 'Saving…' : 'Save paragraph as next start'}
                        </button>
                      </div>
                    )}
                    <details className="flow-quiet-paragraph-list">
                      <summary>Choose from a paragraph list</summary>
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
                        {paragraphs
                          .filter(
                            (paragraph) => paragraph.sectionId === listSection,
                          )
                          .map((paragraph) => (
                            <li key={paragraph.blockId}>
                              <p>{paragraph.text}</p>
                              <button
                                type="button"
                                disabled={saving}
                                onClick={() => chooseForPreview(paragraph)}
                              >
                                Choose this paragraph
                              </button>
                            </li>
                          ))}
                      </ol>
                    </details>
                  </div>
                )}
                {saved && (
                  <div
                    ref={savedNotice}
                    className="flow-quiet-choice"
                    role="status"
                    tabIndex={-1}
                  >
                    <h2>Saved by you</h2>
                    <p>{saved.chapterTitle}</p>
                    <blockquote>{saved.text}</blockquote>
                    <p>
                      Your next session will start at this paragraph in{' '}
                      {saved.chapterTitle} and continue through{' '}
                      {finalSection?.title}. This document has not changed.
                    </p>
                  </div>
                )}
                {saveError && (
                  <p
                    ref={markerError}
                    className="flow-quiet-error"
                    role="alert"
                    tabIndex={-1}
                  >
                    {saveError}
                  </p>
                )}
                <button
                  type="button"
                  className="flow-quiet-close"
                  onClick={() => {
                    setToolsOpen(false)
                    setMarking(false)
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
          <p>
            Return to Flow to review the book, range and starting paragraph.
          </p>
          <a href={returnHref}>Review this book in Flow</a>
          <a href="/">Return to Flow library</a>
        </section>
      ) : session ? (
        <div ref={articleHost}>
          <QuietArticle session={session} />
        </div>
      ) : (
        <p className="flow-quiet-loading" role="status">
          Preparing the quiet document…
        </p>
      )}
    </main>
  )
}
