import { describe, expect, it } from 'vitest';
import { UI_TEXTS, formatText, type Translate } from '../l10n/texts';
import {
  KB_KNOWN_KEY_MAX,
  KB_SHOW_AUTOS,
  KB_SHOW_GO_TARGET,
  kbKnownKey,
  kbKnownKeyOk,
  kbScreenOk,
  kbScreenShowItems,
  kbShowOf,
  kbShowSubTab,
  kbShowWhat,
  kbSmartList,
  kbStepShowItems,
  type KbShowDef,
  type KbShowPoint,
} from './shows';

const TEXTS = { allKnownT: 'Всё на этом экране вам уже знакомо', allKnown: 'Все элементы…' };
const UI = {
  introLook: 'Проведу по экрану.',
  introDo: 'Сначала покажу.',
  introScreen: 'По очереди подсвечу.',
  finLookT: 'Готово',
  finLook: 'Вы посмотрели всё.',
  finDoT: 'Теперь сделайте сами',
  finDo: 'Нажмите «Сделать сейчас».',
  finScreenT: 'Обзор экрана закончен',
  finScreen: 'Это все элементы экрана.',
};

describe('ключ знакомого элемента', () => {
  it('общий элемент — один на всю систему, по коду или по названию облачка с признаком «Общий»', () => {
    expect(kbKnownKey({ t: '«На весь экран»', g: 'max', mt: 'Счёт организации' }, 'org.main')).toBe(
      'g:max',
    );
    expect(kbKnownKey({ t: '«Столбцы»', common: true }, 'dicts.types')).toBe('g:«Столбцы»');
  });

  it('свой элемент — по экрану и окну: поле «ИНН» профиля и формы контрагента разные', () => {
    const inn: KbShowPoint = { t: 'ИНН · обязательно' };
    expect(kbKnownKey(inn, 'org.main')).toBe('s:org.main|ИНН · обязательно');
    expect(kbKnownKey({ ...inn, mt: 'Новый контрагент' }, 'cps.all')).toBe(
      's:cps.all|Новый контрагент|ИНН · обязательно',
    );
    expect(kbKnownKey({ ...inn, scr: 'staff.list' }, 'org.main')).toBe(
      's:staff.list|ИНН · обязательно',
    );
  });

  it('шапка карточки — одна на модуль, хотя название записи разное', () => {
    expect(
      kbKnownKey({ t: 'Карточка «Иванов»', ck: 'Карточка', mt: 'card:staff' }, 'staff.list'),
    ).toBe('s:staff.list|card:staff|Карточка');
  });

  it('вступление и последнее облачко не запоминаются; длинный ключ обрезается', () => {
    expect(kbKnownKey({ t: 'Шаг', kind: 'intro' }, 'org.main')).toBeNull();
    expect(kbKnownKey({ t: 'Готово', kind: 'done' }, 'org.main')).toBeNull();
    expect(kbKnownKey({ x: 'без заголовка' }, 'org.main')).toBeNull();
    const key = kbKnownKey({ t: 'Я'.repeat(400) }, 'org.main')!;
    expect(key).toHaveLength(KB_KNOWN_KEY_MAX);
    expect(kbKnownKeyOk(key)).toBe(true);
    expect(kbKnownKey({ t: 'а\nб' }, 'org.main')).toBe('s:org.main|а б');
  });

  it('сервер принимает только ключи показа', () => {
    expect(kbKnownKeyOk('g:max')).toBe(true);
    expect(kbKnownKeyOk('s:org.main|Название')).toBe(true);
    expect(kbKnownKeyOk('x:max')).toBe(false);
    expect(kbKnownKeyOk('g:')).toBe(false);
    expect(kbKnownKeyOk('g:a\u0000b')).toBe(false);
    expect(kbKnownKeyOk(`g:${'a'.repeat(KB_KNOWN_KEY_MAX)}`)).toBe(false);
  });
});

describe('пропуск знакомых элементов', () => {
  const list: KbShowPoint[] = [
    { t: 'Заполнить профиль', kind: 'intro' },
    { t: '«На весь экран»', g: 'max' },
    { t: 'Название' },
    { t: 'ИНН' },
    { t: 'Теперь сделайте сами', kind: 'doit' },
  ];

  it('без знакомых — показ целиком, без строки «Пропущено»', () => {
    expect(kbSmartList(list, () => false, 'org.main', TEXTS)).toEqual({ list, skipped: null });
  });

  it('знакомые пропускаются, счётчик — только новые, последнее облачко остаётся', () => {
    const known = new Set(['g:max', 's:org.main|Название']);
    const r = kbSmartList(list, (k) => known.has(k), 'org.main', TEXTS);
    expect(r.skipped).toBe(2);
    expect(r.list.map((p) => p.t)).toEqual(['Заполнить профиль', 'ИНН', 'Теперь сделайте сами']);
  });

  it('«Показать всё» — показ целиком с первого элемента', () => {
    expect(kbSmartList(list, () => true, 'org.main', TEXTS, true)).toEqual({
      list,
      skipped: null,
    });
  });

  it('все элементы шага «Сделать» знакомы — сразу «Сделать сейчас»', () => {
    const r = kbSmartList(list, () => true, 'org.main', TEXTS);
    expect(r).toEqual({ list: [{ t: 'Теперь сделайте сами', kind: 'doit' }], skipped: 3 });
  });

  it('у «Посмотреть» и обзора — «Всё на этом экране вам уже знакомо»', () => {
    const look: KbShowPoint[] = [
      { t: 'Роли', kind: 'intro' },
      { t: 'Вкладка «Роли»' },
      { t: 'Готово', x: 'Вы посмотрели всё.', kind: 'done' },
    ];
    const r = kbSmartList(look, () => true, 'staff.roles', TEXTS);
    expect(r).toEqual({
      list: [{ t: TEXTS.allKnownT, x: TEXTS.allKnown, kind: 'done' }],
      skipped: 1,
    });
    const screen: KbShowPoint[] = [
      { t: 'Обзор', kind: 'intro' },
      { t: 'Поиск', g: 'search' },
    ];
    const end = kbSmartList([...screen, { t: 'Конец', kind: 'end' }], () => true, 'x', TEXTS);
    expect(end.list).toEqual([{ t: TEXTS.allKnownT, x: TEXTS.allKnown, kind: 'end' }]);
  });
});

