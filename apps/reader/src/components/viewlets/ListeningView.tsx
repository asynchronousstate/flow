import clsx from 'clsx'
import { useLiveQuery } from 'dexie-react-hooks'
import { useRouter } from 'next/router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import FocusLock from 'react-focus-lock'
import { MdBookmarkBorder, MdClose, MdHeadset } from 'react-icons/md'

import { db } from '../../db'
import { isMobilePanelRestoration, useAction, useMobile } from '../../hooks'
import EdgeListeningHelp from '../../listening/EdgeListeningHelp'
import PreparationStatus from '../../listening/PreparationStatus'
import { defaultListeningAppearance } from '../../listening/appearance'
import type { ListeningAppearanceChoice } from '../../listening/appearance'
import {
  chapterForBookmark,
  getListeningChapters,
  isBookmarkInListeningRange,
  resolveListeningChapter,
  validateListeningBookmark,
  validateListeningRange,
} from '../../listening/chapters'
import type { ListeningChapter } from '../../listening/chapters'
import { ListeningBook } from '../../listening/epub'
import type { ListeningPreparationProgress } from '../../listening/epub'
import {
  IntegratedListeningRecord,
  createQuietLaunch,
  loadLibraryListeningBook,
  resetLibraryListeningBook,
  retryListeningPreparation,
  updateListeningRecord,
} from '../../listening/integrated'
import {
  AppliedListeningPlan,
  captureListeningPlan,
  defaultListeningStart,
  displayListeningChapterReference,
  reconcileListeningPlan,
} from '../../listening/plan'
import { reader, useReaderSnapshot } from '../../models'
import { PaneViewProps } from '../base'

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Could not prepare listening.'
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
            visible={visible}
          />
        ) : (
          <div className="flow-listening-body">
            <p>Open a book, then choose the chapters to listen to.</p>
            <p className="flow-listening-hint">
              The library’s Listen action opens the book here.
            </p>
          </div>
        )}
      </section>
    </FocusLock>
  )
}

