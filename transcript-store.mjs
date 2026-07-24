const DB_NAME = 'saymee-db';
const DB_VERSION = 1;
const SESSION_STORE = 'sessions';
const SEGMENT_STORE = 'segments';

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB request failed.'));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('IndexedDB transaction failed.'));
    transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction aborted.'));
  });
}

export class TranscriptStore {
  constructor(indexedDb = globalThis.indexedDB) {
    this.indexedDb = indexedDb;
    this.databasePromise = null;
  }

  async open() {
    if (!this.indexedDb) throw new Error('INDEXEDDB_UNAVAILABLE|Trình duyệt không cung cấp IndexedDB.');
    if (this.databasePromise) return this.databasePromise;

    this.databasePromise = new Promise((resolve, reject) => {
      const request = this.indexedDb.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(SESSION_STORE)) {
          const sessions = database.createObjectStore(SESSION_STORE, { keyPath: 'id' });
          sessions.createIndex('startedAt', 'startedAt');
        }
        if (!database.objectStoreNames.contains(SEGMENT_STORE)) {
          const segments = database.createObjectStore(SEGMENT_STORE, { keyPath: 'id' });
          segments.createIndex('sessionId', 'sessionId');
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        this.databasePromise = null;
        reject(request.error || new Error('Không mở được IndexedDB.'));
      };
      request.onblocked = () => {
        this.databasePromise = null;
        reject(new Error('IndexedDB đang bị chặn bởi một phiên Saymee cũ.'));
      };
    });
    return this.databasePromise;
  }

  async putSession(session) {
    const database = await this.open();
    const transaction = database.transaction(SESSION_STORE, 'readwrite');
    transaction.objectStore(SESSION_STORE).put({ ...session });
    await transactionDone(transaction);
    return session;
  }

  async getSession(sessionId) {
    const database = await this.open();
    const transaction = database.transaction(SESSION_STORE, 'readonly');
    const result = await requestResult(transaction.objectStore(SESSION_STORE).get(sessionId));
    await transactionDone(transaction);
    return result || null;
  }

  async getLatestSession() {
    const database = await this.open();
    const transaction = database.transaction(SESSION_STORE, 'readonly');
    const request = transaction.objectStore(SESSION_STORE).index('startedAt').openCursor(null, 'prev');
    const result = await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result?.value || null);
      request.onerror = () => reject(request.error || new Error('Không đọc được phiên gần nhất.'));
    });
    await transactionDone(transaction);
    return result;
  }

  async putSegment(segment) {
    if (!segment?.final) return segment;
    const database = await this.open();
    const transaction = database.transaction(SEGMENT_STORE, 'readwrite');
    transaction.objectStore(SEGMENT_STORE).put({ ...segment });
    await transactionDone(transaction);
    return segment;
  }

  async getSegments(sessionId) {
    if (!sessionId) return [];
    const database = await this.open();
    const transaction = database.transaction(SEGMENT_STORE, 'readonly');
    const request = transaction.objectStore(SEGMENT_STORE).index('sessionId').getAll(sessionId);
    const segments = await requestResult(request);
    await transactionDone(transaction);
    return (segments || []).sort((left, right) => (
      (left.startMs ?? left.receivedAt ?? 0) - (right.startMs ?? right.receivedAt ?? 0)
    ));
  }

  async clearSegments(sessionId) {
    if (!sessionId) return;
    const database = await this.open();
    const transaction = database.transaction(SEGMENT_STORE, 'readwrite');
    const index = transaction.objectStore(SEGMENT_STORE).index('sessionId');
    const request = index.openCursor(sessionId);
    await new Promise((resolve, reject) => {
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve();
          return;
        }
        cursor.delete();
        cursor.continue();
      };
      request.onerror = () => reject(request.error || new Error('Không xóa được transcript.'));
    });
    await transactionDone(transaction);
  }
}
