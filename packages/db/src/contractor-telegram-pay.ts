import {
  asBotMessage,
  pageVisibleSections,
  type BotMessage,
  type CpTgMessageKind,
  type HistoryChange,
  type IsoDate,
  type PageSection,
  type Tyiyn,
  type YearMonth,
} from '@buhuchet/domain';
import { and, eq, sql } from 'drizzle-orm';
import type { Db, Tx } from './client';
import { writeContractorPageHistory } from './contractor-page';
import { featureSet } from './org';
import {
  contractorPages,
  contractors,
  contractorTelegramLinks,
  contractorTelegramMessages,
  organizations,
  orgSettings,
} from './schema';

/*
 * «К оплате» клиенту в Telegram (доработки 13.11.2026, задача К4; прототип v94 modules/cp-telegram.js:
 * `pgPaySend`, `tgAct('cp-paid')`, `tgAct('cp-ask')`, `pgTgAsk`). Сообщения клиенту бот хранит в
 * `contractor_telegram_messages`: клиент — не пользователь, журнал отправок сотрудникам его чат не
 * знает. Нажатие и ответ клиента приходят без входа и без организации — чьё это сообщение, говорят
 * только функции `app.contractor_telegram_message` и `app.contractor_telegram_ask` (с правами
 * владельца); дальше всё идёт в транзакции организации сообщения (RLS).
 */

/**
 * Рассылка клиенту идёт, только пока раздел «Telegram» его страницы действует: страница включена и не
 * закрыта, контрагент не в архиве, раздел включён у организации и не скрыт у контрагента (то же, что
 * у «Подтвердить» в карточке; docs/deviations.md п. К-2), организация работает (не заблокирована).
 * Функции учётной политики проверяет вызывающий.
 */
const sectionOn = and(
  eq(contractorTelegramLinks.status, 'on'),
  eq(organizations.status, 'active'),
  eq(contractorPages.enabled, true),
  sql`${contractorPages.closedAt} is null`,
  sql`${contractors.serviceStatus} <> 'archived'`,
  sql`'tg' = any(${orgSettings.pageSections})`,
  sql`not ('tg' = any(${contractorPages.hiddenSections}))`,
);

/**
 * Кому писать: подключённые Telegram контрагента (прототип `(c.tgs||[]).filter(x=>x.st==='on')`), пока
 * раздел «Telegram» страницы действует.
 */
export async function contractorTelegramRecipients(
  tx: Tx,
  contractorId: string,
): Promise<{ linkId: string; chatId: number; name: string; noDebt: boolean }[]> {
  return tx
    .select({
      linkId: contractorTelegramLinks.id,
      chatId: contractorTelegramLinks.chatId,
      name: contractorTelegramLinks.name,
      // Клиент нажал «Не напоминать» (задача К5): напоминания о долге этому чату не идут.
      noDebt: contractorTelegramLinks.noDebt,
    })
    .from(contractorTelegramLinks)
    .innerJoin(contractors, eq(contractors.id, contractorTelegramLinks.contractorId))
    .innerJoin(
      contractorPages,
      eq(contractorPages.contractorId, contractorTelegramLinks.contractorId),
    )
    .innerJoin(orgSettings, eq(orgSettings.orgId, contractorTelegramLinks.orgId))
    .innerJoin(organizations, eq(organizations.id, contractorTelegramLinks.orgId))
    .where(and(eq(contractorTelegramLinks.contractorId, contractorId), sectionOn))
    .orderBy(contractorTelegramLinks.requestedAt, contractorTelegramLinks.id);
}

/**
 * Раздел страницы контрагента сейчас показан клиенту (функция «Страница контрагента» включена,
 * раздел включён у организации вместе со своей функцией и не скрыт у контрагента). Бот не пишет клиенту того, чего тот не видит на своей странице: реквизит
 * для налогов уходит в Telegram, только пока показан раздел «Как оплатить».
 */
export async function contractorPageSectionShown(
  tx: Tx,
  contractorId: string,
  section: PageSection,
): Promise<boolean> {
  const [row] = await tx
    .select({
      pageSections: orgSettings.pageSections,
      features: orgSettings.features,
      hidden: contractorPages.hiddenSections,
    })
    .from(contractorPages)
    .innerJoin(orgSettings, eq(orgSettings.orgId, contractorPages.orgId))
    .where(eq(contractorPages.contractorId, contractorId));
  if (!row) return false;
  const features = featureSet(row.features);
  // Без функции «Страница контрагента» страницы нет вовсе.
  if (!features.cppage) return false;
  return pageVisibleSections(
    row.pageSections as PageSection[],
    features,
    row.hidden as PageSection[],
  ).includes(section);
}

