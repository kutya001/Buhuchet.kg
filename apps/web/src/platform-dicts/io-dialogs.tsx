'use client';

import {
  ADMIN_DICT_META,
  IO_COLUMNS,
  ioTsv,
  pluralForm,
  type AdminValueDict,
} from '@buhuchet/domain';
import { AdminDictImportApplied, AdminDictImportPreview } from '@buhuchet/shared';
import {
  buttonClass,
  Field,
  Icon,
  inputClass,
  linkButtonClass,
  MiniTable,
  Modal,
  Note,
  Plate,
  Plates,
  StatusPill,
  useToast,
  type MiniRow,
} from '@buhuchet/ui';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useId, useState, type ReactNode } from 'react';
import { api, callApi } from '../api-client';
import { useErrorText, useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';
import { useListExport } from '../lists/export';
import { dictIoFileQuery, usePdictsRefresh } from './pdicts-data';

/*
 * Админка → «Справочники платформы» → «Выгрузить в Excel» и «Загрузить из Excel» (задача 2.37; ТЗ
 * «Выгрузка и загрузка справочников»; прототип admin/platform-dicts-io.js: exportDlg, importDictDlg).
 * Файл собирает и разбирает сервер: выгрузка — текст для «Скопировать» и .xlsx, загрузка — вставка или
 * файл, сравнение со справочником, «ОК, применить».
 */

const io = api.api.admin['platform-dicts-io'];

const rowsText = (t: Translate, n: number) => t(`pdicts.io.rows.${pluralForm(n)}`, { n });

/** Окно «Выгрузка» (прототип exportDlg): строки для Excel, «Скопировать» и «Скачать для Excel». */
export function ExportDialog({
  dict,
  open,
  onClose,
}: {
  dict: AdminValueDict;
  open: boolean;
  onClose: () => void;
}) {
  const t = useT();
  const toast = useToast();
  const file = useQuery({ ...dictIoFileQuery(dict), enabled: open });
  const text = file.data ? ioTsv([file.data.header, ...file.data.rows]) : '';
  const textId = useId();
  const send = useCallback(() => io[':dict'].xlsx.$get({ param: { dict } }), [dict]);
  const exporter = useListExport(send);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast(t('pdicts.io.export.copied'), { icon: 'paste' });
    } catch {
      (document.getElementById(textId) as HTMLTextAreaElement | null)?.select();
    }
  };
  const keyCode = 'key' in ADMIN_DICT_META[dict].code;
  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="form"
      size="wide"
      title={t('pdicts.io.export.title', { dict: t(`pdicts.title.${dict}`) })}
      sub={
        file.data
          ? t('pdicts.io.export.sub', { rows: rowsText(t, file.data.rows.length) })
          : undefined
      }
      footer={
        <>
          <button
            type="button"
            className={buttonClass()}
            disabled={!text}
            onClick={() => void copy()}
          >
            <Icon name="paste" size="sm" />
            {t('pdicts.io.export.copy')}
          </button>
          <div className="grow" />
          <button type="button" className={buttonClass('ghost')} onClick={onClose}>
            {t('btn.close')}
          </button>
          <button
            type="button"
            className={buttonClass('cta')}
            disabled={exporter.exporting}
            onClick={() => void exporter.run()}
          >
            <Icon name="download" size="sm" />
            {t('pdicts.io.export.download')}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Note icon="info">
          {t(keyCode ? 'pdicts.io.export.note_key' : 'pdicts.io.export.note')}
        </Note>
        <textarea
          id={textId}
          readOnly
          aria-label={t('pdicts.io.export.text')}
          value={text}
          className={`${inputClass({ mono: true, multiline: true })} min-h-[260px] text-[12px] whitespace-pre`}
        />
      </div>
    </Modal>
  );
}

type Preview = AdminDictImportPreview;

/** Тело запроса: вставка — текстом, файл — как есть (сервер сам узнаёт .xlsx и CSV). */
type Upload = { kind: 'text'; text: string } | { kind: 'file'; file: File };

function post(url: string, data: Upload) {
  return fetch(url, {
    method: 'POST',
    headers: {
      'content-type':
        data.kind === 'text' ? 'text/plain; charset=utf-8' : 'application/octet-stream',
    },
    body: data.kind === 'text' ? data.text : data.file,
  });
}

/** Было → стало: зачёркнутое прежнее и жирное новое; пустое — «пусто» (прототип). */
function changeLine(t: Translate, c: Preview['change'][number]['changes'][number]) {
  const empty = t('pdicts.io.import.empty_value');
  return (
    <span key={c.title} className="block">
      {c.title}: <s className="text-faint">{c.from || empty}</s> → <b>{c.to || empty}</b>
    </span>
  );
}

