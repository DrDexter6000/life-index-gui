import type { JournalMetadata } from '@/stores/journal-draft';

const DRAFT_STORAGE_PREFIX = 'life-index-gui:journal-draft:';
const ATTACHMENT_STORAGE_PREFIX = 'life-index-gui:journal-draft-attachments:';
const ATTACHMENT_DB_NAME = 'life-index-gui-drafts';
const ATTACHMENT_DB_VERSION = 1;
const ATTACHMENT_STORE = 'journalAttachments';

export interface PersistedJournalDraft {
  content: string;
  metadata: JournalMetadata;
  savedAt: string;
}

interface PersistedAttachmentSnapshot {
  name: string;
  type: string;
  lastModified: number;
  dataUrl: string;
}

interface IndexedAttachmentRecord {
  scope: string;
  files: File[];
}

export function createJournalDraftScope(params: {
  editId?: string;
  appendId?: string;
}): string {
  if (params.editId) return `edit:${params.editId}`;
  if (params.appendId) return `append:${params.appendId}`;
  return 'new';
}

export function hasRecoverableJournalDraft(content: string, metadata: JournalMetadata): boolean {
  const textFields = [
    metadata.title,
    metadata.location,
    metadata.weather,
    metadata.project,
    metadata.abstract,
  ];
  const listFields = [
    metadata.topics,
    metadata.moods,
    metadata.people,
    metadata.tags,
    metadata.links,
  ];

  return (
    content.trim().length > 0 ||
    textFields.some((field) => Boolean(field?.trim())) ||
    listFields.some((field) => Boolean(field?.length))
  );
}

export function readJournalDraft(scope: string): PersistedJournalDraft | null {
  try {
    const raw = window.localStorage.getItem(`${DRAFT_STORAGE_PREFIX}${scope}`);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<PersistedJournalDraft>;
    if (typeof parsed.content !== 'string' || !parsed.metadata || typeof parsed.savedAt !== 'string') {
      return null;
    }

    return {
      content: parsed.content,
      metadata: parsed.metadata as JournalMetadata,
      savedAt: parsed.savedAt,
    };
  } catch {
    return null;
  }
}

export function writeJournalDraft(
  scope: string,
  draft: Omit<PersistedJournalDraft, 'savedAt'>,
): void {
  try {
    window.localStorage.setItem(
      `${DRAFT_STORAGE_PREFIX}${scope}`,
      JSON.stringify({ ...draft, savedAt: new Date().toISOString() }),
    );
  } catch {
    // Browsers can reject localStorage in private mode or quota pressure.
  }
}

export function clearJournalDraft(scope: string): void {
  try {
    window.localStorage.removeItem(`${DRAFT_STORAGE_PREFIX}${scope}`);
  } catch {
    // Best-effort cache cleanup.
  }
}

function hasIndexedDB(): boolean {
  return typeof indexedDB !== 'undefined';
}

