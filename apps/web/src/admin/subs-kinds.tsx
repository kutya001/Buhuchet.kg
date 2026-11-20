'use client';

import {
  formatSom,
  subscriptionPerksOf,
  subscriptionPlanProblems,
  type ListSort,
  type SubscriptionPlanProblem,
} from '@buhuchet/domain';
import { AdminSubscriptionPlans, type AdminSubscriptionPlan } from '@buhuchet/shared';
import {
  Box,
  buttonClass,
  CHECKBOX_CLASS,
  ConfirmDialog,
  DataGrid,
  EmptyState,
  Field,
  FormGrid,
  Icon,
  inputClass,
  Modal,
  Note,
  Pill,
  RecordChangedNotice,
  Timeline,
  useToast,
  type ActionEntry,
  type GridColumn,
} from '@buhuchet/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useId, useMemo, useState, type FormEvent } from 'react';
import type { ApiResult } from '../api-client';
import { closeSlot, openSlot, type DialogSlot } from '../dialog-slot';
import { useErrorText, useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';
import { useGridLabels } from '../lists/grid-labels';
import { useListPage, type FetchListPage } from '../lists/use-list-page';
import { useViewSettings } from '../lists/view-settings';
import { useShell } from '../shell/context';
import {
  createSubPlan,
  deleteSubPlan,
  subPlansQuery,
  subSettingsQuery,
  updateSubPlan,
  useSubsRefresh,
} from './subs-data';
import { localGridPage, subConfigItems, subPlanPrice, type LocalColumn } from './subs-model';

/*
 * «Виды подписок» вкладки «Подписки» (доработки 20.11.2026, блок 6, пункт 5; прототип `subKindsPart`,
 * `subKindDlg`): пояснение, «Вид подписки», список видов, «История изменений» видов и цен. Вид с
 * подписками или оплатами не удаляется — только выключается.
 */

type Plan = AdminSubscriptionPlan;
type Failure = Extract<ApiResult<unknown>, { ok: false }>['error'];

const GRID_KEY = 'orgs.subkinds';
const DEFAULT_SORT: ListSort = { key: 'order', dir: 'asc' };
const DEFAULT_VISIBLE = ['order', 'name', 'months', 'disc', 'price', 'perks', 'used', 'active'];

/** Цена за контрагента в месяц, пока не пришли «Цены и реквизиты» (прототип `SUB_P().cp`), тыйыны. */
const SEAT_PRICE = 10_000;

const yes = (t: Translate, on: boolean) => t(on ? 'subs.kinds.yes' : 'subs.kinds.no');

function kindColumns(t: Translate, seatPrice: number): GridColumn<Plan>[] {
  return [
    {
      key: 'order',
      label: t('subs.kinds.col.order'),
      type: 'int',
      width: 90,
      numeric: true,
      text: (k) => String(k.sortOrder),
    },
    {
      key: 'name',
      label: t('subs.kinds.col.name'),
      type: 'text',
      width: 160,
      text: (k) => k.name,
      cell: (k) => <span className="font-semibold">{k.name}</span>,
    },
    {
      key: 'months',
      label: t('subs.kinds.col.months'),
      type: 'int',
      width: 100,
      numeric: true,
      text: (k) => String(k.months),
    },
    {
      key: 'disc',
      label: t('subs.kinds.col.disc'),
      type: 'int',
      width: 100,
      numeric: true,
      text: (k) => String(k.discountPct),
    },
    {
      key: 'price',
      label: t('subs.kinds.col.price'),
      type: 'money',
      width: 150,
      numeric: true,
      text: (k) => formatSom(subPlanPrice(seatPrice, k.discountPct)),
    },
    {
      key: 'perks',
      label: t('subs.kinds.col.perks'),
      type: 'text',
      width: 320,
      text: (k) => k.perks.join('; '),
    },
    {
      key: 'used',
      label: t('subs.kinds.col.used'),
      type: 'int',
      width: 100,
      numeric: true,
      text: (k) => String(k.subs),
    },
    {
      key: 'active',
      label: t('subs.kinds.col.active'),
      type: 'enum',
      width: 120,
      text: (k) => yes(t, k.active),
      cell: (k) =>
        k.active ? (
          <Pill tone="ok" icon="check" size="sm">
            {yes(t, true)}
          </Pill>
        ) : (
          <Pill tone="plain" icon="ban" size="sm">
            {yes(t, false)}
          </Pill>
        ),
    },
  ];
}

/** Числа сортируются как числа (прототип: `type:'int'` у столбцов вида). */
const kindSortValue = (seatPrice: number): Record<string, (k: Plan) => number> => ({
  order: (k) => k.sortOrder,
  months: (k) => k.months,
  disc: (k) => k.discountPct,
  price: (k) => subPlanPrice(seatPrice, k.discountPct),
  used: (k) => k.subs,
});

/** Тело записи вида: преимущества — строками окна. */
const planBody = (k: Plan, active = k.active) => ({
  name: k.name,
  months: k.months,
  discountPct: k.discountPct,
  perks: k.perks.join('\n'),
  sortOrder: k.sortOrder,
  active,
});

export function SubsKinds() {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const client = useQueryClient();
  const refresh = useSubsRefresh();
  const plans = useQuery(subPlansQuery);
  const cfg = useQuery(subSettingsQuery);
  const seatPrice = cfg.data?.seatPrice ?? SEAT_PRICE;
  const columns = useMemo(() => kindColumns(t, seatPrice), [t, seatPrice]);
  const local = useMemo<LocalColumn<Plan>[]>(() => {
    const sortValue = kindSortValue(seatPrice);
    return columns.map((c) => ({ key: c.key, text: c.text, sortValue: sortValue[c.key] }));
  }, [columns, seatPrice]);
  const labels = useGridLabels('subs.kinds.count');
  const view = useViewSettings(GRID_KEY);
  const { search, clearSearch } = useShell();
  // Видов несколько: все приходят одним ответом, страницу собирает браузер. Ответ «Виды подписок»
  // перечитывается после правки (`useSubsRefresh`) — список берёт его оттуда.
  const fetchPage = useCallback<FetchListPage<Plan>>(
    async (params) => {
      const data = await client.fetchQuery({ ...subPlansQuery, staleTime: Infinity });
      return localGridPage(data.plans, params, local);
    },
    [client, local],
  );
  const list = useListPage({
    gridKey: GRID_KEY,
    columns,
    audit: false,
    defaultVisible: DEFAULT_VISIBLE,
    settings: view.settings,
    defaultSort: DEFAULT_SORT,
    search,
    enabled: view.ready,
    fetchPage,
  });

  const [kind, setKind] = useState<DialogSlot<Plan | null> | null>(null);
  const [del, setDel] = useState<DialogSlot<Plan> | null>(null);
  const all = plans.data?.plans ?? [];

  /**
   * Ответ правки — все виды и история: сразу в кэш, затем перечитать страницу списка (она собрана из
   * кэша и сама не узнает о правке: «Выключить» не меняет ни поиск, ни сортировку) и окна подписок.
   */
  const saved = (data: unknown) => {
    const parsed = AdminSubscriptionPlans.safeParse(data);
    if (parsed.success) client.setQueryData(subPlansQuery.queryKey, parsed.data);
    void client.invalidateQueries({ queryKey: ['list', GRID_KEY] });
    refresh();
  };

  const toggle = async (k: Plan) => {
    const res = await updateSubPlan(k.id, { ...planBody(k, !k.active), version: k.version });
    if (!res.ok) return toast(errorText(res.error), { bad: true, icon: 'alert' });
    saved(res.data);
    toast(t(k.active ? 'subs.kinds.off.done' : 'subs.kinds.on.done'), {
      icon: k.active ? 'ban' : 'check',
    });
  };

  const remove = async (k: Plan) => {
    const res = await deleteSubPlan(k.id, k.version);
    if (!res.ok) return toast(errorText(res.error), { bad: true, icon: 'alert' });
    saved(res.data);
    toast(t('subs.kinds.delete.done'), { icon: 'trash' });
  };

  const actions = (k: Plan): ActionEntry[] => {
    const used = k.subs > 0 || k.pays > 0;
    return [
      {
        id: 'edit',
        label: t('subs.kinds.edit'),
        icon: 'edit',
        run: () => setKind(openSlot<Plan | null>(k)),
      },
      k.active
        ? { id: 'off', label: t('subs.kinds.off'), icon: 'ban', run: () => void toggle(k) }
        : { id: 'on', label: t('subs.kinds.on'), icon: 'check', run: () => void toggle(k) },
      { id: 'sep', separator: true },
      {
        id: 'delete',
        label: t('subs.kinds.delete'),
        icon: 'trash',
        danger: true,
        disabled: used,
        reason: used ? t('err.sub_kind_used') : undefined,
        run: () => setDel(openSlot(k)),
      },
    ];
  };

  const history = useMemo(
    () => subConfigItems(t, plans.data?.history ?? []),
    [t, plans.data?.history],
  );

  return (
    <div className="flex flex-col gap-3" data-subs-kinds="">
      <Note>{t('subs.kinds.note')}</Note>
      <div className="flex justify-end">
        <button
          type="button"
          className={buttonClass('cta')}
          onClick={() => setKind(openSlot<Plan | null>(null))}
          data-sub-kind-add=""
        >
          <Icon name="plus" size="sm" />
          {t('subs.kinds.add')}
        </button>
      </div>
      <DataGrid
        columns={columns}
        defaultVisible={DEFAULT_VISIBLE}
        defaultSort={DEFAULT_SORT}
        settings={view.settings}
        onSettingsChange={view.save}
        onResetView={() => void view.reset()}
        data={view.ready ? list.data : undefined}
        onPageChange={list.setPage}
        error={list.error}
        errorText={list.errorText}
        errorTextOf={list.errorTextOf}
        onRetry={list.retry}
        search={search}
        onClearSearch={clearSearch}
        empty={<EmptyState icon="layers" title={t('grid.empty')} />}
        rowKey={(k) => k.id}
        titleKey="name"
        rowTone={(k) => (k.active ? undefined : 'muted')}
        label={t('subs.part.kinds')}
        labels={labels}
        actions={actions}
        onOpen={(k) => setKind(openSlot<Plan | null>(k))}
      />
      <Box title={t('subs.hist.title')}>
        <div data-sub-cfg-hist="">
          {history.length ? (
            <Timeline items={history} label={t('subs.hist.title')} />
          ) : (
            <span className="text-faint">{t('subs.hist.empty')}</span>
          )}
        </div>
      </Box>
      {kind ? (
        <SubKindDialog
          key={`sub-kind-${kind.n}`}
          kind={kind.data}
          all={all}
          open={kind.open}
          onClose={() => setKind(closeSlot)}
          onSaved={saved}
        />
      ) : null}
      {del ? (
        <ConfirmDialog
          key={`sub-kind-del-${del.n}`}
          open={del.open}
          onClose={() => setDel(closeSlot)}
          title={t('subs.kinds.delete.title', { name: del.data.name })}
          text={t('subs.kinds.delete.text')}
          ok={t('subs.kinds.delete')}
          danger
          onConfirm={() => void remove(del.data)}
        />
      ) : null}
    </div>
  );
}

/* ── Окно вида подписки (прототип `subKindDlg`) ── */

interface KindValues {
  name: string;
  months: string;
  disc: string;
  perks: string;
  order: string;
  active: boolean;
}

type KindField = SubscriptionPlanProblem['field'];
type KindErrors = Partial<Record<KindField, string>>;

const kindInitial = (k: Plan | null, all: readonly Plan[]): KindValues => ({
  name: k?.name ?? '',
  months: k ? String(k.months) : '',
  disc: k ? String(k.discountPct) : '0',
  perks: k ? k.perks.join('\n') : '',
  order: String(k ? k.sortOrder : all.reduce((a, x) => Math.max(a, x.sortOrder), 0) + 1),
  active: k ? k.active : true,
});

/** Целое из поля; пустое — не число (правило домена ответит «От 1 до 36 месяцев»). */
const intOf = (v: string) => (v.trim() === '' ? Number.NaN : Number(v));

const failedField = (error: Failure): string | null => {
  const d = error.details;
  return d && typeof d === 'object' && 'field' in d && typeof d.field === 'string' ? d.field : null;
};

function SubKindDialog({
  kind: initial,
  all,
  open,
  onClose,
  onSaved,
}: {
  kind: Plan | null;
  all: readonly Plan[];
  open: boolean;
  onClose: () => void;
  onSaved: (data: unknown) => void;
}) {
  const t = useT();
  const id = useId();
  const toast = useToast();
  const errorText = useErrorText();
  const client = useQueryClient();
  const [kind, setKind] = useState(initial);
  const [values, setValues] = useState(() => kindInitial(initial, all));
  const [base, setBase] = useState(values);
  const [errors, setErrors] = useState<KindErrors>({});
  const [busy, setBusy] = useState(false);
  const [changed, setChanged] = useState(false);
  const [reloading, setReloading] = useState(false);
  const isNew = !initial;
  const set = (patch: Partial<KindValues>) => setValues((v) => ({ ...v, ...patch }));

  const reload = async () => {
    if (!kind) return;
    setReloading(true);
    try {
      const fresh = await client.fetchQuery({ ...subPlansQuery, staleTime: 0 });
      const k = fresh.plans.find((x) => x.id === kind.id) ?? null;
      if (!k) return onClose();
      const next = kindInitial(k, fresh.plans);
      setKind(k);
      setValues(next);
      setBase(next);
      setErrors({});
      setChanged(false);
    } catch {
      toast(t('grid.load_error'), { bad: true, icon: 'alert' });
    } finally {
      setReloading(false);
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const x = {
      name: values.name.trim(),
      months: intOf(values.months),
      discountPct: intOf(values.disc),
      perks: subscriptionPerksOf(values.perks),
      sortOrder: intOf(values.order),
      active: values.active,
    };
    const others = all.filter((k) => k.id !== kind?.id).map((k) => k.name);
    const problems = subscriptionPlanProblems(x, others);
    if (problems.length) {
      const next: KindErrors = {};
      for (const p of problems) next[p.field] ??= t(`err.${p.code}`);
      return setErrors(next);
    }
    setErrors({});
    const body = { ...x, perks: x.perks.join('\n') };
    if (kind && JSON.stringify(planBody(kind)) === JSON.stringify(body)) {
      onClose();
      return toast(t('err.sub_no_change'));
    }
    setBusy(true);
    const res = kind
      ? await updateSubPlan(kind.id, { ...body, version: kind.version })
      : await createSubPlan(body);
    setBusy(false);
    if (res.ok) {
      onSaved(res.data);
      onClose();
      return toast(t(isNew ? 'subs.kinds.added' : 'subs.kinds.saved'), { icon: 'check' });
    }
    if (res.error.code === 'record_changed') return setChanged(true);
    const field = failedField(res.error);
    if (field && ['name', 'months', 'discountPct', 'perks', 'sortOrder'].includes(field)) {
      return setErrors({ [field]: errorText(res.error) });
    }
    toast(errorText(res.error), { bad: true, icon: 'alert' });
  };

  const formId = `${id}-form`;
  const dirty = (Object.keys(values) as (keyof KindValues)[]).some((k) => values[k] !== base[k]);
  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="form"
      title={t(isNew ? 'subs.kind.title_new' : 'subs.kind.title')}
      sub={isNew ? t('subs.kind.sub') : (kind?.name ?? '')}
      dirty={dirty}
      footer={
        <>
          <button type="button" className={buttonClass('ghost')} onClick={onClose}>
            {t('subs.cancel')}
          </button>
          <button
            type="submit"
            form={formId}
            className={buttonClass('cta')}
            disabled={busy || changed}
            data-sub-kind-ok=""
          >
            {t('subs.save')}
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
      <form id={formId} noValidate onSubmit={(e) => void submit(e)} data-sub-kind-form="">
        <FormGrid>
          <Field id={`${id}-n`} label={t('subs.kind.name')} required full error={errors.name}>
            {(control) => (
              <input
                {...control}
                className={inputClass()}
                value={values.name}
                maxLength={200}
                onChange={(e) => set({ name: e.target.value })}
              />
            )}
          </Field>
          <Field id={`${id}-m`} label={t('subs.kind.months')} required error={errors.months}>
            {(control) => (
              <input
                {...control}
                type="number"
                min={1}
                max={36}
                step={1}
                inputMode="numeric"
                className={inputClass()}
                value={values.months}
                onChange={(e) => set({ months: e.target.value })}
              />
            )}
          </Field>
          <Field
            id={`${id}-d`}
            label={t('subs.kind.disc')}
            required
            hint={t('subs.kind.disc.hint')}
            error={errors.discountPct}
          >
            {(control) => (
              <input
                {...control}
                type="number"
                min={0}
                max={90}
                step={1}
                inputMode="numeric"
                className={inputClass()}
                value={values.disc}
                onChange={(e) => set({ disc: e.target.value })}
              />
            )}
          </Field>
          <Field
            id={`${id}-pk`}
            label={t('subs.kind.perks')}
            full
            hint={t('subs.kind.perks.hint')}
            error={errors.perks}
          >
            {(control) => (
              <textarea
                {...control}
                className={`${inputClass({ multiline: true })} min-h-[84px]`}
                value={values.perks}
                placeholder={t('subs.kind.perks.placeholder')}
                onChange={(e) => set({ perks: e.target.value })}
              />
            )}
          </Field>
          <Field id={`${id}-o`} label={t('subs.kind.order')} error={errors.sortOrder}>
            {(control) => (
              <input
                {...control}
                type="number"
                min={1}
                step={1}
                inputMode="numeric"
                className={inputClass()}
                value={values.order}
                onChange={(e) => set({ order: e.target.value })}
              />
            )}
          </Field>
          <label className="col-span-full flex items-center gap-2.5 text-[13px]">
            <input
              type="checkbox"
              className={CHECKBOX_CLASS}
              checked={values.active}
              data-sub-kind-active=""
              onChange={(e) => set({ active: e.target.checked })}
            />
            <span className="grow">{t('subs.kind.active')}</span>
          </label>
        </FormGrid>
      </form>
    </Modal>
  );
}