const WHAT = {
  error: { tone: 'red', icon: 'alert', label: 'pdicts.io.import.what.error' },
  add: { tone: 'green', icon: 'plus', label: 'pdicts.io.import.what.add' },
  change: { tone: 'blue', icon: 'edit', label: 'pdicts.io.import.what.change' },
  off: { tone: 'orange', icon: 'ban', label: 'pdicts.io.import.what.off' },
} as const;

/**
 * Строки сравнения (прототип: ошибки, «добавится», «изменится», «отключится»); у отключаемого —
 * название и другие изменённые поля, без «Активно».
 */
function previewRows(t: Translate, p: Preview, activeTitle: string): MiniRow[] {
  const what = (key: keyof typeof WHAT) => {
    const w = WHAT[key];
    return <StatusPill tone={w.tone} icon={w.icon} label={t(w.label)} size="sm" />;
  };
  // На телефоне «Подробно» — на всю ширину карточки: там «было → стало» и тексты ошибок.
  const row = (key: string, pill: ReactNode, code: string, details: ReactNode): MiniRow => ({
    key,
    cells: { what: pill, code: <span className="font-mono">{code}</span>, details },
    wide: ['details'],
  });
  return [
    ...p.errors.map((r) =>
      row(
        `e${r.line}`,
        what('error'),
        r.code || '—',
        t('pdicts.io.err.line', { n: r.line, text: r.errors.join('; ') }),
      ),
    ),
    ...p.add.map((r) => row(`a${r.line}`, what('add'), r.code, r.name)),
    ...p.change.map((r) =>
      row(
        `c${r.line}`,
        what('change'),
        r.code,
        r.changes.map((c) => changeLine(t, c)),
      ),
    ),
    ...p.off.map((r) => {
      const others = r.changes.filter((c) => c.title !== activeTitle);
      return row(
        `o${r.line}`,
        what('off'),
        r.code,
        <>
          {r.name}
          {others.map((c) => changeLine(t, c))}
        </>,
      );
    }),
  ];
}

/**
 * Окно «Загрузка» (прототип importDictDlg): вставка из Excel или файл → «Сравнить» → плашки «Будет
 * добавлено», «Будет изменено», «Будет отключено», «Строк с ошибками» и строки «Что будет» → «ОК,
 * применить N». Сервер проверяет и записывает строки так же, как окно правки; справочник или файл
 * изменились после сравнения — сообщение, сравнить заново.
 */
