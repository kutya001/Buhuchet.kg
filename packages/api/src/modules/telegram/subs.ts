import {
  adminPendingSubscriptionPayments,
  bellOwnerUsers,
  enqueueTelegram,
  messageTemplates,
  platformNotice,
  storageCheckRunsWithNews,
  telegramChatsOf,
  type StorageCheckSaved,
  type Tx,
} from '@buhuchet/db';
import {
  BELL_KEEP_DAYS,
  bishkekDate,
  bishkekTime,
  botPlainText,
  botTemplate,
  fillTemplate,
  formatSomWithUnit,
  formatText,
  SUB_EVENT_TEMPLATES,
  subOwnerValues,
  subscriptionCheckWait,
  type BotMessage,
  type IsoDate,
  type SubscriptionPaymentKind,
  type TelegramTemplateKey,
  type Translate,
} from '@buhuchet/domain';
import type { ApiDeps } from '../../deps';
import { serverTexts } from '../l10n/texts';
import { putBell, type BellPut } from './bell';
import { botSiteUrl } from './staff-view';

/*
 * Сообщения о подписке, памяти и сверке хранилища (доработки 20.11.2026, блок 4, пункт 3; блок 2,
 * пункт 5; пакет 2, блок 3, пункт 6; блок 6, пункт 3; поток Т, этап 1, П12; прототип v151–v155
 * `core/subs.js` `subTellOwners`, `subTellAdmins`, `admin/subs-admin.js` `subDaily`).
 *   Владельцам организации — Telegram (вид `sub`, кнопка «Открыть» — экран «Подписка» потока И) и
 *   строка колокольчика («Другое», открывает «Подписку»); без привязанного Telegram — только строка.
 *   Переключатели уведомлений профиля и «Напоминания в Telegram» организации их не выключают: это
 *   сообщения о доступе к сайту, как в прототипе.
 *   Администраторам платформы — Telegram (`app.platform_notice`, виды `sub_check`, `storage_check`) и
 *   строки колокольчика Админки, которые кладутся при чтении колокольчика (`bellSyncPlatform`), как заявки.
 * Тексты и время читаются до транзакции (`subNoticeContext`): внутри неё — только `tx`.
 */

/** Тексты, шаблоны, время и ссылка «Подписки» для сообщений — до транзакции. */
export interface SubNoticeContext {
  readonly now: Date;
  readonly today: IsoDate;
  readonly templates: Readonly<Record<string, string>>;
  readonly t: Translate;
  /** Экран «Подписка» владельца (кнопка «Открыть»); null — сайт не по https, кнопки нет. */
  readonly subUrl: string | null;
}

export async function subNoticeContext(
  deps: Parameters<typeof serverTexts>[0] & Pick<ApiDeps, 'clock'>,
  /** Адрес сайта (`APP_BASE_URL`): из него — ссылка кнопки «Открыть». */
  baseUrl: string,
): Promise<SubNoticeContext> {
  const [templates, dict] = await Promise.all([messageTemplates(deps.db), serverTexts(deps)]);
  const now = deps.clock.now();
  return {
    now,
    today: bishkekDate(now),
    templates,
    t: (key, params) => formatText(dict(key), params),
    subUrl: botSiteUrl({ config: { APP_BASE_URL: baseUrl } }, '/app/org/sub'),
  };
}

const tpl = (
  ctx: SubNoticeContext,
  key: TelegramTemplateKey,
  values: Record<string, string | number>,
) => fillTemplate(botTemplate(key, ctx.templates[key]), values);

/** Событие для владельцев: что случилось и подстановки шаблона (`subOwnerValues` домена). */
export type SubOwnerNotice = Parameters<typeof subOwnerValues>[0];

/**
 * Сообщить владельцам организации `orgId` (в её контексте, в транзакции события): Telegram с кнопкой
 * «Открыть» и строка колокольчика. `key` — одно такое сообщение: ключ очереди `<key>:<пользователь>` и
 * ключ события колокольчика; повтор ничего не добавляет. Отвечает номерами строк очереди и сколько
 * строк колокольчика добавлено.
 */
export async function notifySubOwners(
  tx: Tx,
  ctx: SubNoticeContext,
  orgId: string,
  notice: SubOwnerNotice,
  key: string,
): Promise<{ queued: string[]; added: number }> {
  const owners = await bellOwnerUsers(tx, orgId, null);
  if (!owners.length) return { queued: [], added: 0 };
  const text = tpl(ctx, SUB_EVENT_TEMPLATES[notice.event], subOwnerValues(notice));
  const message: BotMessage = {
    text,
    ...(ctx.subUrl ? { buttons: [[{ text: tpl(ctx, 'tgBtnOpen', {}), url: ctx.subUrl }]] } : {}),
  };
  const chats = await telegramChatsOf(tx, owners);
  const queued = await enqueueTelegram(
    tx,
    owners
      .filter((u) => chats.has(u))
      .map((u) => ({
        userId: u,
        chatId: chats.get(u)!,
        kind: 'sub' as const,
        text: botPlainText(message),
        dedupeKey: `${key}:${u}`,
        message,
      })),
    ctx.now,
  );
  const added = await putBell(
    tx,
    owners.map((u) => ({
      userId: u,
      kind: 'other' as const,
      event: 'sub',
      target: { kind: 'sub' as const, id: orgId },
      text,
      eventKey: key,
    })),
    ctx.now,
  );
  return { queued, added };
}

