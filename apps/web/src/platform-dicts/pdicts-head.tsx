'use client';

import type { AdminDictGroups } from '@buhuchet/shared';
import { Icon } from '@buhuchet/ui';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../l10n/provider';
import { pdictsGroupsQuery } from './pdicts-data';

/**
 * Вкладка → справочник в разделе `dictGroups` (поле `key`, через запятую — несколько справочников
 * вкладки). «Причины изменения срока» описаны вместе с «Категориями задач» (прототип PD_TAB_DG).
 */
const HEAD_KEY: Readonly<Record<string, string>> = {
  types: 'reportTypes',
  taxes: 'taxes',
  bases: 'bases',
  regimes: 'regimes',
  benefits: 'benefits',
  gked: 'gked',
  forms: 'forms',
  phones: 'phones',
  organs: 'organs',
  ugns: 'ugns',
  banks: 'banks',
  calendar: 'calendar',
  statuses: 'statuses',
  cats: 'cats',
  reasons: 'cats',
  roletpl: 'roleTemplates',
  perms: 'permissions',
  templates: 'waTemplates',
  loads: 'dictLoads',
  requests: '—',
};

type Head = { group: string; tab: string; about?: string; usedIn?: string };

/** Шапка вкладки: группа, справочник, «что это» и «где используется»; нет описания — null. */
export function pdictsHead(groups: AdminDictGroups['items'], tabId: string): Head | null {
  const key = HEAD_KEY[tabId];
  if (!key) return null;
  for (const g of groups) {
    const tab = g.tabs.find((x) => x.key.split(/,\s*/).includes(key));
    if (tab) return { group: g.group, tab: tab.tab, about: tab.about, usedIn: tab.usedIn };
  }
  return null;
}

/**
 * Шапка справочника (прототип modules/dict-guide.js dgHead; css `.dg-head`): «Группа · Справочник»,
 * что это за справочник и где используется — из раздела `dictGroups` справочников платформы.
 */
export function PdictsHead({ tabId }: { tabId: string }) {
  const t = useT();
  const groups = useQuery(pdictsGroupsQuery);
  const head = groups.data ? pdictsHead(groups.data, tabId) : null;
  if (!head) return null;
  return (
    <div
      data-pdicts-head
      className="flex flex-col gap-1.5 rounded-xl border border-line bg-pane-alt px-3.5 py-3"
    >
      <div className="flex items-center gap-1.5 text-[12px] text-muted">
        <Icon name="book" size="sm" />
        <span>
          {head.group} · <b className="font-semibold text-ink">{head.tab}</b>
        </span>
      </div>
      {head.about ? <p className="m-0 leading-[1.45]">{head.about}</p> : null}
      {head.usedIn ? (
        <div className="flex items-start gap-1.5 text-[11.5px] leading-[1.4] text-faint">
          <Icon name="info" size="sm" className="mt-px" />
          <span>{t('dicts.platform.used_in', { text: head.usedIn })}</span>
        </div>
      ) : null}
    </div>
  );
}
