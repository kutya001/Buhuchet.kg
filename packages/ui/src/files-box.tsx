import { useRef, type ChangeEvent } from 'react';
import { buttonClass, iconButtonClass, TOUCH_AREA } from './button';
import { Box } from './form';
import { Icon } from './icon';

/** Файл в блоке «Файлы»: имя и строка «PDF · 1,2 МБ» (её считает приложение). */
export interface FilesBoxItem {
  id: string;
  name: string;
  meta: string;
  /** Примечание к файлу (прототип v95 `fNoteHtml`): строка под «тип · размер»; нет — строки нет. */
  note?: string | null;
  /** Можно ли этому пользователю удалить файл: без права кнопки «Удалить» нет. */
  canDelete: boolean;
  /** «Изменить файл» (название, примечание, замена): без права кнопки нет. */
  canEdit?: boolean;
  /**
   * Кнопка «глаз» — показ на странице контрагента (прототип v74 `pgFileBtn`): открытый — файл виден
   * контрагенту, перечёркнутый — скрыт; `label` — подсказка («Виден на странице контрагента. Скрыть»).
   * Нет — кнопки нет.
   */
  page?: { hidden: boolean; label: string };
  /**
   * Файл контрагента, прикреплённый к записи ссылкой (доработки 16.11.2026, блок 2; прототип v124
   * `filesBox`): значок «скрепка-ссылка», вместо «Удалить» — «Открепить» (`canUnlink`).
   */
  linked?: boolean;
  canUnlink?: boolean;
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
  /** Кнопка «Изменить файл»: подпись для диктора и подсказка. */
  edit: (name: string) => string;
  editTitle: string;
  /** Подсказка строки примечания («Примечание к файлу»). */
  noteTitle: string;
  /** «Из файлов контрагента» в заголовке и «Открепить» у файла-ссылки (блок 2); без них кнопок нет. */
  pick?: string;
  unlink?: string;
  unlinkTitle?: string;
  unlinkAria?: (name: string) => string;
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
  /** «Глаз»: скрыть со страницы контрагента или снова показать. */
  onPage?: (item: FilesBoxItem) => void;
  /** «Изменить файл» — окно открывает приложение. */
  onEdit?: (item: FilesBoxItem) => void;
  /** «Из файлов контрагента» (у записи контрагента, файлы которой можно менять) — окно у приложения. */
  canLink?: boolean;
  onLinkPick?: () => void;
  /** «Открепить» файл-ссылку: сразу, без подтверждения (прототип `fUnlink`). */
  onUnlink?: (item: FilesBoxItem) => void;
}

/**
 * Блок «Файлы» карточки записи (прототип modules/services.js `filesBox`, стили `.box`, `.list`, `.li`):
 * заголовок «Файлы · N» с кнопками «Из файлов контрагента» и «Прикрепить» (выбор нескольких файлов),
 * строки — значок, имя, «тип · размер», примечание (курсивом), «Скачать», «Изменить» и «Удалить»; у
 * файла контрагента, прикреплённого ссылкой, — значок ссылки и «Открепить»; пусто — «Файлов пока нет».
 */
export function FilesBox({
  items,
  canUpload,
  busy = false,
  labels,
  onPick,
  onDownload,
  onDelete,
  onPage,
  onEdit,
  canLink = false,
  onLinkPick,
  onUnlink,
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
        canUpload || (canLink && onLinkPick) ? (
          <>
            {canLink && onLinkPick && labels.pick ? (
              <button
                type="button"
                data-file-pick=""
                className={`${buttonClass('default', 'sm')} uppercase`}
                onClick={onLinkPick}
              >
                <Icon name="folder" size="sm" />
                {labels.pick}
              </button>
            ) : null}
            {canUpload ? (
              <>
                {/* В прототипе «Прикрепить» — подпись `label.btn` в заголовке блока: прописными, как он. */}
                <button
                  type="button"
                  className={`${buttonClass('default', 'sm')} uppercase`}
                  disabled={busy}
                  aria-busy={busy || undefined}
                  onClick={() => input.current?.click()}
                >
                  <Icon name="clip" size="sm" />
                  {busy ? labels.uploading : labels.attach}
                </button>
                <input ref={input} type="file" multiple hidden onChange={picked} data-files-input />
              </>
            ) : null}
          </>
        ) : null
      }
    >
      {items.length ? (
        <ul className="m-0 flex list-none flex-col p-0">
          {items.map((item) => (
            <li
              key={item.id}
              data-file-row={item.id}
              className="flex min-w-0 items-center gap-2.5 border-b border-line px-0.5 py-[9px] last:border-b-0 hover:bg-row-hover"
            >
              <Icon name={item.linked ? 'link' : 'file'} className="flex-none text-muted" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-semibold text-ink">{item.name}</div>
                <div className="truncate text-xs text-faint">{item.meta}</div>
                {item.note ? (
                  <div
                    data-file-note=""
                    title={labels.noteTitle}
                    className="text-xs font-normal text-muted italic [overflow-wrap:anywhere]"
                  >
                    {item.note}
                  </div>
                ) : null}
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
              {item.canEdit && onEdit ? (
                <button
                  type="button"
                  data-file-edit=""
                  className={`${iconButtonClass('sm')} ${TOUCH_AREA}`}
                  aria-label={labels.edit(item.name)}
                  title={labels.editTitle}
                  onClick={() => onEdit(item)}
                >
                  <Icon name="edit" size="sm" />
                </button>
              ) : null}
              {item.page && onPage ? (
                <button
                  type="button"
                  data-pgf={item.page.hidden ? 'off' : 'on'}
                  className={`${iconButtonClass('sm')} ${TOUCH_AREA}`}
                  aria-label={`${item.page.label}: ${item.name}`}
                  title={item.page.label}
                  onClick={() => onPage(item)}
                >
                  <Icon name={item.page.hidden ? 'eyeoff' : 'eye'} size="sm" />
                </button>
              ) : null}
              {item.linked && item.canUnlink && onUnlink && labels.unlink ? (
                <button
                  type="button"
                  data-file-unlink=""
                  className={`${buttonClass('ghost', 'sm')} ${TOUCH_AREA}`}
                  aria-label={labels.unlinkAria?.(item.name) ?? labels.unlink}
                  title={labels.unlinkTitle}
                  onClick={() => onUnlink(item)}
                >
                  <Icon name="x" size="sm" />
                  {labels.unlink}
                </button>
              ) : null}
              {item.canDelete && !item.linked ? (
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