export interface ContractorTelegramMessageInput {
  contractorId: string;
  linkId: string;
  chatId: number;
  kind: CpTgMessageKind;
  month?: YearMonth | null;
  total?: Tyiyn | null;
  auto?: boolean;
  /** Понедельник недели — у напоминания о долге (одно на неделю и чат). */
  week?: IsoDate | null;
  payload: BotMessage;
}

/**
 * Записать сообщение клиенту до отправки (организация и автор — из контекста). У самого «К оплате»
 * (`auto`) ключ «подключение + месяц»: повтор задачи вторую строку не создаёт — тогда `null`.
 */
export async function insertContractorTelegramMessage(
  tx: Tx,
  input: ContractorTelegramMessageInput,
): Promise<string | null> {
  const [row] = await tx
    .insert(contractorTelegramMessages)
    .values({
      orgId: sql`app.current_org_id()`,
      contractorId: input.contractorId,
      linkId: input.linkId,
      chatId: input.chatId,
      kind: input.kind,
      month: input.month ?? null,
      total: input.total ?? null,
      auto: input.auto ?? false,
      week: input.week ?? null,
      payload: input.payload,
      sentBy: sql`app.current_user_id()`,
    })
    .onConflictDoNothing()
    .returning({ id: contractorTelegramMessages.id });
  return row?.id ?? null;
}

/**
 * Сколько раз за последний час сотрудники отправляли «К оплате» этому контрагенту: для предела «не
 * завалить клиента». Сообщения одной отправки записаны одной транзакцией — у них одно время записи,
 * поэтому отправки считаются по нему, сколько бы чатов ни было подключено. Отправки одного
 * контрагента идут по одной (блокировка до конца транзакции).
 */
