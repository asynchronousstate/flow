/* Run: node scripts/test-touch-gestures.cjs
 * Executes the real hook with controlled React effect/document boundaries.
 * These are gesture-handler unit tests, not browser scroll/layout tests.
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const ts = require('typescript')

const sourcePath = path.resolve(
  __dirname,
  '../apps/reader/src/hooks/useDisablePinchZooming.ts',
)
const compiled = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
  compilerOptions: {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.CommonJS,
  },
}).outputText

function documentTarget() {
  const listeners = new Set()
  const registrations = []
  const removals = []
  return {
    listeners,
    registrations,
    removals,
    addEventListener(type, handler, options) {
      assert.equal(type, 'touchmove')
      listeners.add(handler)
      registrations.push({ handler, options })
    },
    removeEventListener(type, handler) {
      assert.equal(type, 'touchmove')
      removals.push(handler)
      listeners.delete(handler)
    },
    move(touchCount, cancelable = true) {
      const event = {
        touches: Array.from({ length: touchCount }, (_, identifier) => ({
          identifier,
        })),
        cancelable,
        defaultPrevented: false,
        preventDefaultCalls: 0,
        preventDefault() {
          this.preventDefaultCalls++
          if (this.cancelable) this.defaultPrevented = true
        },
      }
      for (const handler of listeners) handler(event)
      return event
    },
  }
}

function loadHook() {
  const main = { document: documentTarget() }
  const effects = []
  const module = { exports: {} }
  const run = new vm.Script(
    `(function(require, module, exports) {\n${compiled}\n})`,
    {
      filename: sourcePath,
    },
  ).runInNewContext({ window: main })
  run(
    (name) => {
      assert.equal(name, 'react', 'Hook unexpectedly gained another dependency')
      return {
        useEffect(effect) {
          effects.push(effect)
        },
      }
    },
    module,
    module.exports,
  )
  return {
    main,
    mount(target, options) {
      module.exports.useDisablePinchZooming(target, options)
      assert.equal(effects.length, 1)
      const cleanup = effects.shift()()
      assert.equal(typeof cleanup, 'function')
      return cleanup
    },
  }
}

function allowed(event, description) {
  assert.equal(event.preventDefaultCalls, 0, description)
  assert.equal(event.defaultPrevented, false, description)
}

const cases = [
  [
    'single-finger drag and post-pinch continuation remain native-scrollable',
    () => {
      const { main, mount } = loadHook()
      const cleanup = mount()
      for (let move = 0; move < 3; move++)
        allowed(main.document.move(1), 'Ordinary drag was canceled')
      assert.equal(main.document.move(2).defaultPrevented, true)
      allowed(
        main.document.move(1),
        'One-finger continuation after pinch was canceled',
      )
      allowed(
        main.document.move(1),
        'Subsequent independent scroll was canceled',
      )
      allowed(main.document.move(0), 'Empty touch state should not cancel')
      cleanup()
    },
  ],
  [
    'only cancelable multi-touch movement is canceled',
    () => {
      const { main, mount } = loadHook()
      const cleanup = mount()
      assert.equal(main.document.registrations[0].options.passive, false)
      for (const count of [2, 3]) {
        const event = main.document.move(count)
        assert.equal(
          event.preventDefaultCalls,
          1,
          'Cancelable pinch was not handled once',
        )
        assert.equal(event.defaultPrevented, true)
      }
      allowed(
        main.document.move(2, false),
        'preventDefault called on noncancelable event',
      )
      allowed(
        main.document.move(1, false),
        'Noncancelable one-finger movement was touched',
      )
      cleanup()
    },
  ],
  [
    'cleanup removes the exact listener and does not accumulate on remount',
    () => {
      const { main, mount } = loadHook()
      const cleanup = mount()
      assert.equal(main.document.listeners.size, 1)
      cleanup()
      assert.equal(main.document.listeners.size, 0)
      assert.equal(
        main.document.removals[0],
        main.document.registrations[0].handler,
      )
      allowed(main.document.move(2), 'Unmounted hook still canceled movement')
      const cleanupAgain = mount()
      assert.equal(main.document.listeners.size, 1)
      assert.equal(
        main.document.move(2).preventDefaultCalls,
        1,
        'Remount accumulated listeners',
      )
      cleanupAgain()
    },
  ],
  [
    'explicit iframe target is isolated and cleaned up when the target changes',
    () => {
      const { main, mount } = loadHook()
      const iframe = { document: documentTarget() }
      const cleanupMain = mount()
      cleanupMain() // React cleans the old effect before rerunning for a new win.
      const cleanupFrame = mount(iframe)
      assert.equal(main.document.listeners.size, 0)
      assert.equal(iframe.document.listeners.size, 1)
      allowed(
        main.document.move(2),
        'Iframe hook attached to the top-level document',
      )
      allowed(
        iframe.document.move(1),
        'Iframe one-finger movement was canceled',
      )
      assert.equal(iframe.document.move(2).defaultPrevented, true)
      cleanupFrame()
      assert.equal(iframe.document.listeners.size, 0)
      assert.equal(
        iframe.document.removals[0],
        iframe.document.registrations[0].handler,
      )
      allowed(iframe.document.move(2), 'Iframe listener survived cleanup')
    },
  ],
  [
    'iframe preventPan preserves reader-owned swipes without locking the outer document',
    () => {
      const { main, mount } = loadHook()
      const iframe = { document: documentTarget() }
      const cleanupMain = mount()
      const cleanupLoadingFrame = mount(undefined, { preventPan: false })
      allowed(
        main.document.move(1),
        'Missing reader iframe blocked outer scrolling during loading',
      )
      cleanupLoadingFrame()
      assert.equal(main.document.listeners.size, 1)
      const cleanupFrame = mount(iframe, { preventPan: true })
      allowed(main.document.move(1), 'Reader option blocked outer scrolling')
      for (const count of [1, 2, 1]) {
        const event = iframe.document.move(count)
        assert.equal(event.preventDefaultCalls, 1)
        assert.equal(event.defaultPrevented, true)
      }
      allowed(
        iframe.document.move(1, false),
        'Reader option called preventDefault on a noncancelable pan',
      )
      allowed(
        iframe.document.move(2, false),
        'Reader option called preventDefault on a noncancelable pinch',
      )
      cleanupFrame()
      allowed(iframe.document.move(1), 'Reader pan listener survived cleanup')
      const cleanupNativeFrame = mount(iframe, { preventPan: false })
      allowed(
        iframe.document.move(1),
        'Disabling preventPan retained old behavior',
      )
      assert.equal(iframe.document.move(2).preventDefaultCalls, 1)
      cleanupNativeFrame()
      cleanupMain()
    },
  ],
]

console.log('Real-hook gesture unit tests; no browser or layout simulation.')
for (const [name, verify] of cases) {
  verify()
  console.log('PASS ' + name)
}
console.log(`${cases.length}/${cases.length} gesture tests passed.`)
