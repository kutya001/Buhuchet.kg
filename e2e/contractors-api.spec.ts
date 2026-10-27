import { expect, test, type APIRequestContext } from '@playwright/test';
import { DEMO_PASSWORD, signIn } from './helpers';

// Контрагенты: данные, правила и API (задача 2.05, #61). Экранов у задачи нет (форма — задача 2.09),
// поэтому её проверки идут через API сайта под владельцем демо-организации.

/** Правильный ИНН, которого нет в демо-организации: 14 цифр, первая — 0. */
const freshInn = () => `09${Date.now().toString().slice(-12)}`;

async function asOwner(api: APIRequestContext, baseURL: string | undefined) {
  const origin = new URL(baseURL!).origin;
  await signIn(api, origin, 'erkin', DEMO_PASSWORD);
  return origin;
}

/** Активный сотрудник демо-организации — ответственный нового контрагента. */
async function someEmployee(api: APIRequestContext): Promise<string> {
  const res = await api.get('/api/staff?size=all');
  expect(res.status()).toBe(200);
  const list = (await res.json()) as { items: { id: string; active: boolean }[] };
  return list.items.find((e) => e.active)!.id;
}

test.describe('Этап 2: контрагенты — данные, правила и API', () => {
  test('(проверка задачи #61) дубль ИНН архивного контрагента называет найденного и предлагает вернуть из архива', async ({
    request,
    baseURL,
  }) => {
    const origin = await asOwner(request, baseURL);
    const filters = encodeURIComponent('{"service":{"type":"enum","vals":["archived"]}}');
    const archived = (await (
      await request.get(`/api/contractors?size=all&filters=${filters}`)
    ).json()) as { items: { name: string; inn: string; serviceStatus: string }[] };
    const found = archived.items[0]!;
    expect(found.serviceStatus).toBe('archived');

    const res = await request.post('/api/contractors', {
      headers: { origin },
      data: {
        name: 'Повтор архивного',
        inn: found.inn,
        phone: '+996505890076',
        kind: 'oneoff',
        formCode: 'ФС-01',
        regimeCode: 'РЕЖ-01',
        gked: '46.34.0',
        startDate: '2026-10-01',
        responsibleEmployeeId: await someEmployee(request),
      },
    });
    expect(res.status()).toBe(409);
    const { error } = (await res.json()) as {
      error: { code: string; message: string; details: { name: string; archived: boolean } };
    };
    expect(error.code).toBe('inn_duplicate');
    expect(error.details).toMatchObject({ name: found.name, archived: true });
    expect(error.message).toBe(
      `Такой ИНН уже есть: ${found.name} (в архиве — верните его из архива, а не создавайте заново)`,
    );
  });

  test('(проверка задачи #61) неудачное сохранение не создаёт ничего', async ({
    request,
    baseURL,
  }) => {
    const origin = await asOwner(request, baseURL);
    const inn = freshInn();
    const res = await request.post('/api/contractors', {
      headers: { origin },
      data: {
        name: 'Не сохранится',
        inn,
        phone: '+996505890076',
        kind: 'regular',
        formCode: 'ФС-01',
        regimeCode: 'РЕЖ-01',
        gked: '46.34.0',
        benefits: [{ code: 'нет-такой-льготы', validFrom: null, validTo: null }],
        startDate: '2026-10-01',
        responsibleEmployeeId: await someEmployee(request),
        tariff: { amount: 1_000_000, period: 'M' },
      },
    });
    expect(res.status()).toBe(400);
    const list = (await (await request.get(`/api/contractors?size=all&q=${inn}`)).json()) as {
      total: number;
    };
    expect(list.total).toBe(0);
  });

  test('(проверка задачи #61) сверка с ГКЭД отвечает как прототип: ставка ЕН, вопрос о праве на режим, запрет режима', async ({
    request,
    baseURL,
  }) => {
    const origin = await asOwner(request, baseURL);
    const check = async (gked: string, formCode = 'ФС-01', regimeCode = 'РЕЖ-03') => {
      const res = await request.post('/api/contractors/gked-check', {
        headers: { origin },
        data: { gked, formCode, regimeCode, regime2Code: null },
      });
      expect(res.status()).toBe(200);
      return (await res.json()) as {
        block: string[];
        regime: string[];
        rate: string[];
        confirmNeeded: boolean;
        ask: string;
      };
    };
    // п. 17 приёмки «Контрагенты»: подсказка ставки единого налога по основному ГКЭД.
    expect((await check('47.11.0')).rate).toEqual([
      'Ставка единого налога по основному ГКЭД 47.11.0: 0,5 % (Торговля, выручка за 12 месяцев до 50 млн сом) или 2 % безнал + 4 % нал (Торговля, остальные)',
    ]);
    // п. 56: код не отличает запрещённую деятельность — вопрос с подтверждением.
    expect(await check('61.10.0')).toMatchObject({
      confirmNeeded: true,
      ask: 'Оказывает услуги интернета?',
      regime: [
        'Режим «Единый налог» при основном ГКЭД 61.10.0 (интернет-связь): код не отличает запрещённую деятельность от разрешённой (ст. 419) — нужно подтверждение',
      ],
    });
    // Банку единый налог запрещён (ст. 419 ч. 2 п. 2).
    expect((await check('64.19.1')).block[0]).toContain('ст. 419');
  });
});
