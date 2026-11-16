'use client';

import { bishkekDate, fileExtension, formatDateRu } from '@buhuchet/domain';
import type { FileLinkable } from '@buhuchet/shared';
import {
  buttonClass,
  CHECKBOX_CLASS,
  EmptyState,
  Icon,
  inputClass,
  Modal,
  Note,
} from '@buhuchet/ui';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { Translate } from '../l10n/translate';
import { useT } from '../l10n/provider';
import { fileAlsoText } from './file-links';
import { linkableQuery, type FileLinkTargetRef } from './file-links-data';
import { fileSizeText } from './files-data';

type PickItem = FileLinkable['items'][number];

/** Откуда файл контрагента (прототип `x.base`): загружен вручную, от контрагента, из документов. */
function baseOf(t: Translate, item: PickItem): string {
  if (item.kind === 'sent_file') return t('files.src.sent');
  if (item.kind === 'contractor') return t('files.src.regdocs');
  return t('files.kind.manual');
}

/** Строка поиска (прототип: название, примечание и откуда). */
function matches(t: Translate, item: PickItem, q: string): boolean {
  return `${item.name} ${item.note ?? ''} ${baseOf(t, item)}`.toLowerCase().includes(q);
}

function PickForm({
  target,
  skip,
  onClose,
  onPick,
}: {
  target: FileLinkTargetRef;
  skip: readonly string[];
  onClose: () => void;
  onPick: (files: { id: string; name: string }[]) => void;
}) {
  const t = useT();
  const query = useQuery(linkableQuery(target));
  const [q, setQ] = useState('');
  const [chosen, setChosen] = useState<readonly string[]>([]);
  const data = query.data;
  const all = (data?.items ?? []).filter((x) => !skip.includes(x.id));
  const needle = q.trim().toLowerCase();
  const shown = needle ? all.filter((x) => matches(t, x, needle)) : all;
  const toggle = (id: string, on: boolean) =>
    setChosen((was) => (on ? [...was, id] : was.filter((x) => x !== id)));
  const ok = () => {
    const picked = all.filter((x) => chosen.includes(x.id));
    if (!picked.length) return;
    onClose();
    onPick(picked.map((x) => ({ id: x.id, name: x.name })));
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={t('files.pick.title')}
      sub={data?.contractor.name}
      kind="form"
      size="mid"
      dirty={chosen.length > 0}
      footer={
        <>
          <button type="button" className={buttonClass('ghost')} onClick={onClose}>
            {t('files.pick.cancel')}
          </button>
          <button
            type="button"
            data-file-pick-ok=""
            className={buttonClass('cta')}
            disabled={!chosen.length}
            onClick={ok}
          >
            <Icon name="link" size="sm" />
            {chosen.length ? t('files.pick.ok_n', { n: chosen.length }) : t('files.pick.ok')}
          </button>
        </>
      }
    >
      <div data-file-pick-dialog="" className="flex flex-col gap-2">
        {query.isError ? <Note tone="bad">{t('files.pick.load_error')}</Note> : null}
        {data && !all.length ? (
          <EmptyState
            icon="folder"
            title={t(
              data.allLinked || data.items.length ? 'files.pick.all_linked' : 'files.pick.empty',
            )}
            text={t('files.pick.empty_text')}
          />
        ) : null}
        {data && all.length ? (
          <>
            <input
              className={inputClass()}
              value={q}
              autoComplete="off"
              placeholder={t('files.pick.search')}
              aria-label={t('files.pick.search_aria')}
              onChange={(e) => setQ(e.target.value)}
            />
            <ul className="m-0 flex max-h-[50vh] list-none flex-col overflow-auto p-0">
              {shown.length ? (
                shown.map((x) => {
                  const also = fileAlsoText(t, x.links);
                  const row = t('files.pick.row', {
                    base: baseOf(t, x),
                    date: formatDateRu(bishkekDate(new Date(x.uploadedAt))),
                    ext: fileExtension(x.name)?.toUpperCase() ?? t('files.no_ext'),
                    size: fileSizeText(t, x.size),
                  });
                  return (
                    <li key={x.id} className="border-b border-line last:border-b-0">
                      <label
                        data-file-pick-row={x.name}
                        className="flex min-w-0 cursor-pointer items-center gap-2.5 px-0.5 py-[9px] hover:bg-row-hover"
                      >
                        <input
                          type="checkbox"
                          className={CHECKBOX_CLASS}
                          checked={chosen.includes(x.id)}
                          onChange={(e) => toggle(x.id, e.target.checked)}
                        />
                        <Icon name="file" className="flex-none text-muted" />
                        <div className="min-w-0 flex-1">
                          <div className="text-[13px] font-semibold [overflow-wrap:anywhere] text-ink">
                            {x.name}
                          </div>
                          <div className="text-xs text-faint">
                            {also ? `${row} · ${also}` : row}
                          </div>
                          {x.note ? (
                            <div
                              title={t('files.note_title')}
                              className="text-xs text-muted italic [overflow-wrap:anywhere]"
                            >
                              {x.note}
                            </div>
                          ) : null}
                        </div>
                      </label>
                    </li>
                  );
                })
              ) : (
                <li className="py-2 text-[13px] text-faint">{t('files.pick.none')}</li>
              )}
            </ul>
            <span className="text-xs text-muted">{t('files.pick.hint')}</span>
          </>
        ) : null}
      </div>
    </Modal>
  );
}

/**
 * Окно «Из файлов контрагента» (доработки 16.11.2026, блок 2, пункт 9; прототип v124 `fPickDlg`):
 * файлы контрагента — принятые от него, документы карточки и загруженные вручную с ним — с откуда,
 * когда, типом, размером, «также у …» и примечанием; поиск по названию и примечанию, выбор нескольких.
 * `skip` — уже выбранные в форме. Прикрепляет вызывающий: блок «Файлы» записи — сразу, форма новой
 * записи — после её сохранения.
 */
export function FilePickDialog({
  target,
  skip = [],
  onClose,
  onPick,
}: {
  /** Запись или контрагент формы; null — окно закрыто. */
  target: FileLinkTargetRef | null;
  skip?: readonly string[];
  onClose: () => void;
  onPick: (files: { id: string; name: string }[]) => void;
}) {
  // Окно создаётся заново при каждом открытии: выбор и поиск прошлого раза не остаются.
  return target ? <PickForm target={target} skip={skip} onClose={onClose} onPick={onPick} /> : null;
}
