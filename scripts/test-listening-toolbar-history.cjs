/* Tests the real same-document history controller at the routes used by the
 * three Listening toolbar implementations. A deterministic HistoryAdapter is
 * used here; these checks do not establish native Android Back or Next routing.
 * Run: node scripts/test-listening-toolbar-history.cjs
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const source = fs.readFileSync(
  path.resolve(__dirname, '../apps/reader/src/hooks/panel-history.ts'),
  'utf8',
)
const context = { exports: {} }
vm.runInNewContext(
  ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.CommonJS,
    },
  }).outputText,
  context,
  { filename: 'panel-history.ts' },
)
const { createMobilePanelHistory, PANEL_HISTORY_KEY } = context.exports
const clone = (value) => JSON.parse(JSON.stringify(value))
const variants = ['ribbon', 'sheets', 'workspace']
const tools = [
  'toc',
  'search',
  'annotation',
  'image',
  'timeline',
  'typography',
  'theme',
  'settings',
]
let passed = 0
function test(name, verify) {
  verify()
  passed++
  console.log('PASS ' + name)
}

function harness(variant, bookId = 'alice', session = 'session-one') {
  let route = `/listen?book=${bookId}&session=${session}&toolbar=${variant}`
  const initialNext = {
    __N: true,
    key: 'next-route-key',
    url: route,
    as: route,
    options: { shallow: false },
  }
  const entries = [clone(initialNext)]
  let index = 0
  let view = { bookId, navbar: false }
  let traversals = 0
  const history = {
    get state() {
      return entries[index]
    },
    pushState(value, unused) {
      assert.equal(unused, '')
      entries.splice(index + 1)
      entries.push(clone(value))
      index++
    },
    replaceState(value, unused) {
      assert.equal(unused, '')
      entries[index] = clone(value)
    },
    go(delta) {
      assert.ok(index + delta >= 0 && index + delta < entries.length)
      index += delta
      traversals++
    },
  }
  const makeController = () =>
    createMobilePanelHistory(
      history,
      () => route,
      () => view,
      (next) => {
        view = clone(next)
      },
      (previous, next) =>
        (previous.action === 'tools' &&
          ['bookmark-list', 'help'].includes(next.action || '')) ||
        (!!next.action?.startsWith('overlay:') &&
          !previous.action?.startsWith('overlay:')),
    )
  let controller = makeController()
  controller.sync(view)
  return {
    entries,
    initialNext,
    history,
    get view() {
      return clone(view)
    },
    get index() {
      return index
    },
    get traversals() {
      return traversals
    },
    get route() {
      return route
    },
    sync(action, override = {}) {
      view = {
        bookId: view.bookId,
        navbar: false,
        ...override,
        ...(action === undefined ? {} : { action }),
      }
      controller.sync(view)
    },
    flush() {
      assert.equal(controller.restore(history.state), true)
      controller.sync(view)
    },
    pop(delta) {
      history.go(delta)
      assert.equal(controller.restore(history.state), true)
      controller.sync(view)
    },
    restore(state) {
      return controller.restore(state)
    },
    replace(action) {
      view = {
        bookId: view.bookId,
        navbar: false,
        ...(action === undefined ? {} : { action }),
      }
      controller.replace(view)
    },
    changeRoute(next) {
      route = next
    },
    remount() {
      controller = makeController()
      controller.sync(view)
    },
  }
}

for (const variant of variants) {
  test(`${variant}: all eight tools share one overlay level and retain Next route fields`, () => {
    const h = harness(variant)
    for (const tool of tools) {
      h.sync(tool)
      assert.equal(h.entries.length, 2)
      assert.equal(h.index, 1)
      assert.equal(h.history.state[PANEL_HISTORY_KEY].trail.length, 2)
      assert.equal(h.history.state[PANEL_HISTORY_KEY].trail[1].action, tool)
      for (const [key, value] of Object.entries(h.initialNext))
        assert.deepEqual(h.history.state[key], value)
    }
    h.pop(-1)
    assert.deepEqual(h.view, { bookId: 'alice', navbar: false })
    h.pop(1)
    assert.equal(h.view.action, 'settings')
    assert.equal(h.traversals, 2)
  })

  test(`${variant}: mobile result navigation closes its panel into source, then Back restores quiet`, () => {
    const h = harness(variant)
    h.sync('toc')
    // The original TOC/Search action clears recoil's panel action on mobile;
    // Listening keeps sourceOpen=true and derives this source history state.
    h.sync('source')
    assert.equal(h.entries.length, 2)
    assert.equal(h.history.state[PANEL_HISTORY_KEY].trail[1].action, 'source')
    h.pop(-1)
    assert.equal(h.view.action, undefined)
    h.pop(1)
    assert.equal(h.view.action, 'source')
    h.sync('search')
    assert.equal(h.entries.length, 2)
    assert.equal(h.view.action, 'search')
  })

  test(`${variant}: explicit return to listening consumes the overlay without a closed duplicate`, () => {
    const h = harness(variant)
    h.sync('image')
    h.sync('source')
    h.sync(undefined)
    assert.equal(h.index, 0)
    assert.equal(h.entries.length, 2)
    h.flush()
    assert.deepEqual(h.view, { bookId: 'alice', navbar: false })
    h.pop(1)
    assert.equal(h.view.action, 'source')
  })

  test(`${variant}: Session Tools and nested Bookmark/Help retain two-level Back/Forward`, () => {
    const h = harness(variant)
    h.sync('tools')
    h.sync('bookmark-list')
    assert.equal(h.entries.length, 3)
    h.sync('help')
    assert.equal(h.entries.length, 3)
    h.pop(-1)
    assert.equal(h.view.action, 'tools')
    h.pop(-1)
    assert.equal(h.view.action, undefined)
    h.pop(1)
    assert.equal(h.view.action, 'tools')
    h.pop(1)
    assert.equal(h.view.action, 'help')
  })

  test(`${variant}: replacing nested Bookmark with an ebook tool stays bounded and closes predictably`, () => {
    const h = harness(variant)
    h.sync('tools')
    h.sync('bookmark-list')
    h.sync('typography')
    assert.equal(h.entries.length, 3)
    assert.equal(
      h.history.state[PANEL_HISTORY_KEY].trail[2].action,
      'typography',
    )
    h.sync(undefined)
    assert.equal(h.index, 0)
    h.flush()
    assert.equal(h.view.action, undefined)
  })

  test(`${variant}: different variant, session, library, or query route cannot restore a stale overlay`, () => {
    const h = harness(variant)
    h.sync('annotation')
    const saved = clone(h.history.state)
    for (const next of [
      '/',
      `/?toolbar=${variant}`,
      `/listen?book=alice&session=session-two&toolbar=${variant}`,
      `/listen?book=alice&session=session-one&toolbar=${
        variant === 'ribbon' ? 'sheets' : 'ribbon'
      }`,
    ]) {
      h.changeRoute(next)
      assert.equal(h.restore(saved), false)
      assert.equal(h.view.action, 'annotation')
    }
  })

  test(`${variant}: another book's overlay is normalized closed, without reopening that book`, () => {
    const h = harness(variant)
    h.sync('timeline')
    const stale = clone(h.history.state)
    h.sync(undefined, { bookId: 'gunboat' })
    assert.equal(h.restore(stale), true)
    assert.deepEqual(h.view, { bookId: 'gunboat', navbar: false })
    assert.deepEqual(h.history.state[PANEL_HISTORY_KEY].trail, [
      { bookId: 'gunboat', navbar: false },
    ])
  })

  test(`${variant}: reload/remount establishes a fresh base without issuing a surprise Back`, () => {
    const h = harness(variant)
    h.sync('theme')
    const previousTraversals = h.traversals
    h.remount()
    assert.equal(h.traversals, previousTraversals)
    assert.equal(h.view.action, 'theme')
    assert.equal(h.history.state[PANEL_HISTORY_KEY].trail.length, 2)
    h.pop(-1)
    assert.equal(h.view.action, undefined)
  })

  test(`${variant}: selection, note and image overlays nest over every reader tool or source`, () => {
    for (const underlying of [...tools, 'source']) {
      const h = harness(variant)
      h.sync(underlying)
      h.sync(`overlay:${underlying}:selection`)
      assert.equal(h.entries.length, 3)
      assert.equal(h.history.state[PANEL_HISTORY_KEY].trail.length, 3)
      // Opening the note editor and then an image replaces the same source
      // overlay level; changing type must not accumulate additional Back taps.
      h.sync(`overlay:${underlying}:note`)
      h.sync(`overlay:${underlying}:image`)
      assert.equal(h.entries.length, 3)
      h.pop(-1)
      assert.equal(h.view.action, underlying)
      h.pop(1)
      assert.equal(h.view.action, `overlay:${underlying}:image`)
    }
  })

  test(`${variant}: nested Session Tools, reader and source overlay use at most four history levels`, () => {
    const h = harness(variant)
    h.sync('tools')
    h.sync('bookmark-list')
    h.sync('source')
    h.sync('overlay:source:selection')
    assert.equal(h.entries.length, 4)
    assert.deepEqual(
      h.history.state[PANEL_HISTORY_KEY].trail.map((view) => view.action),
      [undefined, 'tools', 'source', 'overlay:source:selection'],
    )
    h.sync('overlay:source:note')
    assert.equal(h.entries.length, 4)
    h.pop(-1)
    assert.equal(h.view.action, 'source')
    h.pop(-1)
    assert.equal(h.view.action, 'tools')
    h.pop(-1)
    assert.equal(h.view.action, undefined)
    h.pop(1)
    h.pop(1)
    h.pop(1)
    assert.equal(h.view.action, 'overlay:source:note')
  })

  test(`${variant}: dismissing a source overlay consumes its entry and returns to its existing reader surface`, () => {
    for (const underlying of ['source', 'annotation', 'image']) {
      const h = harness(variant)
      h.sync(underlying)
      h.sync(`overlay:${underlying}:note`)
      h.sync(underlying)
      assert.equal(h.index, 1)
      assert.equal(h.entries.length, 3)
      h.flush()
      assert.equal(h.view.action, underlying)
      assert.equal(h.history.state[PANEL_HISTORY_KEY].trail.length, 2)
    }
  })

  test(`${variant}: replace normalizes a canceled overlay to its source without an extra history traversal`, () => {
    for (const underlying of ['source', 'toc', 'annotation', 'image']) {
      const h = harness(variant)
      h.sync(underlying)
      h.sync(`overlay:${underlying}:selection`)
      h.pop(-1)
      // A canceled selection cannot be recreated. The app's restoration
      // callback uses replace at this point to normalize a stale Forward entry.
      // This checks that API only, not native Forward or DOM reconstruction.
      h.pop(1)
      const before = h.traversals
      const beforeIndex = h.index
      h.replace(underlying)
      assert.equal(h.traversals, before)
      assert.equal(h.index, beforeIndex)
      assert.equal(h.entries.length, 3)
      assert.equal(h.view.action, underlying)
      assert.equal(h.history.state[PANEL_HISTORY_KEY].trail.length, 2)
      assert.equal(
        h.history.state[PANEL_HISTORY_KEY].trail[1].action,
        underlying,
      )
      for (const [key, value] of Object.entries(h.initialNext))
        assert.deepEqual(h.history.state[key], value)
      assert.equal(h.history.state[PANEL_HISTORY_KEY].route, h.route)
      h.sync(underlying)
      assert.equal(h.traversals, before)
      assert.equal(h.entries.length, 3)
    }
  })

  test(`${variant}: replacing a four-level overlay preserves unrelated Next state and the route`, () => {
    const h = harness(variant)
    h.sync('tools')
    h.sync('help')
    h.sync('search')
    h.sync('overlay:search:note')
    h.history.state.extra = { scroll: 1400, fixture: ['unchanged'] }
    const before = h.traversals
    h.replace('search')
    assert.equal(h.history.state[PANEL_HISTORY_KEY].trail.length, 3)
    assert.equal(h.history.state[PANEL_HISTORY_KEY].route, h.route)
    assert.deepEqual(h.history.state.extra, {
      scroll: 1400,
      fixture: ['unchanged'],
    })
    assert.equal(h.history.state.url, h.initialNext.url)
    assert.equal(h.history.state.as, h.initialNext.as)
    assert.equal(h.traversals, before)
  })

  test(`${variant}: a stale controller cannot replace a library or different-session entry`, () => {
    for (const route of [
      `/?toolbar=${variant}`,
      `/listen?book=alice&session=session-two&toolbar=${variant}`,
    ]) {
      const h = harness(variant)
      h.sync('source')
      h.sync('overlay:source:note')
      const before = clone(h.entries)
      const beforeIndex = h.index
      const beforeTraversals = h.traversals
      h.changeRoute(route)
      h.replace('source')
      assert.deepEqual(h.entries, before)
      assert.equal(h.index, beforeIndex)
      assert.equal(h.traversals, beforeTraversals)
    }
  })
}

test('malformed history data is ignored without changing current state', () => {
  const h = harness('ribbon')
  h.sync('search')
  for (const data of [
    null,
    {},
    { [PANEL_HISTORY_KEY]: { version: 2, route: h.route, trail: [] } },
    {
      [PANEL_HISTORY_KEY]: {
        version: 1,
        route: h.route,
        trail: [{ bookId: 'alice', action: 3, navbar: false }],
      },
    },
    {
      [PANEL_HISTORY_KEY]: {
        version: 1,
        route: h.route,
        trail: [{ bookId: 'alice', action: 'toc' }],
      },
    },
    {
      [PANEL_HISTORY_KEY]: {
        version: 1,
        route: h.route,
        trail: Array.from({ length: 5 }, () => ({
          bookId: 'alice',
          navbar: false,
        })),
      },
    },
  ]) {
    assert.equal(h.restore(data), false)
    assert.equal(h.view.action, 'search')
  }
})

console.log(`${passed}/${passed} Listening toolbar history groups passed.`)
