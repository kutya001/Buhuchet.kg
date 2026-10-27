import {
  contractorDictValues,
  contractorGkedDicts,
  contractorScope,
  employeeActive,
  findContractorByInn,
  orgMenuSettings,
  phoneCodes,
  type ContractorFields,
  type ContractorRecord,
  type Tx,
} from '@buhuchet/db';
import {
  bishkekDate,
  contractorFieldProblems,
  CONTRACTOR_MESSAGES,
  formatText,
  gkedCheck,
  gkedCheckTexts,
  gkedSignature,
  hasPermission,
  phoneProblem,
  innDuplicateMessage,
  innProblem,
  scopeOf,
  type AccessSubject,
  type ContractorGkedConfirmation,
  type GkedCheck,
  type GkedConfirmation,
  type GkedDicts,
  type GkedSubject,
  type Translate,
} from '@buhuchet/domain';
import { ApiError, type Contractor, type ContractorGkedNotes } from '@buhuchet/shared';
import type { SQL } from 'drizzle-orm';
import type { Context } from 'hono';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { apiFail } from '../../errors';
import { serverTexts } from '../l10n/texts';

export const error = { 'application/json': { schema: ApiError } };

/** Сегодня по Бишкеку — от часов приложения (`clock`), а не базы: так это проверяется тестом. */
export const todayOf = (deps: ApiDeps) => bishkekDate(deps.clock.now());

/** Сотрудник, который действует: его права (общий слой уже проверил право метода). */
export function subjectOf(c: Context<AppEnv>): AccessSubject {
  return c.get('access')!.subject;
}

/**
 * Область «Свои контрагенты» группы «Контрагенты»: условие для запросов (вне области — «не найден»).
 */
export function scopeSqlOf(subject: AccessSubject): SQL | undefined {
  return contractorScope(scopeOf(subject, 'cps') === 'own' ? subject.employeeId : null);
}

/**
 * Видит ли сотрудник плату за обслуживание: включена функция «Плата за обслуживание» в учётной
 * политике и есть право «Видеть плату за обслуживание» (прототип: feat('fee') && can('fee')).
 */
export async function feeVisible(tx: Tx, orgId: string, subject: AccessSubject): Promise<boolean> {
  if (!hasPermission(subject, 'fee')) return false;
  const { features } = await orgMenuSettings(tx, orgId);
  return features.fee;
}

/** Тексты словаря с подстановками — для сверки с ГКЭД словами. */
export async function translateOf(deps: ApiDeps): Promise<Translate> {
  const t = await serverTexts(deps);
  return (key, params) => formatText(t(key), params);
}

/** Контрагент для сверки с ГКЭД. */
function subjectFor(
  fields: Pick<ContractorFields, 'gked' | 'gkedExtra' | 'regimeCode' | 'regime2Code'> & {
    benefits: readonly string[];
  },
  form: GkedSubject['form'],
): GkedSubject {
  return {
    gked: fields.gked,
    gkedExtra: fields.gkedExtra,
    form,
    regimes: [fields.regimeCode, fields.regime2Code].filter((r): r is string => !!r),
    benefits: fields.benefits,
  };
}

/** Сохранённое подтверждение для сверки: имя того, кто подтвердил, — для текста. */
const confirmationFor = (
  c: ContractorGkedConfirmation | null,
  by: string,
): GkedConfirmation | null => c && { sig: c.sig, by, at: c.at, ask: c.ask };

/** Сверка словами для ответа API. */
export function notesOf(check: GkedCheck, ok: boolean, t: Translate): ContractorGkedNotes {
  const texts = gkedCheckTexts(check, t);
  return {
    ...texts,
    confirmNeeded: check.confirm.length > 0 && !ok,
    ask: check.confirm[0]?.ask ?? '',
  };
}

/** Сверка набранных значений с ГКЭД (форма до сохранения). */
export function checkSubject(
  dicts: GkedDicts,
  subject: GkedSubject,
  confirmation: GkedConfirmation | null,
  assigned: readonly string[] = [],
): { check: GkedCheck; ok: boolean } {
  const check = gkedCheck(subject, dicts, confirmation, assigned);
  const ok = !!confirmation && confirmation.sig === gkedSignature(subject, dicts.regimes);
  return { check, ok };
}

