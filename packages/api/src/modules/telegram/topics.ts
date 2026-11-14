import { AsyncLocalStorage } from 'node:async_hooks';
import { isThreadMissing, redactBotToken } from '@buhuchet/adapters';
import {
  botChatUsers,
  forgetTelegramTopic,
  messageTemplates,
  saveTelegramTopic,
  telegramBotTopics,
  telegramTopicKey,
  telegramTopicThread,
} from '@buhuchet/db';
import {
  botTemplate,
  botTopicName,
  botTopicOf,
  chatTopicKey,
  fillTemplate,
  topicOrgId,
} from '@buhuchet/domain';
import type { JobContext } from '../../deps';

/*
 * Темы в чате с ботом (поток Т, задача Т7; прототип v104 `modules/tg-topics.js`; docs/decisions.md
 * п. Т-7). Переключатель администратора платформы выключен — всё как раньше, без тем. Включён —
 * сообщение уходит в тему своего вида (отчёты, задачи, заявки, безопасность), а если чат привязан к
 * учётным записям нескольких организаций — отчёты и задачи в тему своей организации. Тему бот создаёт
 * сам при первом сообщении в неё; человек удалил тему — бот создаёт её заново и отправляет снова. В
 * @BotFather темы не включены (Telegram не создаёт тему) — сообщение уходит без темы: напоминание о
 * сроке должно дойти всегда. Ответ на нажатие кнопки и на сообщение человека уходит в ту же тему.
 */

type TopicDeps = Pick<JobContext, 'db' | 'telegram' | 'logger' | 'clock'>;

/**
 * Чаты, где Telegram тему не создал (темы у бота не включены в @BotFather): до этого момента бот в них
 * пишет без тем и не спрашивает Telegram перед каждым сообщением. Только в памяти процесса.
 */
const refused = new Map<number, number>();
const REFUSED_MS = 10 * 60_000;
const REFUSED_MAX = 1000;

/** Тема, где человек нажал кнопку или написал боту: ответы в этот же чат идут туда же. */
const replyThread = new AsyncLocalStorage<{ chatId: number; threadId: number }>();

/** Выполнить разбор нажатия или сообщения человека: ответы бота в этот чат — в ту же тему. */
export function inReplyThread<T>(
  chatId: number,
  threadId: number | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  return threadId === undefined ? fn() : replyThread.run({ chatId, threadId }, fn);
}

/**
 * Организация темы, в которой человек написал боту (тема организации в чате нескольких организаций):
 * команда отвечает по учётной записи этой организации. null — тема не организации или без темы.
 */
export async function replyTopicOrg(deps: TopicDeps, chatId: number): Promise<string | null> {
  const at = replyThread.getStore();
  if (!at || at.chatId !== chatId) return null;
  const key = await telegramTopicKey(deps.db, chatId, at.threadId);
  return key ? topicOrgId(key) : null;
}

/** Чьё сообщение: вид журнала и получатель (организация — для темы организации). */
export interface TopicTarget {
  kind: string;
  orgId?: string | null;
  userId?: string | null;
}

/** Создать тему и запомнить её номер; Telegram не создал (темы не включены) — null. */
async function createTopic(
  deps: TopicDeps,
  chatId: number,
  key: string,
  orgName: string | null,
): Promise<number | null> {
  const now = deps.clock.now().getTime();
  if ((refused.get(chatId) ?? 0) > now) return null;
  const templates = await messageTemplates(deps.db);
  const name = botTopicName(key, {
    templates: (k) => fillTemplate(botTemplate(k, templates[k]), {}),
    orgName,
  });
  try {
    const res = await deps.telegram!.createTopic(chatId, name);
    if (!res.ok) {
      if (res.permanent) {
        if (refused.size >= REFUSED_MAX) refused.delete(refused.keys().next().value!);
        refused.set(chatId, now + REFUSED_MS);
      }
      deps.logger.warn(
        { errorCode: res.errorCode, description: res.description },
        'Telegram: тема чата не создана, сообщение уйдёт без темы',
      );
      return null;
    }
    await saveTelegramTopic(deps.db, chatId, key, res.threadId);
    return res.threadId;
  } catch (err) {
    deps.logger.warn(
      { err: redactBotToken(err instanceof Error ? err.message : String(err)) },
      'Telegram: тема чата не создана, сообщение уйдёт без темы',
    );
    return null;
  }
}

/**
 * Отправить в нужную тему: `send` получает номер темы (undefined — без темы). Ответ в чат, где человек
 * только что нажал кнопку или написал, — в ту же тему. `topicsOn` — переключатель, если его уже
 * прочитали (очередь читает его раз на пачку).
 */
export async function sendInTopic<R extends { ok: boolean; description?: string }>(
  deps: TopicDeps,
  chatId: number,
  target: TopicTarget | null,
  send: (threadId: number | undefined) => Promise<R>,
  o: { topicsOn?: boolean } = {},
): Promise<R> {
  const at = replyThread.getStore();
  if (at && at.chatId === chatId) {
    // Тему, где человек написал, успели удалить — ответ уходит без темы.
    const res = await send(at.threadId);
    return isThreadMissing(res) ? send(undefined) : res;
  }
  const topic = target ? botTopicOf(target.kind) : null;
  if (!topic || !deps.telegram) return send(undefined);
  if (!(o.topicsOn ?? (await telegramBotTopics(deps.db)))) return send(undefined);
  const users = await botChatUsers(deps.db, chatId);
  const orgId = target?.orgId ?? users.find((u) => u.userId === target?.userId)?.orgId ?? null;
  const orgs = new Set(users.map((u) => u.orgId).filter(Boolean)).size;
  const key = chatTopicKey(topic, { orgId, orgs });
  const orgName = users.find((u) => u.orgId === orgId)?.orgName ?? null;
  const threadId =
    (await telegramTopicThread(deps.db, chatId, key)) ??
    (await createTopic(deps, chatId, key, orgName));
  if (threadId === null) return send(undefined);
  const res = await send(threadId);
  if (!isThreadMissing(res)) return res;
  // Человек удалил тему: создать заново и отправить ещё раз.
  await forgetTelegramTopic(deps.db, chatId, key, threadId);
  const again = await createTopic(deps, chatId, key, orgName);
  return send(again ?? undefined);
}

/** Номер темы в параметры отправки. */
export const threadOption = (threadId: number | undefined): { threadId?: number } =>
  threadId === undefined ? {} : { threadId };
