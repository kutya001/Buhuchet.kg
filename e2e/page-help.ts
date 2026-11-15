import { readFileSync } from 'node:fs';
import { expect, type BrowserContext, type Page } from '@playwright/test';

// Подсказки страницы контрагента (доработки 15.11.2026; прототип v120 modules/cp-help.js) в сквозных
// тестах: отметка «приветствие уже видели», окно итога после отправки и тексты подсказок.

// «Добро пожаловать» открывается при первом входе по коду и закрыло бы страницу в чужих проверках.
// Отметку «уже видели» страница ставит cookie `bh_pgwel=1` под адресом страницы и читает в
// `document.cookie` (`welcomeSeen`, apps/web/src/contractor-page/page-help-model.ts): у всех тестов она
// уже есть — под всем сайтом (`storageState` в playwright.config.ts). Само окно проверяет
// contractor-page-help.spec.ts — он эту отметку убирает (`forgetWelcome`).

/** Имя cookie отметки. */
export const WELCOME_COOKIE = 'bh_pgwel';

/** Начальное состояние браузера тестов: приветствие страницы контрагента уже видели. */
export function welcomeSeenState(baseURL: string) {
  return {
    cookies: [
      {
        name: WELCOME_COOKIE,
        value: '1',
        domain: new URL(baseURL).hostname,
        path: '/',
        expires: -1,
        httpOnly: false,
        secure: false,
        sameSite: 'Lax' as const,
      },
    ],
    origins: [],
  };
}

/** Забыть вход и код страницы, а отметку о приветствии оставить (вместо `clearCookies()`). */
export async function clearCookiesButWelcome(context: BrowserContext): Promise<void> {
  await context.clearCookies({ name: new RegExp(`^(?!${WELCOME_COOKIE}$)`) });
}

/** Забыть отметку: страница снова встретит приветствием. */
export async function forgetWelcome(context: BrowserContext): Promise<void> {
  await context.clearCookies({ name: WELCOME_COOKIE });
}

/**
 * Окно итога после отправки (`useDoneDialog`): заголовок, что будет дальше (`text`, если задан),
 * «Понятно» — и окна нет.
 */
export async function closeDone(page: Page, title: string, text?: string): Promise<void> {
  const done = page.getByRole('dialog', { name: title });
  await expect(done.locator('[data-pub-done]')).toBeVisible();
  if (text) await expect(done.locator('[data-pub-done]')).toHaveText(text);
  await done.locator('[data-pub-done-ok]').click();
  await expect(done).toBeHidden();
}

interface CpHelp {
  welcome: Record<string, string>;
  tour: { id: string; sec: string; t: string; x: string; x2?: string; on: boolean }[];
  faq: { id: string; q: string; a: string; sec: string; act: string; on: boolean }[];
  gloss: { w: string; x: string; also?: string }[];
  hints: Record<string, string>;
}

/**
 * Подсказки страницы, как их наполняет `pnpm db:seed` (`kbUi.cpHelp` refDB.json). Админка их правит, но
 * тест Админки (admin-cppage.shared.spec.ts) меняет только свой вопрос и возвращает всё как было.
 */
export const PAGE_HELP = (
  JSON.parse(readFileSync(new URL('../spec/data/refDB.json', import.meta.url), 'utf8')) as {
    kbUi: { cpHelp: CpHelp };
  }
).kbUi.cpHelp;

/** Подсказка с подстановками `{имя}` (как `cpHelpFill`). */
export function pageHint(key: string, vars: Record<string, string | number> = {}): string {
  const raw = PAGE_HELP.hints[key] ?? '';
  return raw.replace(/\{([^}]+)\}/g, (m, k: string) => (vars[k] != null ? String(vars[k]) : m));
}
