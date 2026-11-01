import clsx from 'clsx'
import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useRef, useState } from 'react'
import FocusLock from 'react-focus-lock'
import { MdBookmarkBorder, MdClose, MdHeadset } from 'react-icons/md'

import { db } from '../../db'
import { useAction, useMobile } from '../../hooks'
import {
  buildQuietSession,
  getListeningParagraphs,
  sameSourceHref,
} from '../../listening/document'
import { ListeningBook } from '../../listening/epub'
import {
  IntegratedListeningRecord,
  ListeningMarker,
  createQuietLaunch,
  loadLibraryListeningBook,
  resetLibraryListeningBook,
  saveLibraryMarker,
  updateListeningRecord,
} from '../../listening/integrated'
import { reader, useReaderSnapshot } from '../../models'
import { PaneViewProps } from '../base'

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Could not prepare listening.'
}

function markerKey(marker?: ListeningMarker) {
  return marker
    ? `${marker.sourceHref}:${marker.blockId}:${marker.savedAt}`
    : ''
}

export function ListeningView({ className }: PaneViewProps) {
  const { focusedBookTab } = useReaderSnapshot()
  const [action, setAction] = useAction()
  const mobile = useMobile()
  const heading = useRef<HTMLHeadingElement>(null)
  const visible = action === 'listening'

  useEffect(() => {
    if (!visible || !mobile) return
    heading.current?.focus()
  }, [mobile, visible])

  return (
    <FocusLock
      disabled={!mobile || !visible}
      returnFocus
      className={clsx('flow-listening-focus-lock', className)}
    >
      <section
        className="flow-listening-panel"
        role={mobile ? 'dialog' : 'region'}
        aria-modal={mobile || undefined}
        aria-labelledby="flow-listening-heading"
        onKeyDown={(event) => {
          event.stopPropagation()
          if (event.key === 'Escape') setAction(mobile ? undefined : 'toc')
        }}
      >
        <header className="flow-listening-heading">
          <h2 id="flow-listening-heading" ref={heading} tabIndex={-1}>
            <MdHeadset aria-hidden="true" /> Listening range
          </h2>
          <button
            type="button"
            className="flow-listening-close"
            aria-label="Close listening"
            onClick={() => setAction(mobile ? undefined : 'toc')}
          >
            <MdClose aria-hidden="true" size={22} />
          </button>
        </header>
        {focusedBookTab ? (
          <ListeningBookPanel
            key={focusedBookTab.book.id}
            bookId={focusedBookTab.book.id}
          />
        ) : (
          <div className="flow-listening-body">
            <p>
              Open a book, then choose the chapters and paragraph to listen
              from.
            </p>
            <p className="flow-listening-hint">
              The library’s Listen action opens the book here.
            </p>
          </div>
        )}
      </section>
    </FocusLock>
  )
}

