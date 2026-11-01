/* Run with `node scripts/test-listening-epub.cjs` after installing dependencies.
 * Uses an installed Edge browser and the repository's TypeScript/JSZip packages.
 * Set EDGE_PATH to override the browser executable. No test package is required.
 * `node scripts/test-listening-epub.cjs --serve` serves the identical browser
 * tests at http://127.0.0.1:7141 without launching or controlling any browser.
 * `--write` refreshes that fixture without launching a browser or server.
 */
/* global JSZip, prepareListeningBook, getListeningParagraphs,
  getBookmarkParagraphs, markerFromRange, buildQuietSession, sameSourceHref */
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')

const ts = require('typescript')

const root = path.resolve(__dirname, '..')
const serve = process.argv.includes('--serve')
const write = process.argv.includes('--write')
const edge = [
  process.env.EDGE_PATH,
  process.env['ProgramFiles(x86)'] &&
    path.join(
      process.env['ProgramFiles(x86)'],
      'Microsoft/Edge/Application/msedge.exe',
    ),
  process.env.ProgramFiles &&
    path.join(
      process.env.ProgramFiles,
      'Microsoft/Edge/Application/msedge.exe',
    ),
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/microsoft-edge',
].find((candidate) => candidate && fs.existsSync(candidate))
assert(
  serve || write || edge,
  'Install Microsoft Edge or set EDGE_PATH to its executable.',
)

const converter = fs
  .readFileSync(path.join(root, 'apps/reader/src/listening/epub.ts'), 'utf8')
  .replace("import JSZip from 'jszip'", '')
  .replace(/export /g, '')
const compiled = ts.transpileModule(converter, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.None,
  },
}).outputText
const documentSource = fs
  .readFileSync(
    path.join(root, 'apps/reader/src/listening/document.ts'),
    'utf8',
  )
  .replace(/^import[\s\S]*?from ['"][^'"]+['"]\r?\n/gm, '')
  .replace(/export /g, '')
const compiledDocument = ts.transpileModule(documentSource, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.None,
  },
}).outputText
const jszip = fs.readFileSync(
  require.resolve('jszip/dist/jszip.js', {
    paths: [path.join(root, 'apps/reader')],
  }),
  'utf8',
)
const alice = fs
  .readFileSync(path.join(root, 'packages/epubjs/test/fixtures/alice.epub'))
  .toString('base64')

