import {
  bishkekDate,
  bishkekTime,
  dmOutRows,
  dmText,
  formatCount,
  formatDateRu,
  pluralForm,
  type DmColumnType,
} from '@buhuchet/domain';
import type {
  DmAdminTemplateCard,
  DmTemplateCheckResult,
  DmTemplateColumnInput,
  DmTemplateCreate,
  DmTemplateParamInput,
} from '@buhuchet/shared';
import type { IconName, MiniColumn, MiniRow, Pill, TimelineItem } from '@buhuchet/ui';
import type { ComponentProps } from 'react';
import type { Translate } from '../l10n/translate';

type PillTone = NonNullable<ComponentProps<typeof Pill>['tone']>;

/*
 * Админка → «Витрина данных» → «Шаблоны» (доработки 20.11.2026: Витрина данных, блок 2, пункты 2–7;
 * блок 3, пункт 1; общий план 20.11, этап 2, П7; прототип v155 `renderDmTplAdm`, `dmEdit`,
 * `dmStateDlg`): что вводится в окно шаблона, что уходит на сервер, когда «Опубликовать» доступно,
 * куда встаёт отказ сервера, строки проверки и истории. Сами правила запроса и столбцов — домен
 * (`editor.ts`) и сервер (тред сборки).
 */

type DmTemplateState = DmAdminTemplateCard['state'];

/** Пометка состояния (прототип `DB.ref.statuses.dmTemplate`). */
export const TPL_PILL: Readonly<Record<DmTemplateState, { tone: PillTone; icon: IconName }>> = {
  draft: { tone: 'plain', icon: 'edit' },
  published: { tone: 'ok', icon: 'check' },
  off: { tone: 'plain', icon: 'ban' },
  broken: { tone: 'bad', icon: 'alert' },
};

/** Подпись типа параметра (прототип `DM_PT`): в ключах словаря нет «:» — «list:cp» → «list_cp». */
export const TPL_PARAM_TYPE_KEY = {
  date: 'dm.ptype.date',
  month: 'dm.ptype.month',
  year: 'dm.ptype.year',
  num: 'dm.ptype.num',
  text: 'dm.ptype.text',
  bool: 'dm.ptype.bool',
  'list:cp': 'dm.ptype.list_cp',
  'list:emp': 'dm.ptype.list_emp',
  'list:rtype': 'dm.ptype.list_rtype',
  'list:status': 'dm.ptype.list_status',
} as const satisfies Record<DmTemplateParamInput['type'], string>;

/** Что вводит администратор в окне шаблона (прототип `dmEdit` → `st`). */
export interface TplDraft {
  name: string;
  code: string;
  description: string;
  audience: DmAdminTemplateCard['audience'];
  module: NonNullable<DmAdminTemplateCard['module']>;
  needPermission: DmAdminTemplateCard['needPermission'];
  access: DmAdminTemplateCard['access'];
  orgIds: string[];
  query: string;
  params: DmTemplateParamInput[];
  columns: DmTemplateColumnInput[];
}

/** Запрос нового шаблона (прототип `dmEdit(null)`). */
export const TPL_NEW_QUERY =
  'SELECT c.id AS contractor_id, c.name AS cp\nFROM contractors c\nORDER BY c.name';

/**
 * Окно по шаблону с сервера или новое (прототип: «Отчеты для сдачи», «Все организации», запрос по
 * контрагентам и два столбца — «Контрагент (для области)» и «Контрагент»).
 */
export function tplDraftOf(t: Translate, card: DmAdminTemplateCard | null): TplDraft {
  if (!card) {
    return {
      name: '',
      code: '',
      description: '',
      audience: 'org',
      module: 'reports',
      needPermission: null,
      access: 'all',
      orgIds: [],
      query: TPL_NEW_QUERY,
      params: [],
      columns: [
        { code: 'contractor_id', name: t('dm.ed.cp_col'), type: 'cp', total: false },
        { code: 'cp', name: t('dm.ed.cp_name'), type: 'text', total: false },
      ],
    };
  }
  return {
    name: card.name,
    code: card.code,
    description: card.description ?? '',
    audience: card.audience,
    module: card.module ?? 'reports',
    needPermission: card.needPermission,
    access: card.access,
    orgIds: [...card.orgIds],
    query: card.query,
    params: card.params.map((p) => ({ ...p })),
    columns: card.columns.map((c) => ({ ...c })),
  };
}

/**
 * Запрос, прошедший «Проверить» (прототип `okSql`): у проверенного шаблона с сервера — его запрос,
 * у нового и непроверенного — пока ничего.
 */
export const tplCheckedQuery = (card: DmAdminTemplateCard | null): string | null =>
  card && card.checkedAt ? card.query : null;

