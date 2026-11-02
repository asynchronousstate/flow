export interface ListeningPreferences {
  start: number
  end: number
  paragraph: number
  includeImageDescriptions: boolean
  prepared: boolean
}

export interface SavedListeningBook {
  data: ArrayBuffer
  preferences: ListeningPreferences
}

const databaseName = 'flow-listening'
const storeName = 'session'
const activeKey = 'active-book'

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('This browser does not offer local book storage.'))
      return
    }
    const request = indexedDB.open(databaseName, 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore(storeName)
    }
    request.onerror = () => reject(request.error)
    request.onblocked = () =>
      reject(
        new Error('Close other listening windows to enable local storage.'),
      )
    request.onsuccess = () => resolve(request.result)
  })
}

async function withStore<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const database = await openDatabase()
  return new Promise<T>((resolve, reject) => {
    const transaction = database.transaction(storeName, mode)
    const request = operation(transaction.objectStore(storeName))
    transaction.oncomplete = () => {
      database.close()
      resolve(request.result)
    }
    transaction.onabort = transaction.onerror = () => {
      database.close()
      reject(transaction.error ?? request.error)
    }
  })
}

export function readSavedListeningBook(): Promise<
  SavedListeningBook | undefined
> {
  return withStore('readonly', (store) => store.get(activeKey))
}

export async function saveListeningBook(
  book: SavedListeningBook,
): Promise<void> {
  await withStore('readwrite', (store) => store.put(book, activeKey))
}

export async function forgetListeningBook(): Promise<void> {
  await withStore('readwrite', (store) => store.delete(activeKey))
}
