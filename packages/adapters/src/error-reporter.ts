import { randomUUID } from 'node:crypto';
import type { Logger } from './logger';
import { safeErrorMessage } from './logger';

/**
 * Ошибки сервера во внешний сервис (Sentry), чтобы о них узнавали не из журнала Vercel, который
 * хранится недолго (ревью безопасности Р-8, docs/decisions.md п. О-30). Включается переменной
 * `SENTRY_DSN`; без неё ничего не отправляется. Отправка — своим кодом по протоколу Sentry (envelope),
 * без SDK: так в событие попадает только то, что мы сами положили, — текст ошибки без значений
 * параметров запроса к базе (вместо текста ошибки запроса — код PostgreSQL), строки стека без первой
 * строки (в ней текст ошибки), имя задачи или путь запроса. Токен бота из адресов `api.telegram.org/bot…`
 * вычищается. Отправка не дольше 2 с и никогда не роняет вызывающего.
 */
export interface ErrorReporter {
  capture(error: unknown, context?: ErrorContext): Promise<void>;
}

/** Что известно о месте ошибки: только короткие несекретные значения. */
export type ErrorContext = Record<string, string | number | boolean | null | undefined>;

export const noopErrorReporter: ErrorReporter = {
  capture: async () => {},
};

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

interface ParsedDsn {
  envelopeUrl: string;
  publicKey: string;
  dsn: string;
}

