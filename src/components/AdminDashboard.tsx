import React, { useState, useMemo } from 'react';
import {
  Users,
  Image as ImageIcon,
  CheckCircle2,
  Clock,
  MapPin,
  Bell,
  Search,
  Plus,
  Edit2,
  Trash2,
  ExternalLink,
  ShieldAlert,
  LogOut,
  Download,
  Filter,
  Check,
  X,
  Eye,
  RefreshCw,
  Activity,
  Layers,
  Sparkles,
  Radio,
  FileSpreadsheet,
  RotateCcw
} from 'lucide-react';
import {
  doc,
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  setDoc,
  writeBatch
} from 'firebase/firestore';
import { db } from '../firebase';
import { UserAccount, PhotoUpload, SystemNotification, ActivityLog } from '../types';
import { INITIAL_USERS, STANDARD_TAHAP1_TASKS } from '../data/initialData';
import { sendSystemNotification, logActivity, requestPushPermission } from '../utils/notifications';
import {
  markPhotoAsDeleted,
  updateCachedPhotoStatus,
  safeFirestoreWrite,
  restoreAllDeletedPhotos
} from '../utils/photoStorage';

interface AdminDashboardProps {
  currentUser: UserAccount;
  users: UserAccount[];
  photos: PhotoUpload[];
  notifications: SystemNotification[];
  activityLogs: ActivityLog[];
  onLogout: () => void;
  onAddUser?: (user: UserAccount) => void;
  onUpdateUser?: (user: UserAccount) => void;
  onDeleteUser?: (userId: string) => void;
  onDeletePhoto?: (photoId: string) => void;
  onUpdatePhoto?: (photoId: string, updatedFields: Partial<PhotoUpload>) => void;
  onRestorePhotos?: () => Promise<void> | void;
  onSelectUserToSimulate?: (user: UserAccount) => void;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({
  currentUser,
  users,
  photos,
  notifications,
  activityLogs,
  onLogout,
  onAddUser,
  onUpdateUser,
  onDeleteUser,
  onDeletePhoto,
  onUpdatePhoto,
  onRestorePhotos,
  onSelectUserToSimulate
}) => {
  const [activeTab, setActiveTab] = useState<'overview' | 'users' | 'photos' | 'logs'>('overview');

  // Search & Filter for Users Table
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | 'user' | 'admin'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'online' | 'offline'>('all');

  // Photo gallery filters
  const [photoVenueFilter, setPhotoVenueFilter] = useState<string>('all');
  const [photoStageFilter, setPhotoStageFilter] = useState<string>('all');
  const [photoStatusFilter, setPhotoStatusFilter] = useState<string>('all');

  // Modals
  const [isAddUserModalOpen, setIsAddUserModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserAccount | null>(null);
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null);
  const [inspectingPhoto, setInspectingPhoto] = useState<PhotoUpload | null>(null);
  const [deletingPhoto, setDeletingPhoto] = useState<PhotoUpload | null>(null);
  const [isDeletingPhoto, setIsDeletingPhoto] = useState(false);
  const [adminNoteInput, setAdminNoteInput] = useState('');
  const [isNotifDropdownOpen, setIsNotifDropdownOpen] = useState(false);
  const [isResettingData, setIsResettingData] = useState(false);
  const [isLogoutModalOpen, setIsLogoutModalOpen] = useState(false);
  const [isResetModalOpen, setIsResetModalOpen] = useState(false);
  const [addUserError, setAddUserError] = useState('');
  const [actionFeedback, setActionFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // New user form state
  const [newUserForm, setNewUserForm] = useState({
    venue: '',
    username: '',
    password: '',
    role: 'user' as 'user' | 'admin',
    ujiFungsi: '19 Oktober 2026',
    tahap2DatesInput: '20 Oktober 2026, 21 Oktober 2026'
  });

  // Calculate stats
  const totalVenues = useMemo(() => {
    const venues = new Set(users.filter(u => u.role === 'user').map(u => u.venue));
    return venues.size;
  }, [users]);

  const onlineUsersCount = useMemo(() => {
    return users.filter(u => u.isOnline).length;
  }, [users]);

  const totalPhotos = photos.length;
  const verifiedPhotosCount = photos.filter(p => p.status === 'verified').length;
  const unreadNotificationsCount = notifications.filter(n => !n.read).length;

  // Filtered users
  const filteredUsers = useMemo(() => {
    return users.filter(u => {
      const matchSearch =
        u.venue.toLowerCase().includes(searchQuery.toLowerCase()) ||
        u.username.toLowerCase().includes(searchQuery.toLowerCase());
      const matchRole = roleFilter === 'all' || u.role === roleFilter;
      const matchStatus =
        statusFilter === 'all' ||
        (statusFilter === 'online' && u.isOnline) ||
        (statusFilter === 'offline' && !u.isOnline);
      return matchSearch && matchRole && matchStatus;
    });
  }, [users, searchQuery, roleFilter, statusFilter]);

  // Filtered photos
  const filteredPhotos = useMemo(() => {
    return photos.filter(p => {
      const matchVenue = photoVenueFilter === 'all' || p.venue === photoVenueFilter;
      const matchStage = photoStageFilter === 'all' || p.stage === photoStageFilter;
      const matchStatus = photoStatusFilter === 'all' || p.status === photoStatusFilter;
      return matchVenue && matchStage && matchStatus;
    });
  }, [photos, photoVenueFilter, photoStageFilter, photoStatusFilter]);

  // CRUD: Create User
  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanVenue = newUserForm.venue.trim();
    const cleanUsername = newUserForm.username.toLowerCase().trim();
    const cleanPassword = newUserForm.password.trim();

    if (!cleanVenue || !cleanUsername || !cleanPassword) {
      setAddUserError('Mohon lengkapi Venue, Username, dan Password.');
      return;
    }

    const isDuplicate = users.some(u => u.username.toLowerCase() === cleanUsername);
    if (isDuplicate) {
      setAddUserError(`Username "${cleanUsername}" sudah digunakan di daftar user. Gunakan username lain.`);
      return;
    }
    setAddUserError('');

    try {
      const datesArray = newUserForm.tahap2DatesInput
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);

      const maxNo = users.reduce((max, u) => Math.max(max, u.no || 0), 0);
      const newId = 'user_' + Date.now();

      const payload: UserAccount = {
        id: newId,
        no: maxNo + 1,
        venue: cleanVenue,
        username: cleanUsername,
        password: cleanPassword,
        role: newUserForm.role,
        ujiFungsi: newUserForm.ujiFungsi.trim() || '-',
        tahap1Tasks: newUserForm.role === 'admin' ? [] : [...STANDARD_TAHAP1_TASKS],
        tahap2Dates: newUserForm.role === 'admin' ? [] : datesArray,
        isOnline: false,
        createdAt: new Date().toISOString()
      };

      // 1. Optimistic update: UI updates immediately
      if (onAddUser) onAddUser(payload);
      setIsAddUserModalOpen(false);
      setActionFeedback({ type: 'success', message: `User "${cleanUsername}" (${cleanVenue}) berhasil ditambahkan!` });
      setTimeout(() => setActionFeedback(null), 3500);

      // 2. Save document to Firestore
      try {
        await setDoc(doc(db, 'users', newId), payload);
      } catch (fErr) {
        console.warn('Firestore user save handled locally:', fErr);
      }

      logActivity({
        action: 'TAMBAH_USER',
        username: currentUser.username,
        venue: cleanVenue,
        details: `Menambahkan user baru: ${cleanUsername}`
      }).catch(() => {});

      sendSystemNotification({
        type: 'crud',
        title: 'User Baru Dibuat',
        message: `Admin menambahkan user ${cleanUsername} (${cleanVenue})`,
        venue: cleanVenue,
        username: cleanUsername
      }).catch(() => {});

      setNewUserForm({
        venue: '',
        username: '',
        password: '',
        role: 'user',
        ujiFungsi: '19 Oktober 2026',
        tahap2DatesInput: '20 Oktober 2026, 21 Oktober 2026'
      });
    } catch (err) {
      console.error('Error creating user:', err);
    }
  };

  // CRUD: Update User
  const handleUpdateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;