function ListeningBookPanel({
  bookId,
  visible,
}: {
  bookId: string
  visible: boolean
}) {
  const router = useRouter()
  const stored = useLiveQuery(() => db?.listening.get(bookId), [bookId])
  const [book, setBook] = useState<ListeningBook>()
  const [draft, setDraft] = useState<IntegratedListeningRecord>()
  const [error, setError] = useState('')
  const [bookChanged, setBookChanged] = useState(false)
  const [retry, setRetry] = useState(0)
  const [saving, setSaving] = useState(false)
  const [fallbackHref, setFallbackHref] = useState('')
  const [notice, setNotice] = useState('')
  const [opening, setOpening] = useState(0)
  const [enabled, setEnabled] = useState(visible)
  const [progress, setProgress] = useState<ListeningPreparationProgress>()
  const launching = useRef(false)
  const retryPreparation = useCallback(() => {
    retryListeningPreparation(bookId)
    setRetry((value) => value + 1)
  }, [bookId])
  const appliedPlan = useRef<AppliedListeningPlan>()
  const manualStartChoice = useRef(false)
  const entry = useRef({ visible: false, first: true })
  const pendingDefault = useRef(false)
  const alive = useRef(true)
  const resumeSession =
    router.query.book === bookId &&
    router.query.listening === '1' &&
    typeof router.query.session === 'string'
      ? router.query.session
      : undefined

  useEffect(() => {
    if (visible) setEnabled(true)
  }, [visible])

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  useEffect(() => {
    if (!router.isReady) return
    if (visible && !entry.current.visible) {
      // This component remains mounted behind other reader panels. Default
      // only on an actual entry, never on a rerender or a tab's Back action.
      const resuming =
        (entry.current.first && !!resumeSession) ||
        isMobilePanelRestoration(bookId, 'listening')
      pendingDefault.current = !resuming
      if (!resuming) manualStartChoice.current = false
      entry.current.first = false
      setOpening((value) => value + 1)
    }
    entry.current.visible = visible
  }, [bookId, resumeSession, router.isReady, visible])

  useEffect(() => {
    if (!router.isReady || !enabled) return
    let cancelled = false
    const controller = new AbortController()
    setBook(undefined)
    setDraft(undefined)
    setError('')
    setBookChanged(false)
    setProgress(undefined)
    async function load() {
      const loaded = await loadLibraryListeningBook(bookId, {
        signal: controller.signal,
        onProgress: (next) => {
          if (!cancelled) setProgress(next)
        },
      })
      // The EPUB fingerprint was just verified above. Read only launch
      // metadata to preserve the preview's explicit mode when returning.
      const launch = resumeSession
        ? await db?.listeningSessions.get(resumeSession)
        : undefined
      if (cancelled) return
      const resuming =
        launch?.bookId === bookId &&
        launch.fingerprint === loaded.record.fingerprint
      appliedPlan.current = captureListeningPlan(loaded.record)
      if (resuming) manualStartChoice.current = true
      setBook(loaded.book)
      setDraft(
        resuming
          ? { ...loaded.record, startAt: launch.plan.startAt }
          : loaded.record,
      )
    }
    load().catch((reason) => {
      if (!cancelled) {
        setError(errorMessage(reason))
        setBookChanged(reason?.code === 'BOOK_CHANGED')
      }
    })
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [bookId, enabled, resumeSession, retry, router.isReady])

  // Keep a manually chosen start mode and range while the saved preview follows
  // newer bookmarks/Undo. A removed or stale Bookmark cannot remain active.
  useEffect(() => {
    if (!stored || !draft || !book) return
    if (
      appliedPlan.current &&
      stored.updatedAt <= appliedPlan.current.updatedAt
    )
      return
    const next = reconcileListeningPlan(draft, stored, appliedPlan.current, {
      preserveStartChoice: manualStartChoice.current,
      bookmarkAvailable:
        !!stored.marker && !validateListeningBookmark(book, stored.marker),
    })
    appliedPlan.current = next.applied
    if (!next.changed) return
    setDraft((current) =>
      current
        ? { ...current, marker: next.draft.marker, startAt: next.draft.startAt }
        : current,
    )
    setNotice('Saved Bookmark updated. Your chapter range is unchanged.')
    setFallbackHref('')
  }, [book, draft, stored])

  const bookmark = useMemo(() => {
    if (!book || !draft?.marker) return { available: false, chapter: undefined }
    try {
      return {
        available: true,
        chapter: chapterForBookmark(book, draft.marker),
      }
    } catch {
      return { available: false, chapter: undefined }
    }
  }, [book, draft?.marker])

  useEffect(() => {
    if (!book || !draft) return
    const freshOpening = visible && pendingDefault.current
    if (freshOpening) pendingDefault.current = false
    const next = defaultListeningStart(draft, bookmark.available, freshOpening)
    if (freshOpening || next !== draft)
      setDraft((current) => {
        if (!current) return current
        // A live-query update can already be queued in this same effect flush.
        // Default against that latest marker, not the previous render's preview.
        const available =
          current.marker === draft.marker
            ? bookmark.available
            : !!current.marker &&
              !validateListeningBookmark(book, current.marker)
        return defaultListeningStart(current, available, freshOpening)
      })
  }, [book, bookmark.available, draft, opening, visible])

  const chapters = useMemo(
    () => (book ? getListeningChapters(book) : []),
    [book],
  )
  const chapterChoices = useMemo(() => {
    const options: Pick<
      ListeningChapter,
      'id' | 'label' | 'depth' | 'disabled' | 'reason'
    >[] = [...chapters]
    const values = { from: draft?.from || '', through: draft?.through || '' }
    if (!book || !draft) return { options, ...values }
    for (const edge of ['from', 'through'] as const) {
      const reference = draft[edge]
      if (options.some((chapter) => chapter.id === reference)) continue
      try {
        // Legacy whole-file ranges stay whole-file. Never silently substitute
        // the first fragment of a source file containing several TOC chapters.
        const resolved = resolveListeningChapter(book, reference, edge)
        values[edge] = displayListeningChapterReference(
          reference,
          resolved,
          chapters,
        )
        if (values[edge] !== reference) continue
        const spansFragments =
          resolved.fallback &&
          chapters.some(
            (chapter) =>
              chapter.sourceHref === resolved.sourceHref &&
              chapter.href.includes('#'),
          )
        options.push({
          ...resolved,
          id: reference,
          label: spansFragments
            ? `${resolved.label} (entire section)`
            : resolved.label,
        })
      } catch (reason) {
        options.push({
          id: reference,
          label: 'Saved chapter unavailable',
          depth: 0,
          disabled: true,
          reason: errorMessage(reason),
        })
      }
    }
    return { options, ...values }
  }, [book, chapters, draft])
  const chapterOptions = chapterChoices.options

  const startAt = bookmark.available ? draft?.startAt : 'chapter'
  const fromChapter = chapterOptions.find(
    (chapter) => chapter.id === chapterChoices.from,
  )
  const throughChapter = chapterOptions.find(
    (chapter) => chapter.id === chapterChoices.through,
  )
  const validation = useMemo(() => {
    if (!book || !draft) return ''
    const rangeError = validateListeningRange(book, draft)
    if (rangeError) return rangeError
    try {
      if (
        startAt === 'marker' &&
        draft.marker &&
        !isBookmarkInListeningRange(
          book,
          draft.marker,
          draft.from,
          draft.through,
        )
      )
        return `Your Bookmark is in ${
          bookmark.chapter?.label || 'another chapter'
        }, outside this range. Include that chapter, or choose Chapter beginning.`
      return ''
    } catch (reason) {
      return errorMessage(reason)
    }
  }, [book, bookmark.chapter, draft, startAt])

  function changePlan(changes: Partial<IntegratedListeningRecord>) {
    if (changes.startAt) {
      manualStartChoice.current = true
      pendingDefault.current = false
    }
    setDraft((current) => (current ? { ...current, ...changes } : current))
    setError('')
    setNotice('')
    setFallbackHref('')
  }

  async function openQuietDocument() {
    if (!draft || !book || validation || launching.current) return
    launching.current = true
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
          startAt: startAt || 'chapter',
          returnCfi,
          appearance: draft.appearance ?? defaultListeningAppearance,
        },
        draft.fingerprint,
      )
      const launch = {
        ...saved,
        marker: startAt === 'marker' ? draft.marker : saved.marker,
      }
      const sessionId = await createQuietLaunch(bookId, launch)
      const href = `/listen?book=${encodeURIComponent(
        bookId,
      )}&session=${encodeURIComponent(sessionId)}`
      if (companion && !companion.closed) companion.location.replace(href)
      else if (alive.current) {
        setFallbackHref(href)
        setNotice('Your range is saved. Open the listening view below.')
      }
    } catch (reason) {
      companion?.close()
      if (alive.current) {
        setError(errorMessage(reason))
        setBookChanged((reason as { code?: string })?.code === 'BOOK_CHANGED')
      }
    } finally {
      launching.current = false
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
                  Reset the old listening range and bookmark for this version.
                  Your book and annotations stay in your library.
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
                onClick={retryPreparation}
              >
                Try again
              </button>
            )}
          </>
        ) : (
          <PreparationStatus
            key={retry}
            progress={progress}
            onRetry={retryPreparation}
          />
        )}
      </div>
    )
  }

  const excerpt = draft.marker?.text.replace(/\s+/g, ' ').trim() || ''
  const shortExcerpt =
    excerpt.length > 180 ? `${excerpt.slice(0, 177).trimEnd()}…` : excerpt

  return (
    <div className="flow-listening-session" aria-busy={saving}>
      <div className="flow-listening-body">
        <p className="flow-listening-book-title">{book.title}</p>
        <fieldset className="flow-listening-fields" disabled={saving}>
          <legend>Chapters</legend>
          <label htmlFor="flow-listening-from">From</label>
          <select
            id="flow-listening-from"
            value={chapterChoices.from}
            aria-describedby="flow-listening-summary"
            onChange={(event) => changePlan({ from: event.target.value })}
          >
            {chapterOptions.map((chapter) => (
              <option
                key={chapter.id}
                value={chapter.id}
                disabled={chapter.disabled}
                title={chapter.reason}
              >
                {'\u00a0\u00a0'.repeat(Math.min(chapter.depth, 4))}
                {chapter.label}
              </option>
            ))}
          </select>
          <label htmlFor="flow-listening-through">Through</label>
          <select
            id="flow-listening-through"
            value={chapterChoices.through}
            aria-describedby="flow-listening-summary"
            onChange={(event) => changePlan({ through: event.target.value })}
          >
            {chapterOptions.map((chapter) => (
              <option
                key={chapter.id}
                value={chapter.id}
                disabled={chapter.disabled}
                title={chapter.reason}
              >
                {'\u00a0\u00a0'.repeat(Math.min(chapter.depth, 4))}
                {chapter.label}
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
              checked={startAt === 'chapter'}
              onChange={() => changePlan({ startAt: 'chapter' })}
            />
            Chapter beginning
          </label>
          <label>
            <input
              type="radio"
              name={`flow-listening-start-${bookId}`}
              checked={startAt === 'marker'}
              disabled={!bookmark.available}
              onChange={() => changePlan({ startAt: 'marker' })}
            />
            <span>
              <MdBookmarkBorder aria-hidden="true" /> Start from Bookmark
            </span>
          </label>
          {bookmark.available ? (
            <div className="flow-listening-marker">
              <p className="flow-listening-hint">{bookmark.chapter?.label}</p>
              <blockquote>{shortExcerpt}</blockquote>
              <p className="flow-listening-hint">
                Saved on this device. Used for your next listening session.
              </p>
            </div>
          ) : (
            <p className="flow-listening-hint">
              {draft.marker
                ? 'This Bookmark is unavailable for this EPUB. Save a new Bookmark while reading.'
                : 'No saved Bookmark yet. Save one while reading or in the listening document.'}
            </p>
          )}
        </fieldset>

        {validation && (
          <p role="alert" className="flow-listening-error">
            {validation}
          </p>
        )}
        <div
          id="flow-listening-summary"
          className="flow-listening-summary"
          aria-live="polite"
        >
          <p>
            {fromChapter?.label} → {throughChapter?.label}
          </p>
          <p>
            {validation
              ? 'Resolve the range above.'
              : startAt === 'marker'
              ? `Starts at your Bookmark in ${bookmark.chapter?.label}. Any earlier text in this range is skipped.`
              : `Starts at the beginning of ${fromChapter?.label}.`}
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
        <details className="flow-listening-appearance">
          <summary>Listening appearance</summary>
          <p className="flow-listening-hint">
            Applies when you open the next listening view. Your active document
            stays unchanged.
          </p>
          <label htmlFor="flow-listening-preset">Text</label>
          <select
            id="flow-listening-preset"
            value={draft.appearance?.preset ?? 'comfortable'}
            onChange={(event) =>
              changePlan({
                appearance: {
                  ...(draft.appearance ?? defaultListeningAppearance),
                  preset: event.target
                    .value as ListeningAppearanceChoice['preset'],
                  ...(event.target.value === 'reading'
                    ? { theme: 'reading' as const }
                    : {}),
                },
              })
            }
          >
            <option value="comfortable">Comfortable</option>
            <option value="large">Large text</option>
            <option value="compact">Compact</option>
            <option value="reading">Use reading appearance</option>
          </select>
          <label htmlFor="flow-listening-theme">Theme</label>
          <select
            id="flow-listening-theme"
            value={draft.appearance?.theme ?? 'light'}
            onChange={(event) =>
              changePlan({
                appearance: {
                  ...(draft.appearance ?? defaultListeningAppearance),
                  theme: event.target
                    .value as ListeningAppearanceChoice['theme'],
                },
              })
            }
          >
            <option value="light">Light</option>
            <option value="dark">Dark</option>
            <option value="sepia">Sepia</option>
            <option value="reading">Use reading theme</option>
          </select>
        </details>
        <details className="flow-listening-help">
          <summary>How to listen in Edge</summary>
          <EdgeListeningHelp />
        </details>
      </div>
      <div className="flow-listening-launch">
        <button
          type="button"
          className="flow-listening-primary"
          disabled={saving || !!validation}
          onClick={openQuietDocument}
        >
          {saving ? 'Preparing listening view…' : 'Open listening view'}
        </button>
        {fallbackHref && (
          <a
            className="flow-listening-secondary"
            href={fallbackHref}
            target="_blank"
            rel="noreferrer"
          >
            Open saved listening view
          </a>
        )}
        <p className="flow-listening-hint">
          Then open Edge’s menu → Read aloud.
        </p>
      </div>
    </div>
  )
}
