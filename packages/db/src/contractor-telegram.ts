import {
  CP_TG_ACTION_STATUS,
  CP_TG_LINK_TTL_HOURS,
  CP_TG_MAX,
  CP_TG_MAX_TOKENS,
  cpTgActionRefusal,
  cpTgOrder,
  RecordChangedError,
  RecordNotFoundError,
  type CpTgAction,
  type CpTgRefusal,
  type CpTgStatus,
} from '@buhuchet/domain';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Db, Tx } from './client';
import { writeContractorPageHistory } from './contractor-page';
import { contractorPages, contractors, contractorTelegramLinks, employees } from './schema';

/*
 * Telegram контрагента (доработки 13.11.2026, задача К3; прототип v92 modules/cp-telegram.js). Клиент
 * без входа и чат Telegram без организации работают только через функции app.contractor_telegram_*
 * (миграция contractor_telegram_guards): ссылку получает лишь браузер с запомненным кодом страницы,
 * запрос создаётся лишь по действующей одноразовой ссылке. Решение сотрудника и список — в контексте
 * организации (RLS); право и область «Свои / Все контрагенты» проверяет метод API.
 */

/** Отказ по правилу (`cpTgActionRefusal`): код — ключ словаря `err.<код>`. */
export class ContractorTelegramRefusedError extends Error {
  constructor(readonly code: CpTgRefusal) {
    super(code);
    this.name = 'ContractorTelegramRefusedError';
  }
}

/** Итог выдачи ссылки: выдана, мест нет, страница недоступна (или раздел «Telegram» выключен). */
export type ContractorTelegramIssue = 'ok' | 'full' | 'unavailable';

/**
 * Выдать одноразовую ссылку «Подключить Telegram» браузеру с запомненным кодом страницы (`grantHash` —
 * хеш токена cookie страницы, `tokenHash` — хеш токена новой ссылки). Вызывается без контекста
 * организации.
 */
export async function issueContractorTelegramLink(
  db: Db,
  input: { slug: string; inn: string; grantHash: string; tokenHash: string },
): Promise<ContractorTelegramIssue> {
  const [row] = await db.execute<{ outcome: string }>(
    sql`select app.contractor_telegram_issue(${input.slug}, ${input.inn}, ${input.grantHash}, ${input.tokenHash}, ${CP_TG_LINK_TTL_HOURS}, ${CP_TG_MAX}, ${CP_TG_MAX_TOKENS}) as outcome`,
  );
  return row?.outcome === 'ok' ? 'ok' : row?.outcome === 'full' ? 'full' : 'unavailable';
}

/**
 * Чья это ссылка: `ok` — действует, `repeat` — уже использована этим же чатом (Telegram повторил
 * сообщение); null — не действует. Вызывается без контекста организации.
 */
export async function peekContractorTelegramLink(
  db: Db,
  tokenHash: string,
  chatId: number,
): Promise<{ state: 'ok' | 'repeat'; orgId: string; contractorId: string } | null> {
  const [row] = await db.execute<{ state: string; org_id: string; contractor_id: string }>(
    sql`select * from app.contractor_telegram_peek(${tokenHash}, ${chatId})`,
  );
  if (!row) return null;
  return {
    state: row.state === 'ok' ? 'ok' : 'repeat',
    orgId: row.org_id,
    contractorId: row.contractor_id,
  };
}

/** Итог «Старт» по ссылке со страницы. */
export type ContractorTelegramStart =
  | { outcome: 'invalid' }
  | { outcome: 'limit'; contractorId: string; contractor: string }
  | {
      outcome: 'asked' | 'pending' | 'already';
      linkId: string;
      contractorId: string;
      contractor: string;
    };

/**
 * Клиент нажал «Старт» по ссылке: ссылка использована, появился запрос «ждёт подтверждения»; запрос
 * пишется в историю контрагента в той же транзакции (автора нет — это контрагент). В контексте
 * организации ссылки (`peekContractorTelegramLink`).
 */
