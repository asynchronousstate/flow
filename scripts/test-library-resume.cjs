/* Presentation unit checks. No EPUB parsing, database writes or UI claims. */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const source = fs.readFileSync(
  path.resolve(__dirname, '../apps/reader/src/library/presentation.ts'),
  'utf8',
)
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.CommonJS,
  },
}).outputText
const context = { exports: {} }
vm.runInNewContext(compiled, context, { filename: 'presentation.ts' })
const {
  libraryBookDetails,
  libraryImportKind,
  readingResumeSummary,
  listeningResumeSummary,
} = context.exports
let passed = 0
function test(name, verify) {
  verify()
  passed += 1
  console.log('PASS ' + name)
}

test('Android EPUB provider MIME aliases select the EPUB parser while backup ZIPs and unsupported files stay distinct', () => {
  for (const type of [
    '',
    'application/zip',
    'application/octet-stream',
    'application/epub+zip',
  ])
    assert.equal(libraryImportKind({ name: 'ALICE.EPUB', type }), 'epub')
  assert.equal(libraryImportKind({ name: 'backup.zip', type: '' }), 'backup')
  assert.equal(
    libraryImportKind({ name: 'download', type: 'application/epub' }),
    'epub',
  )
  assert.equal(
    libraryImportKind({ name: 'data.xml', type: 'text/xml' }),
    'unsupported',
  )
})

test('metadata title and author are readable without exposing technical filenames as primary titles', () => {
  const result = libraryBookDetails({
    name: 'download-123.epub',
    metadata: {
      title: '  Alice\n in Wonderland ',
      creator: ' Lewis\tCarroll ',
    },
  })
  assert.equal(result.title, 'Alice in Wonderland')
  assert.equal(result.author, 'Lewis Carroll')
  assert.equal(result.filename, 'download-123.epub')
})
test('missing or whitespace metadata falls back without hiding a usable filename', () => {
  assert.equal(
    libraryBookDetails({ name: 'Alice.epub', metadata: { title: '\t' } }).title,
    'Alice.epub',
  )
  assert.equal(libraryBookDetails({ name: '' }).title, 'Untitled book')
  assert.equal(libraryBookDetails({ name: 'Alice.epub' }).author, '')
})
test('reading resumes distinguish unstarted books and saved locations without invalid percentages', () => {
  assert.equal(readingResumeSummary({}), 'Not started')
  assert.equal(
    readingResumeSummary({ cfi: 'saved-cfi' }),
    'Saved reading position',
  )
  assert.equal(readingResumeSummary({ percentage: 0 }), '0%')
  assert.equal(readingResumeSummary({ percentage: 0.254 }), '25%')
  assert.equal(readingResumeSummary({ percentage: NaN }), 'Not started')
  assert.equal(
    readingResumeSummary({ percentage: Infinity, cfi: 'saved' }),
    'Saved reading position',
  )
})
test('out-of-bounds stored reading percentages cannot overflow the library progress display', () => {
  assert.equal(readingResumeSummary({ percentage: -4 }), '0%')
  assert.equal(readingResumeSummary({ percentage: 2 }), '100%')
})
const record = {
  bookId: 'alice',
  fingerprint: 'fingerprint',
  from: 'toc:2:chapter3.xhtml',
  through: 'toc:3:chapter4.xhtml',
  startAt: 'chapter',
  updatedAt: 42,
  marker: {
    sourceHref: 'chapter3.xhtml',
    blockId: 'p2',
    text: '  The first question,\n of course… ',
    savedAt: 40,
  },
}
test('fresh listening resume previews a saved Bookmark even after an explicit Chapter beginning workflow', () => {
  const summary = listeningResumeSummary('alice', record)
  assert.equal(summary.label, 'Saved Bookmark')
  assert.equal(summary.excerpt, 'The first question, of course…')
  assert.equal(summary.bookmark, true)
  assert.equal(record.startAt, 'chapter')
})
test('missing plans and other-book plans cannot leak another book’s saved excerpt', () => {
  assert.equal(listeningResumeSummary('alice').label, 'Not set yet')
  assert.equal(listeningResumeSummary('other', record).excerpt, '')
  assert.equal(
    listeningResumeSummary('alice', { ...record, marker: undefined }).label,
    'Chapter beginning',
  )
})
test('incomplete saved markers require review rather than promising a valid start', () => {
  const summary = listeningResumeSummary('alice', {
    ...record,
    marker: { ...record.marker, blockId: '' },
  })
  assert.equal(summary.label, 'Bookmark needs review')
  assert.equal(summary.bookmark, false)
})
test('stored chapter labels and excerpts are bounded and presentation never mutates immutable plans', () => {
  const frozen = Object.freeze({
    ...record,
    marker: Object.freeze({
      ...record.marker,
      chapterTitle: '  Chapter III ',
      text: 'A '.repeat(200),
    }),
  })
  const before = JSON.stringify(frozen)
  const summary = listeningResumeSummary('alice', frozen)
  assert.equal(summary.label, 'Chapter III')
  assert.ok(summary.excerpt.length <= 140)
  assert.ok(summary.excerpt.endsWith('…'))
  assert.equal(JSON.stringify(frozen), before)
})
console.log(`${passed}/${passed} library presentation groups passed.`)
