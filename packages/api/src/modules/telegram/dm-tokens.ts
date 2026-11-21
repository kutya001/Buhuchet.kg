import {
  bellOwnerUsers,
  contextOrgName,
  dmTokensExpiring,
  enqueueTelegram,
  messageTemplates,
  orgIds,
  telegramChatsOf,
  withOrgContext,
  type Tx,
} from '@buhuchet/db';
import {
  botPlainText,
  botTemplate,
  DM_TOKEN_EVENT_TEMPLATES,
  DM_TOKEN_SOON_DAYS,
  dmTokenNoticeValues,
  dmTokenSoonDays,
  fillTemplate,
  type BotMessage,
  type DmTokenNotice,
  type TelegramTemplateKey,
} from '@buhuchet/domain';
import type { ApiDeps, Job } from '../../deps';
import { putBell } from './bell';
import { botSiteUrl } from './staff-view';

/*
 * Сообщения владельцам организации об API-токенах «Витрины данных» (доработки 20.11.2026: Витрина
 * данных, блок 5, пункт 10; поток Т, общий план 20.11, этап 3, П5; прототип v158 `dmTell`, `dmDaily`):
 * «создан» (выпуск и перевыпуск), «отозван» (и администратором платформы), «до конца срока 7 дней».
 *   Telegram (вид `dm_token`, кнопка «Открыть» — окно токена на вкладке «API Токены») и строка
 *   колокольчика («Другое», открывает то же окно; видна только владельцу). Без привязанного Telegram —
 *   только строка. Как сообщения о подписке, переключатели уведомлений их не выключают: это защита
 *   доступа к данным организации.
 *   Токен Админки (без организации) — без сообщений: владельцев у него нет.
 * Шаблоны и время читаются до транзакции (`dmTokenNoticeContext`): внутри неё — только `tx`.
 * Решение — docs/decisions.md п. Т-21.
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#Т-31

/** Шаблоны, время и ссылка на окно токена — до транзакции. */
export interface DmTokenNoticeContext {
  readonly now: Date;
  readonly templates: Readonly<Record<string, string>>;
  /** Адрес сайта (`APP_BASE_URL`): из него — ссылка кнопки «Открыть». */
  readonly baseUrl: string;
}

export async function dmTokenNoticeContext(
  deps: Pick<ApiDeps, 'db' | 'clock'>,
  baseUrl: string,
): Promise<DmTokenNoticeContext> {
  return { now: deps.clock.now(), templates: await messageTemplates(deps.db), baseUrl };
}

/** Окно токена на вкладке «API Токены» организации (кнопка «Открыть»); не https — кнопки нет. */
export const dmTokenSiteUrl = (baseUrl: string, tokenId: string) =>
  botSiteUrl({ config: { APP_BASE_URL: baseUrl } }, `/app/dm/tok?tok=${tokenId}`);

const tpl = (
  ctx: DmTokenNoticeContext,
  key: TelegramTemplateKey,
  values: Record<string, string | number>,
) => fillTemplate(botTemplate(key, ctx.templates[key]), values);

/**
 * Сообщить владельцам организации `orgId` (в её контексте, в транзакции события) о токене `tokenId`:
 * Telegram с кнопкой «Открыть» и строка колокольчика. `key` — одно такое сообщение: ключ очереди
 * `<key>:<пользователь>` и ключ события колокольчика; повтор ничего не добавляет. Отвечает номерами строк
 * очереди и сколько строк колокольчика добавлено.
 */
export async function notifyDmTokenOwners(
  tx: Tx,
  ctx: DmTokenNoticeContext,
  orgId: string,
  tokenId: string,
  notice: DmTokenNotice,
  key: string,
): Promise<{ queued: string[]; added: number }> {
  const owners = await bellOwnerUsers(tx, orgId, null);
  if (!owners.length) return { queued: [], added: 0 };
  const text = tpl(ctx, DM_TOKEN_EVENT_TEMPLATES[notice.event], dmTokenNoticeValues(notice));
  const url = dmTokenSiteUrl(ctx.baseUrl, tokenId);
  const message: BotMessage = {
    text,
    ...(url ? { buttons: [[{ text: tpl(ctx, 'tgBtnOpen', {}), url }]] } : {}),
  };
  const chats = await telegramChatsOf(tx, owners);
  const queued = await enqueueTelegram(
    tx,
    owners
      .filter((u) => chats.has(u))
      .map((u) => ({
        userId: u,
        chatId: chats.get(u)!,
        kind: 'dm_token' as const,
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
      event: 'dm_token',
      target: { kind: 'dm_token' as const, id: tokenId },
      text,
      eventKey: key,
    })),
    ctx.now,
  );
  return { queued, added };
}

/** Ключи одного сообщения о токене (очередь — с пользователем, колокольчик — как есть). */
export const DM_TOKEN_NOTICE_KEYS = {
  new: (id: string) => `dm_tok_new:${id}`,
  revoked: (id: string) => `dm_tok_revoked:${id}`,
  soon: (id: string) => `dm_tok_soon:${id}`,
} as const;

const DAY_MS = 86_400_000;

/**
 * «Витрина: срок API-токенов» — каждый день в 09:00 по Бишкеку: токенам организаций, у которых до конца
 * срока от 1 до 7 дней (`dmTokenSoonDays`), — владельцам «действует до …, осталось дней: N». Один раз на
 * токен: ключ без дня, повтор и следующие дни ничего не добавляют. Каждая организация — своей
 * транзакцией в её контексте; одна упала — остальные идут дальше, запуск отмечается сбоем. Отвечает,
 * о скольких токенах напомнили.
 */
export function dmTokenExpiryJob(baseUrl: string): Job {
  return {
    name: 'dm.token-expiry',
    cron: '0 9 * * *',
    lookbackMinutes: 24 * 60,
    async run(ctx, slot) {
      const nc = await dmTokenNoticeContext(ctx, baseUrl);
      const until = new Date(slot.getTime() + (DM_TOKEN_SOON_DAYS + 1) * DAY_MS);
      const failed: string[] = [];
      let done = 0;
      for (const orgId of await orgIds(ctx.db)) {
        try {
          done += await withOrgContext(ctx.db, { orgId, kind: 'job' }, async (tx) => {
            const soon = (await dmTokensExpiring(tx, { now: slot, until })).flatMap((k) => {
              const days = dmTokenSoonDays(k, slot);
              return days === null ? [] : [{ ...k, days }];
            });
            if (!soon.length) return 0;
            const org = (await contextOrgName(tx)) ?? '';
            let n = 0;
            for (const k of soon) {
              const { queued, added } = await notifyDmTokenOwners(
                tx,
                nc,
                orgId,
                k.id,
                {
                  event: 'soon',
                  org,
                  name: k.name,
                  template: k.templateName,
                  expiresAt: k.expiresAt,
                  days: k.days,
                },
                DM_TOKEN_NOTICE_KEYS.soon(k.id),
              );
              if (queued.length || added) n++;
            }
            return n;
          });
        } catch (err) {
          failed.push(orgId);
          ctx.logger.error({ job: 'dm.token-expiry', orgId, err }, 'организация не обработана');
        }
      }
      if (failed.length) {
        throw new Error(`dm.token-expiry: не обработаны организации: ${failed.length}`);
      }
      return done;
    },
  };
}
