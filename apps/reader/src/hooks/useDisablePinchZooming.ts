import { useEffect } from 'react'

// https://github.com/excalidraw/excalidraw/blob/7eaf47c9d41a33a6230d8c3a16b5087fc720dcfb/src/packages/excalidraw/index.tsx#L66
export function useDisablePinchZooming(
  win?: Window,
  { preventPan = false }: { preventPan?: boolean } = {},
) {
  useEffect(() => {
    const _win = win ?? window
    // Preserve native scrolling unless this surface owns its swipe gestures.
    const handleTouchMove = (event: TouchEvent) => {
      if ((preventPan || event.touches.length > 1) && event.cancelable)
        event.preventDefault()
    }

    _win.document.addEventListener('touchmove', handleTouchMove, {
      passive: false,
    })

    return () => {
      _win.document.removeEventListener('touchmove', handleTouchMove)
    }
  }, [win, preventPan])
}
