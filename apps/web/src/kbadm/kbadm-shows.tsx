'use client';

import {
  KB_ADMIN_COLUMNS,
  KB_ADMIN_SORT,
  KB_SHOW_AUTOS,
  kbShowWhat,
  type KbShowAuto,
  type UiTextKey,
} from '@buhuchet/domain';
import type { AdminKbRow, AdminKbShow, AdminKbShowUpdate } from '@buhuchet/shared';
import {
  buttonClass,
  CheckRow,
  DataGrid,
  EmptyState,
  Field,
  FormGrid,
  Hint,
  Icon,
  iconButtonClass,
  inputClass,
  Modal,
  Note,
  RecordChangedNotice,
  SWITCH_CLASS,
  Tag,
  useToast,
  type ActionEntry,
  type GridColumn,
} from '@buhuchet/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useId, useMemo, useState } from 'react';
import { ApiFailure, callApi } from '../api-client';
import { closeSlot, openSlot, type DialogSlot } from '../dialog-slot';
import { useErrorText, useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';
import { useListExport } from '../lists/export';
import { useGridLabels } from '../lists/grid-labels';
import { useListPage } from '../lists/use-list-page';
import { useViewSettings } from '../lists/view-settings';
import { useShell } from '../shell/context';
import { useKbAdmAdd } from './kbadm-add';
import { useKbAdmIo } from './kbadm-io';
import {
  fetchKbAdminRows,
  fetchKbAdminValues,
  kb,
  KBADM_AUDIT,
  KBADM_GRID,
  kbAdminMetaQuery,
  kbAdminShowQuery,
  refreshKbAdmin,
} from './kbadm-data';
import { KbAdmHistory } from './kbadm-history';

/** Ширины столбцов, px — как в прототипе (`kb-shows`). */
const WIDTHS: Readonly<Record<string, number>> = {
  g: 200,
  t: 330,
  type: 120,
  sc: 170,
  scr: 160,
  n: 100,
  doit: 180,
  active: 100,
};

const value = (x: AdminKbRow, key: string) => String(x.values[key] ?? '');

function showColumns(t: Translate): GridColumn<AdminKbRow>[] {
  return KB_ADMIN_COLUMNS.shows.map((c) => {
    const column: GridColumn<AdminKbRow> = {
      key: c.key,
      label: t(c.label),
      type: c.type,
      width: WIDTHS[c.key],
      text: (x) => value(x, c.key),
    };
    if (c.key === 't') {
      column.cell = (x) => <span className="truncate font-semibold">{value(x, 't')}</span>;
    }
    return column;
  });
}

const DEFAULT_VISIBLE = KB_ADMIN_COLUMNS.shows.filter((c) => !c.hidden).map((c) => c.key);

/** Подпись вида «Автоматически» (прототип `KB_AUTO`). */
const autoText = (t: Translate, auto: string) =>
  (KB_SHOW_AUTOS as readonly string[]).includes(auto)
    ? t(`kbadm.show.auto.${auto as KbShowAuto}`)
    : auto;

/** Облачко окна: номер прежнего облачка (`from`), что подсвечивает и тексты. */
interface Draft {
  key: number;
  from?: number;
  auto: string | null;
  txt: string | null;
  el: boolean;
  tab: string | null;
  t: string;
  x: string;
  common: boolean;
}

let draftKey = 0;

const draftsOf = (show: AdminKbShow): Draft[] =>
  show.items.map((p, i) => ({ ...p, key: ++draftKey, ...(show.own ? { from: i } : {}) }));

const newText = (): Draft => ({
  key: ++draftKey,
  auto: null,
  txt: null,
  el: false,
  tab: null,
  t: '',
  x: '',
  common: false,
});

const newAuto = (): Draft => ({ ...newText(), auto: 'screen' });

/** Облачко для «Сохранить»: прежнее — по номеру, новое — «Облачко с текстом» или «Все элементы экрана». */
function itemOf(p: Draft): AdminKbShowUpdate['items'][number] {
  const texts = { t: p.t, x: p.x, common: p.common };
  if (p.from !== undefined) return { from: p.from, ...(p.auto ? {} : texts) };
  return p.auto ? { auto: 'screen' } : texts;
}

type Preview = { show: AdminKbShow; items: Draft[] };

/**
 * Админка → «База знаний (содержимое)» → «Показы» (ТЗ; прототип admin/kb-content.js, renderKbAdm
 * `shows`): шаги программы организаций по порядку — свой сценарий «Показать как» или автоматический,
 * экран, число облачков, «Сделать сейчас», «Активен». Строка открывает окно сценария; меню —
 * «Изменить сценарий» / «Создать свой сценарий», «Предпросмотр», «Вернуть автоматический».
 * «+ Добавить» → «Показ для шага».
 */
export function KbAdmShowsTab() {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const client = useQueryClient();
  const labels = useGridLabels('kbadm.steps_count');
  const columns = useMemo(() => showColumns(t), [t]);
  const view = useViewSettings(KBADM_GRID.shows);
  const { search, clearSearch } = useShell();
  const fetchPage = useMemo(() => fetchKbAdminRows('shows'), []);
  const loadValues = useMemo(() => fetchKbAdminValues('shows'), []);
  const list = useListPage({
    gridKey: KBADM_GRID.shows,
    columns,
    defaultVisible: DEFAULT_VISIBLE,
    settings: view.settings,
    defaultSort: KB_ADMIN_SORT.shows,
    search,
    enabled: view.ready,
    fetchPage,
  });
  const { params, visible } = list;
  const sendExport = useCallback(
    () =>
      kb.list[':list'].export.$get({
        param: { list: 'shows' },
        query: { ...params, cols: visible.join(',') },
      }),
    [params, visible],
  );
  const exporter = useListExport(sendExport);
  const [dialog, setDialog] = useState<DialogSlot<AdminKbShow> | null>(null);
  const [preview, setPreview] = useState<DialogSlot<Preview> | null>(null);
  const [pick, setPick] = useState<DialogSlot<null> | null>(null);
  const meta = useQuery(kbAdminMetaQuery).data;

  const fetchShow = useCallback(
    async (id: string) => {
      try {
        return await client.fetchQuery(kbAdminShowQuery(id));
      } catch (e) {
        toast(errorText(e instanceof ApiFailure ? e.error : { code: 'network', message: '' }), {
          bad: true,
        });
        return null;
      }
    },
    [client, toast, errorText],
  );
  const edit = useCallback(
    async (id: string) => {
      const show = await fetchShow(id);
      if (show) setDialog(openSlot(show));
    },
    [fetchShow],
  );
  const showPreview = async (id: string) => {
    const show = await fetchShow(id);
    if (show) setPreview(openSlot({ show, items: draftsOf(show) }));
  };

  // «Показ для шага»: шаги без своего сценария (прототип kbShowPick).
  const free = useMemo(() => {
    const admin = new Set((meta?.groups ?? []).filter((g) => g.adm).map((g) => g.id));
    return (meta?.steps ?? []).filter(
      (s) => !admin.has(s.g) && !Object.hasOwn(meta?.shows ?? {}, s.id),
    );
  }, [meta]);
  useKbAdmAdd('show', () => {
    if (meta && !free.length) return toast(t('kbadm.show.pick.none'));
    setPick(openSlot(null));
  });
  const io = useKbAdmIo('kbshows');

  const auto = async (x: AdminKbRow) => {
    const res = await callApi(() =>
      kb.shows[':id'].$delete({ param: { id: x.id }, query: { version: String(x.version) } }),
    );
    refreshKbAdmin(client);
    if (!res.ok) toast(errorText(res.error), { bad: true });
  };

  const actions = (x: AdminKbRow): ActionEntry[] => [
    {
      id: 'edit',
      label: t(x.own ? 'kbadm.act.show_edit' : 'kbadm.act.show_new'),
      icon: 'edit',
      run: () => void edit(x.id),
    },
    {
      id: 'preview',
      label: t('kbadm.act.preview'),
      icon: 'eye',
      run: () => void showPreview(x.id),
    },
    ...(x.own
      ? ([
          { id: 'sep', separator: true },
          {
            id: 'auto',
            label: t('kbadm.act.show_auto'),
            icon: 'refresh',
            sub: t('kbadm.act.show_auto.sub'),
            run: () => void auto(x),
          },
        ] satisfies ActionEntry[])
      : []),
  ];

  return (
    <div className="flex flex-col gap-3.5">
      <Note icon="info">{t('kbadm.shows.note')}</Note>
      {io.bar}
      <DataGrid
        columns={columns}
        audit={KBADM_AUDIT}
        defaultVisible={DEFAULT_VISIBLE}
        defaultSort={KB_ADMIN_SORT.shows}
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
        empty={<EmptyState icon="list" title={t('grid.empty')} />}
        rowKey={(x) => x.id}
        titleKey="t"
        label={t('tab.kbadm.shows')}
        labels={labels}
        actions={actions}
        onOpen={(x) => void edit(x.id)}
      />
      <KbAdmHistory section="kbshows" />
      {io.dialogs}
      {pick ? (
        <ShowPickDialog
          key={`pick-${pick.n}`}
          open={pick.open}
          steps={free}
          groups={meta?.groups ?? []}
          onClose={() => setPick(closeSlot)}
          onPick={(id) => {
            setPick(closeSlot);
            void edit(id);
          }}
        />
      ) : null}
      {dialog ? (
        <KbShowDialog
          key={`show-${dialog.n}`}
          show={dialog.data}
          open={dialog.open}
          onClose={() => setDialog(closeSlot)}
          onSaved={() => refreshKbAdmin(client)}
          onPreview={(p) => setPreview(openSlot(p))}
        />
      ) : null}
      {preview ? (
        <KbShowPreview
          key={`prev-${preview.n}`}
          open={preview.open}
          show={preview.data.show}
          items={preview.data.items}
          onClose={() => setPreview(closeSlot)}
        />
      ) : null}
    </div>
  );
}

/** Окно «Свой сценарий показа» (прототип kbShowPick): шаг без своего сценария → «Далее». */
function ShowPickDialog({
  open,
  steps,
  groups,
  onClose,
  onPick,
}: {
  open: boolean;
  steps: { id: string; g: string; t: string }[];
  groups: { id: string; t: string }[];
  onClose: () => void;
  onPick: (id: string) => void;
}) {
  const t = useT();
  const id = useId();
  const [step, setStep] = useState(steps[0]?.id ?? '');
  const group = (g: string) => groups.find((x) => x.id === g)?.t ?? g;
  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="form"
      size="mid"
      title={t('kbadm.show.pick.title')}
      footer={
        <>
          <button type="button" className={buttonClass('ghost')} onClick={onClose}>
            {t('btn.cancel')}
          </button>
          <button
            type="button"
            className={buttonClass('cta')}
            disabled={!step}
            onClick={() => onPick(step)}
          >
            {t('kbadm.show.pick.next')}
          </button>
        </>
      }
    >
      <FormGrid>
        <Field id={`${id}-s`} label={t('kbadm.show.pick.step')} required full>
          {(c) => (
            <select
              {...c}
              value={step}
              onChange={(e) => setStep(e.target.value)}
              className={`${inputClass()} cursor-pointer`}
            >
              {steps.map((s) => (
                <option key={s.id} value={s.id}>
                  {`${group(s.g)} · ${s.t}`}
                </option>
              ))}
            </select>
          )}
        </Field>
      </FormGrid>
    </Modal>
  );
}

