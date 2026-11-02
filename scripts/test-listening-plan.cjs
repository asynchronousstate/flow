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
const {
  captureListeningPlan,
  defaultListeningStart,
  displayListeningChapterReference,
  reconcileListeningPlan,
} = context.exports

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

test('a manual Chapter beginning choice survives a new cross-window Bookmark while its preview updates', () => {
  const draft = {
    ...base,
    startAt: 'chapter',
    from: 'local-from',
    through: 'local-through',
  }
  const incoming = { ...base, marker: bookmarkA, updatedAt: 21 }
  const result = reconcileListeningPlan(
    draft,
    incoming,
    captureListeningPlan(base),
    { preserveStartChoice: true, bookmarkAvailable: true },
  )
  assert.equal(result.changed, true)
  assert.equal(result.draft.startAt, 'chapter')
  assert.deepEqual(copy(result.draft.marker), bookmarkA)
  assert.equal(result.draft.from, 'local-from')
  assert.equal(result.draft.through, 'local-through')
})

test('Undo keeps a manual Bookmark choice when its restored Bookmark is still valid', () => {
  const incoming = {
    ...base,
    marker: bookmarkA,
    startAt: 'chapter',
    updatedAt: 21,
  }
  const result = reconcileListeningPlan(
    base,
    incoming,
    captureListeningPlan(base),
    { preserveStartChoice: true, bookmarkAvailable: true },
  )
  assert.equal(result.changed, true)
  assert.equal(result.draft.startAt, 'marker')
  assert.deepEqual(copy(result.draft.marker), bookmarkA)
})

test('a removed or stale Bookmark falls back to Chapter beginning even after a manual Bookmark choice', () => {
  for (const marker of [undefined, bookmarkA]) {
    const incoming = { ...base, marker, updatedAt: 21 }
    const result = reconcileListeningPlan(
      base,
      incoming,
      captureListeningPlan(base),
      { preserveStartChoice: true, bookmarkAvailable: false },
    )
    assert.equal(result.changed, true)
    assert.equal(result.draft.startAt, 'chapter')
    assert.equal(result.draft.from, base.from)
    assert.equal(result.draft.through, base.through)
  }
})

test('fresh opening defaults to a valid saved Bookmark despite the previously persisted Chapter beginning mode', () => {
  const stored = { ...base, startAt: 'chapter' }
  const before = copy(stored)
  const result = defaultListeningStart(stored, true, true)
  assert.equal(result.startAt, 'marker')
  assert.equal(result.marker, stored.marker)
  assert.equal(result.updatedAt, stored.updatedAt)
  assert.equal(result.from, stored.from)
  assert.equal(result.through, stored.through)
  assert.deepEqual(stored, before)
})

test('rerenders and return from a current preview preserve Chapter beginning; explicit reopening defaults anew', () => {
  const manuallyChosen = { ...base, startAt: 'chapter' }
  const returned = defaultListeningStart(manuallyChosen, true, false)
  assert.equal(returned, manuallyChosen)
  assert.equal(defaultListeningStart(returned, true, false), manuallyChosen)
  const reopened = defaultListeningStart(returned, true, true)
  assert.equal(reopened.startAt, 'marker')
  assert.equal(reopened.updatedAt, manuallyChosen.updatedAt)
})

test('missing or stale saved Bookmarks cannot be selected by a fresh opening or rerender', () => {
  for (const marker of [undefined, bookmarkB]) {
    const draft = { ...base, marker }
    for (const fresh of [false, true]) {
      const result = defaultListeningStart(draft, false, fresh)
      assert.equal(result.startAt, 'chapter')
      assert.equal(result.marker, marker)
      assert.equal(result.updatedAt, draft.updatedAt)
    }
  }
})

test('a valid Bookmark outside the chosen range remains selected without silently moving either endpoint', () => {
  const draft = {
    ...base,
    startAt: 'chapter',
    from: 'chapter-4.xhtml',
    through: 'chapter-5.xhtml',
  }
  const result = defaultListeningStart(draft, true, true)
  assert.equal(result.startAt, 'marker')
  assert.equal(result.from, 'chapter-4.xhtml')
  assert.equal(result.through, 'chapter-5.xhtml')
  assert.equal(result.marker, bookmarkB)
})

test('a whole-file legacy reference displays its equivalent TOC chapter without changing stored endpoints', () => {
  const chapter = {
    id: 'toc-pool',
    disabled: false,
    start: { sectionIndex: 2, offset: 0 },
    end: { sectionIndex: 3, offset: 0 },
  }
  const legacy = { start: { ...chapter.start }, end: { ...chapter.end } }
  const stored = { ...base, from: 'chapter-2.xhtml', through: 'toc-pool' }
  const before = copy(stored)
  assert.equal(
    displayListeningChapterReference(stored.from, legacy, [chapter]),
    'toc-pool',
  )
  assert.equal(
    displayListeningChapterReference(stored.through, legacy, [chapter]),
    'toc-pool',
  )
  assert.deepEqual(stored, before)
})

test('a legacy whole-file range stays distinct from partial fragment chapters sharing its file', () => {
  const chapters = [
    {
      id: 'toc-first',
      disabled: false,
      start: { sectionIndex: 2, offset: 0 },
      end: { sectionIndex: 2, offset: 50 },
    },
    {
      id: 'toc-last',
      disabled: false,
      start: { sectionIndex: 2, offset: 50 },
      end: { sectionIndex: 3, offset: 0 },
    },
  ]
  const legacy = {
    start: { sectionIndex: 2, offset: 0 },
    end: { sectionIndex: 3, offset: 0 },
  }
  assert.equal(
    displayListeningChapterReference('chapter-2.xhtml', legacy, chapters),
    'chapter-2.xhtml',
  )
  assert.equal(
    displayListeningChapterReference('toc-last', legacy, chapters),
    'toc-last',
  )
})

test('unavailable or incomplete TOC entries cannot hide a valid legacy selection', () => {
  const legacy = {
    start: { sectionIndex: 2, offset: 0 },
    end: { sectionIndex: 3, offset: 0 },
  }
  const chapters = [
    { id: 'disabled', disabled: true, ...legacy },
    { id: 'incomplete', disabled: false, start: legacy.start },
  ]
  assert.equal(
    displayListeningChapterReference('chapter-2.xhtml', legacy, chapters),
    'chapter-2.xhtml',
  )
  assert.equal(
    displayListeningChapterReference(
      'chapter-2.xhtml',
      { start: legacy.start },
      [],
    ),
    'chapter-2.xhtml',
  )
})

console.log('17/17 listening plan reconciliation groups passed.')
