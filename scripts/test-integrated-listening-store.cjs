/* Run: node scripts/test-integrated-listening-store.cjs
 * Executes the real integrated.ts exports in a Node VM with real WebCrypto.
 * The database is an isolated structured-clone memory model, NOT Dexie/IndexedDB.
 * These are persistence/race unit tests, not migration or browser verification.
 * EPUB conversion and DOM document validation are controlled dependencies; their
 * separate browser regression suite is scripts/test-listening-epub.cjs.
 */
const assert = require('node:assert/strict')
const { createHash, webcrypto } = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const ts = require('typescript')

const clone = (value) => structuredClone(value)
const sourcePath = path.resolve(
  __dirname,
  '../apps/reader/src/listening/integrated.ts',
)
const compiled = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
  compilerOptions: {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.CommonJS,
  },
}).outputText

function deferredGate() {
  let enter
  let release
  const entered = new Promise((resolve) => {
    enter = resolve
  })
  const released = new Promise((resolve) => {
    release = resolve
  })
  return {
    entered,
    release,
    async block() {
      enter()
      await released
    },
  }
}

class MemoryTable {
  constructor(name, key, writes) {
    this.name = name
    this.key = key
    this.rows = new Map()
    this.writes = writes
    this.getGate = undefined
  }
  async get(key) {
    // Like a database read, return a detached record, never a live map reference.
    const value = clone(this.rows.get(key))
    const gate = this.getGate
    this.getGate = undefined
    if (gate) await gate.block()
    return value
  }
  async put(value) {
    const key = value[this.key]
    assert.notEqual(key, undefined, this.name + ' primary key is required')
    this.rows.set(key, clone(value))
    this.writes.push({ table: this.name, operation: 'put', key })
    return key
  }
  async delete(key) {
    this.rows.delete(key)
    this.writes.push({ table: this.name, operation: 'delete', key })
  }
  pauseNextGet() {
    assert.equal(this.getGate, undefined)
    this.getGate = deferredGate()
    return this.getGate
  }
}

class MemoryDatabase {
  constructor() {
    this.writes = []
    this.books = new MemoryTable('books', 'id', this.writes)
    this.files = new MemoryTable('files', 'id', this.writes)
    this.listening = new MemoryTable('listening', 'bookId', this.writes)
    this.listeningSessions = new MemoryTable(
      'listeningSessions',
      'id',
      this.writes,
    )
    this.tail = Promise.resolve()
    this.transactionGate = undefined
  }
  pauseTransaction(number) {
    assert.equal(this.transactionGate, undefined)
    const gate = deferredGate()
    this.transactionGate = { remaining: number, gate }
    return gate
  }
  async transaction(mode, ...args) {
    assert.equal(mode, 'rw')
    const action = args.pop()
    const tables = args
    // A scheduled test interleaving occurs BEFORE acquiring a transaction lock.
    // It never permits another transaction to mutate a held transaction's data.
    if (this.transactionGate && --this.transactionGate.remaining === 0) {
      const { gate } = this.transactionGate
      this.transactionGate = undefined
      await gate.block()
    }
    const previous = this.tail
    let unlock
    this.tail = new Promise((resolve) => {
      unlock = resolve
    })
    await previous
    const snapshots = tables.map((table) => [table, clone(table.rows)])
    try {
      return await action()
    } catch (error) {
      for (const [table, rows] of snapshots) table.rows = rows
      throw error
    } finally {
      unlock()
    }
  }
}

const fixtureBook = {
  title: 'Storage fixture',
  author: 'Fixture',
  language: 'en',
  sections: ['I', 'II', 'III', 'IV'].map((number, index) => ({
    id: 'section-' + index,
    sourceHref: `OPS/${number}.xhtml`,
    title: 'Chapter ' + number,
    html: '<p>Document content is covered by the separate DOM suite.</p>',
  })),
}

