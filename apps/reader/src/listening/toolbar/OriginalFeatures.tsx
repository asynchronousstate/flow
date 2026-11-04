import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react'
import { MdClose } from 'react-icons/md'
import { useSnapshot } from 'valtio'

import { ReaderGridView } from '../../components/Reader'
import { Settings } from '../../components/pages/settings'
import { AnnotationView } from '../../components/viewlets/AnnotationView'
import { ImageView } from '../../components/viewlets/ImageView'
import { SearchView } from '../../components/viewlets/SearchView'
import { ThemeView } from '../../components/viewlets/ThemeView'
import { TimelineView } from '../../components/viewlets/TimelineView'
import { TocView } from '../../components/viewlets/TocView'
import { TypographyView } from '../../components/viewlets/TypographyView'
import { db } from '../../db'
import { useBackground, useColorScheme, useMobile } from '../../hooks'
import { reader } from '../../models'
import { useSettings } from '../../state'
import { resolveListeningAppearance } from '../appearance'
import type { ListeningAppearance } from '../appearance'
import type { ListeningMarker } from '../integrated'

import type { ToolbarAction } from './ListeningToolbar'
import { createOriginalFeatureRuntime } from './original-feature-runtime'

export interface OriginalFeaturesHandle {
  settled(): Promise<void>
  leave(): Promise<void>
  dismissOverlay(): void
  hasOverlay(): boolean
}

const views = {
  toc: TocView,
  search: SearchView,
  annotation: AnnotationView,
  image: ImageView,
  timeline: TimelineView,
  typography: TypographyView,
  theme: ThemeView,
}
const titles = {
  toc: 'Contents',
  search: 'Search',
  annotation: 'Annotations',
  image: 'Images',
  timeline: 'Timeline',
  typography: 'Typography',
  theme: 'Theme',
  settings: 'Settings',
}

/** The unchanged original feature views operate on a real, visible BookTab.
 * Quiet's article is a sibling, never the renderer's mount target.
 */
export const OriginalFeatures = forwardRef<
  OriginalFeaturesHandle,
  {
    bookId: string
    action?: ToolbarAction
    sourceOpen: boolean
    onClosePanel(): void
    onClose(): void
    onAppearanceChange(appearance: Partial<ListeningAppearance>): void
    onOverlayChange(type: string | undefined): void
    onBookmark(marker: ListeningMarker): Promise<void>
  }
