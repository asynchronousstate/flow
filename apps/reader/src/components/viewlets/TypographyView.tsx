import clsx from 'clsx'
import { useCallback, useEffect, useRef, useState } from 'react'
import { MdAdd, MdRemove } from 'react-icons/md'

import { RenditionSpread } from '@flow/epubjs/types/rendition'
import { useTranslation } from '@flow/reader/hooks'
import { reader, useReaderSnapshot } from '@flow/reader/models'
import {
  defaultSettings,
  TypographyConfiguration,
  useSettings,
} from '@flow/reader/state'
import { keys } from '@flow/reader/utils'

import { Select, TextField, TextFieldProps } from '../Form'
import { PaneViewProps, PaneView, Pane } from '../base'

// Define an interface for the Font object

enum TypographyScope {
  Book,
  Global,
}

export const TypographyView: React.FC<PaneViewProps> = (props) => {
  const { focusedBookTab } = useReaderSnapshot()
  const [settings, setSettings] = useSettings()
  const [scope, setScope] = useState(TypographyScope.Book)
  const t = useTranslation('typography')

  const [localFonts, setLocalFonts] = useState<string[]>()
  const [measured, setMeasured] = useState<Record<string, string>>({})

  const { fontFamily, fontSize, fontWeight, lineHeight, zoom, spread } =
    scope === TypographyScope.Book
      ? focusedBookTab?.book.configuration?.typography ?? defaultSettings
      : settings

  const inherited = {
    ...settings,
    ...Object.fromEntries(
      Object.entries(
        focusedBookTab?.book.configuration?.typography ?? {},
      ).filter(([, value]) => value !== undefined),
    ),
  }
  useEffect(() => {
    const frame = reader.focusedBookTab?.iframe
    const body = frame?.document.body
    if (!frame || !body) {
      setMeasured({})
      return
    }
    const request = requestAnimationFrame(() => {
      const style = frame.getComputedStyle(body)
      setMeasured({
        fontSize: style.fontSize,
        fontFamily: style.fontFamily,
        fontWeight: style.fontWeight,
        lineHeight: style.lineHeight,
      })
    })
    return () => cancelAnimationFrame(request)
  }, [
    focusedBookTab?.id,
    focusedBookTab?.iframe,
    fontSize,
    fontFamily,
    fontWeight,
    lineHeight,
    settings,
  ])

  const effective = (key: keyof TypographyConfiguration) =>
    inherited[key] || measured[key] || 'EPUB default'

  const setTypography = useCallback(
    <K extends keyof TypographyConfiguration>(
      k: K,
      v: TypographyConfiguration[K],
    ) => {
      if (scope === TypographyScope.Book) {
        reader.focusedBookTab?.updateBook({
          configuration: {
            ...reader.focusedBookTab.book.configuration,
            typography: {
              ...reader.focusedBookTab.book.configuration?.typography,
              [k]: v,
            },
          },
        })
      } else {
        setSettings((prev) => ({
          ...prev,
          [k]: v,
        }))
      }
    },
    [scope, setSettings],
  )

  const queryLocalFonts = useCallback(async () => {
    if (localFonts) return
    if (!('queryLocalFonts' in window)) {
      console.error('queryLocalFonts is not available')
      return
    }

    try {
      const fonts = await window.queryLocalFonts()
      const uniqueFonts = Array.from(new Set(fonts.map((f) => f.family)))
      setLocalFonts(uniqueFonts)
    } catch (error) {
      console.error('Error querying local fonts:', error)
    }
  }, [localFonts])

  return (
    <PaneView {...props}>
      <div className="typescale-body-medium flex gap-2 px-5 pb-2 !text-[13px]">
        {keys(TypographyScope)
          .filter((k) => isNaN(Number(k)))
          .map((scopeName) => (
            <button
              key={scopeName}
              type="button"
              aria-pressed={TypographyScope[scopeName] === scope}
              disabled={scopeName === 'Book' && !focusedBookTab}
              className={clsx(
                'min-h-[44px] px-2',
                TypographyScope[scopeName] === scope
                  ? 'text-on-surface-variant'
                  : 'text-outline/60',
              )}
              onClick={() => setScope(TypographyScope[scopeName])}
            >
              {scopeName === 'Book' ? 'This book' : 'All books'}
            </button>
          ))}
      </div>
      <p className="flow-typography-summary">
        {scope === TypographyScope.Book
          ? 'Book overrides apply here. Reset a field to inherit All books or the EPUB.'
          : 'Defaults for every book; individual book overrides still apply.'}
        {focusedBookTab && (
          <span className="block">
            Effective in this book: {String(effective('fontSize'))} · line
            height {String(effective('lineHeight'))}. Font:{' '}
            {String(effective('fontFamily'))}.
          </span>
        )}
      </p>
      <Pane
        headline={t('title')}
        className="space-y-3 px-5 pt-2 pb-4"
        key={`${scope}${focusedBookTab?.id}`}
      >
        <div className="flow-typography-presets" aria-label="Reading presets">
          <button
            type="button"
            onClick={() => {
              setTypography('fontSize', '18px')
              setTypography('lineHeight', 1.6)
            }}
          >
            Comfortable
          </button>
          <button
            type="button"
            onClick={() => {
              setTypography('fontSize', '22px')
              setTypography('lineHeight', 1.7)
            }}
          >
            Large text
          </button>
        </div>
        <Select
          name={t('page_view')}
          value={spread ?? RenditionSpread.Auto}
          onChange={(e) => {
            setTypography('spread', e.target.value as RenditionSpread)
          }}
        >
          <option value={RenditionSpread.None}>
            {t('page_view.single_page')}
          </option>
          <option value={RenditionSpread.Auto}>
            Automatic (fits the screen)
          </option>
        </Select>
        <TextField
          as="input"
          name={t('font_family')}
          value={fontFamily}
          placeholder={String(effective('fontFamily'))}
          // Tips: Datalist only appears on mouse click or keyboard input.
          // Does not show when focused via Tab/focus() or triggered by click()
          datalist={localFonts?.map((font) => (
            <option key={font} value={font}>
              {font}
            </option>
          ))}
          onFocus={queryLocalFonts}
          // Preload fonts to ensure `localFonts` is available on first mouse click.
          // Without preloading, datalist dropdown will be empty for the first mouse click.
          onMouseEnter={queryLocalFonts}
          onChange={(e) => {
            setTypography('fontFamily', e.target.value)
          }}
        />
        <NumberField
          name={t('font_size')}
          min={14}
          max={28}
          defaultValue={fontSize && parseInt(fontSize)}
          effective={String(effective('fontSize'))}
          onChange={(v) => {
            setTypography('fontSize', v ? v + 'px' : undefined)
          }}
        />
        <NumberField
          name={t('font_weight')}
          min={100}
          max={900}
          step={100}
          defaultValue={fontWeight}
          effective={String(effective('fontWeight'))}
          onChange={(v) => {
            setTypography('fontWeight', v || undefined)
          }}
        />
        <NumberField
          name={t('line_height')}
          min={1}
          step={0.1}
          defaultValue={lineHeight}
          effective={String(effective('lineHeight'))}
          onChange={(v) => {
            setTypography('lineHeight', v || undefined)
          }}
        />
        <NumberField
          name={t('zoom')}
          min={1}
          step={0.1}
          defaultValue={zoom}
          effective={String(inherited.zoom ?? 1)}
          onChange={(v) => {
            setTypography('zoom', v || undefined)
          }}
        />
      </Pane>
    </PaneView>
  )
}

interface NumberFieldProps extends Omit<TextFieldProps<'input'>, 'onChange'> {
  onChange: (v?: number) => void
  effective?: string
}
const NumberField: React.FC<NumberFieldProps> = ({
  onChange,
  effective,
  ...props
}) => {
  const ref = useRef<HTMLInputElement>(null)
  const t = useTranslation('action')

  return (
    <TextField
      as="input"
      type="number"
      placeholder={effective ? `Inherited: ${effective}` : 'EPUB default'}
      actions={[
        {
          title: `${t('step_down')} ${props.name}`,
          Icon: MdRemove,
          onClick: () => {
            if (!ref.current) return
            ref.current.stepDown()
            onChange(Number(ref.current.value))
          },
        },
        {
          title: `${t('step_up')} ${props.name}`,
          Icon: MdAdd,
          onClick: () => {
            if (!ref.current) return
            ref.current.stepUp()
            onChange(Number(ref.current.value))
          },
        },
      ]}
      mRef={ref}
      // lazy render
      onBlur={(e) => {
        onChange(e.target.value ? Number(e.target.value) : undefined)
      }}
      onClear={() => {
        if (ref.current) ref.current.value = ''
        onChange(undefined)
      }}
      {...props}
    />
  )
}
