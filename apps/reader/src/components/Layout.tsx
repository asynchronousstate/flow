import { Overlay } from '@literal-ui/core'
import clsx from 'clsx'
import { ComponentProps, useEffect, useRef, useState } from 'react'
import { useMemo } from 'react'
import { IconType } from 'react-icons'
import {
  MdFormatUnderlined,
  MdOutlineImage,
  MdSearch,
  MdToc,
  MdTimeline,
  MdOutlineLightMode,
  MdHeadset,
  MdClose,
} from 'react-icons/md'
import { RiFontSize, RiHome6Line, RiSettings5Line } from 'react-icons/ri'
import { useRecoilState } from 'recoil'

import {
  Env,
  Action,
  useAction,
  useBackground,
  useColorScheme,
  useMobile,
  useMobilePanelHistory,
  useSetAction,
  useTranslation,
} from '../hooks'
import { reader, useReaderSnapshot } from '../models'
import { navbarState } from '../state'
import { activeClass } from '../styles'

import { SplitView, useSplitViewItem } from './base'
import { Settings } from './pages'
import { AnnotationView } from './viewlets/AnnotationView'
import { ImageView } from './viewlets/ImageView'
import { ListeningView } from './viewlets/ListeningView'
import { SearchView } from './viewlets/SearchView'
import { ThemeView } from './viewlets/ThemeView'
import { TimelineView } from './viewlets/TimelineView'
import { TocView } from './viewlets/TocView'
import { TypographyView } from './viewlets/TypographyView'

export const Layout: React.FC = ({ children }) => {
  useColorScheme()
  useMobilePanelHistory()

  const [ready, setReady] = useState(false)
  const setAction = useSetAction()
  const mobile = useMobile()

  useEffect(() => {
    if (mobile === undefined) return
    setAction((current) => current ?? (mobile ? undefined : 'toc'))
    setReady(true)
  }, [mobile, setAction])

  return (
    <div id="layout" className="select-none">
      <SplitView>
        {mobile === false && <ActivityBar />}
        {mobile === true && <NavigationBar />}
        {ready && <SideBar />}
        {ready && <Reader>{children}</Reader>}
      </SplitView>
    </div>
  )
}

interface IAction {
  name: string
  title: string
  Icon: IconType
  env: number
}
interface IViewAction extends IAction {
  name: Action
  View: React.FC<any>
}

const viewActions: IViewAction[] = [
  {
    name: 'listening',
    title: 'Listening',
    Icon: MdHeadset,
    View: ListeningView,
    env: Env.Desktop | Env.Mobile,
  },
  {
    name: 'toc',
    title: 'toc',
    Icon: MdToc,
    View: TocView,
    env: Env.Desktop | Env.Mobile,
  },
  {
    name: 'search',
    title: 'search',
    Icon: MdSearch,
    View: SearchView,
    env: Env.Desktop | Env.Mobile,
  },
  {
    name: 'annotation',
    title: 'annotation',
    Icon: MdFormatUnderlined,
    View: AnnotationView,
    env: Env.Desktop | Env.Mobile,
  },
  {
    name: 'image',
    title: 'image',
    Icon: MdOutlineImage,
    View: ImageView,
    env: Env.Desktop,
  },
  {
    name: 'timeline',
    title: 'timeline',
    Icon: MdTimeline,
    View: TimelineView,
    env: Env.Desktop,
  },
  {
    name: 'typography',
    title: 'typography',
    Icon: RiFontSize,
    View: TypographyView,
    env: Env.Desktop | Env.Mobile,
  },
  {
    name: 'theme',
    title: 'theme',
    Icon: MdOutlineLightMode,
    View: ThemeView,
    env: Env.Desktop | Env.Mobile,
  },
]

const ActivityBar: React.FC = () => {
  useSplitViewItem(ActivityBar, {
    preferredSize: 48,
    minSize: 48,
    maxSize: 48,
  })
  return (
    <div className="ActivityBar flex flex-col justify-between">
      <ViewActionBar env={Env.Desktop} />
      <PageActionBar env={Env.Desktop} />
    </div>
  )
}

interface EnvActionBarProps extends ComponentProps<'div'> {
  env: Env
}

function ViewActionBar({ className, env }: EnvActionBarProps) {
  const [action, setAction] = useAction()
  const t = useTranslation()

  return (
    <ActionBar className={className}>
      {viewActions
        .filter((a) => a.env & env)
        .map(({ name, title, Icon }) => {
          const active = action === name
          return (
            <Action
              title={name === 'listening' ? title : t(`${title}.title`)}
              Icon={Icon}
              active={active}
              aria-pressed={active}
              aria-controls="flow-reader-panel"
              onClick={() => setAction(active ? undefined : name)}
              key={name}
            />
          )
        })}
    </ActionBar>
  )
}

function PageActionBar({ env }: EnvActionBarProps) {
  const mobile = useMobile()
  const [action, setAction] = useState('Home')
  const t = useTranslation()

  interface IPageAction extends IAction {
    Component?: React.FC
    disabled?: boolean
  }

  const pageActions: IPageAction[] = useMemo(
    () => [
      {
        name: 'home',
        title: 'home',
        Icon: RiHome6Line,
        env: Env.Mobile,
      },
      {
        name: 'settings',
        title: 'settings',
        Icon: RiSettings5Line,
        Component: Settings,
        env: Env.Desktop | Env.Mobile,
      },
    ],
    [],
  )

  return (
    <ActionBar>
      {pageActions
        .filter((a) => a.env & env)
        .map(({ name, title, Icon, Component, disabled }, i) => (
          <Action
            title={t(`${title}.title`)}
            Icon={Icon}
            active={mobile ? action === name : undefined}
            disabled={disabled}
            onClick={() => {
              Component ? reader.addTab(Component) : reader.clear()
              setAction(name)
            }}
            key={i}
          />
        ))}
    </ActionBar>
  )
}

