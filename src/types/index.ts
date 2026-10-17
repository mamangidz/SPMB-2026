export type UserRole = 'admin' | 'user';

export interface UserAccount {
  id: string;
  no: number;
  venue: string;
  username: string;
  password: string;
  role: UserRole;
  ujiFungsi: string;
  tahap1Tasks: string[]; // ['foto gedung', 'foto ruangan', 'foto laptop', 'foto jaringan listrik', 'foto jaringan LAN']
  tahap2Dates: string[]; // e.g. ['20 Oktober 2026', '21 Oktober 2026', ...]
  isOnline?: boolean;
  lastLoginAt?: string;
  lastActiveAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

export type PhotoStage = 'persiapan' | 'pelaksanaan';
export type VerificationStatus = 'submitted' | 'verified' | 'rejected';

export interface PhotoCoordinates {
  latitude: number;
  longitude: number;
  accuracy: number;
  altitude?: number | null;
}

export interface PhotoUpload {
  id: string;
  userId: string;
  username: string;
  venue: string;
  stage: PhotoStage;
  category: string; // e.g., 'foto gedung' or '20 Oktober 2026'
  photoDate: string; // YYYY-MM-DD or formatted date
  photoTime: string; // HH:mm:ss
  latitude: number;
  longitude: number;
  accuracy: number;
  locationName: string;
  imageUrl: string; // base64 or watermarked data url
  status: VerificationStatus;
  driveFileId?: string;
  driveFileName?: string;
  driveFileUrl?: string;
  driveStatus?: 'synced' | 'local_only' | 'failed';
  notes?: string;
  adminComment?: string;
  createdAt: string;
}

export type NotificationType = 'login' | 'upload' | 'crud' | 'verify';

export interface SystemNotification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  venue?: string;
  username?: string;
  read: boolean;
  createdAt: string;
}

export interface ActivityLog {
  id: string;
  action: string;
  username: string;
  venue: string;
  details: string;
  createdAt: string;
}

export interface VenueGeoPreset {
  venue: string;
  city: string;
  province: string;
  lat: number;
  lng: number;
}
