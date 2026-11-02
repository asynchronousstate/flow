/* Real useMobile effect lifecycle with isolated Recoil roots and media observers.
 * Not an Android viewport, hydration-renderer or browser navigation test.
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const source = fs.readFileSync(
  path.resolve(__dirname, '../apps/reader/src/hooks/useMobile.ts'),
  'utf8',
)
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.CommonJS,
  },
}).outputText

function harness() {
  const effects = []
  const listeners = new Set()
  let match = true
  let currentRoot
  const media = {
    get matches() {
      return match
    },
    addEventListener(type, callback) {
      assert.equal(type, 'change')
      listeners.add(callback)
    },
    removeEventListener(type, callback) {
      assert.equal(type, 'change')
      assert.equal(listeners.delete(callback), true)
    },
  }
  const module = { exports: {} }
  const run = new vm.Script(
    `(function(require,module,exports){${compiled}\n})`,
  ).runInNewContext({
    window: {
      matchMedia(query) {
        assert.equal(query, '(max-width: 640px)')
        return media
      },
    },
  })
  run(
    (name) => {
      if (name === 'react')
        return {
          useEffect(effect) {
            effects.push(effect)
          },
        }
      if (name === 'recoil')
        return {
          atom(options) {
            assert.equal(options.default, undefined)
            return options.key
          },
          useRecoilState() {
            return [currentRoot.value, currentRoot.set]
          },
        }
      throw new Error(`Unexpected dependency: ${name}`)
    },
    module,
    module.exports,
  )
  return {
    listeners,
    root() {
      const root = { value: undefined, writes: 0 }
      root.set = (value) => {
        root.value = value
        root.writes++
      }
      return root
    },
    render(root) {
      currentRoot = root
      const beforeEffect = module.exports.useMobile()
      assert.equal(effects.length, 1)
      return { beforeEffect, commit: () => effects.shift()() }
    },
    viewport(value) {
      match = value
      for (const listener of listeners) listener({ matches: value })
    },
  }
}
let groups = 0
function test(name, verify) {
  verify()
  groups++
  console.log('PASS ' + name)
}

test('initial render stays undefined and the committed effect initializes the current mobile viewport', () => {
  const h = harness()
  const root = h.root()
  const render = h.render(root)
  assert.equal(render.beforeEffect, undefined)
  assert.equal(root.value, undefined)
  const cleanup = render.commit()
  assert.equal(root.value, true)
  cleanup()
})
test('a replacement RecoilRoot initializes after the previous reader has unmounted', () => {
  const h = harness()
  const first = h.root()
  h.render(first).commit()()
  h.viewport(false)
  const second = h.root()
  const render = h.render(second)
  assert.equal(render.beforeEffect, undefined)
  const cleanup = render.commit()
  assert.equal(second.value, false)
  assert.equal(h.listeners.size, 1)
  cleanup()
})
test('live viewport changes update mounted consumers and cleanup removes only the matching observer', () => {
  const h = harness()
  const first = h.root()
  const second = h.root()
  const removeFirst = h.render(first).commit()
  const removeSecond = h.render(second).commit()
  assert.equal(h.listeners.size, 2)
  h.viewport(false)
  assert.equal(first.value, false)
  assert.equal(second.value, false)
  removeFirst()
  const oldWrites = first.writes
  h.viewport(true)
  assert.equal(first.writes, oldWrites)
  assert.equal(second.value, true)
  assert.equal(h.listeners.size, 1)
  removeSecond()
  assert.equal(h.listeners.size, 0)
})
test('repeated reader remounts leave no stale observer and each root receives current dimensions', () => {
  const h = harness()
  for (let index = 0; index < 5; index++) {
    h.viewport(index % 2 === 0)
    const root = h.root()
    const cleanup = h.render(root).commit()
    assert.equal(root.value, index % 2 === 0)
    assert.equal(h.listeners.size, 1)
    cleanup()
    assert.equal(h.listeners.size, 0)
  }
})
console.log(`${groups}/${groups} mobile layout lifecycle groups passed.`)
