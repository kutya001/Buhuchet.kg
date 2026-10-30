import {
  bishkekDate,
  bishkekTime,
  formatDateRu,
  gkedGroupActText,
  gkedRuleText,
  isAdminSystemDict,
  payRuleText,
  paysText,
  payScheduleText,
  pluralForm,
  SCOPE_GROUPS,
  type AdminSystemDict,
  type AdminValueDict,
  type GkedGroupActs,
  type GkedRule,
  type IoDict,
  type PayRule,
  type UiTextKey,
} from '@buhuchet/domain';
import type { AdminDictHistory } from '@buhuchet/shared';
import type { TimelineItem } from '@buhuchet/ui';
import type { Translate } from '../l10n/translate';

type Item = AdminDictHistory['items'][number];

const shown = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : String(v));

/** Названия кодов в истории вида отчёта: органы, режимы и основания. */
export type HistoryNames = ReadonlyMap<string, string>;

/** Ключ словаря по имени поля: `shortName` → `short_name`. */
const snakeCase = (field: string) => field.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);

/** Поля вида отчёта с подписью значения из словаря: ключ словаря значения по полю. */
const TYPE_VALUE_KEYS: Readonly<Record<string, (v: string) => string>> = {
  act: (v) => `report.act.${v}`,
  period: (v) => `report.period.${v.toLowerCase()}`,
  kind: (v) => `report.kind.${v}`,
  payer: (v) => `pdicts.type.payer.${v}`,
  pickGroup: (v) => `pdicts.type.group.${v}`,
  dueFrom: (v) => `pdicts.type.from.${v}`,
};

/**
 * Значение поля вида отчёта в истории — как прототип (`fv`): подписи кодов, «да»/«нет», названия
 * органов, режимов и оснований, платежи «Налог (ГНС)», график «20.03; 20.06»; срок оплаты — правилом
 * словами («как срок сдачи»), пустой график — «один платёж».
 */
function typeValueText(field: string, v: unknown, t: Translate, names: HistoryNames): string {
  const name = (code: string) => names.get(code) ?? code;
  // Срок оплаты — правилом целиком: «как срок сдачи», «до 25-го числа месяца после отчётного».
  if (field === 'pay') return payRuleText({ ...(v as PayRule), paySchedule: null }, t);
  if (field === 'gked') return ruleText(v, t);
  if (field === 'paySchedule') {
    const schedule = (v ?? []) as [number, number][];
    return schedule.length ? payScheduleText(schedule) : t('pdicts.type.hist.one_payment');
  }
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return t(v ? 'pdicts.type.hist.yes' : 'pdicts.type.hist.no');
  if (field === 'payments') {
    const list = v as { name: string; authority: string }[];
    return paysText(
      list.map((p) => ({ name: p.name, authority: name(p.authority) })),
      '',
    );
  }
  if (field === 'bizSizes')
    return (v as string[]).map((b) => t(`pdicts.type.biz.${b as 'small'}`)).join(', ');
  if (Array.isArray(v)) return v.map((x) => name(String(x))).join(', ');
  const key = TYPE_VALUE_KEYS[field];
  if (key && typeof v === 'string') return t(key(v) as UiTextKey);
  if (field === 'authorityCode') return name(String(v));
  return String(v);
}

/** Перечень «Виды деятельности (ГКЭД)» в истории: без ограничения — «все». */
const ruleText = (v: unknown, t: Translate) =>
  gkedRuleText(v as GkedRule | null, t) || t('pdicts.gked.rule.all');

/**
 * Запись истории вида отчёта (прототип typeEditDlg, pdLog): «добавлен «НДС»», «удалён «НДС»»,
 * «НДС — срок: число: «25» → «28»; кратко: …» по каждому изменённому полю.
 */
function typeHistoryText(item: Item, t: Translate, names: HistoryNames): string | null {
  const dict = t('pdicts.title.types');
  const name = item.label;
  if (item.action === 'create') return t('pdicts.hist.type_create', { dict, name });
  if (item.action === 'delete') return t('pdicts.hist.type_delete', { dict, name });
  if (item.changes.some((c) => c.field === 'active')) return null;
  const changes = item.changes.map((c) =>
    t('pdicts.hist.type_change', {
      field: t(`pdicts.type.hist.${snakeCase(c.field)}` as UiTextKey),
      from: typeValueText(c.field, c.from ?? null, t, names),
      to: typeValueText(c.field, c.to ?? null, t, names),
    }),
  );
  return t('pdicts.hist.type_update', { dict, name, changes: changes.join('; ') });
}

/**
 * Загрузка из Excel и её откат (задача 2.37, прототип importDictDlg и rollbackLoad, pdLog): «Органы:
 * загрузка из Excel — добавлено 1, изменено 2, отключено 0», «Органы: загрузка от 30.10.2026 откачена».
 */
