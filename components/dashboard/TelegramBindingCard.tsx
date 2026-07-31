'use client';

import React, { useState, useEffect } from 'react';
import { Send, CheckCircle2, ShieldAlert, Unlink, ExternalLink, Loader2, Copy, Check } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  generateTelegramOtpAction,
  getTelegramConnectionStatusAction,
  disconnectTelegramAction,
  type TelegramOtpData,
} from '@/app/dashboard/profile/telegram-actions';

export function TelegramBindingCard() {
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [username, setUsername] = useState<string | null>(null);
  const [otpData, setOtpData] = useState<TelegramOtpData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const checkStatus = async () => {
    setLoading(true);
    const res = await getTelegramConnectionStatusAction();
    if (res.success && res.data) {
      setIsConnected(res.data.isConnected);
      setUsername(res.data.username || null);
    }
    setLoading(false);
  };

  useEffect(() => {
    checkStatus();
  }, []);

  const handleCopyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const handleGenerate = async () => {
    setGenerating(true);
    setError(null);
    const res = await generateTelegramOtpAction();
    if (res.success && res.data) {
      setOtpData(res.data);
    } else {
      setError(res.error || 'Не удалось сгенерировать код');
    }
    setGenerating(false);
  };

  const handleDisconnect = async () => {
    setDisconnecting(true);
    const res = await disconnectTelegramAction();
    if (res.success) {
      setIsConnected(false);
      setUsername(null);
      setOtpData(null);
    } else {
      setError(res.error || 'Не удалось отвязать аккаунт');
    }
    setDisconnecting(false);
  };

  if (loading) {
    return (
      <Card className="p-6 border border-border/80 bg-card/60 backdrop-blur-sm flex items-center justify-center min-h-[140px]">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground mr-2" />
        <span className="text-xs text-muted-foreground">Проверка статуса соединения с Telegram...</span>
      </Card>
    );
  }

  return (
    <Card className="p-6 border border-border/80 bg-card/60 backdrop-blur-sm shadow-sm transition-all">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
        {/* Левая часть: Иконка и Описание */}
        <div className="flex items-start gap-4">
          <div className="p-3.5 bg-sky-500/10 text-sky-500 rounded-2xl shrink-0 border border-sky-500/20">
            <Send className="w-6 h-6" />
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center gap-3 flex-wrap">
              <h3 className="font-bold text-base tracking-tight text-foreground">Интеграция с Telegram</h3>
              {isConnected ? (
                <Badge
                  variant="outline"
                  className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 gap-1.5 py-1 px-2.5 font-mono text-xs"
                >
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                  <span>Привязано {username ? `(@${username})` : ''}</span>
                </Badge>
              ) : (
                <Badge
                  variant="outline"
                  className="bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30 gap-1.5 py-1 px-2.5 text-xs"
                >
                  <ShieldAlert className="w-3.5 h-3.5 text-amber-500" />
                  <span>Не привязан</span>
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed max-w-xl">
              Мгновенная доставка уведомлений о движениях первичных документов, откликах контрагентов и изменении прав доступа сотрудников.
            </p>
          </div>
        </div>

        {/* Правая часть: Действия и OTP Коды */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 shrink-0">
          {!isConnected ? (
            !otpData ? (
              <Button
                onClick={handleGenerate}
                disabled={generating}
                className="bg-sky-600 hover:bg-sky-500 text-white gap-2 shadow-sm font-semibold text-xs min-h-[40px] px-4 rounded-xl"
              >
                {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                <span>{generating ? 'Генерация...' : 'Подключить Telegram'}</span>
              </Button>
            ) : (
              <div className="flex items-center gap-3 bg-muted/60 p-2 rounded-xl border border-border">
                <button
                  type="button"
                  onClick={() => handleCopyCode(otpData.code)}
                  className="flex items-center space-x-2 px-3 py-1.5 bg-background font-mono font-extrabold text-lg rounded-lg border border-border text-sky-400 hover:bg-sky-500/10 transition-all"
                  title="Нажмите, чтобы скопировать код"
                >
                  <span>{otpData.code}</span>
                  {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4 text-muted-foreground" />}
                </button>

                <a href={otpData.deepLink} target="_blank" rel="noreferrer">
                  <Button size="sm" className="bg-sky-600 hover:bg-sky-500 text-white gap-1.5 font-bold text-xs rounded-lg min-h-[36px]">
                    <span>Открыть Бот</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </Button>
                </a>
              </div>
            )
          ) : (
            <Button
              variant="outline"
              onClick={handleDisconnect}
              disabled={disconnecting}
              className="text-red-400 hover:bg-red-500/10 border-red-500/30 gap-2 text-xs font-semibold rounded-xl min-h-[40px]"
            >
              {disconnecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Unlink className="w-4 h-4" />}
              <span>Отвязать Telegram</span>
            </Button>
          )}
        </div>
      </div>

      {error && (
        <div className="mt-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs flex items-center">
          <ShieldAlert className="h-4 w-4 mr-2 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </Card>
  );
}
