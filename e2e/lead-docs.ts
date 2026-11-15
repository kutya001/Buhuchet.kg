import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, type APIRequestContext } from '@playwright/test';

// Документы формы «Оставить заявку» (доработки 14.11.2026, блок 1; прототип v114 modules/lead-docs.js)
// для сквозных тестов: свидетельство ГНС вымышленного ИП — синтетический PDF с текстовым слоем (тот же,
// что у «Из свидетельства и выписки» контрагента, e2e/contractor-regdocs.spec.ts).

/** Путь к PDF в `e2e/fixtures`. */
export const leadFixture = (name: string) =>
  fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

/** Свидетельство ГНС ИП: из него подставляются ФИО предпринимателя, ИНН и адрес. */
export const IP_CERT = leadFixture('regdocs-ipsv.pdf');

/** Что разбор находит в свидетельстве ИП. */
export const IP_CERT_INN = '21503199000123';

/**
 * Черновик документов формы через методы лендинга (как выбор файла в форме): начать загрузку, положить
 * PDF по подписанной ссылке, прочитать. `from` — адрес гостя (X-Forwarded-For): пределы загрузок — по
 * адресу. Возвращает номер черновика для `POST /api/leads`.
 */
export async function leadDocsDraft(
  api: APIRequestContext,
  origin: string,
  from: string,
): Promise<string> {
  const data = readFileSync(IP_CERT);
  const headers = { origin, 'x-forwarded-for': from };
  const start = await api.post('/api/leads/uploads', {
    headers,
    data: { draft: null, kind: 'gns_cert', name: 'Свидетельство ГНС.pdf', size: data.length },
  });
  expect(start.status(), await start.text()).toBe(201);
  const ticket = (await start.json()) as {
    id: string;
    draft: string;
    upload: { url: string; headers: Record<string, string> };
  };
  const put = await api.put(ticket.upload.url, { headers: ticket.upload.headers, data });
  expect(put.ok(), await put.text()).toBe(true);
  const read = await api.post(`/api/leads/uploads/${ticket.id}/read`, {
    headers,
    data: { draft: ticket.draft },
  });
  expect(read.status(), await read.text()).toBe(200);
  expect(((await read.json()) as { found: string }).found).toBe('found');
  return ticket.draft;
}

/**
 * Поля заявки с документами (ИП): форма, ИНН, ОКПО, адрес, руководитель и черновик. ИНН — свой на каждую
 * заявку: «Одобрить» не создаст вторую организацию с тем же ИНН.
 */
export function leadDocsFields(draft: string, inn: string) {
  return {
    form: 'ip',
    inn,
    okpo: '',
    address: 'г. Бишкек, ул. Сквозная, 1',
    head: '',
    draft,
  };
}
