-- ====================================================================
-- BUHUCHET.KG — CLEAN DATABASE SEED SCRIPT (10 COMPANIES & KUTMAN SUPERADMIN)
-- ====================================================================

-- 1. Полная очистка существующих таблиц
TRUNCATE public.companies, public.users, public.company_partnerships, public.counterparties, public.documents, public.document_files, public.file_categories, public.feature_flags CASCADE;

-- 2. Очистка пользователей в auth.users
DELETE FROM auth.users WHERE email LIKE '%@buhuchet.kg' OR email LIKE '%@%.kg';

-- 3. Создание 10 Организаций Кыргызской Республики
INSERT INTO public.companies (id, name, inn, industry, status, is_active, legal_address, director_name, email, phone)
VALUES 
  ('8772ba39-4358-41df-bc06-2b9f62f47f57', 'ОсОО "Кумтор Голд Компани"', '01203199810123', 'Горнодобывающая отрасль', 'active', true, 'г. Бишкек, ул. Ибраимова 24', 'Алмазов Болот', 'info@kumtor.kg', '+996312900700'),
  ('da3d6acd-83fc-46b8-ab84-0949281a4493', 'ОсОО "Народный Трейд"', '01502201010456', 'Ритейл / Торговля', 'active', true, 'г. Бишкек, пр. Чуй 150', 'Касымов Бакыт', 'trade@narodnyi.kg', '+996312600800'),
  ('ef59cac0-c937-4505-b3f1-e8f5e6543a63', 'ЗАО "Батыш Логистик"', '02008201510789', 'Транспорт и Логистика', 'active', true, 'г. Ош, ул. Ленина 45', 'Исаев Марат', 'logistics@batysh.kg', '+996322250900'),
  ('ed77a717-e476-46fd-9a92-f8a0fe56a7ac', 'ОсОО "Бишкек Софт"', '00501202010111', 'IT и Телеком', 'active', true, 'г. Бишкек, ул. Токтогула 125', 'Осмонов Азамат', 'contact@bishkeksoft.kg', '+996555112233'),
  ('c1111111-1111-1111-1111-111111111111', 'ОсОО "Чуй Строй Групп"', '01004201810222', 'Строительство', 'active', true, 'г. Кант, ул. Промышленная 12', 'Садыков Улан', 'build@chuy-stroy.kg', '+996313251122'),
  ('c2222222-2222-2222-2222-222222222222', 'ОсОО "Агро Азия"', '01809201210333', 'Прочее', 'active', true, 'г. Каракол, ул. Токтогула 88', 'Абдыраев Алмаз', 'agro@agro-asia.kg', '+996392253344'),
  ('c3333333-3333-3333-3333-333333333333', 'ОсОО "Джалал-Абад НПЗ"', '00207200510444', 'Производство', 'active', true, 'г. Джалал-Абад, ул. Заводская 5', 'Бекмуратов Нурбек', 'refinery@ja-npz.kg', '+996372254455'),
  ('c4444444-4444-4444-4444-444444444444', 'ОсОО "Фарма КР"', '02511201910555', 'Услуги / Консалтинг', 'active', true, 'г. Бишкек, ул. Ахунбаева 98', 'Жолдошева Айгуль', 'pharma@pharma.kg', '+996312556677'),
  ('c5555555-5555-5555-5555-555555555555', 'ОсОО "Азия Консалт"', '01101202110666', 'Услуги / Консалтинг', 'active', true, 'г. Бишкек, ул. Киевская 107', 'Мамытов Руслан', 'consult@asia-consult.kg', '+996312447788'),
  ('c6666666-6666-6666-6666-666666666666', 'ОсОО "Ош Текстиль"', '00805201710777', 'Производство', 'active', true, 'г. Ош, ул. Фабричная 14', 'Алиев Данияр', 'textile@osh-textile.kg', '+996322258899');

