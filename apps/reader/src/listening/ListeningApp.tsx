import {
  ChangeEvent,
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import { ListeningBook, ListeningSection, prepareListeningBook } from './epub'
import {
  forgetListeningBook,
  ListeningPreferences,
  readSavedListeningBook,
  saveListeningBook,
} from './storage'

interface Session {
  title: string
  language: string
  sections: ListeningSection[]
}

function createSession(
  book: ListeningBook,
  preferences: ListeningPreferences,
): Session {
  const { start, end, paragraph, includeImageDescriptions } = preferences
  const sections = book.sections.slice(start, end + 1).map((s) => ({ ...s }))
  if (paragraph >= 0 && sections[0]) {
    const doc = new DOMParser().parseFromString(sections[0].html, 'text/html')
    const first = doc.querySelectorAll('p')[paragraph]
    if (first) {
      const range = doc.createRange()
      range.setStart(doc.body, 0)
      range.setEndBefore(first)
      range.deleteContents()
      sections[0].html = doc.body.innerHTML
    }
  }
  if (!includeImageDescriptions) {
    for (const section of sections) {
      const doc = new DOMParser().parseFromString(section.html, 'text/html')
      doc
        .querySelectorAll('.listening-image-description')
        .forEach((el) => el.remove())
      section.html = doc.body.innerHTML
    }
  }
  return { title: book.title, language: book.language, sections }
}

export interface ListeningAppProps {
  initialBookData?: Promise<ArrayBuffer>
  children?: ReactNode
  sessionActions?: ReactNode
  homeHref?: string
  persistSession?: boolean
}

export default function ListeningApp({
  initialBookData,
  children,
  sessionActions,
  homeHref = '/',
  persistSession = false,
}: ListeningAppProps) {
  const [isPhone, setIsPhone] = useState(false)
  const [book, setBook] = useState<ListeningBook>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [start, setStart] = useState(0)
  const [end, setEnd] = useState(0)
  const [paragraph, setParagraph] = useState(-1)
  const [includeImageDescriptions, setIncludeImageDescriptions] =
    useState(false)
  const [session, setSession] = useState<Session>()
  const [rawBook, setRawBook] = useState<ArrayBuffer>()
  const [storageReady, setStorageReady] = useState(!persistSession)
  const [storageStatus, setStorageStatus] = useState('')
  const [storageExists, setStorageExists] = useState(false)
  const [forgetting, setForgetting] = useState(false)
  const loadId = useRef(0)
  const saveRevision = useRef(0)
  const writeQueue = useRef(Promise.resolve())

  const load = useCallback(
    async (data: Promise<ArrayBuffer>, restored?: ListeningPreferences) => {
      const id = ++loadId.current
      // A previous book's pending save must not report this new book as saved.
      saveRevision.current++
      setStorageStatus('Opening your book…')
      setLoading(true)
      setError('')
      setSession(undefined)
      setBook(undefined)
      setRawBook(undefined)
      try {
        const buffer = await data
        const result = await prepareListeningBook(buffer)
        if (id !== loadId.current) return
        const lastSection = result.sections.length - 1
        const safeIndex = (
          value: number | undefined,
          fallback: number,
          min: number,
          max: number,
        ) =>
          Number.isInteger(value)
            ? Math.min(max, Math.max(min, value!))
            : fallback
        const restoredStart = safeIndex(restored?.start, 0, 0, lastSection)
        const preferences: ListeningPreferences = {
          start: restoredStart,
          end: safeIndex(
            restored?.end,
            lastSection,
            restoredStart,
            lastSection,
          ),
          paragraph: safeIndex(
            restored?.paragraph,
            -1,
            -1,
            Number.MAX_SAFE_INTEGER,
          ),
          includeImageDescriptions: restored?.includeImageDescriptions === true,
          prepared: restored?.prepared === true,
        }
        setBook(result)
        setRawBook(buffer)
        setStart(preferences.start)
        setEnd(preferences.end)
        setParagraph(preferences.paragraph)
        setIncludeImageDescriptions(preferences.includeImageDescriptions)
        if (preferences.prepared) setSession(createSession(result, preferences))
        return true
      } catch (err) {
        if (id === loadId.current) {
          setError(
            err instanceof Error ? err.message : 'Unable to open this EPUB.',
          )
          setStorageStatus(
            'This book was not saved. Any previously saved book is unchanged.',
          )
        }
      } finally {
        if (id === loadId.current) setLoading(false)
      }
    },
    [],
  )

  useEffect(() => {
    setIsPhone(/Android|iPhone|iPad|iPod/i.test(navigator.userAgent))
  }, [])

  useEffect(() => {
    document.title = `${
      book ? `${book.title} · ` : ''
    }Edge Listening Mode · Flow`
  }, [book])

  useEffect(() => {
    if (!initialBookData) return
    load(initialBookData)
    const requestId = loadId.current
    return () => {
      // Invalidate this initial request without canceling a newer file selection.
      if (loadId.current === requestId) loadId.current = requestId + 1
    }
  }, [initialBookData, load])

  useEffect(() => {
    if (!persistSession || initialBookData) {
      setStorageReady(true)
      return
    }
    let cancelled = false
    const requestId = loadId.current
    setStorageStatus('Checking for a saved book…')
    readSavedListeningBook()
      .then(async (saved) => {
        if (cancelled || requestId !== loadId.current) return
        if (saved) {
          setStorageExists(true)
          setStorageStatus('Restoring your saved book…')
          const restored = await load(
            Promise.resolve(saved.data),
            saved.preferences,
          )
          if (!cancelled && !restored && requestId + 1 === loadId.current) {
            setStorageStatus(
              'Could not restore the saved book. Open another EPUB or forget the saved book.',
            )
          }
        } else {
          setStorageStatus(
            'Your next book and chosen starting point will be saved on this device.',
          )
        }
      })
      .catch(() => {
        if (!cancelled)
          setStorageStatus(
            'Local storage is unavailable. You can still open and read a book, but it may not be saved.',
          )
      })
      .finally(() => {
        if (!cancelled) setStorageReady(true)
      })
    return () => {
      cancelled = true
    }
  }, [persistSession, initialBookData, load])

  const prepared = !!session
  useEffect(() => {
    if (!persistSession || !storageReady || !rawBook) return
    const revision = ++saveRevision.current
    setStorageStatus('Saving your book and starting point…')
    const nextWrite = writeQueue.current
      .catch(() => {})
      .then(() =>
        saveListeningBook({
          data: rawBook,
          preferences: {
            start,
            end,
            paragraph,
            includeImageDescriptions,
            prepared,
          },
        }),
      )
    writeQueue.current = nextWrite
    nextWrite
      .then(() => {
        if (revision !== saveRevision.current) return
        setStorageExists(true)
        setStorageStatus('Book and chosen starting point saved on this device.')
      })
      .catch(() => {
        if (revision === saveRevision.current)
          setStorageStatus(
            'Could not save this book. Keep this page open; reopening may lose your current session.',
          )
      })
  }, [
    persistSession,
    storageReady,
    rawBook,
    start,
    end,
    paragraph,
    includeImageDescriptions,
    prepared,
  ])

  const paragraphs = useMemo(() => {
    if (!book || typeof document === 'undefined') return []
    const doc = new DOMParser().parseFromString(
      book.sections[start]!.html,
      'text/html',
    )
    return Array.from(doc.querySelectorAll('p'))
      .map((p, index) => ({
        index,
        text: p.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      }))
      .filter((p) => p.text)
  }, [book, start])

  function prepare() {
    if (!book) return
    setSession(
      createSession(book, {
        start,
        end,
        paragraph,
        includeImageDescriptions,
        prepared: true,
      }),
    )
    window.scrollTo(0, 0)
  }

  async function forget() {
    loadId.current++
    saveRevision.current++
    setForgetting(true)
    setSession(undefined)
    setBook(undefined)
    setRawBook(undefined)
    setLoading(false)
    setError('')
    setStorageStatus('Removing the saved book…')
    const nextWrite = writeQueue.current
      .catch(() => {})
      .then(forgetListeningBook)
    writeQueue.current = nextWrite
    try {
      await nextWrite
      setStorageExists(false)
      setStorageStatus('Saved book removed from this device.')
    } catch {
      setStorageExists(true)
      setStorageStatus('Could not remove the saved book. Please try again.')
    } finally {
      setForgetting(false)
    }
  }

  function openFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (file) load(file.arrayBuffer())
    event.target.value = ''
  }

  if (persistSession && !storageReady) {
    return (
      <div className="listening-page">
        <main className="listening-setup">
          <p role="status">{storageStatus || 'Checking for a saved book…'}</p>
        </main>
      </div>
    )
  }

  return (
    <div className="listening-page">
      {session ? (
        <>
          <nav className="listening-session-nav" aria-label="Listening session">
            <button
              title="Stop Read Aloud before changing the session"
              onClick={() => setSession(undefined)}
            >
              ← Change session
            </button>
            <span>
              {isPhone
                ? 'Edge menu → Read aloud'
                : 'Read Aloud: Ctrl + Shift + U'}
            </span>
            {sessionActions}
            {persistSession && storageStatus.startsWith('Could not') && (
              <span role="status" className="listening-error">
                {storageStatus}
              </span>
            )}
          </nav>
          <main className="listening-text" lang={session.language || undefined}>
            <article aria-label={session.title}>
              {session.sections.map((section) => (
                <section
                  key={section.id}
                  id={section.id}
                  data-source-href={section.sourceHref}
                  dangerouslySetInnerHTML={{ __html: section.html }}
                />
              ))}
            </article>
          </main>
        </>
      ) : (
        <main className="listening-setup">
          <a className="listening-brand" href={homeHref}>
            flow <span>/ listening</span>
          </a>
          <div className="listening-eyebrow">MADE FOR MICROSOFT EDGE</div>
          <h1>
            Your book.
            <br />
            One continuous voice.
          </h1>
          <p className="listening-intro">
            Open an EPUB, choose where to begin, and let Edge read it aloud
            across chapters.
          </p>

          <div className="listening-card">
            <div className="listening-file-actions">
              <label className="listening-primary">
                Open an EPUB
                <input
                  aria-label="Open an EPUB"
                  type="file"
                  accept=".epub,application/epub+zip"
                  onChange={openFile}
                  disabled={loading || forgetting}
                />
              </label>
              <button
                className="listening-secondary"
                disabled={loading || forgetting}
                onClick={() =>
                  load(
                    fetch('/samples/alice.epub').then((r) => {
                      if (!r.ok)
                        throw new Error('Could not load the Alice sample.')
                      return r.arrayBuffer()
                    }),
                  )
                }
              >
                Try Alice in Wonderland
              </button>
            </div>
            {persistSession && (
              <div className="listening-storage">
                <p role="status">{storageStatus}</p>
                <p className="listening-storage-note">
                  Reopens from your chosen starting paragraph. Edge’s last
                  spoken word is not tracked.
                </p>
                {(book || storageExists) && (
                  <button type="button" onClick={forget} disabled={forgetting}>
                    Forget saved book
                  </button>
                )}
              </div>
            )}
            {loading && <p role="status">Preparing your book…</p>}
            {error && (
              <p role="alert" className="listening-error">
                {error}
              </p>
            )}
            {book && (
              <div className="listening-book-settings">
                <p className="listening-eyebrow">
                  READY TO PREPARE · {book.sections.length} SECTIONS
                </p>
                <h2>{book.title}</h2>
                {book.author && (
                  <p className="listening-author">{book.author}</p>
                )}
                <div className="listening-range">
                  <label>
                    Begin with
                    <select
                      value={start}
                      onChange={(e) => {
                        const value = Number(e.target.value)
                        setStart(value)
                        setEnd((previous) => Math.max(previous, value))
                        setParagraph(-1)
                      }}
                    >
                      {book.sections.map((s, i) => (
                        <option key={s.id} value={i}>
                          {s.title}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Continue through
                    <select
                      value={end}
                      onChange={(e) => setEnd(Number(e.target.value))}
                    >
                      {book.sections.map(
                        (s, i) =>
                          i >= start && (
                            <option key={s.id} value={i}>
                              {s.title}
                            </option>
                          ),
                      )}
                    </select>
                  </label>
                </div>
                <label className="listening-paragraph">
                  Starting paragraph
                  <select
                    value={paragraph}
                    onChange={(e) => setParagraph(Number(e.target.value))}
                  >
                    <option value={-1}>Beginning of section</option>
                    {paragraphs.map((p) => (
                      <option key={p.index} value={p.index}>
                        {p.index + 1}. {p.text.slice(0, 100)}
                        {p.text.length > 100 ? '…' : ''}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="listening-image-option">
                  <input
                    type="checkbox"
                    checked={includeImageDescriptions}
                    onChange={(e) =>
                      setIncludeImageDescriptions(e.target.checked)
                    }
                  />
                  Include image descriptions
                </label>
                <button className="listening-primary" onClick={prepare}>
                  Prepare listening page →
                </button>
              </div>
            )}
          </div>

          {children}

          <ol className="listening-instructions">
            <li>
              <b>Prepare your page</b>
              <span>
                All chosen sections load together. Keep this page open while
                listening.
              </span>
            </li>
            <li>
              <b>
                {isPhone ? 'Edge menu → Read aloud' : 'Press Ctrl + Shift + U'}
              </b>
              <span>
                {isPhone
                  ? 'Open the Edge menu and choose Read aloud. If the installed app has no Read aloud menu, open this page in Microsoft Edge.'
                  : 'Start Edge Read Aloud, then choose your voice and speed in its toolbar.'}
              </span>
            </li>
            <li>
              <b>Let the chapters flow</b>
              <span>
                Edge handles playback and word highlighting. Stop Read Aloud
                before changing the session.
              </span>
            </li>
          </ol>
          <p className="listening-note">
            Prototype · Books are processed on this device. Edge’s online voices
            send text to Microsoft for speech. Image descriptions are optional;
            printed captions are preserved.
          </p>
        </main>
      )}
    </div>
  )
}
