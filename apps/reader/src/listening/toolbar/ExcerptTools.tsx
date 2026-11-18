import { useLiveQuery } from 'dexie-react-hooks'
import Image from 'next/image'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { FiX } from 'react-icons/fi'

import { colorMap } from '../../annotation'
import type { Annotation, AnnotationColor } from '../../annotation'
import {
  deleteBookAnnotation,
  saveBookAnnotation,
} from '../../book-annotations'
import type { AnnotationDraft } from '../../book-annotations'
import { db } from '../../db'
import EdgeListeningHelp from '../EdgeListeningHelp'
import QuietMarks from '../QuietMarks'
import type {
  ListeningAppearance,
  ListeningAppearanceChoice,
} from '../appearance'
import { listeningFontFamilies } from '../appearance'
import type { QuietListeningSession } from '../document'
import type { ListeningImage } from '../epub'
import {
  annotationsInDocument,
  createListeningSource,
  listeningSearchLimit,
  locateQuietDocument,
  quietSelectionAnchor,
  searchListeningText,
} from '../locations'
import type {
  QuietAnnotation,
  QuietSearchMatch,
  QuietSectionLocation,
} from '../locations'

import { listeningToolbarTools } from './ListeningToolbar'
import type { ToolbarAction } from './ListeningToolbar'

type ImageLocation = QuietSectionLocation['images'][number]
type Editor = { selection: Range } | { annotation: Annotation; excerpt: string }

const noMatches: ReturnType<typeof searchListeningText> = []

function useTextSelection(article: RefObject<HTMLElement>) {
  const [range, setRange] = useState<Range>()

  useEffect(() => {
    const text = article.current
    function update() {
      const chosen = window.getSelection()
      if (
        !chosen?.rangeCount ||
        chosen.isCollapsed ||
        !chosen.toString().trim()
      )
        return
      const original = chosen.getRangeAt(0)
      if (
        article.current?.contains(original.startContainer) &&
        article.current.contains(original.endContainer)
      ) {
        setRange(original.cloneRange())
      }
    }
    document.addEventListener('selectionchange', update)
    function clearCollapsedSelection() {
      if (window.getSelection()?.isCollapsed) setRange(undefined)
    }
    text?.addEventListener('click', clearCollapsedSelection)
    return () => {
      document.removeEventListener('selectionchange', update)
      text?.removeEventListener('click', clearCollapsedSelection)
    }
  }, [article])

  function clear() {
    const chosen = window.getSelection()
    if (chosen?.anchorNode && article.current?.contains(chosen.anchorNode))
      chosen.removeAllRanges()
    setRange(undefined)
  }

  return { range, clear }
}

function showTarget(target: Range | HTMLElement) {
  const rect = target.getBoundingClientRect()
  window.scrollBy({ top: rect.top - 85, behavior: 'auto' })
}

function ChapterList({
  session,
  goTo,
}: {
  session: QuietListeningSession
  goTo: (id: string) => void
}) {
  return (
    <ul className="flow-excerpt-list">
      {session.chapters.map((chapter) => (
        <li
          key={chapter.id}
          style={{ paddingInlineStart: Math.min(chapter.depth, 4) * 10 }}
        >
          <button type="button" onClick={() => goTo(chapter.targetId)}>
            {chapter.label}
          </button>
        </li>
      ))}
    </ul>
  )
}

