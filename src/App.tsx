/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  collection,
  onSnapshot,
  doc,
  updateDoc,
  writeBatch
} from 'firebase/firestore';
import { db, testConnection } from './firebase';
import { UserAccount, PhotoUpload, SystemNotification, ActivityLog } from './types';
import { INITIAL_USERS } from './data/initialData';
import { LoginForm } from './components/LoginForm';
import { AdminDashboard } from './components/AdminDashboard';
import { AndroidFrame } from './components/AndroidFrame';
import { UserMobileApp } from './components/UserMobileApp';
import { ToastNotification } from './components/ToastNotification';
import { sendSystemNotification, logActivity, requestPushPermission } from './utils/notifications';
import { playLoginAlertSound, playNotificationSound } from './utils/audio';
import { isPhotoDeleted, markPhotoAsDeleted } from './utils/photoStorage';

const STORAGE_USERS_KEY = 'spmb_stan_users_cache_v2';
const STORAGE_SESSION_KEY = 'spmb_stan_active_session_v2';

// Helper to ensure the admin user is always preserved in any user list
function ensureAdminInList(list: UserAccount[]): UserAccount[] {
  const hasAdmin = list.some((u) => u.username.toLowerCase() === 'admin');
  if (hasAdmin) return list;

  const defaultAdmin: UserAccount = {
    id: 'user_21',
    no: 21,
    venue: 'Pusat',
    username: 'admin',
    password: 'admin123',
    role: 'admin',
    ujiFungsi: '-',
    tahap1Tasks: [],
    tahap2Dates: [],
    isOnline: false
  };
  return [...list, defaultAdmin].sort((a, b) => (a.no || 0) - (b.no || 0));
}

// Helper to load users initially with cache or fallback
function loadInitialUsers(): UserAccount[] {
  try {
    const raw = localStorage.getItem(STORAGE_USERS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return ensureAdminInList(parsed);
      }
    }
  } catch (err) {
    console.warn('Could not read cached users:', err);
  }
  return ensureAdminInList(INITIAL_USERS);
}

// Helper to load initial session if saved
function loadInitialSession(): UserAccount | null {
  try {
    const raw = localStorage.getItem(STORAGE_SESSION_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.username) {
        return parsed;
      }
    }
  } catch (err) {
    console.warn('Could not read cached session:', err);
  }
  return null;
}

