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
  ShieldCheck,
  AlertCircle,
  ExternalLink,
  MessageSquare,
  BellRing,
} from 'lucide-react';
import {
  getTelegramAdminStatsAction,
  testTelegramBotHealthAdminAction,
  forceSetTelegramWebhookAdminAction,
  sendAdminTestTelegramMessageAction,
  disconnectUserTelegramAdminAction,
  getTelegramLogsAction,
  type TelegramAdminStatsData,
  type TelegramBotHealthData,
} from '@/app/super-admin/telegram-actions';
import { UnifiedDataGrid, ColumnDef } from '@/components/ui/unified/UnifiedDataGrid';
import { UnifiedViewModal } from '@/components/ui/unified/UnifiedViewModal';
import { toast } from 'sonner';
import type { TelegramNotificationLog } from '@/types/database.types';

export function SuperAdminTelegramTab() {
  const [subTab, setSubTab] = useState<'notification_logs' | 'connections' | 'codes'>('notification_logs');
  const [loading, setLoading] = useState(true);
  const [healthLoading, setHealthLoading] = useState(false);
  const [settingWebhook, setSettingWebhook] = useState(false);
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null);

  const [stats, setStats] = useState<TelegramAdminStatsData | null>(null);
  const [health, setHealth] = useState<TelegramBotHealthData | null>(null);
  const [notificationLogs, setNotificationLogs] = useState<TelegramNotificationLog[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [selectedLogForModal, setSelectedLogForModal] = useState<TelegramNotificationLog | null>(null);

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
      toast.error(res.error || 'Ошибка загрузки статистики');
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

  const loadNotificationLogs = async () => {
    setLoadingLogs(true);
    const res = await getTelegramLogsAction({ page: 1, pageSize: 100 });
    if (res.success && res.data) {
      setNotificationLogs((res.data.logs || []) as TelegramNotificationLog[]);
    }
    setLoadingLogs(false);
  };

  useEffect(() => {
    loadStats();
    loadHealth();
    loadNotificationLogs();
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
      toast.error(res.error || 'Ошибка отвязки');
    }
    setDisconnectingId(null);
  };

  const handleSendTest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!testChatId) return;
    setSendingTest(true);
    const res = await sendAdminTestTelegramMessageAction(Number(testChatId), testText);
    if (res.success) {
      toast.success(`Тестовое сообщение отправлено в Chat ID: ${testChatId}`);
      await loadStats();
      await loadNotificationLogs();
    } else {
      toast.error(res.error || 'Сбой отправки тестового сообщения');
    }
    setSendingTest(false);
  };

  // 1. КОЛОНКИ: Журнал отправленных сообщений Telegram
  const notificationLogColumns: ColumnDef<TelegramNotificationLog>[] = useMemo(
    () => [
      {
        key: 'status',
        label: 'Статус',
        sortable: true,
        getValue: (l) => l.status,
        render: (l) => {
          if (l.status === 'sent') {
            return (
              <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-xs flex items-center gap-1 w-fit">
                <CheckCircle2 className="h-3 w-3" />
                Отправлено
              </Badge>
            );
          }
          if (l.status === 'failed') {
            return (
              <Badge className="bg-red-500/20 text-red-400 border-red-500/30 text-xs flex items-center gap-1 w-fit">
                <AlertCircle className="h-3 w-3" />
                Ошибка
              </Badge>
            );
          }
          return (
            <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 text-xs flex items-center gap-1 w-fit">
              <Loader2 className="h-3 w-3 animate-spin" />
              В процессе
            </Badge>
          );
        },
      },
      {
        key: 'event_type',
        label: 'Тип события',
        sortable: true,
        getValue: (l) => l.event_type,
        render: (l) => {
          const typeColors: Record<string, string> = {
            DOC_CREATED: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
            STATUS_CHANGED: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
            COLLABORATION_REQUEST: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
            COLLABORATION_CONFIRMED: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
            COLLABORATION_REJECTED: 'bg-rose-500/20 text-rose-400 border-rose-500/30',
            COLLABORATION_TERMINATED: 'bg-red-500/20 text-red-400 border-red-500/30',
            COMPANY_VERIFICATION: 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30',
            SYSTEM_BROADCAST: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
          };
          const cls = typeColors[l.event_type] || 'bg-slate-500/20 text-slate-300 border-slate-500/30';
          return <Badge className={`${cls} text-[11px] font-mono`}>{l.event_type}</Badge>;
        },
      },
      {
        key: 'recipient',
        label: 'Получатель / Chat ID',
        sortable: true,
        getValue: (l) => l.recipient_user?.full_name || l.recipient_chat_id,
        render: (l) => (
          <div>
            <div className="font-semibold text-foreground text-xs">
              {l.recipient_user?.full_name || 'Пользователь Telegram'}
            </div>
            <div className="text-[11px] font-mono text-muted-foreground">Chat ID: {l.recipient_chat_id}</div>
          </div>
        ),
      },
      {
        key: 'message_preview',
        label: 'Текст сообщения',
        sortable: false,
        getValue: (l) => l.message_text,
        render: (l) => (
          <div
            className="text-xs text-muted-foreground truncate max-w-sm cursor-pointer hover:text-foreground font-mono"
            title="Нажмите для полного просмотра"
          >
            {l.message_text.replace(/\*\*/g, '').slice(0, 80)}...
          </div>
        ),
      },
      {
        key: 'sent_at',
        label: 'Время отправки',
        sortable: true,
        getValue: (l) => l.created_at || l.sent_at,
        render: (l) => (
          <span className="text-xs text-muted-foreground font-mono">
            {new Date(l.created_at || l.sent_at).toLocaleString('ru-RU')}
          </span>
        ),
      },
    ],
    []
  );

  // 2. КОЛОНКИ: Привязанные Аккаунты
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

  // 3. КОЛОНКИ: Реестр OTP-Кодов
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

  return (
    <div className="w-full space-y-6">
      {/* 1. СТАТИСТИЧЕСКИЕ КАРТОЧКИ */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-card border-border p-4 shadow-xl">
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

        <Card className="bg-card border-border p-4 shadow-xl">
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

        <Card className="bg-card border-border p-4 shadow-xl">
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

        <Card className="bg-card border-border p-4 shadow-xl">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-xs text-muted-foreground block">Отправлено оповещений</span>
              <span className="text-2xl font-bold font-mono text-indigo-400 mt-1 block">
                {notificationLogs.length || stats?.logs.length || 0}
              </span>
            </div>
            <div className="p-3 bg-indigo-500/10 rounded-xl text-indigo-400">
              <BellRing className="h-6 w-6" />
            </div>
          </div>
          <div className="mt-3 pt-2 border-t border-border text-xs text-muted-foreground">
            Всего зафиксировано в реестре
          </div>
        </Card>
      </div>

      {/* ТЕСТОВАЯ ОТПРАВКА PING */}
      <Card className="bg-card border-border p-5 space-y-3 shadow-xl">
        <h4 className="text-xs md:text-sm font-bold text-foreground flex items-center">
          <Send className="h-4 w-4 mr-2 text-amber-400" />
          Ручная отправка проверочного уведомления
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
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setSubTab('notification_logs')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${
              subTab === 'notification_logs'
                ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40 shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <ListFilter className="h-3.5 w-3.5 inline mr-1.5" />
            Журнал Telegram-Оповещений ({notificationLogs.length || 0})
          </button>

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
        </div>

        <div className="flex items-center gap-2">
          <Button
            onClick={handleForceWebhook}
            disabled={settingWebhook}
            variant="outline"
            size="sm"
            className="border-sky-500/40 text-sky-400 hover:bg-sky-500/10 text-xs min-h-[36px]"
          >
            <ShieldCheck className={`h-3.5 w-3.5 mr-1 ${settingWebhook ? 'animate-spin' : ''}`} />
            Фиксировать Webhook
          </Button>

          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              loadStats();
              loadNotificationLogs();
            }}
            disabled={loading || loadingLogs}
            className="text-xs text-muted-foreground hover:text-foreground min-h-[36px]"
          >
            <RefreshCw className={`h-3.5 w-3.5 mr-1 ${loading || loadingLogs ? 'animate-spin' : ''}`} />
            Обновить
          </Button>
        </div>
      </div>

      {/* 3. UNIFIED DATA GRID: ЖУРНАЛ ОПОВЕЩЕНИЙ */}
      {subTab === 'notification_logs' && (
        <UnifiedDataGrid<TelegramNotificationLog>
          gridId="admin_telegram_notifications_tab"
          data={notificationLogs}
          columns={notificationLogColumns}
          keyExtractor={(l) => l.id}
          onRowClick={(l) => setSelectedLogForModal(l)}
          getRowActions={(l) => [
            {
              label: '👁️ Просмотр сообщения',
              action: () => setSelectedLogForModal(l),
            },
          ]}
          searchPlaceholder="Поиск по тексту сообщения, Chat ID или типу события..."
          emptyMessage="История отправленных оповещений Telegram пока пуста"
          isLoading={loadingLogs}
          defaultPageSize={25}
        />
      )}

      {/* 4. UNIFIED DATA GRID: ПРИВЯЗАННЫЕ ПОЛЬЗОВАТЕЛИ */}
      {subTab === 'connections' && (
        <UnifiedDataGrid
          gridId="admin_telegram_connections_tab"
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

      {/* 5. UNIFIED DATA GRID: РЕЕСТР OTP-КОДОВ */}
      {subTab === 'codes' && (
        <UnifiedDataGrid
          gridId="admin_telegram_codes_tab"
          data={stats?.codes || []}
          columns={codeColumns}
          keyExtractor={(cd) => cd.id}
          searchPlaceholder="Поиск кодов по значению, ФИО или названию компании..."
          emptyMessage="История генерации кодов пуста"
          isLoading={loading}
          defaultPageSize={25}
        />
      )}

      {/* МОДАЛЬНОЕ ОКНО ПРЕДПРОСМОТРА ПОЛНОГО ТЕКСТА СООБЩЕНИЯ */}
      {selectedLogForModal && (
        <UnifiedViewModal
          isOpen={!!selectedLogForModal}
          onClose={() => setSelectedLogForModal(null)}
          title="Детали Telegram-оповещения"
          subtitle={`ID записи: ${selectedLogForModal.id}`}
          badge={
            <Badge
              className={
                selectedLogForModal.status === 'sent'
                  ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                  : 'bg-red-500/20 text-red-400 border-red-500/30'
              }
            >
              {selectedLogForModal.status === 'sent' ? '✅ Доставлено' : '❌ Ошибка'}
            </Badge>
          }
          sections={[
            {
              title: 'Параметры отправки',
              fields: [
                { label: 'Тип события', value: selectedLogForModal.event_type },
                { label: 'Chat ID', value: selectedLogForModal.recipient_chat_id },
                {
                  label: 'Получатель',
                  value: selectedLogForModal.recipient_user?.full_name || 'Не привязан к профилю',
                },
                {
                  label: 'Дата и время',
                  value: new Date(selectedLogForModal.created_at || selectedLogForModal.sent_at).toLocaleString('ru-RU'),
                },
                ...(selectedLogForModal.error_message
                  ? [{ label: 'Ошибка доставки', value: selectedLogForModal.error_message, colSpan: 2 as 2 }]
                  : []),
              ],
            },
          ]}
          previewSlot={
            <div className="space-y-2">
              <Label className="text-xs font-bold text-muted-foreground uppercase">Полный текст сообщения</Label>
              <div className="bg-background/80 p-4 rounded-xl border border-border font-mono text-xs whitespace-pre-wrap leading-relaxed text-foreground select-all">
                {selectedLogForModal.message_text}
              </div>
            </div>
          }
        />
      )}
    </div>
  );
}
