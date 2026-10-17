import { collection, addDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { NotificationType } from '../types';
import { playLoginAlertSound, playNotificationSound } from './audio';

export async function requestPushPermission(): Promise<boolean> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return false;
  }
  try {
    if (Notification.permission === 'granted') {
      return true;
    }
    const perm = await Notification.requestPermission();
    return perm === 'granted';
  } catch (err) {
    console.warn('Error requesting notification permission:', err);
    return false;
  }
}

export function showBrowserPush(title: string, body: string, icon = '🔔') {
  if (typeof window === 'undefined' || !('Notification' in window)) return;

  if (Notification.permission === 'granted') {
    try {
      new Notification(title, {
        body,
        icon: 'https://api.iconify.design/lucide:bell.svg',
        tag: 'venue-monitoring-' + Date.now(),
      });
    } catch (err) {
      console.warn('Push notification failed:', err);
    }
  }
}

export async function sendSystemNotification({
  type,
  title,
  message,
  venue,
  username
}: {
  type: NotificationType;
  title: string;
  message: string;
  venue?: string;
  username?: string;
}) {
  // 1. Play auditory alert
  if (type === 'login') {
    playLoginAlertSound();
  } else {
    playNotificationSound();
  }

  // 2. Trigger browser push
  showBrowserPush(title, message);

  // 3. Persist to Firestore notifications collection for real-time sync
  try {
    const notifData = {
      type,
      title,
      message,
      venue: venue || '',
      username: username || '',
      read: false,
      createdAt: new Date().toISOString()
    };
    await addDoc(collection(db, 'notifications'), notifData);
  } catch (err) {
    console.error('Failed to save notification to Firestore:', err);
    // Don't crash user flow if network glitches
  }
}

export async function logActivity({
  action,
  username,
  venue,
  details
}: {
  action: string;
  username: string;
  venue: string;
  details: string;
}) {
  try {
    const logData = {
      action,
      username,
      venue,
      details,
      createdAt: new Date().toISOString()
    };
    await addDoc(collection(db, 'activity_logs'), logData);
  } catch (err) {
    console.error('Failed to log activity to Firestore:', err);
  }
}
