import { useEffect, useState } from 'react'

import type { ListeningPreparationProgress } from './epub'

export default function PreparationStatus({
  progress,
  onRetry,
}: {
  progress?: ListeningPreparationProgress
  onRetry: () => void
}) {
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    setSlow(false)
    const timer = window.setTimeout(() => setSlow(true), 15000)
    return () => window.clearTimeout(timer)
  }, [])
  const message =
    !progress || progress.stage === 'reading'
      ? 'Opening book…'
      : progress.stage === 'checking'
      ? 'Checking this EPUB…'
      : progress.stage === 'chapters'
      ? `Preparing chapters${
          progress.total
            ? ` · ${progress.completed || 0} of ${progress.total}`
            : ''
        }…`
      : progress.stage === 'ready'
      ? 'Opening your listening document…'
      : 'Reading EPUB Contents…'
  return (
    <div className="flow-preparation">
      <p role="status" aria-live="polite">
        {message}
      </p>
      {slow && (
        <>
          <p>
            This is taking longer than usual. You can retry or return to the
            book. Your saved range and Bookmark are kept.
          </p>
          <button type="button" onClick={onRetry}>
            Retry preparation
          </button>
        </>
      )}
    </div>
  )
}
