import { useEffect, useState } from 'react'

/** Guidance only: a webpage cannot start or inspect Edge's native narration. */
export default function EdgeListeningHelp() {
  const [browser, setBrowser] = useState<'edge' | 'other'>()
  const [installed, setInstalled] = useState(false)
  useEffect(() => {
    setBrowser(/Edg(?:A|iOS)?\//.test(navigator.userAgent) ? 'edge' : 'other')
    setInstalled(window.matchMedia('(display-mode: standalone)').matches)
  }, [])
  return (
    <>
      <p>
        {browser === 'other'
          ? 'For Edge’s native Read aloud, open Flow in Microsoft Edge and import this EPUB there if needed. This browser cannot open Edge’s Read aloud controls.'
          : 'In Edge, open the menu → Read aloud. Edge controls voice, speed, pause and playback.'}
      </p>
      <p>
        {installed
          ? 'This is an installed view. If Read aloud is missing, open the listening document in the Edge browser using the same profile.'
          : 'If an installed app hides Read aloud, open the listening document in the Edge browser using the same profile.'}{' '}
        Books and Bookmarks belong to the browser profile where they were
        imported; a link does not transfer the EPUB.
      </p>
      <p>
        Close tools before listening. Flow saves manual Bookmarks for your next
        start; it does not track Edge’s spoken position.
      </p>
    </>
  )
}
