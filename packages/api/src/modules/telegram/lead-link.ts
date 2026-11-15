import { hashSessionToken, isSessionTokenShape, newLinkToken } from '@buhuchet/adapters/tokens';
import {
  issueLeadTgToken,
  issuePasswordSetup,
  linkLeadOwnerTelegramRow,
  startLeadTelegram,
  takeLeadRefusal,
  withUserContext,
  type PasswordSetupIssue,
  type Tx,
} from '@buhuchet/db';
import {
  LEAD_TG_TTL_HOURS,
  leadBotFirm,
  leadTgName,
  leadTgUrl,
  OWNER_SETUP_DAYS,
  setPasswordPath,
} from '@buhuchet/domain';
import type { ApiDeps } from '../../deps';
import { botText, sendNow } from './bot';
import { botSiteUrl } from './staff-view';

/*
 * Telegram заявителя — до создания организации (поток Т, доработки 14.11.2026, блок 1, пункты 2–3;
 * прототип v113 modules/tg-lead.js). Стык с потоком И (форма лендинга, «Заявки», «Одобрить», «Отказ»
 * на сайте — его): подача заявки вызывает `issueLeadTgLink` в своей транзакции, «Одобрить» —
 * `linkLeadOwnerTelegram` в транзакции создания организации, после коммита — `sendOwnerSetup`;
 * «Отклонить» на сайте и в чате бота — `sendLeadRefused` после коммита.
 *
 * Сообщения заявителю уходят сразу, мимо очереди и журнала отправок: у заявителя ещё нет учётной
 * записи, а журнал — по пользователям (docs/deviations.md п. Т-18). Ссылка «Задать пароль» — в
 * журнале владельца видом `setup_link`, как код: без текста и кнопок, без повтора.
 */

/** Ссылка «Подключить Telegram» для ответа на заявку. */
export type LeadTgLink = { url: string; token: string; expiresAt: Date } | { linked: true } | null;

/**
 * В транзакции подачи заявки (тот же `now`, что у `submitLead`). Ловушке (`leadId` null) — ссылка того
 * же вида с ключом, которого нет в базе: по ответу ловушку не распознать. Новой заявке — новая ссылка
 * на 24 часа. Повтору — только ссылка браузера, который получил её при подаче (`prior` — её ключ из
 * cookie): та же ссылка или «Telegram уже подключён»; иначе null (без кнопки и без «подключён»).
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#Т-18
export async function issueLeadTgLink(
  tx: Tx,
  p: {
    leadId: string | null;
    repeat: boolean;
    prior: string | null;
    now: Date;
    botUsername: string | undefined;
  },
): Promise<LeadTgLink> {
  const bot = p.botUsername?.trim();
  if (!bot) return null;
  const token = newLinkToken();
  if (p.leadId === null) {
    return {
      url: leadTgUrl(bot, token),
      token,
      expiresAt: new Date(p.now.getTime() + LEAD_TG_TTL_HOURS * 3_600_000),
    };
  }
  const prior = p.prior && isSessionTokenShape(p.prior) ? p.prior : null;
  if (p.repeat && !prior) return null;
  const issued = await issueLeadTgToken(tx, {
    leadId: p.leadId,
    hash: hashSessionToken(token),
    priorHash: p.repeat && prior ? hashSessionToken(prior) : null,
    now: p.now,
    ttlHours: LEAD_TG_TTL_HOURS,
  });
  if (!issued) return null;
  if (issued.outcome === 'linked') return { linked: true };
  const key = issued.outcome === 'same' ? prior! : token;
  return { url: leadTgUrl(bot, key), token: key, expiresAt: issued.till };
}

/**
 * «Одобрить» (в транзакции создания организации, от имени администратора платформы): Telegram
 * заявителя — Telegram владельца. false — заявитель не подключил Telegram (одобрять тогда нельзя) или
 * это не владелец организации, созданной по этой заявке.
 */
export function linkLeadOwnerTelegram(
  tx: Tx,
  p: { leadId: string; userId: string },
): Promise<boolean> {
  return linkLeadOwnerTelegramRow(tx, p);
}

