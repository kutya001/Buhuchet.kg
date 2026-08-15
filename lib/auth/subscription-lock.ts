import { createAdminClient } from '@/lib/supabase/server';
import type { Company, Subscription, LandingPricingPlan } from '@/types/database.types';

export interface CompanyEffectiveLimits {
  companyId: string;
  companyName: string;
  planId: string;
  planName: string;
  
  // Квоты
  maxCounterparties: number;
  maxEmployees: number;
  storageLimitBytes: number;
  storageLimitGb: number;
  isTelegramEnabled: boolean;
  isCustomOverridden: boolean;

  // Фактическое использование
  counterpartiesCount: number;
  employeesCount: number;
  storageUsedBytes: number;
  storageUsedMb: number;

  // Проценты использования (0-100)
  counterpartiesUsagePercent: number;
  employeesUsagePercent: number;
  storageUsagePercent: number;

  // Статус подписки
  subscriptionStatus: 'active' | 'trial' | 'expired';
  expiresAt: string | null;
  daysRemaining: number;
  isExpired: boolean;
  isExpiringSoon: boolean; // <= 2 дней
}

/**
 * Получение эффективных лимитов, квот и текущего использования ресурсов компании
 */
export async function getCompanyEffectiveLimits(companyId: string): Promise<CompanyEffectiveLimits> {
  const adminSupabase = await createAdminClient();

  // Параллельная выборка профиля компании, подписки, файлов, сотрудников и контрагентов
  const [companyRes, subRes, filesRes, employeesRes, counterpartiesRes, plansRes] = await Promise.all([
    adminSupabase
      .from('companies')
      .select('*')
      .eq('id', companyId)
      .single(),
    adminSupabase
      .from('subscriptions')
      .select('*')
      .eq('company_id', companyId)
      .maybeSingle(),
    adminSupabase
      .from('files')
      .select('size_bytes')
      .eq('company_id', companyId),
    adminSupabase
      .from('users')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', companyId)
      .eq('is_active', true),
    adminSupabase
      .from('counterparties')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', companyId),
    adminSupabase
      .from('landing_pricing_plans')
      .select('*'),
  ]);

  const company = (companyRes.data || {}) as Company;
  const subscription = subRes.data as Subscription | null;
  const allPlans = (plansRes.data || []) as LandingPricingPlan[];

  const planType = subscription?.plan_type || 'start';
  const plan = allPlans.find((p) => p.id === planType) || allPlans[0] || {
    id: 'start',
    name: 'Старт',
    max_counterparties: 10,
    max_employees: 3,
    storage_limit_bytes: 1073741824, // 1 GB
    is_telegram_enabled: false,
  };

  // Фактическое использование
  const filesList = filesRes.data || [];
  const storageUsedBytes = filesList.reduce((acc, f) => acc + (Number(f.size_bytes) || 0), 0);
  const employeesCount = employeesRes.count || 0;
  const counterpartiesCount = counterpartiesRes.count || 0;

  // Эффективные лимиты с учетом ручных оверрайдов суперадмина
  const maxCounterparties = company.custom_max_counterparties ?? plan.max_counterparties ?? 10;
  const maxEmployees = company.custom_max_employees ?? plan.max_employees ?? 3;
  const storageLimitBytes = company.custom_storage_limit_bytes ?? plan.storage_limit_bytes ?? ((company.storage_limit_gb || 1) * 1024 * 1024 * 1024);
  const isTelegramEnabled = company.custom_telegram_enabled ?? Boolean(plan.is_telegram_enabled);
  const isCustomOverridden = (
    company.custom_max_counterparties !== null ||
    company.custom_max_employees !== null ||
    company.custom_storage_limit_bytes !== null ||
    company.custom_telegram_enabled !== null
  );

  // Определение срока действия
  const now = new Date();
  const expiresAt = subscription?.expires_at || null;
  let isExpired = false;
  let daysRemaining = 0;

  if (expiresAt) {
    const expDate = new Date(expiresAt);
    const diffMs = expDate.getTime() - now.getTime();
    daysRemaining = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
    isExpired = diffMs < 0;
  } else {
    isExpired = subscription?.status === 'expired';
  }

  const isExpiringSoon = !isExpired && daysRemaining <= 2 && daysRemaining >= 0;

  const subscriptionStatus: 'active' | 'trial' | 'expired' = isExpired
    ? 'expired'
    : (subscription?.status === 'trial' ? 'trial' : 'active');

  return {
    companyId,
    companyName: company.name || 'Организация',
    planId: plan.id,
    planName: plan.name || 'Стандарт',
    maxCounterparties,
    maxEmployees,
    storageLimitBytes,
    storageLimitGb: Math.round((storageLimitBytes / (1024 * 1024 * 1024)) * 10) / 10,
    isTelegramEnabled,
    isCustomOverridden,
    counterpartiesCount,
    employeesCount,
    storageUsedBytes,
    storageUsedMb: Math.round((storageUsedBytes / (1024 * 1024)) * 10) / 10,
    counterpartiesUsagePercent: Math.min(100, Math.round((counterpartiesCount / Math.max(1, maxCounterparties)) * 100)),
    employeesUsagePercent: Math.min(100, Math.round((employeesCount / Math.max(1, maxEmployees)) * 100)),
    storageUsagePercent: Math.min(100, Math.round((storageUsedBytes / Math.max(1, storageLimitBytes)) * 100)),
    subscriptionStatus,
    expiresAt,
    daysRemaining,
    isExpired,
    isExpiringSoon,
  };
}

