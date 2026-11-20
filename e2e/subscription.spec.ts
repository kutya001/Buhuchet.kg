import { randomBytes } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { newOrgOwner, signIn, uniqueLogin } from './helpers';

// Экран «Подписка» владельца, окно оплаты с чеком и окно «Память организации заполнена» (доработки
// 20.11.2026, блок 5; блок 2, пункт 5; прототип v154 modules/org-sub.js; пакет 2, этап 1, П7, поток И).
// Организация своя на каждый тест: новая организация получает бесплатный период (этап 1, П1).

type Texts = Record<string, string>;

/** Тексты словаря интерфейса (`GET /api/l10n`): тест не копирует строки экрана. */
async function dictionary(api: APIRequestContext): Promise<Texts> {
  const res = await api.get('/api/l10n');
  expect(res.status()).toBe(200);
  return ((await res.json()) as { texts: Texts }).texts;
}

interface SubPay {
  id: string;
  kind: string;
  planId: string | null;
  months: number;
  amount: number;
  status: string;
  receipt: { name: string } | null;
}
interface SubView {
  status: string;
  sub: { planId: string; free: boolean; paidUntil: string } | null;
  payments: SubPay[];
}

async function subView(api: APIRequestContext): Promise<SubView> {
  const res = await api.get('/api/org/subscription', { maxRetries: 2 });
  expect(res.status(), await res.text()).toBe(200);
  return (await res.json()) as SubView;
}

const ruDate = (iso: string) => iso.split('-').reverse().join('.');

/** Чек: тип проверяется по содержимому — у PDF первые байты «%PDF-», у PNG — подпись PNG. */
const PDF = Buffer.from('%PDF-1.4\n% e2e\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n');
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/** Учётная политика: включить «Файлы в карточках» (модуль «Файлы»). */
async function filesOn(api: APIRequestContext, origin: string) {
  const current = (await (await api.get('/api/org/policy')).json()) as { version: number };
  const res = await api.patch('/api/org/policy', {
    headers: { origin },
    data: { version: current.version, features: { files: true } },
  });
  expect(res.status(), await res.text()).toBe(200);
}