    try {
      const updatedUser: UserAccount = {
        ...editingUser,
        venue: editingUser.venue.trim(),
        username: editingUser.username.toLowerCase().trim(),
        password: editingUser.password.trim(),
        updatedAt: new Date().toISOString()
      };

      // 1. Optimistic update
      if (onUpdateUser) onUpdateUser(updatedUser);
      setEditingUser(null);
      setActionFeedback({ type: 'success', message: `Data user "${updatedUser.username}" berhasil diperbarui!` });
      setTimeout(() => setActionFeedback(null), 3500);

      // 2. Persist to Firestore
      try {
        const userRef = doc(db, 'users', editingUser.id);
        await setDoc(userRef, updatedUser, { merge: true });
      } catch (fErr) {
        console.warn('Firestore update handled locally:', fErr);
      }

      logActivity({
        action: 'UPDATE_USER',
        username: currentUser.username,
        venue: updatedUser.venue,
        details: `Mengubah data user ${updatedUser.username}`
      }).catch(() => {});
    } catch (err) {
      console.error('Error updating user in Firestore:', err);
    }
  };

  // CRUD: Delete User
  const handleDeleteUser = async (userId: string) => {
    try {
      const targetUser = users.find(u => u.id === userId);

      // Prevent accidental deletion of main admin account
      if (targetUser?.role === 'admin' || targetUser?.username.toLowerCase() === 'admin') {
        setDeletingUserId(null);
        setActionFeedback({ type: 'error', message: 'Akun Admin Utama tidak dapat dihapus untuk menjaga keamanan sistem.' });
        setTimeout(() => setActionFeedback(null), 4000);
        return;
      }

      // 1. Optimistically delete from UI immediately
      if (onDeleteUser) onDeleteUser(userId);
      setDeletingUserId(null);
      setActionFeedback({ type: 'success', message: `Akun user "${targetUser?.username}" berhasil dihapus!` });
      setTimeout(() => setActionFeedback(null), 3500);

      // 2. Delete from Firestore
      try {
        await deleteDoc(doc(db, 'users', userId));
      } catch (fErr) {
        console.warn('Firestore delete handled locally:', fErr);
      }

      logActivity({
        action: 'HAPUS_USER',
        username: currentUser.username,
        venue: targetUser?.venue || 'Pusat',
        details: `Menghapus user: ${targetUser?.username}`
      }).catch(() => {});
    } catch (err) {
      console.error('Error deleting user:', err);
    }
  };

  // Photo Verification (Approve / Reject) - 100% Instant & Resilient
  const handleVerifyPhoto = async (photoId: string, status: 'verified' | 'rejected') => {
    try {
      const photo = photos.find((p) => p.id === photoId);
      const updateData: Partial<PhotoUpload> = {
        status,
        adminComment:
          adminNoteInput.trim() ||
          (status === 'verified' ? 'Foto telah diverifikasi dan sah.' : 'Foto ditolak, harap unggah ulang.'),
        verifiedAt: new Date().toISOString()
      };

      // 1. Instantly update local state in parent App for 0ms UI response
      if (onUpdatePhoto) {
        onUpdatePhoto(photoId, updateData);
      }

      // 2. Persist update into IndexedDB & local storage caches
      updateCachedPhotoStatus(photoId, status, updateData);

      // 3. Close modal & clear note input immediately
      if (inspectingPhoto?.id === photoId) {
        setInspectingPhoto(null);
      }
      setAdminNoteInput('');
      setActionFeedback({
        type: 'success',
        message: `Foto ${photo?.category || ''} (${photo?.venue || ''}) berhasil ${
          status === 'verified' ? 'disetujui & disahkan' : 'ditolak'
        }!`
      });
      setTimeout(() => setActionFeedback(null), 3000);

      // 4. Non-blocking Firestore write with timeout (never hangs UI even if daily quota exceeded)
      const photoRef = doc(db, 'photos', photoId);
      safeFirestoreWrite(setDoc(photoRef, updateData, { merge: true }), 3000, 'Verify Photo');

      // 5. Non-fatal audit logging
      logActivity({
        action: status === 'verified' ? 'VERIFIKASI_FOTO' : 'TOLAK_FOTO',
        username: currentUser.username,
        venue: photo?.venue || '',
        details: `${status === 'verified' ? 'Menyetujui' : 'Menolak'} foto ${photo?.category || ''} milik ${
          photo?.username || ''
        } (${photo?.venue || ''})`
      }).catch(() => {});

      // 6. Non-fatal system notification
      sendSystemNotification({
        type: 'verify',
        title: status === 'verified' ? 'Foto Disetujui' : 'Foto Ditolak',
        message: `Foto ${photo?.category || ''} di ${photo?.venue || ''} telah ${
          status === 'verified' ? 'diverifikasi dan disahkan' : 'ditolak'
        } oleh Admin.`,
        venue: photo?.venue,
        username: photo?.username
      }).catch(() => {});
    } catch (err) {
      console.error('Error updating photo verification status:', err);
      setActionFeedback({ type: 'error', message: 'Gagal memperbarui status verifikasi foto.' });
      setTimeout(() => setActionFeedback(null), 3000);
    }
  };

  // Delete Incoming Photo (Admin Role) - 100% Instant & Resilient
  const handleDeletePhotoSubmit = async (photo: PhotoUpload) => {
    if (!photo) return;
    setIsDeletingPhoto(true);
    try {
      // 1. Mark photo as deleted in IndexedDB & local storage across all device caches
      markPhotoAsDeleted(photo.id, photo.userId);

      // 2. Callback to parent App state for immediate UI sync
      if (onDeletePhoto) {
        onDeletePhoto(photo.id);
      }

      // 3. Close inspecting modal & delete modal immediately
      if (inspectingPhoto?.id === photo.id) {
        setInspectingPhoto(null);
      }
      setDeletingPhoto(null);

      setActionFeedback({
        type: 'success',
        message: `Foto ${photo.category} (${photo.venue}) berhasil dihapus!`
      });
      setTimeout(() => setActionFeedback(null), 3500);

      // 4. Non-blocking Firestore delete with timeout
      const photoRef = doc(db, 'photos', photo.id);
      safeFirestoreWrite(deleteDoc(photoRef), 3000, 'Delete Photo');

      // 5. Audit Trail Log
      logActivity({
        action: 'HAPUS_FOTO',
        username: currentUser.username,
        venue: photo.venue,
        details: `Admin menghapus foto ${photo.category} dari ${photo.username} (${photo.venue})`
      }).catch(() => {});

      // 6. System Notification
      sendSystemNotification({
        type: 'crud',
        title: 'Foto Masuk Dihapus',
        message: `Foto ${photo.category} dari ${photo.venue} (${photo.username}) telah dihapus oleh Admin.`,
        venue: photo.venue,
        username: photo.username
      }).catch(() => {});
    } catch (err) {
      console.error('Error deleting photo:', err);
      setActionFeedback({
        type: 'error',
        message: 'Gagal menghapus foto. Silakan coba kembali.'
      });
      setTimeout(() => setActionFeedback(null), 3500);
    } finally {
      setIsDeletingPhoto(false);
    }
  };

  // Reset / Reseed 21 Users Table
  const handleReseedInitialData = async () => {
    setIsResetModalOpen(false);
    setIsResettingData(true);
    try {
      // 1. Update local users state
      for (const u of INITIAL_USERS) {
        if (onAddUser) onAddUser(u);
      }

      // 2. Batch commit to Firestore
      try {
        const batch = writeBatch(db);
        for (const u of INITIAL_USERS) {
          const userRef = doc(db, 'users', u.id);
          batch.set(userRef, {
            ...u,
            createdAt: new Date().toISOString()
          });
        }
        await batch.commit();
      } catch (fErr) {
        console.warn('Firestore reseed batch handled locally:', fErr);
      }

      logActivity({
        action: 'RESEED_DATA',
        username: currentUser.username,
        venue: 'Pusat',
        details: 'Menyinkronkan ulang 21 pengguna venue dari data tabel'
      }).catch(() => {});

      setActionFeedback({ type: 'success', message: 'Berhasil menyinkronkan ulang 21 user venue dari tabel!' });
      setTimeout(() => setActionFeedback(null), 3500);
    } catch (err) {
      console.error('Error reseeding data:', err);
      setActionFeedback({ type: 'error', message: 'Gagal menyinkronkan data.' });
      setTimeout(() => setActionFeedback(null), 3500);
    } finally {
      setIsResettingData(false);
    }
  };

  // Export Users to CSV
  const exportUsersCSV = () => {
    const headers = ['No', 'Venue', 'Username', 'Password', 'Role', 'Uji Fungsi', 'Tahap 1 Tasks', 'Tahap 2 Dates', 'Online'];
    const rows = users.map(u => [
      u.no,
      `"${u.venue}"`,
      `"${u.username}"`,
      `"${u.password}"`,
      u.role,
      `"${u.ujiFungsi}"`,
      `"${u.tahap1Tasks.join('; ')}"`,
      `"${u.tahap2Dates.join('; ')}"`,
      u.isOnline ? 'ONLINE' : 'OFFLINE'
    ]);
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `Daftar_User_Venue_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Mark all notifications as read
  const handleMarkAllNotifsRead = async () => {
    try {
      for (const notif of notifications.filter(n => !n.read)) {
        await updateDoc(doc(db, 'notifications', notif.id), { read: true });
      }
    } catch (err) {
      console.warn('Failed to mark notifications read:', err);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-['Plus_Jakarta_Sans',sans-serif]">
      {/* Top Navbar */}
      <header className="bg-slate-900/90 backdrop-blur border-b border-slate-800 sticky top-0 z-40 px-4 lg:px-8 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-sky-500 to-indigo-600 flex items-center justify-center font-bold text-white shadow-lg shadow-sky-950 text-xs">
            STAN
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-extrabold tracking-tight text-slate-100">
                Dashboard Monitoring SPMB STAN 2026
              </h1>
              <span className="bg-sky-500/10 text-sky-400 text-[11px] px-2 py-0.5 rounded-full border border-sky-500/20 font-semibold flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                Admin Pusat
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Sistem Pemantauan Persiapan & Pelaksanaan Seleksi Penerimaan Mahasiswa Baru Real-Time
            </p>
          </div>
        </div>

        {/* Right side controls */}
        <div className="flex items-center gap-3">
          {/* Push notification enable button */}
          <button
            onClick={() => requestPushPermission().then(granted => {
              setActionFeedback({
                type: granted ? 'success' : 'error',
                message: granted ? 'Notifikasi desktop push berhasil diaktifkan!' : 'Izin notifikasi browser belum diberikan.'
              });
              setTimeout(() => setActionFeedback(null), 3000);
            })}
            className="hidden md:flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold border border-slate-700 transition-colors cursor-pointer"
            title="Aktifkan Notifikasi Desktop Push"
          >
            <Radio className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
            Aktifkan Push Web
          </button>

          {/* Real-Time Notification Bell */}
          <div className="relative">
            <button
              onClick={() => {
                setIsNotifDropdownOpen(!isNotifDropdownOpen);
                if (!isNotifDropdownOpen) handleMarkAllNotifsRead();
              }}
              className="relative p-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl transition-colors border border-slate-700"
              title="Notifikasi Real-Time"
            >
              <Bell className="w-4 h-4" />
              {unreadNotificationsCount > 0 && (
                <span className="absolute -top-1 -right-1 bg-rose-500 text-white font-bold text-[10px] w-5 h-5 rounded-full flex items-center justify-center animate-bounce shadow-md">
                  {unreadNotificationsCount}
                </span>
              )}
            </button>

            {/* Notification Dropdown Popover */}
            {isNotifDropdownOpen && (
              <div className="absolute right-0 mt-2 w-80 md:w-96 bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden z-50">
                <div className="p-3 bg-slate-800/80 border-b border-slate-700 flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                    <Bell className="w-3.5 h-3.5 text-sky-400" />
                    Notifikasi Aktivitas Real-Time
                  </span>
                  <span className="text-[10px] text-slate-400 font-mono">
                    {notifications.length} notifikasi
                  </span>
                </div>

                <div className="max-h-80 overflow-y-auto divide-y divide-slate-800">
                  {notifications.length === 0 ? (
                    <div className="p-6 text-center text-xs text-slate-400">
                      Belum ada notifikasi aktivitas terbaru.
                    </div>
                  ) : (
                    notifications.map((notif) => (
                      <div
                        key={notif.id}
                        className={`p-3 text-xs transition-colors ${
                          !notif.read ? 'bg-sky-950/20' : 'hover:bg-slate-800/40'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span className="font-semibold text-slate-200 flex items-center gap-1">
                            {notif.type === 'login' && '🟢'}
                            {notif.type === 'upload' && '📸'}
                            {notif.type === 'verify' && '✅'}
                            {notif.type === 'crud' && '⚙️'}
                            {notif.title}
                          </span>
                          <span className="text-[10px] text-slate-500 shrink-0 font-mono">
                            {new Date(notif.createdAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">
                          {notif.message}
                        </p>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          {/* User profile / Logout */}
          <div className="flex items-center gap-3 pl-3 border-l border-slate-800">
            <div className="text-right hidden sm:block">
              <div className="text-xs font-bold text-slate-200">{currentUser.username}</div>
              <div className="text-[10px] text-emerald-400 font-mono">Administrator</div>
            </div>
            <button
              onClick={() => setIsLogoutModalOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 rounded-xl border border-rose-500/30 transition-all font-bold text-xs cursor-pointer shadow-sm active:scale-95"
              title="Keluar dari Aplikasi (Logout)"
            >
              <LogOut className="w-3.5 h-3.5 text-rose-400" />
              <span>Keluar</span>
            </button>
          </div>
        </div>
      </header>

      {/* Floating Action Feedback Banner */}
      {actionFeedback && (
        <div className="fixed top-16 right-6 z-50 animate-bounce">
          <div
            className={`px-4 py-2.5 rounded-2xl shadow-2xl text-xs font-semibold flex items-center gap-2 border ${
              actionFeedback.type === 'success'
                ? 'bg-emerald-950/90 text-emerald-200 border-emerald-500/40'
                : 'bg-rose-950/90 text-rose-200 border-rose-500/40'
            }`}
          >
            {actionFeedback.type === 'success' ? (
              <Check className="w-4 h-4 text-emerald-400 shrink-0" />
            ) : (
              <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0" />
            )}
            <span>{actionFeedback.message}</span>
          </div>
        </div>
      )}

      {/* Navigation Tabs */}
      <nav aria-label="Menu Admin" className="bg-slate-900/50 border-b border-slate-800 px-4 lg:px-8 flex items-center gap-2 overflow-x-auto">
        <button
          onClick={() => setActiveTab('overview')}
          className={`py-3 px-4 text-xs font-bold transition-all border-b-2 flex items-center gap-2 whitespace-nowrap ${
            activeTab === 'overview'
              ? 'border-sky-500 text-sky-400'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Layers className="w-4 h-4" />
          Ringkasan & Monitoring Real-Time
        </button>

        <button
          onClick={() => setActiveTab('users')}
          className={`py-3 px-4 text-xs font-bold transition-all border-b-2 flex items-center gap-2 whitespace-nowrap ${
            activeTab === 'users'
              ? 'border-sky-500 text-sky-400'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Users className="w-4 h-4" />
          Manajemen User & Tabel Venue ({users.length})
        </button>

        <button
          onClick={() => setActiveTab('photos')}
          className={`py-3 px-4 text-xs font-bold transition-all border-b-2 flex items-center gap-2 whitespace-nowrap ${
            activeTab === 'photos'
              ? 'border-sky-500 text-sky-400'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <ImageIcon className="w-4 h-4" />
          Galeri & Verifikasi Foto ({photos.length})
        </button>

        <button
          onClick={() => setActiveTab('logs')}
          className={`py-3 px-4 text-xs font-bold transition-all border-b-2 flex items-center gap-2 whitespace-nowrap ${
            activeTab === 'logs'
              ? 'border-sky-500 text-sky-400'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Activity className="w-4 h-4" />
          Log Aktivitas & Audit ({activityLogs.length})
        </button>
      </nav>

      {/* Main Body */}
      <main className="flex-1 p-4 lg:p-8 space-y-6 max-w-7xl mx-auto w-full">
        {/* TAB 1: RINGKASAN & MONITORING REAL-TIME */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            {/* Top Stat Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-slate-900/80 rounded-2xl p-4 border border-slate-800 shadow-md">
                <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
                  <span>Total Venue Terdaftar</span>
                  <MapPin className="w-4 h-4 text-sky-400" />
                </div>
                <div className="text-2xl font-black text-slate-100 font-mono">{totalVenues}</div>
                <div className="text-[11px] text-slate-500 mt-1">20 BDK & Non-BDK + 1 Pusat</div>
              </div>

              <div className="bg-slate-900/80 rounded-2xl p-4 border border-slate-800 shadow-md">
                <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
                  <span>Petugas Online Sekarang</span>
                  <Radio className="w-4 h-4 text-emerald-400 animate-pulse" />
                </div>
                <div className="text-2xl font-black text-emerald-400 font-mono">{onlineUsersCount}</div>
                <div className="text-[11px] text-slate-500 mt-1">Real-time status sinkron</div>
              </div>

              <div className="bg-slate-900/80 rounded-2xl p-4 border border-slate-800 shadow-md">
                <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
                  <span>Total Foto Masuk</span>
                  <ImageIcon className="w-4 h-4 text-amber-400" />
                </div>
                <div className="text-2xl font-black text-slate-100 font-mono">{totalPhotos}</div>
                <div className="text-[11px] text-slate-500 mt-1">Berkoordinat GPS & Stempel Waktu</div>
              </div>

              <div className="bg-slate-900/80 rounded-2xl p-4 border border-slate-800 shadow-md">
                <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
                  <span>Foto Terverifikasi</span>
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                </div>
                <div className="text-2xl font-black text-emerald-400 font-mono">{verifiedPhotosCount}</div>
                <div className="text-[11px] text-slate-500 mt-1">
                  {totalPhotos > 0 ? Math.round((verifiedPhotosCount / totalPhotos) * 100) : 0}% terverifikasi sah
                </div>
              </div>
            </div>

            {/* Grid Status Venue & Foto Terkini */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Kolom 1 & 2: Grid Pemantauan Status Venue */}
              <div className="lg:col-span-2 bg-slate-900/80 rounded-2xl p-5 border border-slate-800 shadow-md space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-sky-400" />
                      Status Pemantauan 20 Venue Nasional
                    </h2>
                    <p className="text-xs text-slate-400">Pantau progres unggah foto persiapan & pelaksanaan setiap lokasi</p>
                  </div>
                  <button
                    onClick={() => setActiveTab('users')}
                    className="text-xs text-sky-400 hover:text-sky-300 font-semibold"
                  >
                    Kelola Tabel →
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[460px] overflow-y-auto pr-1">
                  {users
                    .filter((u) => u.role === 'user')
                    .map((user) => {
                      const userPhotos = photos.filter((p) => p.userId === user.id);
                      const totalRequired = user.tahap1Tasks.length + user.tahap2Dates.length;
                      const percent = Math.min(100, Math.round((userPhotos.length / (totalRequired || 1)) * 100));

                      return (
                        <div
                          key={user.id}
                          className="bg-slate-800/60 rounded-xl p-3 border border-slate-700/60 hover:border-sky-500/50 transition-all flex flex-col justify-between"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <div className="flex items-center gap-1.5">
                                <span className="font-bold text-xs text-slate-200">{user.venue}</span>
                                {user.isOnline ? (
                                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" title="Online Sekarang"></span>
                                ) : (
                                  <span className="w-1.5 h-1.5 rounded-full bg-slate-600" title="Offline"></span>
                                )}
                              </div>
                              <p className="text-[11px] text-slate-400">Petugas: <span className="text-sky-400 font-mono">{user.username}</span></p>
                              <p className="text-[10px] text-amber-400/90 font-mono">Uji Fungsi: {user.ujiFungsi}</p>
                            </div>

                            <div className="text-right">
                              <span className="text-xs font-mono font-bold text-emerald-400">{percent}%</span>
                              <div className="text-[10px] text-slate-400">{userPhotos.length}/{totalRequired} Foto</div>
                            </div>
                          </div>

                          {/* Progress bar */}
                          <div className="w-full h-1.5 bg-slate-700 rounded-full overflow-hidden mt-3">
                            <div
                              className="h-full bg-gradient-to-r from-sky-500 to-emerald-400 rounded-full"
                              style={{ width: `${percent}%` }}
                            ></div>
                          </div>

                          {/* Action button to simulate as user (convenient for reviewers) */}
                          {onSelectUserToSimulate && (
                            <div className="mt-2.5 pt-2 border-t border-slate-700/40 flex justify-between items-center text-[10px]">
                              <span className="text-slate-400">{user.tahap2Dates.length} hari kegiatan</span>
                              <button
                                onClick={() => onSelectUserToSimulate(user)}
                                className="text-sky-400 hover:text-sky-300 font-medium flex items-center gap-1"
                              >
                                Buka di HP Android →
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                </div>
              </div>

              {/* Kolom 3: Feed Foto Masuk Terbaru Real-Time */}
              <div className="bg-slate-900/80 rounded-2xl p-5 border border-slate-800 shadow-md flex flex-col">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                    <ImageIcon className="w-4 h-4 text-emerald-400" />
                    Feed Foto Terbaru
                  </h2>
                  <span className="text-[10px] text-slate-400 font-mono">{photos.length} total</span>
                </div>

                <div className="flex-1 overflow-y-auto space-y-3 max-h-[460px] pr-1">
                  {photos.length === 0 ? (
                    <div className="p-8 text-center text-xs text-slate-500">
                      Belum ada foto yang diunggah oleh petugas venue.
                    </div>
                  ) : (
                    photos.slice(0, 8).map((photo) => (
                      <div
                        key={photo.id}
                        onClick={() => setInspectingPhoto(photo)}
                        className="bg-slate-800/80 rounded-xl p-2.5 border border-slate-700/70 hover:border-sky-500/50 cursor-pointer transition-all flex gap-3 items-center group/feed"
                      >
                        <div className="w-14 h-14 bg-black rounded-lg overflow-hidden shrink-0 border border-slate-700 relative">
                          <img src={photo.imageUrl} alt={photo.category} className="w-full h-full object-cover" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <p className="text-xs font-bold text-slate-200 truncate">{photo.venue}</p>
                            <span
                              className={`text-[9px] px-1.5 py-0.2 rounded font-semibold ${
                                photo.status === 'verified'
                                  ? 'bg-emerald-500/20 text-emerald-300'
                                  : 'bg-amber-500/20 text-amber-300'
                              }`}
                            >
                              {photo.status === 'verified' ? 'Sah' : 'Menunggu'}
                            </span>
                          </div>
                          <p className="text-[11px] text-sky-400 capitalize truncate">{photo.category}</p>
                          <div className="flex items-center gap-2 text-[10px] text-slate-400 font-mono mt-0.5">
                            <span>{photo.photoTime}</span>
                            <span>•</span>
                            <span className="truncate">{photo.latitude.toFixed(3)}°, {photo.longitude.toFixed(3)}°</span>
                          </div>
                        </div>
                        {currentUser.role === 'admin' && (
                          <div className="flex items-center gap-1.5 shrink-0">
                            {photo.status !== 'verified' ? (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleVerifyPhoto(photo.id, 'verified');
                                }}
                                className="px-2 py-1 bg-emerald-500/20 hover:bg-emerald-500/35 text-emerald-300 font-bold rounded-lg border border-emerald-500/40 transition-all flex items-center gap-1 text-[10px] cursor-pointer active:scale-95 shadow-sm"
                                title="Setujui dan Sahkan Foto"
                              >
                                <Check className="w-3 h-3" /> Setujui
                              </button>
                            ) : (
                              <span className="text-[10px] font-bold text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20 flex items-center gap-0.5">
                                <Check className="w-3 h-3" /> Sah
                              </span>
                            )}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setDeletingPhoto(photo);
                              }}
                              className="p-1.5 bg-slate-900/60 hover:bg-rose-600 text-slate-400 hover:text-white rounded-lg border border-slate-700/60 transition-colors cursor-pointer"
                              title="Hapus Foto"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: USER MANAGEMENT (CRUD TABEL USER SESUAI GAMBAR) */}
        {activeTab === 'users' && (
          <div className="space-y-4">
            {/* Toolbar */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-slate-900/80 p-4 rounded-2xl border border-slate-800">
              <div className="flex flex-wrap items-center gap-2 flex-1">
                {/* Search input */}
                <div className="relative flex-1 min-w-[200px]">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Cari Venue atau Username..."
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl pl-9 pr-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 outline-none focus:ring-1 focus:ring-sky-500"
                  />
                </div>

                {/* Role Filter */}
                <select
                  value={roleFilter}
                  onChange={(e) => setRoleFilter(e.target.value as 'all' | 'user' | 'admin')}
                  className="bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-200 outline-none"
                >
                  <option value="all">Semua Role</option>
                  <option value="user">Role User (Petugas Venue)</option>
                  <option value="admin">Role Admin (Pusat)</option>
                </select>

                {/* Status Filter */}
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as 'all' | 'online' | 'offline')}
                  className="bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-200 outline-none"
                >
                  <option value="all">Semua Status</option>
                  <option value="online">Online Sekarang</option>
                  <option value="offline">Offline</option>
                </select>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-2">
                <button
                  onClick={exportUsersCSV}
                  className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-xl border border-slate-700 flex items-center gap-1.5 transition-colors"
                  title="Unduh Tabel dalam format CSV / Excel"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" />
                  Export CSV
                </button>

                <button
                  onClick={() => setIsResetModalOpen(true)}
                  disabled={isResettingData}
                  className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-xl border border-slate-700 flex items-center gap-1.5 transition-colors cursor-pointer"
                  title="Sinkronkan ulang 21 baris data dari gambar"
                >
                  <RefreshCw className={`w-3.5 h-3.5 text-amber-400 ${isResettingData ? 'animate-spin' : ''}`} />
                  Reset 21 Baris
                </button>

                <button
                  onClick={() => {
                    setAddUserError('');
                    setIsAddUserModalOpen(true);
                  }}
                  className="px-3.5 py-2 bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-400 hover:to-indigo-500 text-white text-xs font-bold rounded-xl shadow flex items-center gap-1.5 transition-all cursor-pointer"
                >
                  <Plus className="w-4 h-4" /> Tambah User
                </button>
              </div>
            </div>

            {/* Exact Reference Table matching user's image */}
            <div className="bg-slate-900/90 rounded-2xl border border-slate-800 overflow-hidden shadow-xl">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    {/* Header Group Row matching spreadsheet structure */}
                    <tr className="bg-slate-950 border-b border-slate-800 text-slate-300">
                      <th rowSpan={2} className="py-3 px-3 font-bold border-r border-slate-800 text-center w-12">No</th>
                      <th rowSpan={2} className="py-3 px-3 font-bold border-r border-slate-800 min-w-[140px]">Venue</th>
                      <th rowSpan={2} className="py-3 px-3 font-bold border-r border-slate-800">Username</th>
                      <th rowSpan={2} className="py-3 px-3 font-bold border-r border-slate-800">Password</th>
                      <th rowSpan={2} className="py-3 px-2 font-bold border-r border-slate-800 text-center">Role</th>
                      <th rowSpan={2} className="py-3 px-3 font-bold border-r border-slate-800 min-w-[120px]">Uji Fungsi</th>
                      <th colSpan={2} className="py-2 px-3 font-bold text-center bg-emerald-950/40 text-emerald-300 border-b border-slate-800">
                        Tahap
                      </th>
                      <th rowSpan={2} className="py-3 px-3 font-bold text-center w-28">Aksi CRUD</th>
                    </tr>
                    <tr className="bg-slate-950/80 border-b border-slate-800 text-slate-400 text-[11px]">
                      <th className="py-2 px-3 bg-amber-950/20 text-amber-300 border-r border-slate-800 min-w-[220px]">
                        1. Persiapan (5 Foto Wajib)
                      </th>
                      <th className="py-2 px-3 bg-sky-950/20 text-sky-300 border-r border-slate-800 min-w-[260px]">
                        2. Pelaksanaan Kegiatan (Jadwal Tanggal)
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/80 font-normal">
                    {filteredUsers.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="py-8 text-center text-slate-500">
                          Tidak ada user yang sesuai kriteria pencarian.
                        </td>
                      </tr>
                    ) : (
                      filteredUsers.map((user, idx) => {
                        const userPhotos = photos.filter((p) => p.userId === user.id);
                        return (
                          <tr
                            key={user.id}
                            className={`hover:bg-slate-800/50 transition-colors ${
                              user.role === 'admin' ? 'bg-indigo-950/20' : ''
                            }`}
                          >
                            <td className="py-2.5 px-3 font-mono text-center text-slate-400 border-r border-slate-800/60">
                              {user.no || idx + 1}
                            </td>

                            <td className="py-2.5 px-3 font-bold text-slate-200 border-r border-slate-800/60">
                              <div className="flex items-center gap-1.5">
                                <span className="truncate">{user.venue}</span>
                                {user.isOnline && (
                                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0" title="Online"></span>
                                )}
                              </div>
                            </td>

                            <td className="py-2.5 px-3 font-mono text-sky-400 border-r border-slate-800/60">
                              {user.username}
                            </td>

                            <td className="py-2.5 px-3 font-mono text-slate-400 border-r border-slate-800/60">
                              <span className="bg-slate-800 px-1.5 py-0.5 rounded text-[11px]">
                                {user.password}
                              </span>
                            </td>

                            <td className="py-2.5 px-2 text-center border-r border-slate-800/60">
                              <span
                                className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase ${
                                  user.role === 'admin'
                                    ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30'
                                    : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                }`}
                              >
                                {user.role}
                              </span>
                            </td>

                            <td className="py-2.5 px-3 text-slate-300 border-r border-slate-800/60 font-mono text-[11px]">
                              {user.ujiFungsi}
                            </td>

                            {/* Tahap 1: Persiapan tasks */}
                            <td className="py-2.5 px-3 border-r border-slate-800/60">
                              {user.role === 'admin' ? (
                                <span className="text-slate-500">-</span>
                              ) : (
                                <div className="flex flex-wrap gap-1">
                                  {user.tahap1Tasks.map((t, i) => {
                                    const isUploaded = userPhotos.some((p) => p.stage === 'persiapan' && p.category.toLowerCase() === t.toLowerCase());
                                    return (
                                      <span
                                        key={i}
                                        className={`text-[9px] px-1.5 py-0.5 rounded font-medium ${
                                          isUploaded
                                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                            : 'bg-slate-800 text-slate-400'
                                        }`}
                                      >
                                        {isUploaded ? '✓ ' : ''}{t}
                                      </span>
                                    );
                                  })}
                                </div>
                              )}
                            </td>

                            {/* Tahap 2: Pelaksanaan dates */}
                            <td className="py-2.5 px-3 border-r border-slate-800/60">
                              {user.role === 'admin' ? (
                                <span className="text-slate-500">-</span>
                              ) : (
                                <div className="flex flex-wrap gap-1">
                                  {user.tahap2Dates.map((d, i) => {
                                    const isUploaded = userPhotos.some((p) => p.stage === 'pelaksanaan' && p.category.toLowerCase() === d.toLowerCase());
                                    return (
                                      <span
                                        key={i}
                                        className={`text-[9px] px-1.5 py-0.5 rounded font-mono ${
                                          isUploaded
                                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-bold'
                                            : 'bg-slate-800 text-sky-400/90'
                                        }`}
                                      >
                                        {isUploaded ? '✓ ' : ''}{d}
                                      </span>
                                    );
                                  })}
                                </div>
                              )}
                            </td>

                            {/* Actions CRUD */}
                            <td className="py-2.5 px-3 text-center">
                              <div className="flex items-center justify-center gap-1.5">
                                <button
                                  onClick={() => setEditingUser(user)}
                                  className="p-1.5 bg-slate-800 hover:bg-slate-700 text-sky-400 rounded-lg transition-colors"
                                  title="Edit User"
                                >
                                  <Edit2 className="w-3.5 h-3.5" />
                                </button>

                                <button
                                  onClick={() => setDeletingUserId(user.id)}
                                  className="p-1.5 bg-slate-800 hover:bg-rose-900/40 text-rose-400 rounded-lg transition-colors"
                                  title="Hapus User"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: GALERI FOTO & VERIFIKASI */}
        {activeTab === 'photos' && (
          <div className="space-y-4">
            {/* Filter toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-900/80 p-4 rounded-2xl border border-slate-800">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-slate-400 font-semibold flex items-center gap-1">
                  <Filter className="w-3.5 h-3.5 text-sky-400" /> Filter Foto:
                </span>

                <select
                  value={photoVenueFilter}
                  onChange={(e) => setPhotoVenueFilter(e.target.value)}
                  className="bg-slate-800 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-slate-200 outline-none"
                >
                  <option value="all">Semua Venue</option>
                  {Array.from(new Set(photos.map((p) => p.venue))).map((v, i) => (
                    <option key={i} value={v}>{v}</option>
                  ))}
                </select>

                <select
                  value={photoStageFilter}
                  onChange={(e) => setPhotoStageFilter(e.target.value)}
                  className="bg-slate-800 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-slate-200 outline-none"
                >
                  <option value="all">Semua Tahap</option>
                  <option value="persiapan">Tahap 1 (Persiapan)</option>
                  <option value="pelaksanaan">Tahap 2 (Pelaksanaan)</option>
                </select>

                <select
                  value={photoStatusFilter}
                  onChange={(e) => setPhotoStatusFilter(e.target.value)}
                  className="bg-slate-800 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-slate-200 outline-none"
                >
                  <option value="all">Semua Status</option>
                  <option value="submitted">Menunggu Verifikasi</option>
                  <option value="verified">Terverifikasi Sah</option>
                  <option value="rejected">Ditolak</option>
                </select>
              </div>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={async () => {
                    if (onRestorePhotos) {
                      await onRestorePhotos();
                    } else {
                      await restoreAllDeletedPhotos();
                    }
                    setActionFeedback({
                      type: 'success',
                      message: 'Semua foto berhasil dikembalikan & dipulihkan ke galeri!'
                    });
                    setTimeout(() => setActionFeedback(null), 3500);
                  }}
                  className="px-3 py-1.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold rounded-xl text-xs flex items-center gap-1.5 shadow-md transition-all active:scale-95 cursor-pointer"
                  title="Kembalikan dan pulihkan semua foto masuk yang hilang"
                >
                  <RotateCcw className="w-3.5 h-3.5" /> Kembalikan Semua Foto
                </button>

                <div className="text-xs text-slate-400 font-mono">
                  Menampilkan {filteredPhotos.length} dari {photos.length} foto
                </div>
              </div>
            </div>

            {/* Photo Cards Grid */}
            {filteredPhotos.length === 0 ? (
              <div className="bg-slate-900/60 rounded-2xl p-12 text-center border border-slate-800 text-slate-500">
                <ImageIcon className="w-12 h-12 mx-auto text-slate-700 mb-2" />
                <p className="text-sm font-semibold text-slate-300">Belum ada foto yang cocok dengan filter atau foto belum dimuat</p>
                <p className="text-xs text-slate-500 mt-1">Klik tombol di bawah ini untuk mengembalikan dan memunculkan kembali semua foto venue.</p>
                <button
                  type="button"
                  onClick={async () => {
                    if (onRestorePhotos) {
                      await onRestorePhotos();
                    } else {
                      await restoreAllDeletedPhotos();
                    }
                    setActionFeedback({
                      type: 'success',
                      message: 'Semua foto berhasil dikembalikan & dipulihkan ke galeri!'
                    });
                    setTimeout(() => setActionFeedback(null), 3500);
                  }}
                  className="mt-4 px-4 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold rounded-xl text-xs inline-flex items-center gap-1.5 shadow-md transition-all active:scale-95 cursor-pointer"
                >
                  <RotateCcw className="w-4 h-4" /> Kembalikan Semua Foto Sekarang
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {filteredPhotos.map((photo) => (
                  <div
                    key={photo.id}
                    className="bg-slate-900 rounded-2xl overflow-hidden border border-slate-800 hover:border-sky-500/50 transition-all shadow-lg flex flex-col"
                  >
                    {/* Image Preview with Watermark Stamp */}
                    <div
                      onClick={() => setInspectingPhoto(photo)}
                      className="aspect-[4/3] bg-black relative cursor-pointer group overflow-hidden"
                    >
                      <img
                        src={photo.imageUrl}
                        alt={photo.category}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-xs font-semibold gap-1.5">
                        <Eye className="w-4 h-4" /> Periksa Rincian
                      </div>

                      {/* Top-left Quick Delete button for Admin */}
                      {currentUser.role === 'admin' && (
                        <div className="absolute top-2 left-2 z-10">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeletingPhoto(photo);
                            }}
                            className="p-1.5 bg-slate-900/80 hover:bg-rose-600 text-rose-300 hover:text-white rounded-lg border border-rose-500/30 backdrop-blur-sm transition-all shadow-md cursor-pointer"
                            title="Hapus Foto Ini"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}

                      {/* Status chip */}
                      <div className="absolute top-2 right-2">
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded-full font-bold shadow ${
                            photo.status === 'verified'
                              ? 'bg-emerald-500 text-slate-950'
                              : photo.status === 'rejected'
                              ? 'bg-rose-500 text-white'
                              : 'bg-amber-400 text-slate-950'
                          }`}
                        >
                          {photo.status === 'verified' ? '✓ Sah' : photo.status === 'rejected' ? 'Ditolak' : 'Menunggu'}
                        </span>
                      </div>
                    </div>

                    {/* Metadata Card Footer */}
                    <div className="p-3 flex-1 flex flex-col justify-between text-xs space-y-2">
                      <div>
                        <div className="flex items-center justify-between gap-1">
                          <span className="font-bold text-slate-200 truncate">{photo.venue}</span>
                          {photo.driveStatus === 'synced' && (
                            <span className="text-[9px] text-emerald-400 font-bold flex items-center gap-0.5 shrink-0" title="Tersimpan di Google Drive">
                              ☁️ Drive
                            </span>
                          )}
                        </div>
                        <p className="text-sky-400 font-semibold capitalize truncate">{photo.category}</p>
                        {photo.driveFileName && (
                          <p className="text-[9px] text-slate-500 font-mono truncate" title={photo.driveFileName}>
                            {photo.driveFileName}
                          </p>
                        )}
                      </div>

                      <div className="space-y-1 text-[11px] text-slate-400 font-mono border-t border-slate-800/80 pt-2">
                        <div className="flex justify-between">
                          <span className="text-slate-500">Waktu:</span>
                          <span className="text-amber-300/90">{photo.photoTime}</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-slate-500">GPS:</span>
                          <a
                            href={`https://www.google.com/maps?q=${photo.latitude},${photo.longitude}`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-sky-400 underline flex items-center gap-0.5"
                          >
                            {photo.latitude.toFixed(3)}°, {photo.longitude.toFixed(3)}°
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        </div>
                      </div>

                      {/* Quick Verify and Action buttons */}
                      <div className="flex items-center gap-1.5 pt-1">
                        {photo.status === 'verified' ? (
                          <div className="flex-1 py-1.5 bg-emerald-500/20 text-emerald-300 font-bold rounded-lg border border-emerald-500/30 flex items-center justify-center gap-1 text-[11px]">
                            <Check className="w-3.5 h-3.5 text-emerald-400" /> Terverifikasi Sah
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleVerifyPhoto(photo.id, 'verified')}
                            className="flex-1 py-1.5 bg-emerald-500/20 hover:bg-emerald-500/35 text-emerald-300 font-bold rounded-lg border border-emerald-500/40 transition-colors flex items-center justify-center gap-1 text-[11px] cursor-pointer active:scale-95 shadow-sm"
                            title="Setujui dan Verifikasi"
                          >
                            <Check className="w-3.5 h-3.5" /> Setujui
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setInspectingPhoto(photo)}
                          className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition-colors cursor-pointer"
                          title="Buka Inspeksi Lengkap"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                        {currentUser.role === 'admin' && (
                          <button
                            type="button"
                            onClick={() => setDeletingPhoto(photo)}
                            className="p-1.5 bg-rose-500/15 hover:bg-rose-600 text-rose-300 hover:text-white rounded-lg border border-rose-500/30 transition-colors cursor-pointer"
                            title="Hapus Foto Masuk"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* TAB 4: LOG AKTIVITAS & AUDIT */}
        {activeTab === 'logs' && (
          <div className="space-y-4">
            <div className="bg-slate-900/80 rounded-2xl p-5 border border-slate-800 shadow-md">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                    <Activity className="w-4 h-4 text-sky-400" />
                    Log Jejak Aktivitas & Audit Real-Time
                  </h2>
                  <p className="text-xs text-slate-400">
                    Merekam setiap aktivitas login, pengambilan foto, dan perubahan data pengguna secara otomatis.
                  </p>
                </div>
                <span className="text-xs text-slate-500 font-mono">{activityLogs.length} entri</span>
              </div>

              <div className="space-y-2 max-h-[600px] overflow-y-auto pr-1">
                {activityLogs.length === 0 ? (
                  <div className="p-12 text-center text-xs text-slate-500">
                    Belum ada log aktivitas tercatat.
                  </div>
                ) : (
                  activityLogs.map((log) => (
                    <div
                      key={log.id}
                      className="bg-slate-800/50 rounded-xl p-3 border border-slate-700/60 flex items-start justify-between gap-3 text-xs"
                    >
                      <div className="flex items-start gap-2.5">
                        <div className="p-1.5 rounded-lg bg-sky-500/10 text-sky-400 font-mono text-[10px] font-bold mt-0.5">
                          {log.action}
                        </div>
                        <div>
                          <div className="font-semibold text-slate-200">
                            {log.username} ({log.venue})
                          </div>
                          <p className="text-slate-400 text-[11px] mt-0.5">{log.details}</p>
                        </div>
                      </div>
                      <div className="text-[10px] text-slate-500 font-mono shrink-0">
                        {new Date(log.createdAt).toLocaleString('id-ID')}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </main>

      {/* MODAL: TAMBAH USER BARU */}
      {isAddUserModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-lg shadow-2xl p-6 text-xs text-slate-200">
            <div className="flex items-center justify-between mb-4 pb-2 border-b border-slate-800">
              <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                <Plus className="w-4 h-4 text-sky-400" /> Tambah Akun User / Venue Baru
              </h3>
              <button
                onClick={() => setIsAddUserModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-200 rounded-lg"
              >
                ✕
              </button>
            </div>

            {addUserError && (
              <div className="mb-3 p-2.5 bg-rose-500/10 border border-rose-500/30 rounded-xl text-rose-300 text-xs flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0" />
                <span>{addUserError}</span>
              </div>
            )}

            <form onSubmit={handleCreateUser} className="space-y-3.5">
              <div>
                <label className="block text-[11px] font-semibold text-slate-300 mb-1">Nama Venue:</label>
                <input
                  type="text"
                  required
                  value={newUserForm.venue}
                  onChange={(e) => setNewUserForm({ ...newUserForm, venue: e.target.value })}
                  placeholder="Contoh: BDK Semarang atau Non-BDK Papua"
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-100 outline-none focus:ring-1 focus:ring-sky-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-300 mb-1">Username:</label>
                  <input
                    type="text"
                    required
                    value={newUserForm.username}
                    onChange={(e) => setNewUserForm({ ...newUserForm, username: e.target.value })}
                    placeholder="muklis"
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-100 outline-none focus:ring-1 focus:ring-sky-500"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-300 mb-1">Password:</label>
                  <input
                    type="text"
                    required
                    value={newUserForm.password}
                    onChange={(e) => setNewUserForm({ ...newUserForm, password: e.target.value })}
                    placeholder="muklis123"
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-100 outline-none focus:ring-1 focus:ring-sky-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-300 mb-1">Role:</label>
                  <select
                    value={newUserForm.role}
                    onChange={(e) => setNewUserForm({ ...newUserForm, role: e.target.value as 'user' | 'admin' })}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-100 outline-none"
                  >
                    <option value="user">User (Petugas Venue)</option>
                    <option value="admin">Admin (Pusat)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-300 mb-1">Jadwal Uji Fungsi:</label>
                  <input
                    type="text"
                    value={newUserForm.ujiFungsi}
                    onChange={(e) => setNewUserForm({ ...newUserForm, ujiFungsi: e.target.value })}
                    placeholder="19 Oktober 2026"
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-100 outline-none"
                  />
                </div>
              </div>

              {newUserForm.role === 'user' && (
                <div>
                  <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                    Tahap 2 Tanggal Pelaksanaan (Pisahkan koma):
                  </label>
                  <input
                    type="text"
                    value={newUserForm.tahap2DatesInput}
                    onChange={(e) => setNewUserForm({ ...newUserForm, tahap2DatesInput: e.target.value })}
                    placeholder="20 Oktober 2026, 21 Oktober 2026, 22 Oktober 2026"
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-100 outline-none"
                  />
                  <p className="text-[10px] text-slate-500 mt-1">Tahap 1 (5 foto persiapan) akan disertakan otomatis.</p>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsAddUserModalOpen(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold rounded-xl text-xs transition-colors"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white font-bold rounded-xl text-xs transition-colors"
                >
                  Simpan User
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: EDIT USER */}
      {editingUser && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-lg shadow-2xl p-6 text-xs text-slate-200">
            <div className="flex items-center justify-between mb-4 pb-2 border-b border-slate-800">
              <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                <Edit2 className="w-4 h-4 text-sky-400" /> Edit User / Venue: {editingUser.venue}
              </h3>
              <button onClick={() => setEditingUser(null)} className="p-1 text-slate-400 hover:text-slate-200">✕</button>
            </div>

            <form onSubmit={handleUpdateUser} className="space-y-3.5">
              <div>
                <label className="block text-[11px] font-semibold text-slate-300 mb-1">Nama Venue:</label>
                <input
                  type="text"
                  required
                  value={editingUser.venue}
                  onChange={(e) => setEditingUser({ ...editingUser, venue: e.target.value })}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-100 outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-300 mb-1">Username:</label>
                  <input
                    type="text"
                    required
                    value={editingUser.username}
                    onChange={(e) => setEditingUser({ ...editingUser, username: e.target.value })}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-100 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-300 mb-1">Password:</label>
                  <input
                    type="text"
                    required
                    value={editingUser.password}
                    onChange={(e) => setEditingUser({ ...editingUser, password: e.target.value })}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-100 outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-300 mb-1">Role:</label>
                  <select
                    value={editingUser.role}
                    onChange={(e) => setEditingUser({ ...editingUser, role: e.target.value as 'user' | 'admin' })}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-100 outline-none"
                  >
                    <option value="user">User (Petugas Venue)</option>
                    <option value="admin">Admin (Pusat)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-300 mb-1">Uji Fungsi:</label>
                  <input
                    type="text"
                    value={editingUser.ujiFungsi}
                    onChange={(e) => setEditingUser({ ...editingUser, ujiFungsi: e.target.value })}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-100 outline-none"
                  />
                </div>
              </div>

              {editingUser.role === 'user' && (
                <div>
                  <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                    Tahap 2 Jadwal Tanggal (Pisahkan dengan koma):
                  </label>
                  <input
                    type="text"
                    value={editingUser.tahap2Dates.join(', ')}
                    onChange={(e) =>
                      setEditingUser({
                        ...editingUser,
                        tahap2Dates: e.target.value.split(',').map((s) => s.trim()).filter(Boolean)
                      })
                    }
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-100 outline-none"
                  />
                </div>
              )}

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setEditingUser(null)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold rounded-xl text-xs transition-colors"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white font-bold rounded-xl text-xs transition-colors"
                >
                  Perbarui Data
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* CONFIRM DELETE MODAL */}
      {deletingUserId && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-sm w-full p-6 text-center space-y-4">
            <ShieldAlert className="w-12 h-12 text-rose-500 mx-auto" />
            <h3 className="text-sm font-bold text-slate-100">Hapus Akun Pengguna Ini?</h3>
            <p className="text-xs text-slate-400">
              Tindakan ini tidak dapat dibatalkan. Pengguna tidak akan dapat login kembali ke aplikasi selular.
            </p>
            <div className="flex justify-center gap-2 pt-2">
              <button
                type="button"
                onClick={() => setDeletingUserId(null)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold rounded-xl text-xs cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={() => handleDeleteUser(deletingUserId)}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white font-bold rounded-xl text-xs cursor-pointer shadow"
              >
                Ya, Hapus
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CONFIRM LOGOUT MODAL */}
      {isLogoutModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-sm w-full p-6 text-center space-y-4 shadow-2xl">
            <div className="w-12 h-12 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-400 flex items-center justify-center mx-auto">
              <LogOut className="w-6 h-6" />
            </div>
            <h3 className="text-sm font-bold text-slate-100">Keluar dari Dashboard Admin?</h3>
            <p className="text-xs text-slate-400">
              Sesi Administrator Anda akan ditutup dan Anda akan dialihkan kembali ke halaman login.
            </p>
            <div className="flex justify-center gap-2 pt-2">
              <button
                type="button"
                onClick={() => setIsLogoutModalOpen(false)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold rounded-xl text-xs cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsLogoutModalOpen(false);
                  onLogout();
                }}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white font-bold rounded-xl text-xs cursor-pointer shadow"
              >
                Ya, Keluar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CONFIRM RESET 21 USERS MODAL */}
      {isResetModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-sm w-full p-6 text-center space-y-4 shadow-2xl">
            <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-400 flex items-center justify-center mx-auto">
              <RefreshCw className="w-6 h-6" />
            </div>
            <h3 className="text-sm font-bold text-slate-100">Sinkronkan Ulang 21 Baris Data?</h3>
            <p className="text-xs text-slate-400">
              Tindakan ini akan mengembalikan seluruh daftar 21 venue dan akun ke data awal sesuai tabel lampiran gambar.
            </p>
            <div className="flex justify-center gap-2 pt-2">
              <button
                type="button"
                onClick={() => setIsResetModalOpen(false)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold rounded-xl text-xs cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleReseedInitialData}
                disabled={isResettingData}
                className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white font-bold rounded-xl text-xs cursor-pointer shadow"
              >
                {isResettingData ? 'Menyinkronkan...' : 'Ya, Sinkronkan Ulang'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* INSPECT PHOTO MODAL */}
      {inspectingPhoto && (
        <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex flex-col p-4 md:p-6">
          <div className="flex items-center justify-between text-white pb-3 max-w-5xl mx-auto w-full">
            <div>
              <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">
                {inspectingPhoto.venue} — <span className="text-sky-400 capitalize">{inspectingPhoto.category}</span>
              </h2>
              <p className="text-xs text-slate-400">
                Pengunggah: {inspectingPhoto.username} • Waktu: {inspectingPhoto.photoDate} {inspectingPhoto.photoTime}
              </p>
            </div>
            <button
              onClick={() => setInspectingPhoto(null)}
              className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="flex-1 max-w-5xl mx-auto w-full flex flex-col lg:flex-row gap-4 overflow-hidden">
            {/* Left: Big Stamped Photo View */}
            <div className="flex-1 bg-black rounded-2xl overflow-hidden flex items-center justify-center border border-slate-800 relative">
              <img
                src={inspectingPhoto.imageUrl}
                alt="Foto Stempel"
                className="max-h-full max-w-full object-contain"
              />
            </div>

            {/* Right: Metadata & Verification Controls */}
            <div className="w-full lg:w-80 bg-slate-900 rounded-2xl p-4 border border-slate-800 flex flex-col justify-between text-xs space-y-3">
              <div className="space-y-3 overflow-y-auto">
                <div className="font-bold text-slate-200 uppercase tracking-wider text-[11px] pb-1 border-b border-slate-800">
                  Data Bukti Digital
                </div>

                <div className="space-y-2">
                  <div>
                    <span className="text-slate-400 text-[10px] block">Tahap Kegiatan:</span>
                    <span className="font-semibold text-slate-200 capitalize">
                      {inspectingPhoto.stage === 'persiapan' ? 'Tahap 1 (Persiapan)' : 'Tahap 2 (Pelaksanaan)'}
                    </span>
                  </div>

                  <div>
                    <span className="text-slate-400 text-[10px] block">Waktu Foto Diambil:</span>
                    <span className="font-mono text-amber-300 font-semibold">
                      {inspectingPhoto.photoDate} {inspectingPhoto.photoTime}
                    </span>
                  </div>

                  <div>
                    <span className="text-slate-400 text-[10px] block">Koordinat Geografis (GPS):</span>
                    <a
                      href={`https://www.google.com/maps?q=${inspectingPhoto.latitude},${inspectingPhoto.longitude}`}
                      target="_blank"
                      rel="noreferrer"
                      className="font-mono text-sky-400 underline flex items-center gap-1 font-semibold"
                    >
                      {inspectingPhoto.latitude.toFixed(6)}°, {inspectingPhoto.longitude.toFixed(6)}°
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                    <span className="text-[10px] text-slate-500 block">
                      Akurasi Posisi: ±{Math.round(inspectingPhoto.accuracy)} meter
                    </span>
                  </div>

                  <div>
                    <span className="text-slate-400 text-[10px] block">Status Verifikasi Saat Ini:</span>
                    <span
                      className={`inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                        inspectingPhoto.status === 'verified'
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                          : inspectingPhoto.status === 'rejected'
                          ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                          : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                      }`}
                    >
                      {inspectingPhoto.status === 'verified' ? '✓ Sah / Terverifikasi' : inspectingPhoto.status === 'rejected' ? 'Ditolak' : 'Menunggu Verifikasi'}
                    </span>
                  </div>

                  {inspectingPhoto.driveFileName && (
                    <div className="pt-1.5 border-t border-slate-800">
                      <span className="text-slate-400 text-[10px] block">Nama File Google Drive (Sesuai Tabel):</span>
                      <span className="font-mono text-amber-300 text-[11px] break-all select-all font-semibold block bg-slate-950 p-2 rounded-lg border border-slate-800 mt-0.5">
                        {inspectingPhoto.driveFileName}
                      </span>
                    </div>
                  )}

                  <div className="pt-1 border-t border-slate-800 flex items-center justify-between">
                    <span className="text-slate-400 text-[10px]">Penyimpanan Cloud:</span>
                    {inspectingPhoto.driveFileUrl ? (
                      <a
                        href={inspectingPhoto.driveFileUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="px-2.5 py-1 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 rounded-lg font-semibold flex items-center gap-1 text-[11px] border border-emerald-500/30"
                      >
                        Buka di Google Drive <ExternalLink className="w-3 h-3" />
                      </a>
                    ) : (
                      <span className="text-slate-500 text-[10px] font-mono">Tersimpan di Firebase</span>
                    )}
                  </div>

                  {inspectingPhoto.notes && (
                    <div className="bg-slate-800/60 p-2 rounded-xl text-slate-300 text-[11px]">
                      <span className="text-slate-400 font-semibold block text-[10px]">Catatan Pengunggah:</span>
                      "{inspectingPhoto.notes}"
                    </div>
                  )}
                </div>

                <div className="pt-2 border-t border-slate-800">
                  <label className="text-[10px] font-semibold text-slate-300 block mb-1">
                    Catatan Verifikasi Admin:
                  </label>
                  <textarea
                    rows={2}
                    value={adminNoteInput}
                    onChange={(e) => setAdminNoteInput(e.target.value)}
                    placeholder="Masukkan alasan atau persetujuan..."
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl p-2 text-xs text-slate-100 outline-none focus:ring-1 focus:ring-sky-500"
                  />
                </div>
              </div>

              {/* Action Buttons */}
              <div className="space-y-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => handleVerifyPhoto(inspectingPhoto.id, 'verified')}
                  className="w-full py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold rounded-xl flex items-center justify-center gap-1.5 shadow cursor-pointer"
                >
                  <Check className="w-4 h-4" /> Setujui & Verifikasi Foto
                </button>

                <button
                  type="button"
                  onClick={() => handleVerifyPhoto(inspectingPhoto.id, 'rejected')}
                  className="w-full py-2 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 font-semibold rounded-xl flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                >
                  <X className="w-4 h-4" /> Tolak Foto
                </button>

                {currentUser.role === 'admin' && (
                  <button
                    type="button"
                    onClick={() => setDeletingPhoto(inspectingPhoto)}
                    className="w-full py-2 bg-rose-600/15 hover:bg-rose-600 text-rose-400 hover:text-white border border-rose-500/30 hover:border-rose-600 font-bold rounded-xl flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-sm"
                  >
                    <Trash2 className="w-4 h-4" /> Hapus Foto Masuk Ini
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* CONFIRM DELETE PHOTO MODAL */}
      {deletingPhoto && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-md w-full p-6 space-y-4 shadow-2xl animate-scaleUp">
            <div className="flex items-center gap-3 pb-3 border-b border-slate-800">
              <div className="w-10 h-10 rounded-2xl bg-rose-500/15 border border-rose-500/30 text-rose-400 flex items-center justify-center shrink-0">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-100">Hapus Foto Masuk?</h3>
                <p className="text-[11px] text-slate-400">Konfirmasi penghapusan bukti foto dokumentasi</p>
              </div>
            </div>

            {/* Photo Preview & Info Summary */}
            <div className="bg-slate-950/70 rounded-2xl p-3 border border-slate-800/80 flex gap-3 items-center">
              <div className="w-16 h-16 rounded-xl overflow-hidden bg-black shrink-0 border border-slate-800">
                <img
                  src={deletingPhoto.imageUrl}
                  alt={deletingPhoto.category}
                  className="w-full h-full object-cover"
                />
              </div>
              <div className="flex-1 min-w-0 text-xs space-y-0.5">
                <div className="font-bold text-slate-200 truncate">{deletingPhoto.venue}</div>
                <div className="text-sky-400 font-semibold capitalize truncate">{deletingPhoto.category}</div>
                <div className="text-[10px] text-slate-400 font-mono">
                  {deletingPhoto.photoDate} • {deletingPhoto.photoTime}
                </div>
                <div className="text-[10px] text-slate-500 font-mono truncate">
                  Oleh: {deletingPhoto.username}
                </div>
              </div>
            </div>

            <div className="bg-rose-500/10 border border-rose-500/25 p-3 rounded-2xl text-[11px] text-rose-200 flex items-start gap-2">
              <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <p className="leading-relaxed">
                Tindakan ini permanen. Foto akan dihapus dari basis data Firestore dan galeri monitoring pusat secara real-time.
              </p>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                disabled={isDeletingPhoto}
                onClick={() => setDeletingPhoto(null)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold rounded-xl text-xs transition-colors cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={isDeletingPhoto}
                onClick={() => handleDeletePhotoSubmit(deletingPhoto)}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white font-bold rounded-xl text-xs transition-colors cursor-pointer shadow flex items-center gap-1.5"
              >
                {isDeletingPhoto ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Menghapus...
                  </>
                ) : (
                  <>
                    <Trash2 className="w-3.5 h-3.5" /> Ya, Hapus Foto
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
