/**
 * Отдельный поток браузера для разбора файла окна просмотра (доработки 16.11.2026, блок 5, пункт 3):
 * без доступа к странице, её cookie и разметке; сеть в потоке выключена — из файла ничего не
 * загружается. На каждый файл — свой поток, после ответа окно его закрывает.
 */
import { parseFileView, ViewError } from '@buhuchet/domain';
import type { ViewRequest, ViewResponse } from './view-protocol';

// Выключаем сеть потока после загрузки его кода: разбору она не нужна.
for (const key of ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource']) {
  try {
    Object.defineProperty(globalThis, key, {
      value: undefined,
      configurable: false,
      writable: false,
    });
  } catch {
    // Свойство не настраивается — значит, его и так нет.
  }
}

const scope = globalThis as unknown as {
  onmessage: ((e: MessageEvent<ViewRequest>) => void) | null;
  postMessage: (msg: ViewResponse) => void;
};

scope.onmessage = (e) => {
  const { name, bytes } = e.data;
  parseFileView(name, new Uint8Array(bytes)).then(
    (model) => scope.postMessage({ ok: true, model }),
    (err: unknown) =>
      scope.postMessage({ ok: false, code: err instanceof ViewError ? err.code : 'file_bad' }),
  );
};
