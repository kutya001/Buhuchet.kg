'use client';

import { fileSizeParts, LEAD_DOC_TEXT_KEYS, type UiTextKey } from '@buhuchet/domain';
import { FileLink, type AdminLeadCard, type AdminLeadDoc } from '@buhuchet/shared';
import { Box, buttonClass, Icon, KeyValues, Pill, useToast, type KeyValueItem } from '@buhuchet/ui';
import { useState } from 'react';
import { useErrorText } from '../l10n/provider';
import type { Translate } from '../l10n/translate';
import { leadDocsHint } from './lead-history';
import { leadDocLink } from './leads-data';

/*
 * Блок заявки с документами (доработки 14.11.2026, блок 1; прототип v114 modules/lead-docs.js —
 * ldCardBox, ldTgPill): данные из документов, как их проверил заявитель, «Telegram заявителя» и файлы с
 * «Открыть»; под ними — когда файлы удалятся, что они удалены по сроку или переданы организации.
 * Видит только администратор платформы (окно заявки — в Админке).
 */

const faint = <span className="text-faint">—</span>;
const mono = (v: string | null) => (v ? <span className="font-mono">{v}</span> : faint);

/** «Свидетельство ГНС · 1,2 МБ». */
function docMeta(t: Translate, d: AdminLeadDoc): string {
  const { value, unit } = fileSizeParts(d.size);
  return `${t(LEAD_DOC_TEXT_KEYS[d.kind] as UiTextKey)} · ${t(`files.size.${unit}`, { n: value })}`;
}

/**
 * «Telegram заявителя»: подключён (зелёная; в «Данных из документов» — с именем подключившего) или нет
 * (жёлтая) — прототип ldTgPill.
 */
export function LeadTgPill({ t, on, name }: { t: Translate; on: boolean; name?: string | null }) {
  return (
    <Pill tone={on ? 'ok' : 'warn'} size="sm" icon="tg">
      {t(on ? 'leads.tg.on' : 'leads.tg.off')}
      {on && name ? ` · ${name}` : null}
    </Pill>
  );
}

export function LeadDocsBox({ t, l }: { t: Translate; l: AdminLeadCard }) {
  const toast = useToast();
  const errorText = useErrorText();
  const [opening, setOpening] = useState<string | null>(null);
  if (!l.legalForm) return null;

  const items: KeyValueItem[] = [
    { id: 'form', label: t('leads.docs.form'), value: t(`land.f.form.${l.legalForm}`) },
    { id: 'firm', label: t('leads.docs.name'), value: l.firm },
    { id: 'inn', label: t('leads.docs.inn'), value: mono(l.inn) },
    { id: 'okpo', label: t('leads.docs.okpo'), value: mono(l.okpo) },
    { id: 'address', label: t('leads.docs.address'), value: l.address || faint },
    { id: 'head', label: t('leads.docs.head'), value: l.head || faint },
    {
      id: 'tg',
      label: t('leads.docs.tg'),
      value: <LeadTgPill t={t} on={l.tgLinked} name={l.tgName} />,
    },
  ];

  /**
   * «Открыть»: просмотр PDF в новой вкладке по ссылке на 15 минут. Вкладка открывается сразу по нажатию
   * (иначе её закроет блокировщик всплывающих окон), адрес ей ставится, когда придёт ссылка.
   */
  const open = async (d: AdminLeadDoc) => {
    if (d.pending) return toast(t('leads.docs.pending'), { icon: 'hourglass' });
    const tab = window.open('', '_blank');
    if (tab) tab.opener = null;
    setOpening(d.id);
    const res = await leadDocLink(l.id, d.id);
    setOpening(null);
    if (!res.ok) {
      tab?.close();
      return toast(errorText(res.error), { bad: true, icon: 'alert' });
    }
    const { url } = FileLink.parse(res.data);
    if (tab) tab.location.href = url;
    else window.open(url, '_blank', 'noopener,noreferrer');
  };

  const hint = leadDocsHint(t, l);
  return (
    <Box title={t('leads.docs.title')}>
      <div data-lead-docs="">
        <KeyValues items={items} />
      </div>
      <h4 className="m-0 mt-1 text-[13px] font-semibold text-ink">{t('leads.docs.files')}</h4>
      {l.docFiles.length ? (
        <ul className="m-0 flex list-none flex-col p-0">
          {l.docFiles.map((d) => (
            <li
              key={d.id}
              data-lead-doc={d.kind}
              className="flex min-w-0 items-center gap-2.5 border-b border-line px-0.5 py-[9px] last:border-b-0"
            >
              <Icon name="file" className="flex-none text-muted" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-semibold text-ink">{d.name}</div>
                <div className="truncate text-xs text-faint">{docMeta(t, d)}</div>
              </div>
              <button
                type="button"
                data-lead-doc-open=""
                className={buttonClass('default', 'sm')}
                disabled={opening === d.id}
                onClick={() => void open(d)}
              >
                <Icon name="eye" size="sm" />
                {t('leads.docs.open')}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {hint ? (
        <div data-lead-docs-hint="" className="text-[12px] leading-[1.4] text-muted">
          {hint}
        </div>
      ) : null}
    </Box>
  );
}
