import { describe, expect, it } from 'vitest';
import refDB from '../../../../spec/data/refDB.json';
import { UI_TEXTS } from '../l10n/texts';
import type { KbStepDef } from './catalog';
import { KB_EVENT_STEPS, KB_EVENTS, kbEventWorks, kbStepRule } from './events';
import { KB_STEP_RULES } from './ready';

const steps = refDB.kbSteps as KbStepDef[];

describe('условие отметки шага (прототип KB_EV, KB_MAP)', () => {
  it('у каждого условия есть подпись в словаре, события истории — по шагам прототипа', () => {
    for (const ev of KB_EVENTS) expect(UI_TEXTS, ev).toHaveProperty(`kbadm.ev.${ev}`);
    expect(KB_EVENTS).toHaveLength(41);
    expect(KB_EVENT_STEPS['cp.new']).toBe('cp1');
    expect(KB_EVENT_STEPS['r.sub']).toBe('submit');
  });

  it('без правок администратора правило каждого шага refDB — как в KB_STEP_RULES', () => {
    for (const s of steps) {
      expect(kbStepRule(s), s.id).toEqual(
        Object.hasOwn(KB_STEP_RULES, s.id) ? KB_STEP_RULES[s.id] : undefined,
      );
    }
  });

  it('событие другого шага: его правило и настройка, модуль и право шага остаются', () => {
    const rule = kbStepRule({ id: 'upload', evk: 'r.acc' });
    expect(rule).toEqual({
      module: 'files',
      permission: 'filesUpload',
      done: KB_STEP_RULES.accept!.done,
      policy: 'reportConfirm',
    });
    // Своё сохранение без изменений не переносится на чужое событие.
    expect(kbStepRule({ id: 'profile', evk: 'cp.new' })).toEqual({
      module: 'org',
      done: KB_STEP_RULES.cp1!.done,
    });
  });

  it('«Перейти» и 3 секунды или «только показом» — без события', () => {
    expect(kbStepRule({ id: 'cp1', evk: 'open' })).toEqual({ module: 'cps' });
    expect(kbStepRule({ id: 'profile', evk: 'hand' })).toEqual({ module: 'org' });
  });

  it('событие, которое ещё не работает, и «первое использование» не меняют шаг разработчика', () => {
    expect(kbStepRule({ id: 'cp1', evk: 'in.new' })).toBe(KB_STEP_RULES.cp1);
    expect(kbStepRule({ id: 'remind', evk: 'use' })).toBe(KB_STEP_RULES.remind);
    expect(kbStepRule({ id: 'tg', evk: 'state' })).toBe(KB_STEP_RULES.tg);
  });

  it('шаг администратора: место для «Перейти» — сделанный модуль, условие — работающее', () => {
    expect(kbStepRule({ id: 'u1', evk: 'cp.new', mod: 'cps' })).toEqual({
      module: 'cps',
      done: KB_STEP_RULES.cp1!.done,
    });
    expect(kbStepRule({ id: 'u1', evk: 'open', mod: 'reports' })).toEqual({ module: 'reports' });
    // Модуль ещё не сделан, события нет, условие в данных и первое использование задать нечем.
    expect(kbStepRule({ id: 'u1', evk: 'open', mod: 'fin' })).toBeUndefined();
    expect(kbStepRule({ id: 'u1', evk: 'in.new', mod: 'cps' })).toBeUndefined();
    expect(kbStepRule({ id: 'u1', evk: 'state', mod: 'cps' })).toBeUndefined();
    expect(kbStepRule({ id: 'u1', evk: 'use', mod: 'cps' })).toBeUndefined();
    expect(kbStepRule({ id: 'u1', evk: 'open' })).toBeUndefined();
  });

  it('какие условия работают', () => {
    expect(kbEventWorks('cp.new', false)).toBe(true);
    expect(kbEventWorks('in.new', false)).toBe(false);
    expect(kbEventWorks('use', false)).toBe(false);
    expect(kbEventWorks('hand', false)).toBe(true);
    expect(kbEventWorks('in.new', true)).toBe(true);
  });
});
