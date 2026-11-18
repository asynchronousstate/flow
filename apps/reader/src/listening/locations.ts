import { EpubCFI } from '@flow/epubjs'

import type { Annotation } from '../annotation'
import { db } from '../db'
import { fileToEpub } from '../file'

import { sameSourceHref } from './document'
import type { QuietListeningSession } from './document'
import { sourceTextNodes } from './epub'
import type { ListeningImage, ListeningSection } from './epub'

interface LocatedText {
  node: Text
  sourceIndex: number
}

export interface QuietSectionLocation {
  section: ListeningSection
  element: HTMLElement
  text: LocatedText[]
  images: { image: ListeningImage; passage: Text | HTMLElement }[]
}

export function locateQuietDocument(
  article: HTMLElement,
  session: QuietListeningSession,
): QuietSectionLocation[] {
  return session.sections.flatMap((section, index) => {
    const element = article.children[index] as HTMLElement | undefined
    if (!element || element.id !== section.id) return []
    const text: LocatedText[] = []
    const imageAnchors = new Map<string, Comment>()
    const walker = article.ownerDocument.createTreeWalker(
      element,
      NodeFilter.SHOW_COMMENT,
    )
    for (let marker = walker.nextNode(); marker; marker = walker.nextNode()) {
      const value = marker.nodeValue ?? ''
      const textId = /^flow-source-text:(\d+)$/.exec(value)
      if (textId && marker.nextSibling?.nodeType === Node.TEXT_NODE)
        text.push({
          node: marker.nextSibling as Text,
          sourceIndex: Number(textId[1]),
        })
      if (value.startsWith('flow-source-image:'))
        imageAnchors.set(
          value.slice('flow-source-image:'.length),
          marker as Comment,
        )
    }
    const images = (section.images ?? []).flatMap((image) => {
      const anchor = imageAnchors.get(image.id)
      if (!anchor) return []
      const following = text.find(
        ({ node }) =>
          node.data.trim() &&
          !!(
            anchor.compareDocumentPosition(node) &
            Node.DOCUMENT_POSITION_FOLLOWING
          ),
      )
      return [
        { image, passage: following?.node ?? text.at(-1)?.node ?? element },
      ]
    })
    return [{ section, element, text, images }]
  })
}

/** Read canonical source DOM and archive assets without mounting an EPUB reader. */
export function createListeningSource(bookId: string) {
  async function open() {
    const stored = await db?.files.get(bookId)
    if (!stored)
      throw new Error('Import this EPUB to access its original locations.')
    const epub = await fileToEpub(stored.file)
    try {
      await epub.opened
      return epub
    } catch (error) {
      epub.destroy()
      throw error
    }
  }

  let book: ReturnType<typeof open> | undefined
  function openBook() {
    if (!book)
      book = open().catch((error) => {
        book = undefined
        throw error
      })
    return book
  }

  async function readSection(section: ListeningSection) {
    const epub = await openBook()
    const source =
      section.spineIndex === undefined
        ? undefined
        : epub.section(section.spineIndex)
    if (!source || !sameSourceHref(source.href, section.sourceHref))
      throw new Error('The original EPUB section could not be matched.')
    await source.load(epub.load.bind(epub))
    const body = source.document.querySelector('body')
    if (!body) throw new Error('The original EPUB section has no text.')
    return {
      document: source.document,
      text: sourceTextNodes(body),
      cfiFromRange: source.cfiFromRange.bind(source),
    }
  }

  const sections = new Map<string, ReturnType<typeof readSection>>()
  return {
    section(location: QuietSectionLocation) {
      const { section } = location
      let source = sections.get(section.id)
      if (!source) {
        source = readSection(section).catch((error: unknown) => {
          sections.delete(section.id)
          throw error
        })
        sections.set(section.id, source)
      }
      return source
    },
    async image(image: ListeningImage) {
      const epub = await openBook()
      return epub.archive.getBlob(
        '/' + encodeURIComponent(image.path),
        image.mediaType,
      )
    },
    close() {
      sections.clear()
      void book?.then(
        (epub) => epub.destroy(),
        () => {},
      )
    },
  }
}

type ListeningSource = ReturnType<typeof createListeningSource>

function textIntersection(range: Range, node: Text) {
  if (!range.intersectsNode(node)) return undefined
  const start = range.startContainer === node ? range.startOffset : 0
  const end = range.endContainer === node ? range.endOffset : node.length
  return start < end ? { start, end } : undefined
}

function matchingSourceText(text: Text[], run: LocatedText) {
  const source = text[run.sourceIndex]
  return source?.data === run.node.data ? source : undefined
}

