/* Isolated tests of the real data-safety.ts module. Uses real ZIP and File data,
 * a transactional memory store, and a fake CacheStorage. Never opens or clears
 * the user's IndexedDB / browser storage. Not a real Dexie migration test.
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const JSZip = require('../apps/reader/node_modules/jszip')

const compiled = ts.transpileModule(
  fs.readFileSync(
    path.join(__dirname, '../apps/reader/src/data-safety.ts'),
    'utf8',
  ),
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
    },
  },
).outputText

const clone = (value) => {
  if (value?.file instanceof File)
    return {
      ...structuredClone({ ...value, file: undefined }),
      file: value.file,
    }
  return structuredClone(value)
}

class Table {
  constructor(database, name, key) {
    this.database = database
    this.name = name
    this.key = key
    this.rows = new Map()
  }
  async toArray() {
    return [...this.rows.values()].map(clone)
  }
  async get(key) {
    return clone(this.rows.get(key))
  }
  async bulkPut(rows) {
    if (this.database.fail === `${this.name}:put`)
      throw new Error('simulated write failure')
    for (const row of rows) this.rows.set(row[this.key], clone(row))
  }
  async clear() {
    if (this.database.fail === `${this.name}:clear`)
      throw new Error('simulated clear failure')
    this.rows.clear()
  }
}

class Database {
  constructor() {
    this.name = 're-reader'
    this.verno = 7
    this.books = new Table(this, 'books', 'id')
    this.files = new Table(this, 'files', 'id')
    this.covers = new Table(this, 'covers', 'id')
    this.listening = new Table(this, 'listening', 'bookId')
    this.listeningSessions = new Table(this, 'listeningSessions', 'id')
    this.tables = [
      this.books,
      this.files,
      this.covers,
      this.listening,
      this.listeningSessions,
    ]
    this.transactions = []
  }
  async transaction(mode, ...args) {
    const operation = args.pop()
    assert.deepEqual(args, this.tables)
    this.transactions.push(mode)
    const snapshot = this.tables.map(
      (table) =>
        new Map([...table.rows].map(([key, value]) => [key, clone(value)])),
    )
    try {
      return await operation()
    } catch (error) {
      this.tables.forEach((table, index) => {
        table.rows = snapshot[index]
      })
      throw error
    }
  }
  reset() {
    this.tables.forEach((table) => table.rows.clear())
  }
}

function load(database = new Database()) {
  const exports = {}
  const downloads = []
  const forbidden = () => {
    throw new Error('persistent browser storage must not be touched')
  }
  vm.runInNewContext(compiled, {
    exports,
    require(id) {
      if (id === './db') return { db: database }
      if (id === 'jszip') return JSZip
      if (id === 'file-saver')
        return { saveAs: (...args) => downloads.push(args) }
      throw new Error('Unexpected dependency ' + id)
    },
    File,
    Blob,
    URL,
    Date,
    Set,
    Map,
    localStorage: {
      clear: forbidden,
      removeItem: forbidden,
      setItem: forbidden,
    },
    indexedDB: { deleteDatabase: forbidden },
  })
  return { database, api: exports, downloads }
}

function book(id) {
  return {
    id,
    name: 'same-name.epub',
    size: 4,
    metadata: { title: `Book ${id}` },
    createdAt: 10,
    cfi: `cfi-${id}`,
    percentage: 0.4,
    definitions: ['definition'],
    annotations: [{ cfi: 'note-place', type: 'highlight', text: 'saved note' }],
    configuration: { typography: { fontSize: '22px', lineHeight: 1.7 } },
  }
}
function plan(id) {
  return {
    bookId: id,
    fingerprint: 'a'.repeat(64),
    from: 'toc:1:chapter.xhtml#one',
    through: 'toc:2:chapter.xhtml#two',
    startAt: 'marker',
    marker: {
      sourceHref: 'chapter.xhtml',
      blockId: 'paragraph-2',
      text: `saved ${id}`,
      savedAt: 20,
    },
    returnCfi: `return-${id}`,
    updatedAt: 21,
  }
}
async function seed(database) {
  await database.books.bulkPut([book('a'), book('b')])
  await database.files.bulkPut(
    ['a', 'b'].map((id) => ({
      id,
      file: new File([`EPUB ${id}`], 'same-name.epub', {
        type: 'application/epub+zip',
        lastModified: 1234,
      }),
    })),
  )
  await database.covers.bulkPut(
    ['a', 'b'].map((id) => ({ id, cover: 'data:image/png;base64,ZmFrZQ==' })),
  )
  await database.listening.bulkPut([plan('a'), plan('b')])
  await database.listeningSessions.bulkPut(
    ['a', 'b'].map((id) => ({
      id: `launch-${id}`,
      bookId: id,
      fingerprint: 'a'.repeat(64),
      plan: plan(id),
      createdAt: 25,
    })),
  )
}
async function snapshot(database) {
  return Promise.all(database.tables.map((table) => table.toArray()))
}

const groups = []
function test(name, fn) {
  groups.push([name, fn])
}

test('cache cleanup removes only recognized same-origin app assets, preserving EPUBs, API entries, foreign and unknown caches', async () => {
  const { api, database } = load()
  await seed(database)
  const before = await snapshot(database)
  const origin = 'https://flow.example'
  const caches = new Map([
    [
      `workbox-precache-v2-${origin}/`,
      [
        origin + '/_next/static/app.js',
        origin + '/icons/192.png',
        origin + '/manifest.json',
        origin + '/samples/alice.epub',
      ],
    ],
    [
      'static-image-assets',
      [origin + '/icons/512.png', 'https://other.example/icons/192.png'],
    ],
    ['other-app-cache', [origin + '/_next/static/keep.js']],
    ['apis', [origin + '/api/refresh']],
    [
      'workbox-precache-v2-https://other.example/',
      [origin + '/_next/static/keep-too.js'],
    ],
  ])
  const storage = {
    async keys() {
      return [...caches.keys()]
    },
    async open(name) {
      return {
        async keys() {
          return caches.get(name).map((url) => ({ url }))
        },
        async delete(request) {
          caches.set(
            name,
            caches.get(name).filter((url) => url !== request.url),
          )
          return true
        },
      }
    },
    async delete() {
      assert.fail('whole cache deletion is not allowed')
    },
  }
  assert.equal(await api.clearTemporaryFlowCache(storage, origin), 4)
  assert.deepEqual(caches.get(`workbox-precache-v2-${origin}/`), [
    origin + '/samples/alice.epub',
  ])
  assert.deepEqual(caches.get('static-image-assets'), [
    'https://other.example/icons/192.png',
  ])
  assert.equal(caches.get('other-app-cache').length, 1)
  assert.equal(caches.get('apis').length, 1)
  assert.equal(
    caches.get('workbox-precache-v2-https://other.example/').length,
    1,
  )
  assert.deepEqual(await snapshot(database), before)
})

test('unsupported CacheStorage is a safe no-op', async () => {
  assert.equal(
    await load().api.clearTemporaryFlowCache(undefined, 'https://flow.example'),
    0,
  )
})

test('deletion rejects missing, whitespace and lowercase confirmations without touching any records', async () => {
  const { database, api } = load()
  await seed(database)
  const before = await snapshot(database)
  for (const confirmation of ['', 'delete', ' DELETE ', undefined])
    await assert.rejects(
      api.deleteLocalFlowLibrary(confirmation),
      /Type DELETE/,
    )
  assert.deepEqual(await snapshot(database), before)
  assert.equal(database.transactions.length, 0)
})

test('explicit deletion atomically clears only Flow library tables', async () => {
  const { database, api } = load()
  await seed(database)
  await api.deleteLocalFlowLibrary('DELETE')
  assert.deepEqual(
    (await snapshot(database)).map((rows) => rows.length),
    [0, 0, 0, 0, 0],
  )
  assert.deepEqual(database.transactions, ['rw'])
})

test('deletion failure rolls back earlier clears', async () => {
  const { database, api } = load()
  await seed(database)
  const before = await snapshot(database)
  database.fail = 'files:clear'
  await assert.rejects(
    api.deleteLocalFlowLibrary('DELETE'),
    /simulated clear failure/,
  )
  assert.deepEqual(await snapshot(database), before)
})

test('backup inspection is read-only and the full ZIP restores progress, notes, typography, saved ranges and launch snapshots', async () => {
  const { database, api } = load()
  await seed(database)
  const before = await snapshot(database)
  const archive = await api.createLibraryBackup()
  const backup = await api.readLibraryBackup(archive)
  assert.deepEqual({ ...backup.summary }, { books: 2, files: 2, bookmarks: 2 })
  assert.deepEqual(await snapshot(database), before)
  database.reset()
  assert.deepEqual(
    { ...(await api.restoreLibraryBackup(backup)) },
    { restored: 2, skipped: 0 },
  )
  assert.deepEqual(await snapshot(database), before)
  assert.equal(await (await database.files.get('a')).file.text(), 'EPUB a')
  assert.equal(await (await database.files.get('b')).file.text(), 'EPUB b')
  assert.equal((await database.files.get('a')).file.name, 'same-name.epub')
})

test('restore preserves existing newer books and Bookmarks while adding missing books', async () => {
  const { database, api } = load()
  await seed(database)
  const backup = await api.readLibraryBackup(await api.createLibraryBackup())
  database.reset()
  const newerBook = { ...book('a'), percentage: 0.9, cfi: 'newer-reader-place' }
  const newerPlan = {
    ...plan('a'),
    startAt: 'chapter',
    marker: { ...plan('a').marker, text: 'newer bookmark' },
    updatedAt: 999,
  }
  await database.books.bulkPut([newerBook])
  await database.listening.bulkPut([newerPlan])
  assert.deepEqual(
    { ...(await api.restoreLibraryBackup(backup)) },
    { restored: 1, skipped: 1 },
  )
  assert.deepEqual(await database.books.get('a'), newerBook)
  assert.deepEqual(await database.listening.get('a'), newerPlan)
  assert.equal(await database.files.get('a'), undefined)
  assert.equal(await (await database.files.get('b')).file.text(), 'EPUB b')
})

test('restore never replaces a launch ID belonging to another existing book', async () => {
  const { database, api } = load()
  await seed(database)
  const backup = await api.readLibraryBackup(await api.createLibraryBackup())
  database.reset()
  const unrelated = {
    id: 'launch-a',
    bookId: 'other',
    fingerprint: 'b'.repeat(64),
    plan: plan('other'),
    createdAt: 1,
  }
  await database.books.bulkPut([book('other')])
  await database.listeningSessions.bulkPut([unrelated])
  await api.restoreLibraryBackup(backup)
  assert.deepEqual(await database.listeningSessions.get('launch-a'), unrelated)
})

test('ZIPs without the new manifest are identified as legacy without any writes', async () => {
  const { database, api } = load()
  const zip = new JSZip().file(
    'data.json',
    JSON.stringify({ version: 1, books: [] }),
  )
  assert.equal(
    await api.readLibraryBackup(await zip.generateAsync({ type: 'blob' })),
    null,
  )
  assert.equal(database.transactions.length, 0)
})

test('original Flow ZIPs convert into a read-only preview and merge without replacing newer saved starts', async () => {
  const { database, api } = load()
  const books = ['a', 'b'].map((id) => ({ ...book(id), name: `${id}.epub` }))
  const zip = new JSZip()
    .file('data.json', JSON.stringify({ version: 1, dbVersion: 7, books }))
    .file(
      'covers.json',
      JSON.stringify([
        { id: 'b', cover: null },
        { id: 'orphan', cover: null },
      ]),
    )
    .file('files/a.epub', 'Legacy EPUB a')
    .file('files/b.epub', 'Legacy EPUB b')
  await database.books.bulkPut([{ ...books[0], cfi: 'newer-place' }])
  await database.listening.bulkPut([{ ...plan('a'), updatedAt: 999 }])
  const before = await snapshot(database)
  const prepared = await api.readLegacyLibraryBackup(
    await zip.generateAsync({ type: 'blob' }),
  )
  assert.deepEqual(
    { ...prepared.summary },
    { books: 2, files: 2, bookmarks: 0 },
  )
  assert.deepEqual(await snapshot(database), before)
  assert.deepEqual(
    { ...(await api.restoreLibraryBackup(prepared)) },
    { restored: 1, skipped: 1 },
  )
  assert.equal((await database.books.get('a')).cfi, 'newer-place')
  assert.equal((await database.listening.get('a')).updatedAt, 999)
  assert.deepEqual(await database.books.get('b'), books[1])
  assert.equal(
    await (await database.files.get('b')).file.text(),
    'Legacy EPUB b',
  )
  assert.equal(await database.listening.get('b'), undefined)
})

test('ambiguous legacy filenames and malformed legacy metadata are rejected before writes', async () => {
  const { database, api } = load()
  const zip = new JSZip()
    .file(
      'data.json',
      JSON.stringify({
        version: 1,
        dbVersion: 7,
        books: [book('a'), book('b')],
      }),
    )
    .file('covers.json', '[]')
    .file('files/same-name.epub', 'ambiguous bytes')
  await assert.rejects(
    api.readLegacyLibraryBackup(await zip.generateAsync({ type: 'blob' })),
    /cannot be safely distinguished/,
  )
  zip.file('data.json', '{bad json')
  await assert.rejects(
    api.readLegacyLibraryBackup(await zip.generateAsync({ type: 'blob' })),
    /unreadable library data/,
  )
  assert.equal(database.transactions.length, 0)
  assert.equal(
    await api.readLegacyLibraryBackup(
      await new JSZip()
        .file('other.txt', 'not Flow')
        .generateAsync({ type: 'blob' }),
    ),
    null,
  )
})

test('malformed, unsupported and incomplete own-format backups fail before any writes', async () => {
  const { database, api } = load()
  await seed(database)
  const archive = await api.createLibraryBackup()
  const before = await snapshot(database)
  const change = async (mutate) => {
    const zip = await JSZip.loadAsync(await archive.arrayBuffer())
    const manifest = JSON.parse(
      await zip.file(api.BACKUP_MANIFEST).async('text'),
    )
    mutate(manifest, zip)
    zip.file(api.BACKUP_MANIFEST, JSON.stringify(manifest))
    return api.readLibraryBackup(await zip.generateAsync({ type: 'blob' }))
  }
  for (const mutate of [
    (manifest) => {
      manifest.version = 200
    },
    (manifest) => {
      manifest.databaseVersion = 200
    },
    (manifest) => {
      manifest.books.push(manifest.books[0])
    },
    (manifest) => {
      manifest.files[0].path = '../outside.epub'
    },
    (manifest) => {
      manifest.covers[0].cover = 'https://tracking.example/image.png'
    },
    (manifest) => {
      manifest.listening[0].fingerprint = 'bad'
    },
    (manifest) => {
      manifest.listening[0].marker.text = null
    },
    (manifest, zip) => {
      zip.remove(manifest.files[0].path)
    },
  ])
    await assert.rejects(change(mutate), /backup|EPUB/i)
  await assert.rejects(
    api.readLibraryBackup(new Blob(['not a zip'])),
    /ZIP could not be opened/,
  )
  assert.deepEqual(await snapshot(database), before)
})

test('failed restore rolls back every partially written table', async () => {
  const { database, api } = load()
  await seed(database)
  const backup = await api.readLibraryBackup(await api.createLibraryBackup())
  database.reset()
  await database.books.bulkPut([book('kept')])
  const before = await snapshot(database)
  database.fail = 'listening:put'
  await assert.rejects(
    api.restoreLibraryBackup(backup),
    /simulated write failure/,
  )
  assert.deepEqual(await snapshot(database), before)
})

test('restore rejects changed prepared file payloads before a transaction starts', async () => {
  const { database, api } = load()
  await seed(database)
  const backup = await api.readLibraryBackup(await api.createLibraryBackup())
  const before = await snapshot(database)
  const transactions = database.transactions.length
  const prepared = (files) => ({ ...backup, files })
  await assert.rejects(api.restoreLibraryBackup(prepared([])), /missing EPUB/)
  await assert.rejects(
    api.restoreLibraryBackup(prepared([backup.files[0], backup.files[0]])),
    /has changed/,
  )
  await assert.rejects(
    api.restoreLibraryBackup(
      prepared([
        { ...backup.files[0], file: new File(['changed'], 'different.epub') },
        backup.files[1],
      ]),
    ),
    /has changed/,
  )
  assert.equal(database.transactions.length, transactions)
  assert.deepEqual(await snapshot(database), before)
})

test('cover backup accepts original inline SVG and generic binary image data without permitting remote images', async () => {
  const { database, api } = load()
  await seed(database)
  await database.covers.bulkPut([
    {
      id: 'a',
      cover: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>',
    },
    { id: 'b', cover: 'data:application/octet-stream;base64,aW1hZ2U=' },
  ])
  const backup = await api.readLibraryBackup(await api.createLibraryBackup())
  assert.equal(backup.manifest.covers.length, 2)
})

test('metadata-only synced books remain exportable without inventing an EPUB file', async () => {
  const { database, api } = load()
  await database.books.bulkPut([book('remote-only')])
  const backup = await api.readLibraryBackup(await api.createLibraryBackup())
  assert.deepEqual({ ...backup.summary }, { books: 1, files: 0, bookmarks: 0 })
  database.reset()
  await api.restoreLibraryBackup(backup)
  assert.deepEqual(await database.books.get('remote-only'), book('remote-only'))
  assert.equal(await database.files.get('remote-only'), undefined)
})

test('backup export prepares an identified ZIP download and never includes sign-in or global preferences', async () => {
  const { database, api, downloads } = load()
  await seed(database)
  await api.exportLibraryBackup()
  assert.equal(downloads.length, 1)
  assert.match(
    downloads[0][1],
    /^flow-listening-backup-\d{4}-\d{2}-\d{2}\.zip$/,
  )
  const zip = await JSZip.loadAsync(await downloads[0][0].arrayBuffer())
  assert.deepEqual(
    Object.keys(
      JSON.parse(await zip.file(api.BACKUP_MANIFEST).async('text')),
    ).sort(),
    [
      'books',
      'covers',
      'createdAt',
      'databaseVersion',
      'files',
      'format',
      'listening',
      'listeningSessions',
      'version',
    ].sort(),
  )
})

test('library mutations refuse a different database name', async () => {
  const { database, api } = load()
  await seed(database)
  const before = await snapshot(database)
  database.name = 'another-application'
  await assert.rejects(api.deleteLocalFlowLibrary('DELETE'), /Open Flow/)
  await assert.rejects(api.createLibraryBackup(), /Open Flow/)
  assert.deepEqual(await snapshot(database), before)
})
;(async () => {
  console.log(
    'Data-safety unit tests: real ZIP / File data, isolated transactional memory DB and CacheStorage; no user storage is touched.',
  )
  for (const [name, fn] of groups) {
    await fn()
    console.log('PASS ' + name)
  }
  console.log(`${groups.length}/${groups.length} data-safety groups passed.`)
})().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
