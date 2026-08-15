'use client';

import React, { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Clock,
  Building2,
  RefreshCw,
  LogOut,
  Search,
  UserPlus,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Loader2,
  User,
  Send,
  ArrowRight,
  ShieldCheck,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { signOutAction } from '@/app/(auth)/actions';
import {
  searchCompanyAction,
  submitJoinRequestAction,
  cancelJoinRequestAction,
  getMyJoinRequestsAction,
} from './actions';
import { UnifiedWorkspaceLayout } from '@/components/ui/unified/UnifiedWorkspaceLayout';
import { UnifiedFormModal } from '@/components/ui/unified/UnifiedFormModal';
import { toast } from 'sonner';
import Link from 'next/link';

export default function PendingApplicationPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [isPending, startTransition] = useTransition();

  // Поиск компании
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  // Модалка подачи заявки
  const [selectedCompanyForJoin, setSelectedCompanyForJoin] = useState<any | null>(null);
  const [positionNote, setPositionNote] = useState('Бухгалтер');
  const [isSubmittingJoin, setIsSubmittingJoin] = useState(false);

  // Список заявок
  const [myRequests, setMyRequests] = useState<any[]>([]);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const loadRequests = async () => {
    const res = await getMyJoinRequestsAction();
    if (res.success && res.data) {
      setMyRequests(res.data);
    }
  };

  const checkUserStatus = async () => {
    setLoading(true);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      router.push('/login');
      return;
    }

    const { data: prof } = await supabase
      .from('users')
      .select('company_id, role, role_id, is_super_admin')
      .eq('id', user.id)
      .single();

    if (prof?.is_super_admin || (prof?.company_id && (prof.role === 'owner' || prof.role_id))) {
      router.push('/uchet');
      return;
    }

    await loadRequests();
    setLoading(false);
  };

  useEffect(() => {
    checkUserStatus();
  }, []);

  // Поиск компаний в реальном времени с дебаунсом
  useEffect(() => {
    if (!searchQuery || searchQuery.trim().length < 2) {
      setSearchResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      setIsSearching(true);
      const res = await searchCompanyAction(searchQuery);
      if (res.success && res.data) {
        setSearchResults(res.data);
      }
      setIsSearching(false);
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  const handleOpenJoinModal = (company: any) => {
    setSelectedCompanyForJoin(company);
    setPositionNote('Бухгалтер');
  };

  const handleConfirmSubmitJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCompanyForJoin) return;

    setIsSubmittingJoin(true);
    const res = await submitJoinRequestAction({
      companyId: selectedCompanyForJoin.id,
      positionNote,
    });

    if (res.success) {
      toast.success(`Заявка в компанию «${selectedCompanyForJoin.name}» успешно отправлена!`);
      setSelectedCompanyForJoin(null);
      setSearchQuery('');
      setSearchResults([]);
      await loadRequests();
    } else {
      toast.error(res.error || 'Ошибка отправки заявки');
    }
    setIsSubmittingJoin(false);
  };

  const handleCancelRequest = async (requestId: string) => {
    if (!confirm('Вы действительно хотите отозвать эту заявку на вступление?')) return;

    setCancellingId(requestId);
    const res = await cancelJoinRequestAction(requestId);
    if (res.success) {
      toast.success('Заявка успешно отозвана');
      await loadRequests();
    } else {
      toast.error(res.error || 'Ошибка отзыва заявки');
    }
    setCancellingId(null);
  };

  return (
    <UnifiedWorkspaceLayout
      title="Личный кабинет сотрудника: Подача заявок"
      description="Найдите вашу организацию по ИНН или названию для отправки запроса на присоединение к штату"
      icon={UserPlus}
      actionButtonsSlot={
        <div className="flex items-center space-x-2">
          <Button
            variant="outline"
            onClick={checkUserStatus}
            disabled={loading}
            className="border-border text-xs min-h-[40px]"
          >
            <RefreshCw className={`h-4 w-4 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
            Обновить статус
          </Button>

          <Button
            variant="ghost"
            onClick={() => signOutAction()}
            className="text-xs text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 min-h-[40px]"
          >
            <LogOut className="h-4 w-4 mr-1.5" />
            Выйти
          </Button>
        </div>
      }
    >
      <div className="space-y-6">
        {/* ================= 1. БЛОК ПОИСКА КОМПАНИИ ================= */}
        <Card className="bg-card border-border p-5 md:p-6 space-y-4 shadow-xl">
          <div>
            <h3 className="text-base font-bold text-foreground flex items-center">
              <Search className="h-5 w-5 mr-2 text-sky-400" />
              Поиск организации в Кыргызстане
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Введите 14 цифр ИНН или официальное наименование компании (ОсОО, ИП, ЗАО)
            </p>
          </div>

          <div className="relative">
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Например: 20101202310050 или ОсОО Азия Трейд..."
              className="bg-background border-border text-foreground pr-10 font-mono text-xs sm:text-sm min-h-[44px]"
            />
            {isSearching && (
              <Loader2 className="w-4 h-4 animate-spin text-sky-400 absolute right-3 top-3.5" />
            )}
          </div>

          {/* Результаты поиска */}
          {searchResults.length > 0 && (
            <div className="space-y-2 pt-2">
              <span className="text-xs font-semibold text-muted-foreground">
                Найдено организаций ({searchResults.length}):
              </span>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-72 overflow-y-auto pr-1">
                {searchResults.map((comp) => (
                  <div
                    key={comp.id}
                    className="p-4 rounded-xl bg-background border border-border flex flex-col justify-between space-y-3 hover:border-sky-500/50 transition-all shadow-sm"
                  >
                    <div>
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-sm text-foreground flex items-center">
                          <Building2 className="h-4 w-4 mr-1.5 text-amber-400" />
                          {comp.name}
                        </span>
                        <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-[10px]">
                          Верифицирована
                        </Badge>
                      </div>
                      <p className="text-xs font-mono text-muted-foreground mt-1">ИНН: {comp.inn}</p>
                      {comp.director_name && (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Руководитель: {comp.director_name}
                        </p>
                      )}
                    </div>

                    <Button
                      onClick={() => handleOpenJoinModal(comp)}
                      className="w-full bg-sky-600 hover:bg-sky-500 text-white font-bold text-xs min-h-[36px] rounded-lg"
                    >
                      <UserPlus className="h-3.5 w-3.5 mr-1.5" />
                      Подать заявку на вступление
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {searchQuery.trim().length >= 2 && !isSearching && searchResults.length === 0 && (
            <div className="p-4 rounded-xl bg-background border border-dashed border-border text-center text-xs text-muted-foreground">
              Организации с такими реквизитами не найдены. Убедитесь в правильности ИНН или попросите руководителя зарегистрировать компанию.
            </div>
          )}
        </Card>

        {/* ================= 2. МОИ АКТИВНЫЕ ЗАЯВКИ ================= */}
        <Card className="bg-card border-border p-5 md:p-6 space-y-4 shadow-xl">
          <div className="flex items-center justify-between border-b border-border pb-3">
            <div>
              <h3 className="text-base font-bold text-foreground flex items-center">
                <Clock className="h-5 w-5 mr-2 text-amber-400" />
                Мои заявки на вступление ({myRequests.length})
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                История поданных запросов и их текущий статус рассмотрения
              </p>
            </div>

            <Button
              size="sm"
              variant="ghost"
              onClick={loadRequests}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              <RefreshCw className="h-3.5 w-3.5 mr-1" />
              Обновить
            </Button>
          </div>

          {myRequests.length === 0 ? (
            <div className="text-center py-8 space-y-2 text-muted-foreground">
              <Building2 className="h-10 w-10 mx-auto opacity-40 text-muted-foreground" />
              <p className="text-sm font-semibold">У вас пока нет отправленных заявок</p>
              <p className="text-xs max-w-sm mx-auto">
                Воспользуйтесь поиском выше, чтобы найти организацию и направить запрос на присоединение.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border rounded-xl border border-border bg-background overflow-hidden">
              {myRequests.map((req) => (
                <div
                  key={req.id}
                  className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center space-x-2 flex-wrap">
                      <span className="font-bold text-sm text-foreground">
                        {req.company_name}
                      </span>
                      <span className="text-xs font-mono text-muted-foreground">
                        (ИНН: {req.company_inn})
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Должность / Примечание:{' '}
                      <span className="text-foreground font-medium">
                        {req.position_note || 'Сотрудник'}
                      </span>
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      Дата подачи: {new Date(req.created_at).toLocaleString('ru-RU')}
                    </p>
                  </div>

                  <div className="flex items-center space-x-3 shrink-0">
                    {req.status === 'pending' && (
                      <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 text-xs">
                        ⏳ На рассмотрении
                      </Badge>
                    )}
                    {req.status === 'approved' && (
                      <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-xs">
                        ✅ Одобрена
                      </Badge>
                    )}
                    {req.status === 'rejected' && (
                      <Badge className="bg-rose-500/20 text-rose-400 border-rose-500/30 text-xs">
                        ❌ Отклонена
                      </Badge>
                    )}
                    {req.status === 'cancelled' && (
                      <Badge className="bg-muted text-muted-foreground border-border text-xs">
                        🚫 Отозвана
                      </Badge>
                    )}

                    {req.status === 'pending' && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={cancellingId === req.id}
                        onClick={() => handleCancelRequest(req.id)}
                        className="border-rose-500/30 text-rose-400 hover:bg-rose-500/10 text-xs min-h-[32px]"
                      >
                        {cancellingId === req.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          'Отозвать'
                        )}
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* ================= 3. БЫСТРЫЙ ПЕРЕХОД В ПРОФИЛЬ ================= */}
        <Card className="bg-card border-border p-5 md:p-6 shadow-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <h4 className="text-sm font-bold text-foreground flex items-center">
              <User className="h-4 w-4 mr-2 text-primary" />
              Личные данные и Telegram-уведомления
            </h4>
            <p className="text-xs text-muted-foreground">
              Вы можете изменить пароль, отредактировать личный профиль и привязать Telegram-бота для мгновенных оповещений об одобрении заявок.
            </p>
          </div>

          <Link href="/uchet/profile">
            <Button variant="outline" className="border-border text-xs min-h-[40px] whitespace-nowrap">
              Перейти в Профиль
              <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
            </Button>
          </Link>
        </Card>
      </div>

      {/* ================= МОДАЛКА: ПОДТВЕРЖДЕНИЕ ПОДАЧИ ЗАЯВКИ ================= */}
      {selectedCompanyForJoin && (
        <UnifiedFormModal
          isOpen={!!selectedCompanyForJoin}
          onClose={() => setSelectedCompanyForJoin(null)}
          title={`Подача заявки в организацию`}
          subtitle={selectedCompanyForJoin.name}
          mode="create"
          onSubmit={handleConfirmSubmitJoin}
          isSubmitting={isSubmittingJoin}
          submitText="Отправить заявку Владельцу"
        >
          <div className="space-y-4">
            <div className="p-3 rounded-xl bg-background border border-border space-y-1">
              <span className="text-xs text-muted-foreground block">Выбранная компания:</span>
              <p className="font-bold text-sm text-foreground">{selectedCompanyForJoin.name}</p>
              <p className="text-xs font-mono text-muted-foreground">ИНН: {selectedCompanyForJoin.inn}</p>
            </div>

            <div className="space-y-2">
              <Label className="text-xs text-foreground">Желаемая должность / Комментарий для руководителя *</Label>
              <Input
                value={positionNote}
                onChange={(e) => setPositionNote(e.target.value)}
                placeholder="Бухгалтер по первичке / Менеджер по закупкам..."
                required
                className="bg-background border-border text-foreground text-xs min-h-[44px]"
              />
            </div>

            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Руководитель компании получит мгновенное уведомление в панели управления и в Telegram-боте. После назначения роли ваша рабочая область будет автоматически разблокирована.
            </p>
          </div>
        </UnifiedFormModal>
      )}
    </UnifiedWorkspaceLayout>
  );
}
