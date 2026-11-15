import { describe, expect, it } from 'vitest';
import {
  LEAD_DOCS_BY_FORM,
  leadApproveRefusal,
  leadDocsMissing,
  leadDocValues,
  leadOwnerLogin,
  type LeadApproveState,
} from './lead-docs';

describe('leadDocValues — что нашёл разбор документов формы (прототип ldParse)', () => {
  it('берёт название, ИНН, ОКПО, руководителя и адрес из итога разбора', () => {
    const out = {
      err: null,
      res: {
        v: {
          name: 'ОсОО «Тест»',
          inn: '02711202310045',
          okpo: 31415926,
          head: ' Касымов Н. Б. ',
          addr: 'г. Бишкек',
          regNo: '1',
        },
      },
    };
    expect(leadDocValues(out)).toEqual({
      found: 'found',
      values: {
        firm: 'ОсОО «Тест»',
        inn: '02711202310045',
        okpo: '31415926',
        head: 'Касымов Н. Б.',
        address: 'г. Бишкек',
      },
    });
  });

  it('документы разных организаций — «diff» без данных', () => {
    expect(leadDocValues({ err: 'diff' })).toEqual({
      found: 'diff',
      values: { firm: '', inn: '', okpo: '', head: '', address: '' },
    });
  });

  it('ничего не распознано, ошибка итога или пустые поля — «none»', () => {
    expect(leadDocValues(null).found).toBe('none');
    expect(leadDocValues({ err: 'none' }).found).toBe('none');
    expect(leadDocValues({ err: 'mix' }).found).toBe('none');
    expect(leadDocValues({ err: null, res: { v: { regNo: '5' } } }).found).toBe('none');
  });
});

describe('leadDocsMissing — обязательные документы формы', () => {
  it('ИП — свидетельство ГНС, ОсОО — выписка и свидетельство Минюста', () => {
    expect(LEAD_DOCS_BY_FORM.ip).toEqual(['gns_cert']);
    expect(leadDocsMissing('ip', [])).toEqual(['gns_cert']);
    expect(leadDocsMissing('ip', ['gns_cert'])).toEqual([]);
    expect(leadDocsMissing('osoo', ['minjust_cert'])).toEqual(['extract']);
    expect(leadDocsMissing('osoo', ['gns_cert'])).toEqual(['extract', 'minjust_cert']);
    expect(leadDocsMissing('osoo', ['extract', 'minjust_cert'])).toEqual([]);
  });
});

describe('leadApproveRefusal — почему «Одобрить» неактивна (прототип ldApproveWhy)', () => {
  const ok: LeadApproveState = {
    hasOrg: false,
    status: 'new',
    tgLinked: true,
    docsState: 'ready',
    inn: '02711202310045',
    innTaken: false,
  };

  it('всё в порядке — можно', () => {
    expect(leadApproveRefusal(ok)).toBeNull();
    expect(leadApproveRefusal({ ...ok, status: 'in_progress' })).toBeNull();
  });

  it('причины по порядку прототипа', () => {
    expect(leadApproveRefusal({ ...ok, hasOrg: true, status: 'rejected' })).toBe('lead_org_exists');
    expect(leadApproveRefusal({ ...ok, status: 'rejected', tgLinked: false })).toBe(
      'lead_rejected',
    );
    expect(leadApproveRefusal({ ...ok, tgLinked: false, docsState: null })).toBe(
      'lead_no_telegram',
    );
    expect(leadApproveRefusal({ ...ok, docsState: null, innTaken: true })).toBe('lead_docs_gone');
    expect(leadApproveRefusal({ ...ok, docsState: 'pending' })).toBe('lead_docs_pending');
    expect(leadApproveRefusal({ ...ok, inn: '123' })).toBe('lead_inn_invalid');
    expect(leadApproveRefusal({ ...ok, inn: null })).toBe('lead_inn_invalid');
    expect(leadApproveRefusal({ ...ok, innTaken: true })).toBe('lead_inn_taken');
  });
});

describe('leadOwnerLogin — логин владельца в окне «Одобрить» (прототип ldLoginOf)', () => {
  const none = () => false;

  it('латиницей по имени заявителя, дефисы — точками', () => {
    expect(leadOwnerLogin('Нурлан Касымов', 'ОсОО «Тоо-Сервис»', none)).toBe('nurlan.kasymov');
  });

  it('без имени — по фирме, без обоих — owner', () => {
    expect(leadOwnerLogin('', 'ОсОО «Тоо-Сервис Учёт»', none)).toBe('too.servis.uchet');
    expect(leadOwnerLogin('', '', none)).toBe('owner');
    expect(leadOwnerLogin('!!!', '', none)).toBe('owner');
  });

  it('занятый логин — с номером', () => {
    const taken = new Set(['nurlan.kasymov', 'nurlan.kasymov2']);
    expect(leadOwnerLogin('Нурлан Касымов', '', (l) => taken.has(l))).toBe('nurlan.kasymov3');
  });

  it('не длиннее 24 знаков основы', () => {
    const login = leadOwnerLogin('Абдыкадырова Айпери Нурбековна-Токтогулова', '', none);
    expect(login.length).toBeLessThanOrEqual(24);
    expect(login).not.toMatch(/\.$/);
  });
});
