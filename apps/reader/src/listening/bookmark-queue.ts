export interface BookmarkChange<Record> {
  record: Record
  previous: Record
}

export interface BookmarkQueueSnapshot<Selection> {
  selection?: Selection
  pending: boolean
  canUndo: boolean
  /** User intent order, independent of the order in which storage completes. */
  operation: number
  action: 'save' | 'undo' | null
  status: 'idle' | 'saving' | 'saved' | 'error'
  error?: unknown
}

export interface BookmarkQueue<Selection> {
  select: (selection: Selection) => boolean
  undo: () => boolean
  getSnapshot: () => BookmarkQueueSnapshot<Selection>
  settled: () => Promise<void>
  /** Mutes this view; accepted writes drain while its JS context survives. */
  dispose: () => void
}

interface BookmarkQueueOptions<Selection, Record> {
  initialSelection?: Selection
  sameSelection: (
    left: Selection | undefined,
    right: Selection | undefined,
  ) => boolean
  save: (selection: Selection) => Promise<BookmarkChange<Record>>
  /** Must retain the store's expected-record / compare-and-swap protection. */
  restore: (change: BookmarkChange<Record>) => Promise<Record>
  selectionFromRecord: (record: Record) => Selection | undefined
  /** Refresh after a failed transaction or an Undo rejected by another tab. */
  recover?: () => Promise<Record | undefined>
  onChange: (snapshot: BookmarkQueueSnapshot<Selection>) => void
}

interface SaveOperation<Selection, Record> {
  id: number
  action: 'save'
  selection: Selection
  previousSelection?: Selection
  change?: BookmarkChange<Record>
}

interface UndoOperation<Selection, Record> {
  id: number
  action: 'undo'
  target: SaveOperation<Selection, Record>
}

/** One coordinator belongs to one loaded book. Every accepted action is queued;
 * selecting again never waits for storage, and stale completions cannot repaint
 * newer intent. Dispose silences the old view but still drains accepted writes.
 */
export function createBookmarkQueue<Selection, Record>(
  options: BookmarkQueueOptions<Selection, Record>,
): BookmarkQueue<Selection> {
  let active = true
  let confirmed = options.initialSelection
  let undoTarget: SaveOperation<Selection, Record> | undefined
  let tail: Promise<void> = Promise.resolve()
  let snapshot: BookmarkQueueSnapshot<Selection> = {
    selection: options.initialSelection,
    pending: false,
    canUndo: false,
    operation: 0,
    action: null,
    status: 'idle',
  }

  const getSnapshot = () => ({ ...snapshot })
  const notify = () => {
    if (!active) return
    // Storage ordering must not be interrupted by a view's notification error.
    try {
      options.onChange(getSnapshot())
    } catch {
      // The operation remains accepted even if its original view cannot render.
    }
  }

  async function execute(
    operation:
      | SaveOperation<Selection, Record>
      | UndoOperation<Selection, Record>,
  ) {
    let error: unknown
    let failed = false
    try {
      if (operation.action === 'save') {
        operation.change = await options.save(operation.selection)
        confirmed = options.selectionFromRecord(operation.change.record)
      } else if (operation.target.change) {
        // Use the atomic previous plan returned by this exact save, including
        // any intervening other-window state. Never recreate Undo as a save.
        const restored = await options.restore(operation.target.change)
        confirmed = options.selectionFromRecord(restored)
      }
      // A queued Undo of a save that failed has nothing to undo in storage.
    } catch (problem) {
      failed = true
      error = problem
      if (operation.action === 'save' && undoTarget === operation)
        undoTarget = undefined
      try {
        const recovered = await options.recover?.()
        if (recovered !== undefined)
          confirmed = options.selectionFromRecord(recovered)
      } catch {
        // Keep the last confirmed selection if storage cannot be read either.
      }
    }

    if (operation.id !== snapshot.operation) return
    snapshot = {
      selection: confirmed,
      pending: false,
      canUndo: !!undoTarget,
      operation: operation.id,
      action: operation.action,
      status: failed ? 'error' : 'saved',
      ...(failed ? { error } : {}),
    }
    notify()
  }

  const enqueue = (
    operation:
      | SaveOperation<Selection, Record>
      | UndoOperation<Selection, Record>,
  ) => {
    tail = tail.then(() => execute(operation))
  }

  function select(selection: Selection) {
    if (!active || options.sameSelection(snapshot.selection, selection))
      return false
    const operation: SaveOperation<Selection, Record> = {
      id: snapshot.operation + 1,
      action: 'save',
      selection,
      previousSelection: snapshot.selection,
    }
    undoTarget = operation
    snapshot = {
      selection,
      pending: true,
      canUndo: true,
      operation: operation.id,
      action: 'save',
      status: 'saving',
    }
    enqueue(operation)
    notify()
    return true
  }

  function undo() {
    if (!active || !undoTarget) return false
    const target = undoTarget
    const operation: UndoOperation<Selection, Record> = {
      id: snapshot.operation + 1,
      action: 'undo',
      target,
    }
    undoTarget = undefined
    snapshot = {
      selection: target.previousSelection,
      pending: true,
      canUndo: false,
      operation: operation.id,
      action: 'undo',
      status: 'saving',
    }
    enqueue(operation)
    notify()
    return true
  }

  async function settled() {
    let waiting: Promise<void>
    do {
      waiting = tail
      await waiting
    } while (waiting !== tail)
  }

  return {
    select,
    undo,
    getSnapshot,
    settled,
    dispose: () => {
      active = false
    },
  }
}
