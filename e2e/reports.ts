import { expect, type APIRequestContext } from '@playwright/test';
import { DEMO_PASSWORD, defaultResponsible, signIn } from './helpers';

// Общее для сквозных тестов отчётов (задача 2.06): владелец демо-организации, новый контрагент,
// назначение и отчёты контрагента через API сайта.

/** Правильный ИНН, которого нет в демо-организации: 14 цифр, первая — 0; свой у ПК и телефона. */
const freshInn = () =>
  `08${Date.now().toString().slice(-8)}${String(Math.floor(Math.random() * 10_000)).padStart(4, '0')}`;

export type Row = {
  id: string;
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

/**
 * Новый контрагент демо-организации; `benefits` — коды льгот и статусов, `taxOfficeCode` — УГНС,
 * `name` — название (по умолчанию «Сроки отчётов <ИНН>»), `responsible` — id ответственного сотрудника
 * (по умолчанию — `defaultResponsible`),
 * `tariff: false` — без стоимости обслуживания (в организации без «Платы за обслуживание»).
 */
export async function newContractor(
  api: APIRequestContext,
  origin: string,
  options: {
    benefits?: string[];
    taxOfficeCode?: string;
    name?: string;
    responsible?: string;
    tariff?: boolean;
  } = {},
): Promise<NewContractor> {
  const inn = freshInn();
  const res = await api.post('/api/contractors', {
    headers: { origin },
    data: {
      name: options.name ?? `Сроки отчётов ${inn}`,
      inn,
      phone: '+996505890076',
      kind: 'regular',
      formCode: 'ФС-01',
      regimeCode: 'РЕЖ-01',
      gked: '46.34.0',
      taxOfficeCode: options.taxOfficeCode ?? null,
      // Без списка льгот статусы УГНС отмечает сервер; со списком (как из формы, задача 2.09) — берёт
      // его как есть.
      ...(options.benefits
        ? { benefits: options.benefits.map((code) => ({ code, validFrom: null, validTo: null })) }
        : {}),
      startDate: '2026-01-01',
      responsibleEmployeeId: options.responsible ?? (await defaultResponsible(api)),
      ...(options.tariff === false ? {} : { tariff: { amount: 1_000_000, period: 'M' } }),
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

/** Id сотрудников демо-организации по логину. */
export async function staffIds(api: APIRequestContext): Promise<Record<string, string>> {
  const res = await api.get('/api/staff?size=all');
  expect(res.status()).toBe(200);
  const { items } = (await res.json()) as { items: { id: string; login: string }[] };
  return Object.fromEntries(items.map((e) => [e.login, e.id]));
}

/** «+ Добавить» → «Разовый отчёт» через API: вид, месяц периода и срок; ответ — id отчёта. */
export async function manualReport(
  api: APIRequestContext,
  origin: string,
  data: { contractorId: string; reportTypeCode: string; month: string; due: string },
): Promise<string> {
  const res = await api.post('/api/reports', {
    headers: { origin },
    data: { ...data, reasonCode: 'ПРЧ-001' },
  });
  expect(res.status(), await res.text()).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

/** Сегодня по Бишкеку: дата оплаты не может быть позже. */
const bishkekToday = () => new Date(Date.now() + 6 * 3600_000).toISOString().slice(0, 10);

/**
 * Сумма к уплате и «Оплатил контрагент сам» на `paid` тыйынов (по умолчанию — на всю сумму) через API
 * (задача 2.19): в демо-организации «Сдача отчёта только после оплаты», без оплаты «Сдан» не ставится.
 */
export async function prepay(
  api: APIRequestContext,
  origin: string,
  id: string,
  amount: number,
  paid = amount,
) {
  const card = async () => {
    const res = await api.get(`/api/reports/${id}`);
    expect(res.status(), await res.text()).toBe(200);
    return (await res.json()) as { version: number; amount: number | null };
  };
  let r = await card();
  if (r.amount !== amount) {
    const set = await api.post(`/api/reports/${id}/amount`, {
      headers: { origin },
      data: { version: r.version, amount },
    });
    expect(set.status(), await set.text()).toBe(200);
    r = await card();
  }
  const res = await api.post(`/api/reports/${id}/payments`, {
    headers: { origin },
    data: { version: r.version, amount: paid, date: bishkekToday(), self: true },
  });
  expect(res.status(), await res.text()).toBe(200);
}