export async function startContractorTelegram(
  tx: Tx,
  input: { tokenHash: string; chatId: number; name: string },
): Promise<ContractorTelegramStart> {
  const rows = await tx.execute<{
    outcome: string;
    link_id: string | null;
    contractor_id: string | null;
    contractor_name: string | null;
  }>(
    sql`select * from app.contractor_telegram_start(${input.tokenHash}, ${input.chatId}, ${input.name}, ${CP_TG_MAX})`,
  );
  const row = rows[0];
  if (!row?.contractor_id || row.outcome === 'invalid') return { outcome: 'invalid' };
  const contractor = row.contractor_name ?? '';
  if (row.outcome === 'limit') {
    return { outcome: 'limit', contractorId: row.contractor_id, contractor };
  }
  if (!row.link_id) return { outcome: 'invalid' };
  if (row.outcome === 'asked') {
    await writeContractorPageHistory(tx, row.contractor_id, 'page_tg_request', {
      changes: [{ field: 'telegram', to: input.name }],
    });
  }
  return {
    outcome: row.outcome === 'asked' ? 'asked' : row.outcome === 'already' ? 'already' : 'pending',
    linkId: row.link_id,
    contractorId: row.contractor_id,
    contractor,
  };
}

/** К каким контрагентам подключён чат (команда «Отключить»). Вызывается без контекста организации. */
export async function contractorTelegramChats(
  db: Db,
  chatId: number,
): Promise<{ linkId: string; orgId: string; contractorId: string; contractor: string }[]> {
  const rows = await db.execute<{
    link_id: string;
    org_id: string;
    contractor_id: string;
    contractor_name: string;
  }>(sql`select * from app.contractor_telegram_chat(${chatId})`);
  return rows.map((r) => ({
    linkId: r.link_id,
    orgId: r.org_id,
    contractorId: r.contractor_id,
    contractor: r.contractor_name,
  }));
}

/**
 * Клиент отключился сам командой «Отключить»: только свой чат и только подключённая строка. История
 * контрагента — в той же транзакции. false — строка уже не подключена.
 */
export async function leaveContractorTelegram(
  tx: Tx,
  input: { linkId: string; chatId: number },
): Promise<boolean> {
  const [row] = await tx
    .update(contractorTelegramLinks)
    .set({
      status: 'off',
      byClient: true,
      decidedBy: null,
      decidedAt: sql`now()`,
      updatedBy: null,
      updatedAt: sql`now()`,
      version: sql`${contractorTelegramLinks.version} + 1`,
    })
    .where(
      and(
        eq(contractorTelegramLinks.id, input.linkId),
        eq(contractorTelegramLinks.chatId, input.chatId),
        eq(contractorTelegramLinks.status, 'on'),
      ),
    )
    .returning({
      contractorId: contractorTelegramLinks.contractorId,
      name: contractorTelegramLinks.name,
    });
  if (!row) return false;
  await writeContractorPageHistory(tx, row.contractorId, 'page_tg_leave', {
    changes: [{ field: 'telegram', from: row.name, to: null }],
  });
  return true;
}

/** Строка списка «Telegram контрагента» в карточке. Номер чата наружу не отдаётся. */
export interface ContractorTelegramRow {
  id: string;
  name: string;
  status: CpTgStatus;
  requestedAt: string;
  decidedAt: string | null;
  /** Кто решил: краткое ФИО сотрудника; null — контрагент (`byClient`) или решения ещё нет. */
  decidedBy: string | null;
  byClient: boolean;
  /** Клиент выключил напоминания о долге кнопкой «Не напоминать» (задача К5). */
  noDebt: boolean;
  version: number;
}

const iso = (value: Date | string) => new Date(value).toISOString();

/** Список «Telegram контрагента»: ждущие, подключённые, остальные; внутри — новые сверху. */
export async function listContractorTelegram(
  tx: Tx,
  contractorId: string,
): Promise<ContractorTelegramRow[]> {
  const rows = await tx
    .select({
      id: contractorTelegramLinks.id,
      name: contractorTelegramLinks.name,
      status: contractorTelegramLinks.status,
      requestedAt: contractorTelegramLinks.requestedAt,
      decidedAt: contractorTelegramLinks.decidedAt,
      decidedBy: employees.shortName,
      byClient: contractorTelegramLinks.byClient,
      noDebt: contractorTelegramLinks.noDebt,
      version: contractorTelegramLinks.version,
    })
    .from(contractorTelegramLinks)
    .leftJoin(employees, eq(employees.userId, contractorTelegramLinks.decidedBy))
    .where(eq(contractorTelegramLinks.contractorId, contractorId));
  return cpTgOrder(
    rows.map((r) => ({
      ...r,
      requestedAt: iso(r.requestedAt),
      decidedAt: r.decidedAt ? iso(r.decidedAt) : null,
    })),
  );
}

