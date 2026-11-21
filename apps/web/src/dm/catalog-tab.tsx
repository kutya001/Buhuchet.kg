'use client';

import type { DmTemplateCard } from '@buhuchet/shared';
import { buttonClass, EmptyState, Icon, Note, Pill } from '@buhuchet/ui';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { ApiFailure } from '../api-client';
import { useErrorText, useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';
import { tabHref } from '../shell/modules';
import { outCatalogQuery } from './out-data';
import { catalogGroups } from './out-model';
import { setOutChoice } from './out-state';

/**
 * «Витрина данных» → «Шаблоны» организации (доработки 20.11.2026: Витрина данных, блок 3; прототип v155
 * `renderDmTpl`): пояснение с «Попросить шаблон», карточки шаблонов по модулям — описание, параметры,
 * столбцы, «Показать» (открывает шаблон во вкладке «Вывод») и «Выпустить токен» по праву «Управлять
 * API-токенами» (не в демо). Окна «Попросить шаблон» и «Новый API-токен» ставит экран модуля.
 */
export function CatalogTab({
  onAsk,
  onToken,
}: {
  onAsk: () => void;
  onToken: (templateId: string) => void;
}) {
  const t = useT();
  const errorText = useErrorText();
  const router = useRouter();
  const catalog = useQuery(outCatalogQuery('org'));
  if (catalog.isError) {
    const error = catalog.error instanceof ApiFailure ? catalog.error.error : null;
    return (
      <Note tone="bad" icon="alert">
        {error ? errorText(error) : t('grid.load_error')}
      </Note>
    );
  }
  if (!catalog.data) return null;
  const { items, canTokens } = catalog.data;
  const groups = catalogGroups(items);
  const show = (code: string) => {
    setOutChoice({ tpl: code, shown: null });
    router.push(tabHref('dm', 'out'));
  };

  return (
    <div className="flex flex-col" data-dm-catalog="">
      <div
        className="flex items-center gap-[9px] rounded-lg border border-line bg-pane-alt px-3 py-[9px] text-[12.5px] leading-[1.45] text-muted max-md:flex-wrap"
        data-dm-ask-note=""
      >
        <Icon name="info" className="shrink-0" />
        <span className="min-w-0 grow max-md:basis-[calc(100%-30px)]">
          {t(canTokens ? 'dm.cat.note_tok' : 'dm.cat.note')}
        </span>
        <button
          type="button"
          className={`${buttonClass('default', 'sm')} shrink-0 max-md:ml-7`}
          data-dm-ask-open=""
          onClick={onAsk}
        >
          <Icon name="send" size="sm" />
          {t('dm.cat.ask')}
        </button>
      </div>
      {groups.length ? (
        groups.map((g) => (
          <section key={g.module} data-dm-group={g.module}>
            <h3 className="mt-[18px] mb-2 flex items-baseline gap-2 text-[15px] font-[650] text-ink">
              {t(`dm.mod.${g.module}`)}
              <span className="font-normal text-faint">{g.items.length}</span>
            </h3>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(min(320px,100%),1fr))] gap-3">
              {g.items.map((x) => (
                <TemplateCard
                  key={x.code}
                  t={t}
                  tpl={x}
                  canTokens={canTokens}
                  onShow={() => show(x.code)}
                  onToken={() => onToken(x.id)}
                />
              ))}
            </div>
          </section>
        ))
      ) : (
        <div className="mt-3.5">
          <EmptyState icon="table" title={t('dm.cat.empty_title')} text={t('dm.cat.empty_text')} />
        </div>
      )}
    </div>
  );
}

/** Карточка шаблона (прототип `.dm-card`). */
function TemplateCard({
  t,
  tpl,
  canTokens,
  onShow,
  onToken,
}: {
  t: Translate;
  tpl: DmTemplateCard;
  canTokens: boolean;
  onShow: () => void;
  onToken: () => void;
}) {
  const params = tpl.params.length
    ? tpl.params.map((p) => p.name).join(', ')
    : t('dm.cat.params_none');
  return (
    <div
      className="flex min-w-0 flex-col gap-2 rounded-xl border border-line bg-raised px-4 py-3.5"
      data-dm-tpl-card={tpl.code}
    >
      <div className="flex items-start gap-2">
        <b className="min-w-0 grow font-semibold text-ink">{tpl.name}</b>
        {tpl.state === 'broken' ? (
          <Pill tone="bad" icon="alert">
            {t('dm.cat.broken')}
          </Pill>
        ) : null}
      </div>
      {tpl.description ? <span className="text-muted">{tpl.description}</span> : null}
      <span className="text-[12px] leading-[1.4] text-muted">
        {t('dm.cat.params', { list: params })}
        {tpl.needPermission === 'fee' ? ` · ${t('dm.cat.need_fee')}` : null}
      </span>
      <details>
        <summary className="cursor-pointer text-[13px] text-muted">
          {t('dm.cat.cols', { n: tpl.columns.length })}
        </summary>
        <ul className="mt-1.5 mb-0 list-disc pl-[18px] text-[13px] leading-[1.6]">
          {tpl.columns.map((c) => (
            <li key={c.code}>
              {c.name}{' '}
              <span className="text-faint">
                {t(`dm.ctype.${c.type}`)}
                {c.total ? `, ${t('dm.cat.total')}` : ''}
              </span>
            </li>
          ))}
        </ul>
      </details>
      <div className="mt-auto flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={buttonClass('cta', 'sm')}
          data-dm-show={tpl.code}
          onClick={onShow}
        >
          <Icon name="table" size="sm" />
          {t('dm.cat.show')}
        </button>
        {canTokens ? (
          <button
            type="button"
            className={buttonClass('default', 'sm')}
            data-dm-tok={tpl.code}
            onClick={onToken}
          >
            <Icon name="key" size="sm" />
            {t('dm.cat.token')}
          </button>
        ) : null}
      </div>
    </div>
  );
}
