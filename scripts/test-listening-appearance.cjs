/* Unit checks for the real appearance resolver. No browser or speech claims. */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const source = fs.readFileSync(
  path.resolve(__dirname, '../apps/reader/src/listening/appearance.ts'),
  'utf8',
)
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.CommonJS,
  },
}).outputText
const saved = new Map()
let systemDark = false
const context = {
  exports: {},
  localStorage: { getItem: (key) => saved.get(key) ?? null },
  matchMedia: () => ({ matches: systemDark }),
}
vm.runInNewContext(compiled, context, { filename: 'appearance.ts' })
const {
  normalizeListeningAppearance,
  resolveListeningAppearance,
  savedReaderAppearance,
} = context.exports
let passed = 0
function test(name, verify) {
  verify()
  passed += 1
  console.log('PASS ' + name)
}
const reading = { preset: 'reading', theme: 'reading' }

test('unknown or missing preset/theme choices normalize independently to safe defaults', () => {
  assert.equal(normalizeListeningAppearance().preset, 'comfortable')
  assert.equal(normalizeListeningAppearance(null).theme, 'light')
  assert.equal(
    normalizeListeningAppearance({ preset: 'unknown', theme: 'dark' }).preset,
    'comfortable',
  )
  assert.equal(
    normalizeListeningAppearance({ preset: 'large', theme: 'unknown' }).theme,
    'light',
  )
  for (const preset of ['comfortable', 'large', 'compact', 'reading'])
    assert.equal(
      normalizeListeningAppearance({ preset, theme: 'sepia' }).preset,
      preset,
    )
})
test('explicit presets keep their own readable size and spacing instead of inheriting unrelated reader values', () => {
  const expected = {
    comfortable: [22, 1.75],
    large: [28, 1.85],
    compact: [18, 1.55],
  }
  for (const [preset, [size, spacing]] of Object.entries(expected)) {
    const result = resolveListeningAppearance(
      { preset, theme: 'light' },
      {
        fontSize: '48px',
        lineHeight: 2.5,
        fontWeight: 900,
        fontFamily: 'Reader font',
      },
    )
    assert.equal(result.fontSize, size)
    assert.equal(result.lineHeight, spacing)
    assert.equal(result.fontWeight, 400)
    assert.notEqual(result.fontFamily, 'Reader font')
  }
})
test('reading appearance merges per-book values over global values and preserves global fields when book values are undefined', () => {
  const result = resolveListeningAppearance(
    reading,
    {
      fontSize: '20px',
      lineHeight: 1.6,
      fontWeight: 500,
      fontFamily: 'Global font',
    },
    {
      fontSize: '30px',
      lineHeight: undefined,
      fontWeight: 700,
      fontFamily: undefined,
    },
  )
  assert.equal(result.fontSize, 30)
  assert.equal(result.lineHeight, 1.6)
  assert.equal(result.fontWeight, 700)
  assert.equal(result.fontFamily, 'Global font')
})
test('reader font sizes accept px, case-insensitive rem/em, percentages and unitless values with a 16px base', () => {
  for (const [size, expected] of [
    ['24px', 24],
    ['24PX', 24],
    ['1.5rem', 24],
    ['1.5REM', 24],
    ['1.5em', 24],
    ['150%', 24],
    ['24', 24],
    [' 24 px ', 24],
  ])
    assert.equal(
      resolveListeningAppearance(reading, { fontSize: size }).fontSize,
      expected,
      size,
    )
})
test('invalid font sizes fall back and extreme supported sizes clamp to a readable range', () => {
  for (const size of ['bad', 'calc(10px)', '-2px', '20vh', '', NaN, Infinity])
    assert.equal(
      resolveListeningAppearance(reading, { fontSize: size }).fontSize,
      22,
      String(size),
    )
  for (const [size, expected] of [
    ['0px', 16],
    ['1px', 16],
    ['500%', 48],
    ['100rem', 48],
    ['0.5rem', 16],
  ])
    assert.equal(
      resolveListeningAppearance(reading, { fontSize: size }).fontSize,
      expected,
      size,
    )
})
test('line height and font weight use finite fallbacks and bounded values', () => {
  const low = resolveListeningAppearance(reading, {
    lineHeight: 0.1,
    fontWeight: 1,
  })
  assert.equal(low.lineHeight, 1.2)
  assert.equal(low.fontWeight, 100)
  const high = resolveListeningAppearance(reading, {
    lineHeight: 7,
    fontWeight: 1400,
  })
  assert.equal(high.lineHeight, 2.5)
  assert.equal(high.fontWeight, 900)
  for (const invalid of [NaN, Infinity, 'invalid']) {
    const result = resolveListeningAppearance(reading, {
      lineHeight: invalid,
      fontWeight: invalid,
    })
    assert.equal(result.lineHeight, 1.75)
    assert.equal(result.fontWeight, 400)
  }
})
test('reading light/dark inheritance is independent of preset and explicit theme overrides system appearance', () => {
  assert.equal(resolveListeningAppearance(reading, {}, {}, true).theme, 'dark')
  assert.equal(
    resolveListeningAppearance(reading, {}, {}, false).theme,
    'light',
  )
  assert.equal(
    resolveListeningAppearance(
      { preset: 'large', theme: 'reading' },
      {},
      {},
      true,
    ).theme,
    'dark',
  )
  assert.equal(
    resolveListeningAppearance(
      { preset: 'reading', theme: 'light' },
      {},
      {},
      true,
    ).theme,
    'light',
  )
  assert.equal(
    resolveListeningAppearance(
      { preset: 'reading', theme: 'sepia' },
      {},
      {},
      true,
    ).theme,
    'sepia',
  )
})
test('resolved appearance is detached and does not mutate frozen choices or stored reader settings', () => {
  const choice = Object.freeze({ ...reading })
  const global = Object.freeze({
    fontSize: '22px',
    lineHeight: 1.5,
    fontFamily: 'Global font',
  })
  const book = Object.freeze({ fontSize: '26px', fontWeight: 600 })
  const before = JSON.stringify([choice, global, book])
  const result = resolveListeningAppearance(choice, global, book, true)
  result.fontSize = 48
  assert.equal(JSON.stringify([choice, global, book]), before)
  assert.equal(
    resolveListeningAppearance(choice, global, book, true).fontSize,
    26,
  )
  assert.notEqual(normalizeListeningAppearance(choice), choice)
})
test('saved reading appearance respects light/dark/system preference and tolerates malformed settings JSON', () => {
  saved.set('settings', JSON.stringify({ fontSize: '23px' }))
  saved.set('literal-color-scheme', JSON.stringify('dark'))
  assert.equal(savedReaderAppearance().dark, true)
  assert.equal(savedReaderAppearance().settings.fontSize, '23px')
  saved.set('literal-color-scheme', JSON.stringify('light'))
  systemDark = true
  assert.equal(savedReaderAppearance().dark, false)
  saved.set('literal-color-scheme', JSON.stringify('system'))
  assert.equal(savedReaderAppearance().dark, true)
  saved.set('settings', 'malformed')
  assert.doesNotThrow(() => savedReaderAppearance())
})
console.log(`${passed}/${passed} listening appearance groups passed.`)
