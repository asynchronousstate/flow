import { useEffect, useState } from 'react'
import type { RefObject } from 'react'
import { FiMessageSquare } from 'react-icons/fi'

import { colorMap } from '../annotation'
import type { Annotation } from '../annotation'

import type { ListeningAppearance } from './appearance'
import type { QuietAnnotation, QuietSearchMatch } from './locations'

interface Rect {
  left: number
  top: number
  width: number
  height: number
}

interface MarkLayout {
  marks: (Rect & { key: string; color: string; annotationId?: string })[]
  notes: {
    annotation: Annotation
    excerpt: string
    left: number
    top: number
  }[]
}

export default function QuietMarks({
  host,
  annotations,
  matches,
  layout,
  onNote,
}: {
  host: RefObject<HTMLDivElement>
  annotations: QuietAnnotation[]
  matches: QuietSearchMatch[]
  layout: ListeningAppearance
  onNote: (annotation: Annotation, excerpt: string) => void
}) {
  const [overlays, setOverlays] = useState<MarkLayout>({ marks: [], notes: [] })

  useEffect(() => {
    const target = host.current
    const article = target?.querySelector('article')
    if (!target || !article) return
    let frame = 0
    function measure() {
      const container = target!.getBoundingClientRect()
      const edge = article!.getBoundingClientRect().right - container.left
      const marks: MarkLayout['marks'] = []
      const notes: MarkLayout['notes'] = []
      function place(
        range: Range,
        key: string,
        color: string,
        annotationId?: string,
      ) {
        const rects = Array.from(range.getClientRects()).filter(
          (rect) => rect.width > 0 && rect.height > 0,
        )
        for (const [index, rect] of rects.entries()) {
          marks.push({
            key: key + ' ' + index,
            annotationId,
            color,
            left: rect.left - container.left,
            top: rect.top - container.top,
            width: rect.width,
            height: rect.height,
          })
        }
        return rects[rects.length - 1]
      }
      matches.forEach(({ range }, index) =>
        place(range, 'search ' + index, 'rgba(0, 138, 175, 0.25)'),
      )
      for (const { annotation, range } of annotations) {
        const end = place(
          range,
          annotation.id,
          colorMap[annotation.color],
          annotation.id,
        )
        if (end && annotation.notes?.trim()) {
          notes.push({
            annotation,
            excerpt: range.toString().trim(),
            left: Math.max(0, Math.min(edge + 3, container.width - 28)),
            top: end.top - container.top,
          })
        }
      }
      notes.sort((a, b) => a.top - b.top)
      for (let index = 1; index < notes.length; index++) {
        const note = notes[index]!
        note.top = Math.max(note.top, notes[index - 1]!.top + 30)
      }
      setOverlays({ marks, notes })
    }
    function schedule() {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(measure)
    }
    const size = new ResizeObserver(schedule)
    size.observe(target)
    window.addEventListener('resize', schedule)
    schedule()
    return () => {
      size.disconnect()
      window.removeEventListener('resize', schedule)
      cancelAnimationFrame(frame)
    }
  }, [annotations, host, layout, matches])

  return (
    <div className="flow-quiet-marks" data-nosnippet>
      {overlays.marks.map(({ key, color, annotationId, ...rect }) => (
        <span
          key={key}
          aria-hidden="true"
          data-listening-highlight={annotationId}
          style={{ ...rect, background: color }}
        />
      ))}
      {overlays.notes.map(({ annotation, excerpt, left, top }) => (
        <button
          key={annotation.id}
          type="button"
          className="flow-quiet-note-marker"
          style={{ left, top }}
          aria-label={`Open note on ${excerpt.slice(0, 100)}`}
          onClick={() => onNote(annotation, excerpt)}
        >
          <FiMessageSquare aria-hidden="true" />
        </button>
      ))}
    </div>
  )
}
