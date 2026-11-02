import { useEffect } from 'react'

export function isReaderViewportZoomed(win?: Window) {
  if (!win) return false
  try {
    return (
      (win.visualViewport?.scale ?? 1) > 1 ||
      (win.parent?.visualViewport?.scale ?? 1) > 1
    )
  } catch {
    return (win.visualViewport?.scale ?? 1) > 1
  }
}

export function canTurnReaderPage(win: Window | undefined, touchCount = 1) {
  return touchCount === 1 && !isReaderViewportZoomed(win)
}

// https://github.com/excalidraw/excalidraw/blob/7eaf47c9d41a33a6230d8c3a16b5087fc720dcfb/src/packages/excalidraw/index.tsx#L66
export function useDisablePinchZooming(
  win?: Window,
  {
    preventPan = false,
    preventPinch = true,
  }: { preventPan?: boolean; preventPinch?: boolean } = {},
) {
  useEffect(() => {
    const _win = win ?? window
    // Preserve native scrolling unless this surface owns its swipe gestures.
    const handleTouchMove = (event: TouchEvent) => {
      if (!preventPinch && isReaderViewportZoomed(_win)) return
      const multiTouch = event.touches.length > 1
      if (
        (multiTouch
          ? preventPinch
          : preventPan && event.touches.length === 1) &&
        event.cancelable
      )
        event.preventDefault()
    }

    _win.document.addEventListener('touchmove', handleTouchMove, {
      passive: false,
    })

    return () => {
      _win.document.removeEventListener('touchmove', handleTouchMove)
    }
  }, [win, preventPan, preventPinch])
}
