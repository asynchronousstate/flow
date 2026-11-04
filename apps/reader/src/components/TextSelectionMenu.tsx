import { Overlay } from '@literal-ui/core'
import clsx from 'clsx'
import { useCallback, useEffect, useRef, useState } from 'react'
import FocusLock from 'react-focus-lock'
import {
  MdCopyAll,
  MdOutlineAddBox,
  MdOutlineEdit,
  MdOutlineIndeterminateCheckBox,
  MdSearch,
} from 'react-icons/md'
import { useSnapshot } from 'valtio'

import { typeMap, colorMap } from '../annotation'
import {
  isForwardSelection,
  useMobile,
  useSetAction,
  useTextSelection,
  useTranslation,
  useTypography,
} from '../hooks'
import { chapterForBookmark } from '../listening/chapters'
import { markerFromRange } from '../listening/document'
import {
  loadLibraryListeningBook,
  saveLibraryMarker,
} from '../listening/integrated'
import { BookTab, reader } from '../models'
import { isTouchScreen, scale } from '../platform'
import { useSettings } from '../state'
import { copy, keys, last } from '../utils'

import { Button, IconButton } from './Button'
import { TextField } from './Form'
import { layout, LayoutAnchorMode, LayoutAnchorPosition } from './base'

interface TextSelectionMenuProps {
  tab: BookTab
}

interface CapturedTextSelection {
  range: Range
  cfi: string
  text: string
  forward: boolean
  anchorRect: DOMRect
  containerRect: DOMRect
  viewRect: DOMRect
  lineHeight?: number
}

function snapshotRect(rect: DOMRect): DOMRect {
  return new DOMRect(rect.x, rect.y, rect.width, rect.height)
}

/** An Android keyboard can collapse Selection or temporarily remove the EPUB
 * view while it repaginates. Capture the editing target once; neither event is
 * a request to dismiss a selection menu or discard a note draft.
 */
function captureTextSelection(
  tab: BookTab,
  selection: Selection | undefined,
  annotationRange: Range | undefined,
  element: HTMLElement | undefined,
): CapturedTextSelection | undefined {
  if (!element?.parentElement) return
  try {
    const source =
      selection && !selection.isCollapsed && selection.rangeCount
        ? selection.getRangeAt(0)
        : annotationRange
    if (!source) return
    const range = source.cloneRange()
    const text = range.cloneContents().textContent?.trim()
    if (!text) return
    const forward = isTouchScreen
      ? false
      : selection && !selection.isCollapsed
      ? isForwardSelection(selection)
      : true
    const rects = [...range.getClientRects()].filter((rect) =>
      Math.round(rect.width),
    )
    const anchorRect = forward ? last(rects) : rects[0]
    if (!anchorRect) return
    const containerRect = element.parentElement.getBoundingClientRect()
    const viewRect = element.getBoundingClientRect()
    if (!containerRect.width || !containerRect.height || !viewRect.width) return
    const parent = (forward ? range.endContainer : range.startContainer)
      .parentElement
    const lineHeight = parent
      ? parseFloat(getComputedStyle(parent).lineHeight)
      : NaN
    return {
      range,
      cfi: tab.rangeToCfi(range),
      text,
      forward,
      anchorRect: snapshotRect(anchorRect),
      containerRect: snapshotRect(containerRect),
      viewRect: snapshotRect(viewRect),
      ...(Number.isFinite(lineHeight) ? { lineHeight } : {}),
    }
  } catch {
    // A view still being attached has no usable selection geometry yet.
    return undefined
  }
}

export const TextSelectionMenu: React.FC<TextSelectionMenuProps> = ({
  tab,
}) => {
  const { rendition, annotationRange } = useSnapshot(tab)
  const [settings] = useSettings()

  // `manager` is not reactive, so we need to use getter
  const view = useCallback(() => {
    return rendition?.manager?.views?._views?.[0]
  }, [rendition])

  const win = view()?.window
  const [selection, setSelection] = useTextSelection(win)
  const captured = useRef<CapturedTextSelection>()
  const ignoredAnnotation = useRef<Range>()
  const latestSelection = useRef(selection)
  const latestWindow = useRef(win)
  latestSelection.current = selection
  latestWindow.current = win
  const [, refresh] = useState(0)
  const hide = useCallback(() => {
    ignoredAnnotation.current = tab.annotationRange
    captured.current = undefined
    try {
      latestSelection.current?.removeAllRanges()
      latestWindow.current?.getSelection()?.removeAllRanges()
    } catch {
      // The old frame may already have been replaced by repagination.
    }
    setSelection(undefined)
    if (tab.annotationRange) tab.annotationRange = undefined
    refresh((value) => value + 1)
  }, [setSelection, tab])

  // If text selection menu is disabled, don't render it
  if (settings.enableTextSelectionMenu === false) {
    captured.current = undefined
    return null
  }

  const el = view()?.element as HTMLElement | undefined
  if (!captured.current)
    captured.current = captureTextSelection(
      tab,
      selection,
      annotationRange === ignoredAnnotation.current
        ? undefined
        : (annotationRange as Range | undefined),
      el,
    )
  const descriptor = captured.current
  if (!descriptor) return null

  // Refresh geometry when a live viewport is available, retaining the captured
  // bounds during a transient missing/zero-sized view. The same renderer stays
  // mounted, so opening the IME cannot reset annotate state or textarea text.
  if (el?.parentElement) {
    const containerRect = el.parentElement.getBoundingClientRect()
    const viewRect = el.getBoundingClientRect()
    if (containerRect.width && containerRect.height && viewRect.width) {
      descriptor.containerRect = snapshotRect(containerRect)
      descriptor.viewRect = snapshotRect(viewRect)
    }
  }

  return (
    <TextSelectionMenuRenderer
      key={descriptor.cfi}
      tab={tab}
      range={descriptor.range}
      capturedCFI={descriptor.cfi}
      capturedLineHeight={descriptor.lineHeight}
      anchorRect={descriptor.anchorRect}
      containerRect={descriptor.containerRect}
      viewRect={descriptor.viewRect}
      text={descriptor.text}
      forward={descriptor.forward}
      hide={hide}
    />
  )
}

