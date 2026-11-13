'use client';

import {
  formatSom,
  formatSomWithUnit,
  parseSom,
  projectFormDefaults,
  projectMemberToggle,
  projectProblems,
  projectWorksClean,
  type IsoDate,
  type ProjectProblem,
  type UiTextKey,
} from '@buhuchet/domain';
import {
  isRecordChanged,
  ProjectSaved,
  type ProjectCard,
  type ProjectForm,
} from '@buhuchet/shared';
import {
  buttonClass,
  ChipMultiSelect,
  Field,
  FormGrid,
  Icon,
  iconButtonClass,
  inputClass,
  MiniTable,
  Modal,
  Note,
  RecordChangedNotice,
  Pill,
  StatusPill,
  useToast,
} from '@buhuchet/ui';
import { useQuery } from '@tanstack/react-query';
import { useId, useRef, useState } from 'react';
import { ApiFailure } from '../api-client';
import { useErrorText, useT } from '../l10n/provider';
import { ContractorSelect } from '../shell/contractor-select';
import type { ApiErrorLike, Translate } from '../l10n/translate';
import { statusPillView } from '../status/status-view';
import { createProject, editProject, projectFormQuery } from './projects-data';

/*
 * Окно «Новый проект» и «Изменить проект» (задача 2.26; ТЗ «Модуль Проекты контрагентов»; прототип
 * modules/projects.js — `projectDlg`): название, контрагент (у нового, если не выбран в карточке
 * контрагента), срок, статус («Планируется» или «В работе» у нового; у прежнего — метка, меняется на
 * шкале), планируемая стоимость (тому, кто видит деньги), ответственные плашками и главный, описание,
 * работы таблицей (сделанную не удалить). Все отказы сразу — у своих полей; сервер проверяет ещё раз.
 */

type ErrorField = ProjectProblem['field'];
type Errors = Partial<Record<ErrorField, string>>;

interface WorkDraft {
  /** Ключ строки в окне. */
  key: string;
  id?: string;
  name: string;
  executorId: string;
  due: string;
  done: boolean;
}

/** Контрагент, у которого создают проект (меню и вкладка «Проекты» карточки контрагента). */
export interface ProjectContractorPreset {
  id: string;
  name: string;
}

/** Поле отказа сервера (`details.field`) — поле окна. */
function fieldOf(details: unknown): ErrorField | null {
  const field = (details as { field?: string } | undefined)?.field;
  if (field === 'contractorId' || field === 'contractor') return 'contractor';
  if (field === 'startsOn' || field === 'endsOn' || field === 'dates') return 'dates';
  if (
    field === 'name' ||
    field === 'members' ||
    field === 'lead' ||
    field === 'plan' ||
    field === 'works'
  )
    return field;
  return null;
}

const problemText = (t: Translate, p: ProjectProblem) =>
  t(`err.${p.problem}` as UiTextKey, {
    amount: p.amount !== undefined ? formatSomWithUnit(p.amount) : '',
  });

const loadError = (errorText: (e: ApiErrorLike) => string, e: unknown) =>
  errorText(e instanceof ApiFailure ? e.error : { code: 'unknown', message: '' });

export function ProjectDialog({
  contractor,
  edit,
  open,
  onClose,
  onDone,
}: {
  /** Контрагент из его карточки; null — выбрать в окне. */
  contractor: ProjectContractorPreset | null;
  /** Изменить этот проект (свежая карточка); null — новый. */
  edit: ProjectCard | null;
  open: boolean;
  onClose: () => void;
  /** После записи: номер проекта, новый ли он. */
  onDone: (id: string, created: boolean) => void;
}) {
  const t = useT();
  const errorText = useErrorText();
  const preset = edit ? { id: edit.contractor.id, name: edit.contractor.name } : contractor;
  const query = useQuery(projectFormQuery(preset?.id ?? null));
  const failed = query.isError && !query.data ? loadError(errorText, query.error) : null;
  return (
    <ProjectModal
      key={query.data ? 'ready' : 'loading'}
      t={t}
      form={query.data ?? null}
      failed={failed}
      preset={preset}
      edit={edit}
      open={open}
      onClose={onClose}
      onDone={onDone}
    />
  );
}

