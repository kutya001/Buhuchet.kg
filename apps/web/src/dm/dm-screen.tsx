'use client';

import { useEffect, useEffectEvent } from 'react';
import { useShell } from '../shell/context';
import { useDmAsk } from './ask-dialog';
import { CatalogTab } from './catalog-tab';
import { OutTab } from './out-tab';
import { RequestsTab } from './requests-tab';
import { useTokenActions } from './token-dialogs';
import { TokensTab } from './tokens-tab';
import { useTemplateActions } from './tpl-actions';
import { TemplatesAdminTab } from './tpl-admin-tab';

/**
 * «Витрина данных» (доработки 20.11.2026: Витрина данных; прототип v155 `renderDm`, `dmTabs`, `dmAdd`):
 * «Вывод» (этап 2, П6–П7), «Шаблоны» — у организации каталог, у Админки — список шаблонов с окном
 * шаблона (этап 2, П7; методы — тред сборки, П3), «API Токены» (поток Т, этап 1, П14), у Админки
 * «Журнал запросов» (поток Т, этап 2, П11). «+ Добавить»:
 * у Админки «Шаблон» и «Токен», у организации «Токен» и «Попросить шаблон»; на вкладке «API Токены»
 * «Токен» открывает сама вкладка.
 */
export function DmScreen({ tab }: { tab: string }) {
  const { access, addRequest, clearAddRequest } = useShell();
  const side = access.admin ? 'admin' : 'org';
  const tokens = useTokenActions(side);
  const ask = useDmAsk();
  const templates = useTemplateActions();

  const request =
    addRequest?.moduleId === 'dm' && !(tab === 'tok' && addRequest.actionId === 'tok')
      ? addRequest
      : null;
  const start = useEffectEvent((actionId: string) => {
    if (actionId === 'tok') void tokens.issue();
    if (actionId === 'ask') ask.open();
    if (actionId === 'tpl' && access.admin) void templates.create();
  });
  useEffect(() => {
    if (!request) return;
    start(request.actionId);
    clearAddRequest();
  }, [request, clearAddRequest]);

  let body;
  if (tab === 'tok') body = <TokensTab side={side} />;
  else if (tab === 'log' && access.admin) body = <RequestsTab />;
  else if (tab === 'tpl') {
    body = access.admin ? (
      <TemplatesAdminTab />
    ) : (
      <CatalogTab onAsk={ask.open} onToken={(id) => void tokens.issue(id)} />
    );
  } else body = <OutTab side={side} />;
  return (
    <>
      {body}
      {tab === 'tok' ? null : tokens.node}
      {ask.dialog}
      {templates.node}
    </>
  );
}
