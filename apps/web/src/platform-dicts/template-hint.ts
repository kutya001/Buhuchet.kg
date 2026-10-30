import type { AdminMessageTemplate } from '@buhuchet/shared';
import type { Translate } from '../l10n/translate';

/**
 * Подсказка под шаблоном (прототип admin/platform-dicts.js, TPL_NOTES): пояснение и «Подстановки:
 * {контрагент}, {сумма}»; у шаблона без подстановок — «Без подстановок».
 */
export function templateHint(
  t: Translate,
  x: Pick<AdminMessageTemplate, 'note' | 'variables'>,
): string {
  const vars = x.variables.length
    ? t('pdicts.tpl.vars', { list: x.variables.map((v) => `{${v}}`).join(', ') })
    : t('pdicts.tpl.no_vars');
  return x.note ? `${x.note}. ${vars}` : vars;
}

/**
 * Ошибка под полем на отказ сервера `unknown_vars` (прототип tplVarError): какие подстановки лишние и
 * какие доступны; у шаблона без подстановок — «В этом шаблоне подстановок нет».
 */
export function unknownVarsMessage(t: Translate, list: string, known: string): string {
  return known
    ? t('pdicts.err.unknown_vars', { list, known })
    : t('pdicts.err.unknown_vars_none', { list });
}