export function ImportDialog({
  dict,
  open,
  onClose,
}: {
  dict: AdminValueDict;
  open: boolean;
  onClose: () => void;
}) {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const refresh = usePdictsRefresh();
  const fieldId = useId();
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const current = useQuery({ ...dictIoFileQuery(dict), enabled: false });
  const upload = (): Upload | null =>
    file ? { kind: 'file', file } : text.trim() ? { kind: 'text', text } : null;

  const compare = async () => {
    const data = upload();
    if (!data) return setError(t('err.import_empty'));
    setBusy(true);
    try {
      const res = await callApi(() => post(`/api/admin/platform-dicts-io/${dict}/preview`, data));
      if (!res.ok) return setError(errorText(res.error));
      setError(null);
      setPreview(AdminDictImportPreview.parse(res.data));
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    const data = upload();
    if (!data || !preview) return;
    setBusy(true);
    try {
      const url = `/api/admin/platform-dicts-io/${dict}/apply?stamp=${preview.stamp}`;
      const res = await callApi(() => post(url, data));
      if (!res.ok) {
        toast(errorText(res.error), { bad: true });
        // Справочник изменился — сравнить заново.
        if (res.error.code === 'import_changed') setPreview(null);
        return;
      }
      const { load } = AdminDictImportApplied.parse(res.data);
      refresh(dict);
      refresh('loads');
      toast(
        t('pdicts.io.import.done', {
          added: load.added,
          changed: load.changed,
          disabled: load.disabled,
        }),
        { icon: 'upload' },
      );
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const fillCurrent = async () => {
    const res = await current.refetch();
    if (!res.data) return;
    setFile(null);
    setText(ioTsv([res.data.header, ...res.data.rows]));
    setPreview(null);
  };

  const columns = IO_COLUMNS[dict];
  const activeTitle = t(columns[columns.length - 1]!.title);
  const n = preview ? preview.add.length + preview.change.length + preview.off.length : 0;
  const title = t('pdicts.io.import.title', { dict: t(`pdicts.title.${dict}`) });

  const footer = preview ? (
    <>
      <button type="button" className={buttonClass('ghost')} onClick={() => setPreview(null)}>
        <Icon name="left" size="sm" />
        {t('pdicts.io.import.back')}
      </button>
      <div className="grow" />
      <button type="button" className={buttonClass('ghost')} onClick={onClose}>
        {t('btn.cancel')}
      </button>
      <button
        type="button"
        className={buttonClass('cta')}
        disabled={!n || busy}
        onClick={() => void apply()}
      >
        {t('pdicts.io.import.apply', { n: n || '' })}
      </button>
    </>
  ) : (
    <>
      <div className="grow" />
      <button type="button" className={buttonClass('ghost')} onClick={onClose}>
        {t('btn.cancel')}
      </button>
      <button
        type="button"
        className={buttonClass('cta')}
        disabled={busy}
        onClick={() => void compare()}
      >
        {t('pdicts.io.import.compare')}
      </button>
    </>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="form"
      size="wide"
      title={title}
      sub={t('pdicts.io.import.sub')}
      dirty={!!(text || file)}
      footer={footer}
    >
      {preview ? (
        <PreviewBody preview={preview} activeTitle={activeTitle} />
      ) : (
        <div className="flex flex-col gap-3">
          <Field
            id={fieldId}
            label={t('pdicts.io.import.data')}
            full
            error={error ?? undefined}
            hint={t('pdicts.io.import.hint', {
              cols: columns.map((c) => t(c.title)).join(', '),
              active: activeTitle,
            })}
          >
            {file ? (
              <div className={`${inputClass()} flex items-center gap-2`}>
                <Icon name="file" size="sm" />
                {t('pdicts.io.import.file_chosen', { name: file.name })}
              </div>
            ) : (
              <textarea
                id={fieldId}
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  setError(null);
                }}
                placeholder={t('pdicts.io.import.placeholder')}
                className={`${inputClass({ mono: true, multiline: true })} min-h-[220px] text-[12px]`}
              />
            )}
          </Field>
          <div className="flex flex-wrap items-center gap-3">
            <label className={`${buttonClass('default', 'sm')} cursor-pointer`}>
              <Icon name="upload" size="sm" />
              {t('pdicts.io.import.file')}
              <input
                type="file"
                accept=".xlsx,.csv,.tsv,.txt"
                hidden
                onChange={(e) => {
                  const chosen = e.target.files?.[0];
                  e.target.value = '';
                  if (!chosen) return;
                  setFile(chosen);
                  setError(null);
                }}
              />
            </label>
            <button type="button" className={linkButtonClass()} onClick={() => void fillCurrent()}>
              {t('pdicts.io.import.current')}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

/** Сравнение: плашки, строки «Что будет» и «Без изменений». */
function PreviewBody({ preview, activeTitle }: { preview: Preview; activeTitle: string }) {
  const t = useT();
  const n = preview.add.length + preview.change.length + preview.off.length;
  const errors = preview.errors.length;
  const rows = previewRows(t, preview, activeTitle);
  return (
    <div className="flex flex-col gap-3">
      <Plates>
        <Plate
          id="add"
          icon="plus"
          color="green"
          label={t('pdicts.io.import.plate.add')}
          value={String(preview.add.length)}
        />
        <Plate
          id="change"
          icon="edit"
          color="blue"
          label={t('pdicts.io.import.plate.change')}
          value={String(preview.change.length)}
        />
        <Plate
          id="off"
          icon="ban"
          color="orange"
          label={t('pdicts.io.import.plate.off')}
          value={String(preview.off.length)}
        />
        <Plate
          id="errors"
          icon="alert"
          color={errors ? 'red' : 'green'}
          label={t('pdicts.io.import.plate.errors')}
          value={String(errors)}
          sub={t(errors ? 'pdicts.io.import.plate.errors_sub' : 'pdicts.io.import.plate.no_errors')}
        />
      </Plates>
      {/* На телефоне прокручивается всё окно, на ПК — только строки (прототип: max-height 340px). */}
      <div className="md:max-h-[340px] md:overflow-auto">
        <MiniTable
          label={t('pdicts.io.import.table')}
          columns={[
            { key: 'what', label: t('pdicts.io.import.col.what'), width: 130 },
            { key: 'code', label: t('pdicts.io.import.col.code'), width: 110 },
            { key: 'details', label: t('pdicts.io.import.col.details') },
          ]}
          rows={rows}
          empty={
            !n && !errors
              ? t(`pdicts.io.import.same.${pluralForm(preview.same)}`, { n: preview.same })
              : ''
          }
        />
      </div>
      <p className="text-[12px] text-faint">
        {t('pdicts.io.import.unchanged', { n: preview.same })}
      </p>
    </div>
  );
}
