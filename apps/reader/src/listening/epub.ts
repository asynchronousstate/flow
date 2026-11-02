import JSZip from 'jszip'

import Navigation from '@flow/epubjs/src/navigation'
import type { NavItem } from '@flow/epubjs/types/navigation'

import {
  createListeningChapters,
  getListeningChapters,
  listeningSourceId as sourceId,
  resolveListeningReference as resolveReference,
} from './chapters'
import type { ListeningChapter } from './chapters'

export interface ListeningSection {
  id: string
  title: string
  html: string
  sourceHref: string
}

export interface ListeningBook {
  title: string
  author: string
  language: string
  sections: ListeningSection[]
  chapters?: ListeningChapter[]
}

interface ManifestItem {
  id: string
  path: string
  mediaType: string
  properties: string[]
}

const safeTags = new Set([
  'a',
  'abbr',
  'b',
  'bdi',
  'bdo',
  'blockquote',
  'br',
  'caption',
  'cite',
  'code',
  'dd',
  'del',
  'dfn',
  'div',
  'dl',
  'dt',
  'em',
  'figcaption',
  'figure',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'i',
  'ins',
  'li',
  'mark',
  'ol',
  'p',
  'pre',
  'q',
  'rp',
  'rt',
  'ruby',
  's',
  'section',
  'small',
  'span',
  'strong',
  'sub',
  'sup',
  'table',
  'tbody',
  'td',
  'th',
  'thead',
  'tfoot',
  'tr',
  'u',
  'ul',
  'wbr',
])

// These elements contain executable, interactive, or non-book content. Other
// unknown containers become plain divs, retaining their readable children.
const excludedTags = new Set([
  'script',
  'style',
  'link',
  'meta',
  'base',
  'iframe',
  'object',
  'embed',
  'input',
  'button',
  'select',
  'textarea',
  'template',
  'noscript',
  'head',
])

const paragraphContainers = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'caption',
  'dd',
  'details',
  'div',
  'dl',
  'dt',
  'fieldset',
  'figcaption',
  'figure',
  'footer',
  'form',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hr',
  'li',
  'main',
  'nav',
  'ol',
  'p',
  'pre',
  'section',
  'summary',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
  'ul',
])

export interface SourceListeningParagraph {
  nodes: Node[]
  text: string
  ordinal: number
}

/** The same text identity is used for source XHTML and its sanitized copy. */
function readListeningText(current: Node): string {
  if (current.nodeType === 3 || current.nodeType === 4)
    return current.textContent ?? ''
  if (current.nodeType === 1) {
    const element = current as Element
    const tag = element.localName.toLowerCase()
    if (
      excludedTags.has(tag) ||
      ['img', 'image', 'svg'].includes(tag) ||
      element.classList.contains('listening-image-description')
    )
      return ''
    if (tag === 'br') return '\n'
  }
  return Array.from(current.childNodes).map(readListeningText).join('')
}

export function listeningText(node: Node): string {
  return normalizedText(readListeningText(node))
}

/** Partition source prose into disjoint runs, including text around nested lists.
 * Inline emphasis stays in its paragraph; a blockquote containing paragraphs is
 * not counted a second time. Renderer-added inline highlight spans are harmless.
 */
export function getSourceListeningParagraphs(
  root: Element,
): SourceListeningParagraph[] {
  const result: SourceListeningParagraph[] = []
  function isBoundary(node: Node): boolean {
    if (node.nodeType !== 1) return false
    const element = node as Element
    const tag = element.localName.toLowerCase()
    if (excludedTags.has(tag) || ['img', 'image', 'svg'].includes(tag))
      return false
    return (
      paragraphContainers.has(tag) ||
      Array.from(element.childNodes).some(isBoundary)
    )
  }
  function visit(parent: Element) {
    let run: Node[] = []
    const flush = () => {
      const text = normalizedText(run.map(readListeningText).join(''))
      if (text) result.push({ nodes: run, text, ordinal: result.length })
      run = []
    }
    for (const child of Array.from(parent.childNodes)) {
      if (isBoundary(child)) {
        flush()
        visit(child as Element)
      } else {
        run.push(child)
      }
    }
    flush()
  }
  visit(root)
  return result
}

function elements(root: Document | Element, localName: string): Element[] {
  return Array.from(root.getElementsByTagNameNS('*', localName))
}

function normalizedText(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim()
}

function parseXml(source: string, filename: string): Document {
  const result = new DOMParser().parseFromString(source, 'application/xml')
  if (elements(result, 'parsererror').length) {
    throw new Error(`Cannot read ${filename}: the EPUB contains invalid XML.`)
  }
  return result
}