/**
 * Карточка для ответа API: моменты — строкой ISO, ставка — только тому, кто видит плату за
 * обслуживание, и сверка с ГКЭД словами по сохранённым значениям.
 */
export async function contractorOut(
  tx: Tx,
  r: ContractorRecord,
  options: { fee: boolean; t: Translate },
): Promise<Contractor> {
  const dicts = await contractorGkedDicts(
    tx,
    [r.gked?.code, ...r.gkedExtra.map((x) => x.code)].filter((c): c is string => !!c),
  );
  const subject = subjectFor(
    {
      gked: r.gked?.code ?? null,
      gkedExtra: r.gkedExtra.map((x) => x.code),
      regimeCode: r.regime?.code ?? null,
      regime2Code: r.regime2?.code ?? null,
      benefits: r.benefits.map((b) => b.code),
    },
    { code: r.form.code, declarationFor: r.form.declarationFor },
  );
  const confirmation = confirmationFor(r.gkedConfirmation, r.gkedConfirmation?.by ?? '');
  const { check, ok } = checkSubject(dicts, subject, confirmation);
  return {
    ...r,
    tariff: options.fee ? r.tariff : null,
    gkedConfirmation: r.gkedConfirmation && {
      by: r.gkedConfirmation.by,
      employeeId: r.gkedConfirmation.employeeId,
      at: r.gkedConfirmation.at,
      ask: r.gkedConfirmation.ask,
    },
    gkedNotes: notesOf(check, ok, options.t),
    audit: {
      createdAt: r.audit.createdAt.toISOString(),
      createdBy: r.audit.createdBy,
      updatedAt: r.audit.updatedAt.toISOString(),
      updatedBy: r.audit.updatedBy,
    },
  };
}

/** Поле, которое было у контрагента до правки (неизменённое значение может быть уже отключено). */
export interface ContractorBefore {
  id: string;
  fields: ContractorFields;
}

/** Код есть в справочнике и, если он новый у контрагента, действует; иначе — отказ 400 у поля. */
function checkValue(
  field: string,
  code: string | null,
  values: Map<string, boolean>,
  before: readonly (string | null)[],
): void {
  if (code === null) return;
  const active = values.get(code);
  if (active === undefined) apiFail(400, 'validation_failed', 'Нет такого значения', { field });
  if (!active && !before.includes(code)) {
    apiFail(400, 'value_inactive', CONTRACTOR_MESSAGES.value_inactive, { field });
  }
}

/**
 * Проверки сохранения контрагента — общие для создания и «Изменить» (ТЗ «Регистрация контрагентов»,
 * «Обязательные поля», «Необязательные поля»; прототип addCpDlg и editCpDlg): ИНН (формат и дубль по
 * всей организации, включая архив), телефон по справочнику кодов, поля, значения справочников (новое
 * значение — только действующее), основной и дополнительные ГКЭД — только подклассы, сверка с ГКЭД
 * (запрет режима — отказ, вопрос о праве на режим — отказ без «Подтверждаю»). Возвращает подтверждение,
 * которое нужно сохранить у контрагента.
 */
