import { describe, expect, it } from 'vitest';
import { defaultUiTexts } from '../l10n/texts';
import refDB from '../../../../spec/data/refDB.json';
import {
  ADMIN_STATUS_SCALES,
  defaultStatusTones,
  isAdminSystemDict,
  MESSAGE_TEMPLATE_MAX,
  MESSAGE_TEMPLATE_ORDER,
  MESSAGE_TEMPLATE_REQUIRED,
  MESSAGE_TEMPLATE_VARIABLES,
  messageTemplateLabelKey,
  messageTemplateMax,
  messageTemplateVariables,
  missingTemplateVariables,
  roleTemplateProblem,
  sameName,
  statusPlace,
  statusToneKey,
  statusToneOf,
  TEMPLATE_PERMISSION_COUNT,
  templatePermissionLock,
  unknownTemplateVariables,
} from './admin-system';

describe('Админка → «Статусы»: место статуса на шкале и цвет', () => {
  it('во вкладке — все шкалы системы, как в ТЗ', () => {
    expect(ADMIN_STATUS_SCALES).toEqual([
      'report',
      'payment',
      'task',
      'service',
      'project',
      'indicator',
      'lead',
    ]);
    expect(isAdminSystemDict('statuses')).toBe(true);
    expect(isAdminSystemDict('types')).toBe(false);
  });

  it('«Этап N», «отметка» на шаге «Сдан» и «боковой» — как в прототипе', () => {
    expect(statusPlace('report', 'todo')).toEqual({ kind: 'step', n: 1 });
    expect(statusPlace('report', 'submitted')).toEqual({ kind: 'step', n: 3 });
    expect(statusPlace('report', 'waiting')).toEqual({ kind: 'mark' });
    expect(statusPlace('report', 'needs_fix')).toEqual({ kind: 'side' });
    expect(statusPlace('report', 'not_required')).toEqual({ kind: 'side' });
    // У задачи «На подтверждении» и «Подтверждена» — этапы шкалы с подтверждением.
    expect(statusPlace('task', 'done')).toEqual({ kind: 'step', n: 3 });
    expect(statusPlace('task', 'on_confirm')).toEqual({ kind: 'step', n: 3 });
    expect(statusPlace('task', 'confirmed')).toEqual({ kind: 'step', n: 4 });
    expect(statusPlace('task', 'rework')).toEqual({ kind: 'side' });
  });

  it('цвет из словаря, если он из набора; иначе — цвет шкалы по умолчанию', () => {
    expect(statusToneKey('report', 'todo')).toBe('tone.report.todo');
    expect(statusToneOf({}, 'report', 'submitted')).toBe('green');
    expect(statusToneOf({ 'tone.report.submitted': 'purple' }, 'report', 'submitted')).toBe(
      'purple',
    );
    expect(statusToneOf({ 'tone.report.submitted': 'pink' }, 'report', 'submitted')).toBe('green');
  });

  it('цвета по умолчанию — у каждого статуса каждой шкалы, у каждого есть название в словаре', () => {
    const texts = defaultUiTexts();
    const rows = defaultStatusTones();
    expect(rows).toContainEqual({ scale: 'indicator', status: 'empty', tone: 'orange' });
    for (const r of rows) expect(texts[`status.${r.scale}.${r.status}`]).toBeTruthy();
  });

  it('названия сравниваются без регистра и лишних пробелов', () => {
    expect(sameName('  Месяц ', 'месяц')).toBe(true);
    expect(sameName('Отчётный  месяц', 'отчётный месяц')).toBe(true);
    expect(sameName('Месяц', 'Квартал')).toBe(false);
  });
});

describe('Админка → «Шаблоны ролей»: права и область', () => {
  it('право только владельца, право без просмотра группы и неизвестное — нельзя', () => {
    expect(roleTemplateProblem(['cpView', 'createCp'], { cps: 'all' })).toBeNull();
    expect(roleTemplateProblem(['org'], {})).toEqual({ problem: 'owner_only', permission: 'org' });
    expect(roleTemplateProblem(['createCp'], {})).toEqual({
      problem: 'view_required',
      permission: 'createCp',
    });
    expect(roleTemplateProblem(['nope'], {})).toEqual({
      problem: 'unknown_permission',
      permission: 'nope',
    });
    expect(roleTemplateProblem([], { cps: 'some' })).toEqual({
      problem: 'bad_scope',
      group: 'cps',
    });
    expect(roleTemplateProblem([], { zzz: 'all' })).toEqual({ problem: 'bad_scope', group: 'zzz' });
  });

  it('галочка в окне: «только у владельца» и «Сначала дайте просмотр»', () => {
    expect(templatePermissionLock('org', new Set())).toBe('owner_only');
    expect(templatePermissionLock('createCp', new Set())).toBe('view_required');
    expect(templatePermissionLock('createCp', new Set(['cpView']))).toBeNull();
    expect(templatePermissionLock('cpView', new Set())).toBeNull();
  });

  it('«N из M прав» — без прав только владельца', () => {
    expect(TEMPLATE_PERMISSION_COUNT).toBe(39);
  });
});

