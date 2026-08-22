export interface CachedDocument {
  name: string;
  content: string;
  revision: string | null;
  updatedAt: string;
  cachedAt: string;
}

export interface PendingSave extends CachedDocument {
  queuedAt: string;
}

const databaseName = 'screenwriter-offline';
const databaseVersion = 1;

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, databaseVersion);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains('documents')) database.createObjectStore('documents', { keyPath: 'name' });
      if (!database.objectStoreNames.contains('outbox')) database.createObjectStore('outbox', { keyPath: 'name' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function storeRequest<T>(storeName: 'documents' | 'outbox', mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, mode);
    const request = operation(transaction.objectStore(storeName));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => database.close();
    transaction.onerror = () => reject(transaction.error);
  });
}

export function cacheDocument(document: CachedDocument) {
  return storeRequest('documents', 'readwrite', (store) => store.put(document));
}

export async function cachedDocument(name: string): Promise<CachedDocument | undefined> {
  return storeRequest('documents', 'readonly', (store) => store.get(name));
}

export async function cachedDocuments(): Promise<CachedDocument[]> {
  return storeRequest('documents', 'readonly', (store) => store.getAll());
}

export async function queueSave(document: CachedDocument): Promise<void> {
  await cacheDocument(document);
  await storeRequest('outbox', 'readwrite', (store) => store.put({ ...document, queuedAt: new Date().toISOString() } satisfies PendingSave));
}

export async function pendingSaves(): Promise<PendingSave[]> {
  return storeRequest('outbox', 'readonly', (store) => store.getAll());
}

export async function removePendingSave(name: string): Promise<void> {
  await storeRequest('outbox', 'readwrite', (store) => store.delete(name));
}

export function conflictCopyName(name: string, now = new Date()): string {
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const match = name.match(/^(.*?)(\.(?:fountain|txt))$/i);
  return `${match?.[1] || name} (offline conflict ${stamp})${match?.[2] || '.fountain'}`;
}
