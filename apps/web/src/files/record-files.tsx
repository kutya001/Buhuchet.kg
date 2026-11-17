'use client';

import type { FileSource } from '@buhuchet/shared';
import { FileLink } from '@buhuchet/shared';
import {
  ConfirmDialog,
  FilesBox,
  Note,
  useToast,
  type FilesBoxItem,
  type FilesBoxLabels,
} from '@buhuchet/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { api, ApiFailure, callApi } from '../api-client';
import { closeSlot, openSlot, type DialogSlot } from '../dialog-slot';
import { useErrorText, useT } from '../l10n/provider';
import { AttachDialog } from './attach-dialog';
import { FileEditDialog } from './file-edit-dialog';
import { linkFiles, unlinkFile } from './file-links-data';
import { FilePickDialog } from './file-pick-dialog';
import { FileViewer } from './file-viewer';
import { fileBytesUrl, fileDownloadUrl } from './file-window';
import { fileMeta, filesQuery, uploadFile, useFilePageToggle, useFilesRefresh } from './files-data';

/**
 * Блок «Файлы» карточки записи (задача 2.04; прототип modules/services.js `filesBox`, `bindFiles`):
 * файлы записи, «Прикрепить» (несколько файлов сразу; после выбора — окно с необязательным
 * примечанием, прототип v95 `attachDlg`), «Скачать» по ссылке на 15 минут, «Изменить файл» (название,
 * примечание, замена — `fileEditDlg`) и «Удалить» с подтверждением. Модуль с записями ставит его в
 * карточку со своим `source`. У записи контрагента (доработки 16.11.2026, блок 2; прототип v124
 * `filesBox`, `fPickDlg`, `fUnlink`) — «Из файлов контрагента» (файлы прикрепляются ссылкой сразу, с
 * записью в историю) и файлы-ссылки после своих файлов: «также в файлах контрагента» и «Открепить».
 */
/**
 * Окно самой записи — после «Из файлов контрагента» и «Открепить» в его «Истории изменений» новая строка
 * (docs/typical-mistakes.md № 44): поступление, оплаты и операции — окна «Финансовых операций», отчёт —
 * карточка, проект и транш — их окна. Удаление файла со ссылками перечитывает их так же (`useFileDelete`).
 */
export function recordQueryKey(source: FileSource): readonly unknown[] | null {
  if (!source.id) return null;
  switch (source.kind) {
    case 'report':
      return ['reports', 'card', source.id];
    case 'project':
      return ['projects', 'card', source.id];
    case 'project_payment':
      return ['projects', 'payment', source.id];
    case 'receipt':
    case 'tax_payment':
    case 'money_operation':
    case 'fee_payment':
    case 'one_off_service':
    case 'one_off_service_payment':
      return ['finance'];
    default:
      return null;
  }
}

