import type { FileViewModel } from '@buhuchet/domain';

/** Запрос потоку разбора: имя файла (по нему — формат) и его байты. */
export interface ViewRequest {
  name: string;
  bytes: ArrayBuffer;
}

/** Ответ потока разбора: модель для окна или код ошибки (`ViewErrorCode`, `file_bad`). */
export type ViewResponse = { ok: true; model: FileViewModel } | { ok: false; code: string };
