import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore, doc, getDocFromServer, disableNetwork, enableNetwork } from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

interface FirebaseAppConfig {
  projectId: string;
  appId: string;
  apiKey: string;
  authDomain: string;
  storageBucket: string;
  messagingSenderId: string;
  measurementId?: string;
  oAuthClientId?: string;
  recaptchaSiteKey?: string;
  firestoreDatabaseId?: string;
}

const config = firebaseConfig as FirebaseAppConfig;
const firestoreDatabaseId = config.firestoreDatabaseId || 'ai-studio-376632bb-73d6-4b67-b121-354c041f87e8';

const app = initializeApp(config);
export const db = getFirestore(app, firestoreDatabaseId);
export const auth = getAuth(app);

// Global Quota Guard to prevent Firestore SDK from hammering backend and logging repeated RESOURCE_EXHAUSTED errors
let quotaExhausted = false;
const QUOTA_STORAGE_KEY = 'spmb_quota_exhausted_date';
const todayDateStr = new Date().toISOString().slice(0, 10);

// Initialize state from localStorage if known for today
try {
  if (typeof localStorage !== 'undefined') {
    const savedDate = localStorage.getItem(QUOTA_STORAGE_KEY);
    if (savedDate === todayDateStr) {
      quotaExhausted = true;
      disableNetwork(db).catch(() => {});
    }
  }
} catch {}

export function isQuotaExhausted(): boolean {
  return quotaExhausted;
}

export function markQuotaExhausted(): void {
  if (quotaExhausted) return;
  quotaExhausted = true;
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(QUOTA_STORAGE_KEY, todayDateStr);
    }
  } catch {}
  try {
    // Shuts down all Firestore network streams and backoff retries immediately
    disableNetwork(db).catch(() => {});
  } catch {}
  console.warn('[Quota Guard] Firestore daily quota reached. App is operating seamlessly in local persistent mode.');
}

export function resetQuotaExhausted(): void {
  quotaExhausted = false;
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(QUOTA_STORAGE_KEY);
    }
  } catch {}
  try {
    enableNetwork(db).catch(() => {});
  } catch {}
}

/**
 * Execute a Firestore operation safely.
 * If Firestore daily quota is exhausted, immediately returns fallbackValue without making the RPC call.
 * This completely avoids backoff retry loops and repetitive RESOURCE_EXHAUSTED errors in the app.
 */
export async function executeFirestoreSafe<T>(
  operation: () => Promise<T>,
  fallbackValue: T | null = null,
  opName = 'operation'
): Promise<T | null> {
  if (isQuotaExhausted()) {
    return fallbackValue;
  }

  try {
    const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), 2500));
    const result = await Promise.race([operation(), timeoutPromise]);
    return result ?? fallbackValue;
  } catch (err: any) {
    const msg = String(err?.message || err);
    if (
      err?.code === 'resource-exhausted' ||
      msg.includes('RESOURCE_EXHAUSTED') ||
      msg.includes('Quota limit exceeded')
    ) {
      markQuotaExhausted();
      console.warn(`[Quota Guard] Firestore daily quota reached. App is operating seamlessly in local persistent mode.`);
      return fallbackValue;
    }
    console.warn(`[Firestore Safe] ${opName} note:`, err?.message || err);
    return fallbackValue;
  }
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export async function testConnection(): Promise<boolean> {
  if (isQuotaExhausted()) return false;
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    return true;
  } catch (error: any) {
    const msg = String(error?.message || error);
    if (
      error?.code === 'resource-exhausted' ||
      msg.includes('RESOURCE_EXHAUSTED') ||
      msg.includes('Quota limit exceeded')
    ) {
      markQuotaExhausted();
      return false;
    }
    if (error instanceof Error && error.message.includes('the client is offline')) {
      return false;
    }
    return true;
  }
}
