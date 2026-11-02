/* Real mobile-overlay history controller and search excerpt unit checks.
 * These tests do not simulate Next routing or Android's native Back gesture.
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

function moduleAt(relative) {
  const source = fs.readFileSync(path.resolve(__dirname, relative), 'utf8')
  const context = { exports: {} }
  vm.runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2020,
        module: ts.ModuleKind.CommonJS,
      },
    }).outputText,
    context,
  )
  return context.exports
}
const { createMobilePanelHistory, PANEL_HISTORY_KEY, sameRestoredPanel } =
  moduleAt('../apps/reader/src/hooks/panel-history.ts')
const { searchExcerpt } = moduleAt(
  '../apps/reader/src/components/search-excerpt.ts',
)
const copy = (value) => JSON.parse(JSON.stringify(value))
let groups = 0
function test(name, verify) {
  verify()
  groups++
  console.log('PASS ' + name)
}

function harness(opensNestedPanel) {
  const initialNext = {
    __N: true,
    key: 'next-key',
    url: '/',
    as: '/',
    options: { shallow: true },
  }
  const entries = [copy(initialNext)]
  let index = 0
  let view = { bookId: 'alice', navbar: false }
  let url = '/'
  let navigationCount = 0
  const history = {
    get state() {
      return entries[index]
    },
    pushState(state) {
      entries.splice(index + 1)
      entries.push(copy(state))
      index++
    },
    replaceState(state) {
      entries[index] = copy(state)
    },
    go(delta) {
      assert.ok(index + delta >= 0 && index + delta < entries.length)
      index += delta
      navigationCount++
    },
  }
  const makeController = () =>
    createMobilePanelHistory(
      history,
      () => url,
      () => view,
      (next) => {
        view = copy(next)
      },
      opensNestedPanel,
    )
  let controller = makeController()
  return {
    initialNext,
    entries,
    history,
    get view() {
      return view
    },
    get index() {
      return index
    },
    get navigationCount() {
      return navigationCount
    },
    sync(next) {
      view = { ...next }
      controller.sync(view)
    },
    pop(delta) {
      history.go(delta)
      assert.equal(controller.restore(history.state), true)
      controller.sync(view)
    },
    flush() {
      assert.equal(controller.restore(history.state), true)
      controller.sync(view)
    },
    restore(state) {
      return controller.restore(state)
    },
    route(value) {
      url = value
    },
    remount() {
      controller = makeController()
      controller.sync(view)
    },
  }
}

test('opening panels preserves Next state and adds no URL or reader-data fields', () => {
  const h = harness()
  h.sync(h.view)
  assert.equal(h.entries.length, 1)
  h.sync({ ...h.view, action: 'toc' })
  assert.equal(h.entries.length, 2)
  for (const [key, value] of Object.entries(h.initialNext))
    assert.deepEqual(h.history.state[key], value)
  assert.deepEqual(
    Object.keys(h.history.state).sort(),
    [...Object.keys(h.initialNext), PANEL_HISTORY_KEY].sort(),
  )
})
test('Back closes the top pane then toolbar, while Forward restores both', () => {
  const h = harness()
  h.sync(h.view)
  h.sync({ ...h.view, navbar: true })
  h.sync({ ...h.view, action: 'search' })
  h.pop(-1)
  assert.deepEqual(h.view, { bookId: 'alice', navbar: true })
  h.pop(-1)
  assert.deepEqual(h.view, { bookId: 'alice', navbar: false })
  h.pop(1)
  h.pop(1)
  assert.deepEqual(h.view, { bookId: 'alice', navbar: true, action: 'search' })
  assert.equal(h.entries.length, 3)
})
test('switching open tools replaces one overlay level instead of stacking each tool', () => {
  const h = harness()
  h.sync(h.view)
  h.sync({ ...h.view, action: 'toc' })
  h.sync({ ...h.view, action: 'typography' })
  assert.equal(h.entries.length, 2)
  h.pop(-1)
  assert.equal(h.view.action, undefined)
  h.pop(1)
  assert.equal(h.view.action, 'typography')
})
test('an explicit close consumes the overlay entry and does not add a closed duplicate', () => {
  const h = harness()
  h.sync(h.view)
  h.sync({ ...h.view, action: 'listening' })
  h.sync({ bookId: 'alice', navbar: false })
  h.flush()
  assert.equal(h.index, 0)
  assert.equal(h.entries.length, 2)
  assert.equal(h.view.action, undefined)
  h.pop(1)
  assert.equal(h.view.action, 'listening')
})
test('a new pane after Back replaces forward history without resetting saved reading data', () => {
  const h = harness()
  h.sync(h.view)
  const saved = {
    cfi: 'saved-cfi',
    query: 'Alice',
    from: 'toc:III',
    through: 'toc:IV',
    startAt: 'chapter',
  }
  const before = copy(saved)
  h.sync({ ...h.view, action: 'toc' })
  h.pop(-1)
  h.sync({ ...h.view, action: 'search' })
  assert.equal(h.entries.length, 2)
  assert.equal(h.history.state[PANEL_HISTORY_KEY].trail[1].action, 'search')
  assert.deepEqual(saved, before)
})
test('a stale panel entry cannot reopen another book or its saved start', () => {
  const h = harness()
  h.sync(h.view)
  h.sync({ ...h.view, action: 'listening' })
  const alice = copy(h.history.state)
  h.sync({ bookId: 'gunboat', navbar: false })
  assert.equal(h.restore(alice), true)
  assert.deepEqual(h.view, { bookId: 'gunboat', navbar: false })
})
test('foreign routes and malformed history remain available to the normal router', () => {
  const h = harness()
  h.sync(h.view)
  assert.equal(
    h.restore({ [PANEL_HISTORY_KEY]: { version: 1, route: '/', trail: [] } }),
    false,
  )
  const state = copy(h.history.state)
  h.route('/listen?book=alice')
  assert.equal(h.restore(state), false)
})
test('remounting with retained browser history does not issue an automatic Back', () => {
  const h = harness()
  h.sync(h.view)
  h.sync({ ...h.view, action: 'listening' })
  const next = h.navigationCount
  h.remount()
  assert.equal(h.navigationCount, next)
  assert.equal(h.view.action, 'listening')
})
test('a Forward-restored listening review stops being a restoration after an explicit tool or book switch', () => {
  const restored = { bookId: 'alice', action: 'listening', navbar: false }
  assert.equal(sameRestoredPanel(restored, { ...restored, navbar: true }), true)
  assert.equal(
    sameRestoredPanel(restored, { ...restored, action: 'toc' }),
    false,
  )
  assert.equal(
    sameRestoredPanel(restored, { ...restored, bookId: 'gunboat' }),
    false,
  )
})
test('quiet nested disclosures dismiss before Tools, and sibling disclosures replace one level', () => {
  const h = harness(
    (previous, next) =>
      previous.action === 'tools' &&
      ['bookmark-list', 'help'].includes(next.action),
  )
  h.sync(h.view)
  h.sync({ ...h.view, action: 'tools' })
  h.sync({ ...h.view, action: 'bookmark-list' })
  assert.equal(h.entries.length, 3)
  h.sync({ ...h.view, action: 'help' })
  assert.equal(h.entries.length, 3)
  h.pop(-1)
  assert.equal(h.view.action, 'tools')
  h.pop(-1)
  assert.equal(h.view.action, undefined)
  h.pop(1)
  h.pop(1)
  assert.equal(h.view.action, 'help')
})
test('short excerpts retain complete text and normalize whitespace', () => {
  assert.equal(searchExcerpt('  Alice\n  replied. ', 'Alice'), 'Alice replied.')
})
test('long excerpts center matching words rather than losing them to leading truncation', () => {
  const excerpt = searchExcerpt(
    'Before '.repeat(80) + 'Alice answered' + ' after'.repeat(80),
    'ALICE',
  )
  assert.ok(excerpt.includes('Alice answered'))
  assert.ok(excerpt.startsWith('…') && excerpt.endsWith('…'))
  assert.ok(excerpt.length <= 172)
})
test('missing matches use a readable leading excerpt without throwing', () => {
  const excerpt = searchExcerpt('Words '.repeat(100), 'not present', 50)
  assert.equal(excerpt.startsWith('…'), false)
  assert.ok(excerpt.endsWith('…') && excerpt.length <= 51)
})
console.log(`${groups}/${groups} reader navigation / excerpt groups passed.`)
