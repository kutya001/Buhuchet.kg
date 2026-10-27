import { useRef, type ChangeEvent } from 'react';
import { buttonClass, iconButtonClass, TOUCH_AREA } from './button';
import { Box } from './form';
import { Icon } from './icon';

/** Файл в блоке «Файлы»: имя и строка «PDF · 1,2 МБ» (её считает приложение). */
export interface FilesBoxItem {
  id: string;
  name: string;
  meta: string;
  /** Можно ли этому пользователю удалить файл: без права кнопки «Удалить» нет. */
  canDelete: boolean;
}

export interface FilesBoxLabels {
  /** Заголовок блока («Файлы»); к нему добавляется « · N». */
  title: string;
  attach: string;
  /** Пока файлы загружаются — подпись кнопки вместо «Прикрепить». */
  uploading: string;
  empty: string;
  download: (name: string) => string;
  remove: (name: string) => string;
  removeTitle: string;
}

export interface FilesBoxProps {
  items: readonly FilesBoxItem[];
  /** Право прикреплять файлы к этой записи: без него нет кнопки «Прикрепить». */
  canUpload: boolean;
  /** Файлы загружаются: кнопка «Прикрепить» недоступна. */
  busy?: boolean;
  labels: FilesBoxLabels;
  /** Выбраны файлы (можно несколько сразу). */
  onPick: (files: File[]) => void;
  onDownload: (item: FilesBoxItem) => void;
  /** Удалить — приложение спрашивает подтверждение само. */
  onDelete: (item: FilesBoxItem) => void;
}

/**
 * Блок «Файлы» карточки записи (прототип modules/services.js `filesBox`, стили `.box`, `.list`, `.li`):
 * заголовок «Файлы · N» с кнопкой «Прикрепить» (выбор нескольких файлов), строки — значок, имя,
 * «тип · размер», «Скачать» и «Удалить»; пусто — «Файлов пока нет».
 */
export function FilesBox({
  items,
  canUpload,
  busy = false,
  labels,
  onPick,
  onDownload,
  onDelete,
}: FilesBoxProps) {
  const input = useRef<HTMLInputElement>(null);
  const picked = (e: ChangeEvent<HTMLInputElement>) => {
    const files = [...(e.target.files ?? [])];
    // Тот же файл можно выбрать ещё раз (после ошибки).
    e.target.value = '';
    if (files.length) onPick(files);
  };
  return (
    <Box
      title={`${labels.title} · ${items.length}`}
      actions={
        canUpload ? (
          <>
            <button
              type="button"
              className={buttonClass('default', 'sm')}
              disabled={busy}
              aria-busy={busy || undefined}
              onClick={() => input.current?.click()}
            >
              <Icon name="clip" size="sm" />
              {busy ? labels.uploading : labels.attach}
            </button>
            <input ref={input} type="file" multiple hidden onChange={picked} data-files-input />
          </>
        ) : null
      }
    >
      {items.length ? (
        <ul className="m-0 flex list-none flex-col p-0">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex min-w-0 items-center gap-2.5 border-b border-line px-0.5 py-[9px] last:border-b-0 hover:bg-row-hover"
            >
              <Icon name="file" className="flex-none text-muted" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-semibold text-ink">{item.name}</div>
                <div className="truncate text-xs text-faint">{item.meta}</div>
              </div>
              <button
                type="button"
                className={`${iconButtonClass('sm')} ${TOUCH_AREA}`}
                aria-label={labels.download(item.name)}
                title={labels.download(item.name)}
                onClick={() => onDownload(item)}
              >
                <Icon name="download" size="sm" />
              </button>
              {item.canDelete ? (
                <button
                  type="button"
                  className={`${iconButtonClass('sm')} ${TOUCH_AREA}`}
                  aria-label={labels.remove(item.name)}
                  title={labels.removeTitle}
                  onClick={() => onDelete(item)}
                >
                  <Icon name="trash" size="sm" />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <span className="text-[13px] text-faint">{labels.empty}</span>
      )}
    </Box>
  );
}