/** «Старт» по ссылке заявителя из личного чата: ответ бота; повтор доставки — без ответа. */
export async function leadTgStart(
  deps: ApiDeps,
  chat: { chatId: number; username: string | null; firstName: string | null },
  key: string,
): Promise<void> {
  const res = await startLeadTelegram(deps.db, {
    hash: hashSessionToken(key),
    chatId: chat.chatId,
    username: chat.username,
    firstName: chat.firstName,
    name: leadTgName(chat),
    now: deps.clock.now(),
  });
  if (res.outcome === 'again') return;
  const text =
    res.outcome === 'linked'
      ? await botText(deps, 'tgLeadGot', { фирма: leadBotFirm(res.firm) })
      : res.outcome === 'refused'
        ? await botText(deps, 'tgLeadNo', { фирма: leadBotFirm(res.firm), причина: res.reason })
        : await botText(deps, 'tgLeadLinkBad');
  await sendNow(deps, chat.chatId, text, 'lead_start');
}

export type OwnerSetupSent = 'sent' | 'no_telegram' | 'failed';

/**
 * Сообщение со ссылкой «Задать пароль» по выданной ссылке: после «Одобрить» — «Организация создана»,
 * после «Отправить новую ссылку» — «Новая ссылка…». Ключ ссылки — только в кнопке; в журнал отправок
 * сообщение пишется без текста и кнопок (вид `setup_link`, как код).
 */
export async function sendSetupMessage(
  deps: ApiDeps,
  userId: string,
  issued: PasswordSetupIssue,
  token: string,
): Promise<OwnerSetupSent> {
  if (issued.outcome === 'no_telegram') return 'no_telegram';
  const url = botSiteUrl(deps, setPasswordPath(token));
  if (!url) {
    deps.logger.error('Telegram: ссылка «Задать пароль» не отправлена — у сайта нет адреса https');
    return 'failed';
  }
  const text = issued.first
    ? await botText(deps, 'tgLeadDone', {
        организация: issued.orgName,
        логин: issued.login,
        дней: OWNER_SETUP_DAYS,
      })
    : await botText(deps, 'tgSetPassNew', { логин: issued.login, дней: OWNER_SETUP_DAYS });
  const ok = await sendNow(
    deps,
    issued.chatId,
    text,
    'owner_setup',
    { keyboard: [[{ text: await botText(deps, 'tgBtnSetPass'), url }]], disableLinkPreview: true },
    { userId, kind: 'setup_link' },
  );
  return ok ? 'sent' : 'failed';
}

/** Новый ключ ссылки «Задать пароль» и его хеш для базы. */
export function newSetupKey(): { token: string; hash: string } {
  const token = newLinkToken();
  return { token, hash: hashSessionToken(token) };
}

/**
 * После «Одобрить» (после коммита): ссылка «Задать пароль» на 7 дней в Telegram владельца — тот, что
 * подключил заявитель. Не бросает: сбой Telegram или базы — в журнал сервера, ответ «failed».
 */
export async function sendOwnerSetup(
  deps: ApiDeps,
  p: { userId: string; adminId: string },
): Promise<OwnerSetupSent> {
  try {
    const { token, hash } = newSetupKey();
    const issued = await withUserContext(deps.db, p.adminId, (tx) =>
      issuePasswordSetup(tx, {
        userId: p.userId,
        hash,
        now: deps.clock.now(),
        days: OWNER_SETUP_DAYS,
      }),
    );
    if (!issued) return 'failed';
    return await sendSetupMessage(deps, p.userId, issued, token);
  } catch (err) {
    deps.logger.error({ err }, 'Telegram: ссылка «Задать пароль» владельцу не отправлена');
    return 'failed';
  }
}

/**
 * После «Отклонить» на сайте или в чате бота (после коммита): причина отказа заявителю в Telegram —
 * только заявке «Отказ» с подключённым Telegram и только ещё не отправленная. Не бросает.
 */
export async function sendLeadRefused(
  deps: ApiDeps,
  p: { leadId: string },
): Promise<'sent' | 'not_linked' | 'failed'> {
  try {
    const refusal = await takeLeadRefusal(deps.db, p.leadId);
    if (!refusal) return 'not_linked';
    const text = await botText(deps, 'tgLeadNo', {
      фирма: leadBotFirm(refusal.firm),
      причина: refusal.reason,
    });
    return (await sendNow(deps, refusal.chatId, text, 'lead_refused')) ? 'sent' : 'failed';
  } catch (err) {
    deps.logger.error({ err }, 'Telegram: причина отказа заявителю не отправлена');
    return 'failed';
  }
}