function loadHistoryText(dict: IoDict, item: Item, t: Translate): string | null {
  const title = t(`pdicts.title.${dict}`);
  const to = (field: string) => item.changes.find((c) => c.field === field)?.to;
  if (item.action === 'import') {
    const n = (field: string) => Number(to(field) ?? 0);
    return t('pdicts.hist.import', {
      dict: title,
      added: n('added'),
      changed: n('changed'),
      disabled: n('disabled'),
    });
  }
  if (item.action === 'rollback') {
    const at = to('loadedAt');
    const date = typeof at === 'string' ? formatDateRu(bishkekDate(new Date(at))) : '';
    return t('pdicts.hist.rollback', { dict: title, date });
  }
  return null;
}

/**
 * Что изменено, словами — как пишет прототип (admin/platform-dicts*.js, pdLog): «Формы: добавлено
 * «ОсОО»», «Органы: «ГНС» → «ГНС при МФ»», «отключено (было: активно)», «перемещено с № 3 на № 2»; у
 * УГНС — «изменено. Было: … Стало: …» по изменённым полям; у режима — «изменено: 2 поля», у
 * основания — «изменено», у кода страны — вся строка «было → стало» и «добавлено «…» +код»; у
 * льготы — «изменено», после правки «Меняет сроки» — «сроки по статусу пересчитаны у N отчётов».
 * Переименование режима, основания и льготы — «старое» → «новое», как требует ТЗ (у прототипа его не
 * видно). У вида отчёта — каждое поле «было» → «стало» (`typeHistoryText`).
 */
export function dictHistoryText(
  dict: AdminValueDict,
  item: Item,
  t: Translate,
  names: HistoryNames = new Map(),
): string {
  if (dict === 'gked') return sectionHistoryText(item, t);
  const load = loadHistoryText(dict, item, t);
  if (load !== null) return load;
  // «Отметить сверку с ГНС» — одной строкой по всем отмеченным видам (прототип markGns).
  const gns = item.changes.find((c) => c.field === 'gns');
  if (dict === 'types' && gns) {
    return t('pdicts.hist.gns', { names: strings(gns.to).join(', ') });
  }
  if (dict === 'types') {
    const text = typeHistoryText(item, t, names);
    if (text !== null) return text;
  }
  const title = t(`pdicts.title.${dict}`);
  const name = item.label;
  const change = (field: string) => item.changes.find((c) => c.field === field);
  if (item.action === 'create' && dict === 'phones') {
    return t('pdicts.hist.phone_create', {
      dict: title,
      name,
      code: shown(change('dialCode')?.to),
    });
  }
  if (item.action === 'create') return t('pdicts.hist.create', { dict: title, name });
  if (item.action === 'delete') return t('pdicts.hist.delete', { dict: title, name });
  const active = change('active');
  if (active) return t(active.to ? 'pdicts.hist.on' : 'pdicts.hist.off', { dict: title, name });
  const moved = change('n');
  if (moved) {
    return t('pdicts.hist.move', {
      dict: title,
      name,
      from: shown(moved.from),
      to: shown(moved.to),
    });
  }
  if (dict === 'ugns') {
    return t('pdicts.hist.ugns_update', {
      dict: title,
      name,
      from: item.changes.map((c) => shown(c.from)).join(' · '),
      to: item.changes.map((c) => shown(c.to)).join(' · '),
    });
  }
  const renamed = change('name');
  if (dict === 'benefits') {
    const recalculated = change('recalculated');
    const n = Number(recalculated?.to ?? 0);
    // ОТКЛОНЕНИЕ: docs/deviations.md#Д-8
    if (renamed) {
      const words = { dict: title, from: shown(renamed.from), to: shown(renamed.to) };
      return recalculated
        ? t(`pdicts.hist.rename_due.${pluralForm(n)}`, { ...words, n })
        : t('pdicts.hist.rename', words);
    }
    return recalculated
      ? t(`pdicts.hist.benefit_due.${pluralForm(n)}`, { dict: title, name, n })
      : t('pdicts.hist.changed', { dict: title, name });
  }
  if ((dict === 'regimes' || dict === 'bases') && renamed) {
    // ТЗ: переименование видно в истории — «старое» → «новое», у режима и число других полей.
    // ОТКЛОНЕНИЕ: docs/deviations.md#Д-8
    const words = { dict: title, from: shown(renamed.from), to: shown(renamed.to) };
    const n = dict === 'regimes' ? item.changes.length - 1 : 0;
    return n > 0
      ? t(`pdicts.hist.rename_more.${pluralForm(n)}`, { ...words, n })
      : t('pdicts.hist.rename', words);
  }
  if (dict === 'regimes') {
    const n = item.changes.length;
    return t(`pdicts.hist.fields_n.${pluralForm(n)}`, { dict: title, name, n });
  }
  if (dict === 'bases') return t('pdicts.hist.changed', { dict: title, name });
  // Код страны — всей строкой до и после (прототип phoneCodeDlg); строки собирает сервер.
  if (dict === 'phones' && item.summary) {
    return t('pdicts.hist.phone_update', {
      dict: title,
      from: item.summary.from,
      to: item.summary.to,
    });
  }
  if (renamed) {
    return t('pdicts.hist.rename', {
      dict: title,
      from: shown(renamed.from),
      to: shown(renamed.to),
    });
  }
  return t('pdicts.hist.fields', { dict: title, name });
}