/** {что} сообщения «Новый чек на проверку»: «продление», «расширение пакета», «память сверх». */
export function subWhatText(
  ctx: Pick<SubNoticeContext, 't'>,
  kind: SubscriptionPaymentKind,
): string {
  return kind === 'renew' || kind === 'grow' || kind === 'mem'
    ? ctx.t(`telegram.sub.what.${kind}`)
    : '';
}

/** Чек на проверке для сообщений администраторам. */
export interface SubCheckFacts {
  payId: string;
  orgName: string;
  kind: SubscriptionPaymentKind;
  /** К оплате, тыйыны. */
  amount: number;
}

/** «🧾 Новый чек на проверку: …» (шаблон `tgSubCheckNew`). */
export const subCheckNewText = (ctx: SubNoticeContext, p: SubCheckFacts) =>
  tpl(ctx, 'tgSubCheckNew', {
    организация: p.orgName,
    что: subWhatText(ctx, p.kind),
    сумма: formatSomWithUnit(p.amount),
  });

/** «🧾 Чек … ждёт проверки дней: N» (шаблон `tgSubCheckWait`). */
export const subCheckWaitText = (ctx: SubNoticeContext, p: SubCheckFacts, days: number) =>
  tpl(ctx, 'tgSubCheckWait', {
    организация: p.orgName,
    сумма: formatSomWithUnit(p.amount),
    дней: days,
  });

/**
 * Новый чек на проверку — администраторам платформы в Telegram (стык с потоком И: «Отправить на
 * проверку» владельца зовёт это в своей транзакции, тексты — `subNoticeContext` до неё). Строку
 * колокольчика Админки кладёт чтение колокольчика (`bellSyncPlatform`). Один раз на чек.
 */
export function notifySubCheckNew(tx: Tx, ctx: SubNoticeContext, p: SubCheckFacts) {
  return platformNotice(tx, {
    kind: 'sub_check',
    text: subCheckNewText(ctx, p),
    key: `new:${p.payId}`,
    now: ctx.now,
  });
}

/** Новые расхождения сверки хранилища — администраторам платформы в Telegram, один раз на запуск. */
export function notifyStorageCheck(
  db: Parameters<typeof platformNotice>[0],
  ctx: SubNoticeContext,
  saved: StorageCheckSaved,
) {
  const f = saved.fresh;
  const n = f.missing + f.extra + f.stuck + f.failed;
  if (saved.state !== 'done' || !n) return Promise.resolve(0);
  return platformNotice(db, {
    kind: 'storage_check',
    text: ctx.t('telegram.storage_check.new', { n, ...f }),
    key: `run:${saved.run}`,
    now: ctx.now,
  });
}

/** Час, с которого в колокольчике появляется «Чек ждёт проверки» дня (как сообщение задачи в 09:00). */
const WAIT_FROM = '09:00';

/**
 * Колокольчик администратора платформы при чтении (прототип `subTellAdmins`, `subDaily`): каждый
 * непроверенный чек — «Новый чек на проверку», со следующего дня после 09:00 по Бишкеку — «Чек ждёт
 * проверки дней: N» раз в день; сверка хранилища, нашедшая новые расхождения, — строка запуска. Строки
 * старше срока хранения колокольчика не кладутся. В `withUserContext` администратора.
 */
export async function bellSyncPlatform(
  tx: Tx,
  ctx: SubNoticeContext,
  userId: string,
): Promise<number> {
  const keep = new Date(ctx.now.getTime() - BELL_KEEP_DAYS * 86_400_000);
  const [pays, runs] = await Promise.all([
    adminPendingSubscriptionPayments(tx),
    storageCheckRunsWithNews(tx, keep),
  ]);
  const hhmm = bishkekTime(ctx.now);
  const rows: BellPut[] = [];
  const put = (eventKey: string, text: string, kind: 'sub_check' | 'storage_check', id: string) =>
    rows.push({ userId, kind: 'other', event: kind, target: { kind, id }, text, eventKey });
  for (const p of pays) {
    const facts = { payId: p.id, orgName: p.orgName, kind: p.kind, amount: p.amount };
    if (p.createdAt >= keep)
      put(`sub_check:${p.id}`, subCheckNewText(ctx, facts), 'sub_check', p.orgId);
    const wait = subscriptionCheckWait(bishkekDate(p.createdAt), ctx.today, 0);
    if (wait.repeat && hhmm >= WAIT_FROM) {
      put(
        `sub_check_wait:${p.id}:${ctx.today}`,
        subCheckWaitText(ctx, facts, wait.days),
        'sub_check',
        p.orgId,
      );
    }
  }
  for (const r of runs) {
    put(
      `storage_check:${r.run}`,
      ctx.t('bell.line.storage_check', { n: r.fresh }),
      'storage_check',
      String(r.run),
    );
  }
  return rows.length ? putBell(tx, rows, ctx.now) : 0;
}
