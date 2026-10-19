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

/**
 * Update a photo's verification status across local storage caches
 */
export function updateCachedPhotoStatus(
  photoId: string,
  status: 'verified' | 'rejected',
  additionalFields: Partial<PhotoUpload> = {}
): void {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('spmb_local_photos_')) {
        const raw = localStorage.getItem(key);
        if (raw) {
          try {
            const list: PhotoUpload[] = JSON.parse(raw);
            let modified = false;
            const updated = list.map((p) => {
              if (p.id === photoId) {
                modified = true;
                return {
                  ...p,
                  status,
                  ...additionalFields
                };
              }
              return p;
            });
            if (modified) {
              localStorage.setItem(key, JSON.stringify(updated));
            }
          } catch {}
        }
      }
    }
  } catch (err) {
    console.warn('Failed to update photo status in localStorage:', err);
  }
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
 * Sync all unsynced local photos in localStorage to Firestore
 */
export async function syncLocalPhotosToFirestore(db: any): Promise<number> {
  let count = 0;
  try {
    const { doc, setDoc } = await import('firebase/firestore');
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('spmb_local_photos_')) {
        const raw = localStorage.getItem(key);
        if (raw) {
          try {
            const list: PhotoUpload[] = JSON.parse(raw);
            if (Array.isArray(list)) {
              for (const p of list) {
                if (p && p.id && !isPhotoDeleted(p.id)) {
                  try {
                    const clean = sanitizeFirestorePhoto(p);
                    await setDoc(doc(db, 'photos', p.id), clean, { merge: true });
                    count++;
                  } catch (itemErr) {
                    console.warn('Sync individual local photo error:', p.id, itemErr);
                  }
                }
              }
            }
          } catch {}
        }
      }
    }
  } catch (err) {
    console.warn('syncLocalPhotosToFirestore error:', err);
  }
  return count;
}
