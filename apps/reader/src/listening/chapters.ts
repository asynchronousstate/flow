import type { NavItem } from '@flow/epubjs/types/navigation'

import { listeningText } from './epub'
import type { ListeningBook, ListeningSection } from './epub'
import type { ListeningMarker } from './integrated'

/** A position before an element in an original, unsplit source section. */
export interface ListeningPoint {
  sectionIndex: number
  offset: number
  anchorId?: string
}

export interface ListeningChapter {
  id: string
  href: string
  sourceHref: string
  label: string
  title: string
  depth: number
  parentId?: string
  hasChildren: boolean
  disabled: boolean
  reason?: string
  start?: ListeningPoint
  end?: ListeningPoint
  fallback?: boolean
}

export interface ListeningChapterRange {
  from: ListeningChapter
  through: ListeningChapter
  start: ListeningPoint
  end: ListeningPoint
}

function chapterDocument(section: ListeningSection) {
  return new DOMParser().parseFromString(section.html, 'text/html')
}

/** The converter and TOC resolver must address the same retained source IDs. */
export function listeningSourceId(sectionId: string, id: string) {
  return `${sectionId}-ref-${encodeURIComponent(id)}`
}

export function resolveListeningReference(reference: string, sourcePath = '') {
  try {
    const base = new URL(sourcePath, 'https://epub.invalid/')
    const resolved = new URL(reference, base)
    if (resolved.origin !== base.origin || resolved.protocol !== 'https:')
      return undefined
    return {
      path: decodeURIComponent(resolved.pathname.slice(1)),
      fragment: decodeURIComponent(resolved.hash.slice(1)),
    }
  } catch {
    return undefined
  }
}

export function compareListeningPoints(a: ListeningPoint, b: ListeningPoint) {
  return a.sectionIndex - b.sectionIndex || a.offset - b.offset
}

function elementOffsets(doc: Document) {
  const offsets = new Map<Node, number>()
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_ALL)
  let node: Node | null = walker.currentNode
  while (node) {
    offsets.set(node, offsets.size)
    node = walker.nextNode()
  }
  return offsets
}

function fileChapter(
  section: ListeningSection,
  index: number,
): ListeningChapter {
  return {
    id: section.sourceHref,
    href: section.sourceHref,
    sourceHref: section.sourceHref,
    label: section.title,
    title: section.title,
    depth: 0,
    hasChildren: false,
    disabled: false,
    start: { sectionIndex: index, offset: 0 },
    end: { sectionIndex: index + 1, offset: 0 },
    fallback: true,
  }
}

/** Keep TOC labels/hierarchy, while all source sections and marker IDs stay fixed.
 * A TOC occurrence has its own ID: a part and its first child can share a href
 * but have different inclusive endpoints. Aliases never copy source content.
 */
