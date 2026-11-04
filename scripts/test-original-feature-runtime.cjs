/* Actual BookTab and embedded-reader runtime with a controlled EPUB rendition
 * and deferred local database. Browser checks still verify the real engine/UI.
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { createRequire } = require('node:module')
const ts = require('typescript')
const readerRequire = createRequire(
  path.resolve(__dirname, '../apps/reader/package.json'),
)
const valtio = readerRequire('valtio')

function compile(relative) {
  return ts.transpileModule(
    fs.readFileSync(path.resolve(__dirname, relative), 'utf8'),
    {
      compilerOptions: {
        target: ts.ScriptTarget.ES2020,
        module: ts.ModuleKind.CommonJS,
        experimentalDecorators: true,
        esModuleInterop: true,
        jsx: ts.JsxEmit.ReactJSX,
      },
    },
  ).outputText
}
const modelCode = compile('../apps/reader/src/models/reader.ts')
const runtimeCode = compile(
  '../apps/reader/src/listening/toolbar/original-feature-runtime.ts',
)
const syncCode = compile('../apps/reader/src/hooks/remote/useSync.ts')
const searchCode = compile(
  '../apps/reader/src/components/viewlets/SearchView.tsx',
)
const copy = (value) => JSON.parse(JSON.stringify(value))
const tick = () => new Promise((resolve) => setImmediate(resolve))
function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
function book(id = 'alice') {
  return {
    id,
    name: `${id}.epub`,
    size: 123,
    metadata: { title: id },
    createdAt: 1,
    cfi: 'saved-cfi',
    percentage: 0.42,
    definitions: [],
    annotations: [],
  }
}
function location(cfi) {
  const point = {
    cfi,
    href: 'chapter.xhtml',
    index: 0,
    displayed: { page: 1, total: 4 },
  }
  return { start: point, end: { ...point }, atStart: false, atEnd: false }
}
function load() {
  let nextId = 0
  const rows = new Map([['alice', book()]])
  const control = {
    updates: [],
    writeGates: [],
    displays: [],
    previous: 0,
    next: 0,
    resizes: 0,
    destroys: 0,
    parses: 0,
    renderTasks: [],
  }
  const frame = (callback) => setImmediate(() => callback(Date.now()))
  const callbacks = new Map()
  const emit = (name, ...args) => {
    for (const callback of callbacks.get(name) ?? []) callback(...args)
  }
  const queueLocation = (cfi) => {
    control.renderTasks.push(
      () =>
        new Promise((resolve) => {
          frame(() => {
            emit('relocated', location(cfi))
            resolve()
          })
        }),
    )
  }
  const rendition = {
    manager: { container: { scrollLeft: 0 }, views: { _views: [] } },
    q: {
      async run() {
        while (control.renderTasks.length) await control.renderTasks.shift()()
      },
    },
    display(target) {
      control.displays.push(target)
      queueLocation(target === 'saved-cfi' ? 'initial-page-cfi' : target)
      return Promise.resolve()
    },
    prev() {
      control.previous++
      queueLocation('previous-cfi')
      return Promise.resolve()
    },
    next() {
      control.next++
      queueLocation('next-cfi')
      return Promise.resolve()
    },
    resize() {
      control.resizes++
      if (control.resizeError) throw new Error('Resize failed')
      queueLocation('reflow-cfi')
    },
    themes: { default() {} },
    hooks: { render: { register() {} } },
    on(name, callback) {
      const listeners = callbacks.get(name) ?? []
      listeners.push(callback)
      callbacks.set(name, listeners)
    },
    destroy() {},
  }
  const section = {
    href: 'chapter.xhtml',
    document: {
      body: { textContent: 'A chapter' },
      querySelectorAll: () => [],
    },
    load: async () => {
      await control.sectionGate
    },
    find: () => [],
  }
  const epub = {
    loaded: {
      navigation: Promise.resolve({ toc: [], tocById: {} }),
      spine: Promise.resolve({ spineItems: [section] }),
    },
    load() {},
    renderTo: () => rendition,
    destroy() {
      control.destroys++
    },
  }
  const database = {
    books: {
      async update(id, changes) {
        const gate = control.writeGates.shift()
        control.updates.push(copy(changes))
        await gate
        if (control.writeError) throw new Error('Storage failed')
        rows.set(id, { ...rows.get(id), ...copy(changes) })
        return 1
      },
    },
    files: {
      async get() {
        await control.fileGate
        return { file: { name: 'alice.epub' } }
      },
    },
  }
  const shared = {
    Error,
    structuredClone,
    requestAnimationFrame: frame,
    requestIdleCallback: (callback) => setImmediate(callback),
    console: { log() {}, error: console.error },
  }
  const model = { exports: {} }
  vm.runInNewContext(modelCode, {
    ...shared,
    exports: model.exports,
    require(name) {
      if (name === '@github/mini-throttle/decorators')
        return { debounce: () => () => {} }
      if (name === '@literal-ui/hooks') return { IS_SERVER: true }
      if (name === 'react') return {}
      if (name === 'uuid') return { v4: () => `group-${++nextId}` }
      if (name === 'valtio') return { ...valtio, subscribe: () => () => {} }
      if (name === '../db') return { db: database }
      if (name === '../file')
        return {
          fileToEpub: async () => {
            control.parses++
            if (control.parseError) throw new Error('EPUB failed')
            return control.epubFactory ? control.epubFactory() : epub
          },
        }
      if (name === '../styles') return { defaultStyle: {} }
      if (name === './tree') return { dfs() {}, find() {} }
      throw new Error('Unexpected model dependency ' + name)
    },
  })
  const runtime = { exports: {} }
  vm.runInNewContext(runtimeCode, {
    ...shared,
    exports: runtime.exports,
    require(name) {
      if (name === 'valtio') return valtio
      if (name === '../../models') return model.exports
      throw new Error('Unexpected runtime dependency ' + name)
    },
  })
  return {
    ...model.exports,
    ...runtime.exports,
    control,
    database,
    rows,
    rendition,
    emit,
  }
}

function independentEngine() {
  const callbacks = new Map()
  const tasks = []
  const section = {
    href: 'chapter.xhtml',
    document: {
      body: { textContent: 'A source chapter' },
      querySelectorAll: () => [],
    },
    load: async () => {},
    find: () => [],
  }
  const emit = (name, ...args) => {
    for (const callback of callbacks.get(name) ?? []) callback(...args)
  }
  const rendition = {
    manager: { container: { scrollLeft: 0 }, views: { _views: [] } },
    q: {
      async run() {
        while (tasks.length) await tasks.shift()()
      },
    },
    display(target) {
      tasks.push(async () => emit('relocated', location(target)))
      return Promise.resolve()
    },
    themes: { default() {} },
    hooks: { render: { register() {} } },
    on(name, callback) {
      const listeners = callbacks.get(name) ?? []
      listeners.push(callback)
      callbacks.set(name, listeners)
    },
    resize() {},
    destroy() {},
    prev: async () => {},
    next: async () => {},
  }
  const epub = {
    loaded: {
      navigation: Promise.resolve({ toc: [], tocById: {} }),
      spine: Promise.resolve({ spineItems: [section] }),
    },
    load() {},
    renderTo: () => rendition,
    destroy() {},
  }
  return { epub, rendition, emit }
}

function searchHarness(initialKeyword) {
  const values = []
  const dependencies = []
  let cursor = 0
  let effects = []
  let globalKeyword = initialKeyword
  const tab = {
    setKeyword(value) {
      globalKeyword = value
    },
  }
  const search = { exports: {} }
  vm.runInNewContext(searchCode, {
    exports: search.exports,
    require(name) {
      if (name === 'react')
        return {
          useState(initial) {
            const slot = cursor++
            if (!(slot in values)) values[slot] = initial
            return [values[slot], (value) => (values[slot] = value)]
          },
          useEffect(effect, deps) {
            const slot = cursor++
            if (
              !dependencies[slot] ||
              deps.some((value, index) => value !== dependencies[slot][index])
            )
              effects.push(effect)
            dependencies[slot] = deps
          },
          useMemo: (compute) => compute(),
        }
      if (name === 'react/jsx-runtime')
        return { jsx: () => ({}), jsxs: () => ({}) }
      if (name === '@flow/reader/hooks')
        return {
          useAction: () => ['search'],
          useTranslation: () => (value) => value,
        }
      if (name === '@flow/reader/models')
        return {
          reader: { focusedBookTab: tab },
          useReaderSnapshot: () => ({
            focusedBookTab: { keyword: globalKeyword },
          }),
        }
      if (name === '../../platform') return { scale: (value) => value }
      return {}
    },
  })
  return {
    render() {
      cursor = 0
      effects = []
      search.exports.SearchView({})
      effects.forEach((effect) => effect())
      return effects.length
    },
    local: () => values[0],
    global: () => globalKeyword,
    fromReader(value) {
      globalKeyword = value
    },
    type(value) {
      values[0] = value
    },
  }
}
let passed = 0
async function test(name, verify) {
  await verify()
  passed++
  console.log('PASS ' + name)
}
async function start(h) {
  const runtime = h.createOriginalFeatureRuntime(book())
  runtime.setActive(true)
  runtime.tab.render({})
  await runtime.settled()
  return runtime
}

;(async () => {
  await test('unrendered tools settle without waiting and restore the prior groups/focus', async () => {
    const h = load()
    h.reader.addGroup([book('other')])
    const previous = h.reader.groups
    const focus = h.reader.focusedIndex
    const runtime = h.createOriginalFeatureRuntime(book())
    assert.ok(runtime.tab instanceof h.BookTab)
    assert.equal(h.reader.focusedBookTab, runtime.tab)
    assert.notEqual(h.reader.groups, previous)
    await runtime.settled()
    assert.equal(h.control.parses, 0)
    runtime.destroy()
    assert.equal(h.reader.groups, previous)
    assert.equal(h.reader.focusedIndex, focus)
    assert.equal(h.control.updates.length, 0)
  })
  await test('initial real rendition relocation never replaces canonical CFI/percentage', async () => {
    const h = load()
    const runtime = await start(h)
    assert.equal(runtime.tab.location.start.cfi, 'initial-page-cfi')
    assert.equal(runtime.tab.book.cfi, 'saved-cfi')
    assert.equal(runtime.tab.book.percentage, 0.42)
    assert.equal(h.control.updates.length, 0)
    runtime.destroy()
    assert.equal(h.control.destroys, 1)
  })
  await test('visible original display, previous and next save their actual destinations', async () => {
    const h = load()
    const runtime = await start(h)
    runtime.tab.display('search-match-cfi')
    await runtime.settled()
    assert.equal(h.rows.get('alice').cfi, 'search-match-cfi')
    runtime.tab.prev()
    await runtime.settled()
    assert.equal(h.rows.get('alice').cfi, 'previous-cfi')
    runtime.tab.next()
    await runtime.settled()
    assert.equal(h.rows.get('alice').cfi, 'next-cfi')
    assert.equal(h.control.updates.length, 3)
    runtime.destroy()
  })
  await test('visible native EPUB gestures authorize direct rendition navigation', async () => {
    const h = load()
    const runtime = await start(h)
    runtime.tab.noteReaderNavigation()
    h.rendition.display('native-link-cfi')
    await runtime.settled()
    assert.equal(h.rows.get('alice').cfi, 'native-link-cfi')
    runtime.destroy()
  })
  await test('tool navigation callback fires for visible original navigation only, never startup or selection gestures', async () => {
    const h = load()
    let navigations = 0
    const runtime = h.createOriginalFeatureRuntime(book(), () => navigations++)
    runtime.setActive(true)
    runtime.tab.render({})
    await runtime.settled()
    assert.equal(navigations, 0)
    runtime.tab.noteReaderNavigation()
    assert.equal(navigations, 0)
    const actions = [
      () => runtime.tab.display('tool-target-cfi'),
      () => runtime.tab.prev(),
      () => runtime.tab.next(),
      () =>
        runtime.tab.displayFromSelector('img', {
          document: { querySelector: () => ({}) },
          cfiFromElement: () => 'image-target-cfi',
        }),
    ]
    for (const action of actions) {
      action()
      await runtime.settled()
      await tick()
      await tick()
    }
    assert.equal(navigations, 4)
    runtime.setActive(false)
    runtime.tab.display('hidden-cfi')
    runtime.tab.prev()
    runtime.tab.next()
    runtime.tab.noteReaderNavigation()
    await runtime.settled()
    assert.equal(navigations, 4)
    runtime.destroy()
  })
  await test('tool panel collapse waits for actual target relocation and its final deferred persistence', async () => {
    const h = load()
    const gate = deferred()
    const destinations = []
    const runtime = h.createOriginalFeatureRuntime(book(), () =>
      destinations.push(h.rows.get('alice').cfi),
    )
    runtime.setActive(true)
    runtime.tab.render({})
    await runtime.settled()
    h.control.writeGates.push(gate.promise)
    runtime.tab.display('image-target-cfi')
    assert.deepEqual(destinations, [])
    while (!h.control.updates.length) await tick()
    assert.deepEqual(destinations, [])
    gate.resolve()
    await runtime.settled()
    for (let count = 0; count < 5 && !destinations.length; count++) await tick()
    assert.deepEqual(destinations, ['image-target-cfi'])
    runtime.destroy()
  })
  await test('only the latest accepted navigation collapses its panel and it retains its original action context', async () => {
    const h = load()
    const gate = deferred()
    const completions = []
    let context = 'image'
    const runtime = h.createOriginalFeatureRuntime(
      book(),
      (origin) => completions.push([origin, h.rows.get('alice').cfi]),
      undefined,
      undefined,
      () => context,
    )
    runtime.setActive(true)
    runtime.tab.render({})
    await runtime.settled()
    h.control.writeGates.push(gate.promise, gate.promise)
    runtime.tab.display('first-target-cfi')
    context = 'toc'
    runtime.tab.display('latest-target-cfi')
    context = 'search'
    while (h.control.updates.length < 2) await tick()
    assert.deepEqual(completions, [])
    gate.resolve()
    await runtime.settled()
    for (let count = 0; count < 5 && !completions.length; count++) await tick()
    assert.deepEqual(completions, [['toc', 'latest-target-cfi']])
    runtime.destroy()
  })
  await test('navigation completion from a closed or disposed source cannot collapse a newly opened tool', async () => {
    const h = load()
    let navigations = 0
    const runtime = h.createOriginalFeatureRuntime(book(), () => navigations++)
    runtime.setActive(true)
    runtime.tab.render({})
    await runtime.settled()
    runtime.tab.display('closed-target-cfi')
    runtime.setActive(false)
    runtime.setActive(true)
    await runtime.settled()
    await tick()
    await tick()
    assert.equal(navigations, 0)
    runtime.tab.display('disposed-target-cfi')
    runtime.destroy()
    await runtime.settled()
    await tick()
    await tick()
    assert.equal(navigations, 0)
  })
  await test('hidden gestures/navigation and hidden/reopened reflows cannot overwrite saved progress', async () => {
    const h = load()
    const runtime = await start(h)
    runtime.tab.display('accepted-cfi')
    await runtime.settled()
    runtime.setActive(false)
    const count = h.control.displays.length
    runtime.tab.noteReaderNavigation()
    runtime.tab.display('hidden-cfi')
    runtime.tab.prev()
    runtime.tab.next()
    h.rendition.resize()
    await runtime.settled()
    assert.equal(h.control.displays.length, count)
    assert.equal(h.control.previous, 0)
    assert.equal(h.control.next, 0)
    assert.equal(h.rows.get('alice').cfi, 'accepted-cfi')
    runtime.setActive(true)
    await runtime.settled()
    assert.equal(h.rows.get('alice').cfi, 'accepted-cfi')
    runtime.tab.display('reopened-navigation-cfi')
    await runtime.settled()
    assert.equal(h.rows.get('alice').cfi, 'reopened-navigation-cfi')
    runtime.destroy()
  })
  await test('initial location is suppressed even when sections load after its callback', async () => {
    const h = load()
    const gate = deferred()
    h.control.sectionGate = gate.promise
    const runtime = h.createOriginalFeatureRuntime(book())
    runtime.setActive(true)
    await runtime.tab.render({})
    await h.rendition.q.run()
    assert.equal(runtime.tab.book.cfi, 'saved-cfi')
    gate.resolve()
    await runtime.settled()
    runtime.tab.display('first-navigation-cfi')
    await runtime.settled()
    assert.equal(h.rows.get('alice').cfi, 'first-navigation-cfi')
    runtime.destroy()
  })
  await test('settled waits deferred writes and additional changes accepted during the drain', async () => {
    const h = load()
    const runtime = await start(h)
    const first = deferred()
    const second = deferred()
    h.control.writeGates.push(first.promise, second.promise)
    runtime.tab.updateBook({ definitions: ['one'] })
    let complete = false
    const drain = runtime.settled().then(() => {
      complete = true
    })
    await tick()
    assert.equal(complete, false)
    runtime.tab.updateBook({ definitions: ['one', 'two'] })
    first.resolve()
    await tick()
    assert.equal(complete, false)
    second.resolve()
    await drain
    assert.deepEqual(h.rows.get('alice').definitions, ['one', 'two'])
    runtime.destroy()
  })
  await test('settled waits a write created by the final rendition location frame', async () => {
    const h = load()
    const runtime = await start(h)
    const gate = deferred()
    h.control.writeGates.push(gate.promise)
    runtime.tab.display('last-frame-cfi')
    let complete = false
    const drain = runtime.settled().then(() => {
      complete = true
    })
    while (!h.control.updates.length) await tick()
    assert.equal(complete, false)
    gate.resolve()
    await drain
    assert.equal(h.rows.get('alice').cfi, 'last-frame-cfi')
    runtime.destroy()
  })
  await test('failed writes reject settlement instead of allowing a false saved Home exit', async () => {
    const h = load()
    const runtime = await start(h)
    h.control.writeError = true
    runtime.tab.updateBook({ definitions: ['unsaved'] })
    await assert.rejects(runtime.settled(), /Storage failed/)
    await assert.rejects(runtime.settled(), /Storage failed/)
    assert.deepEqual(h.rows.get('alice').definitions, [])
    runtime.destroy()
  })
  await test('destroy during file loading cancels rendering without overwriting restored groups', async () => {
    const h = load()
    const gate = deferred()
    h.control.fileGate = gate.promise
    const previous = h.reader.groups
    const runtime = h.createOriginalFeatureRuntime(book())
    runtime.tab.render({})
    runtime.destroy()
    gate.resolve()
    await runtime.settled()
    assert.equal(h.reader.groups, previous)
    assert.equal(h.control.parses, 0)
    assert.equal(h.control.updates.length, 0)
  })
  await test('restored same-book tabs receive detached mutable annotations/configuration and latest progress', async () => {
    const h = load()
    h.reader.addGroup([book()])
    const previousTab = h.reader.focusedBookTab
    const runtime = await start(h)
    runtime.tab.updateBook({
      annotations: [{ cfi: 'annotation-cfi', text: 'A real note' }],
      configuration: { typography: { fontSize: '22px' } },
    })
    runtime.tab.display('new-saved-cfi')
    await runtime.settled()
    runtime.destroy()
    assert.equal(h.reader.focusedBookTab, previousTab)
    assert.equal(previousTab.book.cfi, 'new-saved-cfi')
    assert.equal(previousTab.book.configuration.typography.fontSize, '22px')
    previousTab.book.annotations.push({ text: 'Another note' })
    assert.equal(previousTab.book.annotations.length, 2)
    assert.equal(runtime.tab.book.annotations.length, 1)
    h.emit('relocated', location('after-disposal-cfi'))
    assert.equal(previousTab.book.cfi, 'new-saved-cfi')
  })
  await test('returning to a previously rendered book resumes canonical source navigation instead of stale timeline', async () => {
    const h = load()
    h.reader.addGroup([book()])
    const previousTab = h.reader.focusedBookTab
    previousTab.timeline.unshift({
      location: location('previous-reader-cfi'),
      timestamp: 1,
    })
    const runtime = await start(h)
    runtime.tab.display('canonical-source-cfi')
    await runtime.settled()
    runtime.setActive(false)
    h.rendition.resize()
    await runtime.settled()
    assert.equal(runtime.tab.location.start.cfi, 'reflow-cfi')
    runtime.destroy()
    assert.equal(previousTab.location.start.cfi, 'canonical-source-cfi')
    assert.equal(
      previousTab.timeline[1].location.start.cfi,
      'previous-reader-cfi',
    )
    await previousTab.render({})
    await tick()
    await h.rendition.q.run()
    await tick()
    assert.equal(h.rows.get('alice').cfi, 'canonical-source-cfi')
  })
  await test('the prior ordinary engine cannot overwrite companion progress during isolation or after restoration/remount', async () => {
    const h = load()
    h.reader.addGroup([book()])
    const previousTab = h.reader.focusedBookTab
    await previousTab.render({})
    await tick()
    await h.rendition.q.run()
    await tick()
    const originalPolicy = previousTab.runtimePolicy
    const source = independentEngine()
    h.control.epubFactory = () => source.epub
    const runtime = h.createOriginalFeatureRuntime(copy(h.rows.get('alice')))
    assert.equal(h.control.destroys, 1)
    assert.equal(previousTab.rendition, undefined)
    assert.equal(previousTab.iframe, undefined)
    assert.equal(previousTab.runtimePolicy, originalPolicy)
    runtime.setActive(true)
    runtime.tab.render({})
    await runtime.settled()
    runtime.tab.display('companion-canonical-cfi')
    await runtime.settled()
    h.emit('relocated', location('old-engine-during-companion-cfi'))
    h.emit('rendered', {}, { window: { obsolete: true } })
    await tick()
    assert.equal(h.rows.get('alice').cfi, 'companion-canonical-cfi')
    assert.equal(previousTab.iframe, undefined)
    runtime.destroy()
    h.emit('relocated', location('old-engine-after-restoration-cfi'))
    await tick()
    assert.equal(h.rows.get('alice').cfi, 'companion-canonical-cfi')
    const restored = independentEngine()
    h.control.epubFactory = () => restored.epub
    await previousTab.render({})
    await tick()
    await restored.rendition.q.run()
    await tick()
    h.emit('relocated', location('old-engine-after-remount-cfi'))
    h.emit('rendered', {}, { window: { obsolete: true } })
    await tick()
    assert.equal(h.rows.get('alice').cfi, 'companion-canonical-cfi')
    assert.equal(previousTab.iframe, undefined)
    assert.equal(previousTab.rendition, restored.rendition)
    assert.equal(previousTab.runtimePolicy, originalPolicy)
  })
  await test('isolation cancels an ordinary render still waiting for its file without reviving its engine', async () => {
    const h = load()
    h.reader.addGroup([book()])
    const previousTab = h.reader.focusedBookTab
    const gate = deferred()
    h.control.fileGate = gate.promise
    const rendering = previousTab.render({})
    const runtime = h.createOriginalFeatureRuntime(book())
    gate.resolve()
    await rendering
    assert.equal(h.control.parses, 0)
    assert.equal(previousTab.epub, undefined)
    assert.equal(h.control.updates.length, 0)
    runtime.destroy()
    assert.equal(h.reader.focusedBookTab, previousTab)
    assert.equal(previousTab.book.cfi, 'saved-cfi')
  })
  await test('late section loading from a suspended ordinary engine cannot repopulate its destroyed render state', async () => {
    const h = load()
    h.reader.addGroup([book()])
    const previousTab = h.reader.focusedBookTab
    const gate = deferred()
    h.control.sectionGate = gate.promise
    await previousTab.render({})
    const runtime = h.createOriginalFeatureRuntime(book())
    runtime.destroy()
    gate.resolve()
    await tick()
    await tick()
    assert.equal(previousTab.sections, undefined)
    assert.equal(previousTab.nav, undefined)
    assert.equal(previousTab.rendition, undefined)
    assert.equal(previousTab.book.cfi, 'saved-cfi')
    assert.equal(h.control.updates.length, 0)
  })
  await test('source overlays notify their actual lifecycle and clear only the matching dismiss callback', async () => {
    const h = load()
    const changes = []
    const runtime = h.createOriginalFeatureRuntime(book(), undefined, (type) =>
      changes.push(type),
    )
    let dismissed = 0
    const hide = () => dismissed++
    runtime.tab.setSourceOverlay('selection', hide)
    assert.equal(runtime.tab.sourceOverlay, undefined)
    runtime.setActive(true)
    runtime.tab.setSourceOverlay('selection', hide)
    runtime.tab.setSourceOverlay('selection', hide)
    assert.deepEqual(changes, ['selection'])
    runtime.tab.setSourceOverlay('note', hide)
    runtime.tab.clearSourceOverlay(() => {})
    assert.equal(runtime.tab.sourceOverlay.type, 'note')
    runtime.tab.clearSourceOverlay(hide)
    assert.equal(runtime.tab.sourceOverlay, undefined)
    assert.equal(dismissed, 0)
    runtime.tab.setSourceOverlay('note', hide)
    runtime.tab.dismissSourceOverlay()
    assert.equal(dismissed, 1)
    assert.equal(runtime.tab.sourceOverlay, undefined)
    runtime.tab.setSourceOverlay('image', hide)
    runtime.setActive(false)
    assert.equal(dismissed, 2)
    assert.equal(runtime.tab.sourceOverlay, undefined)
    runtime.setActive(true)
    runtime.tab.setSourceOverlay('image', hide)
    runtime.destroy()
    assert.equal(dismissed, 3)
    assert.equal(changes.at(-1), undefined)
  })
  await test('companion Bookmark delegation is tracked before its callback runs and settlement waits for persistence', async () => {
    const h = load()
    const gate = deferred()
    let saved
    const runtime = h.createOriginalFeatureRuntime(
      book(),
      undefined,
      undefined,
      async (marker) => {
        await gate.promise
        saved = marker
      },
    )
    const marker = {
      sourceHref: 'chapter.xhtml',
      blockId: 'p1',
      text: 'Saved',
      savedAt: 1,
    }
    const operation = runtime.tab.runtimePolicy.saveListeningBookmark(marker)
    let complete = false
    const drain = runtime.settled().then(() => {
      complete = true
    })
    await tick()
    assert.equal(complete, false)
    gate.resolve()
    await operation
    await drain
    assert.equal(saved, marker)
    runtime.destroy()
  })
  await test('recoverable companion Bookmark failures reject the caller while Home waits and later saves remain usable', async () => {
    const h = load()
    const gate = deferred()
    let fail = true
    let saved = false
    const runtime = h.createOriginalFeatureRuntime(
      book(),
      undefined,
      undefined,
      async () => {
        await gate.promise
        if (fail) throw new Error('Bookmark storage failed')
        saved = true
      },
    )
    const operation = runtime.tab.runtimePolicy.saveListeningBookmark({})
    const rejected = assert.rejects(operation, /Bookmark storage failed/)
    let complete = false
    const drain = runtime.settled().then(() => {
      complete = true
    })
    await tick()
    assert.equal(complete, false)
    gate.resolve()
    await rejected
    await drain
    assert.equal(complete, true)
    assert.equal(saved, false)
    fail = false
    await runtime.tab.runtimePolicy.saveListeningBookmark({})
    await runtime.settled()
    assert.equal(saved, true)
    runtime.destroy()
    const ordinaryRuntime = h.createOriginalFeatureRuntime(book())
    assert.equal(
      ordinaryRuntime.tab.runtimePolicy.saveListeningBookmark,
      undefined,
    )
    ordinaryRuntime.destroy()
  })
  await test('ordinary BookTabs keep their original initial progress persistence', async () => {
    const h = load()
    h.reader.addGroup([book()])
    const tab = h.reader.focusedBookTab
    await tab.render({})
    await tick()
    await h.rendition.q.run()
    await tick()
    assert.equal(h.rows.get('alice').cfi, 'initial-page-cfi')
    assert.equal(h.control.updates.length, 1)
    assert.equal(tab.canInteract, true)
  })
  await test('render and resize failures surface through settlement without hanging', async () => {
    const h = load()
    const runtime = h.createOriginalFeatureRuntime(book())
    h.control.parseError = true
    runtime.tab.render({})
    await assert.rejects(runtime.settled(), /EPUB failed/)
    runtime.destroy()
    const h2 = load()
    const runtime2 = await start(h2)
    runtime2.setActive(false)
    h2.control.resizeError = true
    runtime2.setActive(true)
    await assert.rejects(runtime2.settled(), /Resize failed/)
    runtime2.destroy()
  })
  await test('disposing a stale runtime does not replace a newer reader scope', async () => {
    const h = load()
    const runtime = h.createOriginalFeatureRuntime(book())
    h.reader.clear()
    h.reader.addGroup([book('new-reader')])
    const replacement = h.reader.groups
    runtime.destroy()
    assert.equal(h.reader.groups, replacement)
    assert.equal(h.reader.focusedBookTab.id, 'new-reader')
  })
  await test('remote sync uses canonical saved CFI rather than an unsaved rendition relocation', async () => {
    const h = load()
    const runtime = await start(h)
    const uploads = []
    const sync = { exports: {} }
    const remote = [book()]
    vm.runInNewContext(syncCode, {
      exports: sync.exports,
      require(name) {
        if (name === 'react')
          return {
            useCallback: (callback) => callback,
            useEffect: (effect) => effect(),
          }
        if (name === 'valtio')
          return { ...valtio, useSnapshot: valtio.snapshot }
        if (name === '@flow/reader/sync')
          return { uploadData: (books) => uploads.push(copy(books)) }
        if (name === './useRemote')
          return {
            useRemoteBooks: () => ({ mutate: (update) => update(remote) }),
          }
        throw new Error('Unexpected sync dependency ' + name)
      },
    })
    sync.exports.useSync(runtime.tab)
    assert.equal(runtime.tab.location.start.cfi, 'initial-page-cfi')
    assert.equal(uploads[0][0].cfi, 'saved-cfi')
    runtime.destroy()
  })
  await test('fresh and reopened original Search panels retain nonempty queries without an effect loop', async () => {
    for (let reopen = 0; reopen < 3; reopen++) {
      const h = searchHarness('saved query')
      h.render()
      assert.equal(h.local(), 'saved query')
      assert.equal(h.global(), 'saved query')
      assert.equal(h.render(), 0)
      assert.equal(h.render(), 0)
    }
  })
  await test('original Search keeps selection-driven and typed queries synchronized after initialization', async () => {
    const h = searchHarness('saved query')
    h.render()
    h.fromReader('selected source text')
    h.render()
    h.render()
    assert.equal(h.local(), 'selected source text')
    assert.equal(h.global(), 'selected source text')
    assert.equal(h.render(), 0)
    h.type('typed query')
    h.render()
    h.render()
    assert.equal(h.local(), 'typed query')
    assert.equal(h.global(), 'typed query')
    assert.equal(h.render(), 0)
  })
  console.log(`${passed}/${passed} original feature runtime groups passed.`)
})().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
