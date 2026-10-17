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

export default function App() {
  // Collections state
  const [users, setUsers] = useState<UserAccount[]>([]);
  const [photos, setPhotos] = useState<PhotoUpload[]>([]);
  const [notifications, setNotifications] = useState<SystemNotification[]>([]);
  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>([]);

  // Auth state
  const [currentUser, setCurrentUser] = useState<UserAccount | null>(null);
  const [simulatedUser, setSimulatedUser] = useState<UserAccount | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);

  // Active toast notification
  const [activeToast, setActiveToast] = useState<SystemNotification | null>(null);
  const initialMountRef = useRef(true);

  // 1. Validate connection and auto-seed users if needed
  useEffect(() => {
    testConnection();
  }, []);

  // 2. Real-time Users Listener
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
              setUsers(INITIAL_USERS);
            }
          } else {
            const list: UserAccount[] = [];
            snapshot.forEach((d) => {
              list.push({ id: d.id, ...d.data() } as UserAccount);
            });
            list.sort((a, b) => (a.no || 0) - (b.no || 0));
            setUsers(list);
          }
          setIsInitializing(false);
        },
        (error) => {
          console.warn('Error listening to users:', error);
          setUsers(INITIAL_USERS);
          setIsInitializing(false);
        }
      );
      return () => unsubscribe();
    } catch (err) {
      console.warn('Firestore users subscribe failure:', err);
      setUsers(INITIAL_USERS);
      setIsInitializing(false);
    }
  }, []);

  // 3. Real-time Photos Listener
  useEffect(() => {
    try {
      const photosCol = collection(db, 'photos');
      const unsubscribe = onSnapshot(
        photosCol,
        (snapshot) => {
          const list: PhotoUpload[] = [];
          snapshot.forEach((d) => {
            list.push({ id: d.id, ...d.data() } as PhotoUpload);
          });
          list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
          setPhotos(list);
        },
        (error) => {
          console.warn('Error listening to photos:', error);
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
      console.warn('Failed to update online status:', err);
    }

    // REQUIREMENT 8: Notifikasi setiap role user yang melakukan login secara real-time pada dashboard admin
    if (user.role === 'user') {
      await sendSystemNotification({
        type: 'login',
        title: `Petugas Login: ${user.venue}`,
        message: `User ${user.username} dari ${user.venue} baru saja login ke aplikasi Android selular.`,
        venue: user.venue,
        username: user.username
      });
    }

    await logActivity({
      action: 'LOGIN',
      username: user.username,
      venue: user.venue,
      details: `${user.role.toUpperCase()} berhasil login ke sistem`
    });
  };

  // Handle User Logout
  const handleLogout = async () => {
    if (currentUser) {
      try {
        const userRef = doc(db, 'users', currentUser.id);
        await updateDoc(userRef, {
          isOnline: false
        });

        await logActivity({
          action: 'LOGOUT',
          username: currentUser.username,
          venue: currentUser.venue,
          details: 'Pengguna keluar dari aplikasi'
        });
      } catch (err) {
        console.warn('Failed to update logout status:', err);
      }
    }
    setCurrentUser(null);
    setSimulatedUser(null);
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
          users={users.length > 0 ? users : INITIAL_USERS}
          onLogin={handleLogin}
        />
      ) : activeEffectiveUser?.role === 'admin' && !simulatedUser ? (
        /* Web Based Admin Dashboard */
        <AdminDashboard
          currentUser={currentUser}
          users={users.length > 0 ? users : INITIAL_USERS}
          photos={photos}
          notifications={notifications}
          activityLogs={activityLogs}
          onLogout={handleLogout}
          onSelectUserToSimulate={(targetUser) => setSimulatedUser(targetUser)}
        />
      ) : (
        /* Android Mobile App for Role User */
        <div className="relative flex-1 flex flex-col">
          {/* If an Admin is previewing/simulating a venue user, show top bar to return to Admin Dashboard */}
          {currentUser.role === 'admin' && simulatedUser && (
            <div className="bg-indigo-950/90 border-b border-indigo-800/80 px-4 py-2 flex items-center justify-between text-xs text-indigo-200 z-50">
              <span>
                👁 Mode Simulasi HP Android: <strong>{simulatedUser.venue}</strong> ({simulatedUser.username})
              </span>
              <button
                onClick={() => setSimulatedUser(null)}
                className="px-3 py-1 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-lg transition-colors"
              >
                ← Kembali ke Dashboard Admin
              </button>
            </div>
          )}

          <AndroidFrame
            activeVenue={activeEffectiveUser?.venue}
            username={activeEffectiveUser?.username}
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
