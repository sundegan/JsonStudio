const DB_NAME = 'jsonstudio_documents';
const DB_VERSION = 1;
const STORE_NAME = 'documents';
const DEFAULT_PERSIST_DEBOUNCE_MS = 500;
const LARGE_DOCUMENT_THRESHOLD_BYTES = 512 * 1024;
const LARGE_DOCUMENT_PERSIST_DEBOUNCE_MS = 3_000;
const IDLE_PERSIST_TIMEOUT_MS = 30_000;

type PendingWrite = {
  content: string;
  timer: ReturnType<typeof setTimeout> | null;
  idleId: number | null;
};

const documents = new Map<string, string>();
const pendingWrites = new Map<string, PendingWrite>();
let dbPromise: Promise<IDBDatabase | null> | null = null;

function canUseIndexedDb() {
  return typeof indexedDB !== 'undefined';
}

function openDatabase(): Promise<IDBDatabase | null> {
  if (!canUseIndexedDb()) return Promise.resolve(null);
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      console.error('Failed to open document IndexedDB:', request.error);
      resolve(null);
    };
  });

  return dbPromise;
}

async function writeDocumentToIndexedDb(tabId: string, content: string) {
  const db = await openDatabase();
  if (!db) return;

  await new Promise<void>((resolve) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    store.put(content, tabId);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => {
      console.error('Failed to persist document content:', transaction.error);
      resolve();
    };
  });
}

async function deleteDocumentFromIndexedDb(tabId: string) {
  const db = await openDatabase();
  if (!db) return;

  await new Promise<void>((resolve) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).delete(tabId);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => {
      console.error('Failed to delete document content:', transaction.error);
      resolve();
    };
  });
}

async function clearDocumentsFromIndexedDb() {
  const db = await openDatabase();
  if (!db) return;

  await new Promise<void>((resolve) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).clear();
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => {
      console.error('Failed to clear document content:', transaction.error);
      resolve();
    };
  });
}

function cancelPendingWrite(pending: PendingWrite | undefined) {
  if (!pending) return;
  if (pending.timer) clearTimeout(pending.timer);
  if (pending.idleId !== null && typeof cancelIdleCallback !== 'undefined') {
    cancelIdleCallback(pending.idleId);
  }
}

function requestIdleWrite(callback: () => void): number | null {
  if (typeof requestIdleCallback === 'undefined') {
    callback();
    return null;
  }
  return requestIdleCallback(callback, { timeout: IDLE_PERSIST_TIMEOUT_MS });
}

function getPersistDelay(content: string, delayMs?: number) {
  if (delayMs !== undefined) return delayMs;
  return content.length > LARGE_DOCUMENT_THRESHOLD_BYTES
    ? LARGE_DOCUMENT_PERSIST_DEBOUNCE_MS
    : DEFAULT_PERSIST_DEBOUNCE_MS;
}

function schedulePersistDocument(tabId: string, content: string, delayMs?: number) {
  const pending = pendingWrites.get(tabId);
  cancelPendingWrite(pending);

  const nextPending: PendingWrite = {
    content,
    timer: setTimeout(() => {
      nextPending.timer = null;
      nextPending.idleId = requestIdleWrite(() => {
        pendingWrites.delete(tabId);
        void writeDocumentToIndexedDb(tabId, nextPending.content);
      });
    }, getPersistDelay(content, delayMs)),
    idleId: null,
  };
  pendingWrites.set(tabId, nextPending);
}

export function setDocumentContent(
  tabId: string,
  content: string,
  options: { persist?: boolean; delayMs?: number } = {},
) {
  documents.set(tabId, content);
  if (options.persist !== false) schedulePersistDocument(tabId, content, options.delayMs);
}

export function getDocumentContent(tabId: string): string {
  return documents.get(tabId) ?? '';
}

export function hasDocumentContent(tabId: string): boolean {
  return documents.has(tabId);
}

export async function loadDocumentContent(tabId: string): Promise<string> {
  if (documents.has(tabId)) return documents.get(tabId) ?? '';

  const db = await openDatabase();
  if (!db) return '';

  return await new Promise<string>((resolve) => {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const request = transaction.objectStore(STORE_NAME).get(tabId);
    request.onsuccess = () => {
      const content = typeof request.result === 'string' ? request.result : '';
      documents.set(tabId, content);
      resolve(content);
    };
    request.onerror = () => {
      console.error('Failed to load document content:', request.error);
      resolve('');
    };
  });
}

export function removeDocumentContent(tabId: string) {
  documents.delete(tabId);
  cancelPendingWrite(pendingWrites.get(tabId));
  pendingWrites.delete(tabId);
  void deleteDocumentFromIndexedDb(tabId);
}

export function flushDocumentPersistence() {
  const writes = Array.from(pendingWrites.entries());
  pendingWrites.clear();
  for (const [tabId, pending] of writes) {
    cancelPendingWrite(pending);
    void writeDocumentToIndexedDb(tabId, pending.content);
  }
}

export function clearDocumentContents() {
  for (const pending of pendingWrites.values()) {
    cancelPendingWrite(pending);
  }
  pendingWrites.clear();
  documents.clear();
  void clearDocumentsFromIndexedDb();
}
