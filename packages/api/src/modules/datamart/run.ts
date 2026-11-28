import {
  DM_ROWS_MAX,
  dmErrorOf,
  dmParamDefsOf,
  logDmRequest,
  releaseRateLimit,
  runDmAdmin,
  runDmOrg,
  takeRateLimit,
  withOrgContext,
  withUserContext,
  type DmOutputTemplate,
  type DmRequestEntry,
  type DmResult,
  type DmTemplateColumn,
  type RateLimit,
} from '@buhuchet/db';
import {
  dmBind,
  dmContractorColumn,
  dmScopeQuery,
  formatText,
  type DmQueryProblem,
  type DmSqlProblem,
  type IsoDate,
} from '@buhuchet/domain';
import type { ApiDeps } from '../../deps';
import { apiFail } from '../../errors';
import { serverTexts } from '../l10n/texts';
import { dmPublishedSqlProblem } from './sql-check';

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
  /**
   * Место пула запусков уже взято вызывающим (`withDmPoolSlot`): «В Excel» берёт его до места выгрузки,
   * чтобы занятый пул не тратил одну из 20 выгрузок в час.
   */
  poolHeld?: boolean;
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

/** Текст словаря с подстановками (`t` — тексты `serverTexts`). */
export type DmTr = (key: string, params?: Record<string, string | number>) => string;

/**
 * Что не так с текстом запроса — словами словаря (прототип `dmSqlErr`): проверка окна
 * (`dmQueryProblem`) и разбор для исполнителя (`dmBind` → `DmSqlProblem`). Видит только администратор
 * платформы: ответ «Проверить», «Проверен» окна шаблона, подробности ответа Админке.
 */
export function dmSqlProblemText(tr: DmTr, p: DmQueryProblem | DmSqlProblem): string {
  if ('code' in p) {
    if (p.code === 'forbidden') return tr('err.dm_sql_forbidden', { word: p.word });
    if (p.code === 'syntax') return tr('err.dm_sql_syntax', { error: p.error });
    return tr(`err.dm_sql_${p.code}`);
  }
  return p.problem === 'unknown_param'
    ? tr('err.dm_param_missing', { param: p.name })
    : tr(`err.dm_sql_${p.problem}`);
}

/**
 * Запусков шаблонов с экрана одновременно на весь сайт — «Показать» всех организаций, Админки и
 * «Проверить» вместе (защита строже ТЗ, п. О-96): каждый держит соединение пула до 15 с, а пул — 5
 * соединений (`DATABASE_POOL_MAX`); пятерых, нажавших «Показать» на тяжёлом шаблоне, иначе хватило бы,
 * чтобы сайт встал для всех (п. О-46). Внешний адрес по токену — своим пределом потока Т (п. Т-20:
 * ответ «Слишком часто, повторите через N секунд» по ТЗ, блок 6, пункты 4–5). Места — строки
 * `rate_limits` вида `dm_run_all` с арендой: упавший процесс отпускает своё через `leaseSeconds`.
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#О-96 — предела одновременных запусков на весь сайт нет в ТЗ и прототипе.
export const DM_RUN_SLOTS = 2;
export const DM_RUN_ALL_LIMIT: RateLimit = {
  kind: 'dm_run_all',
  max: 1_000_000,
  windowSeconds: 60,
  leaseSeconds: 30,
};

/**
 * Таблица из ошибки «нет права» базы (`permission denied for table x`): у роли организаций закрыты
 * таблицы платформы — консоль «как организация» и «Проверить» шаблона «Для организаций» говорят это
 * словами (прототип v167: «Таблица X — данные платформы, организациям закрыта»). Не та ошибка — null.
 */
export function dmClosedTableOf(message: string): string | null {
  const m = /^permission denied for (?:table|view|relation) "?([a-z_][a-z0-9_]*)"?$/.exec(message);
  return m ? m[1]! : null;
}

/** Выполнить `run` на свободном месте; свободных нет — 429 `dm_busy_all` (вне транзакций). */
export async function withDmPoolSlot<T>(
  deps: ApiDeps,
  t: (key: string) => string,
  run: () => Promise<T>,
): Promise<T> {
  for (let i = 0; i < DM_RUN_SLOTS; i += 1) {
    const subject = `slot:${i}`;
    const slot = await takeRateLimit(deps.db, DM_RUN_ALL_LIMIT, subject);
    if (!slot.ok) continue;
    try {
      return await run();
    } finally {
      await releaseRateLimit(deps.db, DM_RUN_ALL_LIMIT, subject, slot.ticket).catch(
        (err: unknown) => deps.logger.error({ err }, 'витрина: место запуска не отпущено'),
      );
    }
  }
  return apiFail(429, 'dm_busy_all', t('err.dm_busy_all'));
}

/** Шаблоны, о которых журнал уже сказал «не из списка разрешённых функций» (`dmPublishedSqlProblem`). */
const missLogged = new Set<string>();

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
  const tr: DmTr = (key, values) => formatText(t(key), values ?? {});
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
    if (bound.error === 'sql') return failed(dmSqlProblemText(tr, bound));
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

  const denied = await dmPublishedSqlProblem(bound.text, (miss) => {
    // Строка журнала — раз на шаблон и процесс: шаблон по токену зовут тысячи раз в день.
    if (missLogged.has(r.template.id)) return;
    missLogged.add(r.template.id);
    deps.logger.warn(
      { template: r.template.code, rule: miss },
      'витрина: опубликованный шаблон не проходит список разрешённых функций',
    );
  });
  if (denied) return failed(dmSqlProblemText(tr, denied));

  let text = bound.text;
  if (r.ownContractorIds) {
    const cp = dmContractorColumn(r.template.columns);
    // Шаблон без «Контрагента» сотруднику со «Свои» не виден (`dmTemplateSeen`): сюда он не доходит.
    if (!cp) return failed(tr('err.dm_run_no_cp'));
    text = dmScopeQuery(text, cp, r.ownContractorIds);
  }

  const q = { text, params: bound.params, maxRows: r.maxRows, timeoutMs: r.timeoutMs };
  let res: DmResult;
  try {
    const who = r.who;
    const exec = () =>
      who.kind === 'org'
        ? runDmOrg(deps.db, { orgId: who.orgId, userId: who.userId }, q)
        : runDmAdmin(deps.db, who.adminId, q);
    res = r.via === 'api' || r.poolHeld ? await exec() : await withDmPoolSlot(deps, t, exec);
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
  if (missing.length > 0) {
    return failed(tr('err.dm_run_missing', { columns: missing.join(', ') }));
  }
  const rows = res.rows.map((row) => at.map((i) => row[i]));
  await logDmRun(deps, r.who, entry({ outcome: 'ok', rows: rows.length, ms: res.ms, error: null }));
  return { ok: true, columns, rows, more: res.more, ms: res.ms };
}

export { DM_ROWS_MAX };
