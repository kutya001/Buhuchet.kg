import { describe, expect, it } from 'vitest';
import {
  isPageAddress,
  isPageCode,
  orgLogoLetters,
  pageCodeText,
  pageDevice,
  pageIpSubject,
  pageLink,
  pageLinkText,
  pageManageRefusal,
  pageOrgSections,
  pageSendRefusal,
  pageVisibleSections,
  pageWhatsAppText,
  whatsAppLink,
} from './page';

const all = { taxpay: true, fee: true, indicators: true };

describe('страница контрагента по ссылке', () => {
  it('код — ровно 6 цифр, показывается группами по три (прототип pgCodeTxt)', () => {
    expect(isPageCode('048291')).toBe(true);
    expect(isPageCode('48291')).toBe(false);
    expect(isPageCode('4829150')).toBe(false);
    expect(isPageCode('48291a')).toBe(false);
    expect(isPageCode(' 482915')).toBe(false);
    expect(pageCodeText('482915')).toBe('482 915');
    expect(pageCodeText('')).toBe('');
  });

  it('ссылка: адрес сайта, адрес организации и ИНН; в блоке — без https:// (прототип pgUrl)', () => {
    const link = pageLink('https://buhuchet.kg/', 'ahti', '02508200101181');
    expect(link).toBe('https://buhuchet.kg/ahti/inn/02508200101181');
    expect(pageLinkText(link)).toBe('buhuchet.kg/ahti/inn/02508200101181');
    expect(pageLink('http://localhost:3000', 'a', '1')).toBe('http://localhost:3000/a/inn/1');
  });

  it('устройство открытия — как в прототипе pgDev', () => {
    const iphone =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
    const chrome =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
    const edge = `${chrome} Edg/130.0`;
    const yandex = `${chrome} YaBrowser/24.1`;
    const android =
      'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';
    expect(pageDevice(iphone)).toBe('Телефон · Safari');
    expect(pageDevice(chrome)).toBe('ПК · Chrome');
    expect(pageDevice(edge)).toBe('ПК · Edge');
    expect(pageDevice(yandex)).toBe('ПК · Яндекс Браузер');
    expect(pageDevice(android)).toBe('Телефон · Chrome');
    expect(pageDevice('Mozilla/5.0 Firefox/131.0')).toBe('ПК · Firefox');
    expect(pageDevice('Opera/9.80 OPR/100')).toBe('ПК · Opera');
    expect(pageDevice('')).toBe('ПК · браузер');
  });

  it('адрес страницы: адрес организации из латиницы, цифр и дефиса и ИНН из 14 цифр', () => {
    expect(isPageAddress('buhgalter-plyus', '03807819461915')).toBe(true);
    expect(isPageAddress('BUH', '03807819461915')).toBe(false);
    expect(isPageAddress('..%2F', '03807819461915')).toBe(false);
    expect(isPageAddress('ab', '03807819461915')).toBe(false);
    expect(isPageAddress('buh', '0380781946191')).toBe(false);
    expect(isPageAddress('buh', '038078194619150')).toBe(false);
  });

  it('счёт по адресу: IPv4 как есть, IPv6 — по сети /64', () => {
    expect(pageIpSubject(' 203.0.113.7 ')).toBe('203.0.113.7');
    expect(pageIpSubject('::ffff:203.0.113.7')).toBe('203.0.113.7');
    expect(pageIpSubject('2001:db8:1:2:3:4:5:6')).toBe('2001:db8:1:2::/64');
    expect(pageIpSubject('2001:DB8:0001:0002::ffff')).toBe('2001:db8:1:2::/64');
    expect(pageIpSubject('2001:db8::1')).toBe('2001:db8:0:0::/64');
    expect(pageIpSubject('fe80::1%eth0')).toBe('fe80:0:0:0::/64');
  });

  it('без логотипа — инициалы названия организации без формы собственности (прототип pub-logo)', () => {
    expect(orgLogoLetters('ОсОО «Бухгалтер Плюс»')).toBe('БП');
    expect(orgLogoLetters('ИП Садыков')).toBe('С');
    expect(orgLogoLetters('Ахты консалтинг')).toBe('АК');
  });

  it('разделы: отмеченные в учётной политике, с включённой функцией, без скрытых у контрагента', () => {
    const sections = ['pay', 'reports', 'money', 'fee', 'kpi', 'contacts'] as const;
    expect(pageOrgSections(sections, all)).toEqual(sections);
    // «Деньги на налоги» — только с учётом оплаты налогов, «Показатели» — с показателями.
    expect(pageOrgSections(sections, { fee: true })).toEqual(['pay', 'reports', 'fee', 'contacts']);
    expect(pageOrgSections(['contacts', 'pay'], all)).toEqual(['pay', 'contacts']);
    expect(pageVisibleSections(sections, all, ['fee', 'kpi'])).toEqual([
      'pay',
      'reports',
      'money',
      'contacts',
    ]);
  });

  it('управлять — по праву, не у архивного; отправить — и ответственному, только включённую', () => {
    const manager = { canManage: true, isResponsible: false };
    const responsible = { canManage: false, isResponsible: true };
    const other = { canManage: false, isResponsible: false };
    expect(pageManageRefusal(manager, false)).toBeNull();
    expect(pageManageRefusal(responsible, false)).toBe('page_manage_right');
    expect(pageManageRefusal(manager, true)).toBe('page_archived');
    expect(pageSendRefusal(manager, true)).toBeNull();
    expect(pageSendRefusal(responsible, true)).toBeNull();
    expect(pageSendRefusal(other, true)).toBe('page_send_right');
    expect(pageSendRefusal(manager, false)).toBe('page_off');
  });

  it('сообщение WhatsApp по шаблону waPage и ссылка wa.me на цифры номера', () => {
    const template =
      'Уважаемые {контрагент}! Ваши отчёты можно посмотреть на странице {ссылка} — код доступа {код}. Код никому не передавайте.';
    const text = pageWhatsAppText(template, {
      contractor: 'ОсОО «Укс»',
      link: 'https://buhuchet.kg/ahti/inn/03807819461915',
      code: '482915',
    });
    expect(text).toBe(
      'Уважаемые ОсОО «Укс»! Ваши отчёты можно посмотреть на странице https://buhuchet.kg/ahti/inn/03807819461915 — код доступа 482915. Код никому не передавайте.',
    );
    expect(whatsAppLink('+996 555 123 456', 'Код 1')).toBe(
      'https://wa.me/996555123456?text=%D0%9A%D0%BE%D0%B4%201',
    );
    expect(whatsAppLink('+996555123456', '')).toBe('https://wa.me/996555123456');
  });
});
