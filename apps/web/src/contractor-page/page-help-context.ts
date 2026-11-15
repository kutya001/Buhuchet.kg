'use client';

import { CP_HELP_EMPTY, cpHelpFill, type CpHelpHintKey } from '@buhuchet/domain';
import type { CpHelpData } from '@buhuchet/shared';
import { createContext, useContext } from 'react';

/*
 * Тексты подсказок и обучения открытой страницы контрагента (доработки 15.11.2026; прототип v120
 * `KBUI.cpHelp`): приходят с сервера вместе со страницей (`page.help`), один набор для всех организаций,
 * ведёт администратор платформы.
 */

export const PageHelpContext = createContext<CpHelpData>(CP_HELP_EMPTY);

/** Тексты подсказок страницы целиком: «Добро пожаловать», облачка обзора, вопросы, «Словарик». */
export function usePageHelpTexts(): CpHelpData {
  return useContext(PageHelpContext);
}

/**
 * Подсказка в окне или подпись «Помощи» (прототип `cphT`): пустая — `fallback`; подстановки `{имя}`
 * (`cphFill`) — из `vars`.
 */
export function usePageHint(): (
  key: CpHelpHintKey,
  fallback?: string,
  vars?: Readonly<Record<string, string | number>>,
) => string {
  const help = useContext(PageHelpContext);
  return (key, fallback = '', vars) => {
    const text = help.hints[key];
    const value = text ? text : fallback;
    return vars ? cpHelpFill(value, vars) : value;
  };
}
