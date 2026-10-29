import { expect, type APIRequestContext } from '@playwright/test';
import { DEMO_PASSWORD, signIn } from './helpers';

// Общее для сквозных тестов отчётов (задача 2.06): владелец демо-организации, новый контрагент,
// назначение и отчёты контрагента через API сайта.

/** Правильный ИНН, которого нет в демо-организации: 14 цифр, первая — 0; свой у ПК и телефона. */
const freshInn = () =>
  `08${Date.now().toString().slice(-8)}${String(Math.floor(Math.random() * 10_000)).padStart(4, '0')}`;

export type Row = {
  type: { code: string };
  periodStart: string;
  dueBase: string;
  dueDate: string;
  payDue: string | null;
};

export async function asOwner(api: APIRequestContext, baseURL: string | undefined) {
  const origin = new URL(baseURL!).origin;
  await signIn(api, origin, 'erkin', DEMO_PASSWORD);
  return origin;
}

export type NewContractor = {
  id: string;
  inn: string;
  version: number;
  benefits: { code: string; byOffice: boolean }[];
  notices: string[];
};

/** Новый контрагент демо-организации; `benefits` — коды льгот и статусов, `taxOfficeCode` — УГНС. */
export async function newContractor(
  api: APIRequestContext,
  origin: string,
  options: { benefits?: string[]; taxOfficeCode?: string } = {},
): Promise<NewContractor> {
  const staff = (await (await api.get('/api/staff?size=all')).json()) as {
    items: { id: string; active: boolean }[];
  };
  const inn = freshInn();
  const res = await api.post('/api/contractors', {
    headers: { origin },
    data: {
      name: `Сроки отчётов ${inn}`,
      inn,
      phone: '+996505890076',
      kind: 'regular',
      formCode: 'ФС-01',
      regimeCode: 'РЕЖ-01',
      gked: '46.34.0',
      taxOfficeCode: options.taxOfficeCode ?? null,
      benefits: (options.benefits ?? []).map((code) => ({ code, validFrom: null, validTo: null })),
      startDate: '2026-01-01',
      responsibleEmployeeId: staff.items.find((e) => e.active)!.id,
      tariff: { amount: 1_000_000, period: 'M' },
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  return { ...((await res.json()) as Omit<NewContractor, 'inn'>), inn };
}

/** «Изменить» контрагента; ответ — карточка с уведомлениями. */
export async function editContractor(
  api: APIRequestContext,
  origin: string,
  cp: Pick<NewContractor, 'id' | 'version'>,
  data: Record<string, unknown>,
): Promise<Omit<NewContractor, 'inn'>> {
  const res = await api.patch(`/api/contractors/${cp.id}`, {
    headers: { origin },
    data: { version: cp.version, ...data },
  });
  expect(res.status(), await res.text()).toBe(200);
  return (await res.json()) as Omit<NewContractor, 'inn'>;
}

export async function assign(
  api: APIRequestContext,
  origin: string,
  data: Record<string, unknown>,
) {
  const res = await api.post('/api/assignments', {
    headers: { origin },
    data: { markPast: false, ...data },
  });
  expect(res.status(), await res.text()).toBe(201);
}

/** Отчёты контрагента по ИНН (фильтр столбца «ИНН» списка). */
export async function reportsOf(api: APIRequestContext, inn: string): Promise<Row[]> {
  const filters = encodeURIComponent(JSON.stringify({ inn: { type: 'text', q: inn } }));
  const res = await api.get(`/api/reports?size=all&filters=${filters}`);
  expect(res.status()).toBe(200);
  return ((await res.json()) as { items: Row[] }).items;
}

export const find = (rows: Row[], code: string, periodStart: string) =>
  rows.find((r) => r.type.code === code && r.periodStart === periodStart);