const ICON_SIZE = scale(22, 28)
const ANNOTATION_SIZE = scale(24, 30)

interface TextSelectionMenuRendererProps {
  tab: BookTab
  range: Range
  capturedCFI?: string
  capturedLineHeight?: number
  anchorRect: DOMRect
  containerRect: DOMRect
  viewRect: DOMRect
  text: string
  forward: boolean
  hide: () => void
}
const TextSelectionMenuRenderer: React.FC<TextSelectionMenuRendererProps> = ({
  tab,
  range,
  capturedCFI,
  capturedLineHeight,
  anchorRect,
  containerRect,
  viewRect,
  forward,
  text,
  hide,
}) => {
  const setAction = useSetAction()
  const ref = useRef<HTMLInputElement>(null)
  const [width, setWidth] = useState(0)
  const [height, setHeight] = useState(0)
  const mobile = useMobile()
  const t = useTranslation('menu')

  const cfi = capturedCFI ?? tab.rangeToCfi(range)
  const annotation = tab.book.annotations.find((a) => a.cfi === cfi)
  const [annotate, setAnnotate] = useState(!!annotation)
  const [savingStart, setSavingStart] = useState(false)
  const [listeningError, setListeningError] = useState('')
  const hideRef = useRef(hide)
  hideRef.current = hide
  const dismiss = useCallback(() => hideRef.current(), [])
  const mounted = useRef(true)
  const saveInFlight = useRef(false)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  useEffect(() => {
    if (!tab.runtimePolicy) return
    tab.setSourceOverlay(annotate ? 'note' : 'selection', dismiss)
    return () => tab.clearSourceOverlay(dismiss)
  }, [annotate, dismiss, tab])

  function saveListeningStart() {
    const policy = tab.runtimePolicy
    const canContinue = () =>
      mounted.current &&
      (!policy || (!policy.isDisposed() && policy.isActive()))
    if (saveInFlight.current || !canContinue()) return
    saveInFlight.current = true
    setSavingStart(true)
    setListeningError('')

    const operation = (async () => {
      const selectedRange = range.cloneRange()
      const sourceHref = tab.view?.section?.href ?? tab.currentHref
      if (!sourceHref)
        throw new Error('Wait for this chapter to finish loading.')
      const { book, record } = await loadLibraryListeningBook(tab.book.id)
      // A Home/Back action can close or dispose this source while the EPUB is
      // being checked. Its old selection must not recreate a reader tab.
      if (!canContinue()) return
      const marker = markerFromRange(book, sourceHref, selectedRange, cfi)
      marker.chapterTitle = chapterForBookmark(book, marker).title
      if (policy) {
        if (!policy.saveListeningBookmark)
          throw new Error(
            'Return to the listening document to save this Bookmark.',
          )
        // The companion uses Quiet's one Bookmark coordinator, toast and Undo
        // history. It must never run the ordinary reader's tab-opening path.
        await policy.saveListeningBookmark(marker)
      } else {
        await saveLibraryMarker(tab.book.id, marker, record.fingerprint)
        if (!canContinue()) return
        reader.addTab(tab)
        setAction('listening')
      }
      if (canContinue()) dismiss()
    })()

    const lifecycle = operation
      .catch((error: unknown) => {
        if (!mounted.current || !canContinue()) return
        setListeningError(
          error instanceof Error
            ? error.message
            : 'Could not save this bookmark.',
        )
      })
      .finally(() => {
        saveInFlight.current = false
        if (mounted.current) setSavingStart(false)
      })
    // Register before the first asynchronous preparation can finish, so Home
    // waits for both parsing and the subsequent shared Bookmark save. Local
    // validation errors are displayed above without poisoning the write queue.
    policy?.track(lifecycle)
    return lifecycle
  }

  const position = forward
    ? LayoutAnchorPosition.Before
    : LayoutAnchorPosition.After

  const { zoom } = useTypography(tab)
  const endContainer = forward ? range.endContainer : range.startContainer
  const _lineHeight =
    capturedLineHeight ??
    (endContainer.parentElement
      ? parseFloat(getComputedStyle(endContainer.parentElement).lineHeight)
      : NaN)
  // no custom line height and the origin is keyword, e.g. 'normal'.
  const lineHeight = isNaN(_lineHeight)
    ? anchorRect.height
    : _lineHeight * (zoom ?? 1)

  return (
    <FocusLock disabled={mobile}>
      <Overlay
        // cover `sash`
        className="!z-50 !bg-transparent"
        onMouseDown={hide}
      />
      <div
        ref={(el) => {
          if (!el) return
          setWidth(el.clientWidth)
          setHeight(el.clientHeight)
          if (!mobile) {
            el.focus()
          }
        }}
        className={clsx(
          'bg-surface text-on-surface-variant shadow-1 absolute z-50 p-2 focus:outline-none',
        )}
        style={{
          left: layout(containerRect.width, width, {
            offset: anchorRect.left + viewRect.left - containerRect.left,
            size: anchorRect.width,
            mode: LayoutAnchorMode.ALIGN,
            position,
          }),
          top: layout(containerRect.height, height, {
            offset: anchorRect.top - (lineHeight - anchorRect.height) / 2,
            size: lineHeight,
            position,
          }),
        }}
        tabIndex={-1}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'c' && e.ctrlKey) {
            copy(text)
          }
        }}
      >
        {annotate ? (
          <div className="mb-3">
            <TextField
              mRef={ref}
              as="textarea"
              name="notes"
              defaultValue={annotation?.notes}
              hideLabel
              className="h-40 w-72"
              autoFocus
            />
          </div>
        ) : (
          <div className="text-on-surface-variant -mx- mb-3 flex gap-1">
            <IconButton
              title={t('copy')}
              Icon={MdCopyAll}
              size={ICON_SIZE}
              onClick={() => {
                hide()
                copy(text)
              }}
            />
            <IconButton
              title={t('search_in_book')}
              Icon={MdSearch}
              size={ICON_SIZE}
              onClick={() => {
                hide()
                setAction('search')
                tab.setKeyword(text)
              }}
            />
            <IconButton
              title={t('annotate')}
              Icon={MdOutlineEdit}
              size={ICON_SIZE}
              onClick={() => {
                setAnnotate(true)
              }}
            />
            {tab.isDefined(text) ? (
              <IconButton
                title={t('undefine')}
                Icon={MdOutlineIndeterminateCheckBox}
                size={ICON_SIZE}
                onClick={() => {
                  hide()
                  tab.undefine(text)
                }}
              />
            ) : (
              <IconButton
                title={t('define')}
                Icon={MdOutlineAddBox}
                size={ICON_SIZE}
                onClick={() => {
                  hide()
                  tab.define([text])
                }}
              />
            )}
          </div>
        )}
        {!annotate && (
          <div className="flow-listening-selection">
            <button
              type="button"
              disabled={savingStart}
              aria-label="Bookmark this paragraph for listening"
              onClick={saveListeningStart}
            >
              {savingStart ? 'Saving bookmark…' : 'Bookmark'}
            </button>
            {listeningError && <p role="alert">{listeningError}</p>}
          </div>
        )}
        <div className="space-y-2">
          {keys(typeMap).map((type) => (
            <div key={type} className="flex gap-2">
              {keys(colorMap).map((color) => (
                <div
                  key={color}
                  style={{
                    [typeMap[type].style]: colorMap[color],
                    width: ANNOTATION_SIZE,
                    height: ANNOTATION_SIZE,
                    fontSize: scale(16, 20),
                  }}
                  className={clsx(
                    'typescale-body-large text-on-surface-variant flex cursor-pointer items-center justify-center',
                    typeMap[type].class,
                  )}
                  onClick={() => {
                    tab.putAnnotation(
                      type,
                      cfi,
                      color,
                      text,
                      ref.current?.value,
                    )
                    hide()
                  }}
                >
                  A
                </div>
              ))}
            </div>
          ))}
        </div>
        {annotate && (
          <div className="mt-3 flex">
            {annotation && (
              <Button
                compact
                variant="secondary"
                onClick={() => {
                  tab.removeAnnotation(cfi)
                  hide()
                }}
              >
                {t('delete')}
              </Button>
            )}
            <Button
              className="ml-auto"
              compact
              onClick={() => {
                tab.putAnnotation(
                  annotation?.type ?? 'highlight',
                  cfi,
                  annotation?.color ?? 'yellow',
                  text,
                  ref.current?.value,
                )
                hide()
              }}
            >
              {t(annotation ? 'update' : 'create')}
            </Button>
          </div>
        )}
      </div>
    </FocusLock>
  )
}
