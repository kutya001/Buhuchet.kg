'use client';

import { bishkekDate, formatDateRu, formatMomentRu } from '@buhuchet/domain';
import type { AdminStorageFile } from '@buhuchet/shared';
import {
  Box,
  buttonClass,
  ConfirmDialog,
  Hint,
  Icon,
  KeyValues,
  MONO_CLASS,
  Note,
  linkButtonClass,
  useToast,
  type ActionEntry,
  type KeyValueItem,
} from '@buhuchet/ui';
import { useCallback, useState, type ReactNode } from 'react';
import { callApi } from '../api-client';
import { closeSlot, openSlot, type DialogSlot } from '../dialog-slot';
import { FileViewer, windowFiles } from '../files/file-viewer';
import { fileSizeText } from '../files/files-data';
import { fileTypeText } from '../files/file-columns';
import { useErrorText, useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';
import {
  restoreTrash,
  storageFileDownloadHref,
  storageFileViewSrc,
  useStorageRefresh,
} from './afiles-data';
import { backText, viewerIdOf } from './afiles-model';
import { StoragePill } from './afiles-columns';

/** Что нужно окну «Вернуть …?»: строка «Ждут удаления» или удалённый файл «Всех файлов». */
export interface BackTarget {
  /** Номер строки «Ждут удаления». */
  id: string;
  name: string;
  why: string | null;
  srcText: string | null;
  orgName: string | null;
}

/** Файл в окне просмотра: номер — вид и номер строки (у каждого вида свои номера). */
interface ViewerRow {
  id: string;
  name: string;
  size: number;
  contentType?: string;
  row: AdminStorageFile;
}

const viewerRow = (r: AdminStorageFile): ViewerRow => ({
  id: viewerIdOf(r),
  name: r.name,
  size: r.sizeBytes,
  ...(r.contentType ? { contentType: r.contentType } : {}),
  row: r,
});

export const backTargetOf = (r: AdminStorageFile): BackTarget => ({
  id: r.id,
  name: r.name,
  why: r.why,
  srcText: r.srcText || null,
  orgName: r.orgText,
});

/**
 * «Вернуть» удалённый файл (пакет 2, блок 5, пункт 4; прототип `afBackDlg`): вопрос с тем, куда файл
 * вернётся и чью память займёт; после — уведомление и всё перечитывается. Отказ сервера (запись файла
 * удалена, срок прошёл, вернули другим окном) — уведомлением с его причиной.
 */
export function useBackDialog() {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const refresh = useStorageRefresh();
  const [slot, setSlot] = useState<DialogSlot<{
    x: BackTarget;
    done: (() => void) | undefined;
  }> | null>(null);
  const ask = useCallback((x: BackTarget, done?: () => void) => setSlot(openSlot({ x, done })), []);
  const run = async (x: BackTarget, done?: () => void) => {
    const res = await callApi(() => restoreTrash(x.id));
    if (!res.ok) {
      toast(errorText(res.error), { bad: true, icon: 'alert' });
      void refresh();
      return;
    }
    done?.();
    toast(t('afiles.back.done'), { icon: 'refresh' });
    void refresh();
  };
  const node = slot ? (
    <ConfirmDialog
      key={`afiles-back-${slot.n}`}
      open={slot.open}
      onClose={() => setSlot(closeSlot)}
      title={t('afiles.back.title', { name: slot.data.x.name })}
      text={backText(t, slot.data.x)}
      ok={t('afiles.back.ok')}
      onConfirm={() => void run(slot.data.x, slot.data.done)}
    />
  ) : null;
  return { ask, node };
}

/**
 * Действия с файлом «Всех файлов» и вкладки «Файлы» карточки организации (прототип `afGrid`, `afOpen`,
 * `afDl`): «Открыть» — окно просмотра со сведениями, «Скачать» (непринятый файл от контрагента — после
 * предупреждения), «Открыть организацию» (не в её карточке), «Открыть подписку» у чека подписки,
 * «Вернуть» удалённого. Администратор файлы организаций только смотрит и скачивает (решение заказчика
 * 20.11.2026).
 */
export function useStorageFileActions({
  inCard = false,
  onOrg,
  onSub,
}: {
  /** В карточке организации: «Открыть организацию» нет, ссылка на организацию закрывает окно. */
  inCard?: boolean;
  onOrg?: (orgId: string) => void;
  /** «Открыть подписку» у чека подписки (прототип `subOrgWin`): вкладка «Подписка» карточки организации. */
  onSub?: (orgId: string) => void;
}) {
  const t = useT();
  const back = useBackDialog();
  const [viewer, setViewer] = useState<DialogSlot<{
    files: readonly ViewerRow[];
    index: number;
  }> | null>(null);
  const [warn, setWarn] = useState<DialogSlot<{ go: () => void }> | null>(null);

  const askDownload = useCallback((go: () => void) => setWarn(openSlot({ go })), []);
  const download = useCallback(
    (r: AdminStorageFile) => {
      const go = () => globalThis.location.assign(storageFileDownloadHref(r));
      if (r.cat === 'sent') askDownload(go);
      else go();
    },
    [askDownload],
  );
  const open = useCallback((r: AdminStorageFile, rows: readonly AdminStorageFile[]) => {
    const w = windowFiles(rows.map(viewerRow), viewerRow(r));
    setViewer(openSlot(w));
  }, []);
  const closeViewer = useCallback(() => setViewer(closeSlot), []);
  const toOrg = !inCard && onOrg ? onOrg : null;
  const subOf = (r: AdminStorageFile): string | null =>
    r.cat === 'rcpt' && r.orgId && onSub ? r.orgId : null;

  const actions = (r: AdminStorageFile, rows: readonly AdminStorageFile[]): ActionEntry[] => [
    { id: 'open', label: t('afiles.act.open'), icon: 'eye', run: () => open(r, rows) },
    { id: 'download', label: t('afiles.act.download'), icon: 'download', run: () => download(r) },
    ...(r.orgId && toOrg
      ? [
          {
            id: 'org',
            label: t('afiles.act.org'),
            icon: 'building' as const,
            run: () => toOrg(r.orgId!),
          },
        ]
      : []),
    ...(subOf(r)
      ? [
          {
            id: 'sub',
            label: t('afiles.act.sub'),
            icon: 'coins' as const,
            run: () => onSub!(subOf(r)!),
          },
        ]
      : []),
    ...(r.restorable
      ? [
          { id: 'sep', separator: true as const },
          {
            id: 'back',
            label: t('afiles.act.back'),
            icon: 'refresh' as const,
            run: () => back.ask(backTargetOf(r)),
          },
        ]
      : []),
  ];

  const node = (
    <>
      {viewer ? (
        <FileViewer<ViewerRow>
          key={`afiles-view-${viewer.n}`}
          files={viewer.data.files}
          index={viewer.data.index}
          open={viewer.open}
          onClose={closeViewer}
          src={(id) => {
            const f = viewer.data.files.find((x) => x.id === id);
            return f ? storageFileViewSrc(f.row) : Promise.reject(new Error('file'));
          }}
          download={(id) => {
            const f = viewer.data.files.find((x) => x.id === id);
            return f ? storageFileDownloadHref(f.row) : '#';
          }}
          beforeDownload={(f, go) => {
            if (f.row.cat !== 'sent') return false;
            askDownload(go);
            return true;
          }}
          sub={(f) => [f.row.orgText, f.row.srcText].filter(Boolean).join(' · ')}
          info={(f) => (
            <StorageFileInfo
              t={t}
              r={f.row}
              onOrg={
                f.row.orgId
                  ? inCard
                    ? closeViewer
                    : toOrg
                      ? () => {
                          closeViewer();
                          toOrg(f.row.orgId!);
                        }
                      : null
                  : null
              }
            />
          )}
          footer={(f) => (
            <>
              {f.row.orgId && toOrg ? (
                <button
                  type="button"
                  data-afiles-org=""
                  className={buttonClass('default')}
                  onClick={() => {
                    closeViewer();
                    toOrg(f.row.orgId!);
                  }}
                >
                  <Icon name="building" size="sm" />
                  {t('afiles.act.org')}
                </button>
              ) : null}
              {subOf(f.row) ? (
                <button
                  type="button"
                  data-afiles-sub=""
                  className={buttonClass('default')}
                  onClick={() => {
                    // В карточке — переход на её вкладку «Подписка»; во «Всех файлах» окно подписки
                    // встаёт поверх окна файла, как `subOrgWin` прототипа.
                    if (inCard) closeViewer();
                    onSub!(subOf(f.row)!);
                  }}
                >
                  <Icon name="coins" size="sm" />
                  {t('afiles.act.sub')}
                </button>
              ) : null}
              {f.row.restorable ? (
                <button
                  type="button"
                  data-afiles-back=""
                  className={buttonClass('default')}
                  onClick={() => back.ask(backTargetOf(f.row), closeViewer)}
                >
                  <Icon name="refresh" size="sm" />
                  {t('afiles.act.back')}
                </button>
              ) : null}
              <div className="flex-1" />
              <button type="button" className={buttonClass('cta')} onClick={closeViewer}>
                {t('files.view.close')}
              </button>
            </>
          )}
        />
      ) : null}
      {warn ? (
        <ConfirmDialog
          key={`afiles-dl-${warn.n}`}
          open={warn.open}
          onClose={() => setWarn(closeSlot)}
          title={t('afiles.dl.title')}
          text={t('afiles.dl.text')}
          ok={t('afiles.act.download')}
          onConfirm={warn.data.go}
        />
      ) : null}
      {back.node}
    </>
  );
  return { actions, open, download, node };
}

/** Сведения о файле под просмотром (прототип `afOpen` → `info`). */
function StorageFileInfo({
  t,
  r,
  onOrg,
}: {
  t: Translate;
  r: AdminStorageFile;
  onOrg: (() => void) | null;
}) {
  const dash = <span className="text-faint">—</span>;
  const items: KeyValueItem[] = [
    {
      id: 'org',
      label: t('afiles.info.org'),
      value:
        r.orgText && onOrg ? (
          <button
            type="button"
            data-afiles-info-org=""
            className={linkButtonClass()}
            onClick={onOrg}
          >
            {r.orgText}
          </button>
        ) : (
          (r.orgText ?? dash)
        ),
    },
    {
      id: 'cp',
      label: t('afiles.info.cp'),
      value: r.cpName ? (
        <>
          {r.cpName}
          {r.cpInn ? (
            <>
              {' · '}
              <span className={MONO_CLASS}>{r.cpInn}</span>
            </>
          ) : null}
        </>
      ) : (
        dash
      ),
    },
    { id: 'src', label: t('afiles.info.src'), value: r.srcText || dash },
    {
      id: 'by',
      label: t('afiles.info.by'),
      value: (
        <>
          {r.byText}
          <span className="block text-xs text-faint">
            {formatDateRu(bishkekDate(new Date(r.at)))}
          </span>
        </>
      ),
    },
    {
      id: 'size',
      label: t('afiles.info.size'),
      value: `${fileSizeText(t, r.sizeBytes)} · ${fileTypeText(t, r.name)}`,
    },
    { id: 'st', label: t('afiles.info.st'), value: <StoragePill t={t} state={r.state} /> },
    ...(r.note ? [{ id: 'note', label: t('afiles.info.note'), value: r.note, wide: true }] : []),
    ...(r.state === 'trash' && r.eraseAt
      ? [
          {
            id: 'erase',
            label: t('afiles.info.erase'),
            value: formatMomentRu(new Date(r.eraseAt)),
          },
        ]
      : []),
  ];
  let hint: ReactNode = null;
  if (!r.mem)
    hint = <Hint>{t(r.state === 'trash' ? 'afiles.info.trash_mem' : 'afiles.info.no_mem')}</Hint>;
  return (
    <div data-afiles-info={viewerIdOf(r)}>
      <Box>
        <KeyValues items={items} />
        {r.cat === 'sent' ? <Note>{t('afiles.info.sent')}</Note> : null}
        {hint}
      </Box>
    </div>
  );
}
