import { getSourceListeningParagraphs, listeningText } from './epub'
import type { ListeningBook, ListeningSection } from './epub'
import type { IntegratedListeningRecord, ListeningMarker } from './integrated'

export interface ListeningParagraph {
  blockId: string
  text: string
}

export interface QuietListeningSession {
  title: string
  language: string
  sections: ListeningSection[]
}

const paragraphAttribute = 'data-listening-paragraph'

function parseSection(section: ListeningSection) {
  return new DOMParser().parseFromString(section.html, 'text/html')
}

function paragraphElements(root: Document | Element) {
  return Array.from(root.querySelectorAll(`[${paragraphAttribute}]`))
}

/** Disjoint source paragraphs, including list items and direct container prose. */
export function getListeningParagraphs(
  section: ListeningSection,
): ListeningParagraph[] {
  return paragraphElements(parseSection(section)).map((element) => ({
    blockId: element.getAttribute(paragraphAttribute)!,
    text: listeningText(element),
  }))
}

function normalizedHref(href: string): string | undefined {
  try {
    const path = decodeURIComponent(href.split(/[?#]/, 1)[0] ?? '')
    // Locators are EPUB paths, not network URLs. Do not collapse an unresolved
    // parent traversal or accept a URL merely because its basename matches.
    if (
      /^[a-z][a-z\d+.-]*:/i.test(path) ||
      path.startsWith('//') ||
      /[\\\0]/.test(path)
    )
      return undefined
    const parts: string[] = []
    for (const part of path.split('/')) {
      if (!part || part === '.') continue
      if (part === '..') {
        if (!parts.length) return undefined
        parts.pop()
      } else {
        parts.push(part)
      }
    }
    return parts.length ? parts.join('/') : undefined
  } catch {
    return undefined
  }
}

/** Compare a package path with a renderer-relative path on segment boundaries.
 * Callers resolving a book must additionally reject ambiguous suffix matches.
 */
export function sameSourceHref(a: string, b: string): boolean {
  const left = normalizedHref(a)
  const right = normalizedHref(b)
  return (
    !!left &&
    !!right &&
    (left === right || left.endsWith('/' + right) || right.endsWith('/' + left))
  )
}

function sectionIndex(book: ListeningBook, href: string): number {
  const normalized = normalizedHref(href)
  let matches = book.sections
    .map((section, index) => ({ section, index }))
    .filter(
      ({ section }) =>
        section.id === href ||
        (!!normalized && normalizedHref(section.sourceHref) === normalized),
    )
  if (!matches.length) {
    matches = book.sections
      .map((section, index) => ({ section, index }))
      .filter(({ section }) => sameSourceHref(section.sourceHref, href))
  }
  if (matches.length !== 1) {
    throw new Error(
      matches.length
        ? 'This chapter path matches more than one chapter. Reopen the intended chapter and save its paragraph again.'
        : 'This chapter is no longer available. Choose a chapter from this book again.',
    )
  }
  return matches[0]!.index
}

function comparePoints(
  doc: Document,
  node: Node,
  offset: number,
  pointNode: Node,
  pointOffset: number,
) {
  const left = doc.createRange()
  left.setStart(node, offset)
  left.collapse(true)
  const right = doc.createRange()
  right.setStart(pointNode, pointOffset)
  right.collapse(true)
  return left.compareBoundaryPoints(0, right)
}

function textNodes(nodes: Node[]): Node[] {
  const result: Node[] = []
  function visit(node: Node) {
    if (!listeningText(node)) return
    if (node.nodeType === 3 || node.nodeType === 4) result.push(node)
    else Array.from(node.childNodes).forEach(visit)
  }
  nodes.forEach(visit)
  return result
}

/** Locate the first readable character touched by a Range, including element
 * boundary offsets. A caret at the end of a paragraph chooses the next prose.
 */
function selectedParagraph(root: Element, range: Range) {
  const paragraphs = getSourceListeningParagraphs(root)
  const doc = root.ownerDocument
  for (const paragraph of paragraphs) {
    for (const node of textNodes(paragraph.nodes)) {
      const text = node.textContent ?? ''
      if (
        comparePoints(
          doc,
          node,
          text.length,
          range.startContainer,
          range.startOffset,
        ) <= 0
      )
        continue
      if (
        !range.collapsed &&
        comparePoints(doc, node, 0, range.endContainer, range.endOffset) >= 0
      )
        continue
      const start = node === range.startContainer ? range.startOffset : 0
      const end =
        !range.collapsed && node === range.endContainer
          ? range.endOffset
          : text.length
      if (!text.slice(start, end).trim()) continue
      return { paragraph, node, paragraphs }
    }
  }
  throw new Error('Select readable text in the paragraph you want to save.')
}

/** Map a renderer selection using paragraph ordinal AND exact text identity.
 * Matching the whole source sequence means duplicate paragraphs are never
 * silently mapped to the first occurrence of their text.
 */
export function markerFromRange(
  book: ListeningBook,
  sourceHref: string,
  range: Range,
  cfi?: string,
): ListeningMarker {
  const section = book.sections[sectionIndex(book, sourceHref)]!
  const doc = range.startContainer.ownerDocument
  const body = doc?.querySelector('body')
  if (
    !body ||
    !body.contains(range.startContainer) ||
    !body.contains(range.endContainer)
  )
    throw new Error(
      'This selection is not in the book text. Reopen the chapter and select a paragraph.',
    )
  const selected = selectedParagraph(body, range)
  const prepared = getListeningParagraphs(section)
  const direct = selected.node.parentElement?.closest(`[${paragraphAttribute}]`)
  let target: ListeningParagraph | undefined
  if (
    selected.paragraphs.length === prepared.length &&
    selected.paragraphs.every(
      (paragraph, index) => paragraph.text === prepared[index]?.text,
    )
  ) {
    // Prefer the actual full source sequence even when EPUB content happens to
    // contain attributes with our names. Source attributes are not locators.
    target = prepared[selected.paragraph.ordinal]
  } else if (direct) {
    // The quiet document may have been trimmed to a suffix of the source. Its
    // generated locator survives trimming; still require exact text identity.
    const blockId = direct.getAttribute(paragraphAttribute)
    const matches = prepared.filter(
      (paragraph) => paragraph.blockId === blockId,
    )
    if (matches.length === 1 && matches[0]?.text === listeningText(direct))
      target = matches[0]
  }
  if (!target) {
    throw new Error(
      'This paragraph could not be mapped exactly to the EPUB. Reopen the chapter, or choose the paragraph in listening setup; no approximate position was saved.',
    )
  }
  return {
    sourceHref: section.sourceHref,
    blockId: target.blockId,
    text: target.text,
    savedAt: Date.now(),
    ...(cfi ? { cfi } : {}),
  }
}

/** Prepare an inclusive chapter range without changing the canonical book. */
export function buildQuietSession(
  book: ListeningBook,
  record: IntegratedListeningRecord,
): QuietListeningSession {
  const from = sectionIndex(book, record.from)
  const through = sectionIndex(book, record.through)
  if (through < from)
    throw new Error(
      'Through must be the same chapter as From or a later chapter.',
    )
  const sections = book.sections
    .slice(from, through + 1)
    .map((section) => ({ ...section }))
  if (record.startAt === 'marker') {
    const marker = record.marker
    if (!marker)
      throw new Error('Save a paragraph first, or choose Chapter beginning.')
    const markerChapter = sectionIndex(book, marker.sourceHref)
    if (markerChapter !== from) {
      throw new Error(
        `Your saved paragraph is in “${
          book.sections[markerChapter]!.title
        }”. Change From to that chapter, or choose Chapter beginning.`,
      )
    }
    const first = sections[0]!
    const doc = parseSection(first)
    const matches = paragraphElements(doc).filter(
      (element) => element.getAttribute(paragraphAttribute) === marker.blockId,
    )
    const paragraph = matches[0]
    if (
      matches.length !== 1 ||
      !paragraph ||
      listeningText(paragraph) !== marker.text ||
      !marker.text
    ) {
      throw new Error(
        'The saved paragraph no longer matches this EPUB. Save it again, or choose Chapter beginning.',
      )
    }
    const heading = doc.querySelector('h1, h2, h3, h4, h5, h6')
    const contextHeading =
      heading &&
      !heading.contains(paragraph) &&
      heading.compareDocumentPosition(paragraph) &
        Node.DOCUMENT_POSITION_FOLLOWING
        ? (heading.cloneNode(true) as Element)
        : undefined
    const chapterContainer = doc.body.firstElementChild
    const before = doc.createRange()
    before.setStart(doc.body, 0)
    before.setEndBefore(paragraph)
    before.deleteContents()
    if (contextHeading && !doc.body.contains(heading)) {
      // Keep the original chapter context for native article extraction, but
      // do not offer this earlier heading as a new saved paragraph choice.
      for (const element of [
        contextHeading,
        ...contextHeading.querySelectorAll('*'),
      ]) {
        element.removeAttribute(paragraphAttribute)
        element.removeAttribute('data-listening-source-index')
        element.removeAttribute('data-listening-block')
      }
      const contextParent =
        chapterContainer && doc.body.contains(chapterContainer)
          ? chapterContainer
          : doc.body
      contextParent.prepend(contextHeading)
    }
    first.html = doc.body.innerHTML
  }
  // Image alt descriptions often contain production labels such as "Illo5".
  // Keep the converter's accessible source copy and printed captions intact,
  // while matching Listening Mode's default of omitting these from narration.
  for (const section of sections) {
    const doc = parseSection(section)
    const descriptions = doc.querySelectorAll('.listening-image-description')
    if (descriptions.length) {
      descriptions.forEach((description) => description.remove())
      section.html = doc.body.innerHTML
    }
  }
  return { title: book.title, language: book.language, sections }
}