function NavigationBar() {
  const r = useReaderSnapshot()
  const readMode = r.focusedTab?.isBook
  const [visible, setVisible] = useRecoilState(navbarState)

  return (
    <>
      {visible && (
        <Overlay
          className="!bg-transparent"
          onClick={() => setVisible(false)}
        />
      )}
      <div className="NavigationBar bg-surface border-surface-variant fixed inset-x-0 bottom-0 z-10 border-t">
        {readMode ? (
          <ViewActionBar
            env={Env.Mobile}
            className={clsx(visible || 'hidden')}
          />
        ) : (
          <PageActionBar env={Env.Mobile} />
        )}
      </div>
    </>
  )
}

interface ActionBarProps extends ComponentProps<'ul'> {}
function ActionBar({ className, ...props }: ActionBarProps) {
  return (
    <ul className={clsx('ActionBar flex sm:flex-col', className)} {...props} />
  )
}

interface ActionProps extends ComponentProps<'button'> {
  Icon: IconType
  active?: boolean
}
const Action: React.FC<ActionProps> = ({
  className,
  Icon,
  active,
  ...props
}) => {
  const mobile = useMobile()
  return (
    <button
      className={clsx(
        'Action relative flex h-12 w-12 flex-1 items-center justify-center sm:flex-initial',
        active ? 'text-on-surface-variant' : 'text-outline/70',
        props.disabled ? 'text-on-disabled' : 'hover:text-on-surface-variant ',
        className,
      )}
      {...props}
    >
      {active &&
        (mobile || (
          <div
            className={clsx('absolute', 'inset-y-0 left-0 w-0.5', activeClass)}
          />
        ))}
      <Icon size={28} />
      {mobile && (
        <span className="flow-mobile-action-label">{props.title}</span>
      )}
    </button>
  )
}

const SideBar: React.FC = () => {
  const [action, setAction] = useAction()
  const mobile = useMobile()
  const t = useTranslation()
  const listening = action === 'listening'
  const panelRef = useRef<HTMLDivElement>(null)
  const returnFocus = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!mobile) return
    if (action) {
      if (!returnFocus.current)
        returnFocus.current = document.activeElement as HTMLElement | null
      panelRef.current?.focus()
    } else {
      const target = returnFocus.current
      returnFocus.current = null
      if (target?.isConnected) target.focus()
    }
  }, [action, mobile])

  const { size } = useSplitViewItem(SideBar, {
    preferredSize: 240,
    minSize: listening ? 340 : 160,
    visible: !!action,
  })

  return (
    <>
      {action && mobile && <Overlay onClick={() => setAction(undefined)} />}
      <div
        id="flow-reader-panel"
        ref={panelRef}
        role={mobile && action ? 'dialog' : undefined}
        aria-modal={mobile && action ? true : undefined}
        aria-label={
          action
            ? listening
              ? 'Listening range'
              : t(`${action}.title`)
            : undefined
        }
        tabIndex={-1}
        onKeyDown={(event) => {
          if (!mobile || !action) return
          if (event.key === 'Escape') {
            event.preventDefault()
            setAction(undefined)
          } else if (event.key === 'Tab') {
            const controls = Array.from(
              event.currentTarget.querySelectorAll<HTMLElement>(
                'button:not([disabled]), input:not([disabled]), select:not([disabled]), a[href], [tabindex="0"]',
              ),
            ).filter((element) => element.getClientRects().length > 0)
            const first = controls[0]
            const last = controls[controls.length - 1]
            if (
              event.shiftKey &&
              (document.activeElement === first ||
                document.activeElement === event.currentTarget)
            ) {
              event.preventDefault()
              last?.focus()
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault()
              first?.focus()
            }
          }
        }}
        className={clsx(
          'SideBar bg-surface flex flex-col',
          listening && 'flow-listening-sidebar',
          !action && '!hidden',
          mobile ? 'absolute inset-y-0 right-0 z-10' : '',
        )}
        style={{
          width: mobile
            ? listening
              ? '100%'
              : '75%'
            : listening
            ? Math.max(size ?? 340, 340)
            : size,
        }}
      >
        {mobile && action && !listening && (
          <button
            type="button"
            className="flow-pane-close"
            aria-label={`Close ${t(`${action}.title`)}`}
            onClick={() => setAction(undefined)}
          >
            <MdClose aria-hidden="true" /> Close
          </button>
        )}
        {viewActions.map(({ name, title, View }) => (
          <View
            key={name}
            name={name === 'listening' ? title : t(`${name}.title`)}
            title={name === 'listening' ? title : t(`${title}.title`)}
            className={clsx(name !== action && '!hidden')}
          />
        ))}
      </div>
    </>
  )
}

interface ReaderProps extends ComponentProps<'div'> {}
const Reader: React.FC = ({ className, ...props }: ReaderProps) => {
  useSplitViewItem(Reader)
  const [bg] = useBackground()
  const mobile = useMobile()

  const r = useReaderSnapshot()
  const readMode = r.focusedTab?.isBook

  return (
    <div
      className={clsx(
        'Reader flex-1 overflow-hidden',
        readMode || 'mb-12 sm:mb-0',
        bg,
        className,
      )}
      style={
        mobile && !readMode
          ? { marginBottom: 'calc(48px + env(safe-area-inset-bottom))' }
          : undefined
      }
      {...props}
    />
  )
}
