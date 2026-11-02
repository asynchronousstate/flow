import { useEventListener } from '@literal-ui/hooks'
import { useLiveQuery } from 'dexie-react-hooks'
import { useRouter } from 'next/router'
import { parseCookies, destroyCookie } from 'nookies'
import { useEffect, useRef, useState } from 'react'

import {
  ColorScheme,
  useColorScheme,
  useForceRender,
  useTranslation,
} from '@flow/reader/hooks'
import { localeNames } from '@flow/reader/locales'
import { useSettings } from '@flow/reader/state'
import { dbx, mapToToken, OAUTH_SUCCESS_MESSAGE } from '@flow/reader/sync'

import readerPackage from '../../../package.json'
import {
  clearTemporaryFlowCache,
  deleteLocalFlowLibrary,
  exportLibraryBackup,
  PreparedLibraryBackup,
  readLegacyLibraryBackup,
  readLibraryBackup,
  restoreLibraryBackup,
} from '../../data-safety'
import { db } from '../../db'
import { reader } from '../../models'
import { Button } from '../Button'
import { Checkbox, Select } from '../Form'
import { Page } from '../Page'

export const Settings: React.FC = () => {
  const { scheme, setScheme } = useColorScheme()
  const { asPath, push, locale, locales } = useRouter()
  const [settings, setSettings] = useSettings()
  const t = useTranslation('settings')

  return (
    <Page headline={t('title')}>
      <div className="space-y-6">
        <Item title={t('language')}>
          <Select
            value={locale}
            onChange={(e) => {
              push(asPath, undefined, { locale: e.target.value })
            }}
          >
            {locales?.map((loc) => (
              <option key={loc} value={loc}>
                {localeNames[loc] || loc}
              </option>
            ))}
          </Select>
        </Item>
        <Item title={t('color_scheme')}>
          <Select
            value={scheme}
            onChange={(e) => {
              setScheme(e.target.value as ColorScheme)
            }}
          >
            <option value="system">{t('color_scheme.system')}</option>
            <option value="light">{t('color_scheme.light')}</option>
            <option value="dark">{t('color_scheme.dark')}</option>
          </Select>
        </Item>
        <Item title={t('text_selection_menu')}>
          <Checkbox
            name={t('text_selection_menu.enable')}
            checked={settings.enableTextSelectionMenu !== false}
            onChange={(e) => {
              setSettings({
                ...settings,
                enableTextSelectionMenu: e.target.checked,
              })
            }}
          />
        </Item>
        <Synchronization />
        <LocalData />
        <p className="typescale-body-small text-on-surface-variant">
          Flow Listening{' '}
          {readerPackage.version.split('.').slice(0, 2).join('.')}
        </p>
      </div>
    </Page>
  )
}

interface FlowDialogElement extends HTMLDialogElement {
  open: boolean
  showModal(): void
  close(): void
}

