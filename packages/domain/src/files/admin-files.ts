/*
 * Модуль «Файлы» Админки и вкладка «Файлы» карточки организации (доработки 20.11.2026, пакет 2,
 * блоки 3–5; прототип admin/admin-files.js, modules/file-trash.js; этап 1, П4–П6, поток И).
 */
import type { FileTrashWhy } from './trash';

/** Что за строка «Все файлы» (прототип `cat`, номер строки — свой у каждого вида). */
export const ADMIN_FILE_KINDS = ['file', 'sent', 'receipt', 'lead', 'trash'] as const;
export type AdminFileKind = (typeof ADMIN_FILE_KINDS)[number];

/** Категория строки: файл организации, от контрагента, документ заявки, чек подписки, ждёт стирания. */
export const ADMIN_FILE_CATS = ['org', 'sent', 'lead', 'rcpt', 'trash'] as const;
export type AdminFileCat = (typeof ADMIN_FILE_CATS)[number];

/** Состояние строки (прототип `AF_ST`): загружен, новый от контрагента, отклонён фирмой, ждёт стирания. */
export const ADMIN_FILE_STATES = ['ready', 'new', 'rejected', 'trash'] as const;
export type AdminFileState = (typeof ADMIN_FILE_STATES)[number];

/**
 * Коды «Источника» (прототип `AF_KIND`, `afLinkSrc`): `card` — карточка контрагента, `sent` — от
 * контрагента, остальные — виды записей-источников файлов (`FILE_SOURCE_KINDS`), чек подписки и лишний
 * файл хранилища. Подпись — ключ словаря `afiles.src.<код>`.
 */
export const ADMIN_FILE_SRC_CODES = [
  'card',
  'sent',
  'manual',
  'report',
  'receipt',
  'tax_payment',
  'fee_payment',
  'money_operation',
  'one_off_service',
  'one_off_service_payment',
  'project',
  'project_payment',
  'task',
  'indicator_value',
  'lead',
  'subscription',
  'extra',
] as const;
export type AdminFileSrc = (typeof ADMIN_FILE_SRC_CODES)[number];

/** Код «Источника» файла по виду его записи (как в представлении `app.admin_storage_files`). */
export function adminFileSrcOf(sourceKind: string): string {
  if (sourceKind === 'contractor') return 'card';
  if (sourceKind === 'sent_file') return 'sent';
  return sourceKind;
}

/** Строки списков «Проверки хранилища» (прототип `STORE.check`). */
export const STORAGE_CHECK_LISTS = ['missing', 'extra', 'stuck', 'failed'] as const;
export type StorageCheckList = (typeof STORAGE_CHECK_LISTS)[number];

/** МБ в байтах и ГБ в МБ — как в ценах подписки (1 ГБ = 1 000 МБ, прототип `afGb`, `afMbOf`). */
export const BYTES_IN_MB = 1048576;
export const MB_IN_GB = 1000;

/** Занято, % от предела с одним знаком (прототип `afMem`: pct); предела нет — null. */
export function memoryPct(usedBytes: number, limitBytes: number | null): number | null {
  if (limitBytes === null || limitBytes <= 0) return null;
  return Math.round((usedBytes / limitBytes) * 1000) / 10;
}

/** Цвет полосы памяти (прототип `afMemBar`): от 100 % — красный, от 80 % — жёлтый. */
export function memoryLevel(pct: number | null): 'red' | 'yellow' | null {
  if (pct === null) return null;
  if (pct >= 100) return 'red';
  if (pct >= 80) return 'yellow';
  return null;
}

/** ГБ с одним знаком для «Занято 9,4 из 14 ГБ» (прототип `afGb`). */
export function memoryGb(bytes: number): number {
  return Math.round((bytes / BYTES_IN_MB / MB_IN_GB) * 10) / 10;
}

/** МБ с одним знаком (прототип `afN1(mb)`). */
export function memoryMb(bytes: number): number {
  return Math.round((bytes / BYTES_IN_MB) * 10) / 10;
}

/** «Вернуть» — только удалённый сотрудником и лишний файл хранилища (прототип `ftCanBack`). */
export function fileTrashRestorable(why: FileTrashWhy): boolean {
  return why === 'del' || why === 'extra';
}

/** Последние 12 месяцев до месяца `today` включительно, `ГГГГ-ММ` (прототип «Загружено по месяцам»). */
export function lastTwelveMonths(today: string): string[] {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  const out: string[] = [];
  for (let i = 11; i >= 0; i--) {
    const k = y * 12 + (m - 1) - i;
    out.push(`${Math.floor(k / 12)}-${String((k % 12) + 1).padStart(2, '0')}`);
  }
  return out;
}

/** Сколько часов прошло (прототип `afAge`), для «Возраста» лишнего файла. */
export function ageHours(at: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - at.getTime()) / 3600000));
}
