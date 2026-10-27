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
import { useErrorText, useT } from '../l10n/provider';
import { fileMeta, filesQuery, pickedFilesProblem, uploadFile } from './files-data';

/**
 * Блок «Файлы» карточки записи (задача 2.04; прототип modules/services.js `filesBox`, `bindFiles`):
 * файлы записи, «Прикрепить» (несколько файлов сразу), «Скачать» по ссылке на 15 минут и «Удалить» с
 * подтверждением. Модуль с записями ставит его в карточку со своим `source`.
 */
export function RecordFiles({ source }: { source: FileSource }) {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const client = useQueryClient();
  const query = filesQuery(source);
  const files = useQuery(query);
  const [busy, setBusy] = useState(false);
  const [ask, setAsk] = useState<{ id: string; name: string; version: number } | null>(null);

  const labels = useMemo<FilesBoxLabels>(
    () => ({
      title: t('files.title'),
      attach: t('files.attach'),
      uploading: t('files.uploading'),
      empty: t('files.empty'),
      download: (name) => t('files.download', { name }),
      remove: (name) => t('files.remove', { name }),
      removeTitle: t('files.remove_title'),
    }),
    [t],
  );

  // Нет права «Просматривать файлы» или «Файлы в карточках» выключены — блока нет (ТЗ: выключенная
  // функция и раздел без права не показываются).
  if (files.error instanceof ApiFailure && files.error.status === 403) return null;
  if (files.isError) return <Note tone="bad">{t('files.load_error')}</Note>;
  if (!files.data) return null;
  const items: FilesBoxItem[] = files.data.items.map((f) => ({
    id: f.id,
    name: f.name,
    meta: fileMeta(t, f.name, f.size),
    canDelete: f.canDelete,
  }));
  const refresh = () => client.invalidateQueries({ queryKey: query.queryKey });

  const pick = async (picked: File[]) => {
    const problem = pickedFilesProblem(picked);
    if (problem) {
      const text =
        'names' in problem
          ? t('files.too_large', { names: problem.names })
          : t('files.upload_failed', {
              name: problem.name,
              error: errorText({ code: problem.code, message: '' }),
            });
      return toast(text, { bad: true, icon: 'alert' });
    }
    setBusy(true);
    let attached = 0;
    for (const file of picked) {
      const res = await uploadFile(source, file);
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
        onPick={(picked) => void pick(picked)}
        onDownload={(item) => void download(item)}
        onDelete={(item) => {
          const file = files.data.items.find((f) => f.id === item.id);
          if (file) setAsk({ id: file.id, name: file.name, version: file.version });
        }}
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
