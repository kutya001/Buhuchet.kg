import {
  bishkekDate,
  bishkekTime,
  formatDateRu,
  isAdminSystemDict,
  paysText,
  payScheduleText,
  pluralForm,
  SCOPE_GROUPS,
  type AdminSystemDict,
  type AdminValueDict,
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
 * органов, режимов и оснований, платежи «Налог (ГНС)», график «20.03; 20.06»; пустой свой срок
 * оплаты — «как срок сдачи», пустой график — «один платёж».
 */
function typeValueText(field: string, v: unknown, t: Translate, names: HistoryNames): string {
  const name = (code: string) => names.get(code) ?? code;
  if (field === 'payDay' && v === null) return t('pdicts.type.hist.pay_as_due');
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
  const day = item.code;
  const date = /^\d{2}-\d{2}$/.test(day) ? `${day.slice(3)}.${day.slice(0, 2)}` : formatDateRu(day);
  const kind = item.changes.find((c) => c.field === 'kind');
  const name =
    item.label ||
    (kind && (kind.to ?? kind.from) === 'workday' ? t('dicts.platform.calendar.workday') : '');
  return t(item.action === 'delete' ? 'pdicts.cal.hist.delete' : 'pdicts.cal.hist.create', {
    date,
    name,
  });
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
  dict: AdminValueDict | AdminSystemDict | 'calendar',
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
        : isAdminSystemDict(dict)
          ? systemHistoryText(dict, item, t, names)
          : dictHistoryText(dict, item, t, names),
    who: item.actor ?? t('org.history.system'),
  };
}
