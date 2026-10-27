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
