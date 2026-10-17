import { PhotoUpload } from '../types';

const DELETED_PHOTOS_KEY = 'spmb_deleted_photo_ids';

/**
 * Get list of IDs of photos that were deleted by admin
 */
export function getDeletedPhotoIds(): string[] {
  try {
    const raw = localStorage.getItem(DELETED_PHOTOS_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/**
 * Check if a photo ID has been marked as deleted
 */
export function isPhotoDeleted(photoId: string): boolean {
  const ids = getDeletedPhotoIds();
  return ids.includes(photoId);
}

/**
 * Mark a photo as deleted and purge it from all local storage caches
 */
export function markPhotoAsDeleted(photoId: string, userId?: string): void {
  try {
    // 1. Add to deleted IDs registry
    const current = getDeletedPhotoIds();
    if (!current.includes(photoId)) {
      current.push(photoId);
      localStorage.setItem(DELETED_PHOTOS_KEY, JSON.stringify(current.slice(-500))); // keep last 500
    }

    // 2. Purge from specific user's local photo cache if known
    if (userId) {
      const userKey = `spmb_local_photos_${userId}`;
      const raw = localStorage.getItem(userKey);
      if (raw) {
        try {
          const list: PhotoUpload[] = JSON.parse(raw);
          const filtered = list.filter((p) => p.id !== photoId);
          localStorage.setItem(userKey, JSON.stringify(filtered));
        } catch {}
      }
    }

    // 3. Purge across any other spmb_local_photos_* keys in localStorage
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('spmb_local_photos_')) {
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
  } catch (err) {
    console.warn('Failed to purge photo from localStorage:', err);
  }
}