function harness() {
  const db = new MemoryDatabase()
  const dependencies = {
    prepareGate: undefined,
    prepared: 0,
    validated: [],
    book: clone(fixtureBook),
    rangeProblem: '',
    rangesValidated: [],
  }
  const controlled = {
    '../db': { db },
    // DOM/TOC validation is exercised by test-listening-epub.cjs. These
    // controlled boundaries verify storage forwards logical refs unchanged,
    // respects unavailable entries and rolls back a rejected range.
    './chapters': {
      compareListeningPoints(left, right) {
        return (
          left.sectionIndex - right.sectionIndex || left.offset - right.offset
        )
      },
      getListeningChapters(book) {
        return (
          book.chapters ||
          book.sections.map((section) => ({
            id: section.sourceHref,
            disabled: false,
          }))
        ).map((chapter, index) => ({
          ...chapter,
          start: chapter.start || { sectionIndex: index, offset: 0 },
          end: chapter.end || { sectionIndex: index + 1, offset: 0 },
        }))
      },
      validateListeningRange(book, record) {
        dependencies.rangesValidated.push(clone(record))
        return dependencies.rangeProblem
      },
    },
    './epub': {
      async prepareListeningBook() {
        dependencies.prepared++
        const gate = dependencies.prepareGate
        dependencies.prepareGate = undefined
        if (gate) await gate.block()
        return clone(dependencies.book)
      },
    },
    './document': {
      buildQuietSession(book, record) {
        dependencies.validated.push(clone(record))
        return {
          title: book.title,
          language: book.language,
          sections: book.sections,
        }
      },
    },
  }
  const module = { exports: {} }
  const context = vm.createContext({ crypto: webcrypto })
  const run = new vm.Script(
    `(function(require, module, exports) {\n${compiled}\n})`,
    {
      filename: sourcePath,
    },
  ).runInContext(context)
  run(
    (name) => {
      assert(Object.hasOwn(controlled, name), 'Unexpected dependency: ' + name)
      return controlled[name]
    },
    module,
    module.exports,
  )
  return { db, dependencies, api: module.exports }
}

async function seed(db, id = 'book-a', bytes = 'EPUB revision A') {
  await db.books.put({
    id,
    name: 'Fixture.epub',
    cfi: 'epubcfi(original-reading-position)',
    percentage: 0.31,
    annotations: [
      { id: 'note-1', text: 'Original note', cfi: 'epubcfi(note)' },
    ],
    definitions: ['word'],
    configuration: { typography: { fontSize: 19 } },
  })
  await db.files.put({
    id,
    file: new Blob([bytes], { type: 'application/epub+zip' }),
  })
}

function marker(chapter = 'II', text = 'Saved paragraph') {
  return {
    sourceHref: `OPS/${chapter}.xhtml`,
    blockId: `${chapter}-paragraph-2`,
    text,
    savedAt: 123,
    cfi: 'epubcfi(manual-selection)',
  }
}

const fingerprint = (bytes) => createHash('sha256').update(bytes).digest('hex')
const changed = (error) => error.code === 'BOOK_CHANGED'
const unavailable = (error) => error.code === 'SESSION_UNAVAILABLE'
const same = (actual, expected, message) =>
  assert.deepStrictEqual(clone(actual), clone(expected), message)

const tests = []
const test = (name, run) => tests.push({ name, run })

test('SHA-256 replacement rejects stale marker writes before and after explicit reset', async () => {
  const { db, api, dependencies } = harness()
  await seed(db)
  const first = await api.loadLibraryListeningBook('book-a')
  assert.equal(first.record.fingerprint, fingerprint('EPUB revision A'))
  const original = await api.saveLibraryMarker(
    'book-a',
    marker(),
    first.record.fingerprint,
    {
      from: 'OPS/II.xhtml',
      through: 'OPS/IV.xhtml',
    },
  )
  await db.files.put({ id: 'book-a', file: new Blob(['EPUB revision B']) })
  await assert.rejects(
    api.saveLibraryMarker('book-a', marker('III'), first.record.fingerprint),
    changed,
  )
  same(
    await db.listening.get('book-a'),
    original,
    'Replacement silently reset or wrote the stale plan',
  )
  const reset = await api.resetLibraryListeningBook('book-a')
  assert.equal(reset.record.fingerprint, fingerprint('EPUB revision B'))
  assert.notEqual(reset.record.fingerprint, first.record.fingerprint)
  await assert.rejects(
    api.saveLibraryMarker('book-a', marker('III'), first.record.fingerprint),
    changed,
  )
  same(
    await db.listening.get('book-a'),
    reset.record,
    'Stale client overwrote the reset plan',
  )
  assert.equal(
    dependencies.prepared,
    2,
    'Distinct source bytes must use distinct parsed cache entries',
  )
})

