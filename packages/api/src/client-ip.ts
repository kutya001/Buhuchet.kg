import { pageIpSubject } from '@buhuchet/domain';
import type { Context } from 'hono';
import { createHash } from 'node:crypto';
import type { ApiDeps } from './deps';
import type { AppEnv } from './env';

/**
 * Чей счёт попыток по адресу — как у страницы контрагента по ссылке и заявки с лендинга: первый адрес
 * X-Forwarded-For (его ставит Vercel и Caddy на VPS, входящий от клиента они заменяют), IPv6 — по сети
 * /64. В базе — только SHA-256 адреса со своей приставкой `scope`: это маскировка, а не тайна, сам
 * адрес нигде не хранится. Без заголовка (локально, в тестах) — общий счёт «unknown»; на стенде и
 * рабочем сайте это ошибка настройки прокси — пишется предупреждение.
 */
export function clientIpSubject(c: Context<AppEnv>, deps: ApiDeps, scope: string): string {
  const forwarded = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
  if (!forwarded && (deps.config.APP_ENV === 'staging' || deps.config.APP_ENV === 'production')) {
    deps.logger.warn(
      { requestId: c.get('requestId'), scope },
      'нет X-Forwarded-For: предел по адресу общий для всех',
    );
  }
  const subject = forwarded ? pageIpSubject(forwarded) : 'unknown';
  return createHash('sha256').update(`${scope}:${subject}`, 'utf8').digest('hex');
}

/**
 * Адрес клиента для журнала, где его видят люди (журнал запросов «Витрины данных», «Последний запрос»
 * токена; доработки 20.11.2026: Витрина данных, блок 6, пункт 7): первый адрес X-Forwarded-For, до 64
 * знаков, только знаки адреса IPv4 и IPv6. Без заголовка или с мусором — null.
 */
export function clientIpText(c: Context<AppEnv>): string | null {
  const forwarded = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? '';
  return /^[0-9A-Fa-f.:]{2,64}$/.test(forwarded) ? forwarded : null;
}
