import { ref, snapshot } from 'valtio'

import type { BookRecord } from '../../db'
import { BookTab, reader } from '../../models'
import type {
  BookTabRuntimePolicy,
  BookTabSourceOverlayType,
} from '../../models/reader'
import type { ListeningMarker } from '../integrated'

export interface OriginalFeatureRuntime {
  tab: BookTab
  setActive(active: boolean): void
  settled(): Promise<void>
  destroy(): void
}

/** Host the actual Flow reader without letting its initialization or hidden
 * reflows replace the saved reading position. No Listening record is changed.
 */
export function createOriginalFeatureRuntime(
  bookRecord: BookRecord,
  onNavigate?: (context?: unknown) => void,
  onOverlayChange?: (type: BookTabSourceOverlayType | undefined) => void,
  saveListeningBookmark?: (marker: ListeningMarker) => Promise<void>,
  navigationContext?: () => unknown,
): OriginalFeatureRuntime {
  const previousGroups = reader.groups
  const previousFocus = reader.focusedIndex
  previousGroups.forEach((previousGroup) => {
    previousGroup.bookTabs.forEach((previousTab) => previousTab.disposeRender())
  })
  reader.groups = []
  reader.focusedIndex = -1
  const group = reader.addGroup([bookRecord])
  const tab = group.tabs[0] as BookTab
  const pending = new Set<Promise<void>>()
  const failures: unknown[] = []
  let active = false
  let navigated = false
  let initialized = false
  let disposed = false
  let taskRevision = 0
  let navigationRevision = 0

  function track(task: PromiseLike<unknown>) {
    taskRevision++
    const observed = Promise.resolve(task).then(
      () => {
        pending.delete(observed)
      },
      (error: unknown) => {
        pending.delete(observed)
        failures.push(error)
      },
    )
    pending.add(observed)
  }

  const policy: BookTabRuntimePolicy = {
    isActive: () => active && !disposed,
    isDisposed: () => disposed,
    onNavigation: () => {
      if (active && !disposed) navigated = true
    },
    onDisplay: () => {
      if (!active || disposed || !onNavigate) return
      const revision = ++navigationRevision
      const context = navigationContext?.()
      // Collapsing a tool changes the source viewport. Wait until the actual
      // target location and its persistence have settled before that reflow.
      // This callback must stay outside pending: it awaits that same drain.
      void Promise.resolve()
        .then(() => settled())
        .then(() => {
          if (active && !disposed && revision === navigationRevision)
            onNavigate(context)
        })
        .catch(() => {
          // The tracked reader error remains available to settled()/Home.
        })
    },
    onOverlayChange,
    ...(saveListeningBookmark
      ? {
          saveListeningBookmark: (marker: ListeningMarker) => {
            const task = Promise.resolve().then(() =>
              saveListeningBookmark(marker),
            )
            // Quiet's Bookmark coordinator owns rollback and error feedback.
            // Wait for that lifecycle without turning a recoverable Bookmark
            // rejection into a permanent reader-progress persistence failure.
            track(
              task.then(
                () => undefined,
                () => undefined,
              ),
            )
            return task
          },
        }
      : {}),
    shouldPersistProgress: () => {
      // Initial display is never a new reading decision, even when a tool
      // navigation was accepted before its first location callback arrived.
      if (!initialized) {
        initialized = true
        return false
      }
      return active && navigated && !disposed
    },
    track,
  }
  tab.runtimePolicy = ref(policy)

  const render = tab.render.bind(tab)
  tab.render = (element) => {
    const task = render(element)
    track(task)
    return task
  }

  async function settled() {
    // A display promise resolves before epub.js reports its final location.
    // Drain its real queue and the reportLocation animation frame as well as
    // every database write accepted while this drain is in progress.
    let revision: number
    do {
      revision = taskRevision
      while (pending.size) await Promise.all(Array.from(pending))
      if (!disposed && tab.rendition) {
        await tab.rendition.q.run()
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => resolve())
        })
      }
    } while (pending.size || revision !== taskRevision)

    if (failures.length) {
      const error = failures[0]
      throw error instanceof Error
        ? error
        : new Error('A reader change could not be saved. Keep this page open.')
    }
  }

  function setActive(nextActive: boolean) {
    if (disposed || active === nextActive) return
    active = nextActive
    navigationRevision++
    navigated = false
    if (!active) {
      tab.dismissSourceOverlay()
      if (tab.iframe) tab.iframe.ontouchend = undefined
    }
    if (active && tab.rendition) {
      track(
        new Promise<void>((resolve, reject) => {
          requestAnimationFrame(() => {
            try {
              if (active && !disposed) tab.rendition?.resize()
              resolve()
            } catch (error) {
              reject(error)
            }
          })
        }),
      )
    }
  }

  function destroy() {
    if (disposed) return
    disposed = true
    navigationRevision++
    active = false
    navigated = false
    tab.dismissSourceOverlay()
    if (tab.iframe) tab.iframe.ontouchend = undefined

    const ownsReader = reader.groups.some((item) => item.id === group.id)
    const currentBook = JSON.parse(
      JSON.stringify(snapshot(tab.book)),
    ) as BookRecord
    const canonicalLocation = tab.timeline.find(
      (entry) => entry.location.start.cfi === currentBook.cfi,
    )
    previousGroups.forEach((previousGroup) => {
      previousGroup.bookTabs.forEach((previousTab) => {
        if (previousTab.id !== tab.id) return
        previousTab.book = currentBook
        // A remounted original reader prefers its timeline location to book.cfi.
        // Advance that location using a real accepted source relocation, while
        // retaining its earlier history and ignoring later hidden reflows.
        if (
          canonicalLocation &&
          previousTab.location?.start.cfi !== currentBook.cfi
        ) {
          previousTab.timeline.unshift(
            JSON.parse(JSON.stringify(canonicalLocation)),
          )
        }
      })
    })

    // The ordinary reader has no unmount disposal because its groups can be
    // restored. These temporary source tabs belong solely to this runtime.
    const tabs = ownsReader
      ? reader.groups.flatMap((item) => item.bookTabs)
      : [tab]
    tabs.forEach((ownedTab) => {
      try {
        ownedTab.epub?.destroy()
      } catch {
        // Opening may have been canceled before epub.js finished attaching.
        try {
          ownedTab.rendition?.destroy()
        } catch {
          // A partially destroyed engine must not prevent scope restoration.
        }
      }
    })
    if (ownsReader) {
      reader.groups = previousGroups
      reader.focusedIndex = previousFocus
    }
  }

  return { tab, setActive, settled, destroy }
}