test('a reset between marker read and write rejects the delayed stale writer', async () => {
  const { db, api } = harness()
  await seed(db)
  const first = await api.loadLibraryListeningBook('book-a')
  const gate = db.pauseTransaction(2) // load transaction, then the marker write
  const pending = api.saveLibraryMarker(
    'book-a',
    marker(),
    first.record.fingerprint,
  )
  await gate.entered
  await db.files.put({ id: 'book-a', file: new Blob(['EPUB revision B']) })
  const reset = await api.resetLibraryListeningBook('book-a')
  const rejected = assert.rejects(pending, /book changed/i)
  gate.release()
  await rejected
  same(
    await db.listening.get('book-a'),
    reset.record,
    'Delayed writer restored its old marker',
  )
})

test('launch snapshots preserve the clicked range and marker during later global edits', async () => {
  const { db, api, dependencies } = harness()
  await seed(db)
  const initial = await api.loadLibraryListeningBook('book-a')
  const clicked = await api.saveLibraryMarker(
    'book-a',
    marker('II', 'Clicked paragraph'),
    initial.record.fingerprint,
    {
      from: 'OPS/II.xhtml',
      through: 'OPS/IV.xhtml',
    },
  )
  const expected = clone(clicked)
  const gate = db.files.pauseNextGet()
  const launching = api.createQuietLaunch('book-a', clicked)
  await gate.entered
  await api.saveLibraryMarker(
    'book-a',
    marker('III', 'Next session paragraph'),
    initial.record.fingerprint,
    {
      from: 'OPS/III.xhtml',
      through: 'OPS/III.xhtml',
    },
  )
  gate.release()
  const launchId = await launching
  assert.match(launchId, /^[a-f\d-]{36}$/i)
  same(
    dependencies.validated[0],
    expected,
    'Launch validated a later global plan instead of the clicked one',
  )
  clicked.marker.text = 'Caller mutation after launch'
  clicked.from = 'OPS/I.xhtml'
  const launched = await api.loadQuietLaunch('book-a', launchId)
  same(
    launched.record,
    expected,
    'Launch snapshot changed with global or caller edits',
  )
  launched.record.marker.text = 'Mutation of a returned snapshot'
  same(
    (await api.loadQuietLaunch('book-a', launchId)).record,
    expected,
    'Read returned a live persisted reference',
  )
  const next = await api.loadLibraryListeningBook('book-a')
  assert.equal(next.record.marker.text, 'Next session paragraph')
  assert.equal(next.record.from, 'OPS/III.xhtml')
})

test('missing, wrong-book, and changed-source launch records are rejected', async () => {
  const { db, api } = harness()
  await seed(db, 'book-a')
  await seed(db, 'book-b') // identical bytes prevent the fingerprint masking book identity
  const first = await api.loadLibraryListeningBook('book-a')
  const id = await api.createQuietLaunch('book-a', first.record)
  await assert.rejects(
    api.loadQuietLaunch('book-a', 'missing-launch'),
    unavailable,
  )
  await assert.rejects(api.loadQuietLaunch('book-b', id), unavailable)
  await assert.rejects(api.createQuietLaunch('book-b', first.record), changed)
  await db.files.put({ id: 'book-a', file: new Blob(['Replacement bytes']) })
  await assert.rejects(api.loadQuietLaunch('book-a', id), changed)
})

