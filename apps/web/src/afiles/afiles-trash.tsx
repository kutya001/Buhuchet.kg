'use client';

import { FILE_TRASH_ERASE_HOURS, formatMomentRu, type FileTrashWhy } from '@buhuchet/domain';
import type { AdminTrashRow } from '@buhuchet/shared';
import {
  buttonClass,
  EmptyState,
  Hint,
  Icon,
  MiniTable,
  Modal,
  Note,
  miniWide,
  type MiniRow,
} from '@buhuchet/ui';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { closeSlot, openSlot, type DialogSlot } from '../dialog-slot';
import { fileSizeText } from '../files/files-data';
import { useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';
import { useBackDialog } from './afiles-actions';
import { trashQuery } from './afiles-data';

type TrashRow = AdminTrashRow;

/** Почему «Вернуть» недоступно (прототип `FT_BACK_WHY`): прежняя версия, непринятый, срок прошёл. */
export function trashBackReason(t: Translate, x: Pick<TrashRow, 'why' | 'restorable'>): string {
  if (x.restorable) return '';
  const code: Partial<Record<FileTrashWhy, string>> = {
    rep: 'err.file_back_rep',
    auto: 'err.file_back_auto',
  };
  return t((code[x.why] ?? 'err.file_back_gone') as 'err.file_back_gone');
}

const srcOf = (t: Translate, src: string | null) =>
  src ? t(`afiles.src.${src}` as 'afiles.src.card') : '';

/**
 * «Ждут удаления» (пакет 2, блок 5, пункт 4; прототип `afTrashDlg`): удалённые файлы с датой стирания
 * по порядку стирания; «Вернуть» — в течение суток после удаления, у прежней версии после замены и
 * непринятого файла от контрагента — недоступно с причиной.
 */
export function useTrashDialog() {
  const [slot, setSlot] = useState<DialogSlot<{ org?: string }> | null>(null);
  const open = useCallback((org?: string) => setSlot(openSlot(org ? { org } : {})), []);
  const node = slot ? (
    <TrashDialog
      key={`afiles-trash-${slot.n}`}
      open={slot.open}
      org={slot.data.org}
      onClose={() => setSlot(closeSlot)}
    />
  ) : null;
  return { open, node };
}

function TrashDialog({
  open,
  org,
  onClose,
}: {
  open: boolean;
  org: string | undefined;
  onClose: () => void;
}) {
  const t = useT();
  const back = useBackDialog();
  const query = useQuery(trashQuery(org));
  const rows = [...(query.data?.items ?? [])].sort(
    (a, b) => a.eraseAt.localeCompare(b.eraseAt) || a.name.localeCompare(b.name),
  );
  const ask = (x: TrashRow) =>
    back.ask({
      id: x.id,
      name: x.name,
      why: x.why,
      srcText: srcOf(t, x.src) || null,
      orgName: x.orgName,
    });
  const miniRows: MiniRow[] = rows.map((x) => {
    const reason = trashBackReason(t, x);
    return {
      key: x.id,
      cells: {
        name: (
          <span className="inline-flex min-w-0 items-center gap-1.5">
            <Icon name="file" size="sm" className="flex-none text-muted" />
            <span className="font-semibold">{x.name}</span>
          </span>
        ),
        org: x.why === 'extra' ? t('afiles.trash.extra_org') : (x.orgName ?? '—'),
        cp: x.cpName ?? '—',
        src: srcOf(t, x.src) || '—',
        why: t(`afiles.trash.why.${x.why}`),
        by: x.byText,
        at: formatMomentRu(new Date(x.deletedAt)),
        erase: formatMomentRu(new Date(x.eraseAt)),
        size: fileSizeText(t, x.sizeBytes),
        act: (
          <button
            type="button"
            data-afiles-trash-back={x.id}
            className={buttonClass('default', 'sm')}
            disabled={!x.restorable}
            title={reason || t('afiles.act.back')}
            onClick={(e) => {
              e.stopPropagation();
              ask(x);
            }}
          >
            <Icon name="refresh" size="sm" />
            {t('afiles.act.back')}
          </button>
        ),
      },
      wide: miniWide({ name: x.name }),
      blank: [...(x.cpName ? [] : ['cp']), ...(x.src ? [] : ['src'])],
    };
  });
  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        kind="card"
        size="wide"
        title={t('afiles.trash.title')}
        sub={t('afiles.trash.sub', { h: FILE_TRASH_ERASE_HOURS })}
        footer={
          <>
            <Hint>{t('afiles.trash.hint')}</Hint>
            <div className="flex-1" />
            <button type="button" className={buttonClass('cta')} onClick={onClose}>
              {t('afiles.trash.done')}
            </button>
          </>
        }
      >
        <div data-afiles-trash="" className="flex flex-col gap-3">
          {query.isError ? <Note tone="bad">{t('afiles.load_error')}</Note> : null}
          {query.data && !rows.length ? (
            <EmptyState
              icon="trash"
              title={t('afiles.trash.empty.title')}
              text={t('afiles.trash.empty.text')}
            />
          ) : (
            <MiniTable
              label={t('afiles.trash.title')}
              columns={[
                { key: 'name', label: t('afiles.trash.col.name'), width: 240 },
                { key: 'org', label: t('afiles.trash.col.org'), width: 180 },
                { key: 'cp', label: t('afiles.trash.col.cp'), width: 170 },
                { key: 'src', label: t('afiles.trash.col.src'), width: 160 },
                { key: 'why', label: t('afiles.trash.col.why'), width: 200 },
                { key: 'by', label: t('afiles.trash.col.by'), width: 150 },
                { key: 'at', label: t('afiles.trash.col.at'), width: 140 },
                { key: 'erase', label: t('afiles.trash.col.erase'), width: 140 },
                { key: 'size', label: t('afiles.trash.col.size'), numeric: true, width: 100 },
                { key: 'act', label: '', actions: true, width: 120 },
              ]}
              rows={miniRows}
              empty={t('afiles.trash.empty.title')}
              onOpen={(key) => {
                const x = rows.find((r) => r.id === key);
                if (x?.restorable) ask(x);
              }}
            />
          )}
          {query.data && query.data.total > rows.length ? (
            <Hint>{t('afiles.check.more', { shown: rows.length, total: query.data.total })}</Hint>
          ) : null}
        </div>
      </Modal>
      {back.node}
    </>
  );
}
