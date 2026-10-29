'use client';

import { bishkekDate, TASK_DESCRIPTION_MAX, TASK_TITLE_MAX } from '@buhuchet/domain';
import { Task, type TaskFormOptions } from '@buhuchet/shared';
import {
  buttonClass,
  Field,
  FormGrid,
  Hint,
  inputClass,
  Modal,
  RecordChangedNotice,
  Segments,
  SWITCH_CLASS,
  useToast,
} from '@buhuchet/ui';
import { useId, useMemo, useState, type ReactNode } from 'react';
import { api, callApi } from '../api-client';
import { useErrorText, useT } from '../l10n/provider';
import {
  confirmHint,
  defaultExecutor,
  initialTaskForm,
  taskFormBody,
  taskFormLists,
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
};

type Errors = Partial<Record<keyof TaskFormValues, string>>;

/** Переключатель в ячейке формы (`.fld` с `.sw` прототипа): подпись сверху, подсказка снизу. */
function SwitchField({
  id,
  label,
  text,
  checked,
  disabled = false,
  hint,
  onChange,
}: {
  id: string;
  /** Подпись над переключателем; без неё — пустая строка той же высоты (`.m-sp`). */
  label?: string;
  text: string;
  checked: boolean;
  disabled?: boolean;
  hint?: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div data-field="" className="flex min-w-0 flex-col gap-[5px]">
      <span
        aria-hidden={label ? undefined : true}
        className="text-[12px] font-semibold tracking-[.01em] text-muted max-[600px]:empty:hidden"
      >
        {label ?? ' '}
      </span>
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
    </div>
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
 * «Новая задача» и «Изменить задачу» (ТЗ «Ручные задачи»; прототип modules/tasks.js, `taskDlg`):
 * первым — «Вид задачи» («Общая» / «По контрагенту»; при смене на «Общая» у задачи с контрагентом —
 * предупреждение «Контрагент и проект будут убраны из задачи»), название, описание, контрагент (у «По
 * контрагенту»), категория, исполнитель (по умолчанию — ответственный выбранного контрагента, пока
 * исполнителя не выбрали руками; у общей — тот, кто ставит), вид срока и дата или месяц, «Требуется
 * файл» (только с «Файлами в карточках» — docs/deviations.md п. Б-1), «Требуется подтверждение» (по
 * умолчанию — из учётной политики). Галочку «Проект» добавит задача 2.26.
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
      executorEmployeeId: execTouched
        ? v.executorEmployeeId
        : defaultExecutor(options, scope === 'contractor' ? contractorId : '', employeeId),
    }));
    setErrors((e) => ({ ...e, contractorId: undefined }));
  };

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
    const body = taskFormBody(values);
    setBusy(true);
    const res = await callApi(() =>
      current
        ? api.api.tasks[':id'].$patch({
            param: { id: current.id },
            json: { ...body, version: current.version },
          })
        : api.api.tasks.$post({ json: body }),
    );
    setBusy(false);
    if (res.ok) {
      const saved = Task.safeParse(res.data);
      if (saved.success) onDone(saved.data);
      onClose();
      const name = lists.executors.find((e) => e.value === body.executorEmployeeId)?.label ?? '';
      return toast(current ? t('task.saved.toast') : t('task.created.toast', { name }), {
        icon: 'task',
      });
    }
    if (res.error.code === 'record_changed') return setChanged(true);
    const message = errorText(res.error);
    const field = FIELD_OF_CODE[res.error.code];
    if (field) {
      setErrors((e) => ({ ...e, [field]: message }));
      return document.getElementById(`${id}-${field}`)?.focus();
    }
    toast(message, { bad: true });
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
        {values.scope === 'contractor' ? (
          <>
            {field(
              'contractorId',
              t('task.form.cp'),
              (control) => (
                <Select
                  control={control}
                  value={values.contractorId}
                  options={lists.contractors}
                  placeholder={t('task.form.cp_pick')}
                  onChange={(v) => setScope('contractor', v)}
                />
              ),
              { required: true },
            )}
            <div />
          </>
        ) : null}
        {field('categoryCode', t('task.form.cat'), (control) => (
          <Select
            control={control}
            value={values.categoryCode}
            options={lists.categories}
            onChange={(v) => set('categoryCode', v)}
          />
        ))}
        <div />
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
        {field('term', t('task.form.term'), (control) => (
          <Select
            control={control}
            value={values.term}
            options={[
              { value: 'day', label: t('task.term.day') },
              { value: 'month', label: t('task.term.month') },
            ]}
            onChange={(v) => set('term', v as TaskFormValues['term'])}
          />
        ))}
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
              { required: true, hint: t('task.form.month_hint') },
            )}
        {/* ОТКЛОНЕНИЕ: docs/deviations.md#Б-1 */}
        {options.filesOn ? (
          <SwitchField
            id={`${id}-file`}
            label={t('task.form.on_done')}
            text={t('task.form.need_file')}
            checked={values.needFile}
            onChange={(v) => set('needFile', v)}
          />
        ) : null}
        <SwitchField
          id={`${id}-confirm`}
          text={t('task.form.confirm')}
          checked={values.confirm}
          disabled={confirm.locked}
          hint={t(confirm.key)}
          onChange={(v) => set('confirm', v)}
        />
      </FormGrid>
      <Hint>{t('task.form.telegram')}</Hint>
    </Modal>
  );
}