test('explicit reset clears only listening metadata, preserving canonical progress, annotations, and files', async () => {
  const { db, api } = harness()
  await seed(db)
  const first = await api.loadLibraryListeningBook('book-a')
  await api.saveLibraryMarker('book-a', marker(), first.record.fingerprint)
  const beforeBook = await db.books.get('book-a')
  const beforeFile = await db.files.get('book-a')
  const bytes = await beforeFile.file.text()
  db.writes.length = 0
  const reset = await api.resetLibraryListeningBook('book-a')
  assert.equal(reset.record.startAt, 'chapter')
  assert.equal(reset.record.marker, undefined)
  assert.equal(reset.record.from, 'OPS/I.xhtml')
  assert.equal(reset.record.through, 'OPS/IV.xhtml')
  same(
    await db.books.get('book-a'),
    beforeBook,
    'Reset changed canonical book progress or annotations',
  )
  const afterFile = await db.files.get('book-a')
  assert.equal(await afterFile.file.text(), bytes)
  assert.equal(afterFile.file.type, beforeFile.file.type)
  same(
    db.writes,
    [{ table: 'listening', operation: 'put', key: 'book-a' }],
    'Reset wrote outside listening metadata',
  )
})

test('deleted books or missing files cannot load listening plans or old launch snapshots', async () => {
  const { db, api } = harness()
  await seed(db)
  const first = await api.loadLibraryListeningBook('book-a')
  const id = await api.createQuietLaunch('book-a', first.record)
  await db.books.delete('book-a') // leave orphan metadata to exercise actual canonical lookup
  await assert.rejects(api.loadLibraryListeningBook('book-a'), /not available/)
  await assert.rejects(api.loadQuietLaunch('book-a', id), /not available/)
  await seed(db)
  await db.files.delete('book-a')
  await assert.rejects(api.loadLibraryListeningBook('book-a'), /not available/)
})

test('deletion during EPUB preparation is detected before a new listening record is committed', async () => {
  const { db, api, dependencies } = harness()
  await seed(db)
  const gate = deferredGate()
  dependencies.prepareGate = gate
  const loading = api.loadLibraryListeningBook('book-a')
  await gate.entered
  await db.books.delete('book-a')
  const rejected = assert.rejects(loading, /removed from your library/)
  gate.release()
  await rejected
  assert.equal(
    await db.listening.get('book-a'),
    undefined,
    'Deleted book gained new listening metadata',
  )
})

test('bookmark save captures the actual preceding transaction and returns detached snapshots', async () => {
  const { db, api } = harness()
  await seed(db)
  const initial = await api.loadLibraryListeningBook('book-a')
  const gate = db.pauseTransaction(2)
  const pending = api.saveLibraryBookmark(
    'book-a',
    marker('III', 'My bookmark'),
    initial.record.fingerprint,
    { from: 'OPS/III.xhtml', through: 'OPS/IV.xhtml' },
  )
  await gate.entered
  const otherTab = await api.saveLibraryMarker(
    'book-a',
    marker('I', 'The preceding bookmark'),
    initial.record.fingerprint,
    { from: 'OPS/I.xhtml', through: 'OPS/II.xhtml' },
  )
  gate.release()
  const change = await pending
  same(
    change.previous,
    otherTab,
    'Previous was read before the write transaction',
  )
  assert.equal(change.record.marker.text, 'My bookmark')
  assert(change.record.updatedAt > change.previous.updatedAt)
  const persisted = await db.listening.get('book-a')
  change.record.marker.text = 'Caller mutation of saved snapshot'
  change.previous.marker.text = 'Caller mutation of preceding snapshot'
  same(await db.listening.get('book-a'), persisted)
  assert.equal(otherTab.marker.text, 'The preceding bookmark')
})

test('bookmark undo restores the preceding plan without changing launch snapshots or canonical data', async () => {
  for (const precedingBookmark of [false, true]) {
    const { db, api } = harness()
    await seed(db)
    const initial = await api.loadLibraryListeningBook('book-a')
    if (precedingBookmark)
      await api.saveLibraryMarker(
        'book-a',
        marker('I', 'Restore this bookmark'),
        initial.record.fingerprint,
        { from: 'OPS/I.xhtml', through: 'OPS/II.xhtml' },
      )
    const change = await api.saveLibraryBookmark(
      'book-a',
      marker('III'),
      initial.record.fingerprint,
      { from: 'OPS/III.xhtml', through: 'OPS/IV.xhtml' },
    )
    const launchId = await api.createQuietLaunch('book-a', change.record)
    const beforeBook = await db.books.get('book-a')
    const beforeFile = await db.files.get('book-a')
    db.writes.length = 0
    const restored = await api.undoLibraryBookmark(
      'book-a',
      change.record,
      change.previous,
    )
    same(restored, { ...change.previous, updatedAt: restored.updatedAt })
    assert(restored.updatedAt > change.record.updatedAt)
    same(await db.listening.get('book-a'), restored)
    same((await api.loadQuietLaunch('book-a', launchId)).record, change.record)
    same(await db.books.get('book-a'), beforeBook)
    assert.equal(
      await (await db.files.get('book-a')).file.text(),
      await beforeFile.file.text(),
    )
    same(db.writes, [{ table: 'listening', operation: 'put', key: 'book-a' }])
    await assert.rejects(
      api.undoLibraryBookmark('book-a', change.record, change.previous),
      /bookmark changed/i,
    )
    same(await db.listening.get('book-a'), restored)
  }
})

