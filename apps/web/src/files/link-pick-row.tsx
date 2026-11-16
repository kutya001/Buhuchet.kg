'use client';

import type { FileSource } from '@buhuchet/shared';
import { buttonClass, Icon, iconButtonClass, useToast } from '@buhuchet/ui';
import { useState } from 'react';
import type { ApiErrorLike, Translate } from '../l10n/translate';
import { useT } from '../l10n/provider';
import { linkFiles } from './file-links-data';
import { FilePickDialog } from './file-pick-dialog';

/** Файл контрагента, выбранный в форме: прикрепится ссылкой после сохранения записи. */
export interface PickedLink {
  id: string;
  name: string;
}

/**
 * Строка поля «Файлы» формы новой записи контрагента (доработки 16.11.2026, блок 2, пункт 9; прототип
 * v124 `fPickRow`, `fPickBind`): выбранные файлы контрагента ярлыками с «Не прикреплять» и кнопка «Из
 * файлов контрагента». Контрагент ещё не выбран — «Сначала выберите контрагента».
 */
export function LinkPickRow({
  contractorId,
  picked,
  onChange,
  record = null,
}: {
  contractorId: string | null;
  picked: readonly PickedLink[];
  onChange: (next: PickedLink[]) => void;
  /** Изменяемая запись: окно не предлагает уже прикреплённые к ней файлы. */
  record?: { kind: FileSource['kind']; id: string } | null;
}) {
  const t = useT();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  return (
    <div data-link-pick-row="" className="mb-1.5 flex flex-wrap items-center gap-1.5">
      {picked.map((f) => (
        <span
          key={f.id}
          data-link-picked={f.name}
          className="inline-flex max-w-full items-center gap-1 rounded-md border border-line bg-pane-alt py-0.5 pr-0.5 pl-2 text-xs text-ink"
        >
          <Icon name="link" size="sm" className="flex-none text-muted" />
          <span className="truncate">{f.name}</span>
          <button
            type="button"
            className={iconButtonClass('sm')}
            title={t('files.pick.row_x')}
            aria-label={t('files.pick.row_x_aria', { name: f.name })}
            onClick={() => onChange(picked.filter((x) => x.id !== f.id))}
          >
            <Icon name="x" size="sm" />
          </button>
        </span>
      ))}
      <button
        type="button"
        data-link-pick=""
        className={buttonClass('default', 'sm')}
        onClick={() => {
          if (!contractorId) return toast(t('files.pick.choose_cp'), { bad: true, icon: 'alert' });
          setOpen(true);
        }}
      >
        <Icon name="folder" size="sm" />
        {t('files.link.pick')}
      </button>
      <FilePickDialog
        target={open && contractorId ? (record ?? { kind: 'contractor', id: contractorId }) : null}
        skip={picked.map((x) => x.id)}
        onClose={() => setOpen(false)}
        onPick={(more) =>
          onChange([...picked, ...more.filter((x) => !picked.some((p) => p.id === x.id))])
        }
      />
    </div>
  );
}

/**
 * После сохранения записи — выбранные файлы контрагента ссылкой к ней, с записью в её историю
 * (прототип `fPickSave`). Не вышло — текст для уведомления: запись уже сохранена.
 */
export async function linkPicked(
  t: Translate,
  errorText: (error: ApiErrorLike) => string,
  source: { kind: FileSource['kind']; id: string },
  picked: readonly PickedLink[],
): Promise<string | null> {
  if (!picked.length) return null;
  const res = await linkFiles(
    source,
    picked.map((x) => x.id),
  );
  return res.ok ? null : t('files.pick.link_failed', { error: errorText(res.error) });
}