const LocalData: React.FC = () => {
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [backup, setBackup] = useState<PreparedLibraryBackup>()
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [confirmation, setConfirmation] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)
  const dialog = useRef<FlowDialogElement>(null)
  const cancelDelete = useRef<HTMLButtonElement>(null)
  const deleteTrigger = useRef<HTMLButtonElement>(null)
  const count = useLiveQuery(() => db?.books.count() ?? 0) ?? 0

  useEffect(() => {
    if (deleteOpen) {
      dialog.current?.showModal()
      cancelDelete.current?.focus()
    } else if (dialog.current?.open) {
      dialog.current.close()
      deleteTrigger.current?.focus()
    }
  }, [deleteOpen])

  useEffect(() => {
    const element = dialog.current
    if (!element) return
    const cancel = (event: Event) => {
      event.preventDefault()
      if (busy !== 'delete') setDeleteOpen(false)
    }
    element.addEventListener('cancel', cancel)
    return () => element.removeEventListener('cancel', cancel)
  }, [busy])

  async function run(action: string, operation: () => Promise<void>) {
    setBusy(action)
    setMessage('')
    setError('')
    try {
      await operation()
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Please try again.')
    } finally {
      setBusy('')
    }
  }

  function downloadBackup() {
    return run('export', async () => {
      await exportLibraryBackup()
      setMessage(
        'Backup download prepared. Check that the ZIP was saved before deleting local data.',
      )
    })
  }

  return (
    <>
      <Item title="Temporary cache">
        <p className="typescale-body-small mb-3">
          Clear downloaded app assets. Your books, reading progress, notes,
          Bookmarks and settings stay on this device. Cleared assets may need a
          connection to download again.
        </p>
        <Button
          type="button"
          variant="secondary"
          className="min-h-[44px]"
          disabled={!!busy}
          onClick={() =>
            run('cache', async () => {
              const removed = await clearTemporaryFlowCache()
              setMessage(
                removed
                  ? `Cleared ${removed} temporary app assets. Your library was kept.`
                  : 'No temporary app assets to clear. Your library was kept.',
              )
            })
          }
        >
          {busy === 'cache' ? 'Clearing…' : 'Clear temporary cache'}
        </Button>
      </Item>
      <Item title="Library backup">
        <p className="typescale-body-small mb-3">
          Save EPUB files, progress, notes, book appearance, Bookmarks and
          listening sessions in a ZIP. Global app settings and sign-in details
          are excluded. Restore adds missing books; existing books and their
          newer saved starts are kept.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            className="min-h-[44px]"
            disabled={!!busy}
            onClick={downloadBackup}
          >
            {busy === 'export'
              ? 'Preparing backup…'
              : 'Download library backup'}
          </Button>
          <Button
            type="button"
            variant="secondary"
            className="min-h-[44px]"
            disabled={!!busy}
            onClick={() => fileInput.current?.click()}
          >
            {busy === 'inspect' ? 'Reading backup…' : 'Restore backup'}
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept=".zip,application/zip"
            className="hidden"
            aria-label="Choose a Flow Listening backup ZIP"
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (!file) return
              setBackup(undefined)
              run('inspect', async () => {
                const prepared =
                  (await readLibraryBackup(file)) ||
                  (await readLegacyLibraryBackup(file))
                if (!prepared)
                  throw new Error(
                    'This ZIP does not contain a supported Flow library backup.',
                  )
                setBackup(prepared)
              })
            }}
          />
        </div>
        {backup && (
          <section
            className="border-outline/30 mt-4 space-y-3 rounded border p-3"
            aria-label="Review backup restore"
          >
            <p>
              Books: {backup.summary.books} · EPUB files: {backup.summary.files}{' '}
              · Saved Bookmarks: {backup.summary.bookmarks}
            </p>
            <p className="typescale-body-small">
              Add missing books only. Existing book IDs, progress, notes and
              listening choices will not be replaced. Books without an EPUB in
              the backup may need downloading again.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                className="min-h-[44px]"
                disabled={!!busy}
                onClick={() =>
                  run('restore', async () => {
                    const result = await restoreLibraryBackup(backup)
                    setBackup(undefined)
                    setMessage(
                      `Books restored: ${result.restored}. Existing books kept unchanged: ${result.skipped}.`,
                    )
                  })
                }
              >
                {busy === 'restore' ? 'Restoring…' : 'Add missing books'}
              </Button>
              <Button
                type="button"
                variant="secondary"
                className="min-h-[44px]"
                disabled={!!busy}
                onClick={() => setBackup(undefined)}
              >
                Cancel restore
              </Button>
            </div>
          </section>
        )}
      </Item>
      <Item title="Delete local library">
        <p className="typescale-body-small mb-3">
          Remove this site’s local EPUBs, progress, notes and listening data.
          App settings and remote Dropbox files stay unchanged. Download a
          backup first if you want to restore the library later.
        </p>
        <button
          ref={deleteTrigger}
          type="button"
          className="min-h-[44px] border border-red-700 px-3 py-2 text-red-700 dark:text-red-300"
          disabled={!!busy}
          onClick={() => {
            setConfirmation('')
            setMessage('')
            setError('')
            setDeleteOpen(true)
          }}
        >
          Review local deletion…
        </button>
      </Item>
      {!deleteOpen && message && (
        <p className="typescale-body-small" role="status">
          {message}
        </p>
      )}
      {!deleteOpen && error && (
        <p
          className="typescale-body-small text-red-700 dark:text-red-300"
          role="alert"
        >
          {error}
        </p>
      )}
      <dialog
        ref={dialog}
        className="bg-surface text-on-surface border-outline/30 backdrop:bg-black/40 m-auto w-[calc(100%_-_2rem)] max-w-lg overflow-y-auto border p-5"
        aria-labelledby="delete-library-title"
        aria-describedby="delete-library-description"
      >
        <h2 id="delete-library-title" className="typescale-title-large">
          Delete {count} local {count === 1 ? 'book' : 'books'}?
        </h2>
        <p id="delete-library-description" className="my-3">
          This removes this Flow library’s EPUBs, covers, reading progress,
          notes, Bookmarks and prepared listening sessions on this browser
          profile. Other databases, app settings and remote Dropbox files are
          kept. You can restore removed data only from a saved backup.
        </p>
        <Button
          type="button"
          variant="secondary"
          className="min-h-[44px]"
          disabled={!!busy}
          onClick={downloadBackup}
        >
          {busy === 'export' ? 'Preparing backup…' : 'Download backup first'}
        </Button>
        <label className="mt-4 block" htmlFor="delete-library-confirmation">
          Type DELETE to enable deletion
        </label>
        <input
          id="delete-library-confirmation"
          className="bg-surface border-outline mt-2 min-h-[44px] w-full border p-2"
          value={confirmation}
          autoComplete="off"
          spellCheck={false}
          disabled={busy === 'delete'}
          onChange={(event) => setConfirmation(event.target.value)}
        />
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            ref={cancelDelete}
            type="button"
            className="bg-outline/10 min-h-[44px] px-3 py-2"
            disabled={busy === 'delete'}
            onClick={() => setDeleteOpen(false)}
          >
            Cancel
          </button>
          <Button
            type="button"
            className="min-h-[44px]"
            disabled={!!busy || confirmation !== 'DELETE'}
            onClick={() =>
              run('delete', async () => {
                await deleteLocalFlowLibrary(confirmation)
                setDeleteOpen(false)
                reader.clear()
                window.location.assign('/')
              })
            }
          >
            {busy === 'delete' ? 'Deleting…' : 'Delete local library'}
          </Button>
        </div>
        {message && (
          <p className="typescale-body-small mt-3" role="status">
            {message}
          </p>
        )}
        {error && (
          <p
            className="typescale-body-small mt-3 text-red-700 dark:text-red-300"
            role="alert"
          >
            {error}
          </p>
        )}
      </dialog>
    </>
  )
}