function ListeningBookPanel({ bookId }: { bookId: string }) {
  const { focusedBookTab } = useReaderSnapshot()
  const currentHref = focusedBookTab?.currentHref
  const stored = useLiveQuery(() => db?.listening.get(bookId), [bookId])
  const [book, setBook] = useState<ListeningBook>()
  const [draft, setDraft] = useState<IntegratedListeningRecord>()
  const [error, setError] = useState('')
  const [bookChanged, setBookChanged] = useState(false)
  const [retry, setRetry] = useState(0)
  const [saving, setSaving] = useState(false)
  const [savingMarker, setSavingMarker] = useState(false)
  const [fallbackHref, setFallbackHref] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [previewHref, setPreviewHref] = useState('')
  const [paragraphLimit, setParagraphLimit] = useState(20)
  const [notice, setNotice] = useState('')
  const appliedMarker = useRef({ key: '', savedAt: 0 })
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    setBook(undefined)
    setDraft(undefined)
    setError('')
    setBookChanged(false)
    loadLibraryListeningBook(bookId)
      .then((loaded) => {
        if (cancelled) return
        appliedMarker.current = {
          key: markerKey(loaded.record.marker),
          savedAt: loaded.record.marker?.savedAt ?? 0,
        }
        setBook(loaded.book)
        setDraft(loaded.record)
      })
      .catch((reason) => {
        if (!cancelled) {
          setError(errorMessage(reason))
          setBookChanged(reason?.code === 'BOOK_CHANGED')
        }
      })
    return () => {
      cancelled = true
    }
  }, [bookId, retry])

  // A selection or another quiet-document tab may save a marker while this
  // form is open. Merge that explicit choice without resetting draft ranges.
  useEffect(() => {
    if (!stored || !draft || stored.fingerprint !== draft.fingerprint) return
    const marker = stored.marker
    const key = markerKey(marker)
    if (
      !marker ||
      key === appliedMarker.current.key ||
      marker.savedAt < appliedMarker.current.savedAt
    )
      return
    appliedMarker.current = { key, savedAt: marker.savedAt }
    setDraft((current) =>
      current ? { ...current, marker, startAt: 'marker' } : current,
    )
    setNotice('Saved by you. Your chapter range is unchanged.')
    setFallbackHref('')
  }, [draft, stored])

  const sections = book?.sections ?? []
  const fromIndex = sections.findIndex(
    (section) => section.sourceHref === draft?.from,
  )
  const throughIndex = sections.findIndex(
    (section) => section.sourceHref === draft?.through,
  )
  const markerIndex = sections.findIndex(
    (section) =>
      !!draft?.marker &&
      sameSourceHref(section.sourceHref, draft.marker.sourceHref),
  )
  const markerNeedsFrom =
    draft?.startAt === 'marker' && markerIndex >= 0 && markerIndex !== fromIndex
  const markerOutside = markerIndex < fromIndex || markerIndex > throughIndex
  const fromSection = sections[fromIndex]
  const throughSection = sections[throughIndex]
  const markerSection = sections[markerIndex]

  const validation = useMemo(() => {
    if (!book || !draft) return ''
    try {
      buildQuietSession(book, draft)
      return ''
    } catch (reason) {
      return errorMessage(reason)
    }
  }, [book, draft])

  const previewSection =
    sections.find((section) => section.sourceHref === previewHref) ??
    fromSection
  const paragraphs = useMemo(
    () => (previewSection ? getListeningParagraphs(previewSection) : []),
    [previewSection],
  )

  function changePlan(changes: Partial<IntegratedListeningRecord>) {
    setDraft((current) => (current ? { ...current, ...changes } : current))
    if (changes.from) {
      setPreviewHref(changes.from)
      setParagraphLimit(20)
    }
    setError('')
    setNotice('')
    setFallbackHref('')
  }

  async function saveParagraph(blockId: string, text: string) {
    if (!previewSection || !draft) return
    setSavingMarker(true)
    setError('')
    try {
      const marker: ListeningMarker = {
        sourceHref: previewSection.sourceHref,
        blockId,
        text,
        savedAt: Date.now(),
      }
      const saved = await saveLibraryMarker(bookId, marker, draft.fingerprint)
      if (!alive.current) return
      const nextMarker = saved.marker ?? marker
      appliedMarker.current = {
        key: markerKey(nextMarker),
        savedAt: nextMarker.savedAt,
      }
      setDraft((current) =>
        current
          ? { ...current, marker: nextMarker, startAt: 'marker' }
          : current,
      )
      setNotice('Saved by you. Your chapter range is unchanged.')
      setFallbackHref('')
      setPickerOpen(false)
    } catch (reason) {
      if (alive.current) {
        setError(errorMessage(reason))
        setBookChanged((reason as { code?: string })?.code === 'BOOK_CHANGED')
      }
    } finally {
      if (alive.current) setSavingMarker(false)
    }
  }

  async function openQuietDocument() {
    if (!draft || !book || validation || markerNeedsFrom) return
    // Open within the click gesture, then navigate only after IndexedDB commits.
    // Otherwise popup blocking or a load-before-save race can use the old plan.
    const companion = window.open('about:blank', '_blank')
    if (companion) companion.opener = null
    const tab = reader.focusedBookTab
    const returnCfi =
      tab?.book.id === bookId
        ? tab.location?.start.cfi ?? tab.book.cfi
        : draft.returnCfi
    setSaving(true)
    setError('')
    setFallbackHref('')
    try {
      const saved = await updateListeningRecord(
        bookId,
        {
          from: draft.from,
          through: draft.through,
          startAt: draft.startAt,
          returnCfi,
        },
        draft.fingerprint,
      )
      const launch = {
        ...saved,
        marker: draft.startAt === 'marker' ? draft.marker : saved.marker,
      }
      buildQuietSession(book, launch)
      const sessionId = await createQuietLaunch(bookId, launch)
      const href = `/listen?book=${encodeURIComponent(
        bookId,
      )}&session=${encodeURIComponent(sessionId)}`
      if (companion && !companion.closed) {
        companion.location.replace(href)
      } else if (alive.current) {
        setFallbackHref(href)
        setNotice('Your range is saved. Open the quiet document below.')
      }
    } catch (reason) {
      companion?.close()
      if (alive.current) {
        setError(errorMessage(reason))
        setBookChanged((reason as { code?: string })?.code === 'BOOK_CHANGED')
      }
    } finally {
      if (alive.current) setSaving(false)
    }
  }

  if (!book || !draft || bookChanged) {
    return (
      <div className="flow-listening-body">
        {error ? (
          <>
            <p role="alert" className="flow-listening-error">
              {error}
            </p>
            {bookChanged ? (
              <>
                <p className="flow-listening-hint">
                  Reset the old listening range and saved paragraph for this
                  version. Your book and annotations stay in your library.
                </p>
                <button
                  type="button"
                  className="flow-listening-secondary"
                  disabled={saving}
                  onClick={async () => {
                    setSaving(true)
                    try {
                      await resetLibraryListeningBook(bookId)
                      if (alive.current) setRetry((value) => value + 1)
                    } catch (reason) {
                      if (alive.current) setError(errorMessage(reason))
                    } finally {
                      if (alive.current) setSaving(false)
                    }
                  }}
                >
                  {saving
                    ? 'Resetting…'
                    : 'Reset listening setup for this version'}
                </button>
              </>
            ) : (
              <button
                type="button"
                className="flow-listening-secondary"
                onClick={() => setRetry((value) => value + 1)}
              >
                Try again
              </button>
            )}
          </>
        ) : (
          <p role="status">Preparing this book…</p>
        )}
      </div>
    )
  }

  return (
    <div className="flow-listening-body" aria-busy={saving || savingMarker}>
      <p className="flow-listening-book-title">{book.title}</p>
      <p className="flow-listening-hint">
        Choose a range, then open its continuous text in a quiet document.
      </p>
      <fieldset className="flow-listening-fields" disabled={saving}>
        <legend>Chapters</legend>
        <label htmlFor="flow-listening-from">From</label>
        <select
          id="flow-listening-from"
          value={draft.from}
          onChange={(event) => changePlan({ from: event.target.value })}
        >
          {sections.map((section) => (
            <option key={section.id} value={section.sourceHref}>
              {section.title}
            </option>
          ))}
        </select>
        <label htmlFor="flow-listening-through">Through</label>
        <select
          id="flow-listening-through"
          value={draft.through}
          onChange={(event) => changePlan({ through: event.target.value })}
        >
          {sections.map((section) => (
            <option key={section.id} value={section.sourceHref}>
              {section.title}
            </option>
          ))}
        </select>
      </fieldset>

      <fieldset className="flow-listening-start" disabled={saving}>
        <legend>Start at</legend>
        <label>
          <input
            type="radio"
            name={`flow-listening-start-${bookId}`}
            checked={draft.startAt === 'chapter'}
            onChange={() => changePlan({ startAt: 'chapter' })}
          />
          Chapter beginning
        </label>
        <label>
          <input
            type="radio"
            name={`flow-listening-start-${bookId}`}
            checked={draft.startAt === 'marker'}
            disabled={!draft.marker}
            onChange={() => changePlan({ startAt: 'marker' })}
          />
          <span>
            <MdBookmarkBorder aria-hidden="true" /> Saved by you
          </span>
        </label>
        {draft.marker ? (
          <div className="flow-listening-marker">
            <p className="flow-listening-hint">
              {markerSection?.title ?? 'Saved chapter unavailable'}
            </p>
            <blockquote>{draft.marker.text}</blockquote>
            <p className="flow-listening-hint">
              Saved on this device. This does not track Edge’s spoken position.
            </p>
          </div>
        ) : (
          <p className="flow-listening-hint">
            Select text in the book and choose “Use as listening start”, or
            choose a paragraph below.
          </p>
        )}
      </fieldset>

      {markerNeedsFrom && (
        <div className="flow-listening-resolution" role="alert">
          <p>
            {markerOutside
              ? 'Your saved paragraph is outside this range.'
              : 'Your saved paragraph is in a different From chapter.'}
          </p>
          <p className="flow-listening-hint">
            Choose which start to use before opening.
          </p>
          <button
            type="button"
            className="flow-listening-secondary"
            disabled={saving}
            onClick={() => changePlan({ from: markerSection!.sourceHref })}
          >
            Update From to saved chapter
          </button>
          <button
            type="button"
            className="flow-listening-text-button"
            disabled={saving}
            onClick={() => changePlan({ startAt: 'chapter' })}
          >
            Use chapter beginning
          </button>
        </div>
      )}

      {validation && (!markerNeedsFrom || throughIndex < fromIndex) && (
        <p role="alert" className="flow-listening-error">
          {validation}
        </p>
      )}

      <div className="flow-listening-picker">
        <button
          type="button"
          className="flow-listening-secondary"
          aria-expanded={pickerOpen}
          aria-controls="flow-listening-paragraph-picker"
          disabled={saving || savingMarker}
          onClick={() => {
            if (!pickerOpen && !previewHref) {
              const current = sections.find(
                (section) =>
                  currentHref &&
                  sameSourceHref(section.sourceHref, currentHref),
              )
              setPreviewHref(current?.sourceHref ?? draft.from)
              setParagraphLimit(20)
            }
            setPickerOpen(!pickerOpen)
          }}
        >
          {pickerOpen ? 'Close paragraph picker' : 'Choose a paragraph'}
        </button>
        {pickerOpen && (
          <div id="flow-listening-paragraph-picker">
            <label htmlFor="flow-listening-preview">Preview chapter</label>
            <select
              id="flow-listening-preview"
              value={previewSection?.sourceHref ?? ''}
              disabled={savingMarker}
              onChange={(event) => {
                setPreviewHref(event.target.value)
                setParagraphLimit(20)
              }}
            >
              {sections.map((section) => (
                <option key={section.id} value={section.sourceHref}>
                  {section.title}
                </option>
              ))}
            </select>
            <p className="flow-listening-hint">
              Each button saves that whole paragraph as your listening start.
            </p>
            <ol className="flow-listening-paragraphs">
              {paragraphs.slice(0, paragraphLimit).map((paragraph, index) => (
                <li key={paragraph.blockId}>
                  <button
                    type="button"
                    disabled={savingMarker}
                    onClick={() =>
                      saveParagraph(paragraph.blockId, paragraph.text)
                    }
                  >
                    <span className="flow-listening-paragraph-number">
                      Paragraph {index + 1}
                    </span>
                    <span>{paragraph.text}</span>
                  </button>
                </li>
              ))}
            </ol>
            {!paragraphs.length && (
              <p>
                No selectable paragraphs in this section. Choose another
                chapter.
              </p>
            )}
            {paragraphs.length > paragraphLimit && (
              <button
                type="button"
                className="flow-listening-text-button"
                onClick={() => setParagraphLimit((value) => value + 20)}
              >
                Show more paragraphs
              </button>
            )}
          </div>
        )}
      </div>

      <div className="flow-listening-summary">
        <strong>Selected range</strong>
        <p>
          {fromSection?.title} → {throughSection?.title}
        </p>
        <strong>Effective start</strong>
        <p>
          {validation || markerNeedsFrom
            ? 'Resolve the range above.'
            : draft.startAt === 'marker'
            ? `Your saved paragraph in ${markerSection?.title}`
            : `Beginning of ${fromSection?.title}`}
        </p>
      </div>
      {error && (
        <p role="alert" className="flow-listening-error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="flow-listening-hint">
          {notice}
        </p>
      )}
      <button
        type="button"
        className="flow-listening-primary"
        disabled={saving || savingMarker || !!validation || markerNeedsFrom}
        onClick={openQuietDocument}
      >
        {saving ? 'Preparing quiet document…' : 'Open quiet document'}
      </button>
      {fallbackHref && (
        <a
          className="flow-listening-secondary"
          href={fallbackHref}
          target="_blank"
          rel="noreferrer"
        >
          Open saved quiet document
        </a>
      )}
      <p className="flow-listening-hint">
        Then use Edge’s Read aloud menu. Edge starts and controls the audio.
      </p>
      <p className="flow-listening-hint">
        On Android, choose Read aloud from Edge’s menu. If an installed view
        hides that menu, open the same quiet document URL in the Edge browser.
        Use the same Edge profile for importing and listening so your book is
        available.
      </p>
    </div>
  )
}
