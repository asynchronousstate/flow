import { RefObject, useEffect, useState } from 'react'
import { FiBookmark } from 'react-icons/fi'

export interface BookmarkParagraph {
  sectionId: string
  sourceHref: string
  chapterTitle: string
  blockId: string
  text: string
}

interface PositionedBookmark {
  paragraph: BookmarkParagraph
  left: number
  top: number
  size: number
}

export function sameBookmark(
  left: Pick<BookmarkParagraph, 'sourceHref' | 'blockId' | 'text'> | undefined,
  right: Pick<BookmarkParagraph, 'sourceHref' | 'blockId' | 'text'> | undefined,
) {
  return (
    !!left &&
    !!right &&
    left.sourceHref === right.sourceHref &&
    left.blockId === right.blockId &&
    left.text === right.text
  )
}

/** Controls live outside the article: saving never inserts nodes into the
 * narrative, changes its line boxes, or replaces Edge's current text nodes.
 */
export default function QuietBookmarks({
  host,
  paragraphs,
  saved,
  saving,
  onBookmark,
}: {
  host: RefObject<HTMLDivElement>
  paragraphs: BookmarkParagraph[]
  saved?: BookmarkParagraph
  saving: boolean
  onBookmark: (paragraph: BookmarkParagraph) => void
}) {
  const [positions, setPositions] = useState<PositionedBookmark[]>([])

  useEffect(() => {
    const container = host.current
    const article = container?.querySelector('article')
    if (!container || !article) return
    let active = true
    let frame = 0
    const choices = new Map(
      paragraphs.map((paragraph) => [paragraph.blockId, paragraph]),
    )
    const measure = () => {
      if (!active) return
      const origin = container.getBoundingClientRect()
      const articleBox = article.getBoundingClientRect()
      const articleStyle = getComputedStyle(article)
      const contentLeft = articleBox.left + parseFloat(articleStyle.paddingLeft)
      const contentTop = articleBox.top + parseFloat(articleStyle.paddingTop)
      let previousBottom = contentTop
      const next: PositionedBookmark[] = []
      article
        .querySelectorAll<HTMLElement>('[data-listening-paragraph]')
        .forEach((element) => {
          const parent = element.closest(
            'p, li, dt, dd, blockquote, h1, h2, h3, h4, h5, h6',
          )
          const block =
            parent?.querySelectorAll('[data-listening-paragraph]').length === 1
              ? parent
              : element
          const rect = block.getBoundingClientRect()
          if (!rect.width || !rect.height) return
          const choice = choices.get(element.dataset.listeningParagraph || '')
          if (choice) {
            const style = getComputedStyle(element)
            const size = parseFloat(style.fontSize)
            const lineHeight = parseFloat(style.lineHeight) || size * 1.7
            const above = rect.top - size
            // Ordinary prose has a 1em gap. Nested list runs can have none;
            // use the existing page margin there instead of covering text or
            // inventing extra paragraph spacing.
            // Heading leading can account for a small part of the gap.
            const fitsAbove = above >= previousBottom - size * 0.2
            next.push({
              paragraph: choice,
              size,
              left: fitsAbove
                ? rect.left - origin.left
                : Math.max(0, contentLeft - origin.left - size - 3),
              top: fitsAbove
                ? above - origin.top
                : rect.top - origin.top + Math.max(0, (lineHeight - size) / 2),
            })
          }
          previousBottom = Math.max(previousBottom, rect.bottom)
        })
      setPositions(next)
    }
    const schedule = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(measure)
    }
    measure()
    const observer = new ResizeObserver(schedule)
    observer.observe(article)
    window.addEventListener('resize', schedule)
    document.fonts.ready.then(() => active && schedule())
    return () => {
      active = false
      cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener('resize', schedule)
    }
  }, [host, paragraphs])

  return (
    <div className="flow-quiet-bookmarks" role="group" aria-label="Bookmarks">
      {positions.map(({ paragraph, left, top, size }) => {
        const selected = sameBookmark(saved, paragraph)
        return (
          <button
            key={paragraph.blockId}
            type="button"
            className="flow-quiet-bookmark"
            data-flow-bookmark={paragraph.blockId}
            aria-label={`Bookmark in ${
              paragraph.chapterTitle
            }: ${paragraph.text.slice(0, 160)}`}
            aria-pressed={selected}
            disabled={saving}
            style={{ left, top, fontSize: size }}
            onClick={() => !selected && onBookmark(paragraph)}
          >
            <FiBookmark aria-hidden="true" focusable="false" />
          </button>
        )
      })}
    </div>
  )
}