test('a newer range or bookmark rejects a delayed undo without overwriting the other window', async () => {
  const { db, api } = harness()
  await seed(db)
  const initial = await api.loadLibraryListeningBook('book-a')
  const change = await api.saveLibraryBookmark(
    'book-a',
    marker(),
    initial.record.fingerprint,
    { from: 'OPS/II.xhtml', through: 'OPS/IV.xhtml' },
  )
  const gate = db.pauseTransaction(1)
  const pending = api.undoLibraryBookmark(
    'book-a',
    change.record,
    change.previous,
  )
  await gate.entered
  const newer = await api.updateListeningRecord(
    'book-a',
    { through: 'OPS/III.xhtml' },
    initial.record.fingerprint,
  )
  const rejected = assert.rejects(pending, /bookmark changed/i)
  gate.release()
  await rejected
  same(await db.listening.get('book-a'), newer)

  // Compare the complete plan as well as the timestamp, including marker text.
  const sameRevision = clone(newer)
  sameRevision.marker.text = 'Changed bookmark with a reused timestamp'
  await db.listening.put(sameRevision)
  await assert.rejects(
    api.undoLibraryBookmark('book-a', newer, change.previous),
    /bookmark changed/i,
  )
  same(await db.listening.get('book-a'), sameRevision)

  await db.listening.delete('book-a')
  const writesBeforeMissingUndo = db.writes.length
  await assert.rejects(
    api.undoLibraryBookmark('book-a', newer, change.previous),
    /bookmark changed/i,
  )
  assert.equal(await db.listening.get('book-a'), undefined)
  assert.equal(db.writes.length, writesBeforeMissingUndo)
})

test('bookmark save and undo reject replaced sources, wrong books, and deleted books', async () => {
  const { db, api } = harness()
  await seed(db)
  await seed(db, 'book-b')
  const initial = await api.loadLibraryListeningBook('book-a')
  const change = await api.saveLibraryBookmark(
    'book-a',
    marker(),
    initial.record.fingerprint,
  )
  await assert.rejects(
    api.undoLibraryBookmark('book-b', change.record, change.previous),
    changed,
  )
  assert.equal(await db.listening.get('book-b'), undefined)
  await db.files.put({ id: 'book-a', file: new Blob(['EPUB revision B']) })
  await assert.rejects(
    api.saveLibraryBookmark(
      'book-a',
      marker('III'),
      initial.record.fingerprint,
    ),
    changed,
  )
  await assert.rejects(
    api.undoLibraryBookmark('book-a', change.record, change.previous),
    changed,
  )
  same(await db.listening.get('book-a'), change.record)
  const reset = await api.resetLibraryListeningBook('book-a')
  await assert.rejects(
    api.undoLibraryBookmark('book-a', change.record, change.previous),
    changed,
  )
  same(await db.listening.get('book-a'), reset.record)
  await db.books.delete('book-a')
  await assert.rejects(
    api.saveLibraryBookmark('book-a', marker(), reset.record.fingerprint),
    /not available/,
  )
  await assert.rejects(
    api.undoLibraryBookmark('book-a', change.record, change.previous),
    /not available/,
  )
  same(await db.listening.get('book-a'), reset.record)
})