// ОТКЛОНЕНИЕ: docs/deviations.md#Д-6
/**
 * Запись «Истории изменений» календаря: «Календарь: добавлено «04.01.2027 Перенос: Новый год»» и
 * «… удалено»; у рабочей субботы названия нет — «Рабочая суббота».
 */
export function calendarHistoryText(item: Item, t: Translate): string {
  const load = loadHistoryText('calendar', item, t);
  if (load !== null) return load;
  const day = item.code;
  const date = /^\d{2}-\d{2}$/.test(day) ? `${day.slice(3)}.${day.slice(0, 2)}` : formatDateRu(day);
  const kind = item.changes.find((c) => c.field === 'kind');
  const name =
    item.label ||
    (kind && (kind.to ?? kind.from) === 'workday' ? t('dicts.platform.calendar.workday') : '');
  // Загрузка из Excel меняет у праздника «каждый год» название (docs/deviations.md п. Д-19).
  const renamed = item.action === 'update' && item.changes.find((c) => c.field === 'name');
  if (renamed) {
    return t('pdicts.cal.hist.update', { date, from: shown(renamed.from), to: shown(renamed.to) });
  }
  return t(item.action === 'delete' ? 'pdicts.cal.hist.delete' : 'pdicts.cal.hist.create', {
    date,
    name,
  });
}

/** Действие группы кодов в истории: «Запрет», по кодам — «64.91 — предупреждение». */
const actsText = (v: unknown, k: 'en' | 'spino', t: Translate) =>
  gkedGroupActText({ en: null, spino: null, [k]: (v ?? null) as GkedGroupActs }, k, t);

/**
 * Запись вкладки из нескольких разделов (задача 2.38; прототип pdLog 'gked' и 'taxes'): коды ГКЭД —
 * «ГКЭД: добавлен код 69.20.0 «…»», «ГКЭД: 69.20.0 — «Действует»: нет», «ГКЭД: 69.20.0 изменён»;
 * группы кодов — «ГКЭД: группа кодов «…» изменена — коды …; единый налог: …; СПиНО: …» (изменённое);
 * перечни ГКЭД ставок и налогов — «Ставки единого налога: ЕНС-01 — виды деятельности (ГКЭД): «…» →
 * «…»»; загрузки и строки загрузок — как у справочников значений.
 */
export function sectionHistoryText(item: Item, t: Translate): string {
  const section = item.section ?? 'gked';
  const load = loadHistoryText(section, item, t);
  if (load !== null) return load;
  const change = (field: string) => item.changes.find((c) => c.field === field);
  const name = item.label;
  const code = item.code;
  if (section === 'gked') {
    if (item.action === 'create') return t('pdicts.hist.gked_create', { code, name });
    if (item.action === 'delete') return t('pdicts.hist.gked_delete', { code, name });
    const active = change('active');
    if (active && item.changes.length === 1) {
      return t('pdicts.hist.gked_active', {
        code,
        value: t(active.to ? 'pdicts.type.hist.yes' : 'pdicts.type.hist.no'),
      });
    }
    return t('pdicts.hist.gked_update', { code });
  }
  if (section === 'gkgroups') {
    if (item.action === 'create') return t('pdicts.hist.gkgroup_create', { name });
    if (item.action === 'delete') return t('pdicts.hist.gkgroup_delete', { name });
    const parts = item.changes.flatMap((c) => {
      if (c.field === 'codes') return [t('pdicts.hist.gkgroup_codes', { codes: strings(c.to).join(', ') })];
      if (c.field === 'en') return [t('pdicts.hist.gkgroup_en', { act: actsText(c.to, 'en', t) })];
      if (c.field === 'spino') {
        return [t('pdicts.hist.gkgroup_spino', { act: actsText(c.to, 'spino', t) })];
      }
      return [];
    });
    return parts.length
      ? t('pdicts.hist.gkgroup_more', { name, changes: parts.join('; ') })
      : t('pdicts.hist.gkgroup', { name });
  }
  const dict = t(`pdicts.title.${section}`);
  const gked = change('gked');
  if (gked && item.changes.length === 1 && item.action === 'update') {
    return t('pdicts.hist.rule_gked', {
      dict,
      code,
      from: ruleText(gked.from, t),
      to: ruleText(gked.to, t),
    });
  }
  if (item.action === 'create') return t('pdicts.hist.create', { dict, name });
  if (item.action === 'delete') return t('pdicts.hist.delete', { dict, name });
  const active = change('active');
  if (active) return t(active.to ? 'pdicts.hist.on' : 'pdicts.hist.off', { dict, name });
  const renamed = change('name');
  if (renamed) {
    return t('pdicts.hist.rename', { dict, from: shown(renamed.from), to: shown(renamed.to) });
  }
  return t('pdicts.hist.fields', { dict, name });
}

