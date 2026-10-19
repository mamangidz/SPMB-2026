import { PhotoUpload } from '../types';
import { VENUE_GEO_PRESETS } from './initialData';

/**
 * Generate an indelible SVG data URL image that visually mimics a real camera capture
 * with venue architecture/lab background and an official digital watermark banner.
 */
function createWatermarkedSvg(
  venue: string,
  category: string,
  username: string,
  city: string,
  lat: number,
  lng: number,
  photoDate: string,
  photoTime: string,
  bgType: 'building' | 'room' | 'laptop' | 'electricity' | 'lan'
): string {
  // Color themes for realistic venue equipment/facilities
  const themes = {
    building: { g1: '#0f172a', g2: '#1e293b', g3: '#0369a1', accent: '#38bdf8', icon: '🏛️ GEDUNG VENUE' },
    room: { g1: '#111827', g2: '#1f2937', g3: '#4338ca', accent: '#818cf8', icon: '🏢 RUANG UJIAN SPMB' },
    laptop: { g1: '#090d16', g2: '#1e1b4b', g3: '#312e81', accent: '#a5b4fc', icon: '💻 LAPTOP PESERTA CBT' },
    electricity: { g1: '#1c1917', g2: '#292524', g3: '#b45309', accent: '#fbbf24', icon: '⚡ PANEL & GENSET LISTRIK' },
    lan: { g1: '#022c22', g2: '#064e3b', g3: '#047857', accent: '#34d399', icon: '🌐 RACK SWITCH & KABEL LAN' }
  };

  const theme = themes[bgType] || themes.building;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="640" viewBox="0 0 960 640">
    <defs>
      <linearGradient id="skyGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${theme.g1}" />
        <stop offset="60%" stop-color="${theme.g2}" />
        <stop offset="100%" stop-color="${theme.g3}" />
      </linearGradient>
      <linearGradient id="overlayGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="rgba(15,23,42,0)" />
        <stop offset="50%" stop-color="rgba(15,23,42,0.85)" />
        <stop offset="100%" stop-color="rgba(15,23,42,0.98)" />
      </linearGradient>
      <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
        <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(255,255,255,0.04)" stroke-width="1" />
      </pattern>
    </defs>

    <!-- Photo Canvas Background -->
    <rect width="960" height="640" fill="url(#skyGrad)" />
    <rect width="960" height="480" fill="url(#grid)" />

    <!-- Facility Illustration / Graphic -->
    <g opacity="0.35" transform="translate(80, 60)">
      <rect x="60" y="80" width="680" height="260" rx="16" fill="rgba(255,255,255,0.06)" stroke="${theme.accent}" stroke-width="2" />
      <circle cx="120" cy="140" r="32" fill="${theme.accent}" opacity="0.2" />
      <text x="120" y="148" font-family="'Plus Jakarta Sans', sans-serif" font-size="24" fill="${theme.accent}" text-anchor="middle">STAN</text>
      <text x="400" y="190" font-family="'Plus Jakarta Sans', sans-serif" font-size="28" font-weight="bold" fill="#ffffff" text-anchor="middle">SPMB PKN STAN 2026</text>
      <text x="400" y="230" font-family="'Plus Jakarta Sans', sans-serif" font-size="18" fill="${theme.accent}" text-anchor="middle">${theme.icon}</text>
      <text x="400" y="270" font-family="'JetBrains Mono', monospace" font-size="14" fill="#94a3b8" text-anchor="middle">DOKUMENTASI RESMI: ${venue.toUpperCase()} — ${category.toUpperCase()}</text>
    </g>

    <!-- Center Camera Crosshairs -->
    <circle cx="480" cy="240" r="48" fill="none" stroke="rgba(255,255,255,0.2)" stroke-width="1.5" stroke-dasharray="6,4" />
    <line x1="480" y1="180" x2="480" y2="210" stroke="${theme.accent}" stroke-width="2" />
    <line x1="480" y1="270" x2="480" y2="300" stroke="${theme.accent}" stroke-width="2" />
    <line x1="420" y1="240" x2="450" y2="240" stroke="${theme.accent}" stroke-width="2" />
    <line x1="510" y1="240" x2="540" y2="240" stroke="${theme.accent}" stroke-width="2" />

    <!-- Indelible Security Watermark Banner -->
    <rect x="0" y="440" width="960" height="200" fill="url(#overlayGrad)" />
    <rect x="0" y="440" width="960" height="3" fill="${theme.accent}" />

    <!-- Watermark Stamp Content -->
    <g transform="translate(32, 472)">
      <!-- Line 1: Venue & Task -->
      <text x="0" y="0" font-family="'Plus Jakarta Sans', sans-serif" font-size="18" font-weight="bold" fill="#ffffff">
        📍 ${venue.toUpperCase()} — TAHAP 1 (PERSIAPAN): ${category.toUpperCase()}
      </text>

      <!-- Line 2: Petugas & Location -->
      <text x="0" y="26" font-family="'Plus Jakarta Sans', sans-serif" font-size="14" font-weight="600" fill="#cbd5e1">
        👤 Petugas: ${username} | Wilayah: ${city} (GPS Riil)
      </text>

      <!-- Line 3: GPS Coordinates & Accuracy -->
      <text x="0" y="52" font-family="'JetBrains Mono', monospace" font-size="14" font-weight="500" fill="${theme.accent}">
        🌐 GPS: ${lat.toFixed(6)}°, ${lng.toFixed(6)}° (Akurasi: ±8m)
      </text>

      <!-- Line 4: Date & Time -->
      <text x="0" y="78" font-family="'JetBrains Mono', monospace" font-size="15" font-weight="bold" fill="#fde047">
        ⏱ WAKTU: ${photoDate} ${photoTime}
      </text>

      <!-- Right Column: Verification Seal -->
      <text x="896" y="0" font-family="'Plus Jakarta Sans', sans-serif" font-size="13" font-weight="bold" fill="#10b981" text-anchor="end">
        ✓ VERIFIKASI DIGITAL VENUE
      </text>
      <text x="896" y="24" font-family="'JetBrains Mono', monospace" font-size="12" fill="#94a3b8" text-anchor="end">
        SPMB-STAN-2026
      </text>
      <text x="896" y="48" font-family="'JetBrains Mono', monospace" font-size="11" fill="#64748b" text-anchor="end">
        SECURE GEO-TAGGED
      </text>
    </g>
  </svg>`;

  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

/**
 * Standard seed photos across venues to guarantee the system is NEVER empty
 * and can be completely restored at any time.
 */
export const INITIAL_PRESET_PHOTOS: PhotoUpload[] = [
  // BDK Medan (muklis) - Full Tahap 1 tasks
  {
    id: 'seed_photo_medan_1',
    userId: 'user_1',
    username: 'muklis',
    venue: 'BDK Medan',
    stage: 'persiapan',
    category: 'foto gedung',
    photoDate: '19 Oktober 2026',
    photoTime: '08:15:30 WIB',
    latitude: VENUE_GEO_PRESETS['BDK Medan'].lat,
    longitude: VENUE_GEO_PRESETS['BDK Medan'].lng,
    accuracy: 9,
    locationName: 'Medan, Sumatera Utara',
    imageUrl: createWatermarkedSvg(
      'BDK Medan',
      'foto gedung',
      'muklis',
      'Medan',
      VENUE_GEO_PRESETS['BDK Medan'].lat,
      VENUE_GEO_PRESETS['BDK Medan'].lng,
      '19 Oktober 2026',
      '08:15:30 WIB',
      'building'
    ),
    status: 'verified',
    driveFileName: '01_BDK Medan_muklis_persiapan_foto gedung_19 Oktober 2026_08.15.30 WIB.jpg',
    driveStatus: 'synced',
    notes: 'Kondisi fasad gedung BDK Medan siap digunakan untuk seleksi SPMB 2026.',
    adminComment: 'Foto telah diverifikasi dan sah.',
    verifiedAt: '2026-10-19T01:30:00.000Z',
    createdAt: '2026-10-19T01:15:30.000Z'
  },
  {
    id: 'seed_photo_medan_2',
    userId: 'user_1',
    username: 'muklis',
    venue: 'BDK Medan',
    stage: 'persiapan',
    category: 'foto ruangan',
    photoDate: '19 Oktober 2026',
    photoTime: '08:45:10 WIB',
    latitude: VENUE_GEO_PRESETS['BDK Medan'].lat,
    longitude: VENUE_GEO_PRESETS['BDK Medan'].lng,
    accuracy: 8,
    locationName: 'Medan, Sumatera Utara',
    imageUrl: createWatermarkedSvg(
      'BDK Medan',
      'foto ruangan',
      'muklis',
      'Medan',
      VENUE_GEO_PRESETS['BDK Medan'].lat,
      VENUE_GEO_PRESETS['BDK Medan'].lng,
      '19 Oktober 2026',
      '08:45:10 WIB',
      'room'
    ),
    status: 'submitted',
    driveFileName: '01_BDK Medan_muklis_persiapan_foto ruangan_19 Oktober 2026_08.45.10 WIB.jpg',
    driveStatus: 'local_only',
    notes: 'Ruang aula utama kapasitas 200 peserta dengan jarak meja 1.2 meter.',
    createdAt: '2026-10-19T01:45:10.000Z'
  },
  {
    id: 'seed_photo_medan_3',
    userId: 'user_1',
    username: 'muklis',
    venue: 'BDK Medan',
    stage: 'persiapan',
    category: 'foto laptop',
    photoDate: '19 Oktober 2026',
    photoTime: '09:12:44 WIB',
    latitude: VENUE_GEO_PRESETS['BDK Medan'].lat,
    longitude: VENUE_GEO_PRESETS['BDK Medan'].lng,
    accuracy: 10,
    locationName: 'Medan, Sumatera Utara',
    imageUrl: createWatermarkedSvg(
      'BDK Medan',
      'foto laptop',
      'muklis',
      'Medan',
      VENUE_GEO_PRESETS['BDK Medan'].lat,
      VENUE_GEO_PRESETS['BDK Medan'].lng,
      '19 Oktober 2026',
      '09:12:44 WIB',
      'laptop'
    ),
    status: 'submitted',
    driveFileName: '01_BDK Medan_muklis_persiapan_foto laptop_19 Oktober 2026_09.12.44 WIB.jpg',
    driveStatus: 'local_only',
    notes: 'Perangkat laptop CBT sudah terinstall Secure Exam Browser dan siap tes.',
    createdAt: '2026-10-19T02:12:44.000Z'
  },
  {
    id: 'seed_photo_medan_4',
    userId: 'user_1',
    username: 'muklis',
    venue: 'BDK Medan',
    stage: 'persiapan',
    category: 'foto jaringan listrik',
    photoDate: '19 Oktober 2026',
    photoTime: '09:40:15 WIB',
    latitude: VENUE_GEO_PRESETS['BDK Medan'].lat,
    longitude: VENUE_GEO_PRESETS['BDK Medan'].lng,
    accuracy: 7,
    locationName: 'Medan, Sumatera Utara',
    imageUrl: createWatermarkedSvg(
      'BDK Medan',
      'foto jaringan listrik',
      'muklis',
      'Medan',
      VENUE_GEO_PRESETS['BDK Medan'].lat,
      VENUE_GEO_PRESETS['BDK Medan'].lng,
      '19 Oktober 2026',
      '09:40:15 WIB',
      'electricity'
    ),
    status: 'verified',
    driveFileName: '01_BDK Medan_muklis_persiapan_foto jaringan listrik_19 Oktober 2026_09.40.15 WIB.jpg',
    driveStatus: 'synced',
    notes: 'Genset cadangan 150 kVA terhubung ATS otomatis, UPS stabil.',
    adminComment: 'Foto telah diverifikasi dan sah.',
    verifiedAt: '2026-10-19T02:50:00.000Z',
    createdAt: '2026-10-19T02:40:15.000Z'
  },
  {
    id: 'seed_photo_medan_5',
    userId: 'user_1',
    username: 'muklis',
    venue: 'BDK Medan',
    stage: 'persiapan',
    category: 'foto jaringan LAN',
    photoDate: '19 Oktober 2026',
    photoTime: '10:05:22 WIB',
    latitude: VENUE_GEO_PRESETS['BDK Medan'].lat,
    longitude: VENUE_GEO_PRESETS['BDK Medan'].lng,
    accuracy: 8,
    locationName: 'Medan, Sumatera Utara',
    imageUrl: createWatermarkedSvg(
      'BDK Medan',
      'foto jaringan LAN',
      'muklis',
      'Medan',
      VENUE_GEO_PRESETS['BDK Medan'].lat,
      VENUE_GEO_PRESETS['BDK Medan'].lng,
      '19 Oktober 2026',
      '10:05:22 WIB',
      'lan'
    ),
    status: 'submitted',
    driveFileName: '01_BDK Medan_muklis_persiapan_foto jaringan LAN_19 Oktober 2026_10.05.22 WIB.jpg',
    driveStatus: 'local_only',
    notes: 'Switch Gigabit 48-port dengan koneksi kabel Cat6 ke seluruh workstation.',
    createdAt: '2026-10-19T03:05:22.000Z'
  },

  // BDK Palembang (syalom)
  {
    id: 'seed_photo_palembang_1',
    userId: 'user_2',
    username: 'syalom',
    venue: 'BDK Palembang',
    stage: 'persiapan',
    category: 'foto gedung',
    photoDate: '18 Oktober 2026',
    photoTime: '08:20:00 WIB',
    latitude: VENUE_GEO_PRESETS['BDK Palembang'].lat,
    longitude: VENUE_GEO_PRESETS['BDK Palembang'].lng,
    accuracy: 9,
    locationName: 'Palembang, Sumatera Selatan',
    imageUrl: createWatermarkedSvg(
      'BDK Palembang',
      'foto gedung',
      'syalom',
      'Palembang',
      VENUE_GEO_PRESETS['BDK Palembang'].lat,
      VENUE_GEO_PRESETS['BDK Palembang'].lng,
      '18 Oktober 2026',
      '08:20:00 WIB',
      'building'
    ),
    status: 'verified',
    driveFileName: '02_BDK Palembang_syalom_persiapan_foto gedung_18 Oktober 2026_08.20.00 WIB.jpg',
    driveStatus: 'synced',
    notes: 'Gedung BDK Palembang siap untuk uji fungsi dan seleksi SPMB STAN.',
    adminComment: 'Foto telah diverifikasi dan sah.',
    verifiedAt: '2026-10-18T09:00:00.000Z',
    createdAt: '2026-10-18T08:20:00.000Z'
  },
  {
    id: 'seed_photo_palembang_2',
    userId: 'user_2',
    username: 'syalom',
    venue: 'BDK Palembang',
    stage: 'persiapan',
    category: 'foto laptop',
    photoDate: '18 Oktober 2026',
    photoTime: '09:00:15 WIB',
    latitude: VENUE_GEO_PRESETS['BDK Palembang'].lat,
    longitude: VENUE_GEO_PRESETS['BDK Palembang'].lng,
    accuracy: 8,
    locationName: 'Palembang, Sumatera Selatan',
    imageUrl: createWatermarkedSvg(
      'BDK Palembang',
      'foto laptop',
      'syalom',
      'Palembang',
      VENUE_GEO_PRESETS['BDK Palembang'].lat,
      VENUE_GEO_PRESETS['BDK Palembang'].lng,
      '18 Oktober 2026',
      '09:00:15 WIB',
      'laptop'
    ),
    status: 'submitted',
    driveFileName: '02_BDK Palembang_syalom_persiapan_foto laptop_18 Oktober 2026_09.00.15 WIB.jpg',
    driveStatus: 'local_only',
    notes: 'Deretan laptop CBT siap untuk simulasi uji fungsi besok.',
    createdAt: '2026-10-18T09:00:15.000Z'
  },

  // BDK Cimahi (dera)
  {
    id: 'seed_photo_cimahi_1',
    userId: 'user_4',
    username: 'dera',
    venue: 'BDK Cimahi',
    stage: 'persiapan',
    category: 'foto gedung',
    photoDate: '19 Oktober 2026',
    photoTime: '07:55:12 WIB',
    latitude: VENUE_GEO_PRESETS['BDK Cimahi'].lat,
    longitude: VENUE_GEO_PRESETS['BDK Cimahi'].lng,
    accuracy: 11,
    locationName: 'Cimahi, Jawa Barat',
    imageUrl: createWatermarkedSvg(
      'BDK Cimahi',
      'foto gedung',
      'dera',
      'Cimahi',
      VENUE_GEO_PRESETS['BDK Cimahi'].lat,
      VENUE_GEO_PRESETS['BDK Cimahi'].lng,
      '19 Oktober 2026',
      '07:55:12 WIB',
      'building'
    ),
    status: 'verified',
    driveFileName: '04_BDK Cimahi_dera_persiapan_foto gedung_19 Oktober 2026_07.55.12 WIB.jpg',
    driveStatus: 'synced',
    notes: 'Dokumentasi pintu masuk dan area registrasi gedung BDK Cimahi.',
    adminComment: 'Foto telah diverifikasi dan sah.',
    verifiedAt: '2026-10-19T01:10:00.000Z',
    createdAt: '2026-10-19T00:55:12.000Z'
  },
  {
    id: 'seed_photo_cimahi_2',
    userId: 'user_4',
    username: 'dera',
    venue: 'BDK Cimahi',
    stage: 'persiapan',
    category: 'foto jaringan LAN',
    photoDate: '19 Oktober 2026',
    photoTime: '08:35:40 WIB',
    latitude: VENUE_GEO_PRESETS['BDK Cimahi'].lat,
    longitude: VENUE_GEO_PRESETS['BDK Cimahi'].lng,
    accuracy: 7,
    locationName: 'Cimahi, Jawa Barat',
    imageUrl: createWatermarkedSvg(
      'BDK Cimahi',
      'foto jaringan LAN',
      'dera',
      'Cimahi',
      VENUE_GEO_PRESETS['BDK Cimahi'].lat,
      VENUE_GEO_PRESETS['BDK Cimahi'].lng,
      '19 Oktober 2026',
      '08:35:40 WIB',
      'lan'
    ),
    status: 'submitted',
    driveFileName: '04_BDK Cimahi_dera_persiapan_foto jaringan LAN_19 Oktober 2026_08.35.40 WIB.jpg',
    driveStatus: 'local_only',
    notes: 'Koneksi switch antar lantai sudah diuji ping latency < 1ms.',
    createdAt: '2026-10-19T01:35:40.000Z'
  },

  // BDK Jogjakarta (didik)
  {
    id: 'seed_photo_jogja_1',
    userId: 'user_5',
    username: 'didik',
    venue: 'BDK Jogjakarta',
    stage: 'persiapan',
    category: 'foto gedung',
    photoDate: '19 Oktober 2026',
    photoTime: '08:10:00 WIB',
    latitude: VENUE_GEO_PRESETS['BDK Jogjakarta'].lat,
    longitude: VENUE_GEO_PRESETS['BDK Jogjakarta'].lng,
    accuracy: 9,
    locationName: 'Yogyakarta, DI Yogyakarta',
    imageUrl: createWatermarkedSvg(
      'BDK Jogjakarta',
      'foto gedung',
      'didik',
      'Yogyakarta',
      VENUE_GEO_PRESETS['BDK Jogjakarta'].lat,
      VENUE_GEO_PRESETS['BDK Jogjakarta'].lng,
      '19 Oktober 2026',
      '08:10:00 WIB',
      'building'
    ),
    status: 'verified',
    driveFileName: '05_BDK Jogjakarta_didik_persiapan_foto gedung_19 Oktober 2026_08.10.00 WIB.jpg',
    driveStatus: 'synced',
    notes: 'Persiapan halaman utama dan gedung CBT BDK Jogja selesai.',
    adminComment: 'Foto telah diverifikasi dan sah.',
    verifiedAt: '2026-10-19T01:40:00.000Z',
    createdAt: '2026-10-19T01:10:00.000Z'
  },
  {
    id: 'seed_photo_jogja_2',
    userId: 'user_5',
    username: 'didik',
    venue: 'BDK Jogjakarta',
    stage: 'persiapan',
    category: 'foto ruangan',
    photoDate: '19 Oktober 2026',
    photoTime: '09:05:00 WIB',
    latitude: VENUE_GEO_PRESETS['BDK Jogjakarta'].lat,
    longitude: VENUE_GEO_PRESETS['BDK Jogjakarta'].lng,
    accuracy: 10,
    locationName: 'Yogyakarta, DI Yogyakarta',
    imageUrl: createWatermarkedSvg(
      'BDK Jogjakarta',
      'foto ruangan',
      'didik',
      'Yogyakarta',
      VENUE_GEO_PRESETS['BDK Jogjakarta'].lat,
      VENUE_GEO_PRESETS['BDK Jogjakarta'].lng,
      '19 Oktober 2026',
      '09:05:00 WIB',
      'room'
    ),
    status: 'submitted',
    driveFileName: '05_BDK Jogjakarta_didik_persiapan_foto ruangan_19 Oktober 2026_09.05.00 WIB.jpg',
    driveStatus: 'local_only',
    notes: 'Ruang lab komputer 1 kapasitas 100 kursi siap tes.',
    createdAt: '2026-10-19T02:05:00.000Z'
  },

  // Non-BDK Jayapura (alfian)
  {
    id: 'seed_photo_jayapura_1',
    userId: 'user_15',
    username: 'alfian',
    venue: 'Non-BDK Jayapura',
    stage: 'persiapan',
    category: 'foto gedung',
    photoDate: '22 Oktober 2026',
    photoTime: '09:00:00 WIT',
    latitude: VENUE_GEO_PRESETS['Non-BDK Jayapura'].lat,
    longitude: VENUE_GEO_PRESETS['Non-BDK Jayapura'].lng,
    accuracy: 12,
    locationName: 'Jayapura, Papua',
    imageUrl: createWatermarkedSvg(
      'Non-BDK Jayapura',
      'foto gedung',
      'alfian',
      'Jayapura',
      VENUE_GEO_PRESETS['Non-BDK Jayapura'].lat,
      VENUE_GEO_PRESETS['Non-BDK Jayapura'].lng,
      '22 Oktober 2026',
      '09:00:00 WIT',
      'building'
    ),
    status: 'verified',
    driveFileName: '15_Non-BDK Jayapura_alfian_persiapan_foto gedung_22 Oktober 2026_09.00.00 WIT.jpg',
    driveStatus: 'synced',
    notes: 'Lokasi tes Non-BDK Jayapura siap koordinasi dengan panitia pusat.',
    adminComment: 'Foto telah diverifikasi dan sah.',
    verifiedAt: '2026-10-22T00:30:00.000Z',
    createdAt: '2026-10-22T00:00:00.000Z'
  }
];
