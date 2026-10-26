'use client';

import { bishkekDate, bishkekTime, formatDateRu } from '@buhuchet/domain';
import { useEffect, useState } from 'react';
import { useT } from '../l10n/provider';

/**
 * Дата и время по Бишкеку в верхней панели: ДД.ММ.ГГГГ ЧЧ:ММ, обновляются в начале каждой минуты; уже
 * 768 px — только ЧЧ:ММ (ТЗ «Верхняя панель»). Время — настоящее, по часам устройства.
 */
export function Clock() {
  const t = useT();
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const next = () => {
      timer = setTimeout(
        () => {
          setNow(new Date());
          next();
        },
        60_000 - (Date.now() % 60_000) + 50,
      );
    };
    next();
    return () => clearTimeout(timer);
  }, []);

  const date = formatDateRu(bishkekDate(now));
  const time = bishkekTime(now);
  return (
    <span title={t('shell.clock_title', { date, time })} suppressHydrationWarning>
      <span className="mr-1.5 font-[450] text-faint max-md:hidden" suppressHydrationWarning>
        {date}
      </span>
      <span suppressHydrationWarning>{time}</span>
    </span>
  );
}
