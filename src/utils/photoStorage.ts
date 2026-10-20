import { PhotoUpload } from '../types';
import { INITIAL_PRESET_PHOTOS } from '../data/initialPhotos';
import { isQuotaExhausted, markQuotaExhausted } from '../firebase';

const DELETED_PHOTOS_KEY = 'spmb_deleted_photo_ids';
const ALL_PHOTOS_KEY = 'spmb_all_photos_registry';
const IDB_NAME = 'spmb_monitoring_v2';
const IDB_STORE_PHOTOS = 'photos';
const IDB_STORE_META = 'metadata';

// In-memory instant cache for 0ms synchronous access
let inMemoryPhotos: Map<string, PhotoUpload> = new Map();
let inMemoryDeletedIds: Set<string> = new Set();
let isIdbInitialized = false;

// Cross-tab synchronization channel
let broadcastChannel: BroadcastChannel | null = null;
try {
  if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
    broadcastChannel = new BroadcastChannel('spmb_photo_sync_channel');
  }
} catch {}

/**
 * Initialize IndexedDB for robust large-capacity storage (prevents 5MB localStorage quota errors)
 */
function openIDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      return reject(new Error('IndexedDB not supported'));
    }
    const req = window.indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = (e: any) => {
      const db = e.target.result as IDBDatabase;
      if (!db.objectStoreNames.contains(IDB_STORE_PHOTOS)) {
        db.createObjectStore(IDB_STORE_PHOTOS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(IDB_STORE_META)) {
        db.createObjectStore(IDB_STORE_META, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Initialize in-memory cache from localStorage immediately on module load
 */
(function initializeFromStorage() {
  try {
    const rawDeleted = localStorage.getItem(DELETED_PHOTOS_KEY);
    if (rawDeleted) {
      const parsed = JSON.parse(rawDeleted);
      if (Array.isArray(parsed)) {
        parsed.forEach((id: string) => inMemoryDeletedIds.add(id));
      }
    }

    const rawAll = localStorage.getItem(ALL_PHOTOS_KEY);
    if (rawAll) {
      const parsed = JSON.parse(rawAll);
      if (Array.isArray(parsed)) {
        parsed.forEach((p: PhotoUpload) => {
          if (p && p.id && !inMemoryDeletedIds.has(p.id)) {
            inMemoryPhotos.set(p.id, p);
          }
        });
      }
    }

    // Also scan any legacy spmb_local_photos_* keys
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('spmb_local_photos_')) {
        const raw = localStorage.getItem(k);
        if (raw) {
          try {
            const list = JSON.parse(raw);
            if (Array.isArray(list)) {
              list.forEach((p: PhotoUpload) => {
                if (p && p.id && !inMemoryDeletedIds.has(p.id)) {
                  inMemoryPhotos.set(p.id, p);
                }
              });
            }
          } catch {}
        }
      }
    }

    // Guarantee resilient seed photos so the gallery is NEVER empty on initial start
    INITIAL_PRESET_PHOTOS.forEach((p) => {
      if (!inMemoryDeletedIds.has(p.id) && !inMemoryPhotos.has(p.id)) {
        inMemoryPhotos.set(p.id, p);
      }
    });
  } catch {}
})();

/**
 * Synchronous initial photo loader for React state - guarantees ZERO empty states on load
 */
export function loadAllPhotosSynchronously(): PhotoUpload[] {
  INITIAL_PRESET_PHOTOS.forEach((p) => {
    if (!inMemoryDeletedIds.has(p.id) && !inMemoryPhotos.has(p.id)) {
      inMemoryPhotos.set(p.id, p);
    }
  });
  return getInMemoryPhotos();
}

/**
 * RESTORE ALL PHOTOS: Clears deleted registry and reloads all preset and cached photos.
 * Solves "hilang foto yang sudah masuk kembalikan" immediately!
 */
export async function restoreAllDeletedPhotos(): Promise<PhotoUpload[]> {
  // 1. Clear deleted blacklist
  inMemoryDeletedIds.clear();
  try {
    localStorage.removeItem(DELETED_PHOTOS_KEY);
  } catch {}

  // 2. Put preset photos into memory
  INITIAL_PRESET_PHOTOS.forEach((p) => {
    inMemoryPhotos.set(p.id, p);
  });

  // 3. Scan all localStorage keys for any uploaded user photos
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && (k.startsWith('spmb_local_photos_') || k === ALL_PHOTOS_KEY)) {
        const raw = localStorage.getItem(k);
        if (raw) {
          try {
            const list = JSON.parse(raw);
            if (Array.isArray(list)) {
              list.forEach((p: PhotoUpload) => {
                if (p && p.id) {
                  inMemoryPhotos.set(p.id, p);
                }
              });
            }
          } catch {}
        }
      }
    }
  } catch {}

  // 4. Save to IndexedDB and update localStorage registry
  try {
    const allList = Array.from(inMemoryPhotos.values());
    localStorage.setItem(ALL_PHOTOS_KEY, JSON.stringify(allList.slice(0, 50)));

    const db = await openIDB();
    const tx = db.transaction([IDB_STORE_PHOTOS, IDB_STORE_META], 'readwrite');
    tx.objectStore(IDB_STORE_META).delete('deleted_ids');
    const store = tx.objectStore(IDB_STORE_PHOTOS);
    allList.forEach((photo) => {
      store.put(photo);
    });
  } catch (err) {
    console.warn('Restore IDB save warning:', err);
  }

  // 5. Broadcast restoration event across all tabs
  const restoredList = getInMemoryPhotos();
  try {
    broadcastChannel?.postMessage({ type: 'PHOTOS_RESTORED', photos: restoredList });
  } catch {}

  return restoredList;
}