/** «Опубликовать» доступно, только когда проверен именно этот текст запроса (прототип `ok()`). */
export const tplQueryChecked = (checked: string | null, query: string): boolean =>
  checked !== null && checked === query;

/** Опубликованный в смысле правки (прототип `pub`): код и вид не меняются, столбцы только добавляются. */
export const tplLocked = (card: DmAdminTemplateCard | null): boolean => !!card && card.locked;

/** Код шаблона — как на сервере (`DM_CODE_RE`, прототип `/^[a-z0-9][a-z0-9-]{1,48}$/`). */
export const TPL_CODE_RE = /^[a-z0-9][a-z0-9-]{1,59}$/;

export type TplField = 'name' | 'code' | 'query' | 'audience' | 'module';

/** Что не так с полями до запроса к серверу (прототип `save`: название, код). */
export type TplFieldProblem = 'dm.ed.name_req' | 'dm.ed.code_req' | 'dm.ed.code_bad';

export function tplFieldProblems(draft: TplDraft): Partial<Record<TplField, TplFieldProblem>> {
  const out: Partial<Record<TplField, TplFieldProblem>> = {};
  if (!draft.name.trim()) out.name = 'dm.ed.name_req';
  const code = draft.code.trim();
  if (!code) out.code = 'dm.ed.code_req';
  else if (!TPL_CODE_RE.test(code)) out.code = 'dm.ed.code_bad';
  return out;
}

/** «Выбранные организации» без единой отмеченной (прототип: уведомление, а не поле). */
export const tplOrgsMissing = (draft: TplDraft): boolean =>
  draft.audience === 'org' && draft.access === 'selected' && draft.orgIds.length === 0;

/**
 * Что уходит в «Сохранить» и «Опубликовать» (схема `DmTemplateCreate`): у шаблона Админки модуль,
 * право и доступ не важны (прототип: `mod: null`, `perm: null`, `access: 'all'`).
 */
export function tplBody(
  draft: TplDraft,
  opts: { publish: boolean; checkOrgId: string | null },
): DmTemplateCreate {
  const org = draft.audience === 'org';
  return {
    name: draft.name.trim(),
    code: draft.code.trim(),
    description: draft.description.trim() ? draft.description : null,
    audience: draft.audience,
    module: org ? draft.module : null,
    needPermission: org ? draft.needPermission : null,
    access: org ? draft.access : 'all',
    orgIds: org && draft.access === 'selected' ? draft.orgIds : [],
    query: draft.query,
    params: draft.params.map((p) => ({ ...p, name: p.name.trim() || p.code })),
    columns: draft.columns.map((c) => ({ ...c, name: c.name.trim() || c.code })),
    publish: opts.publish,
    checkOrgId: org ? opts.checkOrgId : null,
  };
}

/** Что изменилось с открытия окна (протяжка вниз и «Назад» спрашивают «Закрыть без сохранения?»). */
export const tplDirty = (draft: TplDraft, initial: TplDraft): boolean =>
  JSON.stringify(draft) !== JSON.stringify(initial);

/**
 * Окно после «Проверить» (прототип `syncPars` и столбцы ответа): параметры и столбцы — как прислал
 * сервер (он уже свёл их с окном); не прошла — только параметры, если запрос разобрался.
 */
export function tplAfterCheck(draft: TplDraft, result: DmTemplateCheckResult): TplDraft {
  return result.ok
    ? { ...draft, params: result.params, columns: result.columns }
    : { ...draft, params: result.params.length ? result.params : draft.params };
}

/**
 * Куда встаёт отказ сервера при сохранении (прототип `setErr`): запрос и проверка — под «Запросом»,
 * код и вид — под своими полями; остальное — уведомлением.
 */
export function tplErrorField(code: string): TplField | null {
  if (code.startsWith('dm_sql_') || code.startsWith('dm_check_') || code === 'dm_param_missing')
    return 'query';
  if (code === 'dm_code_taken' || code === 'dm_code_locked') return 'code';
  if (code === 'dm_kind_locked') return 'audience';
  if (code === 'dm_module_required') return 'module';
  return null;
}

/** Строка итога «Проверить» (прототип: «Запрос выполнен на «…»: строк N, M мс; ниже первые 100»). */
export function tplCheckText(
  t: Translate,
  result: Extract<DmTemplateCheckResult, { ok: true }>,
): string {
  const n = `${formatCount(result.n)}${result.more ? '+' : ''}`;
  const head = result.orgName
    ? t('dm.ed.check_ok', { org: result.orgName, n, ms: result.ms })
    : t('dm.ed.check_ok_adm', { n, ms: result.ms });
  return result.n > result.rows.length ? `${head}${t('dm.ed.check_first')}` : head;
}

