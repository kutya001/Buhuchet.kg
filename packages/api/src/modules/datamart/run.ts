import {
  DM_ROWS_MAX,
  dmErrorOf,
  dmParamDefsOf,
  logDmRequest,
  runDmAdmin,
  runDmOrg,
  withOrgContext,
  withUserContext,
  type DmOutputTemplate,
  type DmRequestEntry,
  type DmResult,
  type DmTemplateColumn,
} from '@buhuchet/db';
import {
  dmBind,
  dmContractorColumn,
  dmScopeQuery,
  formatText,
  type IsoDate,
} from '@buhuchet/domain';
import type { ApiDeps } from '../../deps';
import { serverTexts } from '../l10n/texts';

/*
 * Общий путь одного запроса шаблона «Витрины данных» (доработки 20.11.2026: Витрина данных, блок 8,
 * пункт 1; общий план 20.11, этап 2, П4): один и тот же у «Вывода» (организация и Админка) и у
 * внешнего адреса по токену (поток Т, П11).
 *   1. Кто просит — решил вызывающий: сотрудник по сеансу, праву и области или внешняя программа по
 *      токену; шаблон и его текст он уже получил (`dmOutputTemplate` + `dmTemplateQuery` или факты
 *      токена).
 *   2. Параметры проверяются по типам, лишние отбрасываются (`dmBind`).
 *   3. Сотруднику с областью «Свои» — только строки его контрагентов (`dmScopeQuery`).
 *   4. Исполнитель Витрины (0166): только чтение, своя роль базы, организация — из контекста, пределы
 *      времени и строк.
 *   5. Запрос пишется в журнал (`app.dm_request_log`, 0171) своей транзакцией: запуск откатывается.
 * Столбцы ответа — столбцы шаблона без «Контрагента» в порядке шаблона; значения — как их отдала база
 * (деньги — тыйыны: «Вывод» показывает «1 250,50», внешний ответ переводит в сомы `dmCell`).
 */

/** От чьего имени выполняется шаблон. */
export type DmRunWho =
  /**
   * Организация: сотрудник с сеанса, администратор платформы «глазами организации» или создатель
   * токена (у токена — организация токена).
   */
  | { kind: 'org'; orgId: string; userId: string | null }
  /** Шаблон «Для администратора»: администратор платформы (у токена Админки — его создатель). */
  | { kind: 'admin'; adminId: string };

export interface DmRunRequest {
  template: DmOutputTemplate;
  /** Текст запроса шаблона (только сервер). */
  query: string;
  /** Что пришло: с экрана — тело запроса, по токену — адрес `?month=…`. */
  input: Readonly<Record<string, string | null | undefined>>;
  who: DmRunWho;
  /** Контрагенты области «Свои» (`dmOwnContractorIds`); null — все строки организации. */
  ownContractorIds: readonly string[] | null;
  via: 'screen' | 'api';
  tokenId: string | null;
  ip: string | null;
  /** Сколько строк отдать (1…50 000): «Вывод» — 50 000, внешний адрес — страница. */
  maxRows: number;
  /** «Сегодня» по Бишкеку — для значений параметров по умолчанию. */
  today: IsoDate;
  /** Предел времени запроса, мс (не больше 15 с; тесты — меньше). */
  timeoutMs?: number;
}

export type DmRunOutcome =
  | {
      ok: true;
      /** Столбцы шаблона без «Контрагента», в порядке шаблона. */
      columns: DmTemplateColumn[];
      rows: unknown[][];
      more: boolean;
      ms: number;
    }
  /** «Неверный параметр: <какой>» (блок 6, пункт 5): код параметра и почему. */
  | { ok: false; outcome: 'bad_param'; param: string; why: 'type' | 'required' | 'range' }
  /** «Запрос выполнялся слишком долго» (блок 4, пункт 3). */
  | { ok: false; outcome: 'timeout' }
  /**
   * Шаблон не выполнился («Шаблон временно не работает»). `adminDetail` — текст базы: показывается
   * только администратору платформы (методы Админки); организации и внешней программе — никогда.
   */
  | { ok: false; outcome: 'error'; adminDetail: string };

/** Код ошибки PostgreSQL «запрос прерван по пределу времени». */
const QUERY_CANCELED = '57014';

/** Столбец «Контрагент» — не показывается (прототип `t.cols.filter(c => c.type !== 'cp')`). */
const shownColumn = (c: DmTemplateColumn) => !c.contractor && c.type !== 'cp';