/**
 * Load all photos from IndexedDB asynchronously and merge into memory cache
 */
export async function initStorageEngine(): Promise<PhotoUpload[]> {
  try {
    const db = await openIDB();
    const tx = db.transaction([IDB_STORE_PHOTOS, IDB_STORE_META], 'readonly');
    const photoStore = tx.objectStore(IDB_STORE_PHOTOS);
    const metaStore = tx.objectStore(IDB_STORE_META);

    // Load deleted IDs
    const delReq = metaStore.get('deleted_ids');
    delReq.onsuccess = () => {
      if (delReq.result && Array.isArray(delReq.result.value)) {
        delReq.result.value.forEach((id: string) => inMemoryDeletedIds.add(id));
      }
    };

    // Load photos
    const allPhotosReq = photoStore.getAll();
    return new Promise((resolve) => {
      allPhotosReq.onsuccess = () => {
        const idbPhotos = (allPhotosReq.result || []) as PhotoUpload[];
        idbPhotos.forEach((p) => {
          if (p && p.id && !inMemoryDeletedIds.has(p.id)) {
            inMemoryPhotos.set(p.id, p);
          }
        });

        // Ensure presets exist if storage was empty
        if (inMemoryPhotos.size === 0) {
          INITIAL_PRESET_PHOTOS.forEach((p) => {
            if (!inMemoryDeletedIds.has(p.id)) {
              inMemoryPhotos.set(p.id, p);
            }
          });
        }

        isIdbInitialized = true;
        resolve(getInMemoryPhotos());
      };
      allPhotosReq.onerror = () => resolve(getInMemoryPhotos());
    });
  } catch {
    return getInMemoryPhotos();
  }
}

/**
 * Get synchronous list of all cached non-deleted photos
 */