const NUMERIC: ReadonlySet<DmColumnType> = new Set(['num', 'money']);

/**
 * Первые строки проверки таблицей (прототип `.dm-prev`): столбец «Контрагент (для области)» не
 * показывается, деньги — сомами, даты — как на экране.
 */
export function tplCheckTable(
  result: Extract<DmTemplateCheckResult, { ok: true }>,
  texts: { yes: string; no: string },
): { columns: MiniColumn[]; rows: MiniRow[] } {
  const shown = result.columns
    .map((col, index) => ({ col, index }))
    .filter((x) => x.col.type !== 'cp');
  return {
    columns: shown.map(({ col }) => ({
      key: col.code,
      label: col.name,
      numeric: NUMERIC.has(col.type),
    })),
    rows: dmOutRows(result.columns, result.rows).map((row) => ({
      key: String(row.i),
      cells: Object.fromEntries(
        shown.map(({ col, index }) => [col.code, dmText(col.type, row.v[index] ?? null, texts)]),
      ),
    })),
  };
}

/** «История · N» окна (прототип: последние 12, сверху новые — сервер отдаёт новые первыми). */
export function tplHistoryItems(card: DmAdminTemplateCard): TimelineItem[] {
  return card.history.slice(0, 12).map((h, i) => {
    const d = new Date(h.at);
    return {
      id: `${h.at}-${i}`,
      date: formatDateRu(bishkekDate(d)),
      time: bishkekTime(d),
      text: h.what,
      who: h.who,
    };
  });
}

/** «Действующих токенов: 3 в 2 организациях — они перестанут отвечать.» (прототип `dmStateDlg`). */
export function tplOffText(t: Translate, toks: number, tokOrgs: number): string {
  const head = t('dm.tpl.off.text');
  if (!toks) return head;
  return `${head} ${t('dm.tpl.off.toks', {
    n: toks,
    orgs: t(`dm.tpl.in_orgs.${pluralForm(tokOrgs)}`, { n: tokOrgs }),
  })}`;
}

/** «У шаблона 3 действующих токена в 2 организациях: их программы сразу получат новый результат.» */
export function tplSaveWarnText(t: Translate, toks: number, tokOrgs: number): string {
  return t('dm.ed.warn_text', {
    toks: t(`dm.ed.toks.${pluralForm(toks)}`, { n: toks }),
    orgs: t(`dm.tpl.in_orgs.${pluralForm(tokOrgs)}`, { n: tokOrgs }),
  });
}

/**
 * Таблицы и поля базы — подсказка окна (прототип `DM_HINT`, `DM_HINT_ADM`). Таблица `sessions` в
 * продукте закрыта для роли Витрины совсем (`DM_CLOSED_TABLES`), поэтому её в подсказке нет.
 */
export const TPL_HINT: readonly (readonly [string, string])[] = [
  [
    'contractors',
    'id, name, inn, form_code, regime_code, responsible_employee_id, service_status, start_date, kind',
  ],
  [
    'reports',
    'contractor_id, report_type_code, period, due_date, pay_due, status, amount, paid, responsible_employee_id, superseded',
  ],
  ['report_types', 'code, name, short_name'],
  ['money_operations', 'contractor_id, kind, amount, op_date, note, cancelled_at'],
  ['fee_payments', 'contractor_id, amount, paid_on, deleted_at'],
  ['fee_allocations', 'payment_id, month, amount'],
  ['contractor_tariffs', 'contractor_id, amount, period, valid_from'],
  ['contractor_service_periods', 'contractor_id, from_month, to_month'],
  ['projects', 'contractor_id, name, starts_on, ends_on, plan, status'],
  ['project_payments', 'project_id, amount, paid_on, deleted_at'],
  ['one_off_services', 'contractor_id, name, service_date, amount, deleted_at'],
  ['one_off_service_payments', 'service_id, amount, paid_on, deleted_at'],
  ['indicators', 'name, unit, sort_order'],
  ['indicator_values', 'contractor_id, indicator_id, month, value'],
  ['tasks', 'title, contractor_id, executor_employee_id, due_date, status'],
  ['employees', 'short_name, full_name, active'],
];

export const TPL_HINT_ADMIN: readonly (readonly [string, string])[] = [
  ['organizations', 'name, status, is_demo'],
  ['platform_leads', 'created_at, firm, size, status'],
  ['telegram_outbox', 'created_at, status'],
  ['scheduler_runs', 'job, started_at, ok'],
];

export const tplHint = (audience: TplDraft['audience']) =>
  audience === 'admin' ? [...TPL_HINT_ADMIN, ...TPL_HINT] : TPL_HINT;
