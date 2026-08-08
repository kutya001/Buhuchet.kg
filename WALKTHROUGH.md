# WALKTHROUGH — Полный разбор архитектуры и функционала Buhuchet.kg

Данный документ содержит исчерпывающее техническое руководство по реализованным функциям, архитектуре Copy-on-Write (CoW), оптимизациям производительности и интерфейсам управления системой Buhuchet.kg.

---

## 1. Архитектура Copy-on-Write (CoW) и Реестр Файлов

### 1.1 Модель данных и миграция PostgreSQL
Файл миграции: [`supabase/migrations/20260809000011_copy_on_write_file_owners.sql`](file:///d:/%D0%A0%D0%B0%D0%B1%D0%BE%D1%87%D0%B8%D0%B9%20%D1%81%D1%82%D0%BE%D0%BB/Code%20Projects/Buhuchet.kg/supabase/migrations/20260809000011_copy_on_write_file_owners.sql)

В базу данных добавлена таблица `file_owners` для поддержки мультиарендной дедупликации объектов в Cloudflare R2:

```sql
CREATE TABLE public.file_owners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_id UUID NOT NULL REFERENCES public.files(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  is_original_creator BOOLEAN DEFAULT false,
  added_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT unique_file_company UNIQUE (file_id, company_id)
);

CREATE INDEX idx_file_owners_company_id ON public.file_owners(company_id);
CREATE INDEX idx_file_owners_file_id ON public.file_owners(file_id);
```

#### Каскадный триггер очистки осиротевших файлов (Orphaned Files)
При удалении связей тенантов из `file_owners` автоматически срабатывает триггер:

```sql
CREATE OR REPLACE FUNCTION public.cleanup_orphaned_files()
RETURNS TRIGGER AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.file_owners WHERE file_id = OLD.file_id) THEN
    DELETE FROM public.files WHERE id = OLD.file_id;
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trigger_cleanup_orphaned_files
AFTER DELETE ON public.file_owners
FOR EACH ROW
EXECUTE FUNCTION public.cleanup_orphaned_files();
```

---

### 1.2 Серверная бизнес-логика (Server Actions)
Модуль: [`app/dashboard/files/archive-actions.ts`](file:///d:/%D0%A0%D0%B0%D0%B1%D0%BE%D1%87%D0%B8%D0%B9%20%D1%81%D1%82%D0%BE%D0%BB/Code%20Projects/Buhuchet.kg/app/dashboard/files/archive-actions.ts)

* **`uploadLegalDocumentAction` & `uploadFileToArchiveAction`**:
  Создают запись в `files` и фиксируют первоначального владельца в `file_owners` с флагом `is_original_creator = true`.
* **`deleteDocumentFileAction`**:
  Открепляет текущую организацию из `file_owners`. Объект R2 стирается только в случае `count(file_owners) == 0`.
* **`updateDocumentFileAction` (Copy-on-Write)**:
  Если файл используется несколькими организациями (`count(file_owners) > 1`), при редактировании или замене скана создается изолированная физическая копия для редактирующего тенанта, оставляя оригинал неизменным для других участников.
* **`getComprehensiveFileRegistryAction`**:
  Возвращает файлы компании с флагами `isCoWShared` и `ownersCount` для отображения в интерфейсе.

---

## 2. Frontend UI / UX Компоненты

### 2.1 Drag & Drop Пакетный Загрузчик
Компонент: [`components/documents/MultiFileDropzone.tsx`](file:///d:/%D0%A0%D0%B0%D0%B1%D0%BE%D1%87%D0%B8%D0%B9%20%D1%81%D1%82%D0%BE%D0%BB/Code%20Projects/Buhuchet.kg/components/documents/MultiFileDropzone.tsx)
- Зона перетаскивания (Drag & Drop) с подсветкой и анимацией.
- Клиентское сжатие фото и изображений до 200 КБ перед загрузкой.
- Поддержка прямой фотосъемки с камеры смартфона (`capture="environment"`).

### 2.2 Реестр Облачных Файлов
Страница: [`app/dashboard/files/page.tsx`](file:///d:/%D0%A0%D0%B0%D0%B1%D0%BE%D1%87%D0%B8%D0%B9%20%D1%81%D1%82%D0%BE%D0%BB/Code%20Projects/Buhuchet.kg/app/dashboard/files/page.tsx)
- Интерактивный тумблер выбора источников и форматов.
- Баджи статуса владения **«Совместный (CoW)»** и **«Единоличное»**.

### 2.3 Мониторинг Хранилища R2 в Суперадминке
Страница: [`app/super-admin/files/page.tsx`](file:///d:/%D0%A0%D0%B0%D0%B1%D0%BE%D1%87%D0%B8%D0%B9%20%D1%81%D1%82%D0%BE%D0%BB/Code%20Projects/Buhuchet.kg/app/super-admin/files/page.tsx)
- Карточки метрик общего объема R2, сэкономленного места благодаря CoW-дедупликации и топа организаций по используемому объему.
- Таблица-инспектор физических файлов со списком всех организаций-владельцев.

---

## 3. Администрирование и Сброс Паролей

В модуле [`app/super-admin/actions.ts`](file:///d:/%D0%A0%D0%B0%D0%B1%D0%BE%D1%87%D0%B8%D0%B9%20%D1%81%D1%82%D0%BE%D0%BB/Code%20Projects/Buhuchet.kg/app/super-admin/actions.ts) и интерфейсе [`app/super-admin/page.tsx`](file:///d:/%D0%A0%D0%B0%D0%B1%D0%BE%D1%87%D0%B8%D0%B9%20%D1%81%D1%82%D0%BE%D0%BB/Code%20Projects/Buhuchet.kg/app/super-admin/page.tsx):
- Добавлен метод `resetUserPasswordAdminAction` с использованием `adminSupabase.auth.admin.updateUserById`.
- Интегрирована кнопка `🔑 Сброс пароля`, модальное окно с генератором устойчивых паролей и плашкой копирования `[ 📋 Скопировать ]`.

---

## 4. Оптимизация Производительности

1. **Параллелизация запросов (Promise.all)**: Устранен сетевой каскад (Waterfall) при загрузке данных страниц.
2. **Кэширование сессии (`React.cache`)**: Метод `getServerUserContext()` в `lib/auth/server-context.ts` обернут в `React.cache()`, исключая повторные запросы к Auth в рамках одного HTTP-запроса.
3. **Фильтрация статики в Middleware**: Проверка сессий пропускает статические графические и шрифтовые ресурсы (`svg|png|jpg|jpeg|gif|webp|ico|css|js|woff2?`).

---

## 5. Проверка Сборки и Деплой

- **TypeScript Checking**: `npx tsc --noEmit` — 0 ошибок.
- **Production Build**: `npm run build` — успешно сгенерированы все 24 страницы.
- **Git Repository**: Все изменения зафиксированы и отправлены в ветку `main`.