-- 4. Создание учетных записей в auth.users
INSERT INTO auth.users (id, instance_id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, role, aud)
VALUES 
  ('c0ca9a1d-76d5-4f34-8ff8-0d865c2036e5', '00000000-0000-0000-0000-000000000000', 'admin@buhuchet.kg', crypt('SuperAdmin2026!', gen_salt('bf')), NOW(), '{"provider":"email","providers":["email"]}', '{"full_name":"Kutman"}', NOW(), NOW(), 'authenticated', 'authenticated'),
  ('cfd17a65-4a6f-4241-ab57-a260ee45d1de', '00000000-0000-0000-0000-000000000000', 'owner@buhuchet.kg', crypt('OwnerPassword123!', gen_salt('bf')), NOW(), '{"provider":"email","providers":["email"]}', '{"full_name":"Алмазов Болот"}', NOW(), NOW(), 'authenticated', 'authenticated'),
  ('5b25c9aa-6f88-4a3c-b24b-d2c35971e072', '00000000-0000-0000-0000-000000000000', 'manager@buhuchet.kg', crypt('ManagerPassword123!', gen_salt('bf')), NOW(), '{"provider":"email","providers":["email"]}', '{"full_name":"Касымов Бакыт"}', NOW(), NOW(), 'authenticated', 'authenticated'),
  ('a1111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'batysh@buhuchet.kg', crypt('Batysh2026!', gen_salt('bf')), NOW(), '{"provider":"email","providers":["email"]}', '{"full_name":"Исаев Марат"}', NOW(), NOW(), 'authenticated', 'authenticated'),
  ('a2222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000', 'bishkeksoft@buhuchet.kg', crypt('Bishkeksoft2026!', gen_salt('bf')), NOW(), '{"provider":"email","providers":["email"]}', '{"full_name":"Осмонов Азамат"}', NOW(), NOW(), 'authenticated', 'authenticated'),
  ('d1111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'chuystroy@buhuchet.kg', crypt('Company2026!', gen_salt('bf')), NOW(), '{"provider":"email","providers":["email"]}', '{"full_name":"Садыков Улан"}', NOW(), NOW(), 'authenticated', 'authenticated'),
  ('d2222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000', 'agroasia@buhuchet.kg', crypt('Company2026!', gen_salt('bf')), NOW(), '{"provider":"email","providers":["email"]}', '{"full_name":"Абдыраев Алмаз"}', NOW(), NOW(), 'authenticated', 'authenticated'),
  ('d3333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000000', 'janpz@buhuchet.kg', crypt('Company2026!', gen_salt('bf')), NOW(), '{"provider":"email","providers":["email"]}', '{"full_name":"Бекмуратов Нурбек"}', NOW(), NOW(), 'authenticated', 'authenticated'),
  ('d4444444-4444-4444-4444-444444444444', '00000000-0000-0000-0000-000000000000', 'pharma@buhuchet.kg', crypt('Company2026!', gen_salt('bf')), NOW(), '{"provider":"email","providers":["email"]}', '{"full_name":"Жолдошева Айгуль"}', NOW(), NOW(), 'authenticated', 'authenticated'),
  ('d5555555-5555-5555-5555-555555555555', '00000000-0000-0000-0000-000000000000', 'asiaconsult@buhuchet.kg', crypt('Company2026!', gen_salt('bf')), NOW(), '{"provider":"email","providers":["email"]}', '{"full_name":"Мамытов Руслан"}', NOW(), NOW(), 'authenticated', 'authenticated'),
  ('d6666666-6666-6666-6666-666666666666', '00000000-0000-0000-0000-000000000000', 'oshtextile@buhuchet.kg', crypt('Company2026!', gen_salt('bf')), NOW(), '{"provider":"email","providers":["email"]}', '{"full_name":"Алиев Данияр"}', NOW(), NOW(), 'authenticated', 'authenticated')
ON CONFLICT (id) DO NOTHING;

-- 5. Привязка пользователей в public.users
INSERT INTO public.users (id, email, full_name, role, is_super_admin, company_id)
VALUES 
  ('c0ca9a1d-76d5-4f34-8ff8-0d865c2036e5', 'admin@buhuchet.kg', 'Kutman', 'owner', true, NULL),
  ('cfd17a65-4a6f-4241-ab57-a260ee45d1de', 'owner@buhuchet.kg', 'Алмазов Болот (Владелец Кумтор)', 'owner', false, '8772ba39-4358-41df-bc06-2b9f62f47f57'),
  ('5b25c9aa-6f88-4a3c-b24b-d2c35971e072', 'manager@buhuchet.kg', 'Касымов Бакыт (Владелец Народный)', 'owner', false, 'da3d6acd-83fc-46b8-ab84-0949281a4493'),
  ('a1111111-1111-1111-1111-111111111111', 'batysh@buhuchet.kg', 'Исаев Марат (Владелец Батыш)', 'owner', false, 'ef59cac0-c937-4505-b3f1-e8f5e6543a63'),
  ('a2222222-2222-2222-2222-222222222222', 'bishkeksoft@buhuchet.kg', 'Осмонов Азамат (Владелец Софт)', 'owner', false, 'ed77a717-e476-46fd-9a92-f8a0fe56a7ac'),
  ('d1111111-1111-1111-1111-111111111111', 'chuystroy@buhuchet.kg', 'Садыков Улан (Владелец Чуй Строй)', 'owner', false, 'c1111111-1111-1111-1111-111111111111'),
  ('d2222222-2222-2222-2222-222222222222', 'agroasia@buhuchet.kg', 'Абдыраев Алмаз (Владелец Агро Азия)', 'owner', false, 'c2222222-2222-2222-2222-222222222222'),
  ('d3333333-3333-3333-3333-333333333333', 'janpz@buhuchet.kg', 'Бекмуратов Нурбек (Владелец НПЗ)', 'owner', false, 'c3333333-3333-3333-3333-333333333333'),
  ('d4444444-4444-4444-4444-444444444444', 'pharma@buhuchet.kg', 'Жолдошева Айгуль (Владелец Фарма)', 'owner', false, 'c4444444-4444-4444-4444-444444444444'),
  ('d5555555-5555-5555-5555-555555555555', 'asiaconsult@buhuchet.kg', 'Мамытов Руслан (Владелец Консалт)', 'owner', false, 'c5555555-5555-5555-5555-555555555555'),
  ('d6666666-6666-6666-6666-666666666666', 'oshtextile@buhuchet.kg', 'Алиев Данияр (Владелец Ош Текстиль)', 'owner', false, 'c6666666-6666-6666-6666-666666666666')
ON CONFLICT (id) DO UPDATE SET
  company_id = EXCLUDED.company_id,
  role = 'owner';

-- 6. Настройка подтвержденных B2B партнерств
INSERT INTO public.company_partnerships (requester_company_id, target_company_id, status)
VALUES
  ('8772ba39-4358-41df-bc06-2b9f62f47f57', 'da3d6acd-83fc-46b8-ab84-0949281a4493', 'approved'),
  ('8772ba39-4358-41df-bc06-2b9f62f47f57', 'ef59cac0-c937-4505-b3f1-e8f5e6543a63', 'approved'),
  ('da3d6acd-83fc-46b8-ab84-0949281a4493', 'ed77a717-e476-46fd-9a92-f8a0fe56a7ac', 'approved'),
  ('ef59cac0-c937-4505-b3f1-e8f5e6543a63', 'c1111111-1111-1111-1111-111111111111', 'approved'),
  ('ed77a717-e476-46fd-9a92-f8a0fe56a7ac', 'c5555555-5555-5555-5555-555555555555', 'approved'),
  ('c2222222-2222-2222-2222-222222222222', 'da3d6acd-83fc-46b8-ab84-0949281a4493', 'approved'),
  ('c3333333-3333-3333-3333-333333333333', 'ef59cac0-c937-4505-b3f1-e8f5e6543a63', 'approved'),
  ('c4444444-4444-4444-4444-444444444444', 'c5555555-5555-5555-5555-555555555555', 'approved'),
  ('c6666666-6666-6666-6666-666666666666', 'ef59cac0-c937-4505-b3f1-e8f5e6543a63', 'approved');

-- 7. Синхронизация Counterparties для каждой компании
INSERT INTO public.counterparties (company_id, name, inn, is_vat_payer, phone, email, comment)
SELECT 
  cp.requester_company_id AS company_id,
  c.name,
  c.inn,
  true,
  c.phone,
  c.email,
  'Подтвержденный партнер B2B платформы'
FROM public.company_partnerships cp
JOIN public.companies c ON cp.target_company_id = c.id
WHERE cp.status = 'approved';

INSERT INTO public.counterparties (company_id, name, inn, is_vat_payer, phone, email, comment)
SELECT 
  cp.target_company_id AS company_id,
  c.name,
  c.inn,
  true,
  c.phone,
  c.email,
  'Подтвержденный партнер B2B платформы'
FROM public.company_partnerships cp
JOIN public.companies c ON cp.requester_company_id = c.id
WHERE cp.status = 'approved';

-- 8. Категории файлов
INSERT INTO public.file_categories (name, description, icon, is_active)
VALUES 
  ('Товарные накладные', 'Первичные товарно-транспортные накладные и чеки', 'FileText', true),
  ('Акты выполненных работ', 'Акты приема-передачи оказанных услуг и работ', 'CheckSquare', true),
  ('Устав компании', 'Учредительный документ (Устав / Учредительный договор)', 'Shield', true),
  ('Свидетельство ЮЛ', 'Свидетельство о государственной регистрации ЮЛ в МЮ КР', 'Building2', true),
  ('Паспорт руководителя', 'Сканы паспорта генерального директора / руководителя', 'User', true),
  ('Справка ГНС / Соцфонд', 'Справка об отсутствии задолженности из ГНС и Соцфонда КР', 'File', true),
  ('Личный архив', 'Внутренние сканы и первичные документы организации', 'Folder', true);

-- 9. Флаги функционала (Feature Flags)
INSERT INTO public.feature_flags (key, title, description, is_enabled)
VALUES
  ('r2_upload_enabled', 'Облачная загрузка Cloudflare R2', 'Включение прямой передачи сканов первички в Cloudflare R2', true),
  ('camera_capture_enabled', 'Съёмка с камеры смартфона', 'Прямой вызов нативной камеры устройств', true),
  ('super_admin_moderation', 'Модерация организаций Суперадмином', 'Обязательная проверка реквизитов компаний', true);

NOTIFY pgrst, 'reload schema';
