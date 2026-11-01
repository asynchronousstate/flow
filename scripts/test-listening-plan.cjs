/* Run: node scripts/test-listening-plan.cjs
 * Executes the real plan reconciliation helper used by ListeningView.
 * These are cross-window draft-state unit tests, not emulator/UI evidence.
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const ts = require('typescript')

const source = fs.readFileSync(
  path.resolve(__dirname, '../apps/reader/src/listening/plan.ts'),
  'utf8',
)
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.CommonJS,
  },
}).outputText
const context = { exports: {} }
vm.runInNewContext(compiled, context, { filename: 'plan.ts' })
const { captureListeningPlan, reconcileListeningPlan } = context.exports

const bookmarkA = {
  sourceHref: 'chapter-2.xhtml',
  blockId: 'p-2',
  text: 'Earlier paragraph.',
  savedAt: 100,
  cfi: 'cfi-a',
}
const bookmarkB = {
  sourceHref: 'chapter-3.xhtml',
  blockId: 'p-3',
  text: 'Later paragraph.',
  savedAt: 200,
  cfi: 'cfi-b',
}
const base = {
  bookId: 'alice',
  fingerprint: 'same-epub',
  from: 'chapter-2.xhtml',
  through: 'chapter-4.xhtml',
  startAt: 'marker',
  marker: bookmarkB,
  returnCfi: 'reader-location',
  updatedAt: 20,
}
const copy = (value) => JSON.parse(JSON.stringify(value))
const test = (name, verify) => {
  verify()
  console.log('PASS ' + name)
}

test('Undo to an older bookmark follows the newer plan revision and retains draft range edits', () => {
  const draft = { ...base, from: 'chapter-1.xhtml', through: 'chapter-7.xhtml' }
  const restored = { ...base, marker: bookmarkA, updatedAt: 21 }
  const result = reconcileListeningPlan(
    draft,
    restored,
    captureListeningPlan(base),
  )
  assert.equal(result.changed, true)
  assert.deepEqual(copy(result.draft.marker), bookmarkA)
  assert.equal(result.draft.startAt, 'marker')
  assert.equal(result.draft.from, draft.from)
  assert.equal(result.draft.through, draft.through)
  assert.equal(result.draft.returnCfi, draft.returnCfi)
  assert.equal(result.applied.updatedAt, 21)
  assert.equal(draft.marker, bookmarkB)
})

test('Undo removing the first bookmark restores Chapter beginning instead of retaining a stale marker', () => {
  const restored = {
    ...base,
    marker: undefined,
    startAt: 'chapter',
    updatedAt: 21,
  }
  const result = reconcileListeningPlan(
    base,
    restored,
    captureListeningPlan(base),
  )
  assert.equal(result.changed, true)
  assert.equal(result.draft.marker, undefined)
  assert.equal(result.draft.startAt, 'chapter')
})

test('an explicit Chapter beginning change syncs even when the saved bookmark remains available', () => {
  const stored = { ...base, startAt: 'chapter', updatedAt: 21 }
  const result = reconcileListeningPlan(
    base,
    stored,
    captureListeningPlan(base),
  )
  assert.equal(result.changed, true)
  assert.equal(result.draft.startAt, 'chapter')
  assert.deepEqual(copy(result.draft.marker), bookmarkB)
})

test('unrelated range writes preserve unsaved local radio and range choices while advancing the revision', () => {
  const draft = {
    ...base,
    startAt: 'chapter',
    from: 'unsaved-from',
    through: 'unsaved-through',
  }
  const stored = {
    ...base,
    from: 'external-from',
    through: 'external-through',
    updatedAt: 21,
  }
  const result = reconcileListeningPlan(
    draft,
    stored,
    captureListeningPlan(base),
  )
  assert.equal(result.changed, false)
  assert.equal(result.draft, draft)
  assert.equal(result.applied.updatedAt, 21)
  const stale = reconcileListeningPlan(
    draft,
    { ...base, marker: bookmarkA },
    result.applied,
  )
  assert.equal(stale.changed, false)
  assert.equal(stale.draft, draft)
  assert.equal(stale.applied, result.applied)
})

test('equal or older database revisions cannot replay a stale bookmark after a picker save', () => {
  const saved = { ...base, marker: bookmarkB, updatedAt: 30 }
  const applied = captureListeningPlan(saved)
  for (const revision of [29, 30]) {
    const result = reconcileListeningPlan(
      saved,
      { ...base, marker: bookmarkA, updatedAt: revision },
      applied,
    )
    assert.equal(result.changed, false)
    assert.equal(result.draft, saved)
    assert.equal(result.applied, applied)
  }
  const undo = reconcileListeningPlan(
    saved,
    { ...base, marker: bookmarkA, updatedAt: 31 },
    applied,
  )
  assert.equal(undo.changed, true)
  assert.deepEqual(copy(undo.draft.marker), bookmarkA)
})

test('exact bookmark changes are detected even when locator and saved-at timestamp are unchanged', () => {
  const marker = {
    ...bookmarkB,
    text: 'Corrected exact paragraph.',
    cfi: 'corrected-cfi',
  }
  const result = reconcileListeningPlan(
    base,
    { ...base, marker, updatedAt: 21 },
    captureListeningPlan(base),
  )
  assert.equal(result.changed, true)
  assert.deepEqual(copy(result.draft.marker), marker)
  marker.text = 'A later mutation.'
  assert.equal(result.draft.marker.text, 'Corrected exact paragraph.')
})

test('another book or EPUB fingerprint cannot alter this draft or advance its applied revision', () => {
  const applied = captureListeningPlan(base)
  for (const change of [
    { bookId: 'another-book' },
    { fingerprint: 'replaced-epub' },
  ]) {
    const result = reconcileListeningPlan(
      base,
      { ...base, ...change, marker: bookmarkA, updatedAt: 99 },
      applied,
    )
    assert.equal(result.changed, false)
    assert.equal(result.draft, base)
    assert.equal(result.applied, applied)
  }
})

console.log('7/7 listening plan reconciliation groups passed.')
