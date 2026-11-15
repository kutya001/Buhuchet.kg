import { LEAD_DOC_MAX_BYTES } from '@buhuchet/domain';
import { describe, expect, it } from 'vitest';
import {
  docMissingKey,
  foundNote,
  leadDocErrorKey,
  leadDocProblem,
  valuesAfterFormSwitch,
  valuesAfterRead,
} from './lead-docs';

// Документы формы «Оставить заявку» (доработки 14.11.2026, блок 1; прототип v114 modules/lead-docs.js:
// ldDocErr, ldDocsBind, ldParse, ldMarkSync, ldFoundSync).

const empty = { name: '', firm: '', inn: '', okpo: '', head: '', address: '' };
const pdf = (name: string, body: BlobPart, type = 'application/pdf') =>
  new File([body], name, { type });

describe('документ формы: «Только PDF» и «Файл больше 20 МБ» до загрузки', () => {
  it('PDF — по началу файла «%PDF-», а не по имени', async () => {
    expect(await leadDocProblem(pdf('Свидетельство.pdf', '%PDF-1.7 ...'))).toBeNull();
    expect(await leadDocProblem(pdf('scan.pdf', 'MZ это не PDF'))).toBe('land.e.pdf');
    expect(await leadDocProblem(pdf('photo.jpg', '%PDF-1.7', 'image/jpeg'))).toBe('land.e.pdf');
    expect(await leadDocProblem(pdf('a.pdf', '%PD'))).toBe('land.e.pdf');
    // Имя без «.pdf», но тип PDF и начало PDF — годится.
    expect(await leadDocProblem(pdf('vypiska', '%PDF-1.4'))).toBeNull();
  });

  it('больше 20 МБ — «Файл больше 20 МБ», ровно 20 МБ — можно', async () => {
    const big = new Uint8Array(LEAD_DOC_MAX_BYTES + 1);
    big.set(new TextEncoder().encode('%PDF-'));
    expect(await leadDocProblem(pdf('big.pdf', big))).toBe('land.e.big');
    expect(await leadDocProblem(pdf('max.pdf', big.slice(0, LEAD_DOC_MAX_BYTES)))).toBeNull();
  });

  it('отказ сервера: «Только PDF» и «Файл больше 20 МБ» — текстом словаря, остальное — по коду', () => {
    expect(leadDocErrorKey({ code: 'lead_doc_pdf', message: '' })).toBe('land.e.pdf');
    expect(leadDocErrorKey({ code: 'lead_doc_big', message: '' })).toBe('land.e.big');
    expect(leadDocErrorKey({ code: 'lead_upload_limit', message: '' })).toBeNull();
  });

  it('«Приложите …» по виду документа', () => {
    expect(docMissingKey('gns_cert')).toBe('land.e.doc.gns');
    expect(docMissingKey('extract')).toBe('land.e.doc.vyp');
    expect(docMissingKey('minjust_cert')).toBe('land.e.doc.mj');
  });
});

describe('документы формы: подстановка из разбора', () => {
  it('найденное — в пустые поля; поправленное заявителем новый разбор не перезаписывает', () => {
    const first = valuesAfterRead(
      { ...empty, firm: 'ИП Асанов' },
      {},
      {
        firm: 'ИП Токтогулов',
        inn: '21503199010001',
        address: 'г. Бишкек',
      },
    );
    // Фирму заявитель уже ввёл сам — она остаётся.
    expect(first.values).toMatchObject({
      firm: 'ИП Асанов',
      inn: '21503199010001',
      address: 'г. Бишкек',
    });
    expect(first.auto).toEqual({ inn: '21503199010001', address: 'г. Бишкек' });
    // Заявитель поправил адрес; второй разбор меняет только подставленное прежним (ИНН).
    const edited = { ...first.values, address: 'г. Бишкек, ул. Киевская, 15' };
    const second = valuesAfterRead(edited, first.auto, {
      inn: '21503199010002',
      address: 'г. Ош',
      head: 'Токтогулов А.',
    });
    expect(second.values).toMatchObject({
      inn: '21503199010002',
      address: 'г. Бишкек, ул. Киевская, 15',
      head: 'Токтогулов А.',
    });
    expect(second.auto).toEqual({
      inn: '21503199010002',
      address: 'г. Бишкек',
      head: 'Токтогулов А.',
    });
  });

  it('смена «ОсОО ↔ ИП»: подставленное очищается, поправленное заявителем остаётся', () => {
    const values = {
      ...empty,
      name: 'Азамат',
      firm: 'ОсОО «Альфа»',
      inn: '01811201810457',
      address: 'г. Бишкек, ул. Киевская, 15',
    };
    const auto = { firm: 'ОсОО «Альфа»', inn: '01811201810457', address: 'г. Бишкек' };
    expect(valuesAfterFormSwitch(values, auto)).toEqual({
      ...values,
      firm: '',
      inn: '',
      // Адрес поправлен — не трогается; имя не из документов.
      address: 'г. Бишкек, ул. Киевская, 15',
    });
  });
});

describe('строка под документами', () => {
  it('«Читаем документы…», «нашли», «ничего не нашли», «разные организации»', () => {
    expect(foundNote(true, 'found')).toMatchObject({ key: 'land.f.docs.reading', tone: 'info' });
    expect(foundNote(false, '')).toBeNull();
    expect(foundNote(false, 'found')).toEqual({
      key: 'land.f.docs.found',
      tone: 'info',
      icon: 'check',
    });
    expect(foundNote(false, 'none')).toEqual({
      key: 'land.f.docs.none',
      tone: 'warn',
      icon: 'alert',
    });
    expect(foundNote(false, 'diff')).toMatchObject({ key: 'land.f.docs.diff', tone: 'warn' });
  });
});
