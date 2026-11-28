'use client';

import {
  bishkekDate,
  formatDateRu,
  seriesRuleText,
  TASK_DESCRIPTION_MAX,
  TASK_TITLE_MAX,
  taskOpen,
} from '@buhuchet/domain';
import { Task, type SeriesScope, type TaskFormOptions } from '@buhuchet/shared';
import {
  buttonClass,
  Field,
  FormGrid,
  FormMore,
  Hint,
  Icon,
  iconButtonClass,
  inputClass,
  Modal,
  RecordChangedNotice,
  Segments,
  SWITCH_CLASS,
  useToast,
} from '@buhuchet/ui';
import { useQuery } from '@tanstack/react-query';
import { useId, useMemo, useState, type ReactNode } from 'react';
import { api, callApi } from '../api-client';
import { useErrorText, useT } from '../l10n/provider';
import { ContractorSelect } from '../shell/contractor-select';
import { taskProjectsQuery } from '../projects/projects-data';
import { closeSlot, openSlot, type DialogSlot } from '../dialog-slot';
import { SeriesRuleDialog, SeriesScopeDialog } from './series-dialog';
import {
  confirmHint,
  defaultExecutor,
  initialTaskForm,
  repeatChanged,
  repeatForTerm,
  repeatStart,
  taskEditBody,
  taskFormBody,
  taskFormLists,
  taskFormMoreFilled,
  taskFormMoreOpen,
  taskFormProblems,
  type TaskFormField,
  type TaskFormOption,
  type TaskFormPreset,
  type TaskFormValues,
} from './task-form-values';

/** Отказы сервера, которые показываются под полем. */
const FIELD_OF_CODE: Record<string, keyof TaskFormValues> = {
  task_category_not_found: 'categoryCode',
  task_category_inactive: 'categoryCode',
  task_contractor_not_found: 'contractorId',
  task_contractor_archived: 'contractorId',
  task_executor_not_found: 'executorEmployeeId',
  task_executor_inactive: 'executorEmployeeId',
  task_project_invalid: 'projectId',
};

type Errors = Partial<Record<keyof TaskFormValues, string>>;

/** Переключатель строкой (`.row` с `.sw` прототипа): подпись справа, подсказка снизу. */
function SwitchRow({
  id,
  text,
  checked,
  disabled = false,
  hint,
  onChange,
}: {
  id: string;
  text: string;
  checked: boolean;
  disabled?: boolean;
  hint?: string | undefined;
  onChange: (checked: boolean) => void;
}) {
  return (
    <>
      <label className="flex min-h-[35px] cursor-pointer items-center gap-2.5">
        <input
          id={id}
          type="checkbox"
          role="switch"
          className={SWITCH_CLASS}
          checked={checked}
          disabled={disabled}
          aria-describedby={hint ? `${id}-hint` : undefined}
          onChange={(e) => onChange(e.target.checked)}
        />
        {text}
      </label>
      {hint ? (
        <div id={`${id}-hint`}>
          <Hint>{hint}</Hint>
        </div>
      ) : null}
    </>
  );
}

