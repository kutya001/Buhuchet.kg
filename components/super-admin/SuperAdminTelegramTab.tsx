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
  Activity,
  User,
  Building2,
  Key,
  ListFilter,
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

export function SuperAdminTelegramTab() {
  const [subTab, setSubTab] = useState<'connections' | 'codes' | 'logs'>('connections');
  const [loading, setLoading] = useState(true);
  const [healthLoading, setHealthLoading] = useState(false);
  const [settingWebhook, setSettingWebhook] = useState(false);
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null);

  const [stats, setStats] = useState<TelegramAdminStatsData | null>(null);
  const [health, setHealth] = useState<TelegramBotHealthData | null>(null);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

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
      setMsg({ type: 'error', text: res.error || 'Ошибка загрузки статистики' });
    }
    setLoading(false);
  };

  const loadHealth = async () => {
    setHealthLoading(true);
    const res = await testTelegramBotHealthAdminAction();
    if (res.success && res.data) {
      setHealth(res.data);
    } else {
      setMsg({ type: 'error', text: res.error || 'Сбой проверки Webhook и Bot API' });
    }
    setHealthLoading(false);
  };

  useEffect(() => {
    loadStats();
    loadHealth();
  }, []);

  const handleForceWebhook = async () => {
    setSettingWebhook(true);
    setMsg(null);
    const res = await forceSetTelegramWebhookAdminAction();
    if (res.success && res.data) {
      setMsg({ type: 'success', text: `Webhook успешно зафиксирован: ${res.data.webhookUrl}` });
      await loadHealth();
    } else {
      setMsg({ type: 'error', text: res.error || 'Не удалось зарегистрировать Webhook' });
    }
    setSettingWebhook(false);
  };

  const handleDisconnect = async (id: string) => {
    if (!confirm('Вы уверены, что хотите отвязать этот Telegram-аккаунт?')) return;
    setDisconnectingId(id);
    const res = await disconnectUserTelegramAdminAction(id);
    if (res.success) {
      setMsg({ type: 'success', text: 'Связь с Telegram успешно удалена' });
      await loadStats();
    } else {
      setMsg({ type: 'error', text: res.error || 'Ошибка отвязки' });
    }
    setDisconnectingId(null);
  };

  const handleSendTest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!testChatId) return;
    setSendingTest(true);
    setMsg(null);
    const res = await sendAdminTestTelegramMessageAction(Number(testChatId), testText);
    if (res.success) {
      setMsg({ type: 'success', text: `Тестовое сообщение успешно выслано в Chat ID: ${testChatId}` });
      await loadStats();
    } else {
      setMsg({ type: 'error', text: res.error || 'Сбой отправки сообщения' });
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
            <div className="font-bold text-white text-xs">{c.user_full_name}</div>
            <div className="text-[11px] text-slate-400">{c.user_email}</div>
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
            <div className="font-semibold text-slate-200 text-xs flex items-center">
              <Building2 className="h-3 w-3 mr-1 text-amber-400" />
              {c.company_name}
            </div>
            <div className="text-[11px] font-mono text-slate-400">ИНН: {c.company_inn}</div>
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
            <span className="text-xs text-sky-400 font-mono font-semibold">@{c.telegram_username}</span>
          ) : (
            <span className="text-xs text-slate-500">—</span>
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
        render: (c) => <span className="text-xs text-slate-400">{new Date(c.created_at).toLocaleString('ru-RU')}</span>,
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
          <span className="font-mono text-base font-extrabold text-sky-400 bg-sky-500/10 border border-sky-500/20 px-2.5 py-1 rounded-lg tracking-widest">
            {cd.code}
          </span>
        ),
      },
      {
        key: 'user',
        label: 'Пользователь',
        sortable: true,
        getValue: (cd) => cd.user_full_name,
        render: (cd) => <span className="text-xs font-semibold text-white">{cd.user_full_name}</span>,
      },
      {
        key: 'company',
        label: 'Компания',
        sortable: true,
        getValue: (cd) => cd.company_name,
        render: (cd) => <span className="text-xs text-slate-300">{cd.company_name}</span>,
      },
      {
        key: 'created_at',
        label: 'Время создания',
        sortable: true,
        getValue: (cd) => cd.created_at,
        render: (cd) => <span className="text-xs text-slate-400">{new Date(cd.created_at).toLocaleTimeString('ru-RU')}</span>,
      },
      {
        key: 'expires_at',
        label: 'Истекает в',
        sortable: true,
        getValue: (cd) => cd.expires_at,
        render: (cd) => <span className="text-xs text-slate-400">{new Date(cd.expires_at).toLocaleTimeString('ru-RU')}</span>,
      },
      {
        key: 'status',
        label: 'Статус кода',
        sortable: true,
        getValue: (cd) => cd.status_label,
        render: (cd) => (
          <Badge
            variant="outline"
            className={`text-xs px-2.5 py-0.5 ${
              cd.status_label.includes('✅')
                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                : cd.status_label.includes('🟢')
                ? 'bg-sky-500/10 text-sky-400 border-sky-500/30'
                : 'bg-red-500/10 text-red-400 border-red-500/30'
            }`}
          >
            {cd.status_label}
          </Badge>
        ),
      },
    ],
    []
  );

  // 3. КОЛОНКИ: Логи Вебхуков
  const logColumns: ColumnDef<any>[] = useMemo(
    () => [
      {
        key: 'created_at',
        label: 'Дата & Время',
        sortable: true,
        getValue: (lg) => lg.created_at,
        render: (lg) => <span className="text-xs font-mono text-slate-400">{new Date(lg.created_at).toLocaleString('ru-RU')}</span>,
      },
      {
        key: 'chat_id',
        label: 'Chat ID',
        sortable: true,
        getValue: (lg) => lg.chat_id,
        render: (lg) => <span className="text-xs font-mono font-semibold text-emerald-400">{lg.chat_id || '—'}</span>,
      },
      {
        key: 'username',
        label: 'Username',
        sortable: true,
        getValue: (lg) => lg.username,
        render: (lg) => (
          <span className="text-xs font-mono text-sky-400">{lg.username ? `@${lg.username}` : '—'}</span>
        ),
      },
      {
        key: 'message_text',
        label: 'Текст Сообщения',
        sortable: true,
        getValue: (lg) => lg.message_text,
        render: (lg) => <span className="text-xs font-mono text-slate-200">{lg.message_text}</span>,
      },
      {
        key: 'status',
        label: 'Статус',
        sortable: true,
        getValue: (lg) => lg.status,
        render: (lg) => (
          <Badge variant="outline" className="border-slate-700 text-slate-300 text-[11px]">
            {lg.status}
          </Badge>
        ),
      },
    ],
    []
  );

  return (
    <div className="space-y-6">
      {msg && (
        <div
          className={`p-4 rounded-xl text-xs font-semibold flex items-center justify-between border ${
            msg.type === 'success'
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
              : 'bg-red-500/10 border-red-500/30 text-red-400'
          }`}
        >
          <div className="flex items-center space-x-2">
            {msg.type === 'success' ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
            <span>{msg.text}</span>
          </div>
          <button onClick={() => setMsg(null)} className="hover:opacity-75">
            ✕
          </button>
        </div>
      )}

      {/* 1. КАРТОЧКА ДИАГНОСТИКИ ЗДОРОВЬЯ БОТА И WEBHOOK */}
      <Card className="bg-slate-900 border-slate-800 p-6 space-y-6">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-800 pb-5">
          <div className="flex items-center space-x-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-sky-500/10 text-sky-400 border border-sky-500/20">
              <Activity className="h-6 w-6" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white flex items-center">
                Центр Диагностики & Webhook Telegram API
              </h2>
              <p className="text-xs text-slate-400">
                Мониторинг соединения с Telegram Bot API и проверка доставки событий
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              disabled={healthLoading}
              onClick={loadHealth}
              className="border-slate-700 bg-slate-800 hover:bg-slate-700 text-white text-xs rounded-xl min-h-[40px]"
            >
              {healthLoading ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <RefreshCw className="h-4 w-4 mr-1.5" />}
              Проверить Bot API
            </Button>

            <Button
              disabled={settingWebhook}
              onClick={handleForceWebhook}
              className="bg-sky-600 hover:bg-sky-700 text-white font-bold text-xs rounded-xl min-h-[40px] px-4"
            >
              {settingWebhook ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <ShieldCheck className="h-4 w-4 mr-1.5" />}
              Принудительно зафиксировать Webhook
            </Button>
          </div>
        </div>

        {/* ДИАГНОСТИЧЕСКАЯ ПАНЕЛЬ С ИНДИКАТОРАМИ */}
        {health ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
              <span className="text-[11px] text-slate-400 uppercase tracking-wider font-bold">Статус Имени Бот-Аккаунта</span>
              <div className="flex items-center space-x-2">
                <Badge className="bg-sky-500/20 text-sky-400 border-sky-500/30 text-xs px-2.5 py-1 font-mono">
                  @{health.botInfo?.username || '—'}
                </Badge>
                <span className="text-xs text-slate-300 font-semibold">{health.botInfo?.first_name}</span>
              </div>
            </div>

            <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
              <span className="text-[11px] text-slate-400 uppercase tracking-wider font-bold">Привязанный Webhook URL</span>
              <div className="text-xs font-mono text-emerald-400 truncate" title={health.webhookInfo?.url || 'Не установлен'}>
                {health.webhookInfo?.url ? health.webhookInfo.url : '⚠️ URL не зарегистрирован'}
              </div>
            </div>

            <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
              <span className="text-[11px] text-slate-400 uppercase tracking-wider font-bold">Очередь сообщений в Telegram</span>
              <div className="flex items-center space-x-2">
                <span className="text-lg font-mono font-extrabold text-white">
                  {health.webhookInfo?.pending_update_count ?? 0}
                </span>
                <span className="text-[11px] text-slate-400">недоставленных событий</span>
              </div>
            </div>
          </div>
        ) : (
          <div className="text-xs text-slate-400 flex items-center justify-center p-4">
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
            Загрузка системных данных бота...
          </div>
        )}

        {/* ТЕСТОВАЯ ОТПРАВКА PING */}
        <form onSubmit={handleSendTest} className="pt-4 border-t border-slate-800 flex flex-col sm:flex-row items-end gap-3">
          <div className="w-full sm:w-1/3 space-y-1">
            <Label className="text-xs text-slate-300">Telegram Chat ID получателя</Label>
            <Input
              value={testChatId}
              onChange={(e) => setTestChatId(e.target.value)}
              placeholder="Например: 123456789"
              className="bg-slate-950 border-slate-800 text-white text-xs font-mono"
            />
          </div>
          <div className="w-full sm:w-1/2 space-y-1">
            <Label className="text-xs text-slate-300">Текст проверочного пинга</Label>
            <Input
              value={testText}
              onChange={(e) => setTestText(e.target.value)}
              className="bg-slate-950 border-slate-800 text-white text-xs"
            />
          </div>
          <Button
            type="submit"
            disabled={sendingTest || !testChatId}
            className="bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs min-h-[40px] px-4 rounded-xl"
          >
            {sendingTest ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Send className="h-4 w-4 mr-1.5" />}
            Тестовый Пинг
          </Button>
        </form>
      </Card>

      {/* 2. ПОДВКЛАДКИ РЕЕСТРОВ */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-3">
        <div className="flex items-center space-x-2">
          <button
            onClick={() => setSubTab('connections')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${
              subTab === 'connections'
                ? 'bg-sky-500/20 text-sky-400 border border-sky-500/40 shadow-md'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <User className="h-3.5 w-3.5 inline mr-1.5" />
            Привязанные Пользователи ({stats?.connections.length || 0})
          </button>

          <button
            onClick={() => setSubTab('codes')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${
              subTab === 'codes'
                ? 'bg-purple-500/20 text-purple-400 border border-purple-500/40 shadow-md'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Key className="h-3.5 w-3.5 inline mr-1.5" />
            Реестр OTP-Кодов ({stats?.codes.length || 0})
          </button>

          <button
            onClick={() => setSubTab('logs')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${
              subTab === 'logs'
                ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40 shadow-md'
                : 'text-slate-400 hover:text-slate-200'
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
          className="text-xs text-slate-400 hover:text-white"
        >
          <RefreshCw className={`h-3.5 w-3.5 mr-1 ${loading ? 'animate-spin' : ''}`} />
          Обновить
        </Button>
      </div>

      {/* 3. ОПТИМИЗИРОВАННЫЙ UNIFIED DATA GRID: ПРИВЯЗАННЫЕ ПОЛЬЗОВАТЕЛИ */}
      {subTab === 'connections' && (
        <UnifiedDataGrid
          data={stats?.connections || []}
          columns={connectionColumns}
          keyExtractor={(c) => c.id}
          searchPlaceholder="Поиск привязок по ФИО, Email, ИНН или Telegram Username..."
          emptyMessage="Нет зарегистрированных привязок пользователей"
          isLoading={loading}
        />
      )}

      {/* 4. ОПТИМИЗИРОВАННЫЙ UNIFIED DATA GRID: РЕЕСТР OTP-КОДОВ */}
      {subTab === 'codes' && (
        <UnifiedDataGrid
          data={stats?.codes || []}
          columns={codeColumns}
          keyExtractor={(cd) => cd.id}
          searchPlaceholder="Поиск кодов по значению, ФИО или названию компании..."
          emptyMessage="История генерации кодов пуста"
          isLoading={loading}
        />
      )}

      {/* 5. ОПТИМИЗИРОВАННЫЙ UNIFIED DATA GRID: ЛОГИ ВЕБХУКОВ */}
      {subTab === 'logs' && (
        <UnifiedDataGrid
          data={stats?.logs || []}
          columns={logColumns}
          keyExtractor={(lg) => lg.id}
          searchPlaceholder="Поиск по текстам сообщений, Chat ID или Username..."
          emptyMessage="Системные логи сообщений пока отсутствуют"
          isLoading={loading}
        />
      )}
    </div>
  );
}