>(function OriginalFeatures(
  {
    bookId,
    action,
    sourceOpen,
    onClosePanel,
    onClose,
    onAppearanceChange,
    onOverlayChange,
    onBookmark,
  },
  ref,
) {
  const runtime = useRef<ReturnType<typeof createOriginalFeatureRuntime>>()
  const mobile = useMobile()
  const [sourceBackground] = useBackground()
  const activeAction = useRef(action)
  activeAction.current = action
  const afterNavigate = useRef<(context?: unknown) => void>(() => {})
  const overlayChange = useRef(onOverlayChange)
  overlayChange.current = onOverlayChange
  const sourceBookmark = useRef(onBookmark)
  sourceBookmark.current = onBookmark
  afterNavigate.current = (context) => {
    if (
      mobile &&
      action &&
      action === context &&
      ['toc', 'search', 'annotation', 'image', 'timeline'].includes(action)
    )
      onClosePanel()
  }
  const [initialized, setInitialized] = useState(false)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [started, setStarted] = useState(false)
  const [sourceStarted, setSourceStarted] = useState(false)
  const open = sourceOpen || !!action
  const heading = useRef<HTMLHeadingElement>(null)
  const sourceVisible = open && action !== 'settings'

  useEffect(() => {
    if (open) setStarted(true)
    if (sourceVisible) setSourceStarted(true)
  }, [action, open, sourceVisible])

  useEffect(() => {
    if (!started) return
    let cancelled = false
    setError('')
    setInitialized(false)
    db?.books
      .get(bookId)
      .then((book) => {
        if (cancelled) return
        if (!book) throw new Error('This book is no longer in the library.')
        runtime.current = createOriginalFeatureRuntime(
          book,
          (context) => afterNavigate.current(context),
          (type) => overlayChange.current(type),
          (marker) => sourceBookmark.current(marker),
          () => activeAction.current,
        )
        setInitialized(true)
      })
      .catch((problem: unknown) => {
        if (!cancelled)
          setError(
            problem instanceof Error
              ? problem.message
              : 'Could not open ebook tools.',
          )
      })
    return () => {
      cancelled = true
      runtime.current?.destroy()
      runtime.current = undefined
    }
  }, [bookId, started, attempt])

  useEffect(() => {
    runtime.current?.setActive(sourceVisible)
  }, [initialized, sourceVisible])

  useEffect(() => {
    if (open) heading.current?.focus({ preventScroll: true })
  }, [action, open])

  useImperativeHandle(ref, () => ({
    settled: async () => runtime.current?.settled(),
    dismissOverlay: () => runtime.current?.tab.dismissSourceOverlay(),
    hasOverlay: () => !!runtime.current?.tab.sourceOverlay,
    leave: async () => {
      await runtime.current?.settled()
      runtime.current?.setActive(false)
      runtime.current?.destroy()
      runtime.current = undefined
      setInitialized(false)
      setStarted(false)
      reader.clear()
    },
  }))

  return (
    <div
      className="flow-toolkit-workspace"
      hidden={!open}
      data-source-open={sourceVisible}
      data-nosnippet
      role="region"
      aria-label="Ebook tools"
      onKeyDown={(event) => {
        event.stopPropagation()
        if (event.key === 'Escape') {
          event.preventDefault()
          onClose()
        }
      }}
    >
      <section
        className="flow-toolkit-panel bg-surface text-on-surface"
        id="flow-listening-feature-panel"
        hidden={!action}
        aria-label={action ? titles[action] : undefined}
      >
        <header className="flow-toolkit-heading">
          <h2 ref={heading} tabIndex={-1}>
            {action ? titles[action] : 'Ebook tools'}
          </h2>
          <button
            type="button"
            aria-label="Close tool panel"
            onClick={onClosePanel}
          >
            <MdClose aria-hidden="true" />
          </button>
        </header>
        {error ? (
          <div role="alert" className="flow-toolkit-error">
            <p>{error}</p>
            <button
              type="button"
              onClick={() => setAttempt((value) => value + 1)}
            >
              Retry ebook tools
            </button>
          </div>
        ) : !initialized ? (
          <p role="status" className="flow-toolkit-error">
            Opening ebook tools…
          </p>
        ) : (
          <div className="flow-toolkit-panel-body">
            {action === 'settings' && <Settings />}
            {Object.entries(views).map(([name, View]) => (
              <div
                className="flow-toolkit-feature-view"
                key={name}
                hidden={action !== name}
              >
                <View
                  name={titles[name as keyof typeof views]}
                  title={titles[name as keyof typeof views]}
                  {...(name === 'toc' ? { includeLibrary: false } : {})}
                />
              </div>
            ))}
          </div>
        )}
      </section>
      <section
        className="flow-toolkit-source bg-surface text-on-surface"
        hidden={!sourceVisible}
        aria-label="Original ebook reader"
      >
        <header className="flow-toolkit-heading">
          <h2 tabIndex={-1}>Ebook preview</h2>
          <button type="button" onClick={onClose}>
            Return to listening
          </button>
        </header>
        <div className={`flow-toolkit-source-body ${sourceBackground}`}>
          {initialized && sourceStarted && (
            <ReaderGridView active={sourceVisible} />
          )}
        </div>
      </section>
      {initialized && <LiveAppearance onChange={onAppearanceChange} />}
    </div>
  )
})

function LiveAppearance({
  onChange,
}: {
  onChange(value: Partial<ListeningAppearance>): void
}) {
  const { focusedBookTab } = useSnapshot(reader)
  const [settings] = useSettings()
  const { dark } = useColorScheme()
  const typography = focusedBookTab?.book.configuration?.typography
  const effective = {
    ...settings,
    ...Object.fromEntries(
      Object.entries(typography || {}).filter(
        ([, value]) => value !== undefined,
      ),
    ),
  }
  const fontSignature = JSON.stringify([
    effective.fontFamily,
    effective.fontSize,
    effective.fontWeight,
    effective.lineHeight,
  ])
  const themeSignature = JSON.stringify([settings.theme, dark])
  const initial = useRef({ font: fontSignature, theme: themeSignature })
  const ready = useRef(false)
  useEffect(() => {
    // Opening a tool preserves the launch appearance. An explicit preference
    // edit updates CSS only; narration's nodes and text remain untouched.
    if (!ready.current || dark === undefined) {
      initial.current = { font: fontSignature, theme: themeSignature }
      ready.current = dark !== undefined
      return
    }
    const fontChanged = initial.current.font !== fontSignature
    const themeChanged = initial.current.theme !== themeSignature
    if (!fontChanged && !themeChanged) return
    initial.current = { font: fontSignature, theme: themeSignature }
    const { theme, ...font } = resolveListeningAppearance(
      { preset: 'reading', theme: 'reading' },
      settings,
      typography,
      dark,
    )
    onChange({
      ...(fontChanged ? font : {}),
      ...(themeChanged ? { theme } : {}),
    })
  }, [dark, fontSignature, onChange, settings, themeSignature, typography])
  return null
}
