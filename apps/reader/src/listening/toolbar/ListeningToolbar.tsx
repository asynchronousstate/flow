import type { IconType } from 'react-icons'
import {
  MdFormatUnderlined,
  MdOutlineImage,
  MdOutlineLightMode,
  MdSearch,
  MdTimeline,
  MdToc,
} from 'react-icons/md'
import { RiFontSize, RiHome6Line, RiSettings5Line } from 'react-icons/ri'

export type ToolbarVariant = 'ribbon'

// v2.4 promotes the selected design. Legacy preview query strings do not
// override the production toolbar or modify an existing listening snapshot.
export const LISTENING_TOOLBAR_VARIANT = 'ribbon' as const

export type ToolbarAction =
  | 'toc'
  | 'search'
  | 'annotation'
  | 'image'
  | 'timeline'
  | 'typography'
  | 'theme'
  | 'settings'

interface ToolbarTool {
  action: ToolbarAction
  label: string
  name: string
  Icon: IconType
}

// These are the original Flow reader tools. Listening Mode replaces the
// original Listening destination with Home; it does not introduce another copy.
export const listeningToolbarTools: readonly ToolbarTool[] = [
  { action: 'toc', label: 'Contents', name: 'Table of contents', Icon: MdToc },
  { action: 'search', label: 'Search', name: 'Search', Icon: MdSearch },
  {
    action: 'annotation',
    label: 'Annotations',
    name: 'Annotations',
    Icon: MdFormatUnderlined,
  },
  { action: 'image', label: 'Images', name: 'Images', Icon: MdOutlineImage },
  {
    action: 'timeline',
    label: 'Timeline',
    name: 'Reading timeline',
    Icon: MdTimeline,
  },
  {
    action: 'typography',
    label: 'Typography',
    name: 'Typography',
    Icon: RiFontSize,
  },
  { action: 'theme', label: 'Theme', name: 'Theme', Icon: MdOutlineLightMode },
  {
    action: 'settings',
    label: 'Settings',
    name: 'Settings',
    Icon: RiSettings5Line,
  },
]

export interface ListeningToolbarProps {
  variant: ToolbarVariant
  action?: ToolbarAction
  onAction(action: ToolbarAction | undefined): void
  onHome(): void
  busy?: boolean
}

export function ListeningToolbar({
  variant,
  action,
  onAction,
  onHome,
  busy = false,
}: ListeningToolbarProps) {
  function toolButton(tool: ToolbarTool) {
    const { Icon } = tool
    const selected = action === tool.action
    return (
      <button
        key={tool.action}
        type="button"
        className={`flow-toolkit-action flow-toolkit-action-${tool.action}`}
        aria-label={tool.name}
        title={tool.name}
        aria-pressed={selected}
        aria-expanded={selected}
        aria-controls={selected ? 'flow-listening-feature-panel' : undefined}
        onClick={() => onAction(selected ? undefined : tool.action)}
      >
        <Icon size={23} aria-hidden="true" focusable="false" />
        <span>{tool.label}</span>
      </button>
    )
  }

  const home = (
    <button
      type="button"
      className="flow-toolkit-action flow-toolkit-action-home"
      aria-label="Home"
      title="Return to Flow library"
      disabled={busy}
      aria-busy={busy || undefined}
      onClick={onHome}
    >
      <RiHome6Line size={23} aria-hidden="true" focusable="false" />
      <span>{busy ? 'Saving…' : 'Home'}</span>
    </button>
  )
  const settings = listeningToolbarTools.find(
    (tool) => tool.action === 'settings',
  )!

  return (
    <nav
      className="flow-listening-toolbar"
      data-toolbar-variant={variant}
      aria-label="Flow reader tools"
      data-nosnippet
    >
      <div className="flow-toolkit-toolbar-inner">
        {home}
        <div className="flow-toolkit-toolbar-scroll">
          {listeningToolbarTools
            .filter((tool) => tool.action !== 'settings')
            .map(toolButton)}
        </div>
        {toolButton(settings)}
      </div>
    </nav>
  )
}

export default ListeningToolbar
