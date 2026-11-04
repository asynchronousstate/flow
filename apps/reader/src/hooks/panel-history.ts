/** Same-document history for mobile overlays. It never changes reader data. */
export interface MobilePanelView {
  bookId?: string
  action?: string
  navbar: boolean
}

interface PanelEntry {
  version: 1
  route: string
  trail: MobilePanelView[]
}

export const PANEL_HISTORY_KEY = 'flowMobilePanels'

interface HistoryAdapter {
  readonly state: unknown
  pushState(data: unknown, unused: string): void
  replaceState(data: unknown, unused: string): void
  go(delta: number): void
}

function readEntry(state: unknown): PanelEntry | undefined {
  const entry = (state as Record<string, unknown> | null)?.[
    PANEL_HISTORY_KEY
  ] as PanelEntry | undefined
  if (
    entry?.version !== 1 ||
    typeof entry.route !== 'string' ||
    !Array.isArray(entry.trail) ||
    !entry.trail.length ||
    entry.trail.length > 4 ||
    entry.trail.some(
      (view) =>
        !view ||
        typeof view.navbar !== 'boolean' ||
        (view.action !== undefined && typeof view.action !== 'string') ||
        (view.bookId !== undefined && typeof view.bookId !== 'string'),
    )
  )
    return
  return entry
}

function sameView(left: MobilePanelView, right: MobilePanelView) {
  return (
    left.bookId === right.bookId &&
    left.action === right.action &&
    left.navbar === right.navbar
  )
}

export function sameRestoredPanel(
  restored: MobilePanelView,
  current: MobilePanelView,
) {
  return (
    restored.bookId === current.bookId && restored.action === current.action
  )
}

/** Keep Next's state fields and URL intact; Back/Forward only restore overlays. */
export function createMobilePanelHistory(
  history: HistoryAdapter,
  route: () => string,
  current: () => MobilePanelView,
  restoreView: (view: MobilePanelView) => void,
  opensNestedPanel: (
    current: MobilePanelView,
    next: MobilePanelView,
  ) => boolean = () => false,
) {
  let pending = false
  let initialized = false
  const scope = route()

  const write = (
    method: 'pushState' | 'replaceState',
    trail: MobilePanelView[],
  ) =>
    history[method](
      {
        ...(history.state as object),
        [PANEL_HISTORY_KEY]: { version: 1, route: scope, trail },
      },
      '',
    )

  function sync(view: MobilePanelView) {
    if (pending || route() !== scope) return
    let entry = readEntry(history.state)
    let previous = entry?.trail[entry.trail.length - 1]
    if (
      !initialized ||
      !entry ||
      entry.route !== scope ||
      previous?.bookId !== view.bookId
    ) {
      // Mounting after a route return or reload must not issue a surprise Back.
      initialized = true
      const base: MobilePanelView = { bookId: view.bookId, navbar: false }
      write('replaceState', [base])
      entry = readEntry(history.state)!
      previous = base
    }
    if (sameView(previous!, view)) return
    const backIndex = entry.trail.findIndex((item) => sameView(item, view))
    if (backIndex >= 0) {
      pending = true
      history.go(backIndex - (entry.trail.length - 1))
    } else if (
      previous?.action &&
      view.action &&
      !opensNestedPanel(previous, view)
    ) {
      // Switching tools is one overlay level, not a stack of every tool opened.
      write('replaceState', [...entry.trail.slice(0, -1), { ...view }])
    } else if (entry.trail.length < 4) {
      write('pushState', [...entry.trail, { ...view }])
    } else {
      write('replaceState', [...entry.trail.slice(0, -1), { ...view }])
    }
  }

  function restore(state: unknown) {
    const entry = readEntry(state)
    if (!entry || entry.route !== scope || route() !== scope) return false
    pending = false
    const view = entry.trail[entry.trail.length - 1]!
    if (view.bookId !== current().bookId) {
      // A stale overlay from another book must not reopen that book or its tools.
      const closed = { bookId: current().bookId, navbar: false }
      write('replaceState', [closed])
      restoreView(closed)
    } else {
      restoreView({ ...view })
    }
    return true
  }

  function replace(view: MobilePanelView) {
    if (route() !== scope) return
    const entry = readEntry(history.state)
    const base = { bookId: view.bookId, navbar: false }
    const trail: MobilePanelView[] =
      entry?.route === scope ? entry.trail.slice(0, -1) : [base]
    if (!trail.length) trail.push(base)
    if (!sameView(trail[trail.length - 1]!, view)) trail.push({ ...view })
    write('replaceState', trail)
  }

  return { sync, restore, replace }
}
