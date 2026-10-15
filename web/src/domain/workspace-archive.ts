export type StoredWorkspaceArchive = {
  fileName: string;
  bytes: ArrayBuffer;
  savedAt: string;
};

export interface WorkspaceArchiveStorage {
  read(): Promise<StoredWorkspaceArchive | null>;
  write(archive: StoredWorkspaceArchive): Promise<void>;
  remove(): Promise<void>;
}

export class WorkspaceArchiveRepository {
  constructor(private readonly storage: WorkspaceArchiveStorage) {}

  async load(): Promise<StoredWorkspaceArchive | null> {
    try {
      const archive = await this.storage.read();
      if (!archive) return null;
      if (!archive.fileName.toLowerCase().endsWith('.zip') || archive.bytes.byteLength === 0 || Number.isNaN(Date.parse(archive.savedAt))) {
        throw new Error('The saved browser workspace is invalid. Choose the research ZIP again.');
      }
      return archive;
    } catch (cause) {
      if (cause instanceof Error && cause.message.includes('saved browser workspace is invalid')) throw cause;
      throw new Error('The saved research ZIP could not be read from this browser. Choose it again.');
    }
  }

  async save(archive: StoredWorkspaceArchive): Promise<StoredWorkspaceArchive> {
    if (!archive.fileName.toLowerCase().endsWith('.zip') || archive.bytes.byteLength === 0) {
      throw new Error('Only a non-empty research ZIP can be saved as the browser workspace.');
    }
    try {
      await this.storage.write(archive);
      const verified = await this.load();
      if (!verified || verified.fileName !== archive.fileName || verified.bytes.byteLength !== archive.bytes.byteLength) {
        throw new Error('The research ZIP was not readable after saving.');
      }
      return verified;
    } catch (cause) {
      if (cause instanceof Error && cause.message.includes('not readable after saving')) throw cause;
      throw new Error('The research ZIP could not be retained by this browser. Keep the original ZIP; you may need to select it again next time.');
    }
  }

  async clear(): Promise<void> {
    try {
      await this.storage.remove();
      if (await this.storage.read()) throw new Error('The saved research ZIP could not be removed.');
    } catch (cause) {
      if (cause instanceof Error && cause.message.includes('could not be removed')) throw cause;
      throw new Error('Browser storage is unavailable. The saved research ZIP could not be removed.');
    }
  }
}

const DATABASE_NAME = 'sautiforge-web';
const STORE_NAME = 'workspace';
const CURRENT_ARCHIVE_KEY = 'current-research-archive';

export class IndexedDbWorkspaceArchiveStorage implements WorkspaceArchiveStorage {
  async read(): Promise<StoredWorkspaceArchive | null> {
    const db = await openDatabase();
    try {
      return await requestResult(db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(CURRENT_ARCHIVE_KEY)) as StoredWorkspaceArchive | null;
    } finally {
      db.close();
    }
  }

  async write(archive: StoredWorkspaceArchive): Promise<void> {
    const db = await openDatabase();
    try {
      await transactionComplete(db.transaction(STORE_NAME, 'readwrite'), (store) => store.put(archive, CURRENT_ARCHIVE_KEY));
    } finally {
      db.close();
    }
  }

  async remove(): Promise<void> {
    const db = await openDatabase();
    try {
      await transactionComplete(db.transaction(STORE_NAME, 'readwrite'), (store) => store.delete(CURRENT_ARCHIVE_KEY));
    } finally {
      db.close();
    }
  }
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new Error('IndexedDB is unavailable.'));
      return;
    }
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB could not be opened.'));
  });
}

function requestResult(request: IDBRequest): Promise<unknown> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error ?? new Error('Browser storage request failed.'));
  });
}

function transactionComplete(transaction: IDBTransaction, action: (store: IDBObjectStore) => IDBRequest): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Browser storage transaction failed.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('Browser storage transaction was cancelled.'));
    action(transaction.objectStore(STORE_NAME));
  });
}