function openAttachmentDatabase(): Promise<IDBDatabase | null> {
  if (!hasIndexedDB()) return Promise.resolve(null);

  return new Promise((resolve) => {
    const request = indexedDB.open(ATTACHMENT_DB_NAME, ATTACHMENT_DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(ATTACHMENT_STORE)) {
        db.createObjectStore(ATTACHMENT_STORE, { keyPath: 'scope' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

function closeDatabase(db: IDBDatabase | null): void {
  try {
    db?.close();
  } catch {
    // Best-effort close.
  }
}

async function writeAttachmentsToIndexedDB(scope: string, files: File[]): Promise<boolean> {
  const db = await openAttachmentDatabase();
  if (!db) return false;

  return new Promise((resolve) => {
    const transaction = db.transaction(ATTACHMENT_STORE, 'readwrite');
    const store = transaction.objectStore(ATTACHMENT_STORE);
    store.put({ scope, files } satisfies IndexedAttachmentRecord);
    transaction.oncomplete = () => {
      closeDatabase(db);
      resolve(true);
    };
    transaction.onerror = () => {
      closeDatabase(db);
      resolve(false);
    };
    transaction.onabort = () => {
      closeDatabase(db);
      resolve(false);
    };
  });
}

async function readAttachmentsFromIndexedDB(scope: string): Promise<File[] | null> {
  const db = await openAttachmentDatabase();
  if (!db) return null;

  return new Promise((resolve) => {
    const transaction = db.transaction(ATTACHMENT_STORE, 'readonly');
    const store = transaction.objectStore(ATTACHMENT_STORE);
    const request = store.get(scope);

    request.onsuccess = () => {
      closeDatabase(db);
      const result = request.result as IndexedAttachmentRecord | undefined;
      resolve(Array.isArray(result?.files) ? result.files : null);
    };
    request.onerror = () => {
      closeDatabase(db);
      resolve(null);
    };
  });
}

async function clearAttachmentsFromIndexedDB(scope: string): Promise<void> {
  const db = await openAttachmentDatabase();
  if (!db) return;

  await new Promise<void>((resolve) => {
    const transaction = db.transaction(ATTACHMENT_STORE, 'readwrite');
    const store = transaction.objectStore(ATTACHMENT_STORE);
    store.delete(scope);
    transaction.oncomplete = () => {
      closeDatabase(db);
      resolve();
    };
    transaction.onerror = () => {
      closeDatabase(db);
      resolve();
    };
    transaction.onabort = () => {
      closeDatabase(db);
      resolve();
    };
  });
}

async function fileToDataUrl(file: File): Promise<string> {
  if (typeof FileReader !== 'undefined') {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ''));
      reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return `data:${file.type || 'application/octet-stream'};base64,${btoa(binary)}`;
}

function fileFromDataUrl(snapshot: PersistedAttachmentSnapshot): File | null {
  const commaIndex = snapshot.dataUrl.indexOf(',');
  if (commaIndex === -1) return null;

  try {
    const binary = atob(snapshot.dataUrl.slice(commaIndex + 1));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return new File([bytes], snapshot.name, {
      type: snapshot.type,
      lastModified: snapshot.lastModified,
    });
  } catch {
    return null;
  }
}

async function writeAttachmentsToLocalStorage(scope: string, files: File[]): Promise<void> {
  try {
    const snapshots: PersistedAttachmentSnapshot[] = [];
    for (const file of files) {
      snapshots.push({
        name: file.name,
        type: file.type,
        lastModified: file.lastModified,
        dataUrl: await fileToDataUrl(file),
      });
    }
    window.localStorage.setItem(`${ATTACHMENT_STORAGE_PREFIX}${scope}`, JSON.stringify(snapshots));
  } catch {
    // Attachment draft caching is best-effort under browser quota pressure.
  }
}

function readAttachmentsFromLocalStorage(scope: string): File[] {
  try {
    const raw = window.localStorage.getItem(`${ATTACHMENT_STORAGE_PREFIX}${scope}`);
    if (!raw) return [];

    const snapshots = JSON.parse(raw) as PersistedAttachmentSnapshot[];
    if (!Array.isArray(snapshots)) return [];

    return snapshots
      .map(fileFromDataUrl)
      .filter((file): file is File => file !== null);
  } catch {
    return [];
  }
}

function clearAttachmentsFromLocalStorage(scope: string): void {
  try {
    window.localStorage.removeItem(`${ATTACHMENT_STORAGE_PREFIX}${scope}`);
  } catch {
    // Best-effort cache cleanup.
  }
}

export async function saveJournalDraftAttachments(scope: string, files: File[]): Promise<void> {
  if (files.length === 0) {
    await clearJournalDraftAttachments(scope);
    return;
  }

  const wroteIndexedDB = await writeAttachmentsToIndexedDB(scope, files);
  if (wroteIndexedDB) {
    clearAttachmentsFromLocalStorage(scope);
    return;
  }

  await writeAttachmentsToLocalStorage(scope, files);
}

export async function readJournalDraftAttachments(scope: string): Promise<File[]> {
  const indexedFiles = await readAttachmentsFromIndexedDB(scope);
  if (indexedFiles?.length) return indexedFiles;

  return readAttachmentsFromLocalStorage(scope);
}

export async function clearJournalDraftAttachments(scope: string): Promise<void> {
  await clearAttachmentsFromIndexedDB(scope);
  clearAttachmentsFromLocalStorage(scope);
}