const Synchronization: React.FC = () => {
  const cookies = parseCookies()
  const refreshToken = cookies[mapToToken['dropbox']]
  const render = useForceRender()
  const t = useTranslation('settings.synchronization')

  useEventListener('message', (e) => {
    if (e.data === OAUTH_SUCCESS_MESSAGE) {
      // init app (generate access token, fetch remote data, etc.)
      window.location.reload()
    }
  })

  return (
    <Item title={t('title')}>
      <Select>
        <option value="dropbox">Dropbox</option>
      </Select>
      <div className="mt-2">
        {refreshToken ? (
          <Button
            variant="secondary"
            onClick={() => {
              destroyCookie(null, mapToToken['dropbox'])
              render()
            }}
          >
            {t('unauthorize')}
          </Button>
        ) : (
          <Button
            onClick={() => {
              const redirectUri =
                window.location.origin + '/api/callback/dropbox'

              dbx.auth
                .getAuthenticationUrl(
                  redirectUri,
                  JSON.stringify({ redirectUri }),
                  'code',
                  'offline',
                )
                .then((url) => {
                  window.open(url as string, '_blank')
                })
            }}
          >
            {t('authorize')}
          </Button>
        )}
      </div>
    </Item>
  )
}

interface PartProps {
  title: string
}
const Item: React.FC<PartProps> = ({ title, children }) => {
  return (
    <div>
      <h3 className="typescale-title-small text-on-surface-variant">{title}</h3>
      <div className="mt-2">{children}</div>
    </div>
  )
}

Settings.displayName = 'settings'
