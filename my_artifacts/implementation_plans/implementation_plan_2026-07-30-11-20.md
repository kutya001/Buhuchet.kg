# Implementation Plan — Полное Удаление Устаревших Модулей (Номенклатура, MockDropzone, MobileBottomNav) и Повторный Глубокий Код-Ревью

В этом плане описывается полная очистка проекта от устаревших неиспользуемых модулей ("Номенклатура", моковый `MockDropzone`, старый `MobileBottomNav`, роут `lookups`) и проведение финального глубокого код-ревью всей кодовой базы.

## User Review Required

> [!IMPORTANT]
> - **Удаление устаревших роутов и типов:**
>   1. Полное удаление директории `app/dashboard/nomenclature/` (`page.tsx`, `actions.ts`) и типов `types/nomenclature.types.ts`.
>   2. Удаление устаревшего роута `app/dashboard/lookups/` (`page.tsx`).
> - **Удаление неиспользуемых компонентов UI:**
>   1. Удаление `components/documents/MockDropzone.tsx` (заменен на `MultiFileDropzone.tsx` с Cloudflare R2).
>   2. Удаление `components/ui/MobileBottomNav.tsx` (заменен на `FloatingBottomNav.tsx`).

---

## Proposed Changes

### 1. Удаление Неиспользуемых Файлов и Модулей

#### [DELETE] [app/dashboard/nomenclature/page.tsx](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/app/dashboard/nomenclature/page.tsx)
#### [DELETE] [app/dashboard/nomenclature/actions.ts](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/app/dashboard/nomenclature/actions.ts)
#### [DELETE] [types/nomenclature.types.ts](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/types/nomenclature.types.ts)
#### [DELETE] [app/dashboard/lookups/page.tsx](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/app/dashboard/lookups/page.tsx)
#### [DELETE] [components/documents/MockDropzone.tsx](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/components/documents/MockDropzone.tsx)
#### [DELETE] [components/ui/MobileBottomNav.tsx](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/components/ui/MobileBottomNav.tsx)

### 2. Чистка Импортов и Упоминаний
#### [MODIFY] [super-admin/actions.ts](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/app/super-admin/actions.ts)
- Удаление упоминания `nomenclature` из разрешённых таблиц инспектора БД Supabase (или замена на `document_files` / `company_partnerships`).

---

## Verification Plan

### Automated Verification
1. Проверка типов TypeScript: `npx tsc --noEmit`
2. Продашкн сборка Next.js: `npm run build`

### Deep Code Review
1. Проведение глубокого и подробного анализа всей кодовой базы по 5 ключевым критериям.