export function createListeningChapters(
  book: ListeningBook,
  toc: NavItem[],
  navigationPath: string,
): ListeningChapter[] {
  const chapters: ListeningChapter[] = []
  const documents = new Map<number, Document>()
  const offsets = new Map<number, Map<Node, number>>()
  function visit(items: NavItem[], depth: number, parentId?: string) {
    for (const item of items) {
      const resolved = item.href
        ? resolveListeningReference(item.href, navigationPath)
        : undefined
      const href = resolved
        ? resolved.path + (resolved.fragment ? `#${resolved.fragment}` : '')
        : item.href || ''
      const id = `toc:${chapters.length}:${href}`
      const label = item.label.replace(/\s+/g, ' ').trim() || 'Untitled chapter'
      const chapter: ListeningChapter = {
        id,
        href,
        sourceHref: resolved?.path || '',
        label,
        title: label,
        depth,
        parentId,
        hasChildren: !!item.subitems?.length,
        disabled: true,
      }
      const sectionIndex = resolved
        ? book.sections.findIndex(
            (section) => section.sourceHref === resolved.path,
          )
        : -1
      if (!item.href) chapter.reason = 'Choose one of this section’s chapters.'
      else if (!resolved || sectionIndex < 0)
        chapter.reason =
          'This table-of-contents entry has no readable EPUB section.'
      else if (resolved.fragment) {
        let doc = documents.get(sectionIndex)
        if (!doc) {
          doc = chapterDocument(book.sections[sectionIndex]!)
          documents.set(sectionIndex, doc)
          offsets.set(sectionIndex, elementOffsets(doc))
        }
        const anchorId = listeningSourceId(
          book.sections[sectionIndex]!.id,
          resolved.fragment,
        )
        const target = doc.getElementById(anchorId)
        if (!target)
          chapter.reason =
            'This chapter’s EPUB anchor is missing or unavailable.'
        else {
          chapter.start = {
            sectionIndex,
            offset: offsets.get(sectionIndex)!.get(target)!,
            anchorId,
          }
          chapter.disabled = false
        }
      } else {
        chapter.start = { sectionIndex, offset: 0 }
        chapter.disabled = false
      }
      chapters.push(chapter)
      visit(item.subitems || [], depth + 1, id)
    }
  }
  visit(toc, 0)
  const byId = new Map(chapters.map((chapter) => [chapter.id, chapter]))
  function descendsFrom(chapter: ListeningChapter, ancestor: ListeningChapter) {
    let parent = chapter.parentId
    while (parent) {
      if (parent === ancestor.id) return true
      parent = byId.get(parent)?.parentId
    }
    return false
  }
  for (const chapter of chapters) {
    if (!chapter.start) continue
    let end: ListeningPoint = { sectionIndex: book.sections.length, offset: 0 }
    let lastStart = chapter.start
    for (const descendant of chapters) {
      if (
        descendant.start &&
        descendsFrom(descendant, chapter) &&
        compareListeningPoints(descendant.start, lastStart) > 0
      )
        lastStart = descendant.start
    }
    // A parent includes its entire subtree. Leaf endpoints use the next
    // distinct readable target in spine/DOM order, even for out-of-order TOCs.
    for (const next of chapters) {
      if (
        next.start &&
        !descendsFrom(next, chapter) &&
        compareListeningPoints(next.start, lastStart) > 0 &&
        compareListeningPoints(next.start, end) < 0
      )
        end = next.start
    }
    chapter.end = { ...end }
  }
  return chapters.some((chapter) => !chapter.disabled)
    ? chapters
    : book.sections.map(fileChapter)
}

export function getListeningChapters(book: ListeningBook): ListeningChapter[] {
  return book.chapters?.length ? book.chapters : book.sections.map(fileChapter)
}

