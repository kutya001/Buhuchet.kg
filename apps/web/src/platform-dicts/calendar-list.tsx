'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  ADMIN_CALENDAR_COLUMNS,
  ADMIN_CALENDAR_SORT,
  CALENDAR_ADD_TYPES,
  formatDateRu,
  formatMomentRu,
  pluralForm,
  weekdayMondayFirst,
  type UiTextKey,
} from '@buhuchet/domain';
import {
  AdminCalendarAddForm,
  AdminCalendarChanged,
  AdminCalendarCopied,
  AdminCalendarCopyPlan,
  AdminCalendarList,
  ListValues,
  type AdminCalendarAddFormInput,
  type AdminCalendarDay,
} from '@buhuchet/shared';
import {
  buttonClass,
  ConfirmDialog,
  DataGrid,
  EmptyState,
  Field,
  FormGrid,
  Icon,
  inputClass,
  Modal,
  Note,
  Timeline,
  useToast,
  type ActionEntry,
  type GridAudit,
  type GridColumn,
} from '@buhuchet/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useId,
  useMemo,
  useState,
  type FormEvent,
} from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { api, apiFailure, callApi } from '../api-client';
import { fieldError } from '../auth/fields';
import { closeSlot, openSlot, type DialogSlot } from '../dialog-slot';
import { useErrorText, useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';
import { useListExport } from '../lists/export';
import { useGridLabels } from '../lists/grid-labels';
import { useListPage, type FetchListPage } from '../lists/use-list-page';
import { useViewSettings } from '../lists/view-settings';
import { useShell } from '../shell/context';
import { spreadText, useDuesPreview } from './dues-preview';
import { DictHistory } from './dict-history-box';
import { pdictsHistoryQuery } from './pdicts-data';

const cal = api.api.admin['platform-dicts'].calendar;

type JsonResponse = { ok: boolean; status: number; json(): Promise<unknown> };
const json = async <T,>(res: JsonResponse, parse: (v: unknown) => T) => {
  if (!res.ok) throw await apiFailure(res);
  return parse(await res.json());
};

const fetchCalendar: FetchListPage<AdminCalendarDay> = async (params) =>
  json(await cal.$get({ query: params }), (v) => AdminCalendarList.parse(v));

const fetchCalendarValues = async (col: string, q?: string) =>
  json(await cal.values.$get({ query: q ? { col, q } : { col } }), (v) => ListValues.parse(v));

const copyPlanQuery = {
  queryKey: ['admin', 'pdicts', 'calendar', 'copy'],
  queryFn: async () => json(await cal.copy.$get(), (v) => AdminCalendarCopyPlan.parse(v)),
};

/** После правки календаря: список, план копирования и «История изменений» перечитываются. */
function useCalendarRefresh() {
  const client = useQueryClient();
  return useCallback(() => {
    void client.invalidateQueries({ queryKey: ['list', 'pdicts.calendar'] });
    void client.invalidateQueries({ queryKey: copyPlanQuery.queryKey });
    void client.invalidateQueries({ queryKey: pdictsHistoryQuery('calendar').queryKey });
  }, [client]);
}

/** Ширины столбцов, px — как в прототипе (`adm-cal`). */
const WIDTHS: Readonly<Record<string, number>> = {
  date: 120,
  dow: 140,
  name: 280,
  kind: 170,
  rule: 130,
};

/** Название дня: у рабочей субботы без названия — «Рабочая суббота» (прототип holidayRows). */
const dayName = (x: { name: string }, t: Translate) =>
  x.name || t('dicts.platform.calendar.workday');

function cellText(key: string, x: AdminCalendarDay, t: Translate): string {
  switch (key) {
    case 'date':
      return formatDateRu(x.date);
    case 'dow':
      return t(`pdicts.cal.dow.${weekdayMondayFirst(x.date)}` as UiTextKey);
    case 'name':
      return dayName(x, t);
    case 'kind':
      return t(`dicts.platform.calendar.${x.kind}`);
    case 'rule':
      return t(x.everyYear ? 'pdicts.cal.rule.every' : 'pdicts.cal.rule.once');
    default:
      return '';
  }
}

function calendarColumns(t: Translate): GridColumn<AdminCalendarDay>[] {
  return ADMIN_CALENDAR_COLUMNS.map((c) => {
    const column: GridColumn<AdminCalendarDay> = {
      key: c.key,
      label: t(c.label as UiTextKey),
      type: c.type,
      width: WIDTHS[c.key],
      text: (x) => cellText(c.key, x, t),
    };
    if (c.key === 'name') {
      column.cell = (x) => <span className="font-semibold">{dayName(x, t)}</span>;
    }
    return column;
  });
}

const moment = (iso: string | null) => (iso ? formatMomentRu(new Date(iso)) : '');

const AUDIT: GridAudit<AdminCalendarDay> = {
  createdBy: (x) => x.audit.createdBy ?? '',
  updatedBy: (x) => x.audit.updatedBy ?? x.audit.createdBy ?? '',
  createdAt: (x) => moment(x.audit.createdAt),
  updatedAt: (x) => moment(x.audit.updatedAt),
};

/** Поле окна по коду отказа сервера. */
const FIELD_OF: Readonly<Record<string, ['date' | 'name', UiTextKey]>> = {
  calendar_date_required: ['date', 'pdicts.cal.err.date'],
  calendar_date_year: ['date', 'pdicts.cal.err.year'],
  calendar_not_saturday: ['date', 'pdicts.cal.err.saturday'],
  calendar_date_taken: ['date', 'pdicts.cal.err.taken'],
  calendar_name_required: ['name', 'pdicts.cal.err.name'],
};

/**
 * «Нерабочий день» (прототип holidayDlg): дата (по умолчанию 20 марта следующего года), тип
 * «Праздник или перенос» или «Рабочая суббота», название (по умолчанию «Орозо айт»). Ошибки — под полем.
 */
function HolidayDialog({
  open,
  onClose,
  year,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  year: number;
  onDone: () => void;
}) {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const id = useId();
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<AdminCalendarAddFormInput, unknown, AdminCalendarAddForm>({
    resolver: zodResolver(AdminCalendarAddForm),
    defaultValues: {
      date: `${year + 1}-03-20`,
      type: 'off',
      name: t('pdicts.cal.add.name_default'),
    },
  });
  const workday = useWatch({ control, name: 'type' }) === 'workday';
  // Сколько несданных отчётов получат новые сроки (ТЗ: показывается заранее) — тем же кодом, что пересчёт.
  // ОТКЛОНЕНИЕ: docs/deviations.md#Д-17
  const parsed = AdminCalendarAddForm.safeParse(useWatch({ control }));
  const dues = useDuesPreview('calendar:add', parsed.success ? parsed.data : null, (json) =>
    cal['dues-preview'].$post({ json }),
  );

  const submit = (event: FormEvent) =>
    void handleSubmit(async (values) => {
      const res = await callApi(() => cal.$post({ json: values }));
      if (res.ok) {
        const { recalculated: n } = AdminCalendarChanged.parse(res.data);
        onDone();
        onClose();
        return toast(t(`pdicts.cal.toast.added.${pluralForm(n)}`, { n }), { icon: 'calendar' });
      }
      const field = FIELD_OF[res.error.code];
      if (field) {
        const message = t(field[1], { y: year, next: year + 1 });
        return setError(field[0], { type: 'server', message }, { shouldFocus: true });
      }
      toast(errorText(res.error), { bad: true });
    })(event);
  const formId = `${id}-form`;

  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="form"
      title={t('pdicts.cal.add.title')}
      dirty={isDirty}
      footer={
        <>
          <button type="button" className={buttonClass('ghost')} onClick={onClose}>
            {t('btn.cancel')}
          </button>
          <button
            type="submit"
            form={formId}
            className={buttonClass('cta')}
            disabled={isSubmitting}
          >
            {t('btn.add')}
          </button>
        </>
      }
    >
      <form id={formId} noValidate onSubmit={submit}>
        <FormGrid>
          <Field
            id={`${id}-date`}
            label={t('pdicts.cal.add.date')}
            required
            error={fieldError(t, errors.date)}
          >
            {(c) => <input {...c} {...register('date')} type="date" className={inputClass()} />}
          </Field>
          <Field id={`${id}-type`} label={t('pdicts.cal.add.type')}>
            {(c) => (
              <select {...c} {...register('type')} className={`${inputClass()} cursor-pointer`}>
                {CALENDAR_ADD_TYPES.map((x) => (
                  <option key={x} value={x}>
                    {t(`pdicts.cal.type.${x}`)}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field
            id={`${id}-name`}
            label={t('pdicts.cal.add.name')}
            required={!workday}
            error={fieldError(t, errors.name)}
            full
          >
            {(c) => <input {...c} {...register('name')} className={inputClass()} />}
          </Field>
        </FormGrid>
        {dues && dues.reports > 0 ? (
          <div className="mt-3">
            <Note tone="warn">{t('pdicts.cal.dues', { spread: spreadText(t, dues) })}</Note>
          </div>
        ) : null}
      </form>
    </Modal>
  );
}

/**
 * «Создать календарь следующего года копированием» (прототип calCopyDlg): что будет скопировано —
 * «дата → дата», название и тип; копировать нечего — так и сказано.
 */
function CalendarCopyDialog({
  open,
  onClose,
  year,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  year: number;
  onDone: () => void;
}) {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const plan = useQuery(copyPlanQuery);
  const [busy, setBusy] = useState(false);
  const next = plan.data?.year ?? year + 1;
  const items = plan.data?.items;
  const n = items?.length ?? 0;
  const prev = { y: next, prev: next - 1 };

  const copy = async () => {
    setBusy(true);
    const res = await callApi(() => cal.copy.$post());
    setBusy(false);
    if (!res.ok) return toast(errorText(res.error), { bad: true });
    const done = AdminCalendarCopied.parse(res.data);
    onDone();
    onClose();
    const recalc = done.recalculated
      ? t(`pdicts.cal.toast.recalc.${pluralForm(done.recalculated)}`, { n: done.recalculated })
      : '';
    toast(`${t('pdicts.cal.toast.copied', { n: done.copied, y: done.year })}${recalc}`, {
      icon: 'calendar',
    });
  };

  let body;
  if (plan.isError) {
    body = (
      <EmptyState
        icon="alert"
        title={t('grid.load_error')}
        text={t('grid.load_error_text')}
        actions={[
          {
            id: 'retry',
            label: t('grid.retry'),
            icon: 'refresh',
            onClick: () => void plan.refetch(),
          },
        ]}
      />
    );
  } else if (!items) {
    body = <div className="h-24" aria-busy="true" />;
  } else if (n === 0) {
    body = <Note icon="info">{t('pdicts.cal.copy.none', prev)}</Note>;
  } else {
    body = (
      <div className="flex flex-col gap-3">
        <Note tone="warn" icon="alert">
          {t('pdicts.cal.copy.warn', prev)}
        </Note>
        {plan.data && plan.data.dues.reports > 0 ? (
          <Note tone="warn">{t('pdicts.cal.dues', { spread: spreadText(t, plan.data.dues) })}</Note>
        ) : null}
        <Timeline
          label={t('pdicts.cal.copy.title', prev)}
          items={items.map((x) => ({
            id: x.to,
            date: `${formatDateRu(x.from)} →`,
            time: formatDateRu(x.to),
            text: dayName(x, t),
            who: t(`dicts.platform.calendar.${x.kind}`),
          }))}
        />
      </div>
    );
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="form"
      title={t('pdicts.cal.copy.title', prev)}
      sub={t('pdicts.cal.copy.sub', prev)}
      footer={
        <>
          <button type="button" className={buttonClass('ghost')} onClick={onClose}>
            {t(n ? 'btn.cancel' : 'btn.close')}
          </button>
          {n ? (
            <button
              type="button"
              className={buttonClass('cta')}
              disabled={busy}
              onClick={() => void copy()}
            >
              {t(`pdicts.cal.copy.ok.${pluralForm(n)}`, { n })}
            </button>
          ) : null}
        </>
      }
    >
      {body}
    </Modal>
  );
}

/** «+ Добавить» → «Нерабочий день» или «Календарь на следующий год копированием». */
function useCalendarAddRequest(run: (actionId: string) => void) {
  const { addRequest, clearAddRequest } = useShell();
  const request = addRequest?.moduleId === 'pdicts' ? addRequest : null;
  const start = useEffectEvent((actionId: string) => run(actionId));
  useEffect(() => {
    if (!request) return;
    start(request.actionId);
    clearAddRequest();
  }, [request, clearAddRequest]);
}

/**
 * Вопрос «Удалить …?» (прототип: «Сроки несданных отчётов будут пересчитаны.»): с ответом сервера —
 * у скольких несданных отчётов в скольких организациях.
 */
function DeleteDuesText({ day }: { day: AdminCalendarDay }) {
  const t = useT();
  const dues = useDuesPreview(`calendar:delete:${day.key}`, day.version, (version) =>
    cal[':key']['dues-preview'].$post({
      param: { key: day.key },
      query: { version: String(version) },
    }),
  );
  return dues && dues.reports > 0
    ? t('pdicts.cal.dues', { spread: spreadText(t, dues) })
    : t('pdicts.cal.delete_text');
}

/**
 * Админка → «Справочники платформы» → «Календарь» (ТЗ «Производственный календарь КР»; прототип
 * renderPDicts): предупреждение, если на следующий год не внесены переносы и плавающие праздники;
 * «Создать N год копированием»; правило сдвига сроков; дни текущего и следующего года по дате. У дня —
 * «Удалить» (праздник «каждый год» — нельзя), после вопроса; сроки несданных отчётов пересчитываются.
 */
export function CalendarList() {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const refresh = useCalendarRefresh();
  const gridKey = 'pdicts.calendar';
  const labels = useGridLabels('pdicts.calendar_count');
  const columns = useMemo(() => calendarColumns(t), [t]);
  const defaultVisible = useMemo(() => ADMIN_CALENDAR_COLUMNS.map((c) => c.key), []);
  const view = useViewSettings(gridKey);
  const { search, clearSearch } = useShell();
  const list = useListPage({
    gridKey,
    columns,
    defaultVisible,
    settings: view.settings,
    defaultSort: ADMIN_CALENDAR_SORT,
    search,
    enabled: view.ready,
    fetchPage: fetchCalendar,
  });
  const { params, visible } = list;
  const sendExport = useCallback(
    () => cal.export.$get({ query: { ...params, cols: visible.join(',') } }),
    [params, visible],
  );
  const exporter = useListExport(sendExport);
  const data = list.data as AdminCalendarList | undefined;
  // Год по серверу (Бишкек); пока список грузится — по часам браузера.
  const year = data?.year ?? new Date().getFullYear();
  const [adding, setAdding] = useState<DialogSlot<null> | null>(null);
  const [copying, setCopying] = useState<DialogSlot<null> | null>(null);
  const [askDelete, setAskDelete] = useState<AdminCalendarDay | null>(null);
  useCalendarAddRequest((actionId) => {
    if (actionId === 'holiday') setAdding(openSlot(null));
    if (actionId === 'calendar_copy') setCopying(openSlot(null));
  });

  const remove = async (x: AdminCalendarDay) => {
    const res = await callApi(() =>
      cal[':key'].$delete({ param: { key: x.key }, query: { version: String(x.version) } }),
    );
    refresh();
    if (!res.ok) return toast(errorText(res.error), { bad: true });
    toast(t('pdicts.toast.deleted'), { icon: 'check' });
  };

  const actions = (x: AdminCalendarDay): ActionEntry[] => [
    {
      id: 'delete',
      label: t('pdicts.action.delete'),
      icon: 'trash',
      danger: true,
      disabled: x.everyYear,
      ...(x.everyYear ? { reason: t('pdicts.cal.delete_fixed') } : {}),
      run: () => setAskDelete(x),
    },
  ];

  return (
    <div className="flex flex-col gap-3.5">
      {data && !data.nextFilled ? (
        <Note tone="warn" icon="alert">
          {t('pdicts.cal.warn_next', { y: year + 1 })}
        </Note>
      ) : null}
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="text-[13px] text-muted">
          {t('pdicts.cal.copy_hint', { y: year + 1, prev: year })}
        </span>
        <div className="flex-1" />
        <button
          type="button"
          className={buttonClass('default', 'sm')}
          onClick={() => setCopying(openSlot(null))}
        >
          <Icon name="copy" size="sm" />
          {t('pdicts.cal.copy_btn', { y: year + 1 })}
        </button>
      </div>
      <Note icon="info">
        {t('pdicts.cal.rule_note')}
        {data?.example
          ? ` ${t('pdicts.cal.rule_example', {
              type: data.example.type,
              period: data.example.period,
              from: formatDateRu(data.example.from),
              to: formatDateRu(data.example.to),
            })}`
          : ''}
      </Note>
      <DataGrid
        columns={columns}
        audit={AUDIT}
        defaultVisible={defaultVisible}
        defaultSort={ADMIN_CALENDAR_SORT}
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
        loadValues={fetchCalendarValues}
        search={search}
        onClearSearch={clearSearch}
        onExport={() => void exporter.run()}
        exporting={exporter.exporting}
        empty={<EmptyState icon="calendar" title={t('grid.empty')} />}
        rowKey={(x) => `${x.date}|${x.key}`}
        titleKey="name"
        label={t('dicts.platform.dict.calendar')}
        labels={labels}
        actions={actions}
      />
      <DictHistory dict="calendar" />
      {adding ? (
        <HolidayDialog
          key={`add-${adding.n}`}
          open={adding.open}
          onClose={() => setAdding(closeSlot)}
          year={year}
          onDone={refresh}
        />
      ) : null}
      {copying ? (
        <CalendarCopyDialog
          key={`copy-${copying.n}`}
          open={copying.open}
          onClose={() => setCopying(closeSlot)}
          year={year}
          onDone={refresh}
        />
      ) : null}
      <ConfirmDialog
        open={askDelete !== null}
        onClose={() => setAskDelete(null)}
        title={t('pdicts.cal.delete_title', {
          date: askDelete ? formatDateRu(askDelete.date) : '',
        })}
        text={askDelete ? <DeleteDuesText day={askDelete} /> : t('pdicts.cal.delete_text')}
        ok={t('pdicts.action.delete')}
        danger
        onConfirm={() => askDelete && void remove(askDelete)}
      />
    </div>
  );
}