describe('облачка шага и обзора экрана', () => {
  const show: KbShowDef = {
    id: 'sh-profile',
    step: 'profile',
    scr: 'org.main',
    items: [{ s: '#og-save', t: 'Кнопка «Сохранить»', x: 'Сохраняет профиль.' }],
  };

  it('«Сделать» со сценарием: вступление, сценарий, «Сделать сейчас»', () => {
    const items = kbStepShowItems({ t: 'Профиль', w: 'Реквизиты.' }, show, null, UI);
    expect(items).toEqual([
      { t: 'Профиль', x: 'Реквизиты. Сначала покажу.', kind: 'intro' },
      show.items[0],
      { t: 'Теперь сделайте сами', x: 'Нажмите «Сделать сейчас».', kind: 'doit' },
    ]);
  });

  it('«Посмотреть» с экраном без сценария — экран целиком и «Готово»', () => {
    const items = kbStepShowItems({ t: 'Роли', learn: 1, at: ['staff.roles'] }, null, null, UI);
    expect(items[0]).toEqual({ t: 'Роли', x: 'Проведу по экрану.', kind: 'intro' });
    expect(items.slice(1)).toEqual([
      { auto: 'screen' },
      { t: 'Готово', x: 'Вы посмотрели всё.', kind: 'done' },
    ]);
  });

  it('«Сделать» без сценария — место из «Перейти»: «+ Добавить» или своё место', () => {
    expect(kbStepShowItems({ t: 'Сотрудники' }, null, 'add', UI)[1]).toEqual({ auto: 'add' });
    expect(kbStepShowItems({ t: 'Дни', w: 'Когда напоминать.' }, null, 'place', UI)[1]).toEqual({
      s: KB_SHOW_GO_TARGET,
      t: 'Дни',
      x: 'Когда напоминать.',
    });
    expect(kbStepShowItems({ t: 'Тема', learn: true }, null, null, UI)[1]).toEqual({
      auto: 'screen',
    });
  });

  it('обзор экрана: вступление с названием экрана, экран целиком, «Готово»', () => {
    expect(kbScreenShowItems('Обзор экрана: Сотрудники · Роли', UI)).toEqual([
      { t: 'Обзор экрана: Сотрудники · Роли', x: 'По очереди подсвечу.', kind: 'intro' },
      { auto: 'screen' },
      { t: 'Обзор экрана закончен', x: 'Это все элементы экрана.', kind: 'end' },
    ]);
  });

  it('сценарий шага — первый активный', () => {
    const off = { ...show, id: 'sh-old', active: false };
    expect(kbShowOf([off, show], 'profile')).toBe(show);
    expect(kbShowOf([off], 'profile')).toBeNull();
  });

  it('экран обзора — «модуль» или «модуль.вкладка»', () => {
    expect(kbScreenOk('staff.roles')).toBe(true);
    expect(kbScreenOk('files')).toBe(true);
    expect(kbScreenOk('staff.roles.x')).toBe(false);
    expect(kbScreenOk('Staff')).toBe(false);
  });
});

describe('«Что подсвечивает» облачко (прототип kbShowWhat)', () => {
  const t: Translate = (key, params) => formatText(UI_TEXTS[key].ru, params);

  it('автоматически, элемент с текстом, элемент экрана, только текст', () => {
    expect(kbShowWhat({ auto: 'fields' }, t)).toBe('Автоматически: Поля формы');
    expect(kbShowWhat({ auto: 'grid', tab: 'Обслуживание' }, t)).toBe(
      'Автоматически: Список: столбцы, фильтры, строка, меню «…» · вкладка «Обслуживание»',
    );
    expect(kbShowWhat({ txt: 'Сохранить', s: '#b' }, t)).toBe('Элемент с текстом «Сохранить»');
    expect(kbShowWhat({ s: '#og-save' }, t)).toBe('Элемент экрана');
    expect(kbShowWhat({}, t)).toBe('Только текст');
    for (const a of KB_SHOW_AUTOS) expect(UI_TEXTS).toHaveProperty(`kbadm.show.auto.${a}`);
  });

  it('вкладка облачка — из действий перед показом', () => {
    expect(kbShowSubTab([{ click: '#x' }, { tab: 'Роли' }])).toBe('Роли');
    expect(kbShowSubTab(null)).toBeNull();
  });
});