async function verify(aliceBase64) {
  const check = (value, message) => {
    if (!value) throw new Error(message)
  }
  const norm = (text) => text.replace(/\s+/g, ' ').trim()
  const input = Uint8Array.from(atob(aliceBase64), (character) =>
    character.charCodeAt(0),
  ).buffer
  const book = await prepareListeningBook(input)
  const zip = await JSZip.loadAsync(input)
  check(
    book.title === "Alice's Adventures in Wonderland",
    'Alice metadata title changed',
  )
  check(book.language === 'en-US', 'Alice language was not preserved')
  check(
    book.sections.length === 11,
    'Expected title page and 10 linear chapters',
  )
  const ids = new Set()
  const chapters = []
  for (const section of book.sections) {
    const original = new DOMParser().parseFromString(
      await zip.file(section.sourceHref).async('string'),
      'application/xml',
    )
    const output = new DOMParser().parseFromString(section.html, 'text/html')
    output
      .querySelectorAll('.listening-image-description')
      .forEach((element) => element.remove())
    check(
      norm(original.querySelector('body').textContent) ===
        norm(output.body.textContent),
      `Original text changed in ${section.sourceHref}`,
    )
    for (const element of output.querySelectorAll('[id]')) {
      check(!ids.has(element.id), `Duplicate document ID: ${element.id}`)
      ids.add(element.id)
    }
    chapters.push(section.title)
  }
  check(
    book.sections[1].sourceHref === 'OPS/chapter_001.xhtml',
    'Chapter 1 order changed',
  )
  check(
    book.sections[10].sourceHref === 'OPS/chapter_010.xhtml',
    'Chapter 10 order changed',
  )

  const hostile = new JSZip()
  hostile.file(
    'META-INF/container.xml',
    '<container><rootfiles><rootfile full-path="book.opf"/></rootfiles></container>',
  )
  hostile.file(
    'book.opf',
    '<package><metadata><title>Fixture</title><language>en</language></metadata><manifest><item id="a" href="a.xhtml" media-type="application/xhtml+xml"/><item id="b" href="b.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="a"/><itemref idref="b"/></spine></package>',
  )
  hostile.file(
    'a.xhtml',
    '<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>A</h1><p onclick="alert(1)">Keep <em>this</em>.</p><script>window.bad=1</script><img src="https://remote.invalid/pixel" alt="Image description"/><a href="b.xhtml#target">Next</a><a href="javascript:alert(1)">Bad</a><a href="http://[">Malformed</a></body></html>',
  )
  hostile.file(
    'b.xhtml',
    '<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>B</h1><p id="target" xml:lang="fr">Bonjour.</p><p id="cdata"><![CDATA[Keep <this> & this prose.]]></p><h2>Subheading.</h2><p>Repeated bookmark prose.</p><figure><img src="illustration.png" alt="Illo5"/><figcaption><p>Printed caption.</p></figcaption></figure><table><tr><th>Column heading.</th><td><p>Table cell.</p></td></tr></table><pre>Code sample.</pre><p>Repeated bookmark prose.</p></body></html>',
  )
  const cleaned = await prepareListeningBook(
    await hostile.generateAsync({ type: 'arraybuffer' }),
  )
  const output = new DOMParser().parseFromString(
    cleaned.sections.map((section) => section.html).join(''),
    'text/html',
  )
  check(
    !output.querySelector('script,img,[onclick],[src]'),
    'Unsafe content survived sanitization',
  )
  const anchors = Array.from(output.querySelectorAll('a'))
  check(
    anchors[0].getAttribute('href') === '#flow-section-1-ref-target',
    'Cross-chapter link was not rewritten',
  )
  check(
    output.getElementById('flow-section-1-ref-target'),
    'Cross-chapter target was not preserved',
  )
  check(
    !anchors[1].hasAttribute('href') && !anchors[2].hasAttribute('href'),
    'Unsafe or malformed link survived',
  )
  check(
    output.querySelector('[lang="fr"]').textContent === 'Bonjour.',
    'Language was not preserved',
  )
  check(
    output.querySelector('em').textContent === 'this',
    'Emphasis was not preserved',
  )
  check(
    output.getElementById('flow-section-1-ref-cdata').textContent ===
      'Keep <this> & this prose.',
    'CDATA prose was not preserved as literal text',
  )
  check(!output.querySelector('this'), 'CDATA text was interpreted as markup')
  check(
    output.querySelectorAll('.listening-image-description').length === 2,
    'Converter did not retain source image descriptions',
  )
  const narration = buildQuietSession(cleaned, {
    bookId: 'image-fixture',
    fingerprint: 'image-fixture',
    from: 'a.xhtml',
    through: 'b.xhtml',
    startAt: 'chapter',
    updatedAt: 1,
  })
  const narrationDoc = new DOMParser().parseFromString(
    narration.sections.map((section) => section.html).join(''),
    'text/html',
  )
  check(
    !narrationDoc.querySelector('.listening-image-description'),
    'Implicit image descriptions survived in a quiet session',
  )
  check(
    !narrationDoc.body.textContent.includes('Image description') &&
      !narrationDoc.body.textContent.includes('Illo5'),
    'Implicit alt prose remained in a copied chapter',
  )
  check(
    narrationDoc.querySelector('figcaption').textContent === 'Printed caption.',
    'Printed caption was incorrectly removed',
  )
  check(
    cleaned.sections.every((section) =>
      section.html.includes('listening-image-description'),
    ),
    'Quiet-session filtering mutated the source converter result',
  )

  const bookmarkSection = cleaned.sections[1]
  const bookmarkSourceHtml = bookmarkSection.html
  const allBookmarkParagraphs = getListeningParagraphs(bookmarkSection)
  const bookmarkParagraphs = getBookmarkParagraphs(bookmarkSection)
  check(
    JSON.stringify(bookmarkParagraphs.map((paragraph) => paragraph.text)) ===
      JSON.stringify([
        'Bonjour.',
        'Keep <this> & this prose.',
        'Repeated bookmark prose.',
        'Repeated bookmark prose.',
      ]),
    'Quick bookmarks included a heading, caption, table cell or preformatted block, or dropped prose',
  )
  const bookmarkDuplicates = bookmarkParagraphs.filter(
    (paragraph) => paragraph.text === 'Repeated bookmark prose.',
  )
  const sourceBookmarkDuplicates = allBookmarkParagraphs.filter(
    (paragraph) => paragraph.text === 'Repeated bookmark prose.',
  )
  check(
    sourceBookmarkDuplicates.length === 2 &&
      bookmarkDuplicates[0].blockId === sourceBookmarkDuplicates[0].blockId &&
      bookmarkDuplicates[1].blockId === sourceBookmarkDuplicates[1].blockId &&
      bookmarkDuplicates[0].blockId !== bookmarkDuplicates[1].blockId,
    'Bookmark filtering renumbered or collapsed duplicate source paragraphs',
  )
  check(
    bookmarkParagraphs.every((paragraph) =>
      allBookmarkParagraphs.some(
        (source) =>
          source.blockId === paragraph.blockId &&
          source.text === paragraph.text,
      ),
    ) && bookmarkSection.html === bookmarkSourceHtml,
    'Bookmark filtering changed source paragraph IDs, text or chapter HTML',
  )
  const annotatedImageSection = {
    ...bookmarkSection,
    html: `${bookmarkSection.html}<div class="listening-image-description"><span data-listening-paragraph="image-description-fixture">Generated image description.</span></div>`,
  }
  check(
    !getBookmarkParagraphs(annotatedImageSection).some(
      (paragraph) => paragraph.blockId === 'image-description-fixture',
    ),
    'Quick bookmarks included an annotated image description',
  )

  const throws = (action, pattern, message) => {
    try {
      action()
    } catch (error) {
      check(
        pattern.test(error.message),
        `${message}: wrong error ${error.message}`,
      )
      return
    }
    throw new Error(`${message}: did not reject`)
  }
  const markerZip = new JSZip()
  markerZip.file(
    'META-INF/container.xml',
    '<container><rootfiles><rootfile full-path="OPS/book.opf"/></rootfiles></container>',
  )
  markerZip.file(
    'OPS/book.opf',
    '<package><metadata><title>Paragraphs</title><language>en</language></metadata><manifest><item id="a" href="Text/a.xhtml" media-type="application/xhtml+xml"/><item id="b" href="Text/b.xhtml" media-type="application/xhtml+xml"/><item id="c" href="Text/c.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="a"/><itemref idref="b"/><itemref idref="c"/></spine></package>',
  )
  const sourceA =
    '<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>One</h1><p id="repeat-1">Repeated phrase.</p><p id="repeat-2">Repeated phrase.</p><blockquote lang="fr"><p>Before <em>nested</em>.</p><p id="target">Start <strong>with</strong> <a href="b.xhtml#end">this</a> word &amp; keep.</p><p>After target.</p></blockquote><ul><li>Lead <em>in</em><ul><li>Nested list item.</li></ul>Tail.</li></ul><pre>Line one\nline two</pre><div>He<em>llo</em>!</div><p>Break<br/>words.</p></body></html>'
  markerZip.file('OPS/Text/a.xhtml', sourceA)
  markerZip.file(
    'OPS/Text/b.xhtml',
    '<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>Two</h1><p id="end">Inclusive endpoint.</p></body></html>',
  )
  markerZip.file(
    'OPS/Text/c.xhtml',
    '<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>Three</h1><p>Outside range.</p></body></html>',
  )
  const markerBook = await prepareListeningBook(
    await markerZip.generateAsync({ type: 'arraybuffer' }),
  )
  const raw = new DOMParser().parseFromString(sourceA, 'application/xml')
  const rawBody = raw.querySelector('body')
  const select = (element, offset = 0) => {
    const range = raw.createRange()
    range.selectNodeContents(element)
    if (offset) range.setStart(element.firstChild, offset)
    return range
  }
  const repeated = markerFromRange(
    markerBook,
    'Text/a.xhtml#repeat-2',
    select(raw.getElementById('repeat-2')),
  )
  const paragraphs = getListeningParagraphs(markerBook.sections[0])
  const duplicates = paragraphs.filter(
    (paragraph) => paragraph.text === 'Repeated phrase.',
  )
  check(
    duplicates.length === 2 && repeated.blockId === duplicates[1].blockId,
    'Duplicate text mapped to the first occurrence',
  )
  check(
    repeated.sourceHref === 'OPS/Text/a.xhtml',
    'Marker source path was not canonical',
  )
  raw
    .getElementById('repeat-2')
    .setAttribute('data-listening-paragraph', duplicates[0].blockId)
  check(
    markerFromRange(
      markerBook,
      'a.xhtml',
      select(raw.getElementById('repeat-2')),
    ).blockId === repeated.blockId,
    'EPUB-supplied metadata overrode the exact source ordinal',
  )
  raw.getElementById('repeat-2').removeAttribute('data-listening-paragraph')
  check(
    paragraphs.filter((p) => p.text === 'Nested list item.').length === 1,
    'Nested list paragraph was duplicated',
  )
  check(
    paragraphs.some((p) => p.text === 'Lead in') &&
      paragraphs.some((p) => p.text === 'Tail.'),
    'Direct list text disappeared',
  )
  check(
    paragraphs.some((p) => p.text === 'Hello!'),
    'Inline emphasis inserted spaces into source identity',
  )
  check(
    paragraphs.some((p) => p.text === 'Break words.'),
    'Line break did not preserve word separation',
  )

  const nestedMarker = markerFromRange(
    markerBook,
    'a.xhtml',
    select(raw.getElementById('target').querySelector('strong')),
    'epubcfi(test)',
  )
  check(
    nestedMarker.text === 'Start with this word & keep.',
    'Inline selection did not map to its complete paragraph',
  )
  check(
    nestedMarker.cfi === 'epubcfi(test)',
    'Reader return CFI was not preserved',
  )
  const record = {
    bookId: 'fixture',
    fingerprint: 'fixture',
    from: 'OPS/Text/a.xhtml',
    through: 'OPS/Text/b.xhtml',
    startAt: 'marker',
    marker: nestedMarker,
    updatedAt: 1,
  }
  const session = buildQuietSession(markerBook, record)
  const trimmed = new DOMParser().parseFromString(
    session.sections[0].html,
    'text/html',
  )
  check(
    trimmed.querySelector('h1') &&
      trimmed
        .querySelector('h1')
        .compareDocumentPosition(
          trimmed.querySelector('[data-listening-paragraph]'),
        ) & Node.DOCUMENT_POSITION_FOLLOWING &&
      getListeningParagraphs(session.sections[0])[0].text === nestedMarker.text,
    'Quiet document did not retain only chapter context before the saved paragraph',
  )
  check(
    !trimmed.body.textContent.includes('Before nested.') &&
      !trimmed.body.textContent.includes('Repeated phrase.'),
    'Preceding prose survived trimming',
  )
  check(
    trimmed.querySelectorAll('h1').length === 1 &&
      trimmed.querySelector('h1').textContent === 'One',
    'The original chapter heading was missing or duplicated',
  )
  check(
    !trimmed.querySelector(
      'h1[data-listening-block], h1 [data-listening-paragraph], h1 [data-listening-source-index]',
    ),
    'Contextual heading retained saved-paragraph locator attributes',
  )
  check(
    trimmed.querySelector('blockquote[lang="fr"] strong').textContent ===
      'with',
    'Trim lost nested markup or inherited language',
  )
  check(
    trimmed.querySelector('a').getAttribute('href') ===
      '#flow-section-1-ref-end',
    'Trim changed internal links',
  )
  check(
    getListeningParagraphs(session.sections[0])[0].blockId ===
      nestedMarker.blockId,
    'Trim regenerated stable paragraph IDs',
  )
  check(
    session.sections.length === 2 &&
      session.sections[1].html === markerBook.sections[1].html,
    'Through endpoint was not inclusive',
  )
  check(
    !session.sections.some((s) => s.html.includes('Outside range.')),
    'A chapter beyond Through leaked into the document',
  )
  check(
    markerBook.sections[0].html.includes('Before '),
    'Session building mutated the canonical book',
  )

  const headingMarker = markerFromRange(
    markerBook,
    'a.xhtml',
    select(raw.querySelector('h1')),
  )
  const headingSession = buildQuietSession(markerBook, {
    ...record,
    marker: headingMarker,
  })
  const headingDoc = new DOMParser().parseFromString(
    headingSession.sections[0].html,
    'text/html',
  )
  check(
    headingDoc.querySelectorAll('h1').length === 1 &&
      getListeningParagraphs(headingSession.sections[0])[0].blockId ===
        headingMarker.blockId,
    'A saved heading was duplicated or lost its own valid paragraph locator',
  )
  const retainedBook = {
    ...markerBook,
    sections: [
      {
        ...markerBook.sections[0],
        html: '<div><p><span data-listening-paragraph="preface">First prose.</span></p><h1><span data-listening-paragraph="heading">Later heading</span></h1><p>Following prose.</p></div>',
      },
    ],
  }
  const retainedSession = buildQuietSession(retainedBook, {
    ...record,
    through: record.from,
    marker: {
      ...nestedMarker,
      blockId: 'preface',
      text: 'First prose.',
    },
  })
  const retainedDoc = new DOMParser().parseFromString(
    retainedSession.sections[0].html,
    'text/html',
  )
  check(
    retainedDoc.querySelectorAll('h1').length === 1 &&
      getListeningParagraphs(retainedSession.sections[0])[0].blockId ===
        'preface' &&
      retainedDoc
        .querySelector('[data-listening-paragraph="preface"]')
        .compareDocumentPosition(retainedDoc.querySelector('h1')) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    'An already-retained heading was duplicated or moved ahead of the marker',
  )

  const boundary = raw.createRange()
  const second = raw.getElementById('repeat-2')
  boundary.setStart(rawBody, Array.from(rawBody.childNodes).indexOf(second))
  boundary.setEndAfter(second)
  check(
    markerFromRange(markerBook, 'a.xhtml', boundary).blockId ===
      repeated.blockId,
    'Element boundary selected the preceding paragraph',
  )
  const caret = raw.createRange()
  const firstText = raw.getElementById('repeat-1').firstChild
  caret.setStart(firstText, firstText.textContent.length)
  caret.collapse(true)
  check(
    markerFromRange(markerBook, 'a.xhtml', caret).blockId === repeated.blockId,
    'End-of-paragraph caret did not select the next source paragraph',
  )
  const crossing = select(second)
  crossing.setEndAfter(raw.getElementById('target'))
  check(
    markerFromRange(markerBook, 'a.xhtml', crossing).blockId ===
      repeated.blockId,
    'Multi-paragraph selection ignored its first paragraph',
  )

  const modified = raw.cloneNode(true)
  const extra = modified.createElementNS('http://www.w3.org/1999/xhtml', 'p')
  extra.textContent = 'Repeated phrase.'
  modified
    .querySelector('body')
    .insertBefore(extra, modified.getElementById('repeat-2'))
  const ambiguousRange = modified.createRange()
  ambiguousRange.selectNodeContents(modified.getElementById('repeat-2'))
  throws(
    () => markerFromRange(markerBook, 'a.xhtml', ambiguousRange),
    /This bookmark could not be mapped exactly to the EPUB/,
    'Changed duplicate source must not use approximate text matching',
  )
  throws(
    () =>
      buildQuietSession(markerBook, {
        ...record,
        marker: { ...nestedMarker, text: 'Changed source text' },
      }),
    /The bookmark no longer matches this EPUB/,
    'Stale marker text',
  )
  throws(
    () =>
      buildQuietSession(markerBook, {
        ...record,
        marker: { ...nestedMarker, blockId: 'missing' },
      }),
    /The bookmark no longer matches this EPUB/,
    'Missing marker block',
  )
  throws(
    () => buildQuietSession(markerBook, { ...record, marker: undefined }),
    /Bookmark a paragraph first, or choose Chapter beginning/,
    'Missing marker',
  )
  throws(
    () =>
      buildQuietSession(markerBook, { ...record, from: 'OPS/Text/b.xhtml' }),
    /Change From/,
    'Marker chapter differs from From',
  )
  throws(
    () =>
      buildQuietSession(markerBook, {
        ...record,
        from: 'OPS/Text/b.xhtml',
        through: 'OPS/Text/a.xhtml',
      }),
    /Through must/,
    'End before start',
  )
  throws(
    () =>
      buildQuietSession(markerBook, { ...record, through: 'missing.xhtml' }),
    /no longer available/,
    'Missing endpoint',
  )
  const chapterSession = buildQuietSession(markerBook, {
    ...record,
    startAt: 'chapter',
  })
  check(
    chapterSession.sections[0].html === markerBook.sections[0].html,
    'Chapter beginning incorrectly used a saved paragraph',
  )

  check(
    sameSourceHref('OPS/Text/a%20b.xhtml', './Text/a b.xhtml#part'),
    'Encoded package and renderer paths did not match',
  )
  check(
    sameSourceHref('/OPS/Text/../Text/a.xhtml', 'Text/a.xhtml?x=1'),
    'Safe dot segments did not normalize',
  )
  check(
    !sameSourceHref('OPS/chapter.xhtml', 'notchapter.xhtml'),
    'Path matching ignored segment boundaries',
  )
  check(
    !sameSourceHref('OPS/a.xhtml', 'https://remote.invalid/a.xhtml'),
    'Remote URL was accepted as a book locator',
  )
  check(
    !sameSourceHref('OPS/a.xhtml', '../../a.xhtml'),
    'Unresolved parent traversal was accepted',
  )
  check(
    !sameSourceHref('OPS/a.xhtml', '%zz'),
    'Malformed percent encoding was accepted',
  )
  const ambiguousBook = {
    ...markerBook,
    sections: [
      ...markerBook.sections,
      { ...markerBook.sections[0], id: 'other', sourceHref: 'OTHER/a.xhtml' },
    ],
  }
  throws(
    () => markerFromRange(ambiguousBook, 'a.xhtml', select(second)),
    /more than one chapter/,
    'Ambiguous renderer basename',
  )

  const quietRange = trimmed.createRange()
  quietRange.selectNodeContents(
    trimmed.querySelector('[data-listening-paragraph] strong'),
  )
  check(
    markerFromRange(markerBook, record.from, quietRange).blockId ===
      nestedMarker.blockId,
    'Trimmed quiet-document selection lost its source identity',
  )

  // The repository's Alice fixture is abridged: its second Chapter II paragraph
  // starts "Just at this moment", not the unabridged mockup's planning passage.
  const aliceSection = book.sections[2]
  const aliceRaw = new DOMParser().parseFromString(
    await zip.file(aliceSection.sourceHref).async('string'),
    'application/xml',
  )
  const aliceParagraph = Array.from(aliceRaw.querySelectorAll('p')).find((p) =>
    norm(p.textContent).startsWith('Just at this moment'),
  )
  check(aliceParagraph, 'Alice saved-start fixture paragraph is missing')
  const aliceRange = aliceRaw.createRange()
  aliceRange.selectNodeContents(aliceParagraph)
  const aliceMarker = markerFromRange(book, 'chapter_002.xhtml', aliceRange)
  const aliceSession = buildQuietSession(book, {
    ...record,
    from: aliceSection.sourceHref,
    through: book.sections[4].sourceHref,
    marker: aliceMarker,
  })
  const aliceQuiet = new DOMParser().parseFromString(
    aliceSession.sections[0].html,
    'text/html',
  )
  check(
    getListeningParagraphs(aliceSession.sections[0])[0].text ===
      aliceMarker.text &&
      aliceQuiet.querySelectorAll('h1, h2, h3, h4, h5, h6').length === 1,
    'Alice lost its chapter context or first saved paragraph',
  )
  check(
    !aliceQuiet.body.textContent.includes('Curiouser and curiouser'),
    'Earlier Alice prose reappeared after the saved start',
  )
  check(
    aliceSession.sections.length === 3 &&
      aliceSession.sections[2].sourceHref === book.sections[4].sourceHref,
    'Alice II–IV range changed',
  )
  let rejected = false
  try {
    await prepareListeningBook(new Uint8Array([0, 1, 2]).buffer)
  } catch {
    rejected = true
  }
  check(rejected, 'Invalid EPUB was not rejected')
  return {
    passed: true,
    chapters,
    checks: [
      'Exact Alice text',
      'Spine order',
      'Unique IDs',
      'Sanitization',
      'Internal links',
      'Language and emphasis',
      'CDATA literal text',
      'Quiet narration omits implicit image alt and retains printed captions',
      'Prose-only quick bookmarks preserve source IDs and duplicate ordinals without changing HTML',
      'Invalid archive error',
      'Disjoint nested paragraph mapping and duplicate ordinals',
      'Exact source identity and range-boundary selection',
      'Nested markup-preserving trim and inclusive endpoints',
      'Trimmed chapter context without earlier prose or duplicate heading locators',
      'Stale markers and invalid range errors',
      'Safe and unambiguous source paths',
      'Alice saved-paragraph II–IV continuity',
    ],
  }
}

