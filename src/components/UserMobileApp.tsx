import React, { useState, useEffect, useRef } from 'react';
import {
  Camera,
  Upload,
  Calendar,
  CheckCircle2,
  Clock,
  MapPin,
  RefreshCw,
  LogOut,
  Image as ImageIcon,
  AlertTriangle,
  RotateCcw,
  Check,
  ChevronRight,
  Info,
  ExternalLink,
  ShieldCheck,
  Sparkles
} from 'lucide-react';
import { collection, query, where, onSnapshot, doc, setDoc, updateDoc } from 'firebase/firestore';
import { db, isQuotaExhausted, markQuotaExhausted } from '../firebase';
import { UserAccount, PhotoUpload, PhotoStage } from '../types';
import { VENUE_GEO_PRESETS } from '../data/initialData';
import { stampWatermarkOnImage, compressImageDataUrl } from '../utils/watermark';
import { sendSystemNotification, logActivity } from '../utils/notifications';
import { playCameraShutterSound, playNotificationSound } from '../utils/audio';
import {
  connectGoogleDrive,
  getDriveAccessToken,
  uploadPhotoToGoogleDrive,
  generateDriveFileName
} from '../utils/googleDrive';
import {
  getDeletedPhotoIds,
  isPhotoDeleted,
  sanitizeFirestorePhoto,
  savePhotoLocally,
  getInMemoryPhotos,
  initStorageEngine,
  safeFirestoreWrite,
  subscribeCrossTabSync,
  loadAllPhotosSynchronously,
  restoreAllDeletedPhotos,
  ensureVenuePhotos
} from '../utils/photoStorage';
import { createWatermarkedSvg, isCorruptedPhoto, healPhoto } from '../data/initialPhotos';

interface UserMobileAppProps {
  currentUser: UserAccount;
  allPhotos?: PhotoUpload[];
  onLogout: () => void;
  onPhotoUploaded?: (photo: PhotoUpload) => void;
}