/** Параметры для журнала: только параметры шаблона, как пришли. */
function loggedParams(
  template: DmOutputTemplate,
  input: DmRunRequest['input'],
): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const p of template.params) {
    if (!Object.hasOwn(input, p.code)) continue;
    const v = input[p.code];
    if (typeof v === 'string' || v === null) out[p.code] = v;
  }
  return out;
}

/** Строка журнала от имени того, кто просил (своя транзакция, после запуска). */
export async function logDmRun(
  deps: ApiDeps,
  who: DmRunWho,
  entry: DmRequestEntry,
): Promise<number> {
  return who.kind === 'org'
    ? withOrgContext(deps.db, { orgId: who.orgId, userId: who.userId }, (tx) =>
        logDmRequest(tx, entry),
      )
    : withUserContext(deps.db, who.adminId, (tx) => logDmRequest(tx, entry));
}

/**
 * Выполнить шаблон и записать запрос в журнал. Ошибки базы, которых не ждём (нет связи), уходят
 * дальше — их отвечает общий обработчик.
 */
export async function runDmTemplate(deps: ApiDeps, r: DmRunRequest): Promise<DmRunOutcome> {
  const t = await serverTexts(deps);
  const admin = r.who.kind === 'admin';
  const params = loggedParams(r.template, r.input);
  const entry = (e: Pick<DmRequestEntry, 'outcome' | 'rows' | 'ms' | 'error'>): DmRequestEntry => ({
    via: r.via,
    templateId: r.template.id,
    tokenId: r.tokenId,
    params,
    ip: r.ip,
    ...e,
  });
  // Текст базы в журнале — только у шаблона Админки: строки журнала организации видит она сама
  // (в том числе запуск администратора «глазами организации»).
  const brokenText = (detail: string) =>
    admin ? `${t('err.dm_template_broken')}: ${detail}` : t('err.dm_template_broken');
  const failed = async (detail: string): Promise<DmRunOutcome> => {
    await logDmRun(
      deps,
      r.who,
      entry({ outcome: 'error', rows: null, ms: null, error: brokenText(detail) }),
    );
    return { ok: false, outcome: 'error', adminDetail: detail };
  };

  const bound = dmBind(r.query, dmParamDefsOf(r.template.params), r.input, r.today);
  if (!bound.ok) {
    if (bound.error === 'sql') return failed(`запрос: ${bound.problem}`);
    const name = r.template.params.find((p) => p.code === bound.param)?.name ?? bound.param;
    await logDmRun(
      deps,
      r.who,
      entry({
        outcome: 'bad_param',
        rows: null,
        ms: null,
        error: formatText(t('err.dm_bad_param'), { param: name }),
      }),
    );
    return { ok: false, outcome: 'bad_param', param: bound.param, why: bound.why };
  }

  let text = bound.text;
  if (r.ownContractorIds) {
    const cp = dmContractorColumn(r.template.columns);
    // Шаблон без «Контрагента» сотруднику со «Свои» не виден (`dmTemplateSeen`): сюда он не доходит.
    if (!cp) return failed('нет столбца «Контрагент» для области «Свои»');
    text = dmScopeQuery(text, cp, r.ownContractorIds);
  }

  const q = { text, params: bound.params, maxRows: r.maxRows, timeoutMs: r.timeoutMs };
  let res: DmResult;
  try {
    res =
      r.who.kind === 'org'
        ? await runDmOrg(deps.db, { orgId: r.who.orgId, userId: r.who.userId }, q)
        : await runDmAdmin(deps.db, r.who.adminId, q);
  } catch (err) {
    const pg = dmErrorOf(err);
    if (!pg) throw err;
    if (pg.code === QUERY_CANCELED) {
      await logDmRun(
        deps,
        r.who,
        entry({ outcome: 'timeout', rows: null, ms: null, error: t('err.dm_timeout') }),
      );
      return { ok: false, outcome: 'timeout' };
    }
    return failed(`${pg.code}: ${pg.message}`);
  }

  const columns = r.template.columns.filter(shownColumn);
  const at = columns.map((c) => res.columns.indexOf(c.code));
  const missing = columns.filter((_, i) => at[i]! < 0).map((c) => c.code);
  if (missing.length > 0) return failed(`в ответе запроса нет столбцов: ${missing.join(', ')}`);
  const rows = res.rows.map((row) => at.map((i) => row[i]));
  await logDmRun(deps, r.who, entry({ outcome: 'ok', rows: rows.length, ms: res.ms, error: null }));
  return { ok: true, columns, rows, more: res.more, ms: res.ms };
}

export { DM_ROWS_MAX };
