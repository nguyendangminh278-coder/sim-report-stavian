'use client';

import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { getFirebaseFirestore } from './firebase-client.ts';

export type UserAiSettings = {
  geminiApiKey: string;
  model: string;
};

function settingsDocument(userId: string) {
  const database = getFirebaseFirestore();
  if (!database) throw new Error('firebase/not-configured');
  return doc(database, 'users', userId, 'privateSettings', 'gemini');
}

export async function loadUserAiSettings(userId: string): Promise<UserAiSettings | null> {
  const snapshot = await getDoc(settingsDocument(userId));
  if (!snapshot.exists()) return null;

  const data = snapshot.data();
  return {
    geminiApiKey: typeof data.geminiApiKey === 'string' ? data.geminiApiKey : '',
    model: typeof data.model === 'string' ? data.model : '',
  };
}

export async function saveUserAiSettings(
  userId: string,
  settings: UserAiSettings,
): Promise<void> {
  await setDoc(
    settingsDocument(userId),
    {
      geminiApiKey: settings.geminiApiKey.trim(),
      model: settings.model.trim(),
      updatedAt: serverTimestamp(),
    },
    { merge: false },
  );
}

export function userSettingsErrorMessage(error: unknown) {
  const code = typeof error === 'object' && error && 'code' in error
    ? String((error as { code?: unknown }).code || '')
    : error instanceof Error
      ? error.message
      : '';

  if (code.includes('permission-denied')) {
    return 'Tài khoản chưa được cấp quyền đọc hoặc lưu cấu hình Firebase.';
  }
  if (code.includes('failed-precondition') || code.includes('not-found')) {
    return 'Cloud Firestore chưa được khởi tạo cho website.';
  }
  if (code.includes('unavailable')) {
    return 'Chưa thể kết nối Cloud Firestore. Hãy kiểm tra mạng rồi thử lại.';
  }
  if (code.includes('not-configured')) {
    return 'Firebase chưa được cấu hình cho website.';
  }
  return 'Chưa thể đồng bộ cấu hình với tài khoản Google.';
}