/** DSN вида `https://<ключ>@<адрес>/<проект>` (у своего сервера — ещё путь перед номером проекта). */
export function parseSentryDsn(dsn: string): ParsedDsn | null {
  let url: URL;
  try {
    url = new URL(dsn.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const publicKey = decodeURIComponent(url.username);
  const parts = url.pathname.split('/').filter(Boolean);
  const project = parts.pop();
  if (!publicKey || !project || !/^\d+$/.test(project)) return null;
  const prefix = parts.length ? `/${parts.join('/')}` : '';
  return {
    envelopeUrl: `${url.protocol}//${url.host}${prefix}/api/${project}/envelope/`,
    publicKey,
    dsn: `${url.protocol}//${publicKey}@${url.host}${prefix}/${project}`,
  };
}

const TELEGRAM_TOKEN = /bot\d{3,}:[A-Za-z0-9_-]{20,}/g;
const MAX_TEXT = 2000;
const MAX_CAUSES = 5;
const MAX_FRAMES = 50;

/** Убрать из текста то, что не должно уходить наружу: токен бота в адресе Bot API. */
export function scrubText(text: string): string {
  return text.replace(TELEGRAM_TOKEN, 'bot[скрыто]').slice(0, MAX_TEXT);
}

interface SentryFrame {
  function?: string;
  filename?: string;
  lineno?: number;
  colno?: number;
  in_app: boolean;
}

/** Строки стека V8 «at функция (файл:строка:столбец)» → кадры Sentry (от старых к новым). */
export function stackFrames(stack: string | undefined): SentryFrame[] {
  if (!stack) return [];
  const frames: SentryFrame[] = [];
  for (const line of stack.split('\n').slice(1)) {
    const m = /^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?\s*$/.exec(line);
    if (!m) continue;
    const [, fn, file, lineno, colno] = m;
    const filename = scrubText(file!);
    frames.push({
      ...(fn ? { function: scrubText(fn) } : {}),
      filename,
      lineno: Number(lineno),
      colno: Number(colno),
      in_app: !filename.includes('node_modules') && !filename.startsWith('node:'),
    });
  }
  return frames.slice(0, MAX_FRAMES).reverse();
}

interface SentryException {
  type: string;
  value: string;
  stacktrace?: { frames: SentryFrame[] };
}

/** Ошибка и её причины (`cause`) — исключения события Sentry: внешняя последней, как у SDK. */
export function exceptionsOf(error: unknown): SentryException[] {
  const out: SentryException[] = [];
  let e: unknown = error;
  for (let depth = 0; depth < MAX_CAUSES && e !== undefined && e !== null; depth++) {
    if (e instanceof Error) {
      const frames = stackFrames(e.stack);
      // Ошибка запроса к базе несёт значения параметров в тексте: вместо него — код PostgreSQL
      // (как в журнале, `serializeError`); у остальных — свой текст.
      const isQuery = 'query' in e && 'params' in e;
      // Ошибка PostgreSQL без обёртки запроса (BEGIN, COMMIT, прямой вызов): в её тексте бывают
      // значения («invalid input syntax …: "…"») — только код.
      const pgCode = 'severity' in e && 'code' in e ? String(e.code) : null;
      out.push({
        type: scrubText(e.name || 'Error'),
        value: isQuery
          ? scrubText(safeErrorMessage(e))
          : pgCode !== null
            ? `Ошибка базы (${scrubText(pgCode)})`
            : scrubText(e.message),
        ...(frames.length ? { stacktrace: { frames } } : {}),
      });
      // Причина ошибки запроса (ошибка PostgreSQL) уже вошла в текст кодом.
      if (isQuery || pgCode !== null) break;
      e = e.cause;
    } else {
      out.push({ type: 'Error', value: scrubText(safeErrorMessage(e)) });
      break;
    }
  }
  return out.reverse();
}

/**
 * Отправитель в Sentry по DSN. Неверный DSN — предупреждение в журнал один раз и ничего не
 * отправляется (настройка мониторинга не должна останавливать сайт).
 */
export function createSentryReporter(options: {
  dsn: string | undefined;
  environment: string;
  release: string;
  service: string;
  logger: Logger;
  fetch?: FetchLike;
  timeoutMs?: number;
  now?: () => Date;
}): ErrorReporter {
  if (!options.dsn) return noopErrorReporter;
  const parsed = parseSentryDsn(options.dsn);
  if (!parsed) {
    options.logger.warn('SENTRY_DSN не похож на адрес Sentry: ошибки в Sentry не отправляются');
    return noopErrorReporter;
  }
  const doFetch: FetchLike = options.fetch ?? ((input, init) => fetch(input, init));
  const now = options.now ?? (() => new Date());
  return {
    async capture(error, context = {}) {
      try {
        const at = now();
        const eventId = randomUUID().replaceAll('-', '');
        const tags: Record<string, string> = { service: options.service };
        const extra: Record<string, string | number | boolean> = {};
        for (const [k, v] of Object.entries(context)) {
          if (v === undefined || v === null) continue;
          const value = typeof v === 'string' ? scrubText(v).slice(0, 200) : v;
          if (k === 'job' || k === 'path' || k === 'method') tags[k] = String(value);
          else extra[k] = value;
        }
        const event = {
          event_id: eventId,
          timestamp: at.getTime() / 1000,
          platform: 'node',
          level: 'error',
          logger: options.service,
          environment: options.environment,
          release: options.release,
          tags,
          extra,
          exception: { values: exceptionsOf(error) },
        };
        const body = [
          JSON.stringify({ event_id: eventId, sent_at: at.toISOString(), dsn: parsed.dsn }),
          JSON.stringify({ type: 'event' }),
          JSON.stringify(event),
        ].join('\n');
        const res = await doFetch(parsed.envelopeUrl, {
          method: 'POST',
          headers: {
            'content-type': 'application/x-sentry-envelope',
            'x-sentry-auth': `Sentry sentry_version=7, sentry_client=buhuchet/1.0, sentry_key=${parsed.publicKey}`,
          },
          body,
          signal: AbortSignal.timeout(options.timeoutMs ?? 2000),
        });
        if (!res.ok) {
          options.logger.warn({ status: res.status }, 'Sentry не принял ошибку');
        }
      } catch (err) {
        options.logger.warn({ err }, 'ошибка не отправлена в Sentry');
      }
    },
  };
}