export async function recentManualPaySends(tx: Tx, contractorId: string): Promise<number> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended('cp_tg_pay:' || ${contractorId}, 0))`,
  );
  const [row] = await tx
    .select({ n: sql<number>`count(distinct ${contractorTelegramMessages.createdAt})::int` })
    .from(contractorTelegramMessages)
    .where(
      and(
        eq(contractorTelegramMessages.contractorId, contractorId),
        eq(contractorTelegramMessages.kind, 'pay'),
        eq(contractorTelegramMessages.auto, false),
        sql`${contractorTelegramMessages.createdAt} > now() - interval '1 hour'`,
      ),
    );
  return row?.n ?? 0;
}

/** Отметить попытку отправки: номер сообщения в чате (ушло) или только счёт попыток (не ушло). */
export async function markContractorTelegramMessage(
  tx: Tx,
  id: string,
  messageId: number | null,
): Promise<void> {
  await tx
    .update(contractorTelegramMessages)
    .set({
      attempts: sql`${contractorTelegramMessages.attempts} + 1`,
      ...(messageId === null ? {} : { messageId }),
    })
    .where(eq(contractorTelegramMessages.id, id));
}

/** Само «К оплате», которое ещё не ушло и не исчерпало попытки (`maxAttempts`): задача повторит. */
export async function unsentAutoPayMessages(
  tx: Tx,
  contractorId: string,
  month: YearMonth,
  maxAttempts: number,
): Promise<{ id: string; linkId: string; chatId: number }[]> {
  return tx
    .select({
      id: contractorTelegramMessages.id,
      linkId: contractorTelegramMessages.linkId,
      chatId: contractorTelegramMessages.chatId,
    })
    .from(contractorTelegramMessages)
    .where(
      and(
        eq(contractorTelegramMessages.contractorId, contractorId),
        eq(contractorTelegramMessages.kind, 'pay'),
        eq(contractorTelegramMessages.auto, true),
        eq(contractorTelegramMessages.month, month),
        sql`${contractorTelegramMessages.messageId} is null`,
        sql`${contractorTelegramMessages.attempts} < ${maxAttempts}`,
      ),
    );
}

/**
 * Перед повтором неотправленное «К оплате» собирается заново: за день могли измениться суммы,
 * ответственный и реквизит — клиенту уходит сегодняшнее, и «Оплатил» запишет сегодняшнюю сумму.
 * Ушедшее сообщение (у него есть номер в чате) не меняется. true — строка обновлена.
 */
export async function refreshContractorTelegramMessage(
  tx: Tx,
  id: string,
  next: { total: Tyiyn; payload: BotMessage },
): Promise<boolean> {
  const rows = await tx
    .update(contractorTelegramMessages)
    .set({ total: next.total, payload: next.payload })
    .where(
      and(
        eq(contractorTelegramMessages.id, id),
        sql`${contractorTelegramMessages.messageId} is null`,
      ),
    )
    .returning({ id: contractorTelegramMessages.id });
  return rows.length > 0;
}

/** Каким подключениям само «К оплате» за месяц уже записано (ушло или ждёт повтора). */
export async function autoPayLinkIds(
  tx: Tx,
  contractorId: string,
  month: YearMonth,
): Promise<Set<string>> {
  const rows = await tx
    .select({ linkId: contractorTelegramMessages.linkId })
    .from(contractorTelegramMessages)
    .where(
      and(
        eq(contractorTelegramMessages.contractorId, contractorId),
        eq(contractorTelegramMessages.kind, 'pay'),
        eq(contractorTelegramMessages.auto, true),
        eq(contractorTelegramMessages.month, month),
      ),
    );
  return new Set(rows.map((r) => r.linkId));
}

/** Сообщение клиенту, найденное по чату и номеру — до транзакции организации. */
export interface ContractorTelegramTarget {
  id: string;
  orgId: string;
  contractorId: string;
  linkId: string;
  kind: CpTgMessageKind;
  /** Подключение ещё действует: строка «Подключён», контрагент не в архиве, организация работает. */
  linked: boolean;
}

const targetOf = (row: {
  id: string;
  org_id: string;
  contractor_id: string;
  link_id: string;
  kind: string;
  linked: boolean;
}): ContractorTelegramTarget => ({
  id: row.id,
  orgId: row.org_id,
  contractorId: row.contractor_id,
  linkId: row.link_id,
  kind: row.kind === 'ask' ? 'ask' : row.kind === 'debt' ? 'debt' : 'pay',
  linked: row.linked,
});

/**
 * Чьё это сообщение бота (нажатие кнопки клиентом): только сообщение из `contractor_telegram_messages`
 * этого чата. Вызывается без контекста организации; `null` — не сообщение клиенту.
 */
export async function contractorTelegramPressTarget(
  db: Db,
  chatId: number,
  messageId: number,
): Promise<ContractorTelegramTarget | null> {
  const [row] = await db.execute<Parameters<typeof targetOf>[0]>(
    sql`select * from app.contractor_telegram_message(${chatId}, ${messageId})`,
  );
  return row ? targetOf(row) : null;
}

/**
 * Открытая просьба «напишите ваш вопрос» в чате клиента: та, на которую он ответил (`replyTo`), а без
 * ответа — последняя за сутки. Работает и без контекста организации, и внутри её транзакции (тогда
 * второе соединение не занимается); `null` — бот вопроса не ждёт; `linked: false` — ждал, но
 * подключение больше не действует.
 */
export async function contractorTelegramAskTarget(
  db: Db | Tx,
  chatId: number,
  replyTo: number | null,
): Promise<ContractorTelegramTarget | null> {
  const [row] = await db.execute<Parameters<typeof targetOf>[0]>(
    sql`select * from app.contractor_telegram_ask(${chatId}, ${replyTo})`,
  );
  return row ? targetOf(row) : null;
}

/** Сообщение клиенту на момент нажатия: под блокировкой строки до конца транзакции. */
export interface LockedContractorTelegramMessage {
  message: BotMessage;
  month: YearMonth | null;
  total: Tyiyn | null;
  answered: boolean;
  /**
   * Имя в Telegram и подключение на этот момент: «Подключён», и раздел «Telegram» страницы действует
   * (страница включена и не закрыта, не архив, раздел не скрыт, организация работает).
   */
  name: string;
  linked: boolean;
}

/**
 * Заблокировать сообщение клиенту и перечитать его (два быстрых нажатия и повтор от Telegram идут по
 * одному): только своё сообщение этого чата. `null` — сообщения нет или запись не похожа на сообщение.
 */
export async function lockContractorTelegramMessage(
  tx: Tx,
  id: string,
  chatId: number,
): Promise<LockedContractorTelegramMessage | null> {
  const [row] = await tx
    .select({
      payload: contractorTelegramMessages.payload,
      month: contractorTelegramMessages.month,
      total: contractorTelegramMessages.total,
      answeredAt: contractorTelegramMessages.answeredAt,
      linkId: contractorTelegramMessages.linkId,
    })
    .from(contractorTelegramMessages)
    .where(
      and(eq(contractorTelegramMessages.id, id), eq(contractorTelegramMessages.chatId, chatId)),
    )
    .for('update');
  if (!row) return null;
  const message = asBotMessage(row.payload);
  if (!message) return null;
  const [link] = await tx
    .select({
      name: contractorTelegramLinks.name,
      contractorId: contractorTelegramLinks.contractorId,
    })
    .from(contractorTelegramLinks)
    .where(eq(contractorTelegramLinks.id, row.linkId));
  if (!link) return null;
  // Подключение действует, пока клиенту можно писать: тот же список, что у рассылки, и раздел
  // «Telegram» страницы показан (обе функции — «Напоминания в Telegram» и «Страница контрагента»).
  const shown = await contractorPageSectionShown(tx, link.contractorId, 'tg');
  const active = shown ? await contractorTelegramRecipients(tx, link.contractorId) : [];
  return {
    message,
    month: row.month,
    total: row.total,
    answered: row.answeredAt !== null,
    name: link.name,
    linked: active.some((r) => r.linkId === row.linkId),
  };
}

/** Сохранить сообщение с погасшей кнопкой. */
export async function saveContractorTelegramMessage(
  tx: Tx,
  id: string,
  message: BotMessage,
): Promise<void> {
  await tx
    .update(contractorTelegramMessages)
    .set({ payload: message })
    .where(eq(contractorTelegramMessages.id, id));
}

/** Клиент ответил на «напишите ваш вопрос»: второй раз тот же ответ не принимается. */
export async function answerContractorTelegramAsk(tx: Tx, id: string): Promise<boolean> {
  const rows = await tx
    .update(contractorTelegramMessages)
    .set({ answeredAt: sql`now()` })
    .where(
      and(
        eq(contractorTelegramMessages.id, id),
        sql`${contractorTelegramMessages.answeredAt} is null`,
      ),
    )
    .returning({ id: contractorTelegramMessages.id });
  return rows.length > 0;
}

/**
 * Вопрос клиента, на который отвечает сотрудник из Telegram (прототип `pgTgAnswer`): просьба «напишите
 * ваш вопрос», на которую клиент уже ответил. Ищется в организации из контекста (RLS): номер из
 * сообщения сотруднику сам ничего не открывает. `null` — такого вопроса нет.
 */
export async function contractorTelegramQuestionOf(
  tx: Tx,
  id: string,
): Promise<{ contractorId: string; chatId: number } | null> {
  const [row] = await tx
    .select({
      contractorId: contractorTelegramMessages.contractorId,
      chatId: contractorTelegramMessages.chatId,
    })
    .from(contractorTelegramMessages)
    .where(
      and(
        eq(contractorTelegramMessages.id, id),
        eq(contractorTelegramMessages.kind, 'ask'),
        sql`${contractorTelegramMessages.answeredAt} is not null`,
      ),
    );
  return row ?? null;
}

/**
 * История контрагента о «К оплате» в Telegram (прототип `pgPaySend`, `tgAct('cp-paid')`, `pgTgAsk`,
 * `pgTgAnswer`): отправка — от имени сотрудника (у задачи по расписанию автора нет — «Система»),
 * «Оплатил» и вопрос — от клиента (автора нет, вид записи говорит, что это контрагент), ответ на вопрос —
 * от сотрудника, который ответил в Telegram.
 */
export async function logContractorTelegramPay(
  tx: Tx,
  contractorId: string,
  action: 'page_tg_pay' | 'page_tg_paid' | 'page_tg_question' | 'page_tg_answer',
  changes: HistoryChange[],
): Promise<void> {
  await writeContractorPageHistory(tx, contractorId, action, { changes });
}

/** «Отправлять «К оплате» контрагентам» включено у организации (учётная политика, `cp_tg_pay`). */
export async function contractorTelegramPayOn(tx: Tx): Promise<boolean> {
  const [row] = await tx
    .select({ on: orgSettings.cpTgPay, features: orgSettings.features })
    .from(orgSettings)
    .where(eq(orgSettings.orgId, sql`app.current_org_id()`));
  const features = (row?.features ?? {}) as Record<string, boolean>;
  return !!row?.on && features.telegram === true && features.cppage === true;
}

/**
 * Контрагенты организации с подключённым Telegram, которым само «К оплате» может уйти (прототип
 * `pgPaySend`: подключённые Telegram, контрагент не в архиве; раздел «Telegram» страницы действует).
 */
export async function contractorsWithTelegram(tx: Tx): Promise<string[]> {
  const rows = await tx
    .selectDistinct({ id: contractorTelegramLinks.contractorId })
    .from(contractorTelegramLinks)
    .innerJoin(contractors, eq(contractors.id, contractorTelegramLinks.contractorId))
    .innerJoin(
      contractorPages,
      eq(contractorPages.contractorId, contractorTelegramLinks.contractorId),
    )
    .innerJoin(orgSettings, eq(orgSettings.orgId, contractorTelegramLinks.orgId))
    .innerJoin(organizations, eq(organizations.id, contractorTelegramLinks.orgId))
    .where(sectionOn);
  return rows.map((r) => r.id);
}
