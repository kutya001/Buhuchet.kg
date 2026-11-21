import { describe, expect, it } from 'vitest';
import type { AccessSubject } from '../roles/access';
import { FEATURES, type Feature, type PermissionId } from '../roles/permissions';
import {
  NEWS_MODULES,
  newsModulesOf,
  newsModulesOrdered,
  newsModulesProblem,
  newsModulesSeen,
  newsModuleTitle,
  newsTechWords,
} from './modules';
import { newsProblems, type NewsDraft } from './news';

const all = Object.fromEntries(FEATURES.map((f) => [f, true])) as Record<Feature, boolean>;
const role = (...permissions: PermissionId[]): AccessSubject => ({
  employeeId: 'e2',
  isOwner: false,
  permissions: new Set(permissions),
  scopes: {},
});
const owner: AccessSubject = {
  employeeId: 'e1',
  isOwner: true,
  permissions: new Set(),
  scopes: {},
};

describe('модули новости — как NEWS_MODS и newsModOk прототипа v123', () => {
  it('модули организации по порядку меню и «Плата за обслуживание» последней', () => {
    expect(NEWS_MODULES).toEqual([
      'home',
      'cps',
      'reports',
      'fin',
      'projects',
      'kpi',
      'tasks',
      'files',
      'dm',
      'staff',
      'dicts',
      'org',
      'kb',
      'fee',
    ]);
    expect(newsModuleTitle('cps')).toBe('nav.counterparties');
    expect(newsModuleTitle('fee')).toBe('news.mod.fee');
  });

  it('бухгалтер без права «Видеть плату за обслуживание» — без «fee»; владелец при функции — с ним', () => {
    const accountant = newsModulesOf(role('cpView', 'repView'), all);
    expect(accountant).toContain('reports');
    expect(accountant).not.toContain('fee');
    expect(newsModulesOf(role('cpView', 'fee'), all)).toContain('fee');
    expect(newsModulesOf(owner, all)).toContain('fee');
    // Функция выключена в учётной политике — нет и у владельца.
    expect(newsModulesOf(owner, { ...all, fee: false })).not.toContain('fee');
    expect(newsModulesOf(owner, { ...all, tasks: false })).not.toContain('tasks');
  });

  it('новость видна без модулей всем, с модулями — если есть хотя бы один; администратору — все', () => {
    expect(newsModulesSeen([], ['home'])).toBe(true);
    expect(newsModulesSeen(['fee'], ['home', 'reports'])).toBe(false);
    expect(newsModulesSeen(['tasks', 'fee'], ['tasks'])).toBe(true);
    expect(newsModulesSeen(['fee'], null)).toBe(true);
  });

  it('проверка списка: незнакомый код, повтор, больше 30; порядок — как в окне', () => {
    expect(newsModulesProblem(['cps', 'fee'])).toBeNull();
    expect(newsModulesProblem(['cps', 'accounts'])).toBe('news_modules_unknown');
    expect(newsModulesProblem(['cps', 'cps'])).toBe('news_modules_duplicate');
    expect(newsModulesProblem(Array.from({ length: 31 }, () => 'cps'))).toBe(
      'news_modules_too_many',
    );
    expect(newsModulesProblem(Array.from({ length: 30 }, () => 'cps'))).toBe(
      'news_modules_duplicate',
    );
    expect(newsModulesOrdered(['fee', 'cps', 'fee'])).toEqual(['cps', 'fee']);
  });

  it('технические слова в тексте для пользователей — как NEWS_TECH прототипа', () => {
    expect(newsTechWords('Миграция 0157 на стенде, поток И, PR #281')).toEqual([
      'миграция',
      'стенд',
      'поток',
      'PR',
    ]);
    expect(newsTechWords('Данные в справочниках платформы и в прототипе')).toEqual([
      'прототип',
      'справочник платформы',
    ]);
    // Часть другого слова не считается: «потоком» — да, «запоток» и «PRO» — нет.
    expect(newsTechWords('Отчёт PRO, запоток')).toEqual([]);
    expect(newsTechWords('')).toEqual([]);
  });
});

describe('проверка новости со вторым текстом и модулями', () => {
  const draft = (over: Partial<NewsDraft> = {}): NewsDraft => ({
    title: 'Версия 123',
    type: 'feature',
    version: '123',
    date: '2026-11-16',
    short: 'Коротко',
    md: '## Что нового\n- Пункт',
    ...over,
  });

  it('без текста для пользователей можно только новость «Только режим Админка» со вторым текстом', () => {
    const empty = '## Что нового\n- \n';
    expect(newsProblems(draft({ md: empty }), { publish: true })).toEqual({
      md: 'news_md_required',
    });
    expect(
      newsProblems(draft({ md: empty, audience: 'all', adminMd: '- Подробности' }), {
        publish: true,
      }),
    ).toEqual({ md: 'news_md_required' });
    expect(
      newsProblems(draft({ md: empty, audience: 'adm', adminMd: '## Изменено\n- ' }), {
        publish: true,
      }),
    ).toEqual({ md: 'news_md_required' });
    expect(
      newsProblems(draft({ md: empty, audience: 'adm', adminMd: '- Подробности' }), {
        publish: true,
      }),
    ).toEqual({});
  });

  it('второй текст длиннее предела и неверные модули — ошибки своих полей', () => {
    expect(
      newsProblems(draft({ adminMd: 'x'.repeat(50_001), modules: ['cps', 'cps'] }), {
        publish: false,
      }),
    ).toEqual({ adminMd: 'news_admin_md_too_long', modules: 'news_modules_duplicate' });
  });
});
