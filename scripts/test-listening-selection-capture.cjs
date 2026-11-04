/* Real TextSelectionMenu parent/renderer with a persistent hook + element
 * adapter. Covers the Android IME failure's collapsed-selection/missing-view
 * states; does not emulate an Android keyboard or establish native behavior.
 * Run: node scripts/test-listening-selection-capture.cjs
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
  ),
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.React,
      esModuleInterop: true,
    },
  },
).outputText

class Rect {
  constructor(x, y, width, height) {
    Object.assign(this, {
      x,
      y,
      width,
      height,
      left: x,
      top: y,
      right: x + width,
      bottom: y + height,
    })
  }
}

function fixture({ annotation = false } = {}) {
  const initialAnchor = new Rect(20, 70, 120, 22)
  let containerRect = new Rect(0, 40, 390, 620)
  let viewRect = new Rect(0, 40, 390, 620)
  let rangesAvailable = true
  let sourceText = 'A paragraph selected before opening the keyboard.'
  let currentCFI = 'captured-cfi'
  let cfiCalls = 0
  const sourceRange = {
    endContainer: { parentElement: {} },
    startContainer: { parentElement: {} },
    cloneRange() {
      return { ...this }
    },
    cloneContents() {
      return { textContent: sourceText }
    },
    getClientRects() {
      return rangesAvailable ? [initialAnchor] : []
    },
  }
  let selection = {
    isCollapsed: false,
    rangeCount: 1,
    getRangeAt() {
      if (!this.rangeCount) throw new Error('Selection no longer has a range')
      return sourceRange
    },
    removeAllRanges() {
      this.isCollapsed = true
      this.rangeCount = 0
    },
  }
  const selectionTemplate = selection
  const win = { getSelection: () => selection }
  const element = {
    parentElement: { getBoundingClientRect: () => containerRect },
    getBoundingClientRect: () => viewRect,
  }
  const sourceView = { window: win, element }
  const rendition = { manager: { views: { _views: [sourceView] } } }
  const calls = { annotations: [], dismissed: 0, overlay: [] }
  const tab = {
    id: 'alice',
    rendition,
    book: {
      id: 'alice',
      annotations: annotation ? [{ cfi: currentCFI, notes: 'existing' }] : [],
    },
    annotationRange: annotation ? sourceRange : undefined,
    rangeToCfi() {
      cfiCalls++
      if (!rendition.manager.views._views.length)
        throw new Error('No live rendition view')
      return currentCFI
    },
    isDefined: () => false,
    putAnnotation: (...args) => calls.annotations.push(args),
    runtimePolicy: { isActive: () => true, isDisposed: () => false },
    setSourceOverlay: (type, dismiss) => calls.overlay.push({ type, dismiss }),
    clearSourceOverlay() {},
  }
  if (annotation) selection.removeAllRanges()
  let hookContext
  const parentHooks = []
  let childHooks = []
  let childKey
  function useSlot(initial) {
    const index = hookContext.index++
    if (!(index in hookContext.slots)) hookContext.slots[index] = initial()
    return [hookContext.slots[index], index]
  }
  const react = {
    useRef(initial) {
      return useSlot(() => ({ current: initial }))[0]
    },
    useState(initial) {
      const [slot] = useSlot(() => ({ value: initial }))
      return [
        slot.value,
        (next) => {
          slot.value = typeof next === 'function' ? next(slot.value) : next
        },
      ]
    },
    useCallback(callback, dependencies) {
      const [slot] = useSlot(() => ({ callback, dependencies }))
      if (dependencies.some((item, i) => slot.dependencies[i] !== item))
        Object.assign(slot, { callback, dependencies })
      return slot.callback
    },
    useEffect(effect, dependencies) {
      const [slot] = useSlot(() => ({
        dependencies: undefined,
        cleanup: undefined,
      }))
      if (
        !slot.dependencies ||
        dependencies.some((item, i) => slot.dependencies[i] !== item)
      ) {
        slot.cleanup?.()
        slot.cleanup = effect()
        slot.dependencies = dependencies
      }
    },
    createElement(type, props, ...children) {
      return { type, props: { ...props, children: children.flat(Infinity) } }
    },
  }
  const setSelection = (next) => {
    selection = next
  }
  const modules = {
    react,
    '@literal-ui/core': { Overlay: 'Overlay' },
    clsx: () => '',
    'react-focus-lock': 'FocusLock',
    'react-icons/md': {},
    valtio: { useSnapshot: (value) => value },
    '../annotation': { typeMap: {}, colorMap: {} },
    '../hooks': {
      useTextSelection: () => [selection, setSelection],
      useSetAction: () => () => {},
      useMobile: () => true,
      useTranslation: () => (key) => key,
      useTypography: () => ({}),
      isForwardSelection: () => true,
    },
    '../listening/chapters': {},
    '../listening/document': {},
    '../listening/integrated': {},
    '../models': { reader: {} },
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
    DOMRect: Rect,
    Error,
    getComputedStyle: () => ({ lineHeight: '22px' }),
    require(name) {
      if (!(name in modules)) throw new Error('Unexpected import ' + name)
      return modules[name]
    },
  }
  vm.runInNewContext(code, context, { filename: 'TextSelectionMenu.tsx' })
  function nodes(root) {
    if (!root || typeof root !== 'object') return []
    return [root, ...(root.props?.children || []).flatMap(nodes)]
  }
  let descriptor, tree
  function render() {
    hookContext = { slots: parentHooks, index: 0 }
    descriptor = context.exports.TextSelectionMenu({ tab })
    if (!descriptor) {
      tree = null
      return null
    }
    if (childKey !== descriptor.props.key) {
      childHooks = []
      childKey = descriptor.props.key
    }
    hookContext = { slots: childHooks, index: 0 }
    tree = descriptor.type(descriptor.props)
    return descriptor
  }
  return {
    tab,
    calls,
    render,
    get descriptor() {
      return descriptor
    },
    get cfiCalls() {
      return cfiCalls
    },
    get nodes() {
      return nodes(tree)
    },
    collapseSelection() {
      selection.removeAllRanges()
      rangesAvailable = false
    },
    removeView() {
      rendition.manager.views._views = []
    },
    restoreView() {
      rendition.manager.views._views = [sourceView]
    },
    resize(height) {
      containerRect = new Rect(0, 40, 390, height)
      viewRect = new Rect(0, 40, 390, height)
    },
    selectAgain() {
      currentCFI = 'new-cfi'
      sourceText = 'A later deliberate paragraph selection.'
      rangesAvailable = true
      selection = { ...selectionTemplate, isCollapsed: false, rangeCount: 1 }
    },
    annotate() {
      this.nodes
        .find(
          (node) =>
            node.type === 'IconButton' && node.props.title === 'annotate',
        )
        .props.onClick()
      render()
    },
    enterDraft(text) {
      const field = this.nodes.find(
        (node) => node.type === 'TextField' && node.props.as === 'textarea',
      )
      assert.ok(field, 'actual renderer should retain its note textarea')
      field.props.mRef.current = { value: text }
    },
    saveNote() {
      this.nodes
        .find(
          (node) =>
            node.type === 'Button' && node.props.children.includes('create'),
        )
        .props.onClick()
    },
  }
}

let passed = 0
function test(name, verify) {
  verify()
  passed++
  console.log('PASS ' + name)
}

test('capture clones the source Range, CFI, text and geometry once', () => {
  const h = fixture()
  const first = h.render()
  assert.equal(first.props.capturedCFI, 'captured-cfi')
  assert.equal(
    first.props.text,
    'A paragraph selected before opening the keyboard.',
  )
  assert.equal(first.props.capturedLineHeight, 22)
  assert.equal(h.cfiCalls, 1)
  h.render()
  assert.equal(h.cfiCalls, 1)
})

test('collapsed Selection and missing rendition keep the same renderer, CFI and note draft', () => {
  const h = fixture()
  const initial = h.render()
  h.annotate()
  h.enterDraft('Typed before the Android IME repaginates the book.')
  h.collapseSelection()
  h.removeView()
  const missing = h.render()
  assert.ok(missing)
  assert.equal(missing.type, initial.type)
  assert.equal(missing.props.key, initial.props.key)
  assert.equal(missing.props.range, initial.props.range)
  assert.equal(missing.props.capturedCFI, 'captured-cfi')
  assert.equal(h.cfiCalls, 1)
  h.restoreView()
  h.resize(280)
  const restored = h.render()
  assert.equal(restored.props.containerRect.height, 280)
  assert.equal(restored.props.key, initial.props.key)
  h.saveNote()
  assert.equal(h.calls.annotations.length, 1)
  assert.equal(h.calls.annotations[0][1], 'captured-cfi')
  assert.equal(
    h.calls.annotations[0][4],
    'Typed before the Android IME repaginates the book.',
  )
})

test('explicit dismissal clears captured data and cannot reopen from the collapsed Selection', () => {
  const h = fixture()
  const initial = h.render()
  h.collapseSelection()
  h.removeView()
  h.render().props.hide()
  assert.equal(h.render(), null)
  h.restoreView()
  assert.equal(h.render(), null)
  h.selectAgain()
  const next = h.render()
  assert.equal(next.props.capturedCFI, 'new-cfi')
  assert.notEqual(next.props.range, initial.props.range)
})

test('existing annotation editor also survives a missing view and dismisses its captured range', () => {
  const h = fixture({ annotation: true })
  const initial = h.render()
  assert.ok(
    h.nodes.some(
      (node) => node.type === 'TextField' && node.props.as === 'textarea',
    ),
  )
  h.removeView()
  const missing = h.render()
  assert.equal(missing.props.key, initial.props.key)
  assert.equal(h.cfiCalls, 1)
  missing.props.hide()
  assert.equal(h.tab.annotationRange, undefined)
  assert.equal(h.render(), null)
})

test('a missing view before the first capture does not create a stale editor', () => {
  const h = fixture()
  h.removeView()
  assert.equal(h.render(), null)
  assert.equal(h.cfiCalls, 0)
  h.restoreView()
  assert.equal(h.render().props.capturedCFI, 'captured-cfi')
})

console.log(`${passed}/${passed} Listening selection capture groups passed.`)
