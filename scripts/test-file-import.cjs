/* Real file.ts import orchestration with controlled EPUB-engine outcomes and a
 * transactional memory database. No user's IndexedDB, browser files or network.
 * Browser checks separately exercise the real EPUB parser / Read / Listen UI.
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

function compile(relative) {
  return ts.transpileModule(
    fs.readFileSync(path.join(__dirname, relative), 'utf8'),
    {
      compilerOptions: {
        target: ts.ScriptTarget.ES2020,
        module: ts.ModuleKind.CommonJS,
        esModuleInterop: true,
      },
    },
  ).outputText
}
const compiled = compile('../apps/reader/src/file.ts')
const presentation = { exports: {} }
vm.runInNewContext(
  compile('../apps/reader/src/library/presentation.ts'),
  presentation,
)
const clone = (value) =>
  value?.file instanceof File
    ? { ...structuredClone({ ...value, file: undefined }), file: value.file }
    : structuredClone(value)

class Table {
  constructor(database, name) {
    this.database = database
    this.name = name
    this.rows = new Map()
  }
  async get(id) {
    return clone(this.rows.get(id))
  }
  async toArray() {
    return [...this.rows.values()].map(clone)
  }
  async add(row) {
    await this.database.writeGate
    if (this.database.fail === this.name)
      throw new Error('Simulated ' + this.name + ' write failure')
    if (this.rows.has(row.id)) throw new Error('Duplicate ' + this.name + ' ID')
    this.rows.set(row.id, clone(row))
  }
}
class Database {
  constructor() {
    for (const name of [
      'books',
      'files',
      'covers',
      'listening',
      'listeningSessions',
    ])
      this[name] = new Table(this, name)
    this.tables = [
      'books',
      'files',
      'covers',
      'listening',
      'listeningSessions',
    ].map((name) => this[name])
    this.tail = Promise.resolve()
  }
  async transaction(mode, ...args) {
    assert.equal(mode, 'rw')
    const operation = args.pop()
    assert.deepEqual(args, [this.books, this.files, this.covers])
    const result = this.tail.then(async () => {
      const snapshot = this.tables.map(
        (table) =>
          new Map([...table.rows].map(([id, row]) => [id, clone(row)])),
      )
      try {
        return await operation()
      } catch (error) {
        this.tables.forEach((table, index) => {
          table.rows = snapshot[index]
        })
        throw error
      }
    })
    this.tail = result.catch(() => {})
    return result
  }
}
function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
const metadata = {
  title: 'Alice',
  creator: 'Lewis Carroll',
  identifier: 'alice-identifier',
}
function load() {
  const database = new Database()
  const control = {
    parses: 0,
    destroys: 0,
    fetches: 0,
    reviewed: [],
    allowReview: true,
    backup: { summary: { books: 1, files: 1, bookmarks: 1 } },
    newBackup: true,
  }
  let nextId = 0
  class ReviewEvent {
    constructor(type, options) {
      this.type = type
      Object.assign(this, options)
      this.defaultPrevented = false
    }
    preventDefault() {
      if (this.cancelable) this.defaultPrevented = true
    }
  }
  const context = {
    exports: {},
    File,
    Blob,
    URL,
    Date,
    CustomEvent: ReviewEvent,
    window: {
      dispatchEvent(event) {
        if (control.allowReview) {
          control.reviewed.push(event.detail)
          event.preventDefault()
        }
        return !event.defaultPrevented
      },
    },
    fetch: async () => {
      control.fetches++
      if (control.fetchError) return { ok: false, status: 404 }
      return { ok: true, blob: async () => new Blob(['valid epub bytes']) }
    },
    require(id) {
      if (id === 'uuid') return { v4: () => `new-${++nextId}` }
      if (id === './db') return { db: database }
      if (id === './library/presentation') return presentation.exports
      if (id === './data-safety')
        return {
          readLibraryBackup: async () =>
            control.newBackup ? control.backup : null,
          readLegacyLibraryBackup: async () =>
            control.legacyBackup ? control.backup : null,
        }
      if (id === '@flow/epubjs')
        return function engine() {
          control.parses++
          const parsed = Promise.resolve().then(async () => {
            control.started?.resolve()
            await control.parseGate
            if (control.invalid) throw new Error('Invalid EPUB')
            return metadata
          })
          const book = {
            opened: parsed.then(() => book),
            ready: parsed.then(() => undefined),
            loaded: { metadata: parsed },
            coverUrl: async () => {
              if (control.coverError) throw new Error('Missing cover')
              return null
            },
            destroy() {
              control.destroys++
            },
          }
          if (control.openedOnlyError) {
            book.opened = Promise.reject(new Error('Invalid container'))
            book.ready = new Promise(() => {})
            book.loaded.metadata = new Promise(() => {})
          }
          return book
        }
      throw new Error('Unexpected dependency ' + id)
    },
  }
  vm.runInNewContext(compiled, context, { filename: 'file.ts' })
  return { api: context.exports, database, control }
}
function seed(database, id = 'alice', name = 'Alice.epub') {
  const book = {
    id,
    name,
    size: 123,
    metadata,
    createdAt: 10,
    cfi: 'epubcfi(saved)',
    percentage: 0.42,
    annotations: [{ text: 'note' }],
    definitions: ['word'],
    configuration: { typography: { fontSize: '24px' } },
  }
  database.books.rows.set(id, clone(book))
  database.listening.rows.set(id, {
    bookId: id,
    from: 'toc:2:chapter3.xhtml',
    through: 'toc:3:chapter4.xhtml',
    marker: { blockId: 'p2', text: 'Saved paragraph' },
    fingerprint: 'original-hash',
  })
  database.listeningSessions.rows.set('launch-' + id, {
    id: 'launch-' + id,
    bookId: id,
    plan: { through: 'toc:3:chapter4.xhtml' },
  })
  return book
}
const epub = (name = 'Alice.epub', type = 'application/epub+zip') =>
  new File(['valid epub bytes'], name, { type })
const snapshot = (database) =>
  JSON.stringify(database.tables.map((table) => [table.name, [...table.rows]]))
let passed = 0
async function test(name, verify) {
  await verify()
  passed++
  console.log('PASS ' + name)
}

;(async () => {
  await test('metadata-only reimport fills its existing ID while preserving progress, notes and listening plans', async () => {
    const { api, database, control } = load()
    const original = seed(database)
    seed(database, 'other', 'Other.epub')
    const before = JSON.stringify([
      await database.books.toArray(),
      await database.listening.toArray(),
      await database.listeningSessions.toArray(),
    ])
    const result = await api.handleFiles([epub()])
    assert.equal(result[0].id, original.id)
    assert.equal(
      await (await database.files.get(original.id)).file.text(),
      'valid epub bytes',
    )
    assert.equal(database.files.rows.has('other'), false)
    assert.equal(
      JSON.stringify([
        await database.books.toArray(),
        await database.listening.toArray(),
        await database.listeningSessions.toArray(),
      ]),
      before,
    )
    assert.equal(control.destroys, 1)
  })
  await test('a full existing duplicate keeps its bytes, cover and all state without parsing replacement bytes', async () => {
    const { api, database, control } = load()
    seed(database)
    database.files.rows.set('alice', {
      id: 'alice',
      file: new File(['original'], 'Alice.epub'),
    })
    database.covers.rows.set('alice', { id: 'alice', cover: 'original-cover' })
    const before = snapshot(database)
    await api.handleFiles([epub()])
    assert.equal(snapshot(database), before)
    assert.equal(
      await (await database.files.get('alice')).file.text(),
      'original',
    )
    assert.equal(control.parses, 0)
  })
  await test('new imports wait for every transactional write before reporting completion', async () => {
    const { api, database } = load()
    const gate = deferred()
    database.writeGate = gate.promise
    let complete = false
    const pending = api.handleFiles([epub()]).then((result) => {
      complete = true
      return result
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.equal(complete, false)
    gate.resolve()
    const result = await pending
    assert.equal(database.books.rows.size, 1)
    assert.equal(database.files.rows.size, 1)
    assert.equal(database.covers.rows.size, 1)
    assert.equal(database.files.rows.has(result[0].id), true)
  })
  await test('invalid EPUB input leaves no new or recovered orphan records', async () => {
    const { api, database, control } = load()
    seed(database)
    const before = snapshot(database)
    control.invalid = true
    await assert.rejects(api.handleFiles([epub()]), /Invalid EPUB/)
    assert.equal(snapshot(database), before)
    await assert.rejects(api.addBook(epub('New.epub')), /Invalid EPUB/)
    assert.equal(snapshot(database), before)
  })
  await test('an opened-container error rejects even if deferred metadata never resolves', async () => {
    const { api, database, control } = load()
    control.openedOnlyError = true
    await assert.rejects(api.addBook(epub()), /Invalid container/)
    assert.equal(database.books.rows.size, 0)
  })
  await test('a later write failure rolls back new book metadata and files together', async () => {
    const { api, database } = load()
    database.fail = 'covers'
    await assert.rejects(api.addBook(epub()), /Simulated covers/)
    assert.equal(database.books.rows.size, 0)
    assert.equal(database.files.rows.size, 0)
  })
  await test('deleting a metadata-only book during parsing cannot recreate an orphan file', async () => {
    const { api, database, control } = load()
    seed(database)
    const gate = deferred()
    control.parseGate = gate.promise
    control.started = deferred()
    const pending = api.addBook(epub())
    await control.started.promise
    database.books.rows.delete('alice')
    gate.resolve()
    await assert.rejects(pending, /removed or replaced/)
    assert.equal(database.files.rows.size, 0)
  })
  await test('a concurrently downloaded file wins without being overwritten by reimport', async () => {
    const { api, database, control } = load()
    seed(database)
    const gate = deferred()
    control.parseGate = gate.promise
    control.started = deferred()
    const pending = api.addBook(epub())
    await control.started.promise
    database.files.rows.set('alice', {
      id: 'alice',
      file: new File(['newer winner'], 'Alice.epub'),
    })
    gate.resolve()
    await pending
    assert.equal(
      await (await database.files.get('alice')).file.text(),
      'newer winner',
    )
  })
  await test('concurrent same-name new imports converge to one book and one file', async () => {
    const { api, database } = load()
    const [first, second] = await Promise.all([
      api.addBook(epub()),
      api.addBook(epub()),
    ])
    assert.equal(first.id, second.id)
    assert.equal(database.books.rows.size, 1)
    assert.equal(database.files.rows.size, 1)
  })
  await test('addFile validates and fills only a still-existing missing copy', async () => {
    const { api, database, control } = load()
    seed(database)
    await api.addFile('alice', epub())
    const before = snapshot(database)
    await api.addFile('alice', new File(['replacement'], 'Alice.epub'))
    assert.equal(snapshot(database), before)
    assert.equal(control.parses, 1)
    await assert.rejects(api.addFile('removed', epub()), /removed/)
  })
  await test('URL recovery fetches a metadata-only book and retains its identity, but complete copies skip network', async () => {
    const { api, database, control } = load()
    const original = seed(database)
    const recovered = await api.fetchBook(
      'https://example.invalid/Alice.epub?download=1',
    )
    assert.equal(recovered.id, original.id)
    assert.equal(control.fetches, 1)
    assert.ok(await database.files.get(original.id))
    await api.fetchBook('https://example.invalid/Alice.epub')
    assert.equal(control.fetches, 1)
  })
  await test('failed downloads preserve metadata-only state and provide an actionable failure', async () => {
    const { api, database, control } = load()
    seed(database)
    control.fetchError = true
    const before = snapshot(database)
    await assert.rejects(
      api.fetchBook('https://example.invalid/Alice.epub'),
      /download failed \(404\)/,
    )
    assert.equal(snapshot(database), before)
  })
  await test('Android generic-MIME EPUBs still use validated EPUB import', async () => {
    const { api, database, control } = load()
    await api.handleFiles([epub('Alice.epub', 'application/zip')])
    assert.equal(control.parses, 1)
    assert.equal(control.reviewed.length, 0)
    assert.equal(database.books.rows.size, 1)
  })
  await test('new and legacy ZIP entry points only request explicit restore review and never write data', async () => {
    const { api, database, control } = load()
    seed(database)
    const before = snapshot(database)
    assert.equal(
      (
        await api.handleFiles([
          new File(['archive'], 'backup.zip', { type: 'application/zip' }),
        ])
      ).length,
      0,
    )
    control.newBackup = false
    control.legacyBackup = true
    await api.handleFiles([new File(['archive'], 'old.zip')])
    assert.equal(control.reviewed.length, 2)
    assert.equal(snapshot(database), before)
  })
  await test('ZIPs without a review listener or recognized backup format cannot silently restore', async () => {
    const { api, database, control } = load()
    seed(database)
    const before = snapshot(database)
    control.allowReview = false
    await assert.rejects(
      api.handleFiles([new File(['archive'], 'backup.zip')]),
      /review its contents first/,
    )
    control.newBackup = false
    await assert.rejects(
      api.handleFiles([new File(['archive'], 'backup.zip')]),
      /not a supported/,
    )
    assert.equal(snapshot(database), before)
  })
  console.log(`${passed}/${passed} file-import orchestration groups passed.`)
})().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
