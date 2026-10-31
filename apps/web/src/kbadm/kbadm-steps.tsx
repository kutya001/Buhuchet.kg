'use client';

import {
  FEATURES,
  KB_ADMIN_COLUMNS,
  KB_ADMIN_SORT,
  KB_EVENTS,
  KB_MODULE_TITLES,
  KB_STEP_RULES,
  kbEventWorks,
  kbStepProblems,
  MENU_MODULE_IDS,
  pluralForm,
  type KbEvent,
  type KbStepField,
  type KbStepInput,
  type UiTextKey,
} from '@buhuchet/domain';
import type { AdminKbMeta, AdminKbRow, AdminKbStep } from '@buhuchet/shared';
import {
  buttonClass,
  DataGrid,
  EmptyState,
  Field,
  FormGrid,
  inputClass,
  Modal,
  MONO_CLASS,
  Note,
  pillClass,
  RecordChangedNotice,
  SWITCH_CLASS,
  useToast,
  type ActionEntry,
  type GridColumn,
} from '@buhuchet/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useId, useMemo, useState, type FormEvent } from 'react';
import { ApiFailure, callApi } from '../api-client';
import { closeSlot, openSlot, type DialogSlot } from '../dialog-slot';
import { KB_GO } from '../kb/kb-go';
import { useErrorText, useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';
import { useListExport } from '../lists/export';
import { useGridLabels } from '../lists/grid-labels';
import { useListPage } from '../lists/use-list-page';
import { useViewSettings } from '../lists/view-settings';
import { useShell } from '../shell/context';
import { MODULES } from '../shell/modules';
import { KbAdmHistory } from './kbadm-history';
import {
  fetchKbAdminRows,
  fetchKbAdminValues,
  kb,
  KBADM_GRID,
  kbAdminMetaQuery,
  kbAdminStepQuery,
  refreshKbAdmin,
} from './kbadm-data';
import { useKbAdmAdd } from './kbadm-add';

/** Ширины столбцов, px — как в прототипе (`kb-steps`). */
const WIDTHS: Readonly<Record<string, number>> = {
  n: 76,
  id: 90,
  prog: 190,
  g: 200,
  t: 330,
  type: 120,
  star: 100,
  perm: 240,
  feat: 200,
  evk: 230,
  active: 100,
};

const value = (x: AdminKbRow, key: string) => String(x.values[key] ?? '');

function stepColumns(t: Translate): GridColumn<AdminKbRow>[] {
  return KB_ADMIN_COLUMNS.steps.map((c) => {
    const column: GridColumn<AdminKbRow> = {
      key: c.key,
      label: t(c.label),
      type: c.type,
      width: WIDTHS[c.key],
      text: (x) => value(x, c.key),
    };
    if (c.key === 'id') column.className = MONO_CLASS;
    // Название: «★» у основного, жирным, «Новое» у добавленного (прототип).
    if (c.key === 't') {
      column.cell = (x) => (
        <span className="inline-flex min-w-0 items-center gap-1">
          {x.star ? <span className="flex-none font-bold text-warn-label">★</span> : null}
          <span className="truncate font-semibold">{value(x, 't')}</span>
          {x.isNew ? (
            <span className={`${pillClass('sm')} flex-none bg-info-bg text-info`}>
              {t('kbadm.v.new')}
            </span>
          ) : null}
        </span>
      );
    }
    return column;
  });
}

const DEFAULT_VISIBLE = KB_ADMIN_COLUMNS.steps.filter((c) => !c.hidden).map((c) => c.key);

/**
 * Админка → «База знаний (содержимое)» → «Шаги уроков» (ТЗ; прототип admin/kb-content.js,
 * renderKbAdm): шаги программ организаций и программы администраторов платформы по порядку, «№» —
 * место в программе. Строка открывает окно шага; меню — «Изменить», «Выше», «Ниже», «Выключить» или
 * «Включить»; выключенные — приглушённо. «+ Добавить» → «Шаг урока».
 */
export function KbAdmStepsTab() {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const client = useQueryClient();
  const labels = useGridLabels('kbadm.steps_count');
  const columns = useMemo(() => stepColumns(t), [t]);
  const view = useViewSettings(KBADM_GRID.steps);
  const { search, clearSearch } = useShell();
  const fetchPage = useMemo(() => fetchKbAdminRows('steps'), []);
  const loadValues = useMemo(() => fetchKbAdminValues('steps'), []);
  const list = useListPage({
    gridKey: KBADM_GRID.steps,
    columns,
    defaultVisible: DEFAULT_VISIBLE,
    settings: view.settings,
    defaultSort: KB_ADMIN_SORT.steps,
    search,
    enabled: view.ready,
    fetchPage,
  });
  const { params, visible } = list;
  const sendExport = useCallback(
    () =>
      kb.list[':list'].export.$get({
        param: { list: 'steps' },
        query: { ...params, cols: visible.join(',') },
      }),
    [params, visible],
  );
  const exporter = useListExport(sendExport);
  const [dialog, setDialog] = useState<DialogSlot<AdminKbStep | null> | null>(null);

  const edit = useCallback(
    async (x: AdminKbRow) => {
      try {
        setDialog(openSlot<AdminKbStep | null>(await client.fetchQuery(kbAdminStepQuery(x.id))));
      } catch (e) {
        toast(errorText(e instanceof ApiFailure ? e.error : { code: 'network', message: '' }), {
          bad: true,
        });
      }
    },
    [client, toast, errorText],
  );
  useKbAdmAdd('step', () => setDialog(openSlot<AdminKbStep | null>(null)));

  const act = async (
    send: () => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>,
  ) => {
    const res = await callApi(send);
    refreshKbAdmin(client);
    if (!res.ok) toast(errorText(res.error), { bad: true });
  };
  const move = (x: AdminKbRow, dir: 'up' | 'down') =>
    void act(() =>
      kb.steps[':id'].move.$post({ param: { id: x.id }, json: { dir, version: x.version } }),
    );
  const setActive = (x: AdminKbRow, active: boolean) =>
    void act(() =>
      kb.steps[':id'].active.$post({ param: { id: x.id }, json: { active, version: x.version } }),
    );

  const actions = (x: AdminKbRow): ActionEntry[] => [
    { id: 'edit', label: t('kbadm.act.edit'), icon: 'edit', run: () => void edit(x) },
    {
      id: 'up',
      label: t('kbadm.act.up'),
      icon: 'up',
      disabled: !x.canUp,
      run: () => move(x, 'up'),
    },
    {
      id: 'down',
      label: t('kbadm.act.down'),
      icon: 'dn',
      disabled: !x.canDown,
      run: () => move(x, 'down'),
    },
    { id: 'sep', separator: true },
    x.active
      ? {
          id: 'off',
          label: t('kbadm.act.step_off'),
          icon: 'ban',
          sub: t('kbadm.act.step_off.sub'),
          run: () => setActive(x, false),
        }
      : { id: 'on', label: t('kbadm.act.on'), icon: 'check', run: () => setActive(x, true) },
  ];

  return (
    <div className="flex flex-col gap-3.5">
      <Note icon="info">{t('kbadm.steps.note')}</Note>
      <DataGrid
        columns={columns}
        defaultVisible={DEFAULT_VISIBLE}
        defaultSort={KB_ADMIN_SORT.steps}
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
        rowTone={(x) => (x.active ? undefined : 'muted')}
        label={t('tab.kbadm.steps')}
        labels={labels}
        actions={actions}
        onOpen={(x) => void edit(x)}
      />
      <KbAdmHistory section="kbsteps" />
      {dialog ? (
        <KbStepDialog
          key={dialog.n}
          step={dialog.data}
          open={dialog.open}
          onClose={() => setDialog(closeSlot)}
          onSaved={() => refreshKbAdmin(client)}
        />
      ) : null}
    </div>
  );
}

const inputOf = (s: AdminKbStep | null): KbStepInput => ({
  g: s?.g ?? 'org',
  t: s?.t ?? '',
  w: s?.w ?? '',
  learn: s ? s.learn : true,
  art: s?.art ?? '',
  star: s?.star ?? false,
  perm: s?.perm ?? '',
  featk: s?.featk ?? '',
  evk: s?.evk ?? 'open',
  active: s?.active ?? true,
  mod: s?.mod ?? 'org',
});

/** Подпись модуля меню. */
const moduleLabel = (t: Translate, id: string | null) =>
  id && Object.hasOwn(KB_MODULE_TITLES, id)
    ? t(KB_MODULE_TITLES[id as keyof typeof KB_MODULE_TITLES])
    : '';

/** «Место для «Перейти»» шага: модуль и вкладка (прототип: `kbModT(kbMod(i)) → go.tab`). */
function placeText(t: Translate, step: AdminKbStep): string {
  const module = moduleLabel(t, step.module);
  const go = Object.hasOwn(KB_GO, step.id) ? KB_GO[step.id] : undefined;
  const mod = go?.module ?? null;
  const tab = go?.tab && mod ? MODULES[mod].tabs?.find((x) => x.id === go.tab) : undefined;
  if (!module) return '—';
  return tab ? `${module} → ${t(tab.label)}` : module;
}

/**
 * Окно «Шаг урока» (прототип kbStepDlg): модуль программы, вид шага, название, «зачем это нужно»,
 * статья, «★», право, функция, условие отметки, место для «Перейти» (только у нового), показ и
 * «Активен». Условие — из событий, которые уже работают (у шага разработчика — любое из списка).
 * Проверка — та же, что на сервере (`kbStepProblems`).
 */
function KbStepDialog({
  step,
  open,
  onClose,
  onSaved,
}: {
  step: AdminKbStep | null;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const id = useId();
  const meta = useQuery(kbAdminMetaQuery).data;
  const isNew = step === null;
  const [base, setBase] = useState(step);
  const [form, setForm] = useState<KbStepInput>(() => inputOf(step));
  const [errors, setErrors] = useState<Partial<Record<KbStepField, string>>>({});
  const [changed, setChanged] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [saving, setSaving] = useState(false);
  const client = useQueryClient();
  const set = <K extends keyof KbStepInput>(key: K, v: KbStepInput[K]) =>
    setForm((f) => ({ ...f, [key]: v }));
  const dirty = JSON.stringify(form) !== JSON.stringify(inputOf(base));
  const own = !isNew && Object.hasOwn(KB_STEP_RULES, step.id);
  // ОТКЛОНЕНИЕ: docs/deviations.md#Д-25
  const events = KB_EVENTS.filter((e) => e === form.evk || kbEventWorks(e, own));

  const reload = async () => {
    if (!base) return;
    setReloading(true);
    const fresh = await client.fetchQuery(kbAdminStepQuery(base.id)).catch(() => null);
    setReloading(false);
    if (!fresh) return toast(t('err.unknown'), { bad: true });
    setBase(fresh);
    setForm(inputOf(fresh));
    setChanged(false);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!meta) return;
    const problems = kbStepProblems(form, {
      groups: new Set(meta.groups.map((g) => g.id)),
      articles: new Set(meta.articles.map((a) => a.id)),
      isNew,
    });
    const shown = Object.fromEntries(
      Object.entries(problems).map(([k, p]) => [k, t(`kbadm.err.${p}`)]),
    );
    setErrors(shown);
    if (Object.keys(shown).length) return;
    if (!isNew && !dirty) return onClose();
    setSaving(true);
    const { mod, ...fields } = form;
    const res = await callApi(() =>
      base
        ? kb.steps[':id'].$put({
            param: { id: base.id },
            json: { ...fields, version: base.version },
          })
        : kb.steps.$post({ json: { ...fields, mod: mod ?? '' } }),
    );
    setSaving(false);
    if (res.ok) {
      onSaved();
      onClose();
      return toast(t(isNew ? 'kbadm.step.added' : 'kbadm.step.saved'), { icon: 'check' });
    }
    if (res.error.code === 'record_changed') return setChanged(true);
    const field = (res.error.details as { field?: KbStepField } | undefined)?.field;
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
      size="mid"
      title={t(isNew ? 'kbadm.step.title_new' : 'kbadm.step.title')}
      sub={isNew ? t('kbadm.step.sub_new') : base?.t}
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
            disabled={saving || changed || !meta}
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
          <Field id={f('g')} label={t('kbadm.step.f.g')} required error={errors.g}>
            {(c) => (
              <select
                {...c}
                value={form.g}
                onChange={(e) => set('g', e.target.value)}
                className={`${inputClass()} cursor-pointer`}
              >
                {(meta?.groups ?? []).map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.adm ? t('kbadm.step.adm_group', { name: g.t }) : g.t}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field id={f('type')} label={t('kbadm.step.f.type')} hint={t('kbadm.step.type_hint')}>
            {(c) => (
              <select
                {...c}
                value={form.learn ? '1' : '0'}
                onChange={(e) => set('learn', e.target.value === '1')}
                className={`${inputClass()} cursor-pointer`}
              >
                <option value="0">{t('kbadm.step.type.do')}</option>
                <option value="1">{t('kbadm.step.type.look')}</option>
              </select>
            )}
          </Field>
          <Field id={f('t')} label={t('kbadm.step.f.t')} required error={errors.t} full>
            {(c) => (
              <input
                {...c}
                value={form.t}
                onChange={(e) => set('t', e.target.value)}
                className={inputClass()}
              />
            )}
          </Field>
          <Field id={f('w')} label={t('kbadm.step.f.w')} error={errors.w} full>
            {(c) => (
              <input
                {...c}
                value={form.w}
                onChange={(e) => set('w', e.target.value)}
                className={inputClass()}
              />
            )}
          </Field>
          <Field id={f('art')} label={t('kbadm.step.f.art')} error={errors.art}>
            {(c) => (
              <select
                {...c}
                value={form.art}
                onChange={(e) => set('art', e.target.value)}
                className={`${inputClass()} cursor-pointer`}
              >
                <option value="">{t('kbadm.step.art_module')}</option>
                {(meta?.articles ?? []).map((a) => (
                  <option key={a.id} value={a.id}>
                    {`${a.sec} · ${a.t}`}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field id={f('star')} label={t('kbadm.step.f.star')}>
            {(c) => (
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  {...c}
                  type="checkbox"
                  role="switch"
                  className={SWITCH_CLASS}
                  checked={form.star}
                  onChange={(e) => set('star', e.target.checked)}
                />
                {t('kbadm.step.star_hint')}
              </label>
            )}
          </Field>
          <Field
            id={f('perm')}
            label={t('kbadm.step.f.perm')}
            hint={t('kbadm.step.perm_hint')}
            error={errors.perm}
          >
            {(c) => (
              <select
                {...c}
                value={form.perm}
                onChange={(e) => set('perm', e.target.value)}
                className={`${inputClass()} cursor-pointer`}
              >
                <option value="">{t('kbadm.step.perm_view')}</option>
                {(meta?.permissions ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field
            id={f('feat')}
            label={t('kbadm.step.f.feat')}
            hint={t('kbadm.step.feat_hint')}
            error={errors.featk}
          >
            {(c) => (
              <select
                {...c}
                value={form.featk}
                onChange={(e) => set('featk', e.target.value)}
                className={`${inputClass()} cursor-pointer`}
              >
                <option value="">{t('kbadm.v.none')}</option>
                {FEATURES.map((x) => (
                  <option key={x} value={x}>
                    {t(`org.feature.${x}`)}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field
            id={f('evk')}
            label={t('kbadm.step.f.evk')}
            hint={t('kbadm.step.evk_hint')}
            error={errors.evk}
          >
            {(c) => (
              <select
                {...c}
                value={form.evk}
                onChange={(e) => set('evk', e.target.value)}
                className={`${inputClass()} cursor-pointer`}
              >
                {events.map((e: KbEvent) => (
                  <option key={e} value={e}>
                    {t(`kbadm.ev.${e}`)}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field id={f('mod')} label={t('kbadm.step.f.mod')} error={errors.mod}>
            {(c) =>
              isNew ? (
                <select
                  {...c}
                  value={form.mod}
                  onChange={(e) => set('mod', e.target.value)}
                  className={`${inputClass()} cursor-pointer`}
                >
                  {MENU_MODULE_IDS.map((m) => (
                    <option key={m} value={m}>
                      {moduleLabel(t, m)}
                    </option>
                  ))}
                </select>
              ) : (
                <span id={c.id} className="py-[7px] text-[13.5px]">
                  {placeText(t, step)}
                </span>
              )
            }
          </Field>
          <Field id={f('how')} label={t('kbadm.step.f.how')} full>
            {(c) => (
              <span id={c.id} className="text-[13.5px]">
                {showText(t, meta, step)}
              </span>
            )}
          </Field>
          <Field id={f('active')} label={t('kbadm.step.f.active')}>
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
                {t('kbadm.step.active_hint')}
              </label>
            )}
          </Field>
        </FormGrid>
      </form>
    </Modal>
  );
}

/** «Показ «Показать как»» (прототип): свой сценарий с числом облачков или автоматический. */
function showText(t: Translate, meta: AdminKbMeta | undefined, step: AdminKbStep | null): string {
  const n = step && meta && Object.hasOwn(meta.shows, step.id) ? meta.shows[step.id] : undefined;
  return n === undefined
    ? t('kbadm.step.how_auto')
    : t(`kbadm.step.how_own.${pluralForm(n)}`, { n });
}