export function RecordFiles({ source }: { source: FileSource }) {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const client = useQueryClient();
  const query = filesQuery(source);
  const files = useQuery(query);
  const [busy, setBusy] = useState(false);
  const [ask, setAsk] = useState<{ id: string; name: string; version: number } | null>(null);
  const [picked, setPicked] = useState<File[] | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  // Окно просмотра: «‹ ›» — файлы блока по порядку (доработки 16.11.2026, блок 5; прототип v126).
  const [view, setView] = useState<DialogSlot<string> | null>(null);
  const togglePage = useFilePageToggle(t, toast, errorText);
  // Ссылка меняет и «Источник» в «Файловом менеджере», и «также у …» в файлах контрагента, и историю
  // самой записи.
  const refreshFiles = useFilesRefresh();
  const refreshAll = async () => {
    const record = recordQueryKey(source);
    await Promise.all([
      refreshFiles(),
      record ? client.invalidateQueries({ queryKey: record }) : null,
    ]);
  };

  const labels = useMemo<FilesBoxLabels>(
    () => ({
      title: t('files.title'),
      attach: t('files.attach'),
      uploading: t('files.uploading'),
      empty: t('files.empty'),
      download: (name) => t('files.download', { name }),
      remove: (name) => t('files.remove', { name }),
      removeTitle: t('files.remove_title'),
      edit: (name) => t('files.edit', { name }),
      editTitle: t('files.edit_title'),
      noteTitle: t('files.note_title'),
      pick: t('files.link.pick'),
      unlink: t('files.link.unlink'),
      unlinkTitle: t('files.link.unlink_title'),
      unlinkAria: (name) => t('files.link.unlink_aria', { name }),
    }),
    [t],
  );

  // Нет права «Просматривать файлы» или «Файлы в карточках» выключены — блока нет (ТЗ: выключенная
  // функция и раздел без права не показываются).
  if (files.error instanceof ApiFailure && files.error.status === 403) return null;
  if (files.isError) return <Note tone="bad">{t('files.load_error')}</Note>;
  if (!files.data) return null;
  // Свои файлы записи, затем файлы контрагента ссылкой (прототип: `files`, потом `lk`); у отчёта
  // ссылки — над своими (прототип v124 report-card.js `rcLinked`).
  const own = files.data.items.filter((f) => !f.linked);
  const linkedFiles = files.data.items.filter((f) => f.linked);
  const ordered = source.kind === 'report' ? [...linkedFiles, ...own] : [...own, ...linkedFiles];
  const items: FilesBoxItem[] = ordered.map((f) => ({
    id: f.id,
    name: f.name,
    meta: f.linked
      ? `${fileMeta(t, f.name, f.size)} · ${t('files.link.also_cp')}`
      : fileMeta(t, f.name, f.size),
    note: f.note,
    canDelete: f.canDelete,
    canEdit: f.canEdit,
    linked: f.linked,
    canUnlink: f.canUnlink,
    // «Глаз» (прототип v74 `pgFileBtn`): только с правом «Управлять страницей контрагента».
    ...(f.page?.canChange
      ? {
          page: {
            hidden: f.page.hidden,
            label: t(f.page.hidden ? 'files.pg.btn_show' : 'files.pg.btn_hide'),
          },
        }
      : {}),
  }));
  const refresh = () => client.invalidateQueries({ queryKey: query.queryKey });

  const attach = async (chosen: File[], note: string) => {
    setBusy(true);
    let attached = 0;
    for (const file of chosen) {
      const res = await uploadFile(source, file, { note });
      if (res.ok) attached++;
      else
        toast(t('files.upload_failed', { name: file.name, error: errorText(res.error) }), {
          bad: true,
          icon: 'alert',
        });
    }
    await refresh();
    setBusy(false);
    if (attached) toast(t('files.attached'), { icon: 'clip' });
  };

  const download = async (item: FilesBoxItem) => {
    const res = await callApi(() => api.api.files[':id'].link.$get({ param: { id: item.id } }));
    if (!res.ok) return toast(errorText(res.error), { bad: true, icon: 'alert' });
    window.location.assign(FileLink.parse(res.data).url);
  };

  const target = source.id ? { kind: source.kind, id: source.id } : null;

  const link = async (picked: { id: string }[]) => {
    if (!target) return;
    const res = await linkFiles(
      target,
      picked.map((x) => x.id),
    );
    await refreshAll();
    if (!res.ok) return toast(errorText(res.error), { bad: true, icon: 'alert' });
    const n = res.data.added.length;
    if (n)
      toast(n > 1 ? t('files.link.linked_n', { n }) : t('files.link.linked_one'), { icon: 'link' });
  };

  const unlink = async (item: FilesBoxItem) => {
    if (!target) return;
    const res = await unlinkFile(item.id, target);
    await refreshAll();
    if (res.ok) toast(t('files.link.unlinked'), { icon: 'link' });
    else toast(errorText(res.error), { bad: true, icon: 'alert' });
  };

  const remove = async (file: { id: string; version: number }) => {
    const res = await callApi(() =>
      api.api.files[':id'].$delete({
        param: { id: file.id },
        query: { version: String(file.version) },
      }),
    );
    await refresh();
    if (res.ok) toast(t('files.deleted'), { icon: 'trash' });
    else toast(errorText(res.error), { bad: true, icon: 'alert' });
  };

  return (
    <>
      <FilesBox
        items={items}
        canUpload={files.data.canUpload}
        busy={busy}
        labels={labels}
        onPick={setPicked}
        onDownload={(item) => void download(item)}
        onDelete={(item) => {
          const file = files.data.items.find((f) => f.id === item.id);
          if (file) setAsk({ id: file.id, name: file.name, version: file.version });
        }}
        onPage={(item) => item.page && void togglePage(item, !item.page.hidden)}
        onEdit={(item) => setEditId(item.id)}
        canLink={files.data.canLink && target !== null}
        onLinkPick={() => setPicking(true)}
        onUnlink={(item) => void unlink(item)}
        onOpen={(item) => setView(openSlot(item.id))}
        openTitle={t('files.view.open')}
      />
      {view ? (
        <FileViewer
          key={`view-${view.n}`}
          files={ordered}
          index={Math.max(
            0,
            ordered.findIndex((f) => f.id === view.data),
          )}
          open={view.open}
          onClose={() => setView(closeSlot)}
          src={fileBytesUrl}
          download={fileDownloadUrl}
        />
      ) : null}
      <FilePickDialog
        target={picking ? target : null}
        onClose={() => setPicking(false)}
        onPick={(picked) => void link(picked)}
      />
      <AttachDialog
        files={picked}
        onClose={() => setPicked(null)}
        onAttach={(note) => {
          const chosen = picked ?? [];
          setPicked(null);
          void attach(chosen, note);
        }}
      />
      <FileEditDialog
        file={files.data.items.find((f) => f.id === editId) ?? null}
        onClose={() => setEditId(null)}
      />
      <ConfirmDialog
        open={ask !== null}
        onClose={() => setAsk(null)}
        title={t('files.delete_title', { name: ask?.name ?? '' })}
        text={t('files.delete_text')}
        ok={t('files.delete_ok')}
        danger
        onConfirm={() => ask && void remove(ask)}
      />
    </>
  );
}
