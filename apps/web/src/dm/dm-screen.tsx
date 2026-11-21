'use client';

import { useEffect, useEffectEvent } from 'react';
import { ModuleStub } from '../shell/module-stub';
import { useShell } from '../shell/context';
import { useDmAsk } from './ask-dialog';
import { CatalogTab } from './catalog-tab';
import { OutTab } from './out-tab';
import { useTokenActions } from './token-dialogs';
import { TokensTab } from './tokens-tab';

/**
 * «Витрина данных» (доработки 20.11.2026: Витрина данных; прототип v155 `renderDm`, `dmTabs`, `dmAdd`):
 * «Вывод» (этап 2, П6–П7), «Шаблоны» — у организации каталог, у Админки — список шаблонов (тред
 * сборки), «API Токены» (поток Т, этап 1, П14). «+ Добавить»: «Токен» и у организации «Попросить
 * шаблон»; на вкладке «API Токены» «Токен» открывает сама вкладка.
 */
export function DmScreen({ tab }: { tab: string }) {
  const { access, addRequest, clearAddRequest } = useShell();
  const side = access.admin ? 'admin' : 'org';
  const tokens = useTokenActions(side);
  const ask = useDmAsk();

  const request =
    addRequest?.moduleId === 'dm' && !(tab === 'tok' && addRequest.actionId === 'tok')
      ? addRequest
      : null;
  const start = useEffectEvent((actionId: string) => {
    if (actionId === 'tok') void tokens.issue();
    if (actionId === 'ask') ask.open();
  });
  useEffect(() => {
    if (!request) return;
    start(request.actionId);
    clearAddRequest();
  }, [request, clearAddRequest]);

  let body;
  if (tab === 'tok') body = <TokensTab side={side} />;
  else if (tab === 'tpl') {
    body = access.admin ? (
      <ModuleStub moduleId="dm" handleAdd={false} />
    ) : (
      <CatalogTab onAsk={ask.open} onToken={(id) => void tokens.issue(id)} />
    );
  } else body = <OutTab side={side} />;
  return (
    <>
      {body}
      {tab === 'tok' ? null : tokens.node}
      {ask.dialog}
    </>
  );
}