describe('Админка → «Шаблоны» сообщений', () => {
  it('у каждого шаблона — свои подстановки; порядок — WhatsApp, потом Telegram', () => {
    expect(MESSAGE_TEMPLATE_ORDER.slice(0, 3)).toEqual(['waTax', 'waFee', 'waPage']);
    expect([...MESSAGE_TEMPLATE_ORDER].sort()).toEqual(
      Object.keys(MESSAGE_TEMPLATE_VARIABLES).sort(),
    );
  });

  it('предел длины по ключу: подпись кнопки бота — 40 знаков, скрытый ответ — 200, остальные — общий', () => {
    expect(messageTemplateMax('tgBtnCopyCode')).toBe(40);
    expect(messageTemplateMax('tgBtnTest')).toBe(40);
    expect(messageTemplateMax('tgActStale')).toBe(200);
    expect(messageTemplateMax('tgActNoRight')).toBe(200);
    expect(messageTemplateMax('tgTestOk')).toBe(200);
    expect(messageTemplateMax('tgTest')).toBe(MESSAGE_TEMPLATE_MAX);
    expect(messageTemplateMax('tgCode')).toBe(MESSAGE_TEMPLATE_MAX);
    expect(messageTemplateMax('waTax')).toBe(MESSAGE_TEMPLATE_MAX);
    // Тексты справочника в свои пределы укладываются.
    for (const [key, text] of Object.entries(refDB.messageTemplates)) {
      expect(text.length, key).toBeLessThanOrEqual(messageTemplateMax(key));
    }
  });

  it('у каждого шаблона справочника (refDB.json, messageTemplates) — подстановки, место и подпись', () => {
    const keys = Object.keys(refDB.messageTemplates).sort();
    expect([...MESSAGE_TEMPLATE_ORDER].sort()).toEqual(keys);
    const texts = defaultUiTexts();
    for (const key of keys) {
      expect(texts[messageTemplateLabelKey(key)], key).toBeTruthy();
      expect(
        unknownTemplateVariables(
          key,
          refDB.messageTemplates[key as keyof typeof refDB.messageTemplates],
        ),
        key,
      ).toEqual([]);
    }
  });

  it('подстановка, которой нет у шаблона, — ошибка; известные и повторы — нет', () => {
    expect(unknownTemplateVariables('waFee', 'Уважаемые {контрагент}! {сумма} до {дата}')).toEqual(
      [],
    );
    expect(
      unknownTemplateVariables('waFee', '{кантрагент}, {сумма}, {кантрагент}, {срок}'),
    ).toEqual(['кантрагент', 'срок']);
    expect(
      unknownTemplateVariables('tgWeek', 'сдать {n1}, оплатить {n2}, просрочено {n3}'),
    ).toEqual([]);
    // Ключ из запроса не достаёт свойства объекта: у неизвестного шаблона подстановок нет.
    expect(messageTemplateVariables('constructor')).toEqual([]);
    expect(unknownTemplateVariables('__proto__', '{код}')).toEqual(['код']);
  });

  it('у кодов восстановления пароля, входа в Админку и замены Telegram {код} обязателен; у остальных — ничего', () => {
    expect(Object.keys(MESSAGE_TEMPLATE_REQUIRED).sort()).toEqual([
      'tgAdminCode',
      'tgCode',
      'tgRelinkCode',
    ]);
    expect(missingTemplateVariables('tgCode', 'Код для восстановления пароля готов')).toEqual([
      'код',
    ]);
    expect(missingTemplateVariables('tgAdminCode', 'Вход ({логин}), {минут} минут')).toEqual([
      'код',
    ]);
    expect(missingTemplateVariables('tgRelinkCode', 'Привязать {телеграм} к {логин}?')).toEqual([
      'код',
    ]);
    expect(missingTemplateVariables('tgCode', 'Ваш код: {код}')).toEqual([]);
    // «{ код }» с пробелами — не подстановка: бот её не заполнит.
    expect(missingTemplateVariables('tgCode', 'Ваш код: { код }')).toEqual(['код']);
    expect(missingTemplateVariables('tgLinked', 'Привязан')).toEqual([]);
    expect(missingTemplateVariables('constructor', '')).toEqual([]);
    for (const [key, vars] of Object.entries(MESSAGE_TEMPLATE_REQUIRED)) {
      for (const v of vars) expect(messageTemplateVariables(key), key).toContain(v);
      const text = refDB.messageTemplates[key as keyof typeof refDB.messageTemplates];
      expect(missingTemplateVariables(key, text), key).toEqual([]);
    }
  });
});