export default function App() {
  // Collections state - initialized with resilient data, NEVER empty!
  const [users, setUsers] = useState<UserAccount[]>(loadInitialUsers);
  const [photos, setPhotos] = useState<PhotoUpload[]>([]);
  const [notifications, setNotifications] = useState<SystemNotification[]>([]);
  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>([]);

  // Auth state
  const [currentUser, setCurrentUser] = useState<UserAccount | null>(loadInitialSession);
  const [simulatedUser, setSimulatedUser] = useState<UserAccount | null>(null);
  const [isInitializing, setIsInitializing] = useState(false);

  // Active toast notification
  const [activeToast, setActiveToast] = useState<SystemNotification | null>(null);
  const initialMountRef = useRef(true);

  // 1. Validate connection and auto-seed users if needed
  useEffect(() => {
    testConnection();
  }, []);

  // 2. Real-time Users Listener with automatic seeding and resilient cache
  useEffect(() => {
    try {
      const usersCol = collection(db, 'users');
      const unsubscribe = onSnapshot(
        usersCol,
        async (snapshot) => {
          if (snapshot.empty) {
            console.log('Seeding initial 21 users to Firestore...');
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
            } catch (seedErr) {
              console.warn('Auto-seed error:', seedErr);
            }
            setUsers(ensureAdminInList(INITIAL_USERS));
            try {
              localStorage.setItem(STORAGE_USERS_KEY, JSON.stringify(INITIAL_USERS));
            } catch {}
          } else {
            const list: UserAccount[] = [];
            snapshot.forEach((d) => {
              list.push({ id: d.id, ...d.data() } as UserAccount);
            });
            const completeList = ensureAdminInList(list).sort((a, b) => (a.no || 0) - (b.no || 0));
            setUsers(completeList);
            try {
              localStorage.setItem(STORAGE_USERS_KEY, JSON.stringify(completeList));
            } catch {}
          }
          setIsInitializing(false);
        },
        (error) => {
          console.warn('Error listening to users (fallback to cached/initial):', error);
          setIsInitializing(false);
        }
      );
      return () => unsubscribe();
    } catch (err) {
      console.warn('Firestore users subscribe failure:', err);
      setIsInitializing(false);
    }
  }, []);

  // Helper to retrieve local cached photos across venues for instant rendering
  const getAllCachedPhotos = (): PhotoUpload[] => {
    const localList: PhotoUpload[] = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('spmb_local_photos_')) {
          const raw = localStorage.getItem(key);
          if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
              const valid = parsed.filter((p: PhotoUpload) => p && !isPhotoDeleted(p.id));
              localList.push(...valid);
            }
          }
        }
      }
    } catch {}
    return localList;
  };

  // 3. Real-time Photos Listener with Local Cache Fallback
  useEffect(() => {
    // Initial sync from local storage
    const initialLocal = getAllCachedPhotos();
    if (initialLocal.length > 0) {
      setPhotos((prev) => {
        const map = new Map<string, PhotoUpload>();
        initialLocal.forEach((p) => map.set(p.id, p));
        prev.forEach((p) => {
          if (!isPhotoDeleted(p.id)) map.set(p.id, p);
        });
        return Array.from(map.values()).sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
      });
    }

    try {
      const photosCol = collection(db, 'photos');
      const unsubscribe = onSnapshot(
        photosCol,
        (snapshot) => {
          const map = new Map<string, PhotoUpload>();
          // Include any local pending photos
          getAllCachedPhotos().forEach((p) => map.set(p.id, p));
          snapshot.forEach((d) => {
            if (!isPhotoDeleted(d.id)) {
              map.set(d.id, { id: d.id, ...d.data() } as PhotoUpload);
            }
          });
          const list = Array.from(map.values()).sort(
            (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
          );
          setPhotos(list);
        },
        (error) => {
          console.warn('Photos listener warning (using cached photos):', error);
          const cached = getAllCachedPhotos();
          if (cached.length > 0) {
            setPhotos(cached);
          }
        }
      );
      return () => unsubscribe();
    } catch (err) {
      console.warn('Firestore photos subscribe failure:', err);
    }
  }, []);

  // 4. Real-time Notifications Listener (Audio + Toast trigger)
  useEffect(() => {
    try {
      const notifsCol = collection(db, 'notifications');
      const unsubscribe = onSnapshot(
        notifsCol,
        (snapshot) => {
          const list: SystemNotification[] = [];
          snapshot.forEach((d) => {
            list.push({ id: d.id, ...d.data() } as SystemNotification);
          });
          list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
          setNotifications(list);

          // If a new notification arrived after initial load, play sound & show toast
          if (!initialMountRef.current && list.length > 0) {
            const latest = list[0];
            const ageMs = Date.now() - new Date(latest.createdAt).getTime();
            if (ageMs < 10000) {
              setActiveToast(latest);
              if (latest.type === 'login') {
                playLoginAlertSound();
              } else {
                playNotificationSound();
              }
            }
          }
          initialMountRef.current = false;
        },
        (error) => {
          console.warn('Error listening to notifications:', error);
        }
      );
      return () => unsubscribe();
    } catch (err) {
      console.warn('Firestore notifications subscribe failure:', err);
    }
  }, []);

  // 5. Real-time Activity Logs Listener
  useEffect(() => {
    try {
      const logsCol = collection(db, 'activity_logs');
      const unsubscribe = onSnapshot(
        logsCol,
        (snapshot) => {
          const list: ActivityLog[] = [];
          snapshot.forEach((d) => {
            list.push({ id: d.id, ...d.data() } as ActivityLog);
          });
          list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
          setActivityLogs(list);
        },
        (error) => {
          console.warn('Error listening to activity logs:', error);
        }
      );
      return () => unsubscribe();
    } catch (err) {
      console.warn('Firestore logs subscribe failure:', err);
    }
  }, []);

  // Handle User Login
  const handleLogin = async (user: UserAccount) => {
    setCurrentUser(user);
    setSimulatedUser(null);
    try {
      localStorage.setItem(STORAGE_SESSION_KEY, JSON.stringify(user));
    } catch {}

    // Request desktop notifications permission seamlessly
    requestPushPermission().catch(() => {});

    // Update isOnline in Firestore
    try {
      const userRef = doc(db, 'users', user.id);
      await updateDoc(userRef, {
        isOnline: true,
        lastLoginAt: new Date().toISOString()
      });
    } catch (err) {
      console.warn('Failed to update online status in Firestore:', err);
    }

    // REQUIREMENT 8: Notifikasi setiap role user yang melakukan login secara real-time pada dashboard admin
    if (user.role === 'user') {
      await sendSystemNotification({
        type: 'login',
        title: `Petugas Login: ${user.venue}`,
        message: `User ${user.username} dari ${user.venue} baru saja login ke aplikasi Android selular.`,
        venue: user.venue,
        username: user.username
      }).catch(() => {});
    }

    await logActivity({
      action: 'LOGIN',
      username: user.username,
      venue: user.venue,
      details: `${user.role.toUpperCase()} berhasil login ke sistem`
    }).catch(() => {});
  };

  // Robust User CRUD State Handlers for Admin Dashboard
  const handleAddUserLocal = (newUser: UserAccount) => {
    setUsers((prev) => {
      const base = prev.length > 0 ? prev : loadInitialUsers();
      const filtered = base.filter((u) => u.id !== newUser.id && u.username.toLowerCase() !== newUser.username.toLowerCase());
      const next = [...filtered, newUser].sort((a, b) => (a.no || 0) - (b.no || 0));
      const withAdmin = ensureAdminInList(next);
      try {
        localStorage.setItem(STORAGE_USERS_KEY, JSON.stringify(withAdmin));
      } catch {}
      return withAdmin;
    });
  };

  const handleUpdateUserLocal = (updatedUser: UserAccount) => {
    setUsers((prev) => {
      const base = prev.length > 0 ? prev : loadInitialUsers();
      const next = base.map((u) => (u.id === updatedUser.id ? updatedUser : u));
      const withAdmin = ensureAdminInList(next);
      try {
        localStorage.setItem(STORAGE_USERS_KEY, JSON.stringify(withAdmin));
      } catch {}
      return withAdmin;
    });
  };

  const handleDeleteUserLocal = (userId: string) => {
    setUsers((prev) => {
      const base = prev.length > 0 ? prev : loadInitialUsers();
      const next = base.filter((u) => u.id !== userId);
      const withAdmin = ensureAdminInList(next);
      try {
        localStorage.setItem(STORAGE_USERS_KEY, JSON.stringify(withAdmin));
      } catch {}
      return withAdmin;
    });
  };

  const handleDeletePhotoLocal = (photoId: string) => {
    markPhotoAsDeleted(photoId);
    setPhotos((prev) => prev.filter((p) => p.id !== photoId));
  };

  // Handle User Logout - 100% Reliable and Instant
  const handleLogout = () => {
    const userToLogOut = currentUser;
    // 1. Immediately reset session state so the UI transitions to login screen without delay
    setCurrentUser(null);
    setSimulatedUser(null);
    try {
      localStorage.removeItem(STORAGE_SESSION_KEY);
    } catch {}

    // 2. Perform background Firestore status cleanup asynchronously
    if (userToLogOut) {
      try {
        const userRef = doc(db, 'users', userToLogOut.id);
        updateDoc(userRef, {
          isOnline: false
        }).catch((err) => console.warn('Background logout status update:', err));

        logActivity({
          action: 'LOGOUT',
          username: userToLogOut.username,
          venue: userToLogOut.venue,
          details: 'Pengguna keluar dari aplikasi'
        }).catch((err) => console.warn('Background logout activity log:', err));
      } catch (err) {
        console.warn('Logout background trigger warning:', err);
      }
    }
  };

  // When simulated in Android view by Admin
  const activeEffectiveUser = simulatedUser || currentUser;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-['Plus_Jakarta_Sans',sans-serif]">
      {/* Toast Notification for Real-Time Alerts */}
      <ToastNotification
        notification={activeToast}
        onDismiss={() => setActiveToast(null)}
      />

      {isInitializing ? (
        <div className="min-h-screen flex flex-col items-center justify-center text-slate-400 gap-3">
          <div className="w-10 h-10 border-4 border-sky-500 border-t-transparent rounded-full animate-spin"></div>
          <p className="text-xs font-semibold">Memuat Data Sistem Venue & Firebase...</p>
        </div>
      ) : !currentUser ? (
        /* Login Screen with empty input fields by default */
        <LoginForm
          users={users}
          onLogin={handleLogin}
        />
      ) : activeEffectiveUser?.role === 'admin' && !simulatedUser ? (
        /* Web Based Admin Dashboard */
        <AdminDashboard
          currentUser={currentUser}
          users={users}
          photos={photos}
          notifications={notifications}
          activityLogs={activityLogs}
          onLogout={handleLogout}
          onAddUser={handleAddUserLocal}
          onUpdateUser={handleUpdateUserLocal}
          onDeleteUser={handleDeleteUserLocal}
          onDeletePhoto={handleDeletePhotoLocal}
          onSelectUserToSimulate={(targetUser) => setSimulatedUser(targetUser)}
        />
      ) : (
        /* Android Mobile App for Role User */
        <div className="relative flex-1 flex flex-col">
          {/* If an Admin is previewing/simulating a venue user, show top bar to return to Admin Dashboard */}
          {currentUser.role === 'admin' && simulatedUser && (
            <div className="bg-indigo-950/90 border-b border-indigo-800/80 px-4 py-2.5 flex items-center justify-between text-xs text-indigo-200 z-50">
              <span className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                <span>Mode Simulasi HP: <strong>{simulatedUser.venue}</strong> ({simulatedUser.username})</span>
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setSimulatedUser(null)}
                  className="px-3 py-1 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-lg transition-colors cursor-pointer text-xs"
                >
                  ← Kembali ke Dashboard Admin
                </button>
                <button
                  onClick={handleLogout}
                  className="px-3 py-1 bg-rose-600/80 hover:bg-rose-600 text-white font-bold rounded-lg transition-colors cursor-pointer text-xs"
                >
                  Logout
                </button>
              </div>
            </div>
          )}

          <AndroidFrame
            activeVenue={activeEffectiveUser?.venue}
            username={activeEffectiveUser?.username}
            onLogout={handleLogout}
          >
            {activeEffectiveUser && (
              <UserMobileApp
                currentUser={activeEffectiveUser}
                onLogout={handleLogout}
              />
            )}
          </AndroidFrame>
        </div>
      )}
    </div>
  );
}