test.describe('Доработки 20.11. Подписка владельца', () => {
  test('(блок 5) «Подписка»: вид и срок, «Продлить» — окно с видом подписки, расчётом и чеком → «Ждёт подтверждения»; «Заменить файл чека» до проверки; оплата из «Истории оплат»', async ({
    page,
    baseURL,
  }) => {
    const origin = new URL(baseURL!).origin;
    await newOrgOwner(page.request, origin);
    const texts = await dictionary(page.request);
    const before = await subView(page.request);
    expect(before.sub).toMatchObject({ free: true });

    await page.goto('/app/org/sub');
    const screen = page.locator('[data-sub-screen="own"]');
    await expect(screen.locator('[data-sub-top]')).toContainText(
      texts['sub.kind.free']!.replace('{date}', ruDate(before.sub!.paidUntil)),
    );
    await expect(screen.locator('[data-sub-card="term"]')).toContainText(
      ruDate(before.sub!.paidUntil),
    );
    // Бесплатный период — строка «Истории оплат» без суммы от «Системы».
    await expect(screen.locator('[data-sub-pays] [data-mini-row]')).toHaveCount(
      before.payments.length,
    );

    // «Продлить»: вид «3 месяца», расчёт, чек PDF → «Отправить на проверку».
    await screen.locator('[data-sub-pay-open="renew"]').click();
    const pay = page.getByRole('dialog', { name: texts['sub.pay.title.renew'] });
    const form = pay.locator('[data-sub-pay="renew"]');
    await form.locator('[data-sub-kind="m3"]').click();
    await expect(form.locator('[data-sub-kind="m3"]')).toHaveAttribute('aria-checked', 'true');
    await expect(form.locator('[data-sub-calc-total]')).not.toBeEmpty();
    const name = `чек-${randomBytes(3).toString('hex')}.pdf`;
    await form
      .locator('[data-sub-drop] input[type="file"]')
      .setInputFiles({ name, mimeType: 'application/pdf', buffer: PDF });
    await expect(form.locator('[data-sub-file]')).toContainText(name);
    const sent = page.waitForResponse(
      (r) =>
        r.request().method() === 'POST' &&
        new URL(r.url()).pathname === '/api/org/subscription/payments/complete',
    );
    await pay.locator('[data-sub-pay-send]').click();
    expect((await sent).status()).toBe(201);
    await expect(pay).toBeHidden();

    // Чек на проверке: полоса с «Заменить файл чека», в истории — «Ждёт подтверждения».
    const after = await subView(page.request);
    const mine = after.payments.find((p) => p.receipt?.name === name);
    expect(mine).toMatchObject({ kind: 'renew', planId: 'm3', months: 3, status: 'pending' });
    expect(mine!.amount).toBeGreaterThan(0);
    await expect(screen.locator('[data-sub-wait]')).toBeVisible();
    const row = screen.locator(`[data-sub-pays] [data-mini-row="${mine!.id}"]`);
    await expect(row).toContainText(texts['sub.pay.st.pending']!);
    await expect(screen.locator('[data-sub-pay-open="renew"]')).toBeDisabled();

    // «Заменить файл чека»: новый файл — PNG; в оплате — новый чек.
    await screen.locator('[data-sub-wait-file]').click();
    const replace = page.getByRole('dialog', { name: texts['sub.file.title'] });
    const png = `фото-чека-${randomBytes(3).toString('hex')}.png`;
    await replace
      .locator(`[data-sub-replace="${mine!.id}"] input[type="file"]`)
      .setInputFiles({ name: png, mimeType: 'image/png', buffer: PNG });
    await expect(replace.locator('[data-sub-file]')).toContainText(png);
    const replaced = page.waitForResponse(
      (r) =>
        r.request().method() === 'POST' &&
        new URL(r.url()).pathname === `/api/org/subscription/payments/${mine!.id}/receipt/complete`,
    );
    await replace.locator('[data-sub-file-ok]').click();
    expect((await replaced).status()).toBe(200);
    await expect(page.getByText(texts['sub.file.done']!)).toBeVisible();
    await expect
      .poll(async () => (await subView(page.request)).payments.find((p) => p.id === mine!.id))
      .toMatchObject({ status: 'pending', receipt: { name: png } });

    // Строка «Истории оплат» открывает оплату с расчётом и чеком.
    await row.click();
    const view = page.locator(`[data-sub-view="${mine!.id}"]`);
    await expect(view).toBeVisible();
    await expect(view.locator('[data-sub-calc-total]')).not.toBeEmpty();
    await expect(view.locator('[data-sub-receipt]')).toContainText(png);
  });

  test('(блок 5, пункт 1) «Подписку» видит только владелец: у сотрудника нет вкладки, методы отвечают отказом', async ({
    page,
    baseURL,
  }) => {
    const origin = new URL(baseURL!).origin;
    await newOrgOwner(page.request, origin);
    const roles = (await (await page.request.get('/api/roles?size=all')).json()) as {
      items: { id: string; name: string }[];
    };
    const login = uniqueLogin('e2e-sub-staff');
    const hired = await page.request.post('/api/staff', {
      headers: { origin },
      data: {
        fullName: 'Подписочный Сквозной Тестович',
        login,
        phone: null,
        roleId: roles.items.find((r) => r.name === 'Бухгалтер')!.id,
      },
    });
    expect(hired.status(), await hired.text()).toBe(201);
    const { temporaryPassword } = (await hired.json()) as { temporaryPassword: string };
    await page.request.post('/api/auth/logout', { headers: { origin } });
    await signIn(page.request, origin, login, temporaryPassword);
    const changed = await page.request.post('/api/auth/password', {
      headers: { origin },
      data: { currentPassword: temporaryPassword, newPassword: 'Свой-пароль-e2e-1' },
    });
    expect(changed.status(), await changed.text()).toBe(200);

    const refused = await page.request.get('/api/org/subscription');
    expect(refused.status()).toBe(403);
    expect(((await refused.json()) as { error: { code: string } }).error.code).toBe(
      'sub_owner_only',
    );
    await page.goto('/app/org/sub');
    await expect(page.locator('[data-org-tabs], [role="tablist"]').first()).toBeVisible();
    await expect(page.locator('[data-sub-screen]')).toHaveCount(0);
    await expect(page.locator('[data-sub-renew]')).toHaveCount(0);
  });

  test('(блок 2, пункт 5) загрузку не приняли — «Память организации заполнена»: «К файлам», у владельца «Купить память» открывает окно «Купить память»', async ({
    page,
    baseURL,
  }) => {
    const origin = new URL(baseURL!).origin;
    await newOrgOwner(page.request, origin);
    await filesOn(page.request, origin);
    const texts = await dictionary(page.request);
    // Память занята: начало загрузки отвечает 409 `mem_full`, как сервер у заполненной памяти.
    await page.route('**/api/files/uploads', (route) =>
      route.request().method() === 'POST'
        ? route.fulfill({
            status: 409,
            json: {
              error: {
                code: 'mem_full',
                message: 'Память организации заполнена',
                details: { used: '4', limit: '4' },
              },
            },
          })
        : route.continue(),
    );

    await page.goto('/app/files');
    const grid = page.locator('[data-grid]');
    await grid.getByRole('button', { name: 'Добавить', exact: true }).click();
    const upload = page.getByRole('dialog', { name: 'Загрузить файл' });
    await upload
      .locator('[data-files-upload-input]')
      .setInputFiles({ name: 'акт.pdf', mimeType: 'application/pdf', buffer: PDF });
    await upload.getByRole('button', { name: 'Загрузить', exact: true }).click();

    const full = page.getByRole('dialog', { name: texts['sub.mem.title'] });
    const body = full.locator('[data-mem-full]');
    await expect(body).toContainText(
      texts['err.mem_full']!.replace('{used}', '4').replace('{limit}', '4'),
    );
    await expect(body).toContainText(texts['sub.mem.view']!);
    await expect(full.locator('[data-mem-full-files]')).toBeVisible();
    await full.locator('[data-mem-full-buy]').click();
    await expect(page).toHaveURL(/\/app\/org\/sub/);
    await expect(
      page
        .getByRole('dialog', { name: texts['sub.pay.title.mem'] })
        .locator('[data-sub-pay="mem"]'),
    ).toBeVisible();
  });
});
