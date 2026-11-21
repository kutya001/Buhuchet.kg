import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { signIn, uniqueLogin } from './helpers';

// Общее для сквозных тестов Админки. Администратор свой на каждый тест и проект: его создаёт
// `pnpm db:create-admin` (база сайта — та же, что в .env), временный пароль сразу меняется через API.

const ROOT = fileURLToPath(new URL('..', import.meta.url));
// Пароль администратора — свой на каждый прогон: в базе, где шёл тест, не остаётся администраторов с
// известным паролем.
export const ADMIN_PASSWORD = `Adm-${randomBytes(12).toString('base64url')}`;
/** Временный пароль владельца новой организации — тоже свой на каждый прогон. */
export const ownerPassword = () => `Own-${randomBytes(9).toString('base64url')}`;

/** Администратор платформы с уже сменённым временным паролем; сеанс — в `api`. */
export async function platformAdmin(api: APIRequestContext, origin: string): Promise<string> {
  const login = uniqueLogin('e2e-adm');
  const out = execFileSync('pnpm', ['--silent', 'db:create-admin', '--login', login], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  const temporary = /Временный пароль[^:]*:\s*(\S+)/.exec(out)?.[1];
  expect(temporary, out).toBeTruthy();
  await signIn(api, origin, login, temporary!);
  const changed = await api.post('/api/auth/password', {
    headers: { origin },
    data: { currentPassword: temporary, newPassword: ADMIN_PASSWORD },
  });
  expect(changed.status(), await changed.text()).toBe(200);
  return login;
}

/**
 * Блок «Подписка» новой организации теста (доработки 20.11.2026, блок 6, пункт 4): без него у
 * организации «Нет подписки» — сотрудники не войдут, владельцу открыта только «Подписка».
 */
export const E2E_SUBSCRIPTION = {
  planId: 'm1',
  seats: 1000,
  extraGb: 0,
  paidUntil: '2099-12-31',
  extraDiscountPct: 0,
  free: true,
} as const;

/**
 * Подписка организации, созданной без неё («Одобрить» заявки — «Нет подписки»): администратор ставит её
 * «Изменить подписку» (`PUT /api/admin/subscriptions/{orgId}`), сеанс администратора — в `api`.
 */
export async function giveSubscription(api: APIRequestContext, origin: string, inn: string) {
  const orgs = (await (
    await api.get('/api/admin/organizations?size=all', { maxRetries: 2 })
  ).json()) as { items: { id: string; inn: string }[] };
  const org = orgs.items.find((o) => o.inn === inn);
  expect(org, inn).toBeTruthy();
  const res = await api.put(`/api/admin/subscriptions/${org!.id}`, {
    headers: { origin },
    data: { ...E2E_SUBSCRIPTION, reason: 'e2e' },
  });
  expect(res.status(), await res.text()).toBe(200);
}

/** Свой ИНН (14 цифр) на каждый запуск: второй организации с тем же ИНН быть не может. */
export const uniqueInn = () =>
  `9${Date.now().toString().slice(-9)}${Math.floor(Math.random() * 10_000)
    .toString()
    .padStart(4, '0')}`;

/** Общий поиск по вкладке (на телефоне — кнопкой «Поиск» в верхней панели). */
export async function search(page: Page, isMobile: boolean, text: string) {
  if (isMobile && !(await page.getByRole('searchbox').first().isVisible())) {
    await page.getByRole('button', { name: 'Поиск', exact: true }).click();
  }
  await page.getByRole('searchbox').first().fill(text);
}
