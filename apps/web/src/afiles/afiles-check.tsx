'use client';

import { formatCount, formatMomentRu, type StorageCheckList } from '@buhuchet/domain';
import type { AdminStorageCheckRow } from '@buhuchet/shared';
import {
  Box,
  buttonClass,
  ConfirmDialog,
  Hint,
  Icon,
  linkButtonClass,
  MiniTable,
  MONO_CLASS,
  Note,
  Plate,
  Plates,
  useToast,
  type MiniColumn,
  type MiniRow,
  type PlateColor,
} from '@buhuchet/ui';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useRef, useState, type ReactNode } from 'react';
import { callApi } from '../api-client';
import { closeSlot, openSlot, type DialogSlot } from '../dialog-slot';
import { fileSizeText } from '../files/files-data';
import { useErrorText, useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';
import { presetHref } from '../lists/preset';
import { deleteExtra, storageCheckQuery, useStorageRefresh } from './afiles-data';
import { ageText } from './afiles-model';

type CheckRow = AdminStorageCheckRow;

const PLATES: readonly {
  id: StorageCheckList;
  icon: 'alert' | 'db' | 'hourglass' | 'ban';
  bad: PlateColor;
  sub?: 'afiles.check.plate.extra_sub' | 'afiles.check.plate.stuck_sub';
}[] = [
  { id: 'missing', icon: 'alert', bad: 'red' },
  { id: 'extra', icon: 'db', bad: 'yellow', sub: 'afiles.check.plate.extra_sub' },
  { id: 'stuck', icon: 'hourglass', bad: 'yellow', sub: 'afiles.check.plate.stuck_sub' },
  { id: 'failed', icon: 'ban', bad: 'red' },
];

const moment = (iso: string | null) => (iso ? formatMomentRu(new Date(iso)) : '—');
const size = (t: Translate, n: number | null) => (n === null ? '—' : fileSizeText(t, n));
const errText = (t: Translate, code: string | null) =>
  code ? t(`afiles.err.${code}` as 'afiles.err.storage') : '—';

/**
 * Админка → «Файлы» → «Проверка хранилища» (пакет 2, блок 3, пункт 6; прототип `renderAFCheck`): что
 * нашла сверка базы с хранилищем раз в сутки — четыре списка расхождений. Сама сверка ничего не
 * удаляет; «Удалить» — только лишний файл старше суток, по одному, после вопроса с путём, размером и
 * датой; файл сутки ждёт стирания в «Ждут удаления».
 */
export function AdminFilesCheck() {
  const t = useT();
  const router = useRouter();
  const toast = useToast();
  const errorText = useErrorText();
  const refresh = useStorageRefresh();
  const query = useQuery(storageCheckQuery);
  const c = query.data;
  const boxes = useRef<Partial<Record<StorageCheckList, HTMLDivElement | null>>>({});
  const [ask, setAsk] = useState<DialogSlot<CheckRow> | null>(null);

  const remove = async (x: CheckRow) => {
    const res = await callApi(() => deleteExtra(x.id));
    if (res.ok) toast(t('afiles.extra.done'), { icon: 'trash' });
    else toast(errorText(res.error), { bad: true, icon: 'alert' });
    void refresh();
  };
  const tryDelete = (x: CheckRow) => {
    if (!x.deletable) return toast(t('err.storage_extra_young'), { bad: true, icon: 'alert' });
    setAsk(openSlot(x));
  };

  const box = (
    id: StorageCheckList,
    columns: MiniColumn[],
    rows: MiniRow[],
    open?: (k: string) => void,
  ) => {
    const list = c?.[id];
    return (
      <div
        key={id}
        data-afiles-check={id}
        ref={(el) => {
          boxes.current[id] = el;
        }}
        className="scroll-mt-3"
      >
        <Box title={t(`afiles.check.${id}.title`, { n: formatCount(list?.total ?? 0) })}>
          <MiniTable
            label={t(`afiles.check.${id}.title`, { n: formatCount(list?.total ?? 0) })}
            columns={columns}
            rows={rows}
            empty={t('afiles.check.empty')}
            {...(open ? { onOpen: open } : {})}
          />
          {list && list.total > list.items.length ? (
            <Hint>{t('afiles.check.more', { shown: list.items.length, total: list.total })}</Hint>
          ) : null}
          <Hint>{t(`afiles.check.${id}.hint`)}</Hint>
        </Box>
      </div>
    );
  };

  const nameCell = (x: CheckRow): ReactNode => (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <Icon name="file" size="sm" className="flex-none text-muted" />
      <span className="font-semibold [overflow-wrap:anywhere]">{x.name ?? x.path ?? '—'}</span>
    </span>
  );
  const org = (x: CheckRow) => x.orgName ?? '—';
  // Пустые ячейки на телефоне не показываются (прототип `m-empty`).
  const blank = (keys: Record<string, unknown>) =>
    Object.entries(keys)
      .filter(([, v]) => v === null || v === undefined || v === '')
      .map(([k]) => k);

  const missing = (c?.missing.items ?? []).map((x) => ({
    key: String(x.id),
    cells: {
      name: nameCell(x),
      org: org(x),
      cp: x.cpName ?? '—',
      src: x.src ? t(`afiles.src.${x.src}` as 'afiles.src.card') : '—',
      size: size(t, x.sizeBytes),
      at: moment(x.at),
    },
    blank: blank({ cp: x.cpName, src: x.src }),
  }));
  const extra = (c?.extra.items ?? []).map((x) => ({
    key: String(x.id),
    cells: {
      path: <span className={`${MONO_CLASS} [overflow-wrap:anywhere]`}>{x.path ?? '—'}</span>,
      size: size(t, x.sizeBytes),
      at: moment(x.at),
      age: x.ageHours === null ? '—' : ageText(t, x.ageHours),
      act: (
        <button
          type="button"
          data-afiles-extra-delete={x.id}
          className={buttonClass('danger', 'sm')}
          disabled={!x.deletable}
          title={x.deletable ? t('afiles.check.delete') : t('err.storage_extra_young')}
          onClick={(e) => {
            e.stopPropagation();
            tryDelete(x);
          }}
        >
          <Icon name="trash" size="sm" />
          {t('afiles.check.delete')}
        </button>
      ),
    },
    wide: ['path'],
  }));
  const stuck = (c?.stuck.items ?? []).map((x) => ({
    key: String(x.id),
    cells: {
      name: nameCell(x),
      org: org(x),
      by: x.byText ?? '—',
      size: size(t, x.sizeBytes),
      at: moment(x.at),
    },
    blank: blank({ by: x.byText }),
  }));
  const failed = (c?.failed.items ?? []).map((x) => ({
    key: String(x.id),
    cells: {
      name: nameCell(x),
      org: org(x),
      size: size(t, x.sizeBytes),
      tries: x.attempts === null ? '—' : formatCount(x.attempts),
      err: errText(t, x.lastError),
      at: moment(x.at),
    },
  }));

  return (
    <div data-afiles-check-tab="" className="flex flex-col gap-3.5">
      {query.isError ? <Note tone="bad">{t('afiles.load_error')}</Note> : null}
      <Note>
        {t('afiles.check.note')}{' '}
        <button
          type="button"
          data-afiles-runs=""
          className={linkButtonClass()}
          onClick={() => router.push(presetHref('runs', 'jobs'))}
        >
          {t('afiles.check.runs')}
        </button>
        {'. '}
        {c
          ? c.checkedAt
            ? t('afiles.check.last', { at: moment(c.checkedAt) })
            : t('afiles.check.never')
          : ''}{' '}
        {t('afiles.check.note_end')}
      </Note>
      <Plates static>
        {PLATES.map((p) => {
          const n = c?.[p.id].total;
          return (
            <Plate
              key={p.id}
              id={p.id}
              icon={p.icon}
              color={n ? p.bad : 'green'}
              label={t(`afiles.check.plate.${p.id}`)}
              value={n === undefined ? '' : formatCount(n)}
              {...(p.sub ? { sub: t(p.sub) } : {})}
              onClick={() =>
                boxes.current[p.id]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
              }
            />
          );
        })}
      </Plates>
      {box(
        'missing',
        [
          { key: 'name', label: t('afiles.check.col.name'), width: 260 },
          { key: 'org', label: t('afiles.check.col.org'), width: 200 },
          { key: 'cp', label: t('afiles.check.col.cp'), width: 180 },
          { key: 'src', label: t('afiles.check.col.src'), width: 170 },
          { key: 'size', label: t('afiles.check.col.size'), numeric: true, width: 100 },
          { key: 'at', label: t('afiles.check.col.uploaded'), width: 150 },
        ],
        missing,
      )}
      {box(
        'extra',
        [
          { key: 'path', label: t('afiles.check.col.path'), width: 340 },
          { key: 'size', label: t('afiles.check.col.size'), numeric: true, width: 100 },
          { key: 'at', label: t('afiles.check.col.seen'), width: 150 },
          { key: 'age', label: t('afiles.check.col.age'), width: 130 },
          { key: 'act', label: '', actions: true, width: 120 },
        ],
        extra,
        (key) => {
          const x = c?.extra.items.find((r) => String(r.id) === key);
          if (x) tryDelete(x);
        },
      )}
      {box(
        'stuck',
        [
          { key: 'name', label: t('afiles.check.col.name'), width: 260 },
          { key: 'org', label: t('afiles.check.col.org'), width: 200 },
          { key: 'by', label: t('afiles.check.col.by'), width: 170 },
          { key: 'size', label: t('afiles.check.col.size'), numeric: true, width: 100 },
          { key: 'at', label: t('afiles.check.col.started'), width: 150 },
        ],
        stuck,
      )}
      {box(
        'failed',
        [
          { key: 'name', label: t('afiles.check.col.name'), width: 260 },
          { key: 'org', label: t('afiles.check.col.org'), width: 200 },
          { key: 'size', label: t('afiles.check.col.size'), numeric: true, width: 100 },
          { key: 'tries', label: t('afiles.check.col.tries'), numeric: true, width: 100 },
          { key: 'err', label: t('afiles.check.col.err'), width: 240 },
          { key: 'at', label: t('afiles.check.col.last'), width: 160 },
        ],
        failed,
      )}
      {ask ? (
        <ConfirmDialog
          key={`afiles-extra-${ask.n}`}
          open={ask.open}
          onClose={() => setAsk(closeSlot)}
          title={t('afiles.extra.title')}
          danger
          ok={t('afiles.extra.ok')}
          text={
            <span data-afiles-extra-ask="" className="flex flex-col gap-1.5">
              <span className="block">
                <span className="text-faint">{t('afiles.extra.path')}: </span>
                <span className={`${MONO_CLASS} text-ink [overflow-wrap:anywhere]`}>
                  {ask.data.path}
                </span>
              </span>
              <span className="block">
                <span className="text-faint">{t('afiles.extra.size')}: </span>
                <span className="text-ink">{size(t, ask.data.sizeBytes)}</span>
              </span>
              <span className="block">
                <span className="text-faint">{t('afiles.extra.seen')}: </span>
                <span className="text-ink">{moment(ask.data.at)}</span>
              </span>
              <span className="mt-1.5 block">{t('afiles.extra.text')}</span>
            </span>
          }
          onConfirm={() => void remove(ask.data)}
        />
      ) : null}
    </div>
  );
}
