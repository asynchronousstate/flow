/* Exercises the real TextSelectionMenuRenderer event handler and effect
 * registration with dependency/hook adapters. Not a DOM or Android Back test.
 * Run: node scripts/test-listening-selection-bridge.cjs
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const code = ts.transpileModule(
  fs.readFileSync(
    path.resolve(
      __dirname,
      '../apps/reader/src/components/TextSelectionMenu.tsx',
    ),
    'utf8',
  ) + '\nexport { TextSelectionMenuRenderer }\n',
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.React,
      esModuleInterop: true,
    },
  },
).outputText
function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
const tick = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

function fixture({
  companion = true,
  annotation = false,
  delegate = true,
} = {}) {
  const prepare = deferred()
  const save = deferred()
  const calls = {
    load: 0,
    marker: 0,
    delegated: [],
    ordinary: [],
    tabs: [],
    actions: [],
    hidden: 0,
    tracked: [],
    overlays: [],
    cleared: [],
    state: [],
  }
  const effects = []
  let stateIndex = 0
  let active = true
  let disposed = false
  const react = {
    useCallback: (callback) => callback,
    useRef: (initial) => ({ current: initial }),
    useState(initial) {
      const index = stateIndex++
      return [initial, (value) => calls.state.push({ index, value })]
    },
    useEffect(effect) {
      effects.push(effect)
    },
    createElement(type, props, ...children) {
      return { type, props: { ...props, children: children.flat(Infinity) } }
    },
  }
  const policy = companion
    ? {
        isActive: () => active,
        isDisposed: () => disposed,
        track: (task) => calls.tracked.push(task),
        ...(delegate
          ? {
              saveListeningBookmark(marker) {
                calls.delegated.push(marker)
                return save.promise
              },
            }
          : {}),
      }
    : undefined
  const tab = {
    runtimePolicy: policy,
    book: {
      id: 'alice',
      annotations: annotation ? [{ cfi: 'exact-cfi' }] : [],
    },
    view: { section: { href: 'chapter-three.xhtml' } },
    currentHref: 'chapter-three.xhtml',
    rangeToCfi: () => 'exact-cfi',
    isDefined: () => false,
    setSourceOverlay: (type, dismiss) => calls.overlays.push({ type, dismiss }),
    clearSourceOverlay: (dismiss) => calls.cleared.push(dismiss),
  }
  const integrated = {
    loadLibraryListeningBook: () => {
      calls.load++
      return prepare.promise
    },
    saveLibraryMarker: (...args) => {
      calls.ordinary.push(args)
      return save.promise
    },
  }
  const modules = {
    react,
    '@literal-ui/core': { Overlay: 'Overlay' },
    clsx: (...args) => args.join(' '),
    'react-focus-lock': 'FocusLock',
    'react-icons/md': {},
    valtio: { useSnapshot: (value) => value },
    '../annotation': { typeMap: {}, colorMap: {} },
    '../hooks': {
      useSetAction: () => (action) => calls.actions.push(action),
      useMobile: () => true,
      useTranslation: () => (key) => key,
      useTypography: () => ({}),
    },
    '../listening/chapters': {
      chapterForBookmark: () => ({ title: 'Chapter III' }),
    },
    '../listening/document': {
      markerFromRange(book, href, range, cfi) {
        calls.marker++
        assert.equal(book.id, 'prepared-alice')
        assert.equal(href, 'chapter-three.xhtml')
        assert.equal(range.cloned, true)
        return {
          sourceHref: href,
          blockId: 'paragraph-five',
          text: 'The exact selected paragraph.',
          cfi,
          savedAt: 123,
        }
      },
    },
    '../listening/integrated': integrated,
    '../models': { reader: { addTab: (value) => calls.tabs.push(value) } },
    '../platform': { isTouchScreen: true, scale: (a) => a },
    '../state': { useSettings: () => [{}] },
    '../utils': { copy() {}, keys: Object.keys, last: (items) => items.at(-1) },
    './Button': { Button: 'Button', IconButton: 'IconButton' },
    './Form': { TextField: 'TextField' },
    './base': {
      layout: () => 0,
      LayoutAnchorMode: { ALIGN: 0 },
      LayoutAnchorPosition: { Before: 0, After: 1 },
    },
  }
  const context = {
    exports: {},
    React: react,
    Error,
    getComputedStyle: () => ({ lineHeight: '22px' }),
    require(name) {
      if (!(name in modules)) throw new Error('Unexpected import ' + name)
      return modules[name]
    },
  }
  vm.runInNewContext(code, context, { filename: 'TextSelectionMenu.tsx' })
  const tree = context.exports.TextSelectionMenuRenderer({
    tab,
    range: {
      cloneRange: () => ({ cloned: true }),
      endContainer: { parentElement: {} },
      startContainer: { parentElement: {} },
    },
    anchorRect: { height: 22, top: 0, left: 0, width: 40 },
    containerRect: { width: 390, height: 700, left: 0 },
    viewRect: { left: 0 },
    text: 'selected',
    forward: true,
    hide: () => calls.hidden++,
  })
  const cleanups = effects.map((effect) => effect()).filter(Boolean)
  function nodes(root) {
    if (!root || typeof root !== 'object') return []
    return [root, ...(root.props?.children || []).flatMap(nodes)]
  }
  const button = nodes(tree).find(
    (node) =>
      node.props?.['aria-label'] === 'Bookmark this paragraph for listening',
  )
  return {
    calls,
    tab,
    prepare,
    save,
    click: () => button.props.onClick(),
    resolvePreparation: () =>
      prepare.resolve({
        book: { id: 'prepared-alice' },
        record: { fingerprint: 'verified-fingerprint' },
      }),
    setActive(value) {
      active = value
    },
    dispose() {
      disposed = true
    },
    unmount() {
      cleanups.reverse().forEach((cleanup) => cleanup())
    },
  }
}

let passed = 0
async function test(name, verify) {
  await verify()
  passed++
  console.log('PASS ' + name)
}

;(async () => {
  await test('selection and note register matching dismiss lifecycles only in the companion', () => {
    for (const annotation of [false, true]) {
      const h = fixture({ annotation })
      assert.equal(h.calls.overlays[0].type, annotation ? 'note' : 'selection')
      h.calls.overlays[0].dismiss()
      assert.equal(h.calls.hidden, 1)
      h.unmount()
      assert.equal(h.calls.cleared[0], h.calls.overlays[0].dismiss)
    }
    assert.equal(fixture({ companion: false }).calls.overlays.length, 0)
  })

  await test('companion tracks the full preparation and shared save, without reopening a tab', async () => {
    const h = fixture()
    const lifecycle = h.click()
    assert.equal(h.calls.tracked.length, 1)
    assert.equal(h.calls.tracked[0], lifecycle)
    assert.equal(h.calls.load, 1)
    assert.equal(h.calls.delegated.length, 0)
    h.resolvePreparation()
    await tick()
    assert.equal(h.calls.delegated.length, 1)
    assert.equal(h.calls.delegated[0].chapterTitle, 'Chapter III')
    let finished = false
    lifecycle.then(() => {
      finished = true
    })
    await tick()
    assert.equal(finished, false)
    h.save.resolve()
    await lifecycle
    assert.equal(h.calls.hidden, 1)
    assert.equal(h.calls.ordinary.length, 0)
    assert.equal(h.calls.tabs.length, 0)
    assert.equal(h.calls.actions.length, 0)
  })

  await test('a second tap while preparation is pending cannot duplicate the accepted save', async () => {
    const h = fixture()
    const lifecycle = h.click()
    h.click()
    assert.equal(h.calls.load, 1)
    assert.equal(h.calls.tracked.length, 1)
    h.resolvePreparation()
    h.save.resolve()
    await lifecycle
    assert.equal(h.calls.delegated.length, 1)
  })

  await test('Back/inactive, disposal, or unmount during preparation cannot enqueue a stale Bookmark', async () => {
    for (const close of [
      (h) => h.setActive(false),
      (h) => h.dispose(),
      (h) => h.unmount(),
    ]) {
      const h = fixture()
      const lifecycle = h.click()
      close(h)
      h.resolvePreparation()
      await lifecycle
      assert.equal(h.calls.marker, 0)
      assert.equal(h.calls.delegated.length, 0)
      assert.equal(h.calls.ordinary.length, 0)
      assert.equal(h.calls.tabs.length, 0)
      assert.equal(h.calls.hidden, 0)
    }
  })

  await test('closing after a save is accepted never resurrects the source or opens Listening setup', async () => {
    const h = fixture()
    const lifecycle = h.click()
    h.resolvePreparation()
    await tick()
    assert.equal(h.calls.delegated.length, 1)
    h.dispose()
    h.save.resolve()
    await lifecycle
    assert.equal(h.calls.hidden, 0)
    assert.equal(h.calls.tabs.length, 0)
    assert.equal(h.calls.actions.length, 0)
  })

  await test('local preparation errors are visible, complete the tracked lifecycle, and permit retry', async () => {
    const h = fixture()
    const lifecycle = h.click()
    h.prepare.reject(new Error('EPUB verification failed'))
    await lifecycle
    assert.ok(
      h.calls.state.some(({ value }) => value === 'EPUB verification failed'),
    )
    assert.equal(h.calls.tabs.length, 0)
    assert.equal(h.calls.delegated.length, 0)
    const retry = h.click()
    await retry
    assert.equal(h.calls.load, 2)
  })

  await test('shared-save rejection is shown without falling back to the ordinary tab-opening path', async () => {
    const h = fixture()
    const lifecycle = h.click()
    h.resolvePreparation()
    await tick()
    h.save.reject(new Error('Bookmark storage failed'))
    await lifecycle
    assert.ok(
      h.calls.state.some(({ value }) => value === 'Bookmark storage failed'),
    )
    assert.equal(h.calls.hidden, 0)
    assert.equal(h.calls.tabs.length, 0)
    assert.equal(h.calls.ordinary.length, 0)
  })

  await test('a companion without a save bridge fails locally instead of creating an ordinary reader tab', async () => {
    const h = fixture({ delegate: false })
    const lifecycle = h.click()
    h.resolvePreparation()
    await lifecycle
    assert.ok(
      h.calls.state.some(
        ({ value }) =>
          value === 'Return to the listening document to save this Bookmark.',
      ),
    )
    assert.equal(h.calls.ordinary.length, 0)
    assert.equal(h.calls.tabs.length, 0)
  })

  await test('ordinary reader keeps its verified persistence, tab, and listening-setup behavior', async () => {
    const h = fixture({ companion: false })
    const lifecycle = h.click()
    h.resolvePreparation()
    await tick()
    assert.equal(h.calls.ordinary.length, 1)
    assert.equal(h.calls.ordinary[0][0], 'alice')
    assert.equal(h.calls.ordinary[0][2], 'verified-fingerprint')
    h.save.resolve()
    await lifecycle
    assert.equal(h.calls.tabs[0], h.tab)
    assert.equal(h.calls.actions[0], 'listening')
    assert.equal(h.calls.hidden, 1)
    assert.equal(h.calls.tracked.length, 0)
  })

  await test('ordinary reader unmount during an accepted write suppresses late UI resurrection', async () => {
    const h = fixture({ companion: false })
    const lifecycle = h.click()
    h.resolvePreparation()
    await tick()
    h.unmount()
    h.save.resolve()
    await lifecycle
    assert.equal(h.calls.ordinary.length, 1)
    assert.equal(h.calls.tabs.length, 0)
    assert.equal(h.calls.actions.length, 0)
    assert.equal(h.calls.hidden, 0)
  })

  console.log(`${passed}/${passed} Listening selection bridge groups passed.`)
})().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
