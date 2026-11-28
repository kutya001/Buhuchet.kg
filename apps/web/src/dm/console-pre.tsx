'use client';

import { DM_CONSOLE_PRESETS } from '@buhuchet/domain';
import { buttonClass, Hint, Note } from '@buhuchet/ui';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../l10n/provider';
import { useShell } from '../shell/context';
import { consoleOpen } from './console-store';
import { systemTemplatesQuery } from './tpl-admin-data';

const LINK =
  'cursor-pointer border-0 bg-transparent p-0 text-left font-[inherit] text-accent hover:underline';

/**
 * «Заготовки» консоли (доработки 27.11.2026: консоль запросов, блок 4, пункт 1; этап 2, П8; прототип
 * v167 `dmcSide` `pre`): частые запросы и образцы конструкций — вкладка с запросом, месяц и дата по
 * умолчанию — сегодня (значение параметра без ввода, `paramValue` консоли); ниже — готовые шаблоны
 * платформы с «Открыть в консоли» (тот же путь, что у меню строки «Шаблонов»).
 */
export function PreSide({ onTemplate }: { onTemplate: (id: string) => void }) {
  const t = useT();
  const { userId } = useShell();
  const sys = useQuery(systemTemplatesQuery);
  const list = sys.data ?? [];
  return (
    <div className="flex flex-col" data-dm-con-pre="">
      <Hint>{t('dm.con.pre.text')}</Hint>
      {DM_CONSOLE_PRESETS.map((p) => (
        <div
          key={p.id}
          className="flex flex-col gap-0.5 border-b border-line py-1.5"
          data-dm-con-pre-row={p.id}
        >
          <button
            type="button"
            className={`${LINK} font-semibold`}
            onClick={() =>
              consoleOpen(userId ?? '', {
                sql: p.sql,
                name: t(`dm.con.pre.${p.id}`),
                src: 'pre',
              })
            }
          >
            {t(`dm.con.pre.${p.id}`)}
          </button>
          <span className="text-faint">{t(`dm.con.pre.${p.id}.d`)}</span>
        </div>
      ))}
      <div className="pt-2 pb-1 font-semibold" data-dm-con-pre-sys="">
        {t('dm.con.pre.sys', { n: list.length })}
      </div>
      {sys.isError ? <Note tone="bad">{t('grid.load_error')}</Note> : null}
      {list.map((x) => (
        <div
          key={x.id}
          className="flex flex-col gap-1 border-b border-line py-1.5"
          data-dm-con-pre-tpl={x.code}
        >
          <span>
            <b>{x.name}</b> <span className="text-faint">{t(`dm.tpl.kind.${x.audience}`)}</span>
          </span>
          <div>
            <button
              type="button"
              className={buttonClass('default', 'sm')}
              onClick={() => onTemplate(x.id)}
            >
              {t('dm.con.api.open')}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
