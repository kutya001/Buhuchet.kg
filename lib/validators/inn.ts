/**
 * Алгоритм валидации ИНН / ПИН Кыргызской Республики
 * 
 * Структура 14-значного номера:
 * - 1-й символ: 
 *   - 1: мужчина
 *   - 2: женщина
 *   - 0, 3, 4: юридические лица и филиалы
 * - 2..9 символы: Дата рождения / регистрации в формате ДДММГГГГ:
 *   - ДД: 01-31
 *   - ММ: 01-12
 *   - ГГГГ: корректный год (1900..2099)
 * - 10..13 символы: порядковый номер регистрации
 * - 14-й символ: контрольный разряд, вычисляемый по весовым коэффициентам ГНС КР.
 * 
 * Весовые коэффициенты для первых 13 цифр:
 * W1 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 1, 2, 3]
 * Контрольный разряд = (Сумма(d[i] * W1[i])) mod 11
 * Если остаток равен 10, то применяется второй ряд весовых коэффициентов:
 * W2 = [3, 4, 5, 6, 7, 8, 9, 10, 1, 2, 3, 4, 5]
 * Контрольный разряд = (Сумма(d[i] * W2[i])) mod 11
 * Если и во 2-м расчете остаток равен 10, контрольный разряд принимается равным 0.
 */

export interface InnValidationResult {
  isValid: boolean;
  error?: string;
  isLegalEntity?: boolean;
  birthOrRegDate?: Date;
}

const WEIGHTS_1 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 1, 2, 3];
const WEIGHTS_2 = [3, 4, 5, 6, 7, 8, 9, 10, 1, 2, 3, 4, 5];

export function validateKyrgyzINN(inn: string): InnValidationResult {
  if (!inn || typeof inn !== 'string') {
    return { isValid: false, error: 'ИНН не указан' };
  }

  const cleanInn = inn.trim();

  // 1. Длина и символы
  if (cleanInn.length !== 14 || !/^\d{14}$/.test(cleanInn)) {
    return { isValid: false, error: 'ИНН должен состоять строго из 14 цифр' };
  }

  const digits = cleanInn.split('').map(Number);
  const firstDigit = digits[0];

  // 2. Проверка первого разряда (1, 2 для физлиц, 0, 3, 4 для юрлиц/ИП/филиалов)
  const isLegalEntity = [0, 3, 4].includes(firstDigit);

  // 3. Проверка даты (символы 2-9 -> DDMMYYYY)
  const day = parseInt(cleanInn.slice(1, 3), 10);
  const month = parseInt(cleanInn.slice(3, 5), 10);
  const year = parseInt(cleanInn.slice(5, 9), 10);

  if (month < 1 || month > 12) {
    return { isValid: false, error: 'Некорректный месяц в дате ИНН (символы 4-5)' };
  }

  if (day < 1 || day > 31) {
    return { isValid: false, error: 'Некорректный день в дате ИНН (символы 2-3)' };
  }

  if (year < 1850 || year > 2100) {
    return { isValid: false, error: 'Некорректный год в дате ИНН (символы 6-9)' };
  }

  // Проверка календарной даты с учетом високосных годов
  const dateObj = new Date(year, month - 1, day);
  if (
    dateObj.getFullYear() !== year ||
    dateObj.getMonth() !== month - 1 ||
    dateObj.getDate() !== day
  ) {
    return { isValid: false, error: 'Календарная дата в ИНН не существует (например, 31 февраля)' };
  }

  // 4. Расчет контрольного разряда
  let sum1 = 0;
  for (let i = 0; i < 13; i++) {
    sum1 += digits[i] * WEIGHTS_1[i];
  }

  let checkDigit = sum1 % 11;

  if (checkDigit === 10) {
    let sum2 = 0;
    for (let i = 0; i < 13; i++) {
      sum2 += digits[i] * WEIGHTS_2[i];
    }
    checkDigit = sum2 % 11;
    if (checkDigit === 10) {
      checkDigit = 0;
    }
  }

  const actualLastDigit = digits[13];
  if (checkDigit !== actualLastDigit) {
    return {
      isValid: false,
      error: `Неверная контрольная сумма ИНН (ожидается ${checkDigit}, получено ${actualLastDigit})`,
      isLegalEntity,
      birthOrRegDate: dateObj,
    };
  }

  return {
    isValid: true,
    isLegalEntity,
    birthOrRegDate: dateObj,
  };
}

/**
 * Хелпер для Zod валидации ИНН
 */
export function isValidKyrgyzINN(inn: string): boolean {
  return validateKyrgyzINN(inn).isValid;
}
