'use client';

import {
  KB_ADMIN_COLUMNS,
  KB_ARTICLE_AUDIENCES,
  KB_MODULE_TITLES,
  kbArticleProblems,
  MENU_MODULE_IDS,
  NEWS_IMAGE_MAX_BYTES,
  type KbArticleField,
  type KbArticleInput,
  type UiTextKey,
} from '@buhuchet/domain';
import {
  KbArticle,
  NewsImageUploaded,
  type AdminKbArticle,
  type AdminKbRow,
} from '@buhuchet/shared';
import {
  buttonClass,
  DataGrid,
  EmptyState,
  Field,
  FormGrid,
  Icon,
  inputClass,
  Modal,
  MONO_CLASS,
  Note,
  RecordChangedNotice,
  SWITCH_CLASS,
  useToast,
  type ActionEntry,
  type GridColumn,
} from '@buhuchet/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { api, ApiFailure, apiFailure, callApi } from '../api-client';
import { closeSlot, openSlot, type DialogSlot } from '../dialog-slot';
import { KbArticleBody, type ArticleScreenInfo } from '../kb/kb-article';
import { useErrorText, useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';
import { useListExport } from '../lists/export';
import { useGridLabels } from '../lists/grid-labels';
import { useListPage } from '../lists/use-list-page';
import { useViewSettings } from '../lists/view-settings';
import { useShell } from '../shell/context';
import { isModuleId, MODULES } from '../shell/modules';
import { useKbAdmAdd } from './kbadm-add';
import {
  fetchKbAdminRows,
  fetchKbAdminValues,
  kb,
  KBADM_GRID,
  kbAdminArticleQuery,
  kbAdminMetaQuery,
  refreshKbAdmin,
} from './kbadm-data';
import { KbAdmHistory } from './kbadm-history';

/** Ширины столбцов, px — как в прототипе (`kb-arts`). */
const WIDTHS: Readonly<Record<string, number>> = {
  id: 90,
  sec: 170,
  t: 320,
  mod: 200,
  perm: 200,
  aud: 170,
  len: 120,
  active: 100,
};

const value = (x: AdminKbRow, key: string) => String(x.values[key] ?? '');

function artColumns(t: Translate): GridColumn<AdminKbRow>[] {
  return KB_ADMIN_COLUMNS.arts.map((c) => {
    const column: GridColumn<AdminKbRow> = {
      key: c.key,
      label: t(c.label),
      type: c.type,
      width: WIDTHS[c.key],
      text: (x) => value(x, c.key),
    };
    if (c.key === 'id') column.className = MONO_CLASS;
    if (c.key === 't') {
      column.cell = (x) => <span className="truncate font-semibold">{value(x, 't')}</span>;
    }
    return column;
  });
}

const DEFAULT_VISIBLE = KB_ADMIN_COLUMNS.arts.filter((c) => !c.hidden).map((c) => c.key);

/**
 * Админка → «База знаний (содержимое)» → «Статьи» (ТЗ; прототип admin/kb-content.js, renderKbAdm):
 * статьи «Базы знаний» для всех организаций. Строка открывает окно статьи; меню — «Изменить»,
 * «Предпросмотр», «Отключить» или «Включить»; отключённые — приглушённо. «+ Добавить» → «Статья».
 */
export function KbAdmArtsTab() {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const client = useQueryClient();
  const labels = useGridLabels('kbadm.arts_count');
  const columns = useMemo(() => artColumns(t), [t]);
  const view = useViewSettings(KBADM_GRID.arts);
  const { search, clearSearch } = useShell();
  const fetchPage = useMemo(() => fetchKbAdminRows('arts'), []);
  const loadValues = useMemo(() => fetchKbAdminValues('arts'), []);
  const list = useListPage({
    gridKey: KBADM_GRID.arts,
    columns,
    defaultVisible: DEFAULT_VISIBLE,
    settings: view.settings,
    defaultSort: null,
    search,
    enabled: view.ready,
    fetchPage,
  });
  const { params, visible } = list;
  const sendExport = useCallback(
    () =>
      kb.list[':list'].export.$get({
        param: { list: 'arts' },
        query: { ...params, cols: visible.join(',') },
      }),
    [params, visible],
  );
  const exporter = useListExport(sendExport);
  const [dialog, setDialog] = useState<DialogSlot<AdminKbArticle | null> | null>(null);
  const [preview, setPreview] = useState<DialogSlot<KbArticle> | null>(null);

  const fail = useCallback(
    (e: unknown) =>
      toast(errorText(e instanceof ApiFailure ? e.error : { code: 'network', message: '' }), {
        bad: true,
      }),
    [toast, errorText],
  );
  const load = useCallback(
    (x: AdminKbRow) => client.fetchQuery(kbAdminArticleQuery(x.id)),
    [client],
  );
  const edit = (x: AdminKbRow) =>
    void load(x).then((a) => setDialog(openSlot<AdminKbArticle | null>(a)), fail);
  const show = (x: AdminKbRow) =>
    void load(x)
      .then((a) => previewArticle(a))
      .then((p) => setPreview(openSlot(p)), fail);
  useKbAdmAdd('art', () => setDialog(openSlot<AdminKbArticle | null>(null)));

  const setActive = async (x: AdminKbRow, active: boolean) => {
    const res = await callApi(() =>
      kb.arts[':id'].active.$post({ param: { id: x.id }, json: { active, version: x.version } }),
    );
    refreshKbAdmin(client);
    if (!res.ok) toast(errorText(res.error), { bad: true });
  };

  const actions = (x: AdminKbRow): ActionEntry[] => [
    { id: 'edit', label: t('kbadm.act.edit'), icon: 'edit', run: () => edit(x) },
    { id: 'preview', label: t('kbadm.act.preview'), icon: 'eye', run: () => show(x) },
    { id: 'sep', separator: true },
    x.active
      ? {
          id: 'off',
          label: t('kbadm.act.art_off'),
          icon: 'ban',
          sub: t('kbadm.act.art_off.sub'),
          run: () => void setActive(x, false),
        }
      : { id: 'on', label: t('kbadm.act.on'), icon: 'check', run: () => void setActive(x, true) },
  ];

  return (
    <div className="flex flex-col gap-3.5">
      <Note icon="info">{t('kbadm.arts.note')}</Note>
      <DataGrid
        columns={columns}
        defaultVisible={DEFAULT_VISIBLE}
        defaultSort={null}
        settings={view.settings}
        onSettingsChange={view.save}
        onResetView={() => void view.reset()}
        data={view.ready ? list.data : undefined}
        onPageChange={list.setPage}
        error={list.error}
        errorText={list.errorText}
        errorTextOf={list.errorTextOf}
        onRetry={list.retry}
        filters={list.filters}
        onFiltersChange={list.setFilters}
        loadValues={loadValues}
        search={search}
        onClearSearch={clearSearch}
        onExport={() => void exporter.run()}
        exporting={exporter.exporting}
        empty={<EmptyState icon="book" title={t('grid.empty')} />}
        rowKey={(x) => x.id}
        titleKey="t"
        rowTone={(x) => (x.active ? undefined : 'muted')}
        label={t('tab.kbadm.arts')}
        labels={labels}
        actions={actions}
        onOpen={(x) => edit(x)}
      />
      <KbAdmHistory section="kbarts" />
      {dialog ? (
        <KbArticleEditDialog
          key={dialog.n}
          article={dialog.data}
          open={dialog.open}
          onClose={() => setDialog(closeSlot)}
          onSaved={() => refreshKbAdmin(client)}
          onPreview={(p) => setPreview(openSlot(p))}
        />
      ) : null}
      {preview ? (
        <KbArticlePreview
          key={`p-${preview.n}`}
          article={preview.data}
          open={preview.open}
          onClose={() => setPreview(closeSlot)}
        />
      ) : null}
    </div>
  );
}

/** Статья так, как её увидит пользователь: блоки без разметки (`POST arts/preview`). */
async function previewArticle(input: { t: string; sec: string; mod: string; html: string }) {
  const res = await kb.arts.preview.$post({ json: input });
  if (!res.ok) throw await apiFailure(res);
  return KbArticle.parse(await res.json());
}

/** У новой статьи раздел — «Модули» (прототип). */
const inputOf = (a: AdminKbArticle | null, sec: string): KbArticleInput => ({
  sec: a?.sec ?? sec,
  t: a?.t ?? '',
  mod: a?.mod ?? '',
  perm: a?.perm ?? '',
  aud: a?.aud ?? 'biz',
  active: a?.active ?? true,
  html: a?.html ?? '',
});

const moduleLabel = (t: Translate, id: string) =>
  Object.hasOwn(KB_MODULE_TITLES, id)
    ? t(KB_MODULE_TITLES[id as keyof typeof KB_MODULE_TITLES])
    : id;

/** Картинка в тексте статьи: адрес из хранилища, подпись — имя файла без кавычек и угловых скобок. */
// ОТКЛОНЕНИЕ: docs/deviations.md#Д-26
const imageTag = (url: string, name: string) =>
  `\n<p><img src="${url}" alt="${name.replace(/["<>&]/g, '')}"></p>`;

/**
 * Окно «Статья» (прототип kbArtEditDlg): раздел (из уже заданных или новый), название, модуль, право
 * для просмотра, кому, «Активна» и текст разметкой. «Добавить картинку» кладёт файл в хранилище и
 * дописывает его в текст; «Предпросмотр» — как увидит пользователь, без сохранения.
 */
function KbArticleEditDialog({
  article,
  open,
  onClose,
  onSaved,
  onPreview,
}: {
  article: AdminKbArticle | null;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  onPreview: (article: KbArticle) => void;
}) {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const id = useId();
  const client = useQueryClient();
  const meta = useQuery(kbAdminMetaQuery).data;
  const isNew = article === null;
  const [base, setBase] = useState(article);
  const sec = t('kbadm.art.sec_default');
  const [form, setForm] = useState<KbArticleInput>(() => inputOf(article, sec));
  const [errors, setErrors] = useState<Partial<Record<KbArticleField, string>>>({});
  const [changed, setChanged] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const set = <K extends keyof KbArticleInput>(key: K, v: KbArticleInput[K]) =>
    setForm((f) => ({ ...f, [key]: v }));
  const dirty = JSON.stringify(form) !== JSON.stringify(inputOf(base, sec));
  const sections = [...new Set((meta?.articles ?? []).map((a) => a.sec))];

  const reload = async () => {
    if (!base) return;
    setReloading(true);
    const fresh = await client.fetchQuery(kbAdminArticleQuery(base.id)).catch(() => null);
    setReloading(false);
    if (!fresh) return toast(t('err.unknown'), { bad: true });
    setBase(fresh);
    setForm(inputOf(fresh, sec));
    setChanged(false);
  };

  const addImage = async (file: File) => {
    if (file.size > NEWS_IMAGE_MAX_BYTES) return toast(t('news.md.image_big'), { bad: true });
    const res = await callApi(() =>
      api.api.admin.news.images.$put(
        {},
        { headers: { 'content-type': file.type }, init: { body: file } },
      ),
    );
    if (!res.ok) return toast(errorText(res.error), { bad: true });
    const image = NewsImageUploaded.parse(res.data);
    setForm((f) => ({ ...f, html: f.html + imageTag(image.url, file.name) }));
    toast(t('kbadm.art.image_added'));
  };

  const preview = async () => {
    try {
      onPreview(
        await previewArticle({
          t: form.t.trim() || t('kbadm.art.untitled'),
          sec: form.sec,
          mod: form.mod,
          html: form.html,
        }),
      );
    } catch (e) {
      toast(errorText(e instanceof ApiFailure ? e.error : { code: 'network', message: '' }), {
        bad: true,
      });
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const shown = Object.fromEntries(
      Object.entries(kbArticleProblems(form)).map(([k, p]) => [k, t(`kbadm.err.${p}`)]),
    );
    setErrors(shown);
    if (Object.keys(shown).length) return;
    if (!isNew && !dirty) return onClose();
    setSaving(true);
    const res = await callApi(() =>
      base
        ? kb.arts[':id'].$put({ param: { id: base.id }, json: { ...form, version: base.version } })
        : kb.arts.$post({ json: form }),
    );
    setSaving(false);
    if (res.ok) {
      onSaved();
      onClose();
      return toast(t('kbadm.art.saved'), { icon: 'check' });
    }
    if (res.error.code === 'record_changed') return setChanged(true);
    const field = (res.error.details as { field?: KbArticleField } | undefined)?.field;
    if (field && res.error.code.startsWith('kb_')) {
      return setErrors({ [field]: t(`kbadm.err.${res.error.code}` as UiTextKey) });
    }
    toast(errorText(res.error), { bad: true });
  };
  const formId = `${id}-form`;
  const f = (k: string) => `${id}-${k}`;

  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="form"
      size="wide"
      title={t(isNew ? 'kbadm.art.title_new' : 'kbadm.art.title')}
      sub={isNew ? undefined : base?.t}
      dirty={dirty}
      footer={
        <>
          <button type="button" className={buttonClass('ghost')} onClick={onClose}>
            {t('btn.cancel')}
          </button>
          <button
            type="submit"
            form={formId}
            className={buttonClass('cta')}
            disabled={saving || changed}
          >
            {t('btn.save')}
          </button>
        </>
      }
    >
      {changed ? (
        <RecordChangedNotice
          message={t('err.record_changed')}
          reloadLabel={t('form.reload')}
          onReload={() => void reload()}
          reloading={reloading}
        />
      ) : null}
      <form id={formId} onSubmit={(e) => void submit(e)} noValidate>
        <FormGrid>
          <Field id={f('sec')} label={t('kbadm.art.f.sec')} required error={errors.sec}>
            {(c) => (
              <>
                <input
                  {...c}
                  list={f('secs')}
                  value={form.sec}
                  onChange={(e) => set('sec', e.target.value)}
                  className={inputClass()}
                />
                <datalist id={f('secs')}>
                  {sections.map((s) => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
              </>
            )}
          </Field>
          <Field id={f('t')} label={t('kbadm.art.f.t')} required error={errors.t}>
            {(c) => (
              <input
                {...c}
                value={form.t}
                onChange={(e) => set('t', e.target.value)}
                className={inputClass()}
              />
            )}
          </Field>
          <Field
            id={f('mod')}
            label={t('kbadm.art.f.mod')}
            hint={t('kbadm.art.mod_hint')}
            error={errors.mod}
          >
            {(c) => (
              <select
                {...c}
                value={form.mod}
                onChange={(e) => set('mod', e.target.value)}
                className={`${inputClass()} cursor-pointer`}
              >
                <option value="">{t('kbadm.art.mod_none')}</option>
                {MENU_MODULE_IDS.map((m) => (
                  <option key={m} value={m}>
                    {moduleLabel(t, m)}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field id={f('perm')} label={t('kbadm.art.f.perm')} error={errors.perm}>
            {(c) => (
              <select
                {...c}
                value={form.perm}
                onChange={(e) => set('perm', e.target.value)}
                className={`${inputClass()} cursor-pointer`}
              >
                <option value="">{t('kbadm.art.perm_all')}</option>
                {(meta?.permissions ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field id={f('aud')} label={t('kbadm.art.f.aud')} error={errors.aud}>
            {(c) => (
              <select
                {...c}
                value={form.aud}
                onChange={(e) => set('aud', e.target.value as KbArticleInput['aud'])}
                className={`${inputClass()} cursor-pointer`}
              >
                {KB_ARTICLE_AUDIENCES.map((a) => (
                  <option key={a} value={a}>
                    {t(`kbadm.art.aud.${a}`)}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field id={f('active')} label={t('kbadm.art.f.active')}>
            {(c) => (
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  {...c}
                  type="checkbox"
                  role="switch"
                  className={SWITCH_CLASS}
                  checked={form.active}
                  onChange={(e) => set('active', e.target.checked)}
                />
                {t('kbadm.art.active_hint')}
              </label>
            )}
          </Field>
          <Field
            id={f('html')}
            label={t('kbadm.art.f.html')}
            hint={t('kbadm.art.html_hint')}
            error={errors.html}
            full
          >
            {(c) => (
              <textarea
                {...c}
                value={form.html}
                onChange={(e) => set('html', e.target.value)}
                className={`${inputClass({ multiline: true })} min-h-[240px] text-[12.5px]`}
              />
            )}
          </Field>
        </FormGrid>
      </form>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={buttonClass('default', 'sm')}
          onClick={() => fileInput.current?.click()}
        >
          <Icon name="upload" size="sm" />
          {t('kbadm.art.image')}
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void addImage(file);
          }}
        />
        <button type="button" className={buttonClass('ghost', 'sm')} onClick={() => void preview()}>
          <Icon name="eye" size="sm" />
          {t('kbadm.art.preview')}
        </button>
      </div>
    </Modal>
  );
}

/** Описание экрана в предпросмотре: все вкладки модуля, переходов нет. */
function usePreviewInfo(): ArticleScreenInfo {
  const t = useT();
  return useMemo(
    () => ({
      moduleId: null,
      hrefOf: () => null,
      tabsOf: (module: string) =>
        isModuleId(module)
          ? (MODULES[module].tabs ?? []).map((x) => ({ id: x.id, label: t(x.label) }))
          : [],
      kbHref: '',
    }),
    [t],
  );
}

/** «Предпросмотр» статьи (прототип kbArtDlg): как в «Базе знаний», без отметки «прочитано». */
function KbArticlePreview({
  article,
  open,
  onClose,
}: {
  article: KbArticle;
  open: boolean;
  onClose: () => void;
}) {
  const t = useT();
  const info = usePreviewInfo();
  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="card"
      size="wide"
      title={article.title}
      sub={t('kb.art.sub', { section: article.section })}
      label={article.title}
    >
      <KbArticleBody article={article} info={info} />
    </Modal>
  );
}