function ProjectModal({
  t,
  form,
  failed,
  preset,
  edit,
  open,
  onClose,
  onDone,
}: {
  t: Translate;
  form: ProjectForm | null;
  failed: string | null;
  preset: ProjectContractorPreset | null;
  edit: ProjectCard | null;
  open: boolean;
  onClose: () => void;
  onDone: (id: string, created: boolean) => void;
}) {
  const toast = useToast();
  const errorText = useErrorText();
  const id = useId();
  const seq = useRef(0);
  const nextKey = () => `w${++seq.current}`;
  const presetResponsible =
    preset && form ? (form.contractors.find((c) => c.id === preset.id)?.responsible ?? null) : null;
  const defaults = form
    ? projectFormDefaults(form.today, { contractorResponsible: presetResponsible, me: form.me })
    : null;
  const [cp, setCp] = useState(preset?.id ?? '');
  const [name, setName] = useState(edit?.name ?? '');
  const [from, setFrom] = useState<string>(edit?.startsOn ?? defaults?.startsOn ?? '');
  const [to, setTo] = useState<string>(edit?.endsOn ?? defaults?.endsOn ?? '');
  const [status, setStatus] = useState<'planned' | 'in_progress'>('planned');
  const [plan, setPlan] = useState(
    edit?.money?.plan != null ? formatSom(edit.money.plan, 'auto') : '',
  );
  const [members, setMembers] = useState<string[]>(
    edit ? edit.members.map((m) => m.id) : (defaults?.members ?? []),
  );
  const [lead, setLead] = useState<string | null>(edit ? edit.lead.id : (defaults?.lead ?? null));
  const [description, setDescription] = useState(edit?.description ?? '');
  const [works, setWorks] = useState<WorkDraft[]>(() =>
    (edit?.works ?? []).map((w) => ({
      key: `w-${w.id}`,
      id: w.id,
      name: w.name,
      executorId: w.executor.id,
      due: w.due ?? '',
      done: w.done,
    })),
  );
  const [errors, setErrors] = useState<Errors>({});
  const [changed, setChanged] = useState(false);
  const [busy, setBusy] = useState(false);
  const clear = (k: ErrorField) => setErrors((x) => ({ ...x, [k]: undefined }));
  const paid = edit?.money?.paid ?? 0;
  const money = form?.money ?? false;

  // Ответственные: действующие сотрудники и те, кто уже в проекте (ушедший остаётся, пока его не снимут).
  const names = new Map<string, string>(form?.employees.map((e) => [e.id, e.name]) ?? []);
  for (const m of edit?.members ?? []) if (!names.has(m.id)) names.set(m.id, m.name);
  for (const w of edit?.works ?? [])
    if (!names.has(w.executor.id)) names.set(w.executor.id, w.executor.name);
  const people = [...names].map(([value, label]) => ({ value, label }));
  const memberOptions = people.filter(
    (p) => form?.employees.some((e) => e.id === p.value) || members.includes(p.value),
  );

  /** Нажатие на сотрудника: прототип `#pd-resp` — добавить в конец или убрать, главный — первый. */
  const toggleMembers = (next: string[]) => {
    const was = new Set(members);
    const now = new Set(next);
    const changedId = next.find((x) => !was.has(x)) ?? members.find((x) => !now.has(x)) ?? null;
    if (!changedId) return;
    const r = projectMemberToggle(members, lead, changedId);
    setMembers(r.members);
    setLead(r.lead);
    setErrors((x) => ({ ...x, members: undefined, lead: undefined }));
  };

  const setWork = (key: string, patch: Partial<WorkDraft>) => {
    setWorks((list) => list.map((w) => (w.key === key ? { ...w, ...patch } : w)));
    clear('works');
  };
  const addWork = () => {
    const exec = lead ?? form?.me ?? members[0] ?? '';
    setWorks((list) => [
      ...list,
      { key: nextKey(), name: '', executorId: exec, due: to, done: false },
    ]);
    // Фокус — на название новой работы (прототип: `l[l.length-1].focus()`).
    queueMicrotask(() => {
      const inputs = document.querySelectorAll<HTMLInputElement>(`[data-pd-work-name]`);
      inputs[inputs.length - 1]?.focus();
    });
  };

  const save = async () => {
    if (!form) return;
    const planValue = plan.trim() === '' ? null : (parseSom(plan) ?? 'invalid');
    const found: Errors = {};
    const problems = projectProblems(
      {
        name,
        ...(edit || preset ? {} : { contractorId: cp || null }),
        startsOn: from as IsoDate | '',
        endsOn: to as IsoDate | '',
        members,
        lead,
        plan: money ? planValue : null,
        works: works.map((w) => ({
          name: w.name,
          executorEmployeeId: w.executorId,
          due: (w.due || null) as IsoDate | null,
        })),
      },
      paid,
    );
    for (const p of problems) found[p.field] ??= problemText(t, p);
    if (Object.keys(found).length) return setErrors(found);
    const kept = works.filter((w) => w.name.trim() || (w.id && w.done));
    const cleaned = projectWorksClean(
      kept.map((w) => ({
        name: w.name,
        executorEmployeeId: w.executorId,
        due: (w.due || null) as IsoDate | null,
      })),
    );
    const fields = {
      name: name.trim(),
      startsOn: from,
      endsOn: to,
      description: description.trim(),
      plan: money && planValue !== 'invalid' ? planValue : null,
      members,
      lead: lead ?? members[0]!,
    };
    setBusy(true);
    const res = edit
      ? await editProject(edit.id, {
          version: edit.version,
          ...fields,
          works: kept.map((w) => ({
            ...(w.id ? { id: w.id } : {}),
            name: w.name.trim(),
            executorId: w.executorId,
            due: w.due || null,
          })),
        })
      : await createProject({
          contractorId: preset?.id ?? cp,
          status,
          ...fields,
          works: cleaned.map((w) => ({
            name: w.name,
            executorId: w.executorEmployeeId,
            due: w.due,
          })),
        });
    setBusy(false);
    if (res.ok) {
      const target = edit ? edit.id : (ProjectSaved.safeParse(res.data).data?.id ?? null);
      if (!target) return void toast(t('err.unknown'), { bad: true });
      onClose();
      onDone(target, !edit);
      return void toast(t(edit ? 'proj.toast.saved' : 'proj.toast.created'), {
        icon: 'briefcase',
      });
    }
    if (isRecordChanged(res.error)) return setChanged(true);
    const field = fieldOf((res.error as { details?: unknown }).details);
    const message = errorText(res.error);
    // Поля «Контрагент» нет (окно из карточки контрагента или «Изменить») — отказ уведомлением.
    const hidden = field === 'contractor' && (!!preset || !!edit);
    if (field && !hidden) return setErrors({ [field]: message });
    toast(message, { bad: true });
  };

  const dirty =
    name !== (edit?.name ?? '') ||
    description !== (edit?.description ?? '') ||
    plan !== (edit?.money?.plan != null ? formatSom(edit.money.plan, 'auto') : '') ||
    works.length !== (edit?.works.length ?? 0) ||
    (!edit && !preset && cp !== '');

  const statusPill = edit ? statusPillView(t, 'project', edit.status) : null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="form"
      size="mid"
      dirty={dirty}
      title={t(edit ? 'proj.dlg.edit' : 'proj.dlg.new')}
      sub={preset ? preset.name : t('proj.dlg.sub')}
      footer={
        <>
          <button type="button" className={buttonClass('ghost')} onClick={onClose}>
            {t('proj.dlg.cancel')}
          </button>
          <button
            type="button"
            data-pd-ok=""
            className={buttonClass('cta')}
            disabled={busy || !form}
            onClick={() => void save()}
          >
            {t(edit ? 'proj.dlg.save' : 'proj.dlg.create')}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-3.5" data-project-dialog={edit?.id ?? 'new'}>
        {changed ? (
          <RecordChangedNotice
            message={t('err.record_changed')}
            reloadLabel={t('form.reload')}
            onReload={onClose}
            reloading={false}
          />
        ) : null}
        {failed ? <Note tone="bad">{failed}</Note> : null}
        {form ? (
          <FormGrid>
            <Field id={`${id}-name`} label={t('proj.dlg.name')} required full error={errors.name}>
              {(control) => (
                <input
                  {...control}
                  type="text"
                  data-pd-name=""
                  maxLength={300}
                  placeholder={t('proj.dlg.name_ph')}
                  className={inputClass()}
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    clear('name');
                  }}
                />
              )}
            </Field>
            {preset ? null : (
              <Field
                id={`${id}-cp`}
                label={t('proj.dlg.cp')}
                required
                full
                hint={t('proj.dlg.cp_hint')}
                error={errors.contractor}
              >
                {(control) => (
                  <ContractorSelect
                    {...control}
                    data-pd-cp=""
                    contractors={form.contractors}
                    value={cp}
                    empty={t('proj.dlg.cp_pick')}
                    onChange={(v) => {
                      // Прототип: выбор контрагента ответственных не меняет (у окна из карточки
                      // контрагента ответственный — его ответственный, иначе — тот, кто создаёт).
                      setCp(v);
                      clear('contractor');
                    }}
                  />
                )}
              </Field>
            )}
            <Field id={`${id}-from`} label={t('proj.dlg.from')} required>
              {(control) => (
                <input
                  {...control}
                  type="date"
                  data-pd-from=""
                  className={inputClass()}
                  value={from}
                  aria-invalid={errors.dates ? true : undefined}
                  onChange={(e) => {
                    setFrom(e.target.value);
                    clear('dates');
                  }}
                />
              )}
            </Field>
            {/* Прототип: ошибка дат — под «Срок по» (`setErr(el, 'pd-to', …)`). */}
            <Field id={`${id}-to`} label={t('proj.dlg.to')} required error={errors.dates}>
              {(control) => (
                <input
                  {...control}
                  type="date"
                  data-pd-to=""
                  className={inputClass()}
                  value={to}
                  onChange={(e) => {
                    setTo(e.target.value);
                    clear('dates');
                  }}
                />
              )}
            </Field>
            {edit && statusPill ? (
              <Field id={`${id}-st`} label={t('proj.dlg.status')} hint={t('proj.dlg.status_hint')}>
                <div id={`${id}-st`} className="pt-1.5">
                  <StatusPill {...statusPill} />
                </div>
              </Field>
            ) : (
              <Field id={`${id}-st`} label={t('proj.dlg.status')}>
                {(control) => (
                  <select
                    {...control}
                    data-pd-status=""
                    className={`${inputClass()} cursor-pointer`}
                    value={status}
                    onChange={(e) => setStatus(e.target.value as 'planned' | 'in_progress')}
                  >
                    <option value="planned">{t('status.project.planned')}</option>
                    <option value="in_progress">{t('status.project.in_progress')}</option>
                  </select>
                )}
              </Field>
            )}
            {money ? (
              <Field
                id={`${id}-plan`}
                label={t('proj.dlg.plan')}
                hint={
                  edit && paid
                    ? t('proj.dlg.plan_paid', { amount: formatSomWithUnit(paid) })
                    : t('proj.dlg.plan_hint')
                }
                error={errors.plan}
              >
                {(control) => (
                  <input
                    {...control}
                    type="text"
                    inputMode="decimal"
                    data-pd-plan=""
                    placeholder={t('proj.dlg.plan_ph')}
                    className={`${inputClass()} tabular-nums`}
                    value={plan}
                    onChange={(e) => {
                      setPlan(e.target.value);
                      clear('plan');
                    }}
                  />
                )}
              </Field>
            ) : (
              <div />
            )}
            <Field
              id={`${id}-resp`}
              label={t('proj.dlg.members')}
              required
              full
              hint={t('proj.dlg.members_hint')}
              error={errors.members}
            >
              <ChipMultiSelect
                id={`${id}-resp`}
                label={t('proj.dlg.members')}
                options={memberOptions}
                value={members}
                onChange={toggleMembers}
              />
            </Field>
            <Field id={`${id}-lead`} label={t('proj.dlg.lead')} error={errors.lead}>
              {(control) => (
                <select
                  {...control}
                  data-pd-lead=""
                  className={`${inputClass()} cursor-pointer`}
                  value={lead ?? ''}
                  onChange={(e) => {
                    setLead(e.target.value || null);
                    clear('lead');
                  }}
                >
                  {members.map((m) => (
                    <option key={m} value={m}>
                      {names.get(m) ?? ''}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <div />
            <Field id={`${id}-desc`} label={t('proj.dlg.desc')} full>
              {(control) => (
                <textarea
                  {...control}
                  data-pd-desc=""
                  maxLength={2000}
                  className={`${inputClass()} min-h-14 resize-y`}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              )}
            </Field>
            <Field
              id={`${id}-works`}
              label={t('proj.dlg.works')}
              full
              hint={t('proj.dlg.works_hint')}
              error={errors.works}
            >
              <div id={`${id}-works`} className="flex flex-col gap-2" data-pd-works="">
                {works.length ? (
                  <MiniTable
                    label={t('proj.dlg.works')}
                    empty=""
                    phoneCards={false}
                    columns={[
                      { key: 'name', label: t('proj.dlg.work.name') },
                      { key: 'exec', label: t('proj.dlg.work.exec') },
                      { key: 'due', label: t('proj.dlg.work.due') },
                      { key: 'del', label: '', numeric: true, width: 44 },
                    ]}
                    rows={works.map((w) => ({
                      key: w.key,
                      cells: {
                        name: (
                          <input
                            type="text"
                            data-pd-work-name=""
                            aria-label={t('proj.dlg.work.name')}
                            maxLength={300}
                            className={`${inputClass()} min-h-[30px] px-2 py-[3px]`}
                            value={w.name}
                            onChange={(e) => setWork(w.key, { name: e.target.value })}
                          />
                        ),
                        exec: (
                          <select
                            aria-label={t('proj.dlg.work.exec')}
                            data-pd-work-exec=""
                            className={`${inputClass()} min-h-[30px] cursor-pointer px-2 py-[3px]`}
                            value={w.executorId}
                            onChange={(e) => setWork(w.key, { executorId: e.target.value })}
                          >
                            {w.executorId && !form.employees.some((e) => e.id === w.executorId) ? (
                              <option value={w.executorId}>{names.get(w.executorId) ?? ''}</option>
                            ) : null}
                            {form.employees.map((e) => (
                              <option key={e.id} value={e.id}>
                                {e.name}
                              </option>
                            ))}
                          </select>
                        ),
                        due: (
                          <input
                            type="date"
                            aria-label={t('proj.dlg.work.due')}
                            data-pd-work-due=""
                            className={`${inputClass()} min-h-[30px] px-2 py-[3px]`}
                            value={w.due}
                            onChange={(e) => setWork(w.key, { due: e.target.value })}
                          />
                        ),
                        del: w.done ? (
                          <Pill tone="ok" size="sm">
                            {t('proj.dlg.work.done')}
                          </Pill>
                        ) : (
                          <button
                            type="button"
                            aria-label={t('proj.dlg.work.del')}
                            data-pd-work-del=""
                            className={iconButtonClass('sm')}
                            onClick={() => setWorks((list) => list.filter((x) => x.key !== w.key))}
                          >
                            <Icon name="trash" size="sm" />
                          </button>
                        ),
                      },
                    }))}
                  />
                ) : (
                  <span className="text-faint">{t('proj.dlg.works_none')}</span>
                )}
                <div>
                  <button
                    type="button"
                    data-pd-work-add=""
                    className={buttonClass('default', 'sm')}
                    onClick={addWork}
                  >
                    <Icon name="plus" size="sm" />
                    {t('proj.dlg.work_add')}
                  </button>
                </div>
              </div>
            </Field>
          </FormGrid>
        ) : null}
      </div>
    </Modal>
  );
}