export async function quietSelectionAnchor(
  range: Range,
  locations: QuietSectionLocation[],
  source: ListeningSource,
) {
  const sections = locations.filter(
    ({ element }) =>
      element.contains(range.startContainer) &&
      element.contains(range.endContainer),
  )
  const location = sections[0]
  if (!location)
    throw new Error(
      'Select text within one EPUB section to create an annotation.',
    )
  const selected = location.text.flatMap((run) => {
    const offsets = textIntersection(range, run.node)
    return offsets && run.node.data.slice(offsets.start, offsets.end).trim()
      ? [{ run, ...offsets }]
      : []
  })
  const first = selected[0]
  const last = selected[selected.length - 1]
  if (!first || !last) throw new Error('Select some of the book’s text first.')
  const canonical = await source.section(location)
  const start = matchingSourceText(canonical.text, first.run)
  const end = matchingSourceText(canonical.text, last.run)
  if (!start || !end)
    throw new Error('This selection could not be matched to the EPUB.')
  const original = canonical.document.createRange()
  original.setStart(start, first.start)
  original.setEnd(end, last.end)
  const cfi = canonical.cfiFromRange(original)
  // Confirm the EPUB reader can resolve both endpoints before saving.
  const verified = new EpubCFI(cfi).toRange(canonical.document)
  if (
    verified?.startContainer !== start ||
    verified.startOffset !== first.start ||
    verified.endContainer !== end ||
    verified.endOffset !== last.end
  )
    throw new Error(
      'This selection could not be saved at an exact EPUB location.',
    )
  return {
    cfi,
    spine: {
      index: location.section.spineIndex!,
      title: location.section.title,
    },
    text: range.toString().replace(/\s+/g, ' ').trim(),
  }
}

export interface QuietAnnotation {
  annotation: Annotation
  range: Range
}

export async function annotationsInDocument(
  annotations: Annotation[],
  locations: QuietSectionLocation[],
  source: ListeningSource,
): Promise<QuietAnnotation[]> {
  const matches: QuietAnnotation[] = []
  const bySpine = new Map<number, Annotation[]>()
  for (const annotation of annotations) {
    const existing = bySpine.get(annotation.spine.index)
    if (existing) existing.push(annotation)
    else bySpine.set(annotation.spine.index, [annotation])
  }
  for (const location of locations) {
    const candidates = bySpine.get(location.section.spineIndex!)
    if (!candidates?.length || !location.text.length) continue
    const canonical = await source.section(location)
    const retained = location.text.flatMap((run) => {
      const originalNode = matchingSourceText(canonical.text, run)
      return originalNode ? [{ node: run.node, originalNode }] : []
    })
    for (const annotation of candidates) {
      let original: Range
      try {
        const cfi = new EpubCFI(annotation.cfi)
        if (cfi.spinePos !== location.section.spineIndex) continue
        original = cfi.toRange(canonical.document)
        if (!original || original.collapsed) continue
      } catch {
        // Older books can contain invalid or stale annotation locations.
        continue
      }
      const visible = retained.flatMap(({ node, originalNode }) => {
        const offsets = textIntersection(original, originalNode)
        return offsets ? [{ node, ...offsets }] : []
      })
      const first = visible[0]
      const last = visible[visible.length - 1]
      if (!first || !last) continue
      const range = location.element.ownerDocument.createRange()
      range.setStart(first.node, first.start)
      range.setEnd(last.node, last.end)
      if (!range.toString().trim()) continue
      matches.push({ annotation, range })
    }
  }
  return matches
}

export interface QuietSearchMatch {
  sectionTitle: string
  excerpt: string
  range: Range
}

export const listeningSearchLimit = 200

export function searchListeningText(
  locations: QuietSectionLocation[],
  keyword: string,
): QuietSearchMatch[] {
  const words = keyword.trim().split(/\s+/).filter(Boolean)
  if (!words.length) return []
  const escaped = words.map((word) =>
    word.replace(/[.*+?$^{}()|[\]\\]/g, '\\$&'),
  )
  const pattern = new RegExp(escaped.join('\\s+'), 'giu')
  const results: QuietSearchMatch[] = []
  for (const { element, section } of locations) {
    const blocks = new Map<Element, Text[]>()
    for (const text of sourceTextNodes(element)) {
      const block =
        text.parentElement?.closest(
          '[data-listening-paragraph], p, h1, h2, h3, h4, h5, h6, li, pre, td, th, figcaption',
        ) ?? text.parentElement
      if (!block) continue
      const nodes = blocks.get(block)
      if (nodes) nodes.push(text)
      else blocks.set(block, [text])
    }
    for (const nodes of blocks.values()) {
      let content = ''
      const offsets = nodes.map((node) => {
        const start = content.length
        content += node.data
        return { node, start, end: content.length }
      })
      for (const match of content.matchAll(pattern)) {
        const start = match.index!
        const end = start + match[0]!.length
        const first = offsets.find((offset) => offset.end > start)
        const last = offsets.find((offset) => offset.end >= end)
        if (!first || !last) continue
        const range = element.ownerDocument.createRange()
        range.setStart(first.node, start - first.start)
        range.setEnd(last.node, end - last.start)
        results.push({
          sectionTitle: section.title,
          excerpt: content.slice(Math.max(0, start - 40), end + 55).trim(),
          range,
        })
        if (results.length >= listeningSearchLimit) return results
      }
    }
  }
  return results
}