async function readFile(zip: JSZip, path: string) {
  const entry = zip.file(path)
  if (!entry) throw new Error(`The EPUB is missing ${path}.`)
  return entry.async('string')
}

function sanitizeChapter(
  body: Element,
  item: ManifestItem,
  sectionId: string,
  sectionIds: Map<string, string>,
): string {
  const output = document.implementation.createHTMLDocument('')
  const container = output.createElement('div')
  const usedIds = new Set<string>()
  const bodyId = body.getAttribute('id')
  if (bodyId) {
    container.id = sourceId(sectionId, bodyId)
    usedIds.add(container.id)
  }
  let blockIndex = 0
  const paragraphs = new Map(
    getSourceListeningParagraphs(body).map((paragraph) => [
      paragraph.nodes[0],
      paragraph,
    ]),
  )

  function copyChildren(source: Element, parent: Node) {
    const children = Array.from(source.childNodes)
    for (let index = 0; index < children.length; index++) {
      const child = children[index]!
      const paragraph = paragraphs.get(child)
      if (!paragraph) {
        copy(child, parent)
        continue
      }
      const wrapper = output.createElement('span')
      wrapper.dataset.listeningParagraph = `${sectionId}-paragraph-${paragraph.ordinal}`
      wrapper.dataset.listeningSourceIndex = String(paragraph.ordinal)
      for (const child of paragraph.nodes) copy(child, wrapper)
      parent.appendChild(wrapper)
      index += paragraph.nodes.length - 1
    }
  }

  function copy(node: Node, parent: Node) {
    // XHTML can put readable prose in CDATA as well as ordinary text nodes.
    if (node.nodeType === 3 || node.nodeType === 4) {
      parent.appendChild(output.createTextNode(node.textContent ?? ''))
      return
    }
    if (node.nodeType !== 1) return

    const source = node as Element
    const tag = source.localName.toLowerCase()
    if (excludedTags.has(tag)) return

    if (tag === 'img' || tag === 'image' || tag === 'svg') {
      const description = normalizedText(
        source.getAttribute('alt') ||
          source.getAttribute('aria-label') ||
          (tag === 'svg' ? elements(source, 'title')[0]?.textContent : ''),
      )
      if (description) {
        const alt = output.createElement('span')
        alt.className = 'listening-image-description'
        alt.textContent = description
        parent.appendChild(alt)
      }
      return
    }

    const target = output.createElement(safeTags.has(tag) ? tag : 'div')
    const originalId = source.getAttribute('id') || source.getAttribute('name')
    if (originalId) {
      const id = sourceId(sectionId, originalId)
      if (!usedIds.has(id)) {
        target.id = id
        usedIds.add(id)
      }
    }
    if (/^(p|h[1-6]|blockquote|li|pre|dt|dd)$/.test(tag)) {
      target.dataset.listeningBlock = `${sectionId}-block-${blockIndex++}`
      if (!target.id) target.id = target.dataset.listeningBlock
    }

    const lang = source.getAttribute('lang') || source.getAttribute('xml:lang')
    if (lang) target.lang = lang
    const dir = source.getAttribute('dir')
    if (dir && ['ltr', 'rtl', 'auto'].includes(dir)) target.dir = dir

    if (tag === 'a') {
      const href = source.getAttribute('href')
      if (href) {
        const resolved = resolveReference(href, item.path)
        const destination = resolved && sectionIds.get(resolved.path)
        if (destination && resolved) {
          target.setAttribute(
            'href',
            `#${encodeURIComponent(
              resolved.fragment
                ? sourceId(destination, resolved.fragment)
                : destination,
            )}`,
          )
        }
      }
    }

    if (tag === 'ol' || tag === 'li') {
      const attribute = tag === 'ol' ? 'start' : 'value'
      const value = source.getAttribute(attribute)
      if (value && /^-?\d{1,6}$/.test(value))
        target.setAttribute(attribute, value)
      if (tag === 'ol' && source.hasAttribute('reversed')) {
        target.setAttribute('reversed', '')
      }
    }
    if (tag === 'td' || tag === 'th') {
      for (const attribute of ['colspan', 'rowspan']) {
        const value = source.getAttribute(attribute)
        if (value && /^\d{1,3}$/.test(value))
          target.setAttribute(attribute, value)
      }
    }

    copyChildren(source, target)
    parent.appendChild(target)
  }

  // Retain language/direction inherited from the original chapter document.
  const language =
    body.getAttribute('lang') ||
    body.getAttribute('xml:lang') ||
    body.ownerDocument.documentElement.getAttribute('lang') ||
    body.ownerDocument.documentElement.getAttribute('xml:lang')
  if (language) container.lang = language
  const direction =
    body.getAttribute('dir') ||
    body.ownerDocument.documentElement.getAttribute('dir')
  if (direction && ['ltr', 'rtl', 'auto'].includes(direction))
    container.dir = direction
  copyChildren(body, container)
  return container.outerHTML
}