test('logical TOC range refs survive default setup, snapshots, bookmark save and Undo', async () => {
  const { db, api, dependencies } = harness()
  const first = 'toc:0:OPS/II.xhtml#chapter-two'
  const last = 'toc:1:OPS/II.xhtml#chapter-three'
  dependencies.book.chapters = [
    { id: 'toc:bad:OPS/II.xhtml#missing', disabled: true },
    { id: first, disabled: false },
    { id: last, disabled: false },
  ]
  await seed(db)
  const canonical = await db.books.get('book-a')
  const initial = await api.loadLibraryListeningBook('book-a')
  assert.equal(initial.record.from, first)
  assert.equal(initial.record.through, last)
  const saved = await api.saveLibraryBookmark(
    'book-a',
    marker('II'),
    initial.record.fingerprint,
    { from: first, through: last },
  )
  assert.equal(saved.record.marker.sourceHref, 'OPS/II.xhtml')
  assert.equal(saved.record.through, last)
  const launch = await api.createQuietLaunch('book-a', saved.record)
  const restored = await api.undoLibraryBookmark(
    'book-a',
    saved.record,
    saved.previous,
  )
  assert.equal(restored.from, first)
  assert.equal(restored.through, last)
  assert.equal(restored.marker, undefined)
  const snapshot = await api.loadQuietLaunch('book-a', launch)
  assert.equal(snapshot.record.through, last)
  assert.equal(snapshot.record.marker.text, 'Saved paragraph')
  assert.equal(dependencies.rangesValidated.at(-1).through, last)
  same(await db.books.get('book-a'), canonical)
})

test('default range covers reading order when the TOC display order differs', async () => {
  const { db, api, dependencies } = harness()
  dependencies.book.chapters = [
    {
      id: 'toc:last',
      disabled: false,
      start: { sectionIndex: 3, offset: 0 },
      end: { sectionIndex: 4, offset: 0 },
    },
    {
      id: 'toc:first',
      disabled: false,
      start: { sectionIndex: 0, offset: 0 },
      end: { sectionIndex: 1, offset: 0 },
    },
    {
      id: 'toc:middle',
      disabled: false,
      start: { sectionIndex: 1, offset: 0 },
      end: { sectionIndex: 3, offset: 0 },
    },
  ]
  await seed(db)
  const initial = await api.loadLibraryListeningBook('book-a')
  assert.equal(initial.record.from, 'toc:first')
  assert.equal(initial.record.through, 'toc:last')
})

test('an unavailable TOC range rejects a save without replacing the previous plan', async () => {
  const { db, api, dependencies } = harness()
  await seed(db)
  const initial = await api.loadLibraryListeningBook('book-a')
  dependencies.rangeProblem = 'The selected EPUB chapter anchor is unavailable.'
  await assert.rejects(
    api.updateListeningRecord(
      'book-a',
      { through: 'toc:broken:OPS/II.xhtml#missing' },
      initial.record.fingerprint,
    ),
    /chapter anchor is unavailable/,
  )
  same(await db.listening.get('book-a'), initial.record)
})

test('setup does not create a default plan when every TOC entry is unavailable', async () => {
  const { db, api, dependencies } = harness()
  dependencies.book.chapters = [{ id: 'toc:missing', disabled: true }]
  await seed(db)
  await assert.rejects(
    api.loadLibraryListeningBook('book-a'),
    /no available chapters/,
  )
  assert.equal(await db.listening.get('book-a'), undefined)
})

async function main() {
  console.log(
    'Node persistence unit tests: real integrated.ts + WebCrypto; structured-clone memory DB.',
  )
  console.log('Not a Dexie migration, IndexedDB, converter, or browser test.')
  let failures = 0
  for (const { name, run } of tests) {
    let timeout
    try {
      await Promise.race([
        run(),
        new Promise((_, reject) => {
          timeout = setTimeout(
            () =>
              reject(
                new Error(
                  'Timed out waiting for the controlled test interleaving',
                ),
              ),
            5000,
          )
        }),
      ])
      console.log('PASS ' + name)
    } catch (error) {
      failures++
      console.error('FAIL ' + name)
      console.error(error)
    } finally {
      clearTimeout(timeout)
    }
  }
  console.log(
    `${tests.length - failures}/${tests.length} persistence unit tests passed.`,
  )
  if (failures) process.exitCode = 1
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
