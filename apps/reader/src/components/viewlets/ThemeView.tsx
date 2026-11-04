import clsx from 'clsx'
import { ComponentProps } from 'react'

import { range } from '@flow/internal'
import {
  useBackground,
  useColorScheme,
  useSourceColor,
  useTranslation,
} from '@flow/reader/hooks'

import { ColorPicker, Label } from '../Form'
import { PaneViewProps, PaneView, Pane } from '../base'

export const ThemeView: React.FC<PaneViewProps> = (props) => {
  const { setScheme } = useColorScheme()
  const { sourceColor, setSourceColor } = useSourceColor()
  const [, setBackground] = useBackground()
  const t = useTranslation('theme')

  return (
    <PaneView {...props}>
      <Pane headline={t('title')} className="space-y-3 px-5 pt-2 pb-4">
        <div>
          <ColorPicker
            name={t('source_color')}
            defaultValue={sourceColor}
            onChange={(e) => {
              setSourceColor(e.target.value)
            }}
          />
        </div>
        <div>
          <Label name={t('background_color')}></Label>
          <div className="flex gap-2">
            {range(7)
              .filter((i) => !(i % 2))
              .map((i) => i - 1)
              .map((i) => (
                <Background
                  key={i}
                  aria-label={
                    i < 0 ? 'White background' : `Light background ${i}`
                  }
                  className={i > 0 ? `bg-surface${i}` : 'bg-white'}
                  onClick={() => {
                    setScheme('light')
                    setBackground(i)
                  }}
                />
              ))}
            <Background
              className="bg-black"
              aria-label="Dark background"
              onClick={() => {
                setScheme('dark')
              }}
            />
          </div>
        </div>
      </Pane>
    </PaneView>
  )
}

interface BackgroundProps extends ComponentProps<'button'> {}
const Background: React.FC<BackgroundProps> = ({ className, ...props }) => {
  return (
    <button
      type="button"
      className={clsx(
        'border-outline-variant light h-11 w-11 shrink-0 border',
        className,
      )}
      {...props}
    />
  )
}