function Select({
  control,
  value,
  options,
  placeholder,
  onChange,
}: {
  control: object;
  value: string;
  options: readonly TaskFormOption[];
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  return (
    <select
      {...control}
      className={`${inputClass()} cursor-pointer`}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/**
 * «Новая задача» и «Изменить задачу» (ТЗ «Ручные задачи»; прототип modules/tasks.js, `taskDlg`, v136):
 * на виду — «Вид задачи» («Общая» / «По контрагенту»; при смене на «Общая» у задачи с контрагентом —
 * предупреждение «Контрагент и проект будут убраны из задачи»), название, контрагент (у «По
 * контрагенту»), исполнитель (по умолчанию — ответственный выбранного контрагента, пока исполнителя не
 * выбрали руками; у общей — тот, кто ставит) и дата или месяц. Редкое — под «Дополнительно · заполнено
 * N»: описание, проект (у «По контрагенту» при включённых «Проектах контрагентов»: «Без проекта» или
 * активный проект контрагента, уже выбранный завершённый — тоже; смена контрагента снимает проект,
 * задача 2.26), категория, вид срока, «При выполнении»: «нужен файл» (только с «Файлами в карточках» —
 * docs/deviations.md п. Б-1) и «нужно подтверждение» (по умолчанию — из учётной политики).
 */
export function TaskFormDialog({
  task,
  preset,
  options,
  employeeId,
  open,
  onClose,
  onDone,
}: {
  /** Изменяемая задача; null — новая. */
  task: Task | null;
  preset?: TaskFormPreset;
  options: TaskFormOptions;
  employeeId: string;
  open: boolean;
  onClose: () => void;
  onDone: (task: Task) => void;
}) {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const id = useId();
  const [current, setCurrent] = useState(task);
  const [initial] = useState(() =>
    initialTaskForm({ task, preset, options, employeeId, today: bishkekDate(new Date()) }),
  );
  const [values, setValues] = useState(initial);
  // Исполнителя выбрали руками (или он уже есть у задачи): смена контрагента его не меняет.
  const [execTouched, setExecTouched] = useState(task !== null);
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [changed, setChanged] = useState(false);
  const [more, setMore] = useState(() => taskFormMoreOpen(task));
  const lists = useMemo(() => taskFormLists(options, current), [options, current]);
  const confirm = confirmHint(current);
  const dirty = JSON.stringify(values) !== JSON.stringify(initial);

  const set = <K extends keyof TaskFormValues>(key: K, value: TaskFormValues[K]) => {
    setValues((v) => ({ ...v, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  };
  /** Вид задачи и контрагент; исполнитель, пока его не выбрали руками, — по умолчанию для них. */
  // ОТКЛОНЕНИЕ: docs/deviations.md#Б-3
  const setScope = (scope: TaskFormValues['scope'], contractorId: string) => {
    setValues((v) => ({
      ...v,
      scope,
      contractorId,
      // Прототип `taskDlg`: смена контрагента снимает выбранный проект.
      projectId: contractorId === v.contractorId ? v.projectId : '',
      executorEmployeeId: execTouched
        ? v.executorEmployeeId
        : defaultExecutor(options, scope === 'contractor' ? contractorId : '', employeeId),
    }));
    setErrors((e) => ({ ...e, contractorId: undefined, projectId: undefined }));
  };
  const projectOn = options.projectsOn && values.scope === 'contractor';
  const projects = useQuery({
    ...taskProjectsQuery(values.contractorId, current?.project?.id ?? null),
    enabled: projectOn && !!values.contractorId,
  });
  const projectItems = projects.data?.items ?? [];
  const projectPlaceholder = t(
    values.contractorId ? 'task.form.project_empty' : 'task.form.project_first',
  );
  const filled = taskFormMoreFilled(values, options, current === null);
  const series = current?.series ?? null;
  const today = bishkekDate(new Date());
  const start = repeatStart(values, today);
  const [ruleDlg, setRuleDlg] = useState<DialogSlot<null> | null>(null);
  const [ask, setAsk] = useState<DialogSlot<{ oneWhy: string }> | null>(null);

  const reload = async () => {
    if (!task) return;
    setBusy(true);
    const res = await callApi(() => api.api.tasks[':id'].$get({ param: { id: task.id } }));
    setBusy(false);
    const fresh = res.ok ? Task.safeParse(res.data) : null;
    if (!fresh?.success) return toast(t('err.unknown'), { bad: true });
    setCurrent(fresh.data);
    setValues(
      initialTaskForm({ task: fresh.data, options, employeeId, today: bishkekDate(new Date()) }),
    );
    setChanged(false);
    setErrors({});
  };

  const save = async () => {
    const problems = taskFormProblems(values);
    if (Object.keys(problems).length > 0) {
      const next: Errors = {};
      for (const [field, key] of Object.entries(problems)) next[field as TaskFormField] = t(key);
      setErrors(next);
      const first = (
        ['title', 'contractorId', 'executorEmployeeId', 'date', 'month'] as const
      ).find((f) => problems[f]);
      if (first) document.getElementById(`${id}-${first}`)?.focus();
      return;
    }
    // Задача действующей или остановленной серии: «Только эту задачу» или «Эту и следующие».
    if (current && series && series.state !== 'finished') {
      return setAsk(
        openSlot({ oneWhy: repeatChanged(values, current) ? t('err.series_rule_one') : '' }),
      );
    }
    await send('one');
  };

  const send = async (scope: SeriesScope) => {
    const body = taskFormBody(values);
    setBusy(true);
    const res = await callApi(() =>
      current
        ? api.api.tasks[':id'].$patch({
            param: { id: current.id },
            json: { ...taskEditBody(values, current, scope), version: current.version },
          })
        : api.api.tasks.$post({ json: body }),
    );
    setBusy(false);
    if (res.ok) {
      const saved = Task.safeParse(res.data);
      if (saved.success) onDone(saved.data);
      onClose();
      const name = lists.executors.find((e) => e.value === body.executorEmployeeId)?.label ?? '';
      const first = saved.success ? saved.data.dueDate : body.dueDate;
      return toast(
        current
          ? t(current.series && scope === 'next' ? 'task.series.toast.saved_all' : 'task.saved.toast')
          : !body.repeat
            ? t('task.created.toast', { name })
            : first !== body.dueDate && saved.success && saved.data.term === 'day'
              ? t('task.series.toast.created_first', { name, date: formatDateRu(first) })
              : t('task.series.toast.created', { name }),
        { icon: body.repeat ? 'repeat' : 'task' },
      );
    }
    if (res.error.code === 'record_changed') return setChanged(true);
    const message = errorText(res.error);
    const field = FIELD_OF_CODE[res.error.code];
    if (field) {
      setErrors((e) => ({ ...e, [field]: message }));
      // Поле под «Дополнительно» раскрывается вместе с ошибкой — фокус после перерисовки.
      if (field === 'categoryCode' || field === 'projectId') setMore(true);
      return void setTimeout(() => document.getElementById(`${id}-${field}`)?.focus());
    }
    toast(message, { bad: true });
  };

  /**
   * Строка «Повтор» рядом со сроком (блок 2, пункт 1; прототип `repRow`): у новой и разовой открытой —
   * «Не повторять» или правило с «×»; у задачи серии — правило серии (меняется для этой и следующих);
   * у закончившейся — только текст; закрытой разовой задаче повтор не добавляется.
   */
  const repeatRow = () => {
    if (current && !series && !taskOpen(current.status)) return null;
    if (series?.state === 'finished') {
      return (
        <Field
          id={`${id}-repeat`}
          label={t('task.col.repeat')}
          hint={t('task.series.form.hint_finished')}
        >
          {() => (
            <div data-task-repeat="" className="flex min-h-[35px] items-center gap-1.5 text-muted">
              <Icon name="repeat" size="sm" />
              <span>{t('task.series.form.finished', { rule: series.text })}</span>
            </div>
          )}
        </Field>
      );
    }
    const text = values.repeat
      ? seriesRuleText({ rule: values.repeat, start, term: values.term })
      : t('task.repeat.none');
    return (
      <Field
        id={`${id}-repeat`}
        label={t('task.col.repeat')}
        {...(series
          ? {
              hint: t(
                series.state === 'stopped'
                  ? 'task.series.form.hint_stopped'
                  : 'task.series.form.hint_rule',
              ),
            }
          : {})}
      >
        {(control) => (
          <div className="flex flex-nowrap items-center gap-1.5">
            <button
              {...control}
              type="button"
              data-task-repeat=""
              className={`${buttonClass()} min-w-0 max-w-full justify-start text-left`}
              onClick={() => setRuleDlg(openSlot(null))}
            >
              <Icon name="repeat" size="sm" />
              <span className="truncate">{text}</span>
            </button>
            {values.repeat && !series ? (
              <button
                type="button"
                data-task-repeat-clear=""
                className={iconButtonClass('sm')}
                aria-label={t('task.repeat.none')}
                title={t('task.repeat.none')}
                onClick={() => set('repeat', null)}
              >
                <Icon name="x" size="sm" />
              </button>
            ) : null}
          </div>
        )}
      </Field>
    );
  };

  const field = (
    key: keyof TaskFormValues,
    label: string,
    input: (control: object) => ReactNode,
    extra: { required?: boolean; full?: boolean; hint?: string } = {},
  ) => (
    <Field id={`${id}-${key}`} label={label} error={errors[key]} {...extra}>
      {input}
    </Field>
  );
  const dropsContractor = !!current?.contractor && values.scope === 'general';

  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="form"
      size="mid"
      title={t(current ? 'task.form.edit' : 'task.form.new')}
      dirty={dirty}
      footer={
        <>
          <button type="button" className={buttonClass('ghost')} onClick={onClose}>
            {t('btn.cancel')}
          </button>
          <button
            type="button"
            data-task-save=""
            className={buttonClass('cta')}
            disabled={busy || changed}
            onClick={() => void save()}
          >
            {t(current ? 'task.form.save' : 'task.form.create')}
          </button>
        </>
      }
    >
      {changed ? (
        <RecordChangedNotice
          message={t('err.record_changed')}
          reloadLabel={t('form.reload')}
          onReload={() => void reload()}
          reloading={busy}
        />
      ) : null}
      <FormGrid>
        <div data-field="" data-full="" className="col-span-full flex min-w-0 flex-col gap-[5px]">
          <span className="text-[12px] font-semibold tracking-[.01em] text-muted">
            {t('task.form.scope')}
          </span>
          <div data-task-scope="">
            <Segments
              label={t('task.form.scope')}
              value={values.scope}
              options={[
                { value: 'general', label: t('task.scope.general') },
                { value: 'contractor', label: t('task.scope.contractor') },
              ]}
              onChange={(scope) => setScope(scope, values.contractorId)}
            />
          </div>
          {dropsContractor ? (
            <div className="text-[11.5px] leading-[1.4] text-danger">
              {t('task.form.scope_drop')}
            </div>
          ) : null}
        </div>
        {field(
          'title',
          t('task.form.title'),
          (control) => (
            <input
              {...control}
              type="text"
              data-task-title=""
              maxLength={TASK_TITLE_MAX}
              className={inputClass()}
              value={values.title}
              onChange={(e) => set('title', e.target.value)}
            />
          ),
          { required: true, full: true },
        )}
        {values.scope === 'contractor'
          ? field(
              'contractorId',
              t('task.form.cp'),
              (control) => (
                <ContractorSelect
                  {...control}
                  contractors={lists.contractors.map((c) => ({
                    id: c.value,
                    name: c.label,
                    inn: c.inn,
                  }))}
                  value={values.contractorId}
                  empty={t('task.form.cp_pick')}
                  onChange={(v) => setScope('contractor', v)}
                />
              ),
              { required: true },
            )
          : null}
        {field(
          'executorEmployeeId',
          t('task.form.exec'),
          (control) => (
            <Select
              control={control}
              value={values.executorEmployeeId}
              options={lists.executors}
              onChange={(v) => {
                setExecTouched(true);
                set('executorEmployeeId', v);
              }}
            />
          ),
          { required: true },
        )}
        {values.term === 'day'
          ? field(
              'date',
              t('task.form.date'),
              (control) => (
                <input
                  {...control}
                  type="date"
                  className={inputClass()}
                  value={values.date}
                  onChange={(e) => set('date', e.target.value)}
                />
              ),
              { required: true },
            )
          : field(
              'month',
              t('task.form.month'),
              (control) => (
                <input
                  {...control}
                  type="month"
                  className={inputClass()}
                  value={values.month}
                  onChange={(e) => set('month', e.target.value)}
                />
              ),
              { required: true },
            )}
        {repeatRow()}
        <FormMore
          data-task-more-fields=""
          label={t('status.fold.more')}
          filled={filled}
          filledLabel={t('status.fold.filled', { n: filled })}
          // ОТКЛОНЕНИЕ: docs/deviations.md#О-83 — при ошибке в поле под блоком он раскрывается сам.
          open={more || !!errors.categoryCode || !!errors.projectId}
          onToggle={setMore}
        >
          <FormGrid>
            {field(
              'description',
              t('task.form.description'),
              (control) => (
                <textarea
                  {...control}
                  maxLength={TASK_DESCRIPTION_MAX}
                  className={`${inputClass({ multiline: true })} min-h-[70px]`}
                  value={values.description}
                  onChange={(e) => set('description', e.target.value)}
                />
              ),
              { full: true },
            )}
            {projectOn
              ? field('projectId', t('task.form.project'), (control) => (
                  <Select
                    control={control}
                    value={values.projectId}
                    options={projectItems.map((p) => ({ value: p.id, label: p.name }))}
                    placeholder={projectPlaceholder}
                    onChange={(v) => set('projectId', v)}
                  />
                ))
              : null}
            {field('categoryCode', t('task.form.cat'), (control) => (
              <Select
                control={control}
                value={values.categoryCode}
                options={lists.categories}
                onChange={(v) => set('categoryCode', v)}
              />
            ))}
            {field('term', t('task.form.term'), (control) => (
              <Select
                control={control}
                value={values.term}
                options={[
                  { value: 'day', label: t('task.term.day') },
                  { value: 'month', label: t('task.form.term_month') },
                ]}
                onChange={(v) => {
                  const term = v as TaskFormValues['term'];
                  setValues((s) => ({ ...s, term, repeat: repeatForTerm(s.repeat, term) }));
                }}
              />
            ))}
            <div
              data-field=""
              data-full=""
              className="col-span-full flex min-w-0 flex-col gap-[5px]"
            >
              <span className="text-[12px] font-semibold tracking-[.01em] text-muted">
                {t('task.form.on_done')}
              </span>
              {/* ОТКЛОНЕНИЕ: docs/deviations.md#Б-1 */}
              {options.filesOn ? (
                <SwitchRow
                  id={`${id}-file`}
                  text={t('task.form.need_file')}
                  checked={values.needFile}
                  onChange={(v) => set('needFile', v)}
                />
              ) : null}
              <SwitchRow
                id={`${id}-confirm`}
                text={t('task.form.confirm')}
                checked={values.confirm}
                disabled={confirm.locked}
                hint={confirm.key ? t(confirm.key) : undefined}
                onChange={(v) => set('confirm', v)}
              />
            </div>
          </FormGrid>
        </FormMore>
      </FormGrid>
      {ruleDlg ? (
        <SeriesRuleDialog
          key={`rule-${ruleDlg.n}`}
          open={ruleDlg.open}
          onClose={() => setRuleDlg(closeSlot)}
          rule={values.repeat}
          start={start}
          term={values.term}
          onDone={(rule, from) => {
            setRuleDlg(closeSlot);
            setValues((v) => ({
              ...v,
              repeat: rule,
              ...(v.term === 'month' ? { month: from.slice(0, 7) } : { date: from }),
            }));
            setErrors((e) => ({ ...e, date: undefined, month: undefined }));
          }}
        />
      ) : null}
      {ask ? (
        <SeriesScopeDialog
          key={`ask-${ask.n}`}
          open={ask.open}
          onClose={() => setAsk(closeSlot)}
          title={t('task.series.ask.edit')}
          ok={t('task.form.save')}
          oneWhy={ask.data.oneWhy}
          onPick={(scope) => void send(scope)}
        />
      ) : null}
    </Modal>
  );
}