const strings = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);
const scopesOf = (v: unknown) =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/** Цвет статуса словами: «Синий»; неизвестный — как есть. */
function toneText(t: Translate, v: unknown): string {
  return t(`pdicts.status.tone.${shown(v)}` as UiTextKey);
}

/**
 * Запись истории вкладок «Работа системы» — как пишет прототип (pdLog): «Статусы: «К сдаче»
 * переименован в «К отправке»», «Периодичность: «Месяц» → «Отчётный месяц»», «Права ролей: «…»
 * переименовано в «…»» и «— изменено описание», «Шаблоны ролей: «Бухгалтер» — добавлено право «…»»,
 * «— область «Контрагенты»: «Все контрагенты»». Цвет статуса и текст шаблона прототип в историю не
 * пишет — у нас пишется: «— цвет «Серый» → «Синий»», «— изменён текст».
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#Д-13
export function systemHistoryText(
  dict: AdminSystemDict,
  item: Item,
  t: Translate,
  names: HistoryNames = new Map(),
): string {
  const title = t(`tab.pdicts.${dict}`);
  const name = item.label;
  const parts = item.changes.flatMap((c): string[] => {
    const from = shown(c.from);
    const to = shown(c.to);
    if (dict === 'statuses') {
      if (c.field === 'tone') {
        return [
          t('pdicts.hist.status_tone', {
            dict: title,
            name,
            from: toneText(t, c.from),
            to: toneText(t, c.to),
          }),
        ];
      }
      return [
        item.code.startsWith('period.')
          ? t('pdicts.hist.period_rename', { from, to })
          : t('pdicts.hist.status_rename', { dict: title, from, to }),
      ];
    }
    if (dict === 'perms') {
      return [
        c.field === 'name'
          ? t('pdicts.hist.perm_rename', { dict: title, from, to })
          : t('pdicts.hist.perm_description', { dict: title, name }),
      ];
    }
    if (dict === 'templates') return [t('pdicts.hist.template', { dict: title, name })];
    // Шаблон роли: название, права по одному, область по группам.
    if (c.field === 'name') return [t('pdicts.hist.rename', { dict: title, from, to })];
    if (c.field === 'permissions') {
      const before = strings(c.from);
      const after = strings(c.to);
      const perm = (p: string) => names.get(p) ?? p;
      return [
        ...after
          .filter((p) => !before.includes(p))
          .map((p) => t('pdicts.hist.roletpl_add', { dict: title, name, perm: perm(p) })),
        ...before
          .filter((p) => !after.includes(p))
          .map((p) => t('pdicts.hist.roletpl_remove', { dict: title, name, perm: perm(p) })),
      ];
    }
    const before = scopesOf(c.from);
    const after = scopesOf(c.to);
    return SCOPE_GROUPS.filter((g) => (before[g] ?? 'own') !== (after[g] ?? 'own')).map((g) =>
      t('pdicts.hist.roletpl_scope', {
        dict: title,
        name,
        group: t(`roles.group.${g}`),
        scope: t(after[g] === 'all' ? 'roles.scope.all' : 'roles.scope.own'),
      }),
    );
  });
  return parts.join('; ');
}

/** Запись «Истории изменений» для ленты: дата и время по Бишкеку, что изменено, кто. */
export function dictHistoryItem(
  dict: AdminValueDict | AdminSystemDict | 'calendar' | 'taxes',
  item: Item,
  t: Translate,
  names: HistoryNames = new Map(),
): TimelineItem {
  const at = new Date(item.at);
  return {
    id: item.id,
    date: formatDateRu(bishkekDate(at)),
    time: bishkekTime(at),
    text:
      dict === 'calendar'
        ? calendarHistoryText(item, t)
        : dict === 'taxes'
          ? sectionHistoryText(item, t)
          : isAdminSystemDict(dict)
          ? systemHistoryText(dict, item, t, names)
          : dictHistoryText(dict, item, t, names),
    who: item.actor ?? t('org.history.system'),
  };
}
