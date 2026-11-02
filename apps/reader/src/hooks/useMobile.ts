import { useEffect } from 'react'
import { atom, useRecoilState } from 'recoil'

export const mobileState = atom<boolean | undefined>({
  key: 'mobile',
  default: undefined,
})

export function useMobile() {
  const [mobile, setMobile] = useRecoilState(mobileState)

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 640px)')
    const update = (event: MediaQueryListEvent) => setMobile(event.matches)
    setMobile(mq.matches)
    mq.addEventListener('change', update)
    // A new RecoilRoot must receive the current viewport, even after a client
    // route has unmounted the previous reader. Each consumer cleans its listener.
    return () => mq.removeEventListener('change', update)
  }, [setMobile])

  return mobile
}
