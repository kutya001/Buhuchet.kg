import {
  dmBrokenTemplates,
  dmCheckDue,
  dmCheckMark,
  dmErrorOf,
  runDmAdmin,
  runDmOrg,
  type DmCheckItem,
  type Tx,
} from '@buhuchet/db';
import {
  bishkekDate,
  dmBind,
  dmQueryProblem,
  dmResultColumnsProblem,
  formatText,
} from '@buhuchet/domain';
import type { Job, JobContext } from '../../deps';
import { alertTexts, sendPlatformAlert, type AlertTexts } from '../../jobs/alerts';
import { putBell } from '../telegram/bell';
import { DM_ROWS_MAX } from './run';

/*
 * «Витрина: проверка шаблонов» (доработки 20.11.2026: Витрина данных, блок 8, пункт 7; общий план 20.11,
 * этап 2, П4; docs/decisions.md п. О-66): после выпуска с миграциями и каждую ночь каждый опубликованный и
 * сломанный шаблон запускается так же, как его запускает «Вывод»: шаблон организаций — на
 * демо-организации без вошедшего, шаблон Админки — от имени администратора платформы; параметры — по
 * умолчанию, обязательный без значения — пустой (как «Проверить»). Не выполнился — «Сломан» (организации
 * видят «Шаблон временно не работает», токены — остановлены) и сообщение администраторам платформы в
 * Telegram; строку их колокольчика кладёт его чтение (`dmBellSync`). Снова выполняется — «Опубликован».
 *
 * Задача идёт каждые 10 минут и берёт шаблоны, не проверенные системой с последних 04:00 по Бишкеку или
 * при другом числе применённых миграций (был выпуск), — не больше 10 за запуск и не дольше 40 секунд:
 * остальные возьмёт следующий запуск. Повтор безопасен: итог пишется по версии шаблона, а сообщение о
 * поломке уходит один раз на поломку (ключ — шаблон и его версия).
 */

const JOB = 'dm.check-templates';
const BATCH = 10;
const BUDGET_MS = 40_000;
const QUERY_CANCELED = '57014';
const BISHKEK_MS = 6 * 3_600_000;

/** Последние 04:00 по Бишкеку не позже `now`: ночная проверка — после сверки хранилища в 03:30. */
export function dmCheckNightSince(now: Date): Date {
  const local = new Date(now.getTime() + BISHKEK_MS);
  const at =
    Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), 4) - BISHKEK_MS;
  return new Date(at <= now.getTime() ? at : at - 86_400_000);
}

/** Запустить шаблон, как его запускает «Вывод»; ошибка базы — итог «не выполнился» с её текстом. */
async function checkOne(
  ctx: JobContext,
  it: DmCheckItem,
  on: { orgId: string | null; adminId: string | null },
  t: AlertTexts,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const problem = dmQueryProblem(it.query);
  if (problem) {
    const error =
      problem.code === 'forbidden'
        ? t('err.dm_sql_forbidden', { word: problem.word })
        : t(`err.dm_sql_${problem.code}`);
    return { ok: false, error };
  }
  const bound = dmBind(
    it.query,
    it.params.map((p) => ({ k: p.code, type: p.type, req: false, def: p.default })),
    {},
    bishkekDate(ctx.clock.now()),
  );
  if (!bound.ok) {
    return { ok: false, error: bound.error === 'sql' ? bound.problem : `:${bound.param}` };
  }
  const q = { text: bound.text, params: bound.params, maxRows: DM_ROWS_MAX };
  let columns: string[];
  try {
    const res =
      it.audience === 'org'
        ? await runDmOrg(ctx.db, { orgId: on.orgId!, userId: null }, q)
        : await runDmAdmin(ctx.db, on.adminId!, q);
    columns = res.columns;
  } catch (err) {
    const pg = dmErrorOf(err);
    // Не ошибка запроса (нет связи с базой) — шаблон не виноват: задача падает и повторится.
    if (!pg) throw err;
    return {
      ok: false,
      error: pg.code === QUERY_CANCELED ? t('err.dm_timeout') : `${pg.code}: ${pg.message}`,
    };
  }
  // Пропал столбец шаблона (миграция переименовала то, что запрос отдавал «*») — тоже поломка.
  const published = it.columns.map((c) => ({
    code: c.code,
    name: c.name,
    type: c.contractor ? ('cp' as const) : c.type,
    total: c.total,
  }));
  const cols = dmResultColumnsProblem(columns, published);
  if (cols) {
    return {
      ok: false,
      error: t(`err.dm_check_${cols.code}`, 'column' in cols ? { column: cols.column } : {}),
    };
  }
  return { ok: true };
}

export function dmCheckTemplatesJob(): Job {
  return {
    name: JOB,
    cron: '*/10 * * * *',
    lookbackMinutes: 10,
    async run(ctx) {
      const started = Date.now();
      const due = await dmCheckDue(ctx.db, dmCheckNightSince(ctx.clock.now()), BATCH);
      if (!due.items.length) return 0;
      const t = await alertTexts(ctx);
      let n = 0;
      for (const it of due.items) {
        if (Date.now() - started > BUDGET_MS) break;
        const orgId = it.audience === 'org' ? due.demoOrgId : null;
        const outcome = await checkOne(ctx, it, { orgId, adminId: due.adminId }, t);
        const marked = await dmCheckMark(ctx.db, {
          id: it.id,
          version: it.version,
          ok: outcome.ok,
          error: outcome.ok ? null : outcome.error,
          orgId,
          schema: due.schema,
          now: ctx.clock.now(),
        });
        if (marked === 'skip') continue;
        n += 1;
        if (marked === 'broken') {
          // Текст ошибки базы в Telegram не уходит: у шаблона Админки в нём могут быть данные
          // организаций; он виден в окне шаблона.
          await sendPlatformAlert(ctx, {
            key: `dm_broken:${it.id}:${it.version}`,
            text: t('alert.dm_broken', { name: it.name }),
          });
        }
      }
      return n;
    },
  };
}

/**
 * Колокольчик администратора платформы при чтении: строка на каждую поломку шаблона (ключ — шаблон и его
 * версия), открывает окно шаблона. В `withUserContext` администратора; текст строки (`bell.line.dm_broken`)
 * — до транзакции.
 */
export async function dmBellSync(tx: Tx, line: string, userId: string, now: Date): Promise<number> {
  const broken = await dmBrokenTemplates(tx);
  if (!broken.length) return 0;
  return putBell(
    tx,
    broken.map((b) => ({
      userId,
      kind: 'other' as const,
      event: 'dm_broken',
      target: { kind: 'dm_template' as const, id: b.id },
      text: formatText(line, { name: b.name }),
      eventKey: `dm_broken:${b.id}:${b.version}`,
    })),
    now,
  );
}