async function listeningNavigation(zip: JSZip, manifest: ManifestItem[]) {
  const nav = manifest.find((item) => item.properties.includes('nav'))
  const ncx = manifest.find(
    (item) => item.mediaType === 'application/x-dtbncx+xml',
  )
  const item = nav ?? ncx
  if (!item) return undefined

  // A broken optional table of contents must not prevent reading valid chapters.
  try {
    const doc = parseXml(await readFile(zip, item.path), item.path)
    return { toc: new Navigation(doc).toc, path: item.path }
  } catch {
    // The visible chapter heading remains available as a fallback.
  }
  return undefined
}

/** Build a stable, script-free HTML reading document in EPUB spine order. */
export async function prepareListeningBook(
  data: ArrayBuffer,
): Promise<ListeningBook> {
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(data)
  } catch {
    throw new Error('This file could not be opened as an EPUB archive.')
  }
  const container = parseXml(
    await readFile(zip, 'META-INF/container.xml'),
    'container.xml',
  )
  const packagePath = elements(container, 'rootfile')[0]?.getAttribute(
    'full-path',
  )
  if (!packagePath)
    throw new Error('This EPUB does not identify a book package.')
  const packageDocument = parseXml(
    await readFile(zip, packagePath),
    packagePath,
  )
  const manifest = elements(packageDocument, 'item').map(
    (item): ManifestItem => {
      const href = item.getAttribute('href') ?? ''
      const resolved = resolveReference(href, packagePath)
      return {
        id: item.getAttribute('id') ?? '',
        path: resolved?.path ?? '',
        mediaType: item.getAttribute('media-type') ?? '',
        properties: (item.getAttribute('properties') ?? '').split(/\s+/),
      }
    },
  )
  const spineItems = elements(packageDocument, 'itemref')
    .filter((item) => item.getAttribute('linear') !== 'no')
    .map((item) => {
      const id = item.getAttribute('idref')
      const entry = manifest.find((candidate) => candidate.id === id)
      if (!entry || !entry.path)
        throw new Error(`Cannot find EPUB chapter ${id ?? ''}.`)
      if (!['application/xhtml+xml', 'text/html'].includes(entry.mediaType)) {
        throw new Error(
          `Listening Mode cannot read this chapter format: ${entry.mediaType}.`,
        )
      }
      return entry
    })
  if (!spineItems.length)
    throw new Error('This EPUB has no readable chapters in its reading order.')

  const sectionIds = new Map<string, string>()
  spineItems.forEach((item, index) => {
    if (!sectionIds.has(item.path))
      sectionIds.set(item.path, `flow-section-${index}`)
  })
  const navigation = await listeningNavigation(zip, manifest)
  const titles = new Map<string, string>()
  function collectTitles(items: NavItem[]) {
    for (const item of items) {
      const resolved =
        item.href && resolveReference(item.href, navigation?.path)
      if (resolved && !titles.has(resolved.path))
        titles.set(resolved.path, normalizedText(item.label))
      collectTitles(item.subitems || [])
    }
  }
  if (navigation) collectTitles(navigation.toc)
  const sections: ListeningSection[] = []
  for (const item of spineItems) {
    const source = await readFile(zip, item.path)
    const doc =
      item.mediaType === 'text/html'
        ? new DOMParser().parseFromString(source, 'text/html')
        : parseXml(source, item.path)
    const body = elements(doc, 'body')[0]
    if (!body) throw new Error(`No readable body was found in ${item.path}.`)
    const heading = Array.from(body.querySelectorAll('h1, h2, h3, h4, h5, h6'))
      .map((el) => normalizedText(el.textContent))
      .find(Boolean)
    const title =
      heading || titles.get(item.path) || `Section ${sections.length + 1}`
    const id = `flow-section-${sections.length}`
    sections.push({
      id,
      title,
      sourceHref: item.path,
      html: sanitizeChapter(body, item, id, sectionIds),
    })
  }

  const metadata = elements(packageDocument, 'metadata')[0]
  const metadataText = (name: string) =>
    normalizedText(metadata && elements(metadata, name)[0]?.textContent)
  const book: ListeningBook = {
    title: metadataText('title') || 'Untitled book',
    author: metadataText('creator'),
    language: metadataText('language') || 'en',
    sections,
  }
  book.chapters = navigation
    ? createListeningChapters(book, navigation.toc, navigation.path)
    : getListeningChapters(book)
  return book
}
