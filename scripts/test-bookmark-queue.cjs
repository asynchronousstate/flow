/* Run: node scripts/test-bookmark-queue.cjs
 * Exercises the real coordinator with controlled storage promises. These are
 * ordering / recovery unit tests, not browser or native narration evidence.
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const source = fs.readFileSync(
  path.resolve(__dirname, '../apps/reader/src/listening/bookmark-queue.ts'),
  'utf8',
)
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.CommonJS,
  },
}).outputText
const context = { exports: {} }
vm.runInNewContext(compiled, context, { filename: 'bookmark-queue.ts' })
const { createBookmarkQueue } = context.exports
const copy = (value) => JSON.parse(JSON.stringify(value))
const tick = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve()
}

function fixture({
  initial = 'A',
  empty = false,
  recover = true,
  observerThrows = false,
  selectionReader,
} = {}) {
  if (empty) initial = undefined
  let record = {
    selection: initial,
    revision: 1,
    from: 'chapter-three',
    through: 'chapter-four',
    appearance: 'sepia',
  }
  const calls = []
  const events = []
  const pending = []
  let active = 0
  let maximumActive = 0
  const storageGate = async (kind, selection) => {
    active++
    maximumActive = Math.max(maximumActive, active)
    try {
      calls.push({ kind, selection })
      await new Promise((resolve, reject) => pending.push({ resolve, reject }))
    } finally {
      active--
    }
  }
  const queue = createBookmarkQueue({
    initialSelection: initial,
    sameSelection: (left, right) => left === right,
    save: async (selection) => {
      await storageGate('save', selection)
      const previous = copy(record)
      record = { ...record, selection, revision: record.revision + 1 }
      return { record: copy(record), previous }
    },
    restore: async (change) => {
      await storageGate('undo', change.previous.selection)
      assert.deepEqual(record, copy(change.record), 'expected-record CAS')
      record = { ...copy(change.previous), revision: record.revision + 1 }
      return copy(record)
    },
    selectionFromRecord: selectionReader || ((next) => next.selection),
    recover: recover ? async () => copy(record) : undefined,
    onChange: (snapshot) => {
      events.push({ ...snapshot })
      if (observerThrows) throw new Error('View is no longer rendering')
    },
  })
  return {
    queue,
    calls,
    events,
    get record() {
      return record
    },
    get maximumActive() {
      return maximumActive
    },
    external(change) {
      record = { ...record, ...change, revision: record.revision + 1 }
    },
    async finish(error) {
      assert.ok(pending.length, 'storage operation has started')
      const next = pending.shift()
      if (error) next.reject(error)
      else next.resolve()
      await tick()
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
  await test('rapid A to B to C remains optimistic while every write runs in order', async () => {
    const f = fixture()
    f.queue.select('B')
    f.queue.select('C')
    assert.equal(f.queue.getSnapshot().selection, 'C')
    assert.equal(f.queue.getSnapshot().pending, true)
    assert.equal(f.queue.getSnapshot().canUndo, true)
    assert.equal(f.events.length, 2)
    await tick()
    assert.deepEqual(f.calls, [{ kind: 'save', selection: 'B' }])
    await f.finish()
    assert.equal(f.queue.getSnapshot().selection, 'C')
    assert.equal(f.queue.getSnapshot().pending, true)
    assert.equal(f.events.length, 2, 'stale B completion cannot repaint C')
    await f.finish()
    await f.queue.settled()
    assert.equal(f.record.selection, 'C')
    assert.equal(f.queue.getSnapshot().status, 'saved')
    assert.equal(f.maximumActive, 1)
    assert.deepEqual(
      f.calls.map((call) => call.selection),
      ['B', 'C'],
    )
  })

  await test('Undo before C commits waits for C then uses its atomic previous plan', async () => {
    const f = fixture()
    f.queue.select('B')
    f.queue.select('C')
    assert.equal(f.queue.undo(), true)
    assert.equal(f.queue.getSnapshot().selection, 'B')
    assert.equal(f.queue.getSnapshot().canUndo, false)
    await tick()
    await f.finish()
    await f.finish()
    assert.equal(f.record.selection, 'C')
    assert.deepEqual(f.calls[2], { kind: 'undo', selection: 'B' })
    await f.finish()
    await f.queue.settled()
    assert.equal(f.record.selection, 'B')
    assert.equal(f.record.from, 'chapter-three')
    assert.equal(f.record.through, 'chapter-four')
    assert.equal(f.record.appearance, 'sepia')
    assert.equal(f.queue.getSnapshot().selection, 'B')
    assert.equal(f.queue.getSnapshot().status, 'saved')
  })

  await test('a new selection during queued Undo wins and gets its own Undo', async () => {
    const f = fixture()
    f.queue.select('B')
    f.queue.select('C')
    f.queue.undo()
    f.queue.select('D')
    assert.equal(f.queue.getSnapshot().selection, 'D')
    assert.equal(f.queue.getSnapshot().canUndo, true)
    await tick()
    for (let i = 0; i < 4; i++) await f.finish()
    assert.equal(f.record.selection, 'D')
    assert.equal(f.queue.getSnapshot().selection, 'D')
    assert.equal(f.queue.undo(), true)
    assert.equal(f.queue.getSnapshot().selection, 'B')
    await tick()
    await f.finish()
    assert.equal(f.record.selection, 'B')
    assert.equal(f.maximumActive, 1)
  })

  await test('a stale failed save does not roll back or disable the latest selection', async () => {
    const f = fixture()
    f.queue.select('B')
    f.queue.select('C')
    await tick()
    await f.finish(new Error('B failed'))
    assert.equal(f.queue.getSnapshot().selection, 'C')
    assert.equal(f.queue.getSnapshot().pending, true)
    assert.equal(f.queue.getSnapshot().canUndo, true)
    assert.equal(
      f.events.some((event) => event.status === 'error'),
      false,
    )
    await f.finish()
    assert.equal(f.record.selection, 'C')
    f.queue.undo()
    await tick()
    await f.finish()
    assert.equal(
      f.record.selection,
      'A',
      'Undo restores actual prior storage, not failed B',
    )
    assert.equal(f.queue.getSnapshot().selection, 'A')
  })

  await test('the latest failed save reverts to confirmed state and clears unsafe Undo', async () => {
    const f = fixture()
    f.queue.select('B')
    f.queue.select('C')
    await tick()
    await f.finish()
    const failure = new Error('C failed')
    await f.finish(failure)
    const snapshot = f.queue.getSnapshot()
    assert.equal(snapshot.selection, 'B')
    assert.equal(snapshot.status, 'error')
    assert.equal(snapshot.error, failure)
    assert.equal(snapshot.canUndo, false)
    assert.equal(snapshot.pending, false)
    assert.equal(f.queue.undo(), false)
    f.queue.select('D')
    await tick()
    await f.finish()
    assert.equal(f.record.selection, 'D', 'a failure does not poison the queue')
  })

  await test('Undo of a failed pending save needs no substitute write', async () => {
    const f = fixture()
    f.queue.select('B')
    f.queue.undo()
    await tick()
    await f.finish(new Error('B failed'))
    await f.queue.settled()
    assert.equal(f.record.selection, 'A')
    assert.equal(f.queue.getSnapshot().selection, 'A')
    assert.equal(f.queue.getSnapshot().status, 'saved')
    assert.deepEqual(f.calls, [{ kind: 'save', selection: 'B' }])
  })

  await test('CAS-rejected Undo recovers another tab’s newer full plan without overwriting it', async () => {
    const f = fixture()
    f.queue.select('B')
    await tick()
    await f.finish()
    f.external({
      selection: 'external',
      through: 'chapter-ten',
      appearance: 'dark',
    })
    const external = copy(f.record)
    f.queue.undo()
    assert.equal(
      f.queue.getSnapshot().selection,
      'A',
      'Undo preview is immediate',
    )
    await tick()
    await f.finish()
    assert.deepEqual(f.record, external)
    assert.equal(f.queue.getSnapshot().selection, 'external')
    assert.equal(f.queue.getSnapshot().status, 'error')
    assert.equal(f.queue.getSnapshot().canUndo, false)
  })

  await test('an external plan between two saves is the canonical Undo target', async () => {
    const f = fixture()
    f.queue.select('B')
    await tick()
    await f.finish()
    f.external({
      selection: 'external',
      from: 'chapter-five',
      through: 'chapter-nine',
    })
    f.queue.select('C')
    await tick()
    await f.finish()
    f.queue.undo()
    assert.equal(
      f.queue.getSnapshot().selection,
      'B',
      'local preview precedes canonical reconciliation',
    )
    await tick()
    await f.finish()
    assert.equal(f.record.selection, 'external')
    assert.equal(f.record.from, 'chapter-five')
    assert.equal(f.record.through, 'chapter-nine')
    assert.equal(f.queue.getSnapshot().selection, 'external')
  })

  await test('stale Undo rejection cannot repaint a newer queued save', async () => {
    const f = fixture()
    f.queue.select('B')
    await tick()
    await f.finish()
    f.external({ selection: 'external', through: 'chapter-nine' })
    f.queue.undo()
    f.queue.select('D')
    await tick()
    await f.finish()
    assert.equal(f.queue.getSnapshot().selection, 'D')
    assert.equal(f.queue.getSnapshot().status, 'saving')
    await f.finish()
    assert.equal(f.queue.getSnapshot().selection, 'D')
    assert.equal(f.record.selection, 'D')
    assert.equal(f.record.through, 'chapter-nine')
  })

  await test('idempotent taps never clear the selection or create storage writes', async () => {
    const f = fixture()
    assert.equal(f.queue.select('A'), false)
    assert.equal(f.queue.undo(), false)
    assert.equal(f.events.length, 0)
    f.queue.select('B')
    assert.equal(f.queue.select('B'), false)
    assert.equal(f.queue.getSnapshot().operation, 1)
    await tick()
    await f.finish()
    assert.equal(f.calls.length, 1)
    assert.equal(f.queue.getSnapshot().selection, 'B')
  })

  await test('disposing mutes view updates but flushes all previously accepted writes', async () => {
    const f = fixture()
    f.queue.select('B')
    f.queue.select('C')
    const before = f.events.length
    f.queue.dispose()
    assert.equal(f.queue.select('D'), false)
    assert.equal(f.queue.undo(), false)
    await tick()
    await f.finish()
    await f.finish()
    await f.queue.settled()
    assert.equal(f.events.length, before)
    assert.equal(f.record.selection, 'C')
  })

  await test('fresh book coordinators cannot receive the old disposed view’s completions', async () => {
    const old = fixture()
    old.queue.select('B')
    old.queue.dispose()
    const fresh = fixture({ initial: 'new-book' })
    fresh.queue.select('new-start')
    await tick()
    await old.finish()
    assert.equal(fresh.queue.getSnapshot().selection, 'new-start')
    await fresh.finish()
    assert.equal(old.record.selection, 'B')
    assert.equal(fresh.record.selection, 'new-start')
  })

  await test('an observer failure cannot interrupt accepted persistence or later actions', async () => {
    const f = fixture({ observerThrows: true })
    assert.equal(f.queue.select('B'), true)
    f.queue.select('C')
    await tick()
    await f.finish()
    await f.finish()
    await f.queue.settled()
    assert.equal(f.record.selection, 'C')
  })

  await test('without a recovery reader a failed write retains the last confirmed selection', async () => {
    const f = fixture({ recover: false })
    f.queue.select('B')
    await tick()
    await f.finish(new Error('Storage unavailable'))
    assert.equal(f.queue.getSnapshot().selection, 'A')
    assert.equal(f.queue.getSnapshot().status, 'error')
  })

  await test('settled waits for new operations accepted while an earlier drain is pending', async () => {
    const f = fixture()
    f.queue.select('B')
    let drained = false
    const waiting = f.queue.settled().then(() => {
      drained = true
    })
    f.queue.select('C')
    await tick()
    await f.finish()
    assert.equal(drained, false)
    await f.finish()
    await waiting
    assert.equal(drained, true)
    assert.equal(f.record.selection, 'C')
  })

  await test('a selection reader error does not poison later accepted persistence', async () => {
    const f = fixture({
      selectionReader: (record) => {
        if (record.selection === 'B') throw new Error('Locator no longer maps')
        return record.selection
      },
    })
    f.queue.select('B')
    await tick()
    await f.finish()
    assert.equal(f.queue.getSnapshot().status, 'error')
    f.queue.select('C')
    await tick()
    await f.finish()
    await f.queue.settled()
    assert.equal(f.record.selection, 'C')
    assert.equal(f.queue.getSnapshot().status, 'saved')
  })

  await test('Undo of the first Bookmark can restore no saved paragraph', async () => {
    const f = fixture({ empty: true })
    f.queue.select('B')
    f.queue.undo()
    assert.equal(f.queue.getSnapshot().selection, undefined)
    await tick()
    await f.finish()
    await f.finish()
    assert.equal(f.record.selection, undefined)
    assert.equal(f.queue.getSnapshot().selection, undefined)
  })

  console.log(`${passed}/${passed} Bookmark queue groups passed.`)
})().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
