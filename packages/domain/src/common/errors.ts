/**
 * Запись изменили после того, как пользователь её открыл: его версия устарела, сохранять поверх
 * нельзя (ТЗ «Общие правила для всей платформы»). API отвечает 409 `record_changed`, интерфейс
 * показывает «Запись изменена другим пользователем» и перечитывает запись.
 */
export class RecordChangedError extends Error {
  readonly code = 'record_changed';

  constructor(
    readonly entity: string,
    readonly id: string,
    /** Версия записи в базе сейчас. */
    readonly currentVersion: number,
  ) {
    super(`Запись изменена другим пользователем: ${entity} ${id}, версия ${currentVersion}`);
    this.name = 'RecordChangedError';
  }
}

/**
 * Записи нет — или она чужой организации и не видна (RLS): в обоих случаях ответ одинаковый,
 * чтобы не выдавать, что запись существует. API отвечает 404 `not_found`.
 */
export class RecordNotFoundError extends Error {
  readonly code = 'not_found';

  constructor(
    readonly entity: string,
    readonly id: string,
  ) {
    super(`Запись не найдена: ${entity} ${id}`);
    this.name = 'RecordNotFoundError';
  }
}