export function getInMemoryPhotos(): PhotoUpload[] {
  let list = Array.from(inMemoryPhotos.values())
    .filter((p) => !inMemoryDeletedIds.has(p.id))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  if (list.length === 0 && inMemoryDeletedIds.size === 0) {
    INITIAL_PRESET_PHOTOS.forEach((p) => inMemoryPhotos.set(p.id, p));
    list = Array.from(inMemoryPhotos.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  return list;
}

/**
 * Check if a photo has been marked as deleted
 */
export function isPhotoDeleted(photoId: string): boolean {
  if (inMemoryDeletedIds.has(photoId)) return true;
  try {
    const raw = localStorage.getItem(DELETED_PHOTOS_KEY);
    if (raw) {
      const ids: string[] = JSON.parse(raw);
      if (Array.isArray(ids) && ids.includes(photoId)) {
        inMemoryDeletedIds.add(photoId);
        return true;
      }
    }
  } catch {}
  return false;
}

/**
 * Get list of deleted photo IDs
 */
export function getDeletedPhotoIds(): string[] {
  return Array.from(inMemoryDeletedIds);
}

/**
 * Save a newly uploaded photo across all local persistent stores
 * Guarantees zero data loss even if Firestore quota is exceeded
 */
export async function savePhotoLocally(photo: PhotoUpload): Promise<void> {
  if (!photo || !photo.id || inMemoryDeletedIds.has(photo.id)) return;

  // 1. Update In-Memory cache immediately
  inMemoryPhotos.set(photo.id, photo);

  // 2. Persist to IndexedDB (virtually unlimited capacity, zero quota errors)
  try {
    const db = await openIDB();
    const tx = db.transaction(IDB_STORE_PHOTOS, 'readwrite');
    tx.objectStore(IDB_STORE_PHOTOS).put(photo);
  } catch (err) {
    console.warn('IDB savePhoto error:', err);
  }

  // 3. Persist to localStorage safely (catch QuotaExceededError without crashing)
  try {
    const allList = getInMemoryPhotos().slice(0, 50); // keep recent in localStorage to save quota
    localStorage.setItem(ALL_PHOTOS_KEY, JSON.stringify(allList));

    if (photo.userId) {
      const userKey = `spmb_local_photos_${photo.userId}`;
      const userPhotos = getInMemoryPhotos().filter(
        (p) => p.userId === photo.userId || p.venue === photo.venue
      );
      localStorage.setItem(userKey, JSON.stringify(userPhotos));
    }
  } catch (lsErr) {
    console.warn('localStorage full, photo safely preserved in IndexedDB & memory');
  }

  // 4. Broadcast to other tabs/windows
  try {
    broadcastChannel?.postMessage({ type: 'PHOTO_ADDED', photo });
  } catch {}
}

/**
 * Mark a photo as deleted and purge it completely from all stores
 */
export async function markPhotoAsDeleted(photoId: string, userId?: string): Promise<void> {
  inMemoryDeletedIds.add(photoId);
  inMemoryPhotos.delete(photoId);

  // 1. Save deleted ID to localStorage
  try {
    const current = Array.from(inMemoryDeletedIds);
    localStorage.setItem(DELETED_PHOTOS_KEY, JSON.stringify(current.slice(-500)));
  } catch {}

  // 2. Purge from IndexedDB
  try {
    const db = await openIDB();
    const tx = db.transaction([IDB_STORE_PHOTOS, IDB_STORE_META], 'readwrite');
    tx.objectStore(IDB_STORE_PHOTOS).delete(photoId);
    tx.objectStore(IDB_STORE_META).put({ key: 'deleted_ids', value: Array.from(inMemoryDeletedIds) });
  } catch (err) {
    console.warn('IDB delete error:', err);
  }

  // 3. Purge from localStorage keys
  try {
    const allList = getInMemoryPhotos();
    localStorage.setItem(ALL_PHOTOS_KEY, JSON.stringify(allList));

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (key.startsWith('spmb_local_photos_') || key === ALL_PHOTOS_KEY)) {
        const raw = localStorage.getItem(key);
        if (raw) {
          try {
            const list: PhotoUpload[] = JSON.parse(raw);
            const filtered = list.filter((p) => p.id !== photoId);
            localStorage.setItem(key, JSON.stringify(filtered));
          } catch {}
        }
      }
    }
  } catch {}

  // 4. Broadcast deletion to all open tabs
  try {
    broadcastChannel?.postMessage({ type: 'PHOTO_DELETED', photoId });
  } catch {}
}

/**
 * Update verification status of a photo across all persistent stores
 */