const temp =
  serve || write
    ? path.join(root, '.tmp', 'listening-workflow-tests')
    : fs.mkdtempSync(path.join(os.tmpdir(), 'flow-listening-test-'))
fs.mkdirSync(temp, { recursive: true })
const script = `${jszip}\n${compiled}\n${compiledDocument}\n(${verify.toString()})(${JSON.stringify(
  alice,
)}).then(result => {
  document.getElementById('result').textContent = JSON.stringify(result, null, 2)
  document.getElementById('result').dataset.status = 'passed'
}).catch(error => {
  document.getElementById('result').textContent = error.stack
  document.getElementById('result').dataset.status = 'failed'
})`
const htmlPath = path.join(temp, serve || write ? 'index.html' : 'verify.html')
fs.writeFileSync(
  htmlPath,
  `<!doctype html><meta charset="utf-8"><title>Flow listening document regression tests</title><pre id="result" data-status="running">Running converter and document checks…</pre><script>window.addEventListener('error', event => { const output = document.getElementById('result'); output.dataset.status = 'failed'; output.textContent = event.message; });</script><script>${script.replace(
    /<\/script/gi,
    '<\\/script',
  )}</script>`,
)

if (serve) {
  http
    .createServer((request, response) => {
      if (!['/', '/index.html'].includes(request.url)) {
        response.writeHead(404)
        response.end('Not found')
        return
      }
      response.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      })
      response.end(fs.readFileSync(htmlPath))
    })
    .listen(7141, '127.0.0.1', () => {
      console.log('Converter/document tests: http://127.0.0.1:7141')
      console.log('Fixture: ' + htmlPath)
    })
} else if (write) {
  console.log('Fixture: ' + htmlPath)
} else {
  try {
    const output = execFileSync(
      edge,
      [
        '--headless',
        '--disable-gpu',
        '--no-first-run',
        '--disable-extensions',
        `--user-data-dir=${path.join(temp, 'profile')}`,
        '--virtual-time-budget=10000',
        '--dump-dom',
        htmlPath,
      ],
      {
        encoding: 'utf8',
        timeout: 30000,
        maxBuffer: 8 * 1024 * 1024,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )
    const result =
      /<pre id="result" data-status="(\w+)">([\s\S]*?)<\/pre>/.exec(output)
    assert(result, 'Edge did not return a test result')
    console.log(
      result[2]
        .replace(/&quot;/g, '"')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&'),
    )
    assert.equal(result[1], 'passed', 'Converter tests failed')
  } finally {
    // Only remove the unique temporary directory created by this test.
    assert.equal(path.dirname(temp), path.resolve(os.tmpdir()))
    assert(path.basename(temp).startsWith('flow-listening-test-'))
    fs.rmSync(temp, { recursive: true, force: true, maxRetries: 3 })
  }
}
