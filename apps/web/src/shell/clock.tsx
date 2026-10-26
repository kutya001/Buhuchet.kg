'use client';

import { bishkekDate, bishkekTime, formatDateRu } from '@buhuchet/domain';
import { useEffect, useState } from 'react';
import { useT } from '../l10n/provider';

/**
 * Дата и время по Бишкеку в верхней панели: ДД.ММ.ГГГГ ЧЧ:ММ, обновляются в начале каждой минуты; уже
 * 768 px — только ЧЧ:ММ (ТЗ «Верхняя панель»). Время — настоящее, по часам устройства.
 */
export function Clock({ initial }: { initial: number }) {
  const t = useT();
  // Первый показ — время сервера, тот же текст и в браузере, поэтому разметка совпадает.
  const [now, setNow] = useState(() => new Date(initial));

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    // Сразу после показа — часы устройства, дальше — в начале каждой минуты.
    const tick = (delay: number) => {
      timer = setTimeout(() => {
        setNow(new Date());
        tick(60_000 - (Date.now() % 60_000) + 50);
      }, delay);
    };
    tick(0);
    return () => clearTimeout(timer);
  }, []);

  const date = formatDateRu(bishkekDate(now));
  const time = bishkekTime(now);
  return (
    <span title={t('shell.clock_title', { date, time })}>
      <span className="mr-1.5 font-[450] text-faint max-md:hidden">{date}</span>
      <span>{time}</span>
    </span>
  );
}