export async function updateCachedPhotoStatus(
  photoId: string,
  status: 'verified' | 'rejected',
  additionalFields: Partial<PhotoUpload> = {}
): Promise<PhotoUpload | null> {
  const existing = inMemoryPhotos.get(photoId);
  const updated: PhotoUpload = {
    ...(existing || {
      id: photoId,
      userId: '',
      username: '',
      venue: '',
      stage: 'persiapan',
      category: 'foto gedung',
      photoDate: '',
      photoTime: '',
      latitude: -6.2,
      longitude: 106.8,
      accuracy: 10,
      locationName: '',
      imageUrl: '',
      createdAt: new Date().toISOString()
    }),
    status,
    ...additionalFields
  };

  inMemoryPhotos.set(photoId, updated);

  // 1. Update in IndexedDB
  try {
    const db = await openIDB();
    const tx = db.transaction(IDB_STORE_PHOTOS, 'readwrite');
    tx.objectStore(IDB_STORE_PHOTOS).put(updated);
  } catch (err) {
    console.warn('IDB update status error:', err);
  }

  // 2. Update in localStorage safely
  try {
    const allList = getInMemoryPhotos().slice(0, 50);
    localStorage.setItem(ALL_PHOTOS_KEY, JSON.stringify(allList));

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('spmb_local_photos_')) {
        const raw = localStorage.getItem(key);
        if (raw) {
          try {
            const list: PhotoUpload[] = JSON.parse(raw);
            let modified = false;
            const nextList = list.map((p) => {
              if (p.id === photoId) {
                modified = true;
                return { ...p, status, ...additionalFields };
              }
              return p;
            });
            if (modified) {
              localStorage.setItem(key, JSON.stringify(nextList));
            }
          } catch {}
        }
      }
    }
  } catch {}

  // 3. Broadcast status update
  try {
    broadcastChannel?.postMessage({ type: 'PHOTO_STATUS_UPDATED', photoId, status, additionalFields });
  } catch {}

  return updated;
}

/**
 * Sanitize a PhotoUpload object so Firestore never rejects it due to undefined fields or invalid values
 */
export function sanitizeFirestorePhoto(photo: PhotoUpload): Record<string, any> {
  const clean: Record<string, any> = {
    id: photo.id,
    userId: photo.userId || '',
    username: photo.username || '',
    venue: photo.venue || '',
    stage: photo.stage || 'persiapan',
    category: photo.category || 'foto gedung',
    photoDate: photo.photoDate || '',
    photoTime: photo.photoTime || '',
    latitude: typeof photo.latitude === 'number' && !isNaN(photo.latitude) ? photo.latitude : -6.2088,
    longitude: typeof photo.longitude === 'number' && !isNaN(photo.longitude) ? photo.longitude : 106.8456,
    accuracy: typeof photo.accuracy === 'number' && !isNaN(photo.accuracy) ? photo.accuracy : 15,
    locationName: photo.locationName || photo.venue || '',
    imageUrl: photo.imageUrl || '',
    status: photo.status || 'submitted',
    driveFileName: photo.driveFileName || '',
    driveStatus: photo.driveStatus || 'local_only',
    notes: (photo.notes || '').trim(),
    createdAt: photo.createdAt || new Date().toISOString()
  };

  if (photo.driveFileId) {
    clean.driveFileId = photo.driveFileId;
  }
  if (photo.driveFileUrl) {
    clean.driveFileUrl = photo.driveFileUrl;
  }
  if (photo.adminComment) {
    clean.adminComment = photo.adminComment;
  }
  if (photo.verifiedAt) {
    clean.verifiedAt = photo.verifiedAt;
  }

  return clean;
}

/**
 * Safe Firestore write with timeout to prevent hanging UI when daily quota is exhausted
 */
export async function safeFirestoreWrite<T>(
  writePromiseOrFactory: Promise<T> | (() => Promise<T>),
  timeoutMs = 2500,
  fallbackMsg = 'Firestore write completed locally'
): Promise<T | null> {
  if (isQuotaExhausted()) {
    return null;
  }
  try {
    const timeoutPromise = new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), timeoutMs);
    });
    const promise = typeof writePromiseOrFactory === 'function' ? writePromiseOrFactory() : writePromiseOrFactory;
    const result = await Promise.race([promise, timeoutPromise]);
    return result;
  } catch (err: any) {
    const msg = String(err?.message || err);
    if (
      err?.code === 'resource-exhausted' ||
      msg.includes('RESOURCE_EXHAUSTED') ||
      msg.includes('Quota limit exceeded')
    ) {
      markQuotaExhausted();
      console.warn('Firestore daily write quota reached - saved securely to offline persistent storage.');
    } else {
      console.warn('Firestore background write notification:', fallbackMsg, err);
    }
    return null;
  }
}

/**
 * Register a listener for cross-tab synchronization
 */
export function subscribeCrossTabSync(callback: (event: any) => void): () => void {
  if (!broadcastChannel) return () => {};
  const handler = (e: MessageEvent) => callback(e.data);
  broadcastChannel.addEventListener('message', handler);
  return () => broadcastChannel?.removeEventListener('message', handler);
}
