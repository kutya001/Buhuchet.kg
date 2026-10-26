'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { makeTranslate, type Translate } from './translate';

const TextsContext = createContext<Readonly<Record<string, string>>>({});

/**
 * Словарь текстов для экранов. Тексты приходят с сервера в первом же ответе страницы (корневой
 * макет), поэтому экран сразу показывается с готовыми текстами, без мигания ключей.
 */
export function L10nProvider({
  texts,
  children,
}: {
  texts: Readonly<Record<string, string>>;
  children: ReactNode;
}) {
  return <TextsContext.Provider value={texts}>{children}</TextsContext.Provider>;
}

/** `const t = useT(); t('health.title')` — текст интерфейса из словаря. */
export function useT(): Translate {
  const texts = useContext(TextsContext);
  return useMemo(() => makeTranslate(texts), [texts]);
}
