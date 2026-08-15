'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Send,
  RefreshCw,
  CheckCircle2,
  Loader2,
  Unlink,
  User,
  Building2,
  Key,
  ListFilter,
  MessageSquare,
  BellRing,
  ExternalLink,
  ShieldCheck,
  AlertCircle,
} from 'lucide-react';
import {
  getTelegramAdminStatsAction,
  testTelegramBotHealthAdminAction,
  forceSetTelegramWebhookAdminAction,
  sendAdminTestTelegramMessageAction,
  disconnectUserTelegramAdminAction,
  type TelegramAdminStatsData,
  type TelegramBotHealthData,
} from '@/app/super-admin/telegram-actions';
import { UnifiedDataGrid, ColumnDef } from '@/components/ui/unified/UnifiedDataGrid';
import { UnifiedWorkspaceLayout } from '@/components/ui/unified/UnifiedWorkspaceLayout';
import { toast } from 'sonner';

export default function SuperAdminTelegramPage() {
  const [subTab, setSubTab] = useState<'connections' | 'codes' | 'logs'>('connections');
  const [loading, setLoading] = useState(true);
  const [healthLoading, setHealthLoading] = useState(false);
  const [settingWebhook, setSettingWebhook] = useState(false);
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null);

  const [stats, setStats] = useState<TelegramAdminStatsData | null>(null);
  const [health, setHealth] = useState<TelegramBotHealthData | null>(null);

  // Ручная отправка пинга
  const [testChatId, setTestChatId] = useState('');
  const [testText, setTestText] = useState('Проверочное уведомление системы Buhuchet.kg');
  const [sendingTest, setSendingTest] = useState(false);

  const loadStats = async () => {
    setLoading(true);
    const res = await getTelegramAdminStatsAction();
    if (res.success && res.data) {
      setStats(res.data);
    } else {
      toast.error(res.error || 'Ошибка загрузки статистики Telegram');
    }
    setLoading(false);
  };

  const loadHealth = async () => {
    setHealthLoading(true);
    const res = await testTelegramBotHealthAdminAction();
    if (res.success && res.data) {
      setHealth(res.data);
    } else {
      toast.error(res.error || 'Сбой проверки Webhook и Bot API');
    }
    setHealthLoading(false);
  };

  useEffect(() => {
    loadStats();
    loadHealth();
  }, []);

  const handleForceWebhook = async () => {
    setSettingWebhook(true);
    const res = await forceSetTelegramWebhookAdminAction();
    if (res.success && res.data) {
      toast.success(`Webhook успешно зафиксирован: ${res.data.webhookUrl}`);
      await loadHealth();
    } else {
      toast.error(res.error || 'Не удалось зарегистрировать Webhook');
    }
    setSettingWebhook(false);
  };

  const handleDisconnect = async (id: string) => {
    if (!confirm('Вы уверены, что хотите отвязать этот Telegram-аккаунт?')) return;

    setDisconnectingId(id);
    const res = await disconnectUserTelegramAdminAction(id);
    if (res.success) {
      toast.success('Связь с Telegram успешно удалена');
      await loadStats();
    } else {
      toast.error(res.error || 'Ошибка отвязки аккаунта');
    }
    setDisconnectingId(null);
  };

  const handleSendTest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!testChatId) return;
    setSendingTest(true);
    const res = await sendAdminTestTelegramMessageAction(Number(testChatId), testText);
    if (res.success) {
      toast.success(`Тестовое сообщение успешно отправлено в Chat ID: ${testChatId}`);
      await loadStats();
    } else {
      toast.error(res.error || 'Сбой отправки тестового сообщения');
    }
    setSendingTest(false);
  };

  // 1. КОЛОНКИ: Привязанные Аккаунты
  const connectionColumns: ColumnDef<any>[] = useMemo(
    () => [
      {
        key: 'user',
        label: 'Пользователь',
        sortable: true,
        getValue: (c) => c.user_full_name,
        render: (c) => (
          <div>
            <div className="font-bold text-foreground text-xs">{c.user_full_name}</div>
            <div className="text-[11px] text-muted-foreground">{c.user_email}</div>
          </div>
        ),
      },
      {
        key: 'company',
        label: 'Организация / ИНН',
        sortable: true,
        getValue: (c) => c.company_name,
        render: (c) => (
          <div>
            <div className="font-semibold text-foreground text-xs flex items-center">
              <Building2 className="h-3 w-3 mr-1 text-amber-400" />
              {c.company_name}
            </div>
            <div className="text-[11px] font-mono text-muted-foreground">ИНН: {c.company_inn}</div>
          </div>
        ),
      },
      {
        key: 'username',
        label: 'Telegram Username',
        sortable: true,
        getValue: (c) => c.telegram_username,
        render: (c) =>
          c.telegram_username ? (
            <a
              href={`https://t.me/${c.telegram_username}`}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-sky-400 font-mono font-semibold hover:underline inline-flex items-center"
            >
              @{c.telegram_username}
              <ExternalLink className="h-2.5 w-2.5 ml-1" />
            </a>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          ),
      },
      {
        key: 'chat_id',
        label: 'Chat ID',
        sortable: true,
        getValue: (c) => c.telegram_chat_id,
        render: (c) => <span className="font-mono text-xs text-emerald-400 font-bold">{c.telegram_chat_id}</span>,
      },
      {
        key: 'created_at',
        label: 'Дата привязки',
        sortable: true,
        getValue: (c) => c.created_at,
        render: (c) => <span className="text-xs text-muted-foreground">{new Date(c.created_at).toLocaleString('ru-RU')}</span>,
      },
      {
        key: 'actions',
        label: 'Действия',
        sortable: false,
        render: (c) => (
          <div className="flex justify-end">
            <Button
              size="sm"
              variant="outline"
              disabled={disconnectingId === c.id}
              onClick={() => handleDisconnect(c.id)}
              className="border-red-500/30 text-red-400 hover:bg-red-500/10 text-xs min-h-[32px]"
            >
              {disconnectingId === c.id ? (
                <Loader2 className="h-3 w-3 animate-spin mr-1" />
              ) : (
                <Unlink className="h-3 w-3 mr-1" />
              )}
              Отвязать
            </Button>
          </div>
        ),
      },
    ],
    [disconnectingId]
  );

  // 2. КОЛОНКИ: Реестр OTP-Кодов
  const codeColumns: ColumnDef<any>[] = useMemo(
    () => [
      {
        key: 'code',
        label: '4-Значный Код',
        sortable: true,
        getValue: (cd) => cd.code,
        render: (cd) => (
          <span className="font-mono text-sm font-extrabold text-sky-400 bg-sky-500/10 border border-sky-500/20 px-2.5 py-1 rounded-lg tracking-widest">
            {cd.code}
          </span>
        ),
      },
      {
        key: 'user',
        label: 'Пользователь',
        sortable: true,
        getValue: (cd) => cd.user_full_name,
        render: (cd) => <span className="text-xs font-semibold text-foreground">{cd.user_full_name || '—'}</span>,
      },
      {
        key: 'company',
        label: 'Организация',
        sortable: true,
        getValue: (cd) => cd.company_name,
        render: (cd) => (
          <div className="text-xs text-foreground flex items-center">
            <Building2 className="h-3 w-3 mr-1 text-amber-400" />
            {cd.company_name || '—'}
          </div>
        ),
      },
      {
        key: 'status',
        label: 'Статус',
        sortable: true,
        getValue: (cd) => cd.status_label,
        render: (cd) => (
          <Badge
            className={
              cd.status_label === '✅ Подключен'
                ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-xs'
                : cd.status_label === '🔴 Истёк по времени'
                ? 'bg-red-500/20 text-red-400 border-red-500/30 text-xs'
                : 'bg-amber-500/20 text-amber-400 border-amber-500/30 text-xs'
            }
          >
            {cd.status_label}
          </Badge>
        ),
      },
      {
        key: 'expires_at',
        label: 'Истекает',
        sortable: true,
        getValue: (cd) => cd.expires_at,
        render: (cd) => <span className="text-xs text-muted-foreground font-mono">{new Date(cd.expires_at).toLocaleString('ru-RU')}</span>,
      },
      {
        key: 'created_at',
        label: 'Создан',
        sortable: true,
        getValue: (cd) => cd.created_at,
        render: (cd) => <span className="text-xs text-muted-foreground">{new Date(cd.created_at).toLocaleString('ru-RU')}</span>,
      },
    ],
    []
  );

  // 3. КОЛОНКИ: Логи Вебхуков
  const logColumns: ColumnDef<any>[] = useMemo(
    () => [
      {
        key: 'status',
        label: 'Статус',
        sortable: true,
        getValue: (lg) => lg.status,
        render: (lg) => (
          <Badge
            className={
              lg.status === 'received'
                ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-xs'
                : lg.status === 'error'
                ? 'bg-red-500/20 text-red-400 border-red-500/30 text-xs'
                : 'bg-amber-500/20 text-amber-400 border-amber-500/30 text-xs'
            }
          >
            {lg.status || 'unknown'}
          </Badge>
        ),
      },
      {
        key: 'chat_id',
        label: 'Chat ID',
        sortable: true,
        getValue: (lg) => lg.chat_id,
        render: (lg) => <span className="font-mono text-xs text-foreground font-bold">{lg.chat_id || '—'}</span>,
      },
      {
        key: 'username',
        label: 'Username',
        sortable: true,
        getValue: (lg) => lg.username,
        render: (lg) =>
          lg.username ? (
            <span className="text-xs text-sky-400 font-mono">@{lg.username}</span>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          ),
      },
      {
        key: 'message_text',
        label: 'Текст входящего сообщения',
        sortable: false,
        getValue: (lg) => lg.message_text,
        render: (lg) => (
          <div className="font-mono text-xs text-foreground max-w-md truncate" title={lg.message_text || ''}>
            {lg.message_text || '—'}
          </div>
        ),
      },
      {
        key: 'created_at',
        label: 'Время события',
        sortable: true,
        getValue: (lg) => lg.created_at,
        render: (lg) => <span className="text-xs text-muted-foreground">{new Date(lg.created_at).toLocaleString('ru-RU')}</span>,
      },
    ],
    []
  );

  return (
    <UnifiedWorkspaceLayout
      title="Мониторинг Telegram-ботов и уведомителя"
      description="Управление интеграциями мессенджеров, вебхуками, реестрами привязок и рассылкой уведомлений"
      icon={Send}
      actionButtonsSlot={
        <div className="flex items-center space-x-2">
          <Button
            onClick={handleForceWebhook}
            disabled={settingWebhook}
            variant="outline"
            className="border-sky-500/40 text-sky-400 hover:bg-sky-500/10 text-xs min-h-[40px]"
          >
            <ShieldCheck className={`h-4 w-4 mr-1.5 ${settingWebhook ? 'animate-spin' : ''}`} />
            Зафиксировать Webhook
          </Button>

          <Button
            onClick={() => {
              loadStats();
              loadHealth();
            }}
            disabled={loading || healthLoading}
            variant="outline"
            className="border-border text-xs min-h-[40px]"
          >
            <RefreshCw className={`h-4 w-4 mr-1.5 ${loading || healthLoading ? 'animate-spin' : ''}`} />
            Проверить статус
          </Button>
        </div>
      }
    >
      {/* 1. СТАТИСТИЧЕСКИЕ КАРТОЧКИ И ЗДОРОВЬЕ БОТА */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-card border-border p-4">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-xs text-muted-foreground block">Статус Bot API</span>
              <div className="flex items-center space-x-2 mt-1">
                <Badge className="bg-sky-500/20 text-sky-400 border-sky-500/30 text-xs font-mono">
                  @{health?.botInfo?.username || 'bot'}
                </Badge>
              </div>
            </div>
            <div className="p-3 bg-sky-500/10 rounded-xl text-sky-400">
              <CheckCircle2 className="h-6 w-6" />
            </div>
          </div>
          <div className="mt-3 pt-2 border-t border-border text-xs text-muted-foreground">
            {health?.botInfo?.first_name || 'Buhuchet Bot'}
          </div>
        </Card>

        <Card className="bg-card border-border p-4">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-xs text-muted-foreground block">Статус Webhook</span>
              <span className="text-sm font-bold text-emerald-400 mt-1 block truncate max-w-[170px]" title={health?.webhookInfo?.url || ''}>
                {health?.webhookInfo?.url ? 'Активен 200 OK' : 'Не установлен'}
              </span>
            </div>
            <div className="p-3 bg-emerald-500/10 rounded-xl text-emerald-400">
              <CheckCircle2 className="h-6 w-6" />
            </div>
          </div>
          <div className="mt-3 pt-2 border-t border-border text-xs text-muted-foreground truncate font-mono">
            {health?.webhookInfo?.url ? health.webhookInfo.url : '⚠️ URL не настроен'}
          </div>
        </Card>

        <Card className="bg-card border-border p-4">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-xs text-muted-foreground block">Привязано пользователей</span>
              <span className="text-2xl font-bold font-mono text-amber-400 mt-1 block">
                {stats?.connections.length || 0}
              </span>
            </div>
            <div className="p-3 bg-amber-500/10 rounded-xl text-amber-400">
              <MessageSquare className="h-6 w-6" />
            </div>
          </div>
          <div className="mt-3 pt-2 border-t border-border text-xs text-muted-foreground">
            Специалисты с активной связью
          </div>
        </Card>

        <Card className="bg-card border-border p-4">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-xs text-muted-foreground block">Очередь Telegram</span>
              <span className="text-2xl font-bold font-mono text-indigo-400 mt-1 block">
                {health?.webhookInfo?.pending_update_count ?? 0}
              </span>
            </div>
            <div className="p-3 bg-indigo-500/10 rounded-xl text-indigo-400">
              <BellRing className="h-6 w-6" />
            </div>
          </div>
          <div className="mt-3 pt-2 border-t border-border text-xs text-muted-foreground">
            Недоставленных событий
          </div>
        </Card>
      </div>

      {/* ТЕСТОВАЯ ОТПРАВКА PING */}
      <Card className="bg-card border-border p-5 mt-4 space-y-3">
        <h4 className="text-xs md:text-sm font-bold text-foreground flex items-center">
          <Send className="h-4 w-4 mr-2 text-amber-400" />
          Ручная отправка тестового уведомления
        </h4>
        <form onSubmit={handleSendTest} className="flex flex-col sm:flex-row items-end gap-3">
          <div className="w-full sm:w-1/3 space-y-1">
            <Label className="text-xs text-muted-foreground">Telegram Chat ID получателя</Label>
            <Input
              value={testChatId}
              onChange={(e) => setTestChatId(e.target.value)}
              placeholder="Например: 123456789"
              className="bg-background border-border text-foreground text-xs font-mono min-h-[40px]"
            />
          </div>
          <div className="w-full sm:w-1/2 space-y-1">
            <Label className="text-xs text-muted-foreground">Текст проверочного сообщения</Label>
            <Input
              value={testText}
              onChange={(e) => setTestText(e.target.value)}
              className="bg-background border-border text-foreground text-xs min-h-[40px]"
            />
          </div>
          <Button
            type="submit"
            disabled={sendingTest || !testChatId}
            className="bg-primary hover:bg-primary/90 text-primary-foreground font-bold text-xs min-h-[40px] px-5 rounded-xl shadow-md"
          >
            {sendingTest ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Send className="h-4 w-4 mr-1.5" />}
            Отправить Тест
          </Button>
        </form>
      </Card>

      {/* 2. ПОДВКЛАДКИ РЕЕСТРОВ */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3 mt-6">
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setSubTab('connections')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${
              subTab === 'connections'
                ? 'bg-sky-500/20 text-sky-400 border border-sky-500/40 shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <User className="h-3.5 w-3.5 inline mr-1.5" />
            Привязанные Пользователи ({stats?.connections.length || 0})
          </button>

          <button
            onClick={() => setSubTab('codes')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${
              subTab === 'codes'
                ? 'bg-purple-500/20 text-purple-400 border border-purple-500/40 shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Key className="h-3.5 w-3.5 inline mr-1.5" />
            Реестр OTP-Кодов ({stats?.codes.length || 0})
          </button>

          <button
            onClick={() => setSubTab('logs')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${
              subTab === 'logs'
                ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40 shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <ListFilter className="h-3.5 w-3.5 inline mr-1.5" />
            Логи Вебхуков ({stats?.logs.length || 0})
          </button>
        </div>

        <Button
          size="sm"
          variant="ghost"
          onClick={loadStats}
          disabled={loading}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          <RefreshCw className={`h-3.5 w-3.5 mr-1 ${loading ? 'animate-spin' : ''}`} />
          Обновить реестр
        </Button>
      </div>

      {/* 3. UNIFIED DATA GRID: ПРИВЯЗАННЫЕ ПОЛЬЗОВАТЕЛИ С НАСТРОЙКОЙ ВИДИМОСТИ КОЛОНОК */}
      {subTab === 'connections' && (
        <UnifiedDataGrid
          gridId="admin_telegram_connections"
          data={stats?.connections || []}
          columns={connectionColumns}
          keyExtractor={(c) => c.id}
          getRowActions={(c) => [
            {
              label: '🔵 Профиль Telegram',
              action: () => c.telegram_username && window.open(`https://t.me/${c.telegram_username}`, '_blank'),
            },
            {
              label: '❌ Отвязать Telegram',
              danger: true,
              separatorBefore: true,
              action: () => handleDisconnect(c.id),
            },
          ]}
          searchPlaceholder="Поиск привязок по ФИО, Email, ИНН или Telegram Username..."
          emptyMessage="Нет зарегистрированных привязок пользователей"
          isLoading={loading}
          defaultPageSize={25}
        />
      )}

      {/* 4. UNIFIED DATA GRID: РЕЕСТР OTP-КОДОВ */}
      {subTab === 'codes' && (
        <UnifiedDataGrid
          gridId="admin_telegram_codes"
          data={stats?.codes || []}
          columns={codeColumns}
          keyExtractor={(cd) => cd.id}
          searchPlaceholder="Поиск кодов по значению, ФИО или названию компании..."
          emptyMessage="История генерации кодов пуста"
          isLoading={loading}
          defaultPageSize={25}
        />
      )}

      {/* 5. UNIFIED DATA GRID: ЛОГИ ВЕБХУКОВ */}
      {subTab === 'logs' && (
        <UnifiedDataGrid
          gridId="admin_telegram_logs"
          data={stats?.logs || []}
          columns={logColumns}
          keyExtractor={(lg) => lg.id}
          searchPlaceholder="Поиск по текстам сообщений, Chat ID или Username..."
          emptyMessage="Системные логи сообщений пока отсутствуют"
          isLoading={loading}
          defaultPageSize={25}
        />
      )}
    </UnifiedWorkspaceLayout>
  );
}
