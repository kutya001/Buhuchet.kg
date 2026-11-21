'use client';

import { AdminFilesAll } from './afiles-all';
import { AdminFilesCheck } from './afiles-check';
import { AdminFilesStore } from './afiles-store';

/**
 * Админка → «Файлы» (доработки 20.11.2026, пакет 2, блок 3; прототип v154 admin/admin-files.js; этап 1,
 * П4, поток И): вкладки «Хранилище», «Все файлы», «Проверка хранилища». Видит только администратор
 * платформы; файлы организаций он только смотрит и скачивает.
 */
export function AdminFilesScreen({ tab }: { tab: string }) {
  if (tab === 'all') return <AdminFilesAll />;
  if (tab === 'check') return <AdminFilesCheck />;
  return <AdminFilesStore />;
}