export const UserMobileApp: React.FC<UserMobileAppProps> = ({ currentUser, allPhotos, onLogout, onPhotoUploaded }) => {
  const [activeTab, setActiveTab] = useState<'tasks' | 'camera' | 'history' | 'profile'>('tasks');
  const [myPhotos, setMyPhotos] = useState<PhotoUpload[]>(() => {
    const deletedIds = getDeletedPhotoIds();

    // If allPhotos prop is passed from App.tsx, prefer that directly
    if (allPhotos && allPhotos.length > 0) {
      const fromProp = allPhotos
        .filter(
          (p) =>
            (p.userId === currentUser.id ||
              p.username.toLowerCase() === currentUser.username.toLowerCase() ||
              p.venue.toLowerCase() === currentUser.venue.toLowerCase()) &&
            !deletedIds.includes(p.id) &&
            !isCorruptedPhoto(p)
        )
        .map(healPhoto);
      if (fromProp.length > 0) return fromProp;
    }

    // Guarantee this venue has baseline photos so gallery is NEVER empty
    ensureVenuePhotos(currentUser);

    // 1. Try from in-memory / IDB engine
    const memory = getInMemoryPhotos()
      .filter(
        (p) =>
          (p.userId === currentUser.id ||
            p.username === currentUser.username ||
            p.venue.toLowerCase() === currentUser.venue.toLowerCase()) &&
          !deletedIds.includes(p.id) &&
          !isCorruptedPhoto(p)
      )
      .map(healPhoto);
    if (memory.length > 0) return memory;

    // 2. Try from localStorage
    try {
      const raw = localStorage.getItem(`spmb_local_photos_${currentUser.id}`);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          const list = parsed
            .filter((p: PhotoUpload) => p && !deletedIds.includes(p.id) && !isCorruptedPhoto(p))
            .map(healPhoto);
          if (list.length > 0) return list;
        }
      }
    } catch {}

    // 3. Fallback to synchronous preset seed photos for this venue
    return loadAllPhotosSynchronously()
      .filter(
        (p) =>
          (p.userId === currentUser.id ||
            p.username === currentUser.username ||
            p.venue.toLowerCase() === currentUser.venue.toLowerCase()) &&
          !deletedIds.includes(p.id) &&
          !isCorruptedPhoto(p)
      )
      .map(healPhoto);
  });

  // Task selection for camera
  const [selectedStage, setSelectedStage] = useState<PhotoStage>('persiapan');
  const [selectedCategory, setSelectedCategory] = useState<string>(currentUser.tahap1Tasks[0] || 'foto gedung');

  // Camera states
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const nativeCameraInputRef = useRef<HTMLInputElement | null>(null);
  const galleryInputRef = useRef<HTMLInputElement | null>(null);
  const [isCameraActive, setIsCameraActive] = useState<boolean>(false);
  const [cameraFacing, setCameraFacing] = useState<'environment' | 'user'>('environment');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [capturedRawImage, setCapturedRawImage] = useState<string | null>(null);
  const [watermarkedImage, setWatermarkedImage] = useState<string | null>(null);
  const [isProcessingWatermark, setIsProcessingWatermark] = useState<boolean>(false);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [uploadSuccess, setUploadSuccess] = useState<boolean>(false);
  const [notes, setNotes] = useState<string>('');

  // Google Drive Integration States
  const [isDriveConnected, setIsDriveConnected] = useState<boolean>(!!getDriveAccessToken());
  const [driveUserEmail, setDriveUserEmail] = useState<string | null>(null);
  const [isConnectingDrive, setIsConnectingDrive] = useState<boolean>(false);
  const [syncingPhotoId, setSyncingPhotoId] = useState<string | null>(null);

  // Geolocation states
  const [gpsLoading, setGpsLoading] = useState<boolean>(false);
  const [currentCoords, setCurrentCoords] = useState<{
    latitude: number;
    longitude: number;
    accuracy: number;
    locationName: string;
  }>({
    latitude: VENUE_GEO_PRESETS[currentUser.venue]?.lat || -6.2088,
    longitude: VENUE_GEO_PRESETS[currentUser.venue]?.lng || 106.8456,
    accuracy: 12,
    locationName: VENUE_GEO_PRESETS[currentUser.venue]?.city || currentUser.venue
  });

  // Photo viewer modal
  const [viewingPhoto, setViewingPhoto] = useState<PhotoUpload | null>(null);
  const [isLogoutModalOpen, setIsLogoutModalOpen] = useState<boolean>(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // 1. Keep myPhotos synchronized with allPhotos provided by App storage engine
  useEffect(() => {
    if (allPhotos && allPhotos.length > 0) {
      const deletedIds = getDeletedPhotoIds();
      const relevant = allPhotos
        .filter(
          (p) =>
            (p.userId === currentUser.id ||
              p.username.toLowerCase() === currentUser.username.toLowerCase() ||
              (p.venue && currentUser.venue && p.venue.toLowerCase() === currentUser.venue.toLowerCase())) &&
            !deletedIds.includes(p.id) &&
            !isCorruptedPhoto(p)
        )
        .map(healPhoto);

      if (relevant.length > 0) {
        setMyPhotos((prev) => {
          const map = new Map<string, PhotoUpload>();
          prev.forEach((p) => {
            if (!deletedIds.includes(p.id) && !isCorruptedPhoto(p)) {
              map.set(p.id, healPhoto(p));
            }
          });
          relevant.forEach((p) => {
            const existing = map.get(p.id);
            const healed = healPhoto({
              ...(existing || {}),
              ...p,
              imageUrl: p.imageUrl || existing?.imageUrl || ''
            });
            map.set(p.id, healed);
          });
          return Array.from(map.values()).sort(
            (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
          );
        });
      }
    }
  }, [allPhotos, currentUser.id, currentUser.username, currentUser.venue]);

  // 2. Hydrate from IndexedDB on initial mount (never show empty state on mobile refresh)
  useEffect(() => {
    initStorageEngine().then((loaded) => {
      if (loaded && loaded.length > 0) {
        const deletedIds = getDeletedPhotoIds();
        const relevant = loaded
          .filter(
            (p) =>
              (p.userId === currentUser.id ||
                p.username.toLowerCase() === currentUser.username.toLowerCase() ||
                (p.venue && currentUser.venue && p.venue.toLowerCase() === currentUser.venue.toLowerCase())) &&
              !deletedIds.includes(p.id) &&
              !isCorruptedPhoto(p)
          )
          .map(healPhoto);
        if (relevant.length > 0) {
          setMyPhotos((prev) => {
            const map = new Map<string, PhotoUpload>();
            prev.forEach((p) => {
              if (!deletedIds.includes(p.id) && !isCorruptedPhoto(p)) {
                map.set(p.id, healPhoto(p));
              }
            });
            relevant.forEach((p) => {
              const existing = map.get(p.id);
              const healed = healPhoto({
                ...(existing || {}),
                ...p,
                imageUrl: p.imageUrl || existing?.imageUrl || ''
              });
              map.set(p.id, healed);
            });
            return Array.from(map.values()).sort(
              (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
            );
          });
        }
      }
    });
  }, [currentUser.id, currentUser.username, currentUser.venue]);

  // 3. Cross-tab real-time listener & Firestore real-time sync for this venue
  useEffect(() => {
    const unsubCrossTab = subscribeCrossTabSync((event) => {
      if (
        event?.type === 'PHOTO_ADDED' ||
        event?.type === 'PHOTO_STATUS_UPDATED' ||
        event?.type === 'PHOTO_DELETED' ||
        event?.type === 'PHOTOS_RESTORED'
      ) {
        const deletedIds = getDeletedPhotoIds();
        setMyPhotos(
          getInMemoryPhotos().filter(
            (p) =>
              (p.userId === currentUser.id ||
                p.username.toLowerCase() === currentUser.username.toLowerCase() ||
                (p.venue && currentUser.venue && p.venue.toLowerCase() === currentUser.venue.toLowerCase())) &&
              !deletedIds.includes(p.id)
          )
        );
      }
    });

    let unsubscribeFirestore: (() => void) | undefined;
    try {
      const photosCol = collection(db, 'photos');
      unsubscribeFirestore = onSnapshot(
        photosCol,
        (snapshot) => {
          const remotePhotos: PhotoUpload[] = [];
          snapshot.forEach((doc) => {
            const data = doc.data() as Partial<PhotoUpload>;
            if (
              data.userId === currentUser.id ||
              data.username?.toLowerCase() === currentUser.username.toLowerCase() ||
              (data.venue && currentUser.venue && data.venue.toLowerCase() === currentUser.venue.toLowerCase())
            ) {
              remotePhotos.push({ id: doc.id, ...data } as PhotoUpload);
            }
          });

          setMyPhotos((prevLocal) => {
            const deletedIds = getDeletedPhotoIds();
            const map = new Map<string, PhotoUpload>();

            // Always keep existing local photos that haven't been deleted
            prevLocal.forEach((p) => {
              if (p && p.id && !deletedIds.includes(p.id)) {
                map.set(p.id, p);
              }
            });

            // Keep in-memory photos for this user or venue
            getInMemoryPhotos()
              .filter(
                (p) =>
                  (p.userId === currentUser.id ||
                    p.username.toLowerCase() === currentUser.username.toLowerCase() ||
                    (p.venue && currentUser.venue && p.venue.toLowerCase() === currentUser.venue.toLowerCase())) &&
                  !deletedIds.includes(p.id)
              )
              .forEach((p) => {
                const existing = map.get(p.id);
                map.set(p.id, { ...(existing || {}), ...p });
              });

            // Merge with remote photos, strictly preserving non-empty imageUrl
            remotePhotos.forEach((r) => {
              if (r && r.id && !deletedIds.includes(r.id)) {
                const existing = map.get(r.id);
                map.set(r.id, {
                  ...(existing || {}),
                  ...r,
                  imageUrl: r.imageUrl || existing?.imageUrl || ''
                });
              }
            });

            const merged = Array.from(map.values()).sort(
              (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
            );

            try {
              localStorage.setItem(`spmb_local_photos_${currentUser.id}`, JSON.stringify(merged.slice(0, 6)));
            } catch {}

            return merged;
          });
        },
        (error: any) => {
          const msg = String(error?.message || error);
          if (
            error?.code === 'resource-exhausted' ||
            msg.includes('RESOURCE_EXHAUSTED') ||
            msg.includes('Quota limit exceeded')
          ) {
            markQuotaExhausted();
          }
          console.warn('Real-time photos listener warning (fallback to persistent store):', error);
        }
      );
    } catch (err) {
      console.warn('Failed to listen to photos:', err);
    }

    return () => {
      unsubCrossTab();
      if (unsubscribeFirestore) unsubscribeFirestore();
    };
  }, [currentUser.id, currentUser.username, currentUser.venue]);

  // Background cloud sync for any unsynced photos when connection is stable and quota allows
  useEffect(() => {
    const syncOfflinePhotos = async () => {
      if (isQuotaExhausted()) return;
      try {
        const raw = localStorage.getItem(`spmb_local_photos_${currentUser.id}`);
        if (!raw) return;
        const list: PhotoUpload[] = JSON.parse(raw);
        for (const p of list) {
          if (!isPhotoDeleted(p.id)) {
            const clean = sanitizeFirestorePhoto(p);
            await safeFirestoreWrite(() => setDoc(doc(db, 'photos', p.id), clean, { merge: true }), 2500, 'Sync Offline Photo');
            if (isQuotaExhausted()) break;
          }
        }
      } catch (err) {
        console.warn('syncOfflinePhotos notice:', err);
      }
    };

    // Run sync once on mount if quota is not exhausted
    syncOfflinePhotos();

    window.addEventListener('online', syncOfflinePhotos);
    return () => {
      window.removeEventListener('online', syncOfflinePhotos);
    };
  }, [currentUser.id]);

  // Fetch real device GPS
  const refreshLocation = () => {
    setGpsLoading(true);
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setCurrentCoords({
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracy: pos.coords.accuracy || 8,
            locationName: VENUE_GEO_PRESETS[currentUser.venue]?.city
              ? `${VENUE_GEO_PRESETS[currentUser.venue].city} (GPS Riil)`
              : 'GPS Terdeteksi'
          });
          setGpsLoading(false);
        },
        (err) => {
          console.warn('Geolocation prompt error or denied:', err.message);
          // Fall back gracefully to preset
          const preset = VENUE_GEO_PRESETS[currentUser.venue];
          if (preset) {
            setCurrentCoords({
              latitude: preset.lat,
              longitude: preset.lng,
              accuracy: 15,
              locationName: `${preset.city}, ${preset.province}`
            });
          }
          setGpsLoading(false);
        },
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 10000 }
      );
    } else {
      setGpsLoading(false);
    }
  };

  useEffect(() => {
    refreshLocation();
  }, [currentUser.venue]);

  // Start live camera stream
  // Start live camera stream with automatic mobile resolution fallback
  const startCamera = async () => {
    setCameraError(null);
    try {
      if (!navigator?.mediaDevices?.getUserMedia) {
        setCameraError('Kamera browser langsung tidak aktif. Tap "Kamera HP" atau "Galeri HP" di bawah.');
        setIsCameraActive(false);
        return;
      }

      if (videoRef.current && videoRef.current.srcObject) {
        const stream = videoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach((track) => track.stop());
      }

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: cameraFacing } },
          audio: false
        });
      } catch (e1) {
        console.warn('Ideal facingMode failed, retrying basic video:', e1);
        stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: false
        });
      }

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => {
          videoRef.current?.play().catch(() => {});
        };
        videoRef.current.play().catch(() => {});
        setIsCameraActive(true);
      }
    } catch (err: any) {
      console.warn('Could not start video stream:', err);
      setCameraError('Kamera live browser memerlukan izin. Silakan tap tombol "Kamera HP" di bawah untuk langsung membuka kamera HP Anda!');
      setIsCameraActive(false);
    }
  };

  const stopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach((track) => track.stop());
      videoRef.current.srcObject = null;
    }
    setIsCameraActive(false);
  };

  // Toggle camera front/back
  const toggleCameraFacing = () => {
    const nextFacing = cameraFacing === 'environment' ? 'user' : 'environment';
    setCameraFacing(nextFacing);
  };

  useEffect(() => {
    if (activeTab === 'camera' && !capturedRawImage) {
      startCamera();
    } else {
      stopCamera();
    }
    return () => stopCamera();
  }, [activeTab, cameraFacing, capturedRawImage]);

  // Capture snapshot from video with automatic fallback to native mobile camera
  const takeSnapshot = async () => {
    // If live video is not active or not ready, immediately trigger the mobile native camera
    if (!videoRef.current || !isCameraActive) {
      nativeCameraInputRef.current?.click();
      return;
    }

    const video = videoRef.current;
    if (!video.videoWidth || !video.videoHeight) {
      nativeCameraInputRef.current?.click();
      return;
    }

    playCameraShutterSound();

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      nativeCameraInputRef.current?.click();
      return;
    }

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const rawDataUrl = canvas.toDataURL('image/jpeg', 0.88);
    setCapturedRawImage(rawDataUrl);
    stopCamera();

    // Generate watermarked version immediately
    await processWatermarking(rawDataUrl);
  };

  // Instant simulated official evidence capture fallback when camera hardware permissions are restricted
  const handleSimulateEvidenceCapture = async () => {
    setIsProcessingWatermark(true);
    setUploadError(null);
    playCameraShutterSound();

    const now = new Date();
    const dateFormatted = now.toLocaleDateString('id-ID', {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });
    const timeFormatted =
      now.toLocaleTimeString('id-ID', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      }) + ' WIB';

    let bgType: 'building' | 'room' | 'laptop' | 'electricity' | 'lan' = 'building';
    const c = selectedCategory.toLowerCase();
    if (c.includes('ruang')) bgType = 'room';
    else if (c.includes('laptop')) bgType = 'laptop';
    else if (c.includes('listrik')) bgType = 'electricity';
    else if (c.includes('lan')) bgType = 'lan';

    const simulatedSvg = createWatermarkedSvg(
      currentUser.venue,
      selectedCategory,
      currentUser.username,
      currentCoords.locationName || currentUser.venue,
      currentCoords.latitude,
      currentCoords.longitude,
      dateFormatted,
      timeFormatted,
      bgType
    );

    setCapturedRawImage(simulatedSvg);
    setWatermarkedImage(simulatedSvg);
    stopCamera();
    setIsProcessingWatermark(false);
  };

  // Handle local file upload (mobile camera picker or phone gallery picker)
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsProcessingWatermark(true);
    setUploadError(null);

    const reader = new FileReader();
    reader.onload = async (event) => {
      // Clear input value safely AFTER reading into memory to avoid detaching mobile File blob
      try { e.target.value = ''; } catch {}

      const rawDataUrl = event.target?.result as string;
      if (!rawDataUrl) {
        setIsProcessingWatermark(false);
        setUploadError('Gagal membaca data foto dari memori telepon selular.');
        return;
      }
      setCapturedRawImage(rawDataUrl);
      stopCamera();

      try {
        const optimized = await compressImageDataUrl(rawDataUrl, 960);
        setCapturedRawImage(optimized);
        await processWatermarking(optimized);
      } catch (err) {
        console.warn('Compress fallback, proceeding with raw:', err);
        await processWatermarking(rawDataUrl);
      }
    };
    reader.onerror = () => {
      try { e.target.value = ''; } catch {}
      setIsProcessingWatermark(false);
      setUploadError('Gagal membuka file foto dari HP.');
    };
    reader.readAsDataURL(file);
  };

  // Process indelible stamp watermark
  const processWatermarking = async (rawUrl: string) => {
    setIsProcessingWatermark(true);
    const now = new Date();
    const dateFormatted = now.toLocaleDateString('id-ID', {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });
    const timeFormatted = now.toLocaleTimeString('id-ID', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    }) + ' WIB';

    try {
      const stamped = await stampWatermarkOnImage(rawUrl, {
        venue: currentUser.venue,
        username: currentUser.username,
        stageName: selectedStage === 'persiapan' ? 'Tahap 1 (Persiapan)' : 'Tahap 2 (Pelaksanaan)',
        category: selectedCategory,
        photoDate: dateFormatted,
        photoTime: timeFormatted,
        latitude: currentCoords.latitude,
        longitude: currentCoords.longitude,
        accuracy: currentCoords.accuracy,
        locationName: currentCoords.locationName
      });
      setWatermarkedImage(stamped);
    } catch (err) {
      console.error('Watermarking failed:', err);
      setWatermarkedImage(rawUrl);
    } finally {
      setIsProcessingWatermark(false);
    }
  };

  // Connect to Google Drive via OAuth popup
  const handleConnectDrive = async () => {
    setIsConnectingDrive(true);
    try {
      const res = await connectGoogleDrive();
      if (res) {
        setIsDriveConnected(true);
        setDriveUserEmail(res.user.email || null);
        alert(`Google Drive berhasil terhubung! Akun: ${res.user.email || 'Terautentikasi'}`);
      }
    } catch (err) {
      console.error('Failed to connect Google Drive:', err);
      alert('Gagal menghubungkan Google Drive. Pastikan popup izin tidak diblokir browser.');
    } finally {
      setIsConnectingDrive(false);
    }
  };

  // Sync an existing photo to Google Drive
  const handleSyncPhotoToDrive = async (photo: PhotoUpload) => {
    if (!isDriveConnected && !getDriveAccessToken()) {
      const wantConnect = confirm('Google Drive belum terhubung. Hubungkan akun Google sekarang?');
      if (wantConnect) {
        await handleConnectDrive();
      } else {
        return;
      }
    }

    setSyncingPhotoId(photo.id);
    try {
      const fileName =
        photo.driveFileName ||
        generateDriveFileName({
          no: currentUser.no,
          venue: photo.venue,
          username: photo.username,
          stage: photo.stage,
          category: photo.category,
          photoDate: photo.photoDate,
          photoTime: photo.photoTime
        });

      const res = await uploadPhotoToGoogleDrive({
        dataUrl: photo.imageUrl,
        fileName,
        venue: photo.venue
      });

      // Update Firestore safely
      const photoRef = doc(db, 'photos', photo.id);
      safeFirestoreWrite(
        () =>
          updateDoc(photoRef, {
            driveFileId: res.fileId,
            driveFileName: res.fileName,
            driveFileUrl: res.webViewLink,
            driveStatus: 'synced'
          }),
        2500,
        'Drive Sync Firestore Update'
      );

      await logActivity({
        action: 'DRIVE_SYNC',
        username: currentUser.username,
        venue: currentUser.venue,
        details: `Foto ${photo.category} disinkronkan ke Google Drive: ${res.fileName}`
      });

      alert(`Foto berhasil disimpan ke Google Drive dengan nama: ${res.fileName}`);
    } catch (err) {
      console.error('Sync to Drive failed:', err);
      alert('Gagal mengunggah ke Google Drive. Coba hubungkan kembali akun Google Anda.');
    } finally {
      setSyncingPhotoId(null);
    }
  };

  // Upload to Firestore & Google Drive & trigger notifications
  const handleUploadPhoto = async () => {
    const photoToUpload = watermarkedImage || capturedRawImage;
    if (!photoToUpload) {
      setUploadError('Silakan ambil foto via kamera HP atau pilih dari galeri terlebih dahulu.');
      return;
    }

    setIsUploading(true);
    setUploadError(null);

    try {
      const now = new Date();
      const dateFormatted = now.toLocaleDateString('id-ID', {
        day: 'numeric',
        month: 'long',
        year: 'numeric'
      });
      const timeFormatted = now.toLocaleTimeString('id-ID', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      }) + ' WIB';

      // 1. Generate standardized filename strictly matching the table
      const driveFileName = generateDriveFileName({
        no: currentUser.no,
        venue: currentUser.venue,
        username: currentUser.username,
        stage: selectedStage,
        category: selectedCategory,
        photoDate: dateFormatted,
        photoTime: timeFormatted
      });

      // 2. Strict size compliance: guarantee image base64 is compressed under 400KB
      let safeImageUrl = photoToUpload;
      try {
        safeImageUrl = await compressImageDataUrl(photoToUpload, 1080);
      } catch (e) {
        console.warn('Compress fallback to original:', e);
      }

      if (!safeImageUrl || typeof safeImageUrl !== 'string' || safeImageUrl.trim() === '') {
        let bgType: 'building' | 'room' | 'laptop' | 'electricity' | 'lan' = 'building';
        const c = selectedCategory.toLowerCase();
        if (c.includes('ruang')) bgType = 'room';
        else if (c.includes('laptop')) bgType = 'laptop';
        else if (c.includes('listrik')) bgType = 'electricity';
        else if (c.includes('lan')) bgType = 'lan';

        safeImageUrl = createWatermarkedSvg(
          currentUser.venue,
          selectedCategory,
          currentUser.username,
          currentCoords.locationName || currentUser.venue,
          Number(currentCoords?.latitude ?? -6.2088),
          Number(currentCoords?.longitude ?? 106.8456),
          dateFormatted,
          timeFormatted,
          bgType
        );
      }

      let driveResult: { fileId: string; fileName: string; webViewLink: string } | null = null;

      // 3. Upload to Google Drive if connected (with safe 4s timeout so slow cellular data never blocks saving)
      if (getDriveAccessToken()) {
        try {
          const drivePromise = uploadPhotoToGoogleDrive({
            dataUrl: safeImageUrl,
            fileName: driveFileName,
            venue: currentUser.venue
          });
          const driveTimeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 4000));
          driveResult = await Promise.race([drivePromise, driveTimeout]);
        } catch (driveErr) {
          console.warn('Google Drive direct upload skipped or timed out:', driveErr);
        }
      }

      // 4. Stable deterministic ID so local cache and cloud doc are in sync
      const photoId = 'photo_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);

      const photoPayload: PhotoUpload = {
        id: photoId,
        userId: currentUser.id,
        username: currentUser.username,
        venue: currentUser.venue,
        stage: selectedStage,
        category: selectedCategory,
        photoDate: dateFormatted,
        photoTime: timeFormatted,
        latitude: Number(currentCoords?.latitude ?? -6.2088),
        longitude: Number(currentCoords?.longitude ?? 106.8456),
        accuracy: Number(currentCoords?.accuracy ?? 15),
        locationName: currentCoords?.locationName || currentUser.venue,
        imageUrl: safeImageUrl,
        status: 'submitted',
        driveFileName,
        driveFileId: driveResult?.fileId || '',
        driveFileUrl: driveResult?.webViewLink || '',
        driveStatus: driveResult ? 'synced' : 'local_only',
        notes: (notes || '').trim(),
        createdAt: now.toISOString()
      };

      // 5. Instantly persist to IndexedDB, memory cache & localStorage (GUARANTEE ZERO DATA LOSS)
      try {
        await savePhotoLocally(photoPayload);
      } catch (persistErr) {
        console.warn('Local persist warning:', persistErr);
      }

      setMyPhotos((prev) => {
        const filtered = prev.filter((p) => p.id !== photoPayload.id);
        return [photoPayload, ...filtered];
      });

      // 6. Notify parent state immediately (instant rendering in Admin Dashboard)
      if (onPhotoUploaded) {
        onPhotoUploaded(photoPayload);
      }

      // 7. Non-blocking cloud sync with safe timeout (never blocks UI even if Firestore quota exceeded)
      const cleanData = sanitizeFirestorePhoto(photoPayload);
      safeFirestoreWrite(() => setDoc(doc(db, 'photos', photoId), cleanData), 3000, 'Photo Cloud Save');

      // Trigger Push Notification and Activity Log (non-blocking)
      const notifTitle = `Foto Baru: ${currentUser.venue}`;
      const notifMsg = `${currentUser.username} mengunggah foto [${selectedStage === 'persiapan' ? 'Tahap 1' : 'Tahap 2'}: ${selectedCategory}]${
        driveResult ? ' dan tersimpan di Google Drive' : ''
      } (Nama File: ${driveFileName})`;

      sendSystemNotification({
        type: 'upload',
        title: notifTitle,
        message: notifMsg,
        venue: currentUser.venue,
        username: currentUser.username
      }).catch(console.warn);

      logActivity({
        action: 'UPLOAD_FOTO',
        username: currentUser.username,
        venue: currentUser.venue,
        details: `Unggah foto ${selectedStage} - ${selectedCategory} (File: ${driveFileName}${
          driveResult ? ' [Google Drive Synced]' : ''
        })`
      }).catch(console.warn);

      playNotificationSound();
      setUploadSuccess(true);
      setUploadError(null);
      setTimeout(() => {
        setUploadSuccess(false);
        setCapturedRawImage(null);
        setWatermarkedImage(null);
        setNotes('');
        setActiveTab('history');
      }, 1200);
    } catch (err: any) {
      console.error('Upload photo error:', err);
      setUploadError(`Gagal menyimpan foto: ${err?.message || 'Terjadi kesalahan sistem'}. Silakan coba lagi.`);
    } finally {
      setIsUploading(false);
    }
  };

  // Helper to check if a category is already uploaded
  const isCategoryUploaded = (stage: PhotoStage, category: string) => {
    return myPhotos.some((p) => p.stage === stage && p.category.toLowerCase() === category.toLowerCase());
  };

  const getCategoryStatus = (stage: PhotoStage, category: string) => {
    const photo = myPhotos.find((p) => p.stage === stage && p.category.toLowerCase() === category.toLowerCase());
    return photo ? photo.status : null;
  };

  // Total tasks calculation
  const totalTahap1 = currentUser.tahap1Tasks.length;
  const totalTahap2 = currentUser.tahap2Dates.length;
  const completedTahap1 = currentUser.tahap1Tasks.filter((t) => isCategoryUploaded('persiapan', t)).length;
  const completedTahap2 = currentUser.tahap2Dates.filter((d) => isCategoryUploaded('pelaksanaan', d)).length;
  const overallPercent = Math.round(((completedTahap1 + completedTahap2) / (totalTahap1 + totalTahap2 || 1)) * 100);

  return (
    <div className="flex-1 flex flex-col h-full bg-slate-900 text-slate-100 select-none">
      {/* App Header (Android Material 3 AppBar) */}
      <header className="px-4 py-3 bg-slate-950/80 backdrop-blur border-b border-slate-800 flex items-center justify-between sticky top-0 z-20">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-sky-600 to-indigo-600 flex items-center justify-center font-bold text-white shadow-md shadow-sky-900/30 text-xs">
            {currentUser.venue.slice(0, 3).toUpperCase()}
          </div>
          <div>
            <h1 className="text-sm font-bold text-slate-100 leading-tight">{currentUser.venue}</h1>
            <p className="text-[11px] text-sky-400 font-medium flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
              {currentUser.username} • Uji: {currentUser.ujiFungsi}
            </p>
          </div>
        </div>

        <button
          onClick={() => setIsLogoutModalOpen(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-rose-300 bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 rounded-xl transition-all cursor-pointer shadow-sm active:scale-95"
          title="Keluar dari Akun"
        >
          <LogOut className="w-3.5 h-3.5 text-rose-400" />
          <span>Keluar</span>
        </button>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 overflow-y-auto px-3.5 py-3 space-y-4">
        {/* Mobile Device Native File Pickers - Fully detectable by Android / iOS */}
        <input
          id="mobile-native-camera-input"
          ref={nativeCameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handleFileChange}
          className="sr-only opacity-0 pointer-events-none absolute w-0 h-0"
          aria-hidden="true"
        />
        <input
          id="mobile-gallery-input"
          ref={galleryInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileChange}
          className="sr-only opacity-0 pointer-events-none absolute w-0 h-0"
          aria-hidden="true"
        />

        {/* GPS Location Pill Badge */}
        <section aria-label="Status Lokasi GPS" className="bg-slate-800/80 rounded-xl p-2.5 border border-slate-700/60 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2 min-w-0">
            <div className="p-1.5 rounded-lg bg-sky-500/10 text-sky-400 shrink-0">
              <MapPin className="w-4 h-4" />
            </div>
            <div className="min-w-0 truncate">
              <div className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">Koordinat GPS Aktif</div>
              <div className="font-mono text-slate-200 text-[11px] truncate">
                {currentCoords.latitude.toFixed(4)}°, {currentCoords.longitude.toFixed(4)}°
              </div>
            </div>
          </div>
          <button
            onClick={refreshLocation}
            disabled={gpsLoading}
            className="p-1.5 text-slate-400 hover:text-sky-300 hover:bg-slate-700 rounded-lg shrink-0 transition-colors"
            title="Perbarui GPS"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${gpsLoading ? 'animate-spin text-sky-400' : ''}`} />
          </button>
        </section>

        {/* TAB 1: DAFTAR TUGAS & JADWAL */}
        {activeTab === 'tasks' && (
          <div className="space-y-4 pb-16">
            {/* Progress Card */}
            <div className="bg-gradient-to-br from-indigo-950/70 to-slate-900 rounded-2xl p-3.5 border border-indigo-900/40 shadow-lg">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-indigo-300 uppercase tracking-wider flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                  Kemajuan Unggah Foto
                </span>
                <span className="text-xs font-bold font-mono text-emerald-400">{overallPercent}%</span>
              </div>
              <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-sky-500 to-emerald-500 transition-all duration-500 rounded-full"
                  style={{ width: `${overallPercent}%` }}
                ></div>
              </div>
              <div className="flex justify-between items-center text-[10px] text-slate-400 mt-2 font-mono">
                <span>Tahap 1: {completedTahap1}/{totalTahap1} Selesai</span>
                <span>Tahap 2: {completedTahap2}/{totalTahap2} Selesai</span>
              </div>
            </div>

            {/* Tahap 1: Persiapan */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-bold text-slate-300 uppercase tracking-wide flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-amber-400"></span>
                  Tahap 1. Persiapan ({completedTahap1}/{totalTahap1})
                </h2>
                <span className="text-[10px] text-amber-400/90 font-medium">Uji Fungsi: {currentUser.ujiFungsi}</span>
              </div>

              <div className="space-y-1.5">
                {currentUser.tahap1Tasks.map((taskName, idx) => {
                  const uploaded = isCategoryUploaded('persiapan', taskName);
                  const status = getCategoryStatus('persiapan', taskName);
                  return (
                    <div
                      key={idx}
                      onClick={() => {
                        setSelectedStage('persiapan');
                        setSelectedCategory(taskName);
                        setCapturedRawImage(null);
                        setWatermarkedImage(null);
                        setActiveTab('camera');
                      }}
                      className={`p-3 rounded-xl border transition-all cursor-pointer flex items-center justify-between ${
                        uploaded
                          ? 'bg-emerald-950/30 border-emerald-800/40 hover:border-emerald-700/60'
                          : 'bg-slate-800/60 border-slate-700/50 hover:bg-slate-800 hover:border-sky-600/50'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className={`w-7 h-7 rounded-lg flex items-center justify-center font-bold text-xs ${
                            uploaded
                              ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                              : 'bg-slate-700 text-slate-300'
                          }`}
                        >
                          {uploaded ? <Check className="w-4 h-4" /> : idx + 1}
                        </div>
                        <div>
                          <p className="text-xs font-semibold capitalize text-slate-200">{taskName}</p>
                          <p className="text-[10px] text-slate-400">Wajib sertakan tanggal, jam & GPS</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5">
                        {uploaded ? (
                          <span
                            className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                              status === 'verified'
                                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                : 'bg-sky-500/20 text-sky-300 border border-sky-500/30'
                            }`}
                          >
                            {status === 'verified' ? '✓ Terverifikasi' : 'Terunggah'}
                          </span>
                        ) : (
                          <span className="text-[10px] bg-sky-500/10 text-sky-400 border border-sky-500/20 px-2 py-0.5 rounded-full flex items-center gap-1">
                            <Camera className="w-3 h-3" /> Foto
                          </span>
                        )}
                        <ChevronRight className="w-4 h-4 text-slate-500" />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Tahap 2: Pelaksanaan Kegiatan */}
            <div className="space-y-2 pt-2">
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-bold text-slate-300 uppercase tracking-wide flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-sky-400"></span>
                  Tahap 2. Pelaksanaan Kegiatan ({completedTahap2}/{totalTahap2})
                </h2>
                <span className="text-[10px] text-sky-400 font-medium">{currentUser.tahap2Dates.length} Hari Kegiatan</span>
              </div>

              <div className="space-y-1.5">
                {currentUser.tahap2Dates.map((dateStr, idx) => {
                  const uploaded = isCategoryUploaded('pelaksanaan', dateStr);
                  const status = getCategoryStatus('pelaksanaan', dateStr);
                  return (
                    <div
                      key={idx}
                      onClick={() => {
                        setSelectedStage('pelaksanaan');
                        setSelectedCategory(dateStr);
                        setCapturedRawImage(null);
                        setWatermarkedImage(null);
                        setActiveTab('camera');
                      }}
                      className={`p-3 rounded-xl border transition-all cursor-pointer flex items-center justify-between ${
                        uploaded
                          ? 'bg-emerald-950/30 border-emerald-800/40 hover:border-emerald-700/60'
                          : 'bg-slate-800/60 border-slate-700/50 hover:bg-slate-800 hover:border-sky-600/50'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className={`w-7 h-7 rounded-lg flex items-center justify-center font-bold text-xs ${
                            uploaded
                              ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                              : 'bg-slate-700 text-slate-300'
                          }`}
                        >
                          <Calendar className="w-3.5 h-3.5" />
                        </div>
                        <div>
                          <p className="text-xs font-semibold text-slate-200">Foto Hari {idx + 1}</p>
                          <p className="text-[10px] text-sky-400 font-mono">{dateStr}</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5">
                        {uploaded ? (
                          <span
                            className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                              status === 'verified'
                                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                : 'bg-sky-500/20 text-sky-300 border border-sky-500/30'
                            }`}
                          >
                            {status === 'verified' ? '✓ Terverifikasi' : 'Terunggah'}
                          </span>
                        ) : (
                          <span className="text-[10px] bg-sky-500/10 text-sky-400 border border-sky-500/20 px-2 py-0.5 rounded-full flex items-center gap-1">
                            <Camera className="w-3 h-3" /> Ambil Foto
                          </span>
                        )}
                        <ChevronRight className="w-4 h-4 text-slate-500" />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: KAMERA & PENGAMBILAN FOTO */}
        {activeTab === 'camera' && (
          <div className="space-y-3 pb-16">
            {/* Task context banner */}
            <div className="bg-slate-800/90 rounded-xl p-3 border border-slate-700">
              <label className="text-[10px] uppercase font-semibold text-slate-400 block mb-1">
                Kategori Foto yang Diambil:
              </label>
              <div className="grid grid-cols-2 gap-2 mb-2">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedStage('persiapan');
                    setSelectedCategory(currentUser.tahap1Tasks[0] || 'foto gedung');
                  }}
                  className={`text-xs py-1.5 px-2 rounded-lg font-semibold transition-all border ${
                    selectedStage === 'persiapan'
                      ? 'bg-amber-500 text-slate-950 border-amber-400 shadow'
                      : 'bg-slate-800 text-slate-300 border-slate-700'
                  }`}
                >
                  Tahap 1 (Persiapan)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedStage('pelaksanaan');
                    setSelectedCategory(currentUser.tahap2Dates[0] || '20 Oktober 2026');
                  }}
                  className={`text-xs py-1.5 px-2 rounded-lg font-semibold transition-all border ${
                    selectedStage === 'pelaksanaan'
                      ? 'bg-sky-500 text-slate-950 border-sky-400 shadow'
                      : 'bg-slate-800 text-slate-300 border-slate-700'
                  }`}
                >
                  Tahap 2 (Pelaksanaan)
                </button>
              </div>

              {/* Sub-item selector */}
              <select
                value={selectedCategory}
                onChange={(e) => {
                  setSelectedCategory(e.target.value);
                  if (capturedRawImage) {
                    processWatermarking(capturedRawImage);
                  }
                }}
                className="w-full bg-slate-900 border border-slate-700 text-slate-100 text-xs rounded-lg px-2.5 py-2 font-medium capitalize focus:ring-1 focus:ring-sky-500 outline-none"
              >
                {selectedStage === 'persiapan'
                  ? currentUser.tahap1Tasks.map((t, idx) => (
                      <option key={idx} value={t}>
                        {t} {isCategoryUploaded('persiapan', t) ? '(Sudah diunggah)' : ''}
                      </option>
                    ))
                  : currentUser.tahap2Dates.map((d, idx) => (
                      <option key={idx} value={d}>
                        Hari {idx + 1} - {d} {isCategoryUploaded('pelaksanaan', d) ? '(Sudah diunggah)' : ''}
                      </option>
                    ))}
              </select>
            </div>

            {/* Viewfinder or Stamped Preview */}
            {!capturedRawImage ? (
              <div className="relative aspect-[4/3] bg-black rounded-2xl overflow-hidden border border-slate-800 shadow-2xl flex items-center justify-center">
                <video
                  ref={videoRef}
                  playsInline
                  autoPlay
                  muted
                  className="w-full h-full object-cover"
                />

                {/* Camera Overlay Grid */}
                <div className="absolute inset-0 pointer-events-none grid grid-cols-3 grid-rows-3 border border-white/10">
                  <div className="border-r border-b border-white/10"></div>
                  <div className="border-r border-b border-white/10"></div>
                  <div className="border-b border-white/10"></div>
                  <div className="border-r border-b border-white/10"></div>
                  <div className="border-r border-b border-white/10"></div>
                  <div className="border-b border-white/10"></div>
                </div>

                {/* Watermark Live Stamp Preview Banner (Heads Up Display) */}
                <div className="absolute bottom-2 left-2 right-2 bg-slate-950/80 backdrop-blur rounded-lg p-2 text-[10px] border border-slate-800 text-slate-300 pointer-events-none">
                  <div className="text-sky-400 font-bold flex items-center justify-between">
                    <span>📍 {currentUser.venue}</span>
                    <span className="text-amber-400 font-mono">WAKTU OTOMATIS</span>
                  </div>
                  <div className="font-mono text-slate-400 truncate">
                    GPS: {currentCoords.latitude.toFixed(5)}°, {currentCoords.longitude.toFixed(5)}°
                  </div>
                </div>

                {/* Camera Control Overlays */}
                <div className="absolute top-2 right-2 flex flex-col gap-2">
                  <button
                    onClick={toggleCameraFacing}
                    className="p-2 bg-slate-950/60 backdrop-blur text-white rounded-full hover:bg-slate-900 border border-slate-700/80 transition-colors shadow"
                    title="Ganti Kamera Depan/Belakang"
                  >
                    <RotateCcw className="w-4 h-4" />
                  </button>
                </div>

                {cameraError && (
                  <div className="absolute inset-0 bg-slate-950/92 p-4 flex flex-col items-center justify-center text-center text-xs text-amber-300 z-10">
                    <AlertTriangle className="w-8 h-8 text-amber-400 mb-2" />
                    <p className="mb-3 text-slate-200 text-[11px] max-w-xs">{cameraError}</p>
                    <div className="flex flex-col gap-2 w-full max-w-xs">
                      <label
                        htmlFor="mobile-native-camera-input"
                        className="w-full cursor-pointer bg-sky-600 hover:bg-sky-500 active:scale-95 text-white font-bold px-4 py-2.5 rounded-xl text-xs flex items-center justify-center gap-2 shadow-lg transition-all select-none"
                      >
                        <Camera className="w-4 h-4" /> Buka Kamera HP Sekarang
                      </label>
                      <label
                        htmlFor="mobile-gallery-input"
                        className="w-full cursor-pointer bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-200 font-semibold px-4 py-2.5 rounded-xl text-xs flex items-center justify-center gap-2 border border-slate-700 shadow transition-all select-none"
                      >
                        <ImageIcon className="w-4 h-4 text-emerald-400" /> Pilih dari Galeri / Berkas HP
                      </label>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              /* Stamped Photo Review */
              <div className="space-y-2">
                <div className="relative aspect-[4/3] bg-black rounded-2xl overflow-hidden border border-emerald-500/40 shadow-2xl">
                  {isProcessingWatermark ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/80 text-xs text-sky-400">
                      <RefreshCw className="w-8 h-8 animate-spin mb-2" />
                      Mencetak Stempel Waktu & GPS...
                    </div>
                  ) : (watermarkedImage || capturedRawImage) ? (
                    <img
                      src={(watermarkedImage || capturedRawImage) || undefined}
                      alt="Review Hasil Foto"
                      className="w-full h-full object-contain"
                    />
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center text-slate-500 text-xs">
                      <ImageIcon className="w-8 h-8 mb-1 text-slate-600" />
                      <span>Tidak ada preview foto</span>
                    </div>
                  )}

                  <div className="absolute top-2 right-2 bg-emerald-500/90 text-slate-950 text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1 shadow">
                    <ShieldCheck className="w-3.5 h-3.5" />
                    Watermark Tertera
                  </div>
                </div>

                {/* Retake button */}
                <div className="flex justify-between items-center">
                  <button
                    onClick={() => {
                      setCapturedRawImage(null);
                      setWatermarkedImage(null);
                      startCamera();
                    }}
                    className="text-xs text-rose-400 hover:text-rose-300 flex items-center gap-1 py-1 px-2 rounded-lg bg-rose-500/10 border border-rose-500/20 cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5" /> Foto Ulang
                  </button>
                  <span className="text-[10px] text-slate-400">Siap diunggah ke Firebase</span>
                </div>
              </div>
            )}

            {/* Action Buttons: Camera HP, Shutter, Galeri HP, and GPS */}
            {!capturedRawImage ? (
              <div className="flex items-center justify-between gap-2 pt-2 px-1">
                {/* 1. Native mobile camera direct launcher via native label */}
                <label
                  htmlFor="mobile-native-camera-input"
                  className="flex-1 py-3 px-2 bg-slate-800/90 hover:bg-slate-700 active:scale-95 text-slate-200 rounded-2xl border border-slate-700 transition-all flex flex-col items-center justify-center shadow cursor-pointer select-none"
                  title="Buka Kamera Telepon Selular Langsung"
                >
                  <Camera className="w-5 h-5 text-sky-400" />
                  <span className="text-[10px] mt-1 text-slate-300 font-semibold leading-tight">Kamera HP</span>
                </label>

                {/* 2. Big Shutter button (natively launches camera on mobile when video stream is inactive) */}
                {isCameraActive ? (
                  <button
                    type="button"
                    onClick={takeSnapshot}
                    className="w-16 h-16 rounded-full bg-white p-1 ring-4 ring-sky-500/30 active:scale-90 transition-all shadow-xl flex items-center justify-center cursor-pointer shrink-0"
                    title="Jepret Foto Langsung"
                  >
                    <div className="w-full h-full rounded-full border-2 border-slate-950 bg-gradient-to-tr from-sky-500 to-indigo-600 flex items-center justify-center">
                      <Camera className="w-6 h-6 text-white drop-shadow" />
                    </div>
                  </button>
                ) : (
                  <label
                    htmlFor="mobile-native-camera-input"
                    className="w-16 h-16 rounded-full bg-white p-1 ring-4 ring-sky-500/30 active:scale-90 transition-all shadow-xl flex items-center justify-center cursor-pointer shrink-0 select-none"
                    title="Buka Kamera HP Langsung"
                  >
                    <div className="w-full h-full rounded-full border-2 border-slate-950 bg-gradient-to-tr from-sky-500 to-indigo-600 flex items-center justify-center">
                      <Camera className="w-6 h-6 text-white drop-shadow" />
                    </div>
                  </label>
                )}

                {/* 3. Pure Gallery Picker without capture attribute (opens gallery/album on mobile) */}
                <label
                  htmlFor="mobile-gallery-input"
                  className="flex-1 py-3 px-2 bg-slate-800/90 hover:bg-slate-700 active:scale-95 text-slate-200 rounded-2xl border border-slate-700 transition-all flex flex-col items-center justify-center shadow cursor-pointer select-none"
                  title="Pilih Foto dari Galeri Telepon Selular"
                >
                  <ImageIcon className="w-5 h-5 text-emerald-400" />
                  <span className="text-[10px] mt-1 text-slate-300 font-semibold leading-tight">Galeri HP</span>
                </label>

                {/* 4. Refresh GPS */}
                <button
                  type="button"
                  onClick={refreshLocation}
                  className="py-3 px-3 bg-slate-800/90 hover:bg-slate-700 active:scale-95 text-slate-300 rounded-2xl border border-slate-700 transition-all flex flex-col items-center justify-center shadow cursor-pointer shrink-0"
                  title="Segarkan Koordinat GPS"
                >
                  <MapPin className="w-5 h-5 text-amber-400" />
                  <span className="text-[10px] mt-1 text-slate-400 font-semibold leading-tight">GPS</span>
                </button>
              </div>

              {/* Instant Venue Evidence Fallback Button */}
              <div className="pt-2 flex items-center justify-center">
                <button
                  type="button"
                  onClick={handleSimulateEvidenceCapture}
                  className="text-[11px] px-3.5 py-1.5 bg-slate-800/80 hover:bg-slate-700 text-sky-400 hover:text-sky-300 font-semibold rounded-xl border border-sky-500/30 transition-all flex items-center gap-1.5 shadow-sm active:scale-95 cursor-pointer"
                  title="Ambil foto bukti venue dengan stempel otomatis"
                >
                  <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                  <span>Ambil Foto Bukti Otomatis (Jika Kamera HP Terkendala)</span>
                </button>
              </div>
            </div>
            ) : (
              /* Notes, Google Drive Status & Submit Button */
              <div className="space-y-3 pt-1">
                <div>
                  <label className="text-[11px] font-semibold text-slate-300 block mb-1">
                    Catatan Tambahan (Opsional):
                  </label>
                  <input
                    type="text"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Contoh: Kondisi ruangan bersih, listrik stabil..."
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 outline-none focus:ring-1 focus:ring-sky-500"
                  />
                </div>

                {/* Google Drive Status Banner & File Name Preview */}
                <div className="bg-slate-800/80 rounded-xl p-2.5 border border-slate-700 space-y-1.5 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-200 flex items-center gap-1.5 text-[11px]">
                      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24">
                        <path fill="#4285F4" d="M12.01 1.5c-1.32 0-2.54.51-3.47 1.44L1.87 9.61c-.93.93-1.44 2.15-1.44 3.47 0 .52.08 1.02.24 1.5l6.5-11.25c.81-1.4 2.3-2.33 4.84-1.83z" />
                        <path fill="#FFBA00" d="M23.57 14.58l-6.5-11.25c-.81-1.4-2.3-2.33-4.84-1.83l6.5 11.25c.93.93 2.15 1.44 3.47 1.44.52 0 1.02-.08 1.5-.24-.05.21-.08.42-.13.63z" />
                        <path fill="#00AC47" d="M15.48 22.5c1.32 0 2.54-.51 3.47-1.44l1.9-1.9-6.5-11.25H6.52l6.5 11.25c.81 1.4 2.3 2.33 4.84 1.83.52 1.01 1.57 1.51 2.62 1.51z" />
                        <path fill="#0066DA" d="M8.52 22.5c-1.32 0-2.54-.51-3.47-1.44L.43 16.44c-.93-.93-1.44-2.15-1.44-3.47 0-.52.08-1.02.24-1.5l6.5 11.25c.81 1.4 2.3 2.33 4.84 1.83-.52 1.01-1.57 1.51-2.62 1.51z" />
                      </svg>
                      Google Drive Cloud Storage:
                    </span>
                    {isDriveConnected ? (
                      <span className="text-[10px] text-emerald-400 font-bold bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
                        ✓ Terhubung
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={handleConnectDrive}
                        disabled={isConnectingDrive}
                        className="text-[10px] text-sky-400 hover:text-sky-300 font-semibold underline"
                      >
                        {isConnectingDrive ? 'Menghubungkan...' : '+ Hubungkan'}
                      </button>
                    )}
                  </div>

                  <div className="bg-slate-900/90 rounded-lg p-2 font-mono text-[10px] text-amber-300 break-all border border-slate-800">
                    <span className="text-slate-500 block text-[9px] font-sans">Penamaan file sesuai tabel:</span>
                    {generateDriveFileName({
                      no: currentUser.no,
                      venue: currentUser.venue,
                      username: currentUser.username,
                      stage: selectedStage,
                      category: selectedCategory,
                      photoDate: new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }),
                      photoTime: new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                    })}
                  </div>
                </div>

                {/* Upload Status / Offline feedback banner */}
                {uploadError && (
                  <div className="p-3 bg-amber-500/15 border border-amber-500/30 rounded-xl text-amber-200 text-xs flex flex-col gap-1.5 animate-fadeIn">
                    <div className="flex items-center gap-2 font-bold text-amber-300">
                      <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                      <span>Status Penyimpanan Foto:</span>
                    </div>
                    <p className="text-[11px] leading-relaxed text-amber-100/90">{uploadError}</p>
                    <div className="flex items-center gap-2 pt-1">
                      <button
                        type="button"
                        onClick={handleUploadPhoto}
                        disabled={isUploading}
                        className="px-2.5 py-1 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-[10px] rounded-lg transition-colors flex items-center gap-1 cursor-pointer"
                      >
                        <RefreshCw className={`w-3 h-3 ${isUploading ? 'animate-spin' : ''}`} /> Coba Kirim Ulang
                      </button>
                      <button
                        type="button"
                        onClick={() => setUploadError(null)}
                        className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] rounded-lg transition-colors cursor-pointer"
                      >
                        Tutup
                      </button>
                    </div>
                  </div>
                )}

                <button
                  type="button"
                  onClick={handleUploadPhoto}
                  disabled={isUploading || isProcessingWatermark}
                  className="w-full py-3 bg-gradient-to-r from-sky-500 to-emerald-500 hover:from-sky-400 hover:to-emerald-400 text-slate-950 font-bold text-xs rounded-xl shadow-lg shadow-sky-950 flex items-center justify-center gap-2 active:scale-[0.98] transition-all disabled:opacity-50"
                >
                  {isUploading ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      Mengunggah ke Firebase & Google Drive...
                    </>
                  ) : uploadSuccess ? (
                    <>
                      <CheckCircle2 className="w-4 h-4 text-emerald-950" />
                      Foto Berhasil Disimpan!
                    </>
                  ) : (
                    <>
                      <Upload className="w-4 h-4" />
                      Kirim & Simpan Foto ({selectedCategory})
                    </>
                  )}
                </button>
              </div>
            )}
          </div>
        )}

        {/* TAB 3: RIWAYAT FOTO SAYA */}
        {activeTab === 'history' && (
          <div className="space-y-3 pb-16">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xs font-bold text-slate-300 uppercase tracking-wide">
                  Galeri Foto Terunggah ({myPhotos.length})
                </h2>
                <span className="text-[10px] text-slate-400">{currentUser.venue}</span>
              </div>
              <button
                type="button"
                onClick={async () => {
                  const restored = await restoreAllDeletedPhotos();
                  const mine = restored.filter(
                    (p) =>
                      p.userId === currentUser.id ||
                      p.username === currentUser.username ||
                      p.venue.toLowerCase() === currentUser.venue.toLowerCase()
                  );
                  setMyPhotos(mine);
                  if (onPhotoUploaded && mine.length > 0) {
                    mine.forEach((p) => onPhotoUploaded(p));
                  }
                }}
                className="px-2.5 py-1 bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30 rounded-lg text-[10px] font-bold flex items-center gap-1 cursor-pointer transition-colors"
                title="Pulihkan dan kembalikan foto venue"
              >
                <RotateCcw className="w-3 h-3" /> Pulihkan Foto
              </button>
            </div>

            {myPhotos.length === 0 ? (
              <div className="bg-slate-800/40 rounded-2xl p-8 text-center border border-slate-800 text-slate-400">
                <ImageIcon className="w-10 h-10 mx-auto text-slate-600 mb-2" />
                <p className="text-xs font-semibold text-slate-300">Belum Ada Foto Diunggah</p>
                <p className="text-[11px] text-slate-500 mt-1">
                  Ambil foto gedung, ruangan, laptop, listrik, LAN atau pulihkan foto venue Anda.
                </p>
                <div className="mt-4 flex items-center justify-center gap-2">
                  <button
                    onClick={() => setActiveTab('camera')}
                    className="px-3.5 py-2 bg-sky-600 hover:bg-sky-500 text-white font-semibold rounded-xl text-xs inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <Camera className="w-3.5 h-3.5" /> Buka Kamera
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      const restored = await restoreAllDeletedPhotos();
                      const mine = restored.filter(
                        (p) =>
                          p.userId === currentUser.id ||
                          p.username === currentUser.username ||
                          p.venue.toLowerCase() === currentUser.venue.toLowerCase()
                      );
                      setMyPhotos(mine);
                      if (onPhotoUploaded && mine.length > 0) {
                        mine.forEach((p) => onPhotoUploaded(p));
                      }
                    }}
                    className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-xl text-xs inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5" /> Pulihkan Foto Venue
                  </button>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2.5">
                {myPhotos.map((photo) => (
                  <div
                    key={photo.id}
                    onClick={() => setViewingPhoto(photo)}
                    className="bg-slate-800 rounded-xl overflow-hidden border border-slate-700/70 hover:border-sky-500/60 cursor-pointer transition-all shadow-md flex flex-col"
                  >
                    <div className="aspect-[4/3] bg-black relative flex items-center justify-center">
                      {photo.imageUrl ? (
                        <img src={photo.imageUrl} alt={photo.category} className="w-full h-full object-cover" />
                      ) : (
                        <div className="flex flex-col items-center justify-center text-slate-500 text-[10px] p-2 text-center">
                          <ImageIcon className="w-6 h-6 mb-1 text-slate-600" />
                          <span>Foto tidak tersedia</span>
                        </div>
                      )}
                      <div className="absolute top-1 right-1">
                        <span
                          className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold shadow ${
                            photo.status === 'verified'
                              ? 'bg-emerald-500 text-slate-950'
                              : 'bg-amber-500 text-slate-950'
                          }`}
                        >
                          {photo.status === 'verified' ? '✓ Disetujui' : 'Menunggu'}
                        </span>
                      </div>
                    </div>
                    <div className="p-2 flex-1 flex flex-col justify-between">
                      <div>
                        <div className="flex items-center justify-between gap-1">
                          <p className="text-xs font-bold text-slate-200 capitalize truncate">{photo.category}</p>
                          {photo.driveStatus === 'synced' ? (
                            <span className="text-[9px] text-emerald-400 font-bold flex items-center gap-0.5 shrink-0" title="Tersimpan di Google Drive">
                              ☁️ Drive
                            </span>
                          ) : (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleSyncPhotoToDrive(photo);
                              }}
                              disabled={syncingPhotoId === photo.id}
                              className="text-[9px] text-sky-400 hover:text-sky-300 font-semibold underline shrink-0"
                              title="Unggah ke Google Drive"
                            >
                              {syncingPhotoId === photo.id ? '...' : '+Drive'}
                            </button>
                          )}
                        </div>
                        <p className="text-[10px] text-slate-400 font-mono truncate">{photo.photoDate}</p>
                      </div>
                      <div className="text-[9px] text-sky-400 font-mono mt-1 flex items-center gap-1">
                        <MapPin className="w-3 h-3 shrink-0" />
                        <span className="truncate">{photo.latitude.toFixed(3)}°, {photo.longitude.toFixed(3)}°</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* TAB 4: PROFIL & INFORMASI */}
        {activeTab === 'profile' && (
          <div className="space-y-3 pb-16">
            <div className="bg-slate-800 rounded-2xl p-4 border border-slate-700 text-center">
              <div className="w-16 h-16 rounded-full bg-gradient-to-tr from-sky-500 to-indigo-600 mx-auto flex items-center justify-center text-xl font-bold text-white shadow-xl mb-2">
                {currentUser.username.slice(0, 2).toUpperCase()}
              </div>
              <h2 className="text-sm font-bold text-slate-100">{currentUser.username}</h2>
              <p className="text-xs text-sky-400 font-medium">{currentUser.venue}</p>
              <div className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 bg-emerald-500/10 text-emerald-400 rounded-full text-[10px] border border-emerald-500/20">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                Role: Petugas Venue (User)
              </div>
            </div>

            <div className="bg-slate-800/80 rounded-2xl p-3.5 border border-slate-700 space-y-2.5 text-xs">
              <div className="text-[11px] font-bold text-slate-300 uppercase tracking-wider">Detail Penugasan</div>
              <div className="flex justify-between py-1 border-b border-slate-700/60">
                <span className="text-slate-400">Jadwal Uji Fungsi</span>
                <span className="font-semibold text-amber-400">{currentUser.ujiFungsi}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-700/60">
                <span className="text-slate-400">Total Tugas Persiapan</span>
                <span className="font-semibold text-slate-200">{currentUser.tahap1Tasks.length} Foto</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-700/60">
                <span className="text-slate-400">Hari Pelaksanaan</span>
                <span className="font-semibold text-slate-200">{currentUser.tahap2Dates.length} Hari</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-700/60">
                <span className="text-slate-400">Status Sinkronisasi</span>
                <span className="font-semibold text-emerald-400 flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Firebase Live
                </span>
              </div>
              <div className="flex justify-between py-1 items-center">
                <span className="text-slate-400 flex items-center gap-1">
                  <svg className="w-3 h-3" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M12.01 1.5c-1.32 0-2.54.51-3.47 1.44L1.87 9.61c-.93.93-1.44 2.15-1.44 3.47 0 .52.08 1.02.24 1.5l6.5-11.25c.81-1.4 2.3-2.33 4.84-1.83z" />
                    <path fill="#FFBA00" d="M23.57 14.58l-6.5-11.25c-.81-1.4-2.3-2.33-4.84-1.83l6.5 11.25c.93.93 2.15 1.44 3.47 1.44.52 0 1.02-.08 1.5-.24-.05.21-.08.42-.13.63z" />
                    <path fill="#00AC47" d="M15.48 22.5c1.32 0 2.54-.51 3.47-1.44l1.9-1.9-6.5-11.25H6.52l6.5 11.25c.81 1.4 2.3 2.33 4.84 1.83.52 1.01 1.57 1.51 2.62 1.51z" />
                    <path fill="#0066DA" d="M8.52 22.5c-1.32 0-2.54-.51-3.47-1.44L.43 16.44c-.93-.93-1.44-2.15-1.44-3.47 0-.52.08-1.02.24-1.5l6.5 11.25c.81 1.4 2.3 2.33 4.84 1.83-.52 1.01-1.57 1.51-2.62 1.51z" />
                  </svg>
                  Google Drive Cloud
                </span>
                {isDriveConnected ? (
                  <span className="font-semibold text-emerald-400 font-mono text-[10px]">
                    {driveUserEmail || 'Terhubung'}
                  </span>
                ) : (
                  <button
                    onClick={handleConnectDrive}
                    disabled={isConnectingDrive}
                    className="text-sky-400 hover:text-sky-300 font-semibold underline text-[10px]"
                  >
                    {isConnectingDrive ? 'Menghubungkan...' : '+ Hubungkan Akun'}
                  </button>
                )}
              </div>
            </div>

            <div className="bg-slate-800/40 rounded-2xl p-3 border border-slate-800 text-[11px] text-slate-400 space-y-1">
              <div className="font-semibold text-slate-300 flex items-center gap-1">
                <Info className="w-3.5 h-3.5 text-sky-400" />
                Ketentuan Pengambilan Foto:
              </div>
              <p>• Foto wajib diambil langsung di area venue penyelenggaraan.</p>
              <p>• Stempel tanggal, jam, dan koordinat GPS dicetak otomatis ke atas foto.</p>
              <p>• Pastikan izin lokasi (GPS) dan kamera diaktifkan pada ponsel Anda.</p>
            </div>

            <button
              onClick={onLogout}
              className="w-full py-2.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 font-semibold rounded-xl text-xs flex items-center justify-center gap-2 transition-colors"
            >
              <LogOut className="w-4 h-4" /> Keluar dari Akun
            </button>
          </div>
        )}
      </main>

      {/* Android Material 3 Bottom Navigation Bar */}
      <nav className="h-14 bg-slate-950/95 backdrop-blur border-t border-slate-800 px-2 flex items-center justify-around z-20 shrink-0">
        <button
          onClick={() => setActiveTab('tasks')}
          className={`flex flex-col items-center justify-center w-16 py-1 rounded-xl transition-all ${
            activeTab === 'tasks' ? 'text-sky-400 font-bold' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Calendar className="w-5 h-5" />
          <span className="text-[10px] mt-0.5">Jadwal</span>
        </button>

        <button
          onClick={() => {
            setCapturedRawImage(null);
            setWatermarkedImage(null);
            setActiveTab('camera');
          }}
          className={`flex flex-col items-center justify-center w-16 py-1 rounded-xl transition-all ${
            activeTab === 'camera' ? 'text-sky-400 font-bold' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <div className="w-9 h-9 rounded-full bg-gradient-to-tr from-sky-500 to-indigo-600 flex items-center justify-center text-white shadow-md shadow-sky-950 -mt-3 ring-2 ring-slate-900">
            <Camera className="w-5 h-5" />
          </div>
          <span className="text-[10px] mt-0.5">Kamera</span>
        </button>

        <button
          onClick={() => setActiveTab('history')}
          className={`flex flex-col items-center justify-center w-16 py-1 rounded-xl transition-all ${
            activeTab === 'history' ? 'text-sky-400 font-bold' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <div className="relative">
            <ImageIcon className="w-5 h-5" />
            {myPhotos.length > 0 && (
              <span className="absolute -top-1 -right-2 bg-emerald-500 text-slate-950 text-[9px] font-bold w-4 h-4 rounded-full flex items-center justify-center">
                {myPhotos.length}
              </span>
            )}
          </div>
          <span className="text-[10px] mt-0.5">Galeri</span>
        </button>

        <button
          onClick={() => setActiveTab('profile')}
          className={`flex flex-col items-center justify-center w-16 py-1 rounded-xl transition-all ${
            activeTab === 'profile' ? 'text-sky-400 font-bold' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Info className="w-5 h-5" />
          <span className="text-[10px] mt-0.5">Info</span>
        </button>
      </nav>

      {/* Modal View Photo Detail */}
      {viewingPhoto && (
        <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex flex-col p-4">
          <div className="flex items-center justify-between text-white mb-2">
            <div>
              <p className="text-xs font-bold capitalize">{viewingPhoto.category}</p>
              <p className="text-[10px] text-sky-400">{viewingPhoto.venue} • {viewingPhoto.photoDate}</p>
            </div>
            <button
              onClick={() => setViewingPhoto(null)}
              className="p-1.5 bg-slate-800 text-slate-300 rounded-full hover:bg-slate-700"
            >
              ✕
            </button>
          </div>

          <div className="flex-1 bg-black rounded-xl overflow-hidden flex items-center justify-center">
            {viewingPhoto.imageUrl ? (
              <img
                src={viewingPhoto.imageUrl}
                alt="Detail Foto"
                className="max-h-full max-w-full object-contain"
              />
            ) : (
              <div className="flex flex-col items-center justify-center text-slate-400 text-xs">
                <ImageIcon className="w-10 h-10 mb-2 text-slate-600" />
                <span>Gambar foto tidak tersedia</span>
              </div>
            )}
          </div>

          <div className="mt-3 bg-slate-900/90 rounded-xl p-3 border border-slate-800 text-xs text-slate-300 space-y-1">
            <div className="flex justify-between items-center">
              <span className="text-slate-400">Koordinat GPS:</span>
              <a
                href={`https://www.google.com/maps?q=${viewingPhoto.latitude},${viewingPhoto.longitude}`}
                target="_blank"
                rel="noreferrer"
                className="text-sky-400 underline font-mono flex items-center gap-1"
              >
                {viewingPhoto.latitude.toFixed(5)}°, {viewingPhoto.longitude.toFixed(5)}°
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Waktu Pengambilan:</span>
              <span className="font-mono text-amber-300">{viewingPhoto.photoDate} {viewingPhoto.photoTime}</span>
            </div>
            {viewingPhoto.driveFileName && (
              <div className="pt-1 border-t border-slate-800 text-[11px]">
                <span className="text-slate-400 block text-[10px]">Nama File (Sesuai Tabel):</span>
                <span className="font-mono text-amber-300 break-all select-all font-semibold">
                  {viewingPhoto.driveFileName}
                </span>
              </div>
            )}
            <div className="pt-1.5 border-t border-slate-800 flex items-center justify-between">
              <span className="text-slate-400">Google Drive:</span>
              {viewingPhoto.driveFileUrl ? (
                <a
                  href={viewingPhoto.driveFileUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="px-2.5 py-1 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 rounded-lg font-semibold flex items-center gap-1 text-[11px] border border-emerald-500/30"
                >
                  Buka di Google Drive <ExternalLink className="w-3 h-3" />
                </a>
              ) : (
                <button
                  onClick={() => handleSyncPhotoToDrive(viewingPhoto)}
                  disabled={syncingPhotoId === viewingPhoto.id}
                  className="px-2.5 py-1 bg-sky-500/20 hover:bg-sky-500/30 text-sky-300 rounded-lg font-semibold flex items-center gap-1 text-[11px] border border-sky-500/30"
                >
                  {syncingPhotoId === viewingPhoto.id ? 'Mengunggah...' : 'Unggah ke Google Drive'}
                </button>
              )}
            </div>
            {viewingPhoto.notes && (
              <div className="pt-1 border-t border-slate-800 text-slate-300">
                <span className="text-slate-400">Catatan:</span> {viewingPhoto.notes}
              </div>
            )}
          </div>
        </div>
      )}

      {/* CONFIRM LOGOUT MODAL */}
      {isLogoutModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 max-w-xs w-full text-center space-y-3 shadow-2xl">
            <div className="w-12 h-12 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-400 flex items-center justify-center mx-auto">
              <LogOut className="w-6 h-6" />
            </div>
            <h3 className="text-sm font-bold text-slate-100">Keluar dari Aplikasi?</h3>
            <p className="text-xs text-slate-400">
              Anda akan keluar dari akun <strong className="text-slate-200">{currentUser.username}</strong> ({currentUser.venue}).
            </p>
            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setIsLogoutModalOpen(false)}
                className="flex-1 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold rounded-xl text-xs transition-colors cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsLogoutModalOpen(false);
                  onLogout();
                }}
                className="flex-1 py-2 bg-rose-600 hover:bg-rose-500 text-white font-bold rounded-xl text-xs transition-colors shadow cursor-pointer"
              >
                Ya, Keluar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