function legacySectionIndex(book: ListeningBook, reference: string) {
  let path: string
  try {
    path = decodeURIComponent(reference.split(/[?#]/, 1)[0] || '')
  } catch {
    return -1
  }
  if (
    /^[a-z][a-z\d+.-]*:/i.test(path) ||
    /[\\\0]/.test(path) ||
    path.startsWith('//')
  )
    return -1
  const parts: string[] = []
  for (const part of path.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      if (!parts.length) return -1
      parts.pop()
    } else parts.push(part)
  }
  path = parts.join('/')
  if (!path) return -1
  const exact = book.sections.findIndex(
    (section) => section.id === reference || section.sourceHref === path,
  )
  if (exact >= 0) return exact
  const matches = book.sections
    .map((section, index) => ({ section, index }))
    .filter(
      ({ section }) =>
        section.sourceHref.endsWith('/' + path) ||
        path.endsWith('/' + section.sourceHref),
    )
  if (matches.length > 1)
    throw new Error(
      'This chapter path matches more than one chapter. Choose its EPUB chapter again.',
    )
  return matches[0]?.index ?? -1
}

/** Bare source paths are legacy WHOLE-file endpoints, never silently converted
 * to the first fragment chapter. New plans use unique TOC occurrence IDs.
 */
export function resolveListeningChapter(
  book: ListeningBook,
  reference: string,
  _edge?: 'from' | 'through',
): ListeningChapter {
  const chapters = getListeningChapters(book)
  let chapter = chapters.find((entry) => entry.id === reference)
  if (!chapter && !reference.includes('#')) {
    const sectionIndex = legacySectionIndex(book, reference)
    if (sectionIndex >= 0)
      chapter = fileChapter(book.sections[sectionIndex]!, sectionIndex)
  }
  if (
    !chapter &&
    reference.includes('#') &&
    legacySectionIndex(book, reference) >= 0
  ) {
    const resolved = resolveListeningReference(reference)
    const href =
      resolved &&
      resolved.path + (resolved.fragment ? `#${resolved.fragment}` : '')
    // Unambiguous full hrefs remain useful to callers. Prefer the deepest
    // matching alias; persisted new choices always retain their occurrence ID.
    chapter = chapters
      .filter((entry) => entry.href === href)
      .sort((a, b) => b.depth - a.depth)[0]
  }
  if (!chapter)
    throw new Error(
      'This chapter is no longer available. Choose a chapter from this EPUB again.',
    )
  if (chapter.disabled || !chapter.start || !chapter.end)
    throw new Error(chapter.reason || 'This EPUB chapter is unavailable.')
  return chapter
}

export function getListeningRange(
  book: ListeningBook,
  range: { from: string; through: string },
): ListeningChapterRange {
  const from = resolveListeningChapter(book, range.from, 'from')
  const through = resolveListeningChapter(book, range.through, 'through')
  if (compareListeningPoints(from.start!, through.end!) >= 0)
    throw new Error(
      'Through must be the same chapter as From or a later chapter.',
    )
  return { from, through, start: from.start!, end: through.end! }
}

export function validateListeningRange(
  book: ListeningBook,
  range: { from: string; through: string },
): string {
  try {
    getListeningRange(book, range)
    return ''
  } catch (error) {
    return error instanceof Error
      ? error.message
      : 'Choose a valid EPUB chapter range.'
  }
}

export function getBookmarkLocation(
  book: ListeningBook,
  marker: ListeningMarker,
) {
  const sectionIndex = legacySectionIndex(book, marker.sourceHref)
  if (sectionIndex < 0)
    throw new Error('This bookmark’s EPUB chapter is no longer available.')
  const section = book.sections[sectionIndex]!
  const doc = chapterDocument(section)
  const matches = Array.from(
    doc.querySelectorAll('[data-listening-paragraph]'),
  ).filter(
    (element) =>
      element.getAttribute('data-listening-paragraph') === marker.blockId,
  )
  const paragraph = matches[0]
  if (
    matches.length !== 1 ||
    !paragraph ||
    !marker.text ||
    listeningText(paragraph) !== marker.text
  )
    throw new Error(
      'The bookmark no longer matches this EPUB. Bookmark it again in the book or listening document, or choose Chapter beginning.',
    )
  const offsets = elementOffsets(doc)
  let last: Node = paragraph
  while (last.lastChild) last = last.lastChild
  return {
    sectionIndex,
    section,
    paragraph,
    start: {
      sectionIndex,
      offset: offsets.get(paragraph)!,
      anchorId: paragraph.id || undefined,
    },
    end: { sectionIndex, offset: offsets.get(last)! + 1 },
    blockId: marker.blockId,
    text: marker.text,
  }
}

export function validateListeningBookmark(
  book: ListeningBook,
  marker?: ListeningMarker,
): string {
  if (!marker)
    return 'No saved bookmark is available. Choose Chapter beginning.'
  try {
    getBookmarkLocation(book, marker)
    return ''
  } catch (error) {
    return error instanceof Error
      ? error.message
      : 'This saved bookmark is unavailable.'
  }
}

export function chapterForBookmark(
  book: ListeningBook,
  marker: ListeningMarker,
): ListeningChapter {
  const location = getBookmarkLocation(book, marker)
  const chapters = getListeningChapters(book)
    .filter(
      (chapter) =>
        !chapter.disabled &&
        chapter.start &&
        chapter.end &&
        compareListeningPoints(location.start, chapter.start) >= 0 &&
        compareListeningPoints(location.end, chapter.end) <= 0,
    )
    .sort((a, b) => b.depth - a.depth)
  return chapters[0] || fileChapter(location.section, location.sectionIndex)
}

export function isBookmarkInListeningRange(
  book: ListeningBook,
  marker: ListeningMarker,
  from: string,
  through: string,
): boolean {
  const location = getBookmarkLocation(book, marker)
  const range = getListeningRange(book, { from, through })
  return (
    compareListeningPoints(location.start, range.start) >= 0 &&
    compareListeningPoints(location.end, range.end) <= 0
  )
}
