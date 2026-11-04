/* Actual Section.find, sprint/walk and EpubCFI on the installed XML DOM.
 * The boundary-only Range adapter supplies the browser API xmldom omits.
 * This checks search/locator data; native EPUB navigation is tested separately.
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { createRequire } = require('node:module')
const ts = require('typescript')
const root = path.resolve(__dirname, '..')
const epubRequire = createRequire(
  path.join(root, 'packages/epubjs/package.json'),
)
const xml = epubRequire('@xmldom/xmldom')

function load(relative, dependencies) {
  const compiled = ts.transpileModule(
    fs.readFileSync(path.join(root, relative), 'utf8'),
    {
      compilerOptions: {
        target: ts.ScriptTarget.ES2020,
        module: ts.ModuleKind.CommonJS,
        esModuleInterop: true,
      },
    },
  ).outputText
  const module = { exports: {} }
  vm.runInNewContext(compiled, {
    exports: module.exports,
    console,
    URL,
    require(name) {
      if (Object.hasOwn(dependencies, name)) return dependencies[name]
      throw new Error('Unexpected search-test dependency ' + name)
    },
  })
  return module.exports
}
const core = load('packages/epubjs/src/utils/core.js', {
  '@xmldom/xmldom': xml,
})
const EpubCFI = load('packages/epubjs/src/epubcfi.js', {
  './utils/core': core,
}).default
const Hook = load('packages/epubjs/src/utils/hook.js', {}).default
const Section = load('packages/epubjs/src/section.js', {
  '@xmldom/xmldom': xml,
  './epubcfi': EpubCFI,
  './utils/core': core,
  './utils/hook': Hook,
  './utils/replacements': {},
  './utils/request': {},
}).default

class BoundaryRange {
  setStart(node, offset) {
    this.startContainer = node
    this.startOffset = offset
  }
  setEnd(node, offset) {
    this.endContainer = node
    this.endOffset = offset
  }
  get collapsed() {
    return (
      this.startContainer === this.endContainer &&
      this.startOffset === this.endOffset
    )
  }
}
function fixture(markup, bodyProperty = true) {
  const doc = new xml.DOMParser().parseFromString(
    markup,
    'application/xhtml+xml',
  )
  if (bodyProperty) doc.body = doc.getElementsByTagNameNS('*', 'body')[0]
  doc.createRange = () => new BoundaryRange()
  const section = new Section({
    idref: 'chapter',
    index: 0,
    href: 'chapter.xhtml',
    linear: 'yes',
    cfiBase: '/6/2[chapter]',
  })
  section.document = doc
  return { doc, section }
}
const markup = `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Alice head-exclusive-secret</title><style>head-style-only</style></head><body><h1>Alice’s Adventures</h1><p>Alice met ALICE in the garden.</p></body></html>`
function rangeText(range) {
  assert.equal(range.startContainer, range.endContainer)
  return range.startContainer.textContent.slice(
    range.startOffset,
    range.endOffset,
  )
}
function inside(node, ancestor) {
  for (let current = node; current; current = current.parentNode)
    if (current === ancestor) return true
  return false
}
let passed = 0
function test(name, verify) {
  verify()
  passed++
  console.log('PASS ' + name)
}

test('section search excludes HEAD title/style metadata while retaining visible body title matches', () => {
  const { doc, section } = fixture(markup)
  assert.equal(section.find('head-exclusive-secret').length, 0)
  assert.equal(section.find('head-style-only').length, 0)
  const title = section.find('Adventures')
  assert.equal(title.length, 1)
  const range = new EpubCFI(title[0].cfi).toRange(doc)
  assert.equal(rangeText(range), 'Adventures')
  assert.equal(inside(range.startContainer, doc.body), true)
})
test('body searches preserve case-insensitive occurrence order, original excerpts and complete body-relative CFIs', () => {
  const { doc, section } = fixture(markup)
  const matches = section.find('aLiCe')
  assert.equal(matches.length, 3)
  assert.deepEqual(
    Array.from(matches, (match) => match.excerpt),
    [
      'Alice’s Adventures',
      'Alice met ALICE in the garden.',
      'Alice met ALICE in the garden.',
    ],
  )
  const nodes = []
  core.sprint(doc.body, (node) => nodes.push(node))
  const expected = [
    [nodes[0], 0],
    [nodes[1], 0],
    [nodes[1], 10],
  ].map(([node, offset]) => {
    const range = doc.createRange()
    range.setStart(node, offset)
    range.setEnd(node, offset + 5)
    return section.cfiFromRange(range)
  })
  assert.deepEqual(
    Array.from(matches, (match) => match.cfi),
    expected,
  )
  for (const match of matches) {
    const range = new EpubCFI(match.cfi).toRange(doc)
    assert.equal(inside(range.startContainer, doc.body), true)
    assert.equal(rangeText(range).toLowerCase(), 'alice')
  }
})
test('namespace-aware XHTML body fallback excludes metadata without a document.body convenience property', () => {
  const { doc, section } = fixture(
    '<x:html xmlns:x="http://www.w3.org/1999/xhtml"><x:head><x:title>metadata-only</x:title></x:head><x:body><x:p>Visible Alice.</x:p></x:body></x:html>',
    false,
  )
  assert.equal(doc.body, undefined)
  assert.equal(section.find('metadata-only').length, 0)
  const matches = section.find('Alice')
  assert.equal(matches.length, 1)
  const range = new EpubCFI(matches[0].cfi).toRange(doc)
  assert.equal(rangeText(range), 'Alice')
  assert.equal(
    inside(range.startContainer, doc.getElementsByTagNameNS('*', 'body')[0]),
    true,
  )
})
test('long visible excerpts and exact CFI character offsets remain unchanged', () => {
  const prose = 'x'.repeat(80) + 'Alice' + 'z'.repeat(100)
  const { doc, section } = fixture(
    `<html><head><title>Alice metadata</title></head><body><p>${prose}</p></body></html>`,
  )
  const matches = section.find('alice')
  assert.equal(matches.length, 1)
  assert.equal(matches[0].excerpt, '...' + prose.substring(5, 155) + '...')
  const range = new EpubCFI(matches[0].cfi).toRange(doc)
  assert.equal(range.startOffset, 80)
  assert.equal(range.endOffset, 85)
  assert.equal(rangeText(range), 'Alice')
})
test('documents without a body retain their document-element text fallback and unmatched queries stay empty', () => {
  const { doc, section } = fixture(
    '<chapter><p>Visible Alice.</p></chapter>',
    false,
  )
  const matches = section.find('alice')
  assert.equal(matches.length, 1)
  assert.equal(rangeText(new EpubCFI(matches[0].cfi).toRange(doc)), 'Alice')
  assert.equal(section.find('absent').length, 0)
})
console.log(`${passed}/${passed} visible EPUB search groups passed.`)
