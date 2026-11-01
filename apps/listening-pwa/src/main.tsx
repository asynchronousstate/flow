import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'

import ListeningApp from '@flow/listening/ListeningApp'
import '@flow/listening/listening.css'
import './pwa.css'

interface InstallPrompt extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

function App() {
  const [installPrompt, setInstallPrompt] = useState<InstallPrompt>()
  const [offline, setOffline] = useState(!navigator.onLine)
  const [cacheState, setCacheState] = useState('Preparing offline access…')
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState(false)
  const [installed, setInstalled] = useState(
    matchMedia('(display-mode: standalone), (display-mode: minimal-ui)')
      .matches,
  )
  const [updateReady, setUpdateReady] = useState(false)
  const [installError, setInstallError] = useState(false)

  useEffect(() => {
    const connection = () => setOffline(!navigator.onLine)
    const prompt = (event: Event) => {
      event.preventDefault()
      setInstallPrompt(event as InstallPrompt)
    }
    const installed = () => {
      setInstalled(true)
      setInstallPrompt(undefined)
    }
    addEventListener('online', connection)
    addEventListener('offline', connection)
    addEventListener('beforeinstallprompt', prompt)
    addEventListener('appinstalled', installed)
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/sw.js', { updateViaCache: 'none' })
        .then(async (registration) => {
          const ready = await navigator.serviceWorker.ready
          if (ready.active) setCacheState('App & Alice available offline')
          if (registration.waiting) setUpdateReady(true)
          registration.addEventListener('updatefound', () => {
            const worker = registration.installing
            worker?.addEventListener('statechange', () => {
              if (
                worker.state === 'installed' &&
                navigator.serviceWorker.controller
              )
                setUpdateReady(true)
            })
          })
        })
        .catch(() =>
          setCacheState('Offline setup failed. Reopen while online to retry.'),
        )
    } else {
      setCacheState('Offline access is unavailable in this browser.')
    }
    return () => {
      removeEventListener('online', connection)
      removeEventListener('offline', connection)
      removeEventListener('beforeinstallprompt', prompt)
      removeEventListener('appinstalled', installed)
    }
  }, [])

  async function install() {
    if (!installPrompt) return
    setInstallError(false)
    try {
      await installPrompt.prompt()
      await installPrompt.userChoice
      setInstallPrompt(undefined)
    } catch {
      setInstallError(true)
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(location.origin + '/')
      setCopied(true)
      setCopyError(false)
    } catch {
      setCopyError(true)
    }
  }

  const linkControl = (
    <span className="pwa-link-control">
      <button type="button" onClick={copyLink}>
        {copied ? 'Link copied' : 'Copy app link'}
      </button>
      {copyError && (
        <span role="status">Copy this address: {location.origin}/</span>
      )}
    </span>
  )

  return (
    <ListeningApp
      persistSession
      homeHref="/"
      sessionActions={
        installed ? (
          <div className="pwa-session-help">
            {linkControl}
            <span>
              If Read aloud is missing, open this address in Edge. Import in
              Edge first; books stay in the browser where you opened them.
            </span>
          </div>
        ) : undefined
      }
    >
      <aside
        className="pwa-card"
        aria-label="Phone installation and offline access"
      >
        <div className="pwa-card-heading">
          <span className="pwa-icon" aria-hidden="true">
            ↓
          </span>
          <div>
            <h2>
              {installed ? 'Your pocket bookshelf' : 'Take your book with you'}
            </h2>
            <p>
              {offline ? 'Offline · ' : ''}
              {cacheState}
            </p>
          </div>
        </div>
        {!installed && (
          <>
            <p>
              On Android, open this address in <strong>Microsoft Edge</strong>,
              then use its menu to <strong>Add to Home screen</strong>.
              Depending on your browser, this installs an app or adds a
              shortcut.
            </p>
            {installPrompt && (
              <button
                className="listening-secondary"
                type="button"
                onClick={install}
              >
                Add to Home screen
              </button>
            )}
            {installError && (
              <p role="status">
                Use your browser menu to add this app to your home screen.
              </p>
            )}
          </>
        )}
        <p>
          Import your book in Edge, prepare the page, then choose{' '}
          <strong>Read aloud</strong> in Edge’s menu. If an installed window
          hides that menu, use <strong>Open in browser</strong>, or copy this
          link and paste it into Edge.
        </p>
        <div className="pwa-link-row">
          {linkControl}
          <span>Books stay in this browser; links do not transfer them.</span>
        </div>
        <p className="pwa-fine-print">
          Your most recent book and selected starting point stay on this device.
          Edge controls speech; online voices need a connection. Screen-off
          playback depends on Android and Edge.
        </p>
        <p className="pwa-fine-print">
          <a href="/source.zip" download>
            Source code
          </a>{' '}
          · <a href="/LICENSE.txt">AGPL-3.0 license</a>
        </p>
        {updateReady && (
          <p role="status">
            An update is ready. After listening, close all Flow windows and
            reopen to use it.
          </p>
        )}
      </aside>
    </ListeningApp>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
