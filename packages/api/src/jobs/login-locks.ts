import { loginLockStats } from '@buhuchet/db';
import {
  ACCOUNT_LOCK_FAILURES,
  AUTH_IP_MAX_ATTEMPTS,
  AUTH_IP_WINDOW_MINUTES,
  LOGIN_LOCK_MINUTES,
} from '@buhuchet/domain';
import type { Job } from '../deps';
import { alertTexts, sendPlatformAlert } from './alerts';

/*
 * Оповещение о массовых блокировках входа (ревью безопасности Р-8 А, docs/decisions.md п. О-32):
 * каждые 10 минут — сколько блокировок входа началось за последний час (по часам базы, как и сами
 * блокировки); от LOGIN_LOCKS_ALERT_MIN — сообщение администратору платформы в Telegram (похоже на
 * перебор паролей), не чаще раза в час. Блокировки — логин закрыт на 15 минут после 5 неверных
 * паролей, учётная запись заблокирована после 10 подряд, адрес исчерпал предел попыток входа.
 */

/** Порог: столько блокировок входа за час и больше — оповещение. */
export const LOGIN_LOCKS_ALERT_MIN = 10;
/** Окно счёта, минут. */
export const LOGIN_LOCKS_WINDOW_MINUTES = 60;
/** Оповещение о блокировках — не чаще раза в столько секунд. */
export const LOGIN_LOCKS_ALERT_EVERY_SECONDS = 3600;

/**
 * Вид строк предела попыток входа с адреса — тот же, что `AUTH_IP_LIMIT.kind` в
 * modules/auth/ip-limit.ts (сверяет тест). Не импортом: этот файл входит в сборку worker, а модуль
 * входа тянет типы сайта.
 */
export const AUTH_IP_KIND = 'auth_ip';

export const watchLoginLocksJob: Job = {
  name: 'auth.watch-login-locks',
  cron: '*/10 * * * *',
  lookbackMinutes: 10,
  async run(ctx) {
    const stats = await loginLockStats(ctx.db, {
      windowMinutes: LOGIN_LOCKS_WINDOW_MINUTES,
      lockMinutes: LOGIN_LOCK_MINUTES,
      ip: {
        kind: AUTH_IP_KIND,
        max: AUTH_IP_MAX_ATTEMPTS,
        windowSeconds: AUTH_IP_WINDOW_MINUTES * 60,
      },
    });
    const total = stats.logins + stats.accounts + stats.ipBlocks;
    if (total < LOGIN_LOCKS_ALERT_MIN) return;
    ctx.logger.warn({ ...stats }, 'много блокировок входа за час');
    const t = await alertTexts(ctx);
    await sendPlatformAlert(ctx, {
      key: 'login-locks',
      everySeconds: LOGIN_LOCKS_ALERT_EVERY_SECONDS,
      text: t('alert.login_locks', {
        n: total,
        logins: stats.logins,
        accounts: stats.accounts,
        ip: stats.ipBlocks,
        lockMinutes: LOGIN_LOCK_MINUTES,
        failures: ACCOUNT_LOCK_FAILURES,
        ipMax: AUTH_IP_MAX_ATTEMPTS,
        ipMinutes: AUTH_IP_WINDOW_MINUTES,
      }),
    });
  },
};
