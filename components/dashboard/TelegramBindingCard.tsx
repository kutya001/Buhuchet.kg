'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Send, CheckCircle2, Loader2, AlertCircle, ExternalLink, RefreshCw, Unlink, Copy, Check } from 'lucide-react';
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

  const handleCopyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

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
      <Card className="bg-card border-border p-6 flex items-center justify-center min-h-[140px]">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground mr-2" />
        <span className="text-xs text-muted-foreground">Проверка статуса Telegram...</span>
      </Card>
    );
  }

  return (
    <Card className="bg-card border-border p-6 space-y-5">
      <div className="flex items-center justify-between border-b border-border pb-4">
        <div className="flex items-center space-x-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-500/10 text-sky-400 border border-sky-500/20">
            <Send className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-foreground flex items-center">
              Уведомления в Telegram
            </h3>
            <p className="text-xs text-muted-foreground">
              Мгновенные оповещения об откликах, входящих документах и статусах
            </p>
          </div>
        </div>

        {isConnected ? (
          <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 px-3 py-1 font-mono text-xs">
            <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
            Подключено {username ? `(@${username})` : ''}
          </Badge>
        ) : (
          <Badge variant="outline" className="border-border text-muted-foreground text-xs">
            Не привязано
          </Badge>
        )}
      </div>

      {error && (
        <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs flex items-center">
          <AlertCircle className="h-4 w-4 mr-2 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {isConnected ? (
        <div className="flex items-center justify-between pt-1">
          <p className="text-xs text-muted-foreground">
            Ваш аккаунт Telegram успешно привязан. Вы будете получать уведомления в бот.
          </p>
          <Button
            variant="outline"
            disabled={disconnecting}
            onClick={handleDisconnect}
            className="border-red-500/30 text-red-400 hover:bg-red-500/10 text-xs min-h-[40px] rounded-xl"
          >
            {disconnecting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Unlink className="h-4 w-4 mr-2" />}
            Отвязать Telegram
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          {!otpData ? (
            <div className="flex items-center justify-between pt-1">
              <p className="text-xs text-muted-foreground">
                Сгенерируйте одноразовый 4-значный код для моментальной привязки Telegram-бота.
              </p>
              <Button
                disabled={generating}
                onClick={handleGenerate}
                className="bg-sky-600 hover:bg-sky-700 text-white font-bold text-xs min-h-[44px] rounded-xl px-5"
              >
                {generating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
                Привязать Telegram
              </Button>
            </div>
          ) : (
            <div className="p-4 rounded-2xl bg-sky-500/10 border border-sky-500/20 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <span className="text-xs text-muted-foreground">Нажмите на код, чтобы скопировать:</span>
                  <button
                    type="button"
                    onClick={() => handleCopyCode(otpData.code)}
                    className="flex items-center space-x-3 mt-1.5 p-2 px-3 rounded-xl bg-sky-500/20 border border-sky-500/40 hover:bg-sky-500/30 transition-all cursor-pointer group active:scale-95"
                    title="Нажмите для копирования"
                  >
                    <span className="text-3xl font-extrabold font-mono text-sky-400 tracking-widest">
                      {otpData.code}
                    </span>
                    {copied ? (
                      <span className="flex items-center text-xs text-emerald-400 font-semibold bg-emerald-500/20 px-2 py-1 rounded-lg">
                        <Check className="h-3.5 w-3.5 mr-1" />
                        Скопировано!
                      </span>
                    ) : (
                      <span className="flex items-center text-xs text-sky-300 opacity-80 group-hover:opacity-100 bg-sky-500/30 px-2 py-1 rounded-lg">
                        <Copy className="h-3.5 w-3.5 mr-1" />
                        Копировать
                      </span>
                    )}
                  </button>
                </div>
                <a href={otpData.deepLink} target="_blank" rel="noreferrer">
                  <Button className="bg-sky-600 hover:bg-sky-700 text-white font-bold text-xs min-h-[44px] rounded-xl px-5">
                    <ExternalLink className="h-4 w-4 mr-2" />
                    Перейти в Telegram Бота
                  </Button>
                </a>
              </div>

              <div className="flex items-center justify-between text-[11px] text-muted-foreground border-t border-sky-500/20 pt-3">
                <span>Код действителен 10 минут. Вы также можете отправить 4 цифры вручную в чат с ботом.</span>
                <button
                  onClick={checkStatus}
                  className="text-sky-400 font-semibold hover:underline flex items-center ml-2"
                >
                  <RefreshCw className="h-3 w-3 mr-1" />
                  Проверить связь
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
