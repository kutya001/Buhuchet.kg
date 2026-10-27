import { expect, test, type APIRequestContext } from '@playwright/test';
import { asOwner } from './reports';

// Тариф Соцфонда (задача 2.08, #64). Экранов у задачи нет (форма — 2.09, список — 2.10, карточка —
// 2.11, подбор отчётов — 2.07), поэтому пункты 38 и 39 проверяются через API сайта под владельцем
// демо-организации.

const ALL_YES = { cashless: true, registry: true, confirmed: true, gov: false };
const NO_FLAGS = { cashless: null, registry: null, confirmed: null, gov: null };

/** Правильный ИНН, которого нет в демо-организации; свой у ПК и телефона. */
const freshInn = () =>
  `07${Date.now().toString().slice(-8)}${String(Math.floor(Math.random() * 10_000)).padStart(4, '0')}`;

type Socfund = {
  needed: boolean;
  tariff: { id: string; short: string; manual: boolean; reason: string | null } | null;
  auto: { id: string | null; why: string[] } | null;
  bad: boolean;
  badWhy: string;
  ask: boolean;
};
type Saved = { id: string; version: number; benefits: { code: string }[]; socfund: Socfund };

async function newContractor(
  api: APIRequestContext,
  origin: string,
  data: Record<string, unknown>,
): Promise<Saved> {
  const staff = (await (await api.get('/api/staff?size=all')).json()) as {
    items: { id: string; active: boolean }[];
  };
  const inn = freshInn();
  const res = await api.post('/api/contractors', {
    headers: { origin },
    data: {
      name: `Тариф Соцфонда ${inn}`,
      inn,
      phone: '+996505890076',
      kind: 'regular',
      formCode: 'ФС-01',
      regimeCode: 'РЕЖ-01',
      bases: ['employees'],
      startDate: '2026-01-01',
      responsibleEmployeeId: staff.items.find((e) => e.active)!.id,
      tariff: { amount: 1_000_000, period: 'M' },
      ...data,
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()) as Saved;
}

const codes = (cp: Saved) => cp.benefits.map((b) => b.code).sort();

test.describe('Этап 2: тариф Соцфонда', () => {
  test('(проверка задачи #64) п. 38: ОсОО с ГКЭД 47.11 и всеми признаками получает СПиНО автоматически, после смены ГКЭД на 64.19.1 — «больше не применим» и «Сменить на базовый»', async ({
    request,
    baseURL,
  }) => {
    const origin = await asOwner(request, baseURL);
    const cp = await newContractor(request, origin, {
      gked: '47.11.0',
      socfund: { flags: ALL_YES },
    });
    expect(cp.socfund).toMatchObject({
      needed: true,
      tariff: { id: 'spino', short: 'СПиНО', manual: false },
      auto: { id: 'spino', why: ['Все условия выполнены'] },
      bad: false,
    });
    expect(codes(cp)).toEqual(['ЛЬГ-29']);

    const moved = await request.patch(`/api/contractors/${cp.id}`, {
      headers: { origin },
      data: { version: cp.version, gked: '64.19.1' },
    });
    expect(moved.status(), await moved.text()).toBe(200);
    const stale = (await moved.json()) as Saved;
    expect(stale.socfund).toMatchObject({
      tariff: { id: 'spino' },
      auto: { id: 'general' },
      bad: true,
    });
    expect(stale.socfund.badWhy).toMatch(/^Основной ГКЭД 64\.19\.1 не допускает СПиНО/);

    // «Сменить на базовый».
    const res = await request.put(`/api/contractors/${cp.id}/socfund`, {
      headers: { origin },
      data: { version: stale.version, flags: ALL_YES, tariff: 'general' },
    });
    expect(res.status(), await res.text()).toBe(200);
    const general = (await res.json()) as Saved;
    expect(general.socfund).toMatchObject({
      tariff: { id: 'general', short: 'Базовый тариф', manual: false },
      bad: false,
    });
    expect(codes(general)).toEqual([]);
  });

  test('(проверка задачи #64) п. 39: резидент ПКИ получает «Тариф ПВТ / ПКИ», ручной «СПиНО» сохраняется только после подтверждения, в списке — «Тариф под вопросом»', async ({
    request,
    baseURL,
  }) => {
    const origin = await asOwner(request, baseURL);
    const cp = await newContractor(request, origin, {
      gked: '62.01.0',
      benefits: [{ code: 'ЛЬГ-01', validFrom: null, validTo: null }],
      socfund: { flags: NO_FLAGS },
    });
    expect(cp.socfund).toMatchObject({
      tariff: { id: 'pvtpki', short: 'Тариф ПВТ / ПКИ', manual: false },
      ask: false,
    });

    const manual = { version: cp.version, flags: NO_FLAGS, tariff: 'spino', reason: 'письмо ГНС' };
    const refused = await request.put(`/api/contractors/${cp.id}/socfund`, {
      headers: { origin },
      data: manual,
    });
    expect(refused.status()).toBe(400);
    const { error } = (await refused.json()) as {
      error: { code: string; details: { text: string } };
    };
    expect(error.code).toBe('socfund_confirm_required');
    expect(error.details.text).toBe(
      '«СПиНО» расходится с условиями: Статус «Резидент ПКИ». Сохранить ручной выбор? В истории контрагента запишется, кто и почему его поставил.',
    );

    const saved = await request.put(`/api/contractors/${cp.id}/socfund`, {
      headers: { origin },
      data: { ...manual, confirm: true },
    });
    expect(saved.status(), await saved.text()).toBe(200);
    expect(((await saved.json()) as Saved).socfund).toMatchObject({
      tariff: { id: 'spino', manual: true, reason: 'письмо ГНС' },
      bad: true,
      ask: true,
    });

    const filters = encodeURIComponent('{"socfundAsk":{"type":"enum","vals":["yes"]}}');
    const asked = (await (
      await request.get(`/api/contractors?size=all&filters=${filters}`)
    ).json()) as { items: { id: string; name: string; socfund: { ask: boolean } | null }[] };
    expect(asked.items.map((r) => r.id)).toContain(cp.id);
    // У демо-организации под вопросом те же, что в прототипе.
    expect(asked.items.map((r) => r.name)).toEqual(
      expect.arrayContaining(['ОсОО «Каракол Мед Сервис»', 'ОсОО «Нарын Жүн»', 'ОсОО «Укс»']),
    );
    expect(asked.items.every((r) => r.socfund?.ask)).toBe(true);
  });
});