function Timeline({
  article,
  session,
  goTo,
  bookmarkBlock,
}: {
  article: HTMLElement
  session: QuietListeningSession
  goTo: (id: string) => void
  bookmarkBlock?: string
}) {
  const [viewed, setViewed] = useState(0)
  const scrollBounds = useCallback(() => {
    const start = Math.max(
      0,
      window.scrollY + article.getBoundingClientRect().top - 85,
    )
    const end =
      (document.scrollingElement?.scrollHeight ?? 0) - window.innerHeight
    return { start, distance: Math.max(0, end - start) }
  }, [article])
  useEffect(() => {
    const sync = () => {
      const { start, distance } = scrollBounds()
      setViewed(
        distance
          ? Math.min(
              100,
              Math.round(
                (100 * Math.max(0, window.scrollY - start)) / distance,
              ),
            )
          : 0,
      )
    }
    sync()
    window.addEventListener('scroll', sync, { passive: true })
    window.addEventListener('resize', sync)
    return () => {
      window.removeEventListener('scroll', sync)
      window.removeEventListener('resize', sync)
    }
  }, [scrollBounds])
  return (
    <>
      <label>
        Viewed position · {viewed}%
        <input
          type="range"
          value={viewed}
          min={0}
          max={100}
          aria-label="Viewed position"
          onChange={(event) => {
            const { start, distance } = scrollBounds()
            window.scrollTo(
              0,
              start + (distance * Number(event.target.value)) / 100,
            )
          }}
        />
      </label>
      <p>Edge controls the spoken position.</p>
      {bookmarkBlock && (
        <button type="button" onClick={() => goTo(bookmarkBlock)}>
          Go to saved Bookmark
        </button>
      )}
      <ChapterList session={session} goTo={goTo} />
    </>
  )
}

function ImagePreview({
  location,
  readImage,
  goToPassage,
  back,
}: {
  location: ImageLocation
  readImage: (image: ListeningImage) => Promise<Blob>
  goToPassage: () => void
  back: () => void
}) {
  const { image } = location
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    let objectUrl: string | undefined
    readImage(image).then(
      (blob) => {
        if (!active) return
        if (!blob) {
          setError('This image is unavailable in the EPUB.')
          return
        }
        objectUrl = URL.createObjectURL(blob)
        setUrl(objectUrl)
      },
      () => {
        if (active) setError('Could not open this EPUB image.')
      },
    )
    return () => {
      active = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [image, readImage])
  return (
    <>
      <button type="button" onClick={back}>
        Back to images
      </button>
      <figure>
        {url && (
          <Image
            alt={image.label}
            src={url}
            width={400}
            height={400}
            unoptimized
            onError={() => setError('This image could not be displayed.')}
          />
        )}
        {!url && !error && <p role="status">Opening image…</p>}
        {image.caption && <figcaption>{image.caption}</figcaption>}
      </figure>
      {error && <p role="alert">{error}</p>}
      <button type="button" onClick={goToPassage}>
        Go to passage
      </button>
    </>
  )
}

function AnnotationEditor({
  editor,
  pending,
  save,
  remove,
  cancel,
}: {
  editor: Editor
  pending: boolean
  save: (color: AnnotationColor, notes: string) => void
  remove: (annotation: Annotation) => void
  cancel: () => void
}) {
  const existing = 'annotation' in editor ? editor.annotation : undefined
  const text =
    'selection' in editor ? editor.selection.toString() : editor.excerpt
  const [notes, setNotes] = useState(existing?.notes ?? '')
  const [color, setColor] = useState<AnnotationColor>(
    existing?.color ?? 'yellow',
  )
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        save(color, notes)
      }}
    >
      <blockquote>{text}</blockquote>
      <div>
        <label htmlFor="flow-excerpt-note">Note</label>
        <textarea
          id="flow-excerpt-note"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          rows={4}
        />
      </div>
      <div>
        <label htmlFor="flow-excerpt-color">Highlight color</label>
        <select
          id="flow-excerpt-color"
          value={color}
          onChange={(event) => setColor(event.target.value as AnnotationColor)}
        >
          {Object.keys(colorMap).map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </div>
      <div className="flow-excerpt-actions">
        <button type="submit" disabled={pending}>
          Save annotation
        </button>
        <button type="button" disabled={pending} onClick={cancel}>
          Cancel
        </button>
        {existing && (
          <button
            type="button"
            disabled={pending}
            onClick={() => remove(existing)}
          >
            Delete annotation
          </button>
        )}
      </div>
    </form>
  )
}

