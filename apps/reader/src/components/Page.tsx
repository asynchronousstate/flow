import clsx from 'clsx'
import { ComponentProps } from 'react'

interface PageProps extends ComponentProps<'div'> {
  headline: string
}
export const Page: React.FC<PageProps> = ({
  className,
  children,
  headline,
  ...props
}) => {
  return (
    <div
      className={clsx(
        'h-full min-h-0 overflow-y-auto overscroll-contain p-4',
        className,
      )}
      {...props}
      style={{ touchAction: 'pan-y', ...props.style }}
    >
      <h1 className="typescale-title-large text-on-surface-variant mb-4">
        {headline}
      </h1>
      {children}
    </div>
  )
}
