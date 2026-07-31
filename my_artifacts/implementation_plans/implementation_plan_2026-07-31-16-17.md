# План Имплементации: Стиль Тёплый "Primary" (Warm Minimal UI)

Данный план описывает внедрение нового стиля **Warm Minimal UI ("Primary")** в систему Buhuchet.kg в соответствии с предоставленным Техническим Заданием.

## 🎯 Цели и Задачи

1. **Точная настройка HSL CSS-переменных в `app/globals.css`** для светлой/теплой и темной темы.
2. **Интеграция акцентных тонов (Warm Pastel Accent Colors)** в Tailwind CSS и систему UI токенов (`--accent-blue`, `--accent-red`, `--accent-green`, `--accent-yellow`, `--accent-orange`).
3. **Обновление фундаментальных UI компонентов**:
   - `components/ui/button.tsx`
   - `components/ui/card.tsx`
   - `components/ui/input.tsx`
   - `components/ui/badge.tsx`
   - `components/ui/alert.tsx`
   - `components/ui/unified/UnifiedDataGrid.tsx`
   - `components/ui/unified/UnifiedFormModal.tsx`
4. **Типографика и скругления**:
   - Задание шрифтовой гарнитуры Inter & JetBrains Mono.
   - Использование радиусов `8px`, `12px`, `16px`.
   - Внедрение мыгких пастельных теней `rgba(90, 83, 77, 0.05..0.12)`.

---

## 🎨 Перевод палитры в HSL переменные Tailwind (`app/globals.css`)

### ☀️ Светлая / Тёплая тема (`data-theme="warm"` / `data-theme="light"`):
- `--background`: `40 25% 97.5%` (`#FAF9F6` - Тёплый белый)
- `--secondary`: `40 20% 95.3%` (`#F5F3EF` - Тёплый серый)
- `--tertiary`: `40 30% 90.8%` (`#EFEAE0`)
- `--card`: `0 0% 100%` (`#FFFFFF` - Чистый белый фон карточек)
- `--foreground`: `27 8% 32.7%` (`#5A534D` - Тёплый коричневый)
- `--muted-foreground`: `32 8% 50.8%` (`#8B8278` - Вторичный текст)
- `--border`: `40 18% 88.6%` (`#E8E4DC`)
- `--primary`: `207 30% 70%` (`#9DB5C9` - Приглушенный пастельный синий)
- `--accent-red`: `11 40% 71.8%` (`#D4A59A`)
- `--accent-green`: `100 16% 67.5%` (`#A8B8A0`)
- `--accent-yellow`: `37 50% 81.4%` (`#E8D5B7`)
- `--accent-orange`: `23 60% 75.7%` (`#E6B89C`)

### 🌙 Тёмная Тёплая тема (`data-theme="dark"`):
- `--background`: `30 7% 15.5%` (`#2B2825`)
- `--secondary`: `30 8% 19.2%` (`#35312D`)
- `--card`: `30 7% 22.4%` (`#3D3935`)
- `--foreground`: `40 18% 88.6%` (`#E8E4DC`)
- `--muted-foreground`: `30 7% 57.3%` (`#9A928A`)
- `--border`: `30 7% 25.5%` (`#45413C`)

---

## 🛠️ Предлагаемые Изменения по Компонентам

### 1. `app/globals.css` & `tailwind.config.ts`
- [NEW] Добавление пастельных акцентных тонов (`warm-red`, `warm-blue`, `warm-yellow`, `warm-green`, `warm-orange`) в конфигурацию Tailwind.
- [MODIFY] Настройка теней `--shadow-sm`, `--shadow-md`, `--shadow-lg` на основе палитры `#5A534D`.
- [MODIFY] Стилизация скроллбара под тёплые цвета (`--secondary-bg` и `--border-color`).

### 2. UI-компоненты
- [MODIFY] `components/ui/button.tsx`: Поддержка обновленных `primary`, `secondary`, `ghost` стилей со скруглением `8px` и переходами `transform: translateY(-1px)`.
- [MODIFY] `components/ui/card.tsx`: Применение радиуса `12px` (`rounded-xl`), бордеров `#F0ECE4` / `#45413C` и мягких теней.
- [MODIFY] `components/ui/input.tsx`: Настройка фокус-состояния с кольцом `rgba(157, 181, 201, 0.2)` (`--accent-blue`).
- [MODIFY] `components/ui/badge.tsx`: Адаптация матовых пастельных бейджей (`badge-primary`, `badge-success`, `badge-warning`, `badge-error`).

---

## 🧪 План Проверки и Тестирования

1. **Локальная сборка**: Выполнение `npm run build` для подтверждения отсутствия TypeScript и JSX ошибок.
2. **Проверка всех 3-х тем**: Переключение тем в интерфейсе (Dark, Light, Warm) и проверка контрастности текстов и элементов.
3. **Визуальная валидация**:
   - Формы и поля ввода (фокусы, подсветка ошибок).
   - Кнопки (hover/active эффекты).
   - Модальные окна и карточки.
