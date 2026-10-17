import {
  GoogleAuthProvider,
  signInWithPopup,
  onAuthStateChanged,
  User
} from 'firebase/auth';
import { auth } from '../firebase';

export const SCOPES = ['https://www.googleapis.com/auth/drive.file'];

const provider = new GoogleAuthProvider();
SCOPES.forEach((scope) => provider.addScope(scope));

// In-memory cache for access token (never store in localStorage/sessionStorage)
let cachedAccessToken: string | null = null;
let isSigningIn = false;

export const initDriveAuth = (
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: () => void
) => {
  return onAuthStateChanged(auth, async (user: User | null) => {
    if (user && cachedAccessToken) {
      if (onAuthSuccess) onAuthSuccess(user, cachedAccessToken);
    } else if (!isSigningIn) {
      if (onAuthFailure) onAuthFailure();
    }
  });
};

export const connectGoogleDrive = async (): Promise<{ user: User; accessToken: string } | null> => {
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Gagal mendapatkan access token Google Drive dari autentikasi.');
    }
    cachedAccessToken = credential.accessToken;
    return { user: result.user, accessToken: cachedAccessToken };
  } catch (err: unknown) {
    console.error('Google Sign-in Drive error:', err);
    throw err;
  } finally {
    isSigningIn = false;
  }
};

export const getDriveAccessToken = (): string | null => {
  return cachedAccessToken;
};

export const disconnectGoogleDrive = () => {
  cachedAccessToken = null;
};

/**
 * Standardized filename generation strictly matching the reference table data:
 * Format: [No]_[Venue]_[Username]_[Tahap]_[Kategori]_[Tanggal]_[Jam].jpg
 */
export function generateDriveFileName({
  no,
  venue,
  username,
  stage,
  category,
  photoDate,
  photoTime
}: {
  no: number;
  venue: string;
  username: string;
  stage: 'persiapan' | 'pelaksanaan';
  category: string;
  photoDate: string;
  photoTime: string;
}): string {
  const padNo = String(no || 1).padStart(2, '0');
  const cleanVenue = venue.replace(/[^a-zA-Z0-9]/g, '_');
  const cleanUser = username.replace(/[^a-zA-Z0-9]/g, '_');
  const stageName = stage === 'persiapan' ? 'Tahap1_Persiapan' : 'Tahap2_Pelaksanaan';
  const cleanCategory = category.replace(/[^a-zA-Z0-9]/g, '_');
  const cleanDate = photoDate.replace(/[^a-zA-Z0-9]/g, '_');
  const cleanTime = photoTime.replace(/[^0-9]/g, '').slice(0, 6) || '000000';

  return `${padNo}_${cleanVenue}_${cleanUser}_${stageName}_${cleanCategory}_${cleanDate}_${cleanTime}.jpg`;
}

/**
 * Get or create folder in Google Drive
 */
async function getOrCreateFolder(folderName: string, parentId?: string, token?: string): Promise<string | null> {
  const accessToken = token || cachedAccessToken;
  if (!accessToken) return null;

  try {
    // 1. Search existing folder
    let query = `mimeType = 'application/vnd.google-apps.folder' and name = '${folderName}' and trashed = false`;
    if (parentId) {
      query += ` and '${parentId}' in parents`;
    }

    const searchUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name)`;
    const searchRes = await fetch(searchUrl, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    if (searchRes.ok) {
      const searchData = await searchRes.json();
      if (searchData.files && searchData.files.length > 0) {
        return searchData.files[0].id;
      }
    }

    // 2. Create folder if not found
    const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder',
        parents: parentId ? [parentId] : undefined
      })
    });

    if (createRes.ok) {
      const folderData = await createRes.json();
      return folderData.id;
    }
  } catch (err) {
    console.warn('Failed to get/create Google Drive folder:', err);
  }
  return null;
}

export interface DriveUploadResult {
  fileId: string;
  fileName: string;
  webViewLink: string;
  folderName: string;
}

/**
 * Uploads watermarked photo to Google Drive with standardized filename
 */
export async function uploadPhotoToGoogleDrive({
  dataUrl,
  fileName,
  venue,
  token
}: {
  dataUrl: string;
  fileName: string;
  venue: string;
  token?: string;
}): Promise<DriveUploadResult> {
  const accessToken = token || cachedAccessToken;
  if (!accessToken) {
    throw new Error('Google Drive belum terhubung. Silakan hubungkan Google Drive terlebih dahulu.');
  }

  // 1. Create or get root folder 'Dokumentasi_Venue_BDK'
  const rootFolderId = await getOrCreateFolder('Dokumentasi_Venue_BDK', undefined, accessToken);

  // 2. Create or get venue subfolder (e.g. 'BDK Medan')
  const venueFolderId = rootFolderId
    ? await getOrCreateFolder(venue.replace(/[/\\?%*:|"<>]/g, '_'), rootFolderId, accessToken)
    : undefined;

  const targetFolderId = venueFolderId || rootFolderId;

  // 3. Extract base64 payload
  const parts = dataUrl.split(',');
  const mimeMatch = parts[0].match(/:(.*?);/);
  const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';
  const base64Data = parts[1];

  const boundary = '-------314159265358979323846';
  const delimiter = `\r\n--${boundary}\r\n`;
  const closeDelimiter = `\r\n--${boundary}--`;

  const metadata = {
    name: fileName,
    mimeType: mimeType,
    parents: targetFolderId ? [targetFolderId] : undefined,
    description: `Foto kegiatan venue ${venue} sesuai jadwal tabel penugasan`
  };

  const multipartRequestBody =
    delimiter +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify(metadata) +
    delimiter +
    `Content-Type: ${mimeType}\r\n` +
    'Content-Transfer-Encoding: base64\r\n\r\n' +
    base64Data +
    closeDelimiter;

  const uploadRes = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink,webContentLink',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`
      },
      body: multipartRequestBody
    }
  );

  if (!uploadRes.ok) {
    const errorBody = await uploadRes.text();
    console.error('Google Drive Upload failed:', errorBody);
    throw new Error(`Google Drive API Error: ${uploadRes.status} ${uploadRes.statusText}`);
  }

  const result = await uploadRes.json();

  return {
    fileId: result.id,
    fileName: result.name || fileName,
    webViewLink: result.webViewLink || `https://drive.google.com/file/d/${result.id}/view`,
    folderName: venue
  };
}