/** Сколько Telegram подключено и ждёт подтверждения — для раздела «Telegram» страницы (без имён). */
export async function contractorTelegramCounts(
  tx: Tx,
  contractorId: string,
): Promise<{ on: number; wait: number }> {
  const rows = await tx
    .select({ status: contractorTelegramLinks.status, n: sql<number>`count(*)::int` })
    .from(contractorTelegramLinks)
    .where(
      and(
        eq(contractorTelegramLinks.contractorId, contractorId),
        inArray(contractorTelegramLinks.status, ['on', 'wait']),
      ),
    )
    .groupBy(contractorTelegramLinks.status);
  const of = (s: CpTgStatus) => rows.find((r) => r.status === s)?.n ?? 0;
  return { on: of('on'), wait: of('wait') };
}

/**
 * Запрос на подключение по номеру строки (кнопки «Подтвердить» и «Отклонить» под сообщением бота
 * сотруднику, задача К5): чей он, статус и версия — для решения тем же правилом, что в карточке.
 */
export async function contractorTelegramLinkOf(
  tx: Tx,
  linkId: string,
): Promise<{ contractorId: string; status: CpTgStatus; name: string; version: number } | null> {
  const [row] = await tx
    .select({
      contractorId: contractorTelegramLinks.contractorId,
      status: contractorTelegramLinks.status,
      name: contractorTelegramLinks.name,
      version: contractorTelegramLinks.version,
    })
    .from(contractorTelegramLinks)
    .where(eq(contractorTelegramLinks.id, linkId));
  return row ? { ...row, status: row.status as CpTgStatus } : null;
}

/** Что сообщить клиенту после решения сотрудника. */
export interface ContractorTelegramDecision {
  chatId: number;
  name: string;
  contractor: string;
  status: CpTgStatus;
}

/**
 * Решение сотрудника: подтвердить, отклонить, отключить (прототип pgTgDecide). Решения по одному
 * контрагенту идут по одному (строка страницы блокируется): «подключено не больше 5» не обойти двумя
 * одновременными подтверждениями. Версия строки защищает от решения по устаревшему списку; история
 * контрагента — в той же транзакции. `where` — условие области «Свои контрагенты».
 */
export async function decideContractorTelegram(
  tx: Tx,
  input: { contractorId: string; linkId: string; action: CpTgAction; version: number },
): Promise<ContractorTelegramDecision> {
  await tx
    .select({ id: contractorPages.contractorId })
    .from(contractorPages)
    .where(eq(contractorPages.contractorId, input.contractorId))
    .for('update');
  const [link] = await tx
    .select()
    .from(contractorTelegramLinks)
    .where(
      and(
        eq(contractorTelegramLinks.id, input.linkId),
        eq(contractorTelegramLinks.contractorId, input.contractorId),
      ),
    )
    .for('update');
  if (!link) throw new RecordNotFoundError('contractor_page', input.linkId);
  if (link.version !== input.version) {
    throw new RecordChangedError('contractor_page', input.linkId, link.version);
  }
  const { on } = await contractorTelegramCounts(tx, input.contractorId);
  const refusal = cpTgActionRefusal(link.status, input.action, on);
  if (refusal) throw new ContractorTelegramRefusedError(refusal);

  const status = CP_TG_ACTION_STATUS[input.action];
  await tx
    .update(contractorTelegramLinks)
    .set({
      status,
      byClient: false,
      decidedBy: sql`app.current_user_id()`,
      decidedAt: sql`now()`,
      updatedBy: sql`app.current_user_id()`,
      updatedAt: sql`now()`,
      version: sql`${contractorTelegramLinks.version} + 1`,
    })
    .where(eq(contractorTelegramLinks.id, link.id));
  await writeContractorPageHistory(
    tx,
    input.contractorId,
    input.action === 'approve'
      ? 'page_tg_on'
      : input.action === 'reject'
        ? 'page_tg_no'
        : 'page_tg_off',
    {
      changes: [
        {
          field: 'telegram',
          from: input.action === 'unlink' ? link.name : null,
          to: input.action === 'unlink' ? null : link.name,
        },
      ],
    },
  );
  const [cp] = await tx
    .select({ name: contractors.name })
    .from(contractors)
    .where(eq(contractors.id, input.contractorId));
  return { chatId: link.chatId, name: link.name, contractor: cp?.name ?? '', status };
}

/** Удалить одноразовые ссылки с истёкшим сроком (задача по расписанию). */
export async function cleanupContractorTelegramLinks(db: Db): Promise<number> {
  const [row] = await db.execute<{ removed: number }>(
    sql`select app.contractor_telegram_cleanup() as removed`,
  );
  return row?.removed ?? 0;
}
