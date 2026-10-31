'use client';

import { linkButtonClass } from '@buhuchet/ui';
import { openContractorCard, useContractorCardOn } from './card-store';
import type { ContractorCardTab } from './contractor-card';

/**
 * Название контрагента ссылкой на его карточку (прототип `.linkbtn` с `openCp(c, tab)`: «Показатели
 * контрагентов», карточки отчёта и задачи). Без права «Просматривать контрагентов» — просто текст.
 * Нажатие не доходит до строки или подписи вокруг (галочка, ячейка ввода).
 */
export function ContractorLink({
  id,
  name,
  tab = 'main',
  className = '',
}: {
  id: string;
  name: string;
  tab?: ContractorCardTab;
  className?: string;
}) {
  const on = useContractorCardOn();
  if (!on) return <span className={className}>{name}</span>;
  return (
    <button
      type="button"
      data-cp-link={id}
      className={`${linkButtonClass()} max-w-full text-left ${className}`}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        openContractorCard({ id }, tab);
      }}
    >
      {name}
    </button>
  );
}