export async function checkContractor(
  tx: Tx,
  fields: ContractorFields,
  options: {
    before: ContractorBefore | null;
    gkedConfirm: boolean;
    employeeId: string;
    today: string;
    t: Translate;
  },
): Promise<ContractorGkedConfirmation | null> {
  const { before } = options;
  const inn = innProblem(fields.inn);
  if (inn) apiFail(400, inn, CONTRACTOR_MESSAGES[inn], { field: 'inn' });
  const phone = phoneProblem(fields.phone, await phoneCodes(tx));
  if (phone) apiFail(400, 'invalid_phone', phone, { field: 'phone' });
  const [problem] = contractorFieldProblems(fields);
  if (problem) {
    apiFail(400, problem.problem, CONTRACTOR_MESSAGES[problem.problem], { field: problem.field });
  }

  const codes = [fields.gked, ...fields.gkedExtra].filter((c): c is string => !!c);
  const values = await contractorDictValues(tx, {
    forms: [fields.formCode],
    regimes: [fields.regimeCode, fields.regime2Code].filter((c): c is string => !!c),
    benefits: fields.benefits.map((b) => b.code),
    bases: fields.bases,
    taxOffices: fields.taxOfficeCode ? [fields.taxOfficeCode] : [],
    gked: codes,
  });
  const was = before?.fields;
  const form = values.forms.get(fields.formCode);
  checkValue(
    'formCode',
    fields.formCode,
    new Map([...values.forms].map(([k, v]) => [k, v.active])),
    [was?.formCode ?? null],
  );
  const regimesBefore = [was?.regimeCode ?? null, was?.regime2Code ?? null];
  checkValue('regimeCode', fields.regimeCode, values.regimes, regimesBefore);
  checkValue('regime2Code', fields.regime2Code, values.regimes, regimesBefore);
  checkValue('taxOfficeCode', fields.taxOfficeCode, values.taxOffices, [
    was?.taxOfficeCode ?? null,
  ]);
  const benefitsBefore = was?.benefits.map((b) => b.code) ?? [];
  for (const b of fields.benefits) checkValue('benefits', b.code, values.benefits, benefitsBefore);
  for (const code of fields.bases) checkValue('bases', code, values.bases, was?.bases ?? []);
  const gkedBefore = [was?.gked ?? null, ...(was?.gkedExtra ?? [])];
  for (const [field, code] of [
    ['gked', fields.gked],
    ...fields.gkedExtra.map((c) => ['gkedExtra', c] as const),
  ] as const) {
    if (!code) continue;
    const node = values.gked.get(code);
    if (!node) apiFail(400, 'validation_failed', 'Нет такого кода ГКЭД', { field });
    if (node.level !== 'subclass') {
      apiFail(400, 'gked_not_subclass', CONTRACTOR_MESSAGES.gked_not_subclass, { field });
    }
    if (!node.active && !gkedBefore.includes(code)) {
      apiFail(400, 'gked_inactive', CONTRACTOR_MESSAGES.gked_inactive, { field });
    }
  }

  const duplicate = await findContractorByInn(tx, fields.inn, before?.id);
  if (duplicate) {
    const mode = before ? 'edit' : 'create';
    apiFail(409, 'inn_duplicate', innDuplicateMessage(duplicate, mode), {
      field: 'inn',
      id: duplicate.id,
      name: duplicate.name,
      archived: duplicate.archived,
      ...(duplicate.archived ? { variant: before ? 'archived_edit' : 'archived' } : {}),
    });
  }

  const dicts = await contractorGkedDicts(tx, codes);
  const subject = subjectFor(
    { ...fields, benefits: fields.benefits.map((b) => b.code) },
    form ? { code: fields.formCode, declarationFor: form.declarationFor } : null,
  );
  const stored = was?.gkedConfirmation ?? null;
  const { check, ok } = checkSubject(dicts, subject, confirmationFor(stored, ''));
  if (check.block.length) {
    const texts = gkedCheckTexts(check, options.t);
    apiFail(400, 'gked_blocked', options.t('err.gked_blocked'), {
      field: 'regimeCode',
      notes: texts.block,
    });
  }
  if (!check.confirm.length) return null;
  if (ok) return stored;
  const ask = check.confirm[0]!.ask;
  if (!options.gkedConfirm) {
    const notes = notesOf(check, false, options.t);
    apiFail(400, 'gked_confirm_required', options.t('err.gked_confirm_required'), {
      field: 'regimeCode',
      ask,
      notes: notes.regime,
    });
  }
  return {
    sig: gkedSignature(subject, dicts.regimes),
    employeeId: options.employeeId,
    at: options.today,
    ask,
  };
}

/** Ответственный — сотрудник организации и не заблокирован. */
export async function checkResponsible(tx: Tx, employeeId: string): Promise<void> {
  const active = await employeeActive(tx, employeeId);
  if (active === null) {
    apiFail(400, 'validation_failed', 'Нет такого сотрудника', { field: 'responsibleEmployeeId' });
  }
  if (!active) {
    apiFail(400, 'responsible_inactive', CONTRACTOR_MESSAGES.responsible_inactive, {
      field: 'responsibleEmployeeId',
    });
  }
}