export default function ExcerptTools({
  bookId,
  session,
  article,
  host,
  action,
  onAction,
  onClose,
  appearance,
  appearanceChoice,
  appearanceStatus,
  onAppearance,
  bookmarkBlock,
  rangeHref,
  onRange,
  track,
}: {
  bookId: string
  session: QuietListeningSession
  article: RefObject<HTMLElement>
  host: RefObject<HTMLDivElement>
  action?: ToolbarAction
  onAction: (action: ToolbarAction) => void
  onClose: () => void
  appearance: ListeningAppearance
  appearanceChoice?: ListeningAppearanceChoice
  appearanceStatus: string
  onAppearance: (patch: Partial<ListeningAppearanceChoice>) => void
  bookmarkBlock?: string
  rangeHref: string
  onRange: () => void
  track: (task: Promise<unknown>) => void
}) {
  const heading = useRef<HTMLHeadingElement>(null)
  const [locations, setLocations] = useState<QuietSectionLocation[]>([])
  const [annotations, setAnnotations] = useState<QuietAnnotation[]>([])
  const [readError, setReadError] = useState('')
  const [writeError, setWriteError] = useState('')
  const [pending, setPending] = useState(false)
  const writing = useRef(false)
  const [editor, setEditor] = useState<Editor>()
  const [image, setImage] = useState<ImageLocation>()
  const [query, setQuery] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [jumpedMatch, setJumpedMatch] = useState<QuietSearchMatch>()
  const selection = useTextSelection(article)
  const source = useMemo(() => createListeningSource(bookId), [bookId])
  const stored = useLiveQuery(
    async () => (await db?.books.get(bookId))?.annotations,
    [bookId],
  )
  const matches = useMemo(
    () => searchListeningText(locations, searchTerm),
    [locations, searchTerm],
  )
  const visibleMatches = useMemo(() => {
    if (action === 'search') return matches
    return !action && jumpedMatch ? [jumpedMatch] : noMatches
  }, [action, jumpedMatch, matches])
  const images = useMemo(
    () => locations.flatMap((location) => location.images),
    [locations],
  )

  useEffect(() => () => source.close(), [source])
  useEffect(() => {
    const timer = window.setTimeout(() => setSearchTerm(query), 120)
    return () => window.clearTimeout(timer)
  }, [query])
  useEffect(() => {
    if (article.current)
      setLocations(locateQuietDocument(article.current, session))
  }, [article, session])
  useEffect(() => {
    let active = true
    setReadError('')
    if (!stored?.length || !locations.length) {
      setAnnotations([])
      return
    }
    annotationsInDocument(stored, locations, source).then(
      (next) => {
        if (active) setAnnotations(next)
      },
      () => {
        if (active)
          setReadError('Some annotations could not be located in this EPUB.')
      },
    )
    return () => {
      active = false
    }
  }, [locations, source, stored])
  useEffect(() => {
    if (action !== 'annotation') setEditor(undefined)
    if (action !== 'image') setImage(undefined)
    if (action) setJumpedMatch(undefined)
    if (action) heading.current?.focus({ preventScroll: true })
  }, [action])

  function edit(annotation: Annotation, excerpt: string) {
    setWriteError('')
    selection.clear()
    setEditor({ annotation, excerpt })
    onAction('annotation')
  }

  function jump(target: Range | HTMLElement) {
    selection.clear()
    onClose()
    showTarget(target)
    article.current?.focus({ preventScroll: true })
  }

  function closePanel() {
    const opener =
      action &&
      document.querySelector<HTMLElement>(
        '[data-listening-tool="' + action + '"]',
      )
    onClose()
    if (opener) opener.focus({ preventScroll: true })
  }

  function goTo(id: string) {
    const target =
      document.getElementById(id) ??
      Array.from(
        article.current?.querySelectorAll<HTMLElement>(
          '[data-listening-paragraph]',
        ) ?? [],
      ).find((paragraph) => paragraph.dataset.listeningParagraph === id)
    if (target && article.current?.contains(target)) jump(target)
  }

  function performWrite(write: () => Promise<unknown>) {
    if (writing.current) return
    writing.current = true
    setPending(true)
    setWriteError('')
    const task = write()
    track(task)
    void task
      .then(
        () => {
          setEditor(undefined)
          selection.clear()
        },
        (error: unknown) => {
          setWriteError(
            error instanceof Error
              ? error.message
              : 'Could not save the annotation.',
          )
        },
      )
      .finally(() => {
        writing.current = false
        setPending(false)
      })
  }

  function save(target: Editor, color: AnnotationColor, notes?: string) {
    performWrite(async () => {
      const existing = 'annotation' in target ? target.annotation : undefined
      const anchor =
        'selection' in target
          ? await quietSelectionAnchor(target.selection, locations, source)
          : target.annotation
      const draft: AnnotationDraft = {
        cfi: anchor.cfi,
        color,
        notes,
        spine: anchor.spine,
        text: anchor.text,
        type: existing?.type ?? 'highlight',
      }
      await saveBookAnnotation(bookId, draft, existing?.id)
    })
  }

  function panelContent() {
    switch (action) {
      case 'toc':
        return <ChapterList session={session} goTo={goTo} />
      case 'search':
        return (
          <>
            <label>
              Search listening text
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            {!!query.trim() && (
              <>
                <p role="status">
                  {matches.length === listeningSearchLimit
                    ? 'Showing the first 200 matches.'
                    : matches.length
                    ? `${matches.length} ${
                        matches.length === 1 ? 'match' : 'matches'
                      }`
                    : 'No matches in this listening selection.'}
                </p>
                <ul className="flow-excerpt-list">
                  {matches.map((item, index) => (
                    <li key={index}>
                      <button
                        type="button"
                        onClick={() => {
                          setJumpedMatch(item)
                          jump(item.range)
                        }}
                      >
                        <small>{item.sectionTitle}</small>
                        {item.excerpt}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )
      case 'annotation':
        return (
          <>
            {readError && <p role="alert">{readError}</p>}
            {writeError && <p role="alert">{writeError}</p>}
            {editor ? (
              <AnnotationEditor
                key={'annotation' in editor ? editor.annotation.id : 'new'}
                editor={editor}
                pending={pending}
                save={(color, notes) => save(editor, color, notes)}
                remove={(annotation) =>
                  performWrite(() =>
                    deleteBookAnnotation(bookId, { id: annotation.id }),
                  )
                }
                cancel={() => setEditor(undefined)}
              />
            ) : (
              <>
                <p>
                  Select listening text to highlight it or add a note. Your
                  annotations also appear in the EPUB reader.
                </p>
                {!annotations.length && (
                  <p>No annotations in this listening selection.</p>
                )}
                <ul className="flow-excerpt-list">
                  {annotations.map(({ annotation, range }) => (
                    <li key={annotation.id}>
                      <button type="button" onClick={() => jump(range)}>
                        <small>{annotation.spine.title}</small>
                        {range.toString().trim()}
                      </button>
                      {annotation.notes && <p>{annotation.notes}</p>}
                      <button
                        type="button"
                        onClick={() =>
                          edit(annotation, range.toString().trim())
                        }
                        aria-label={`Edit annotation on ${range
                          .toString()
                          .trim()
                          .slice(0, 100)}`}
                      >
                        Edit
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )
      case 'image':
        return image ? (
          <ImagePreview
            key={image.image.id}
            location={image}
            readImage={source.image}
            back={() => setImage(undefined)}
            goToPassage={() => {
              const target =
                image.passage instanceof HTMLElement
                  ? image.passage
                  : image.passage.parentElement
              if (target) jump(target)
            }}
          />
        ) : (
          <>
            {!images.length && <p>No images in this listening selection.</p>}
            <ul className="flow-excerpt-list">
              {images.map((item) => (
                <li key={item.image.id}>
                  <button type="button" onClick={() => setImage(item)}>
                    {item.image.label}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )
      case 'timeline':
        return (
          article.current && (
            <Timeline
              article={article.current}
              session={session}
              goTo={goTo}
              bookmarkBlock={bookmarkBlock}
            />
          )
        )
      case 'typography':
        return (
          <>
            <div>
              <label htmlFor="flow-excerpt-font">Font</label>
              <select
                id="flow-excerpt-font"
                value={appearanceChoice?.font ?? ''}
                onChange={(event) =>
                  onAppearance({
                    font: (event.target.value ||
                      undefined) as ListeningAppearanceChoice['font'],
                  })
                }
              >
                <option value="">Preset font</option>
                {Object.keys(listeningFontFamilies).map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
            {(
              [
                ['fontSize', 'Text size', 16, 48, 1, appearance.fontSize],
                [
                  'lineHeight',
                  'Line spacing',
                  1.2,
                  2.5,
                  0.05,
                  appearance.lineHeight,
                ],
                [
                  'textWidth',
                  'Text width',
                  40,
                  90,
                  1,
                  appearance.textWidth ?? 68,
                ],
              ] as const
            ).map(([field, label, min, max, step, value]) => (
              <label key={field}>
                {label}
                <input
                  type="number"
                  min={min}
                  max={max}
                  step={step}
                  defaultValue={value}
                  onBlur={(event) => {
                    const next = event.target.valueAsNumber
                    if (!Number.isFinite(next) || next < min || next > max)
                      event.target.value = String(value)
                  }}
                  onChange={(event) => {
                    const next = event.target.valueAsNumber
                    if (Number.isFinite(next) && next >= min && next <= max)
                      onAppearance({ [field]: next })
                  }}
                />
              </label>
            ))}
          </>
        )
      case 'theme':
        return (
          <fieldset>
            <legend>Listening theme</legend>
            {(['light', 'dark', 'sepia', 'reading'] as const).map((theme) => (
              <label key={theme}>
                <input
                  type="radio"
                  name="listening-theme"
                  checked={
                    (appearanceChoice?.theme ?? appearance.theme) === theme
                  }
                  onChange={() => onAppearance({ theme })}
                />
                {theme === 'reading' ? 'Use reading theme' : theme}
              </label>
            ))}
          </fieldset>
        )
      case 'settings':
        return (
          <>
            <label>
              <input
                type="checkbox"
                checked={appearance.quickBookmarks !== false}
                onChange={(event) =>
                  onAppearance({ quickBookmarks: event.target.checked })
                }
              />
              Show paragraph Bookmark buttons
            </label>
            <p>You can also set a Bookmark from the list in Session / Tools.</p>
            <a
              href={rangeHref}
              onClick={(event) => {
                event.preventDefault()
                onRange()
              }}
            >
              Edit listening range
            </a>
            <h3>Edge Read Aloud</h3>
            <EdgeListeningHelp />
          </>
        )
    }
  }

  const active = listeningToolbarTools.find((tool) => tool.action === action)
  return (
    <>
      <QuietMarks
        host={host}
        annotations={annotations}
        matches={visibleMatches}
        layout={appearance}
        onNote={edit}
      />
      {selection.range && (!action || (action === 'annotation' && !editor)) && (
        <div
          className="flow-excerpt-selection"
          role="group"
          aria-label="Listening text selection"
          data-nosnippet
        >
          {writeError && <p role="alert">{writeError}</p>}
          <div className="flow-excerpt-actions">
            <button
              type="button"
              disabled={pending}
              onClick={() => save({ selection: selection.range! }, 'yellow')}
            >
              Highlight
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                setWriteError('')
                setEditor({ selection: selection.range! })
                selection.clear()
                onAction('annotation')
              }}
            >
              Add note
            </button>
            <button type="button" onClick={selection.clear}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {active && (
        <div
          className="flow-toolkit-workspace flow-excerpt-workspace"
          data-nosnippet
        >
          <section
            className="flow-toolkit-panel"
            id="flow-listening-feature-panel"
            aria-label={active.label}
            onKeyDown={(event) => {
              if (event.key === 'Escape') closePanel()
            }}
          >
            <header className="flow-toolkit-heading">
              <h2 ref={heading} tabIndex={-1}>
                {active.label}
              </h2>
              <button
                type="button"
                aria-label="Close tool panel"
                onClick={closePanel}
              >
                <FiX aria-hidden="true" />
              </button>
            </header>
            <div className="flow-toolkit-panel-body flow-excerpt-panel">
              {panelContent()}
              {appearanceStatus &&
                (action === 'typography' ||
                  action === 'theme' ||
                  action === 'settings') && (
                  <p role="status">{appearanceStatus}</p>
                )}
            </div>
          </section>
        </div>
      )}
    </>
  )
}