/**
 * Валидатор: Проверка активности подписки
 */
export async function assertSubscriptionActive(companyId: string): Promise<void> {
  const limits = await getCompanyEffectiveLimits(companyId);
  if (limits.isExpired) {
    throw new Error('Срок действия подписки организации истек. Пожалуйста, подайте заявку на продление в разделе «Подписка».');
  }
}

/**
 * Валидатор: Проверка лимита добавления контрагентов
 */
export async function assertCanAddCounterparty(companyId: string): Promise<void> {
  const limits = await getCompanyEffectiveLimits(companyId);
  if (limits.isExpired) {
    throw new Error('Срок действия подписки истек. Продлите тариф для работы с контрагентами.');
  }
  if (limits.counterpartiesCount >= limits.maxCounterparties) {
    throw new Error(
      `Достигнут лимит контрагентов по вашему тарифу (${limits.counterpartiesCount} из ${limits.maxCounterparties}). Подайте заявку на повышение тарифа в разделе «Подписка».`
    );
  }
}

/**
 * Валидатор: Проверка лимита добавления сотрудников в штат
 */
export async function assertCanAddEmployee(companyId: string): Promise<void> {
  const limits = await getCompanyEffectiveLimits(companyId);
  if (limits.isExpired) {
    throw new Error('Срок действия подписки истек. Продлите тариф для управления штатом.');
  }
  if (limits.employeesCount >= limits.maxEmployees) {
    throw new Error(
      `Достигнут лимит сотрудников по вашему тарифу (${limits.employeesCount} из ${limits.maxEmployees}). Перейдите на тариф с большим количеством мест в разделе «Подписка».`
    );
  }
}

/**
 * Валидатор: Проверка разрешения на использование Telegram-бота
 */
export async function assertCanUseTelegram(companyId: string): Promise<void> {
  const limits = await getCompanyEffectiveLimits(companyId);
  if (limits.isExpired) {
    throw new Error('Срок действия подписки истек. Продлите тариф для получения Telegram-оповещений.');
  }
  if (!limits.isTelegramEnabled) {
    throw new Error(
      'Уведомления Telegram недоступны на текущем тарифе. Пожалуйста, выберите тариф «Бизнес» или «Премиум» в разделе «Подписка».'
    );
  }
}

/**
 * Валидатор: Проверка доступного места на Облачном диске
 */
export async function assertCanUploadFile(companyId: string, fileSizeBytes: number): Promise<void> {
  const limits = await getCompanyEffectiveLimits(companyId);
  if (limits.isExpired) {
    throw new Error('Срок действия подписки истек. Продлите тариф для загрузки новых файлов.');
  }
  if (limits.storageUsedBytes + fileSizeBytes > limits.storageLimitBytes) {
    const freeMb = Math.max(0, Math.round(((limits.storageLimitBytes - limits.storageUsedBytes) / (1024 * 1024)) * 10) / 10);
    const requiredMb = Math.round((fileSizeBytes / (1024 * 1024)) * 10) / 10;
    throw new Error(
      `Недостаточно свободного места на Облачном диске. Требуется: ${requiredMb} МБ, свободно: ${freeMb} МБ. Перейдите на расширенный тариф в разделе «Подписка».`
    );
  }
}
