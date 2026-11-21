'use client';

import { Segments } from '@buhuchet/ui';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useT } from '../l10n/provider';
import { SubsKinds } from './subs-kinds';
import { SubsOrgs } from './subs-orgs';
import { SubsPrices } from './subs-prices';

/*
 * Вкладка «Подписки» Админки → «Организации» (доработки 20.11.2026, блок 6; прототип `renderSubs`):
 * переключатель «Организации · Виды подписок · Цены и реквизиты» и выбранная часть.
 */

type Part = 'orgs' | 'kinds' | 'prices';

/** Выбранная часть живёт, пока открыта страница (прототип `SUBS_UI.part`). */
let chosen: Part = 'orgs';

export function OrgsSubsTab() {
  const t = useT();
  const [part, setPart] = useState<Part>(chosen);
  // Строка колокольчика «Новый чек на проверку» (`?org=`) открывает окно организации из любой части,
  // как `subBellGo` прототипа: часть «Организации» выбирается сама, окно открывает `SubsOrgs`.
  const linked = useSearchParams().has('org');
  if (linked && part !== 'orgs') setPart('orgs');
  useEffect(() => {
    chosen = part;
  }, [part]);
  return (
    <div className="flex flex-col gap-3" data-subs-part={part}>
      <div className="flex flex-wrap gap-2">
        <Segments
          label={t('tab.orgs.subs')}
          options={[
            { value: 'orgs', label: t('subs.part.orgs'), icon: 'building' },
            { value: 'kinds', label: t('subs.part.kinds'), icon: 'layers' },
            { value: 'prices', label: t('subs.part.prices'), icon: 'sliders' },
          ]}
          value={part}
          onChange={setPart}
        />
      </div>
      {part === 'kinds' ? <SubsKinds /> : part === 'prices' ? <SubsPrices /> : <SubsOrgs />}
    </div>
  );
}
