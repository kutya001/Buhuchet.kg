'use client';

import { FileLink, FileManagerList, type FileManagerRow } from '@buhuchet/shared';
import { Box, buttonClass, EmptyState, Icon, MiniTable, Note, useToast } from '@buhuchet/ui';
import { queryOptions, useQuery } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { api, apiFailure, callApi } from '../api-client';
import { closeSlot, openSlot, type DialogSlot } from '../dialog-slot';
import { FileWindow } from '../files/file-window';
import { fileSizeText, pickedFilesProblem, uploadFile, useFilesRefresh } from '../files/files-data';
import { useErrorText, useT } from '../l10n/provider';
import { useShell } from '../shell/context';

const MANUAL = { kind: 'manual', id: null } as const;

/**
 * Файлы контрагента — те же, что «Файловый менеджер» показывает по столбцу «Контрагент»: файлы самого
 * контрагента, его отчётов, задач и показателей (сервер проверяет право и область).
 */
export const contractorFilesQuery = (contractorId: string) =>
  queryOptions({
    queryKey: ['files', 'contractor', contractorId],
    queryFn: async () => {
      const res = await api.api.files.manager.$get({
        query: {
          size: 'all',
          sort: 'date.desc',
          filters: JSON.stringify({ cp: { type: 'enum', vals: [contractorId] } }),
        },
      });
      if (!res.ok) throw await apiFailure(res);
      return FileManagerList.parse(await res.json());
    },
  });

/** Есть ли вкладка «Файлы»: функция «Файлы в карточках» и право «Просматривать файлы». */
export function useFilesTabOn(): boolean {
  const { access } = useShell();
  return access.feature('files') && access.can('filesView');
}

/**
 * Вкладка «Файлы» карточки контрагента (ТЗ «Карточка контрагента с вкладками»: «Документов: N» и
 * «Прикрепить»; прототип modules/contractor-card.js, `st.tab==='files'`): документы контрагента и его
 * записей; строка открывает окно файла со «Скачать». «Прикрепить» (право «Загружать файлы») кладёт файлы
 * как загруженные вручную к этому контрагенту — их видно и в «Файловом менеджере».
 */
export function ContractorFilesTab({
  contractorId,
  archived,
}: {
  contractorId: string;
  archived: boolean;
}) {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const refresh = useFilesRefresh();
  const { access } = useShell();
  const input = useRef<HTMLInputElement>(null);
  const files = useQuery(contractorFilesQuery(contractorId));
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<DialogSlot<FileManagerRow> | null>(null);
  const canAttach = access.can('filesUpload') && !archived;

  const download = async (file: FileManagerRow) => {
    const res = await callApi(() => api.api.files[':id'].link.$get({ param: { id: file.id } }));
    if (!res.ok) return toast(errorText(res.error), { bad: true, icon: 'alert' });
    globalThis.location.assign(FileLink.parse(res.data).url);
  };

  const attach = async (picked: File[]) => {
    const problem = pickedFilesProblem(picked);
    if (problem) {
      return toast(
        'names' in problem
          ? t('files.too_large', { names: problem.names })
          : t('files.upload_failed', {
              name: problem.name,
              error: errorText({ code: problem.code, message: '' }),
            }),
        { bad: true, icon: 'alert' },
      );
    }
    setBusy(true);
    let done = 0;
    for (const file of picked) {
      const res = await uploadFile(MANUAL, file, { contractorId, note: '' });
      if (res.ok) done++;
      else
        toast(t('files.upload_failed', { name: file.name, error: errorText(res.error) }), {
          bad: true,
          icon: 'alert',
        });
    }
    await refresh();
    setBusy(false);
    if (done) toast(t('files.upload.done', { n: done }), { icon: 'clip' });
  };

  const button = canAttach ? (
    <>
      <button
        type="button"
        data-cp-attach=""
        className={buttonClass(files.data?.total ? 'default' : 'cta', 'sm')}
        disabled={busy}
        onClick={() => input.current?.click()}
      >
        <Icon name="clip" size="sm" />
        {t('cp.files.attach')}
      </button>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          const picked = [...(e.target.files ?? [])];
          e.target.value = '';
          if (picked.length) void attach(picked);
        }}
      />
    </>
  ) : null;

  if (files.isError) return <Note tone="bad">{t('files.load_error')}</Note>;
  const data = files.data;
  if (!data) return null;
  return (
    <div className="flex flex-col gap-3" data-cp-files="">
      {data.total === 0 ? (
        <EmptyState icon="clip" title={t('cp.files.empty')} text={t('cp.files.empty_text')}>
          {button}
        </EmptyState>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] text-muted">{t('cp.files.count', { n: data.total })}</span>
            <div className="flex-1" />
            {button}
          </div>
          <Box>
            <MiniTable
              label={t('cp.card.tab.files')}
              empty=""
              columns={[
                { key: 'name', label: t('cp.files.col.name') },
                { key: 'src', label: t('cp.files.col.src') },
                { key: 'size', label: t('cp.files.col.size'), numeric: true },
              ]}
              rows={data.items.map((f) => ({
                key: f.id,
                cells: {
                  name: (
                    <span className="inline-flex items-center gap-1.5">
                      <Icon name="file" size="sm" />
                      {f.name}
                    </span>
                  ),
                  src: <span className="text-muted">{f.source}</span>,
                  size: <span className="text-muted">{fileSizeText(t, f.size)}</span>,
                },
                wide: ['name'],
              }))}
              onOpen={(key) => {
                const file = data.items.find((f) => f.id === key);
                if (file) setOpen(openSlot(file));
              }}
            />
            <span className="text-[11.5px] leading-[1.4] text-faint">{t('cp.files.hint')}</span>
          </Box>
        </>
      )}
      {open ? (
        <FileWindow
          key={`file-${open.n}`}
          file={open.data}
          open={open.open}
          onClose={() => setOpen(closeSlot)}
          onDownload={() => void download(open.data)}
          onSource={null}
        />
      ) : null}
    </div>
  );
}
