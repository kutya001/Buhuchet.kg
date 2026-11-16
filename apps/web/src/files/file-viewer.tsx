'use client';

import { fileExtension } from '@buhuchet/domain';
import { buttonClass, Icon, Modal } from '@buhuchet/ui';
import { useState, type ReactNode } from 'react';
import { useT } from '../l10n/provider';
import { fileSizeText } from './files-data';

/*
 * Окно просмотра файла (доработки 16.11.2026, блок 5, пункт 1) — ЗАГЛУШКА потока К с пропсами контракта
 * потоков И и К: окно делает поток И, в общей сборке этапа 2 этот файл заменяется его файлом целиком.
 * Заглушка показывает только название и размер текущего файла, «‹ ›» по списку, «Скачать» и кнопки
 * места, откуда окно открыли; сам файл (`src`) не читает.
 */

/** Файл списка, по которому листает окно. */
export type ViewerFile = { id: string; name: string; size: number; contentType?: string };

export type FileViewerProps = {
  /** Файлы того же списка, в том же порядке, что на экране. */
  files: readonly ViewerFile[];
  /** Номер открытого файла в `files`. */
  index: number;
  /** Адрес, по которому окно читает байты файла (`fetch`, cookie своего сайта). */
  src: (id: string) => string | Promise<string>;
  /** Адрес «Скачать» (ссылка). */
  download: (id: string) => string;
  onClose: () => void;
  /** Подзаголовок окна для текущего файла. */
  sub?: (file: ViewerFile) => ReactNode;
  /** Блок под просмотром (откуда файл, комментарий, статус). */
  info?: (file: ViewerFile) => ReactNode;
  /** Кнопки места — после «Скачать», справа (прототип `foot`); есть они — своей «Закрыть» у окна нет. */
  footer?: (file: ViewerFile) => ReactNode;
};

export function FileViewer({
  files,
  index,
  download,
  onClose,
  sub,
  info,
  footer,
}: FileViewerProps) {
  const t = useT();
  const [at, setAt] = useState(() => Math.min(Math.max(index, 0), files.length - 1));
  const file = files[at];
  if (!file) return null;
  const ext = (fileExtension(file.name) ?? '').toUpperCase();
  return (
    <Modal
      open
      onClose={onClose}
      title={file.name}
      sub={sub?.(file)}
      size="mid"
      kind="card"
      footer={
        <>
          <a
            data-fv-download=""
            href={download(file.id)}
            className={buttonClass('default')}
            rel="noopener noreferrer"
          >
            <Icon name="download" size="sm" />
            {t('files.act.download')}
          </a>
          {/* Прототип v126 `fileView`: у одного файла «‹ ›» нет, у крайнего — недоступна. */}
          {files.length > 1 ? (
            <>
              <button
                type="button"
                data-fv-prev=""
                className={buttonClass('default', 'sm')}
                disabled={at === 0}
                onClick={() => setAt(at - 1)}
              >
                ‹
              </button>
              <button
                type="button"
                data-fv-next=""
                className={buttonClass('default', 'sm')}
                disabled={at >= files.length - 1}
                onClick={() => setAt(at + 1)}
              >
                ›
              </button>
            </>
          ) : null}
          <div className="flex-1" />
          {footer ? (
            footer(file)
          ) : (
            <button type="button" className={buttonClass('cta')} onClick={onClose}>
              {t('btn.close')}
            </button>
          )}
        </>
      }
    >
      <div data-file-viewer={file.id} className="flex flex-col gap-3">
        <div className="grid min-h-[160px] place-items-center rounded-[10px] border border-line bg-raised text-center">
          <span className="flex flex-col items-center gap-2 text-muted">
            <Icon name="file" />
            <b className="text-ink">
              {t('files.window.meta', { ext, size: fileSizeText(t, file.size) })}
            </b>
          </span>
        </div>
        {info?.(file)}
      </div>
    </Modal>
  );
}
