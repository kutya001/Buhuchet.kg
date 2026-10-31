import { readFileSync } from 'node:fs';
import { rdExtract, rdToCp } from '@buhuchet/domain';
import { describe, expect, it } from 'vitest';
import { createDocumentReader, createFakeDocumentReader, isPdf } from './documents';

// Чтение PDF «Из свидетельства и выписки» (задача 2.17). Файлы — синтетические документы вымышленной
// организации: свидетельство с текстовым слоем, скан одной страницы (только картинка) и PDF с паролем.
const file = (name: string) =>
  new Uint8Array(readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url)));
const words = (pages: { items: { str: string }[] }[]) =>
  pages.flatMap((p) => p.items.map((i) => i.str));

describe('чтение PDF на сервере', () => {
  const reader = createDocumentReader();

  it('PDF с текстом — текстовый слой с положением на странице и дата создания', async () => {
    const res = await reader.read(file('regdocs-svid.pdf'));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.doc.ocr).toBe(false);
    expect(res.doc.pages).toHaveLength(2);
    expect(res.doc.created).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(words(res.doc.pages)).toContain('02503202010045');
    const item = res.doc.pages[0]!.items[0]!;
    expect(item.y).toBeGreaterThan(700);
    expect(item.h).toBeGreaterThan(0);
    // правила прототипа узнают свидетельство
    const doc = rdExtract(res.doc);
    expect(doc.kind).toBe('svid');
  });

  it('скан без текста — распознавание на русском и кыргызском', async () => {
    const res = await reader.read(file('regdocs-scan.pdf'));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.doc.ocr).toBe(true);
    const all = words(res.doc.pages);
    expect(all).toContain('02503202010045');
    expect(all).toContain('31415926');
    const doc = rdExtract(res.doc);
    expect(doc.kind).toBe('svid');
    const out = rdToCp([doc], { forms: [], offices: [], gked: [] });
    expect(out.err).toBeNull();
    if (!out.err) expect(out.res.v).toMatchObject({ inn: '02503202010045', okpo: '31415926' });
  }, 60_000);

  it('PDF с паролем, не PDF, повреждённый PDF', async () => {
    expect(await reader.read(file('regdocs-locked.pdf'))).toEqual({
      ok: false,
      error: 'password',
    });
    expect(await reader.read(new TextEncoder().encode('hello'))).toEqual({
      ok: false,
      error: 'broken',
    });
    expect(await reader.read(new TextEncoder().encode('%PDF-1.7\nмусор'))).toEqual({
      ok: false,
      error: 'broken',
    });
  });

  it('не уложился во время — «timeout»', async () => {
    const quick = createDocumentReader({ timeoutMs: 1 });
    expect(await quick.read(file('regdocs-scan.pdf'))).toEqual({ ok: false, error: 'timeout' });
  });

  it('скан без распознанного текста — «no_text»', async () => {
    const strict = createDocumentReader({ minChars: 100_000 });
    expect(await strict.read(file('regdocs-scan.pdf'))).toEqual({ ok: false, error: 'no_text' });
  }, 60_000);

  it('PDF узнаётся по «%PDF-» в начале файла', () => {
    expect(isPdf(file('regdocs-svid.pdf'))).toBe(true);
    expect(isPdf(new TextEncoder().encode(' '.repeat(10) + '%PDF-1.4'))).toBe(true);
    expect(isPdf(new TextEncoder().encode('PK\u0003\u0004'))).toBe(false);
  });
});

describe('поддельное чтение для тестов', () => {
  it('ответ по содержимому файла; неизвестный — «broken»', async () => {
    const fake = createFakeDocumentReader({
      a: { ok: true, doc: { pages: [], created: '', ocr: false } },
    });
    expect(await fake.read(new TextEncoder().encode('a'))).toMatchObject({ ok: true });
    expect(await fake.read(new TextEncoder().encode('b'))).toEqual({ ok: false, error: 'broken' });
    expect(fake.calls).toBe(2);
  });
});