/**
 * Окно «Сценарий показа» (прототип kbShowDlg): «Активен», облачки по порядку — «Выше», «Удалить»; у
 * облачка «Автоматически» — только пояснение, у остальных — заголовок, текст и «Общий элемент»;
 * «Облачко с текстом», «Все элементы экрана», «Предпросмотр». Что подсвечивает облачко, задаёт
 * разработчик: сервер сохраняет это по номеру прежнего облачка.
 */
function KbShowDialog({
  show,
  open,
  onClose,
  onSaved,
  onPreview,
}: {
  show: AdminKbShow;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  onPreview: (p: Preview) => void;
}) {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const client = useQueryClient();
  const id = useId();
  const [base, setBase] = useState(show);
  const [active, setActive] = useState(show.active);
  const [items, setItems] = useState<Draft[]>(() => draftsOf(show));
  const [initial, setInitial] = useState(() => JSON.stringify(items.map(itemOf)));
  const [changed, setChanged] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [saving, setSaving] = useState(false);
  const dirty = active !== base.active || JSON.stringify(items.map(itemOf)) !== initial;
  const edit = (key: number, patch: Partial<Draft>) =>
    setItems((list) => list.map((p) => (p.key === key ? { ...p, ...patch } : p)));
  const up = (k: number) =>
    setItems((list) => list.map((p, i) => (i === k - 1 ? list[k]! : i === k ? list[k - 1]! : p)));

  const reload = async () => {
    setReloading(true);
    const fresh = await client.fetchQuery(kbAdminShowQuery(base.step.id)).catch(() => null);
    setReloading(false);
    if (!fresh) return toast(t('err.unknown'), { bad: true });
    const next = draftsOf(fresh);
    setBase(fresh);
    setActive(fresh.active);
    setItems(next);
    setInitial(JSON.stringify(next.map(itemOf)));
    setChanged(false);
  };

  const save = async () => {
    if (items.some((p) => !p.auto && !p.t.trim())) {
      return toast(t('kbadm.err.kb_show_title'), { bad: true });
    }
    if (base.own && !dirty) return onClose();
    setSaving(true);
    const res = await callApi(() =>
      kb.shows[':id'].$put({
        param: { id: base.step.id },
        json: { active, items: items.map(itemOf), version: base.version },
      }),
    );
    setSaving(false);
    if (res.ok) {
      onSaved();
      onClose();
      return toast(t('kbadm.show.saved'), { icon: 'check' });
    }
    if (res.error.code === 'record_changed') return setChanged(true);
    if (res.error.code.startsWith('kb_show')) {
      return toast(t(`kbadm.err.${res.error.code}` as UiTextKey), { bad: true });
    }
    toast(errorText(res.error), { bad: true });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="form"
      size="wide"
      title={t('kbadm.show.title')}
      sub={base.step.t}
      dirty={dirty}
      footer={
        <>
          <button type="button" className={buttonClass('ghost')} onClick={onClose}>
            {t('btn.cancel')}
          </button>
          <button
            type="button"
            className={buttonClass('cta')}
            disabled={saving || changed}
            onClick={() => void save()}
          >
            {t('btn.save')}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {changed ? (
          <RecordChangedNotice
            message={t('err.record_changed')}
            reloadLabel={t('form.reload')}
            onReload={() => void reload()}
            reloading={reloading}
          />
        ) : null}
        <Note icon="info">{t('kbadm.show.note')}</Note>
        <FormGrid>
          <Field id={`${id}-act`} label={t('kbadm.show.f.active')}>
            {(c) => (
              <label className="flex cursor-pointer flex-wrap items-center gap-2 text-[12px] font-semibold tracking-[.01em] text-muted">
                <input
                  {...c}
                  type="checkbox"
                  role="switch"
                  className={SWITCH_CLASS}
                  checked={active}
                  onChange={(e) => setActive(e.target.checked)}
                />
                {t('kbadm.show.active_hint')}
              </label>
            )}
          </Field>
        </FormGrid>
        <ol className="m-0 flex list-none flex-col gap-2.5 p-0" data-show-items="">
          {items.map((p, k) => (
            <li
              key={p.key}
              data-show-item={k + 1}
              className="flex min-w-0 flex-col gap-2.5 rounded-xl border border-line bg-raised px-4 py-3.5"
            >
              <div className="flex items-center gap-2">
                <b className="min-w-0 grow text-[13.5px]">
                  {t('kbadm.show.item', {
                    n: k + 1,
                    what: kbShowWhat({ ...p, s: p.el ? 'el' : null }, t),
                  })}
                </b>
                <button
                  type="button"
                  className={iconButtonClass('sm')}
                  disabled={k === 0}
                  aria-label={t('kbadm.show.up')}
                  title={t('kbadm.show.up')}
                  onClick={() => up(k)}
                >
                  <Icon name="up" size="sm" />
                </button>
                <button
                  type="button"
                  className={iconButtonClass('sm')}
                  aria-label={t('kbadm.show.delete')}
                  title={t('kbadm.show.delete')}
                  onClick={() => setItems((list) => list.filter((x) => x.key !== p.key))}
                >
                  <Icon name="trash" size="sm" />
                </button>
              </div>
              {p.auto ? (
                <span className="text-[11.5px] leading-[1.4] text-faint">
                  {t('kbadm.show.auto_hint')}
                </span>
              ) : (
                <>
                  <Field id={`${id}-t${p.key}`} label={t('kbadm.show.f.t')} full>
                    {(c) => (
                      <input
                        {...c}
                        value={p.t}
                        onChange={(e) => edit(p.key, { t: e.target.value })}
                        className={inputClass()}
                      />
                    )}
                  </Field>
                  <Field id={`${id}-x${p.key}`} label={t('kbadm.show.f.x')} full>
                    {(c) => (
                      <textarea
                        {...c}
                        value={p.x}
                        onChange={(e) => edit(p.key, { x: e.target.value })}
                        className={`${inputClass({ multiline: true })} min-h-[60px]`}
                      />
                    )}
                  </Field>
                  <CheckRow
                    kind="check"
                    compact
                    checked={p.common}
                    onChange={(common) => edit(p.key, { common })}
                    label={<b>{t('kbadm.show.f.common')}</b>}
                  >
                    <Hint>{t('kbadm.show.common_hint')}</Hint>
                  </CheckRow>
                </>
              )}
            </li>
          ))}
        </ol>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={buttonClass('default', 'sm')}
            onClick={() => setItems((list) => [...list, newText()])}
          >
            <Icon name="plus" size="sm" />
            {t('kbadm.show.add_text')}
          </button>
          <button
            type="button"
            className={buttonClass('default', 'sm')}
            onClick={() => setItems((list) => [...list, newAuto()])}
          >
            <Icon name="plus" size="sm" />
            {t('kbadm.show.add_auto')}
          </button>
          <div className="grow" />
          <button
            type="button"
            className={buttonClass('ghost', 'sm')}
            onClick={() => onPreview({ show: base, items })}
          >
            <Icon name="eye" size="sm" />
            {t('kbadm.act.preview')}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * «Предпросмотр показа» (прототип kbShowPrev): облачки по порядку — название шага и «Зачем это
 * нужно», облачки сценария («Автоматически» — что раскроется), «Готово» или «Сделать сейчас». Сам
 * показ идёт на экране организации.
 */
function KbShowPreview({
  open,
  show,
  items,
  onClose,
}: {
  open: boolean;
  show: AdminKbShow;
  items: Draft[];
  onClose: () => void;
}) {
  const t = useT();
  const list = [
    { key: 'intro', t: show.step.t, x: show.step.w, auto: false, common: false },
    ...items.map((p) =>
      p.auto
        ? {
            key: p.key,
            t: t('kbadm.show.prev.auto'),
            x: autoText(t, p.auto),
            auto: true,
            common: false,
          }
        : { key: p.key, t: p.t, x: p.x, auto: false, common: p.common },
    ),
    { key: 'fin', t: show.fin.t, x: show.fin.x, auto: false, common: false },
  ];
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="mid"
      title={t('kbadm.show.prev.title')}
      sub={show.step.t}
      footer={
        <button type="button" className={buttonClass('cta')} onClick={onClose}>
          {t('btn.close')}
        </button>
      }
    >
      <div className="flex flex-col gap-3">
        <ol
          className="m-0 flex list-decimal flex-col gap-2.5 pl-5 text-[13.5px]"
          data-show-preview=""
        >
          {list.map((p) => (
            <li key={p.key}>
              <b>{p.t}</b>
              {p.auto ? (
                <>
                  {' '}
                  <Tag>{t('kbadm.show.prev.tag_auto')}</Tag>
                </>
              ) : null}
              {p.common ? (
                <>
                  {' '}
                  <Tag>{t('kbadm.show.prev.tag_common')}</Tag>
                </>
              ) : null}
              <p className="m-0 mt-0.5 text-muted">{p.x}</p>
            </li>
          ))}
        </ol>
        <p className="m-0 text-[11.5px] leading-[1.4] text-faint">{t('kbadm.show.prev.hint')}</p>
      </div>
    </Modal>
  );
}
