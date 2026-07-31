# Implementation Plan - Редизайн FloatingTopbar (Темы & Время), Позиционирование MobileFAB (bottom-20) и Мобильный Drawer в DashboardShell

**Дата создания:** 2026-07-31 23:38  
**Статус:** Ожидает утверждения пользователя  

---

## 1. Редизайн Верхней Панели (`components/ui/FloatingTopbar.tsx`)
- Удаление наименования компании для освобождения центральной части под поиск.
- Встраивание 3 тем оформления (**Тёмная**, **Светлая**, **Тёплая**) в правый блок.
- Оснащение часов/даты флагом `mounted` для предотвращения Hydration Error #425.
- Настройка гамбургер-кнопки `Menu` на смартфонах.

---

## 2. Позиционирование Плавающей Кнопки (`components/ui/MobileFAB.tsx`)
- Позиционирование `bottom-20 right-4` (`bottom: 80px`) над нижней панелью навигации.
- В `app/dashboard/counterparties/page.tsx` длинная текстовая кнопка прячется на мобилках (`hidden md:inline-flex`), выводится `MobileFAB`.

---

## 3. Выездной Мобильный Сайдбар в Кабинете (`components/dashboard/DashboardShell.tsx`)
- Подключение состояния `isMobileMenuOpen` и выездного Drawer для мобильных экранов (`md:hidden fixed inset-0 z-50`).

---

## 4. План Валидации
1. Проверка типов и сборка `npm run build`.
2. Фиксация обновлений в Git (`git push origin main`).
