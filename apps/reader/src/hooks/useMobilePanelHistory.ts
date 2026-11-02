import { useRouter } from 'next/router'
import { useEffect, useRef } from 'react'
import { useRecoilState } from 'recoil'

import { useReaderSnapshot } from '../models'
import { navbarState } from '../state'

import {
  createMobilePanelHistory,
  MobilePanelView,
  sameRestoredPanel,
} from './panel-history'
import { Action, useAction } from './useAction'
import { useMobile } from './useMobile'

const actions = new Set<Action>([
  'toc',
  'search',
  'annotation',
  'typography',
  'image',
  'timeline',
  'theme',
  'listening',
])

let activeRestore: ((state: unknown) => boolean) | undefined
let restoredPanel: MobilePanelView | undefined

/** Called before Next performs a route transition for a same-document pane pop. */
export function restoreMobilePanelHistory(state: unknown) {
  return activeRestore?.(state) ?? false
}

/** Forward reopens the same review; clicking Listen after closing is a fresh entry. */
export function isMobilePanelRestoration(bookId: string, action: Action) {
  return restoredPanel?.bookId === bookId && restoredPanel.action === action
}

export function useMobilePanelHistory() {
  const router = useRouter()
  const mobile = useMobile()
  const [action, setAction] = useAction()
  const [navbar, setNavbar] = useRecoilState(navbarState)
  const { focusedBookTab } = useReaderSnapshot()
  const bookId = focusedBookTab?.id
  const current = useRef<MobilePanelView>({ bookId, action, navbar })
  current.current = { bookId, action, navbar }
  // Clear a Forward flag before child entry effects run after a manual tool switch.
  // Ignore navbar here: Recoil can render between the two history-restore setters.
  if (restoredPanel && !sameRestoredPanel(restoredPanel, current.current))
    restoredPanel = undefined
  const controller = useRef<ReturnType<typeof createMobilePanelHistory>>()

  useEffect(() => {
    if (!mobile) return
    const history = createMobilePanelHistory(
      window.history,
      () => window.location.pathname + window.location.search,
      () => current.current,
      (view) => {
        const nextAction = actions.has(view.action as Action)
          ? (view.action as Action)
          : undefined
        current.current = { ...view, action: nextAction }
        restoredPanel = current.current
        setAction(nextAction)
        setNavbar(view.navbar)
      },
    )
    controller.current = history
    activeRestore = history.restore
    const onPop = (event: PopStateEvent) => history.restore(event.state)
    window.addEventListener('popstate', onPop)
    history.sync(current.current)
    return () => {
      window.removeEventListener('popstate', onPop)
      if (activeRestore === history.restore) activeRestore = undefined
      restoredPanel = undefined
      controller.current = undefined
    }
  }, [mobile, router.asPath, setAction, setNavbar])

  useEffect(() => {
    if (mobile) controller.current?.sync({ bookId, action, navbar })
  }, [mobile, bookId, action, navbar])
}
