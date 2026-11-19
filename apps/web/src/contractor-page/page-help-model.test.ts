import { cpLegendRows, defaultUiTexts } from '@buhuchet/domain';
import type { PublicPageBody } from '@buhuchet/shared';
import { describe, expect, it } from 'vitest';
import { makeTranslate } from '../l10n/translate';
import { statusName } from '../status/status-view';
import {
  legendLook,
  pageHelpView,
  tourScrollTop,
  tourTargetSelector,
  tourUnfolds,
  welcomeCookie,
  welcomeSeen,
} from './page-help-model';

// Правила подсказок открытой страницы контрагента (прототип v135 modules/cp-help.js).

const t = makeTranslate(defaultUiTexts());

/** Страница с нужными полями: остальное правилам не нужно. */
const pageOf = (p: Partial<Record<'pay' | 'sent' | 'telegram' | 'money' | 'fee', unknown>>) =>
  ({
    pay: null,
    sent: null,
    telegram: null,
    money: null,
    fee: null,
    ...p,
  }) as unknown as PublicPageBody;

describe('pageHelpView — что видно на странице (прототип cphVis)', () => {
  it('реквизиты «Оплаты» — только когда раздел показан', () => {
    const page = pageOf({ pay: { tax: {}, fee: null } });
    expect(pageHelpView(page, ['main', 'pay'], { paid: true })).toMatchObject({
      payTax: true,
      payFee: false,
      paid: true,
    });
    expect(pageHelpView(page, ['main'], { paid: true })).toMatchObject({
      payTax: false,
      paid: false,
    });
  });

  it('реквизит услуг бухгалтера — только при показанной оплате услуг (строка «Услуги бухгалтера»)', () => {
    const pay = { tax: null, fee: {} };
    expect(pageHelpView(pageOf({ pay }), ['pay'], { paid: true })).toMatchObject({
      payFee: false,
      paid: false,
    });
    expect(pageHelpView(pageOf({ pay, fee: {} }), ['pay'], { paid: true })).toMatchObject({
      payFee: true,
      paid: true,
    });
  });

  it('части «Оплаты» и «Связи» — как свои разделы для вопросов и облачков (v135 cphSec)', () => {
    const page = pageOf({ money: {}, fee: {}, telegram: { on: 0, wait: 0, full: false } });
    const secs = pageHelpView(page, ['pay', 'acc'], { paid: false }).sections;
    expect([...secs].sort()).toEqual(['acc', 'fee', 'money', 'pay', 'tg']);
    // «Оплаты» на странице нет — нет и её строк; Telegram без раздела в ответе — тоже нет.
    expect([
      ...pageHelpView(pageOf({ money: {}, fee: {} }), ['acc'], { paid: false }).sections,
    ]).toEqual(['acc']);
  });

  it('«Отправить файл» — когда бухгалтер принимает файлы и раздел «Файлы» показан', () => {
    const page = pageOf({ sent: { upload: true, items: [] } });
    expect(pageHelpView(page, ['files'], { paid: false }).up).toBe(true);
    expect(pageHelpView(page, ['main'], { paid: false }).up).toBe(false);
    expect(
      pageHelpView(pageOf({ sent: { upload: false, items: [] } }), ['files'], { paid: false }).up,
    ).toBe(false);
  });

  it('код в Telegram — только в подтверждённые чаты; мест нет — tgFull', () => {
    const v = pageHelpView(pageOf({ telegram: { on: 1, wait: 0, full: true } }), ['tg'], {
      paid: false,
    });
    expect(v).toMatchObject({ code: true, tgFull: true });
    expect(
      pageHelpView(pageOf({ telegram: { on: 0, wait: 2, full: false } }), ['tg'], { paid: false }),
    ).toMatchObject({ code: false, tgFull: false });
    expect(pageHelpView(pageOf({}), [], { paid: false })).toMatchObject({
      code: false,
      tgFull: false,
    });
  });
});

describe('облачко обзора: что подсвечивать и куда прокрутить (прототип CPH_EL, cphTourShow)', () => {
  it('«Что нужно сделать», «?» (на телефоне — «Помощь» меню), раздел; у «Оплаты» на телефоне — первая строка', () => {
    expect(tourTargetSelector('state', false)).toBe('[data-pub-state]');
    expect(tourTargetSelector('help', false)).toBe('[data-pub-help]');
    expect(tourTargetSelector('help', true)).toBe('[data-pub-nav="help"]');
    expect(tourTargetSelector('reports', true)).toBe('#pub-reports');
    expect(tourTargetSelector('pay', false)).toBe('#pub-pay');
    expect(tourTargetSelector('pay', true)).toBe('#pub-pay [data-po]');
    expect(tourTargetSelector('end', false)).toBeNull();
  });

  it('на телефоне раскрываются только сворачиваемые разделы: «Оплата» раскрыта всегда', () => {
    expect(tourUnfolds('files')).toBe(true);
    expect(tourUnfolds('pay')).toBe(false);
    expect(tourUnfolds('state')).toBe(false);
    expect(tourUnfolds('help')).toBe(false);
    expect(tourUnfolds('end')).toBe(false);
  });

  it('ПК: элемент посередине экрана; телефон и высокий элемент — верх у верха экрана', () => {
    expect(tourScrollTop({ top: 500, height: 200 }, 100, 800, false)).toBe(100 + 500 - 288);
    expect(tourScrollTop({ top: 500, height: 900 }, 100, 800, false)).toBe(100 + 500 - 12);
    expect(tourScrollTop({ top: 500, height: 100 }, 100, 800, true)).toBe(100 + 500 - 12);
    expect(tourScrollTop({ top: -50, height: 100 }, 0, 800, true)).toBe(0);
  });
});

describe('«Добро пожаловать» — один раз в этом браузере для этой страницы', () => {
  it('отметка читается среди других cookie', () => {
    expect(welcomeSeen('')).toBe(false);
    expect(welcomeSeen('bh_theme=dark; bh_pgwel=1')).toBe(true);
    expect(welcomeSeen('bh_pgwel=0')).toBe(false);
  });

  it('отметка — только под адресом страницы, на год', () => {
    expect(welcomeCookie({ slug: 'demo', inn: '01234567890123' }, true)).toBe(
      'bh_pgwel=1; Path=/demo/inn/01234567890123; Max-Age=31536000; SameSite=Lax; Secure',
    );
    expect(welcomeCookie({ slug: 'demo', inn: '1' }, false)).not.toContain('Secure');
  });
});

describe('«Что значат цвета у отчётов?» — метки прототипа CPH_PILL', () => {
  const names = {
    status: (code: string) => statusName(t, 'report', code),
    ahead: [t('pub.rep.next')],
    late: [t('pub.rep.late'), t('cph.legend.late')],
  };
  const answer = [
    '«Сдан» — бухгалтер отправил отчёт в орган, делать ничего не нужно.',
    '«Впереди» — срок сдачи ещё не наступил.',
    '«Просрочен» — срок прошёл, а отчёт ещё не сдан. Спросите бухгалтера.',
    '«Что-то своё» — другое.',
  ].join('\n');

  it('статус отчёта — его цвет, «Впереди» — синяя, «Просрочен» — красная, своё — серая', () => {
    const looks = cpLegendRows(answer).map((r) => legendLook(r.label, names).tone);
    expect(looks[0]).not.toBe('gray');
    expect(looks.slice(1)).toEqual(['blue', 'red', 'gray']);
  });
});
