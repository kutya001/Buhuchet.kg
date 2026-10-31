import { FILE_SOURCE_KINDS, fileExtension, type FileSourceKind } from './files';

/*
 * «Файловый менеджер» (ТЗ «Файловый менеджер»; прототип modules/files.js): все файлы организации в
 * одном списке с источником, плашки по видам источника, просмотр картинок и PDF в окне.
 */

/** Значок вида источника (прототип `FKIND`): плашка, метка «Откуда», «Перейти к источнику». */
export const FILE_KIND_ICONS: Readonly<Record<FileSourceKind, string>> = {
  manual: 'upload',
  contractor: 'building',
  report: 'file',
  receipt: 'wallet',
  tax_payment: 'send',
  task: 'task',
  indicator_value: 'gauge',
};

/**
 * Плашки по видам источника (прототип `renderFiles`): виды, файлы которых есть, по порядку модулей ТЗ, и
 * всегда «Загружено вручную» — последней.
 */
export function fileManagerPlates(counts: Readonly<Partial<Record<FileSourceKind, number>>>): {
  kind: FileSourceKind;
  count: number;
}[] {
  const kinds = FILE_SOURCE_KINDS.filter((k) => k !== 'manual' && (counts[k] ?? 0) > 0);
  return [...kinds, 'manual' as const].map((kind) => ({ kind, count: counts[kind] ?? 0 }));
}

/** «Тип» файла (прототип `fext`): расширение прописными; без расширения — null («ФАЙЛ» из словаря). */
export function fileTypeLabel(name: string): string | null {
  return fileExtension(name)?.toUpperCase() ?? null;
}

/** Картинки, которые браузер показывает сам (HEIC и TIFF — нет: их только скачать). */
const PREVIEW_IMAGES: ReadonlySet<string> = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/bmp',
]);

/**
 * Что показать в окне файла (ТЗ: «просмотр изображений и PDF в окне, остальное скачивается»):
 * картинку, PDF или ничего.
 */
export function filePreviewKind(contentType: string): 'image' | 'pdf' | null {
  if (contentType === 'application/pdf') return 'pdf';
  return PREVIEW_IMAGES.has(contentType) ? 'image' : null;
}
