'use client';

import React, { useState, useEffect, useTransition } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';
import {
  UserCheck,
  UserPlus,
  Clock,
  CheckCircle2,
  XCircle,
  Building2,
  Search,
  Loader2,
  AlertCircle,
  Inbox,
  Send,
  Globe,
} from 'lucide-react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import {
  sendPartnershipRequestAction,
  respondToPartnershipRequestAction,
} from './actions';
import type { CompanyPartnership, Company } from '@/types/database.types';

export default function PartnershipsPage() {
  const [activeTab, setActiveTab] = useState<'inbox' | 'outbox' | 'catalog'>('inbox');
  const [partnerships, setPartnerships] = useState<CompanyPartnership[]>([]);
  const [allCompanies, setAllCompanies] = useState<Company[]>([]);
  const [currentCompanyId, setCurrentCompanyId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [isPending, startTransition] = useTransition();

  const [searchTerm, setSearchTerm] = useState('');
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const supabase = createClient();

  const loadData = async () => {
    setLoading(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    let myCompanyId = '';
    if (user) {
      const { data: prof } = await supabase.from('users').select('company_id').eq('id', user.id).single();
      if (prof?.company_id) {
        myCompanyId = prof.company_id;
        setCurrentCompanyId(prof.company_id);
      }
    }

    // 1. Все заявки компании
    if (myCompanyId) {
      const { data: partData } = await supabase
        .from('company_partnerships')
        .select('*, requester_company:companies!requester_company_id(*), target_company:companies!target_company_id(*)')
        .or(`requester_company_id.eq.${myCompanyId},target_company_id.eq.${myCompanyId}`)
        .order('created_at', { ascending: false });

      if (partData) {
        setPartnerships(partData as CompanyPartnership[]);
      }
    }

    // 2. Каталог зарегистрированных компаний КР
    const { data: compData } = await supabase
      .from('companies')
      .select('*')
      .eq('is_active', true)
      .order('name');

    if (compData) {
      setAllCompanies((compData as Company[]).filter((c) => c.id !== myCompanyId));
    }

    setLoading(false);
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleRespond = (partnershipId: string, status: 'approved' | 'rejected') => {
    setMsg(null);
    startTransition(async () => {
      const res = await respondToPartnershipRequestAction(partnershipId, status);
      if (res.success) {
        setMsg({
          type: 'success',
          text: status === 'approved' ? 'Заявка на партнерство одобрена!' : 'Заявка отклонена',
        });
        loadData();
      } else {
        setMsg({ type: 'error', text: res.error || 'Ошибка смены статуса' });
      }
    });
  };

  const handleSendRequest = (targetCompanyId: string, companyName: string) => {
    setMsg(null);
    startTransition(async () => {
      const res = await sendPartnershipRequestAction(targetCompanyId);
      if (res.success) {
        setMsg({ type: 'success', text: `Заявка отправлена компании "${companyName}"` });
        loadData();
      } else {
        setMsg({ type: 'error', text: res.error || 'Ошибка отправки заявки' });
      }
    });
  };

  const inboxRequests = partnerships.filter((p) => p.target_company_id === currentCompanyId);
  const outboxRequests = partnerships.filter((p) => p.requester_company_id === currentCompanyId);

  const getPartnershipState = (companyId: string) => {
    const found = partnerships.find(
      (p) =>
        (p.requester_company_id === currentCompanyId && p.target_company_id === companyId) ||
        (p.target_company_id === currentCompanyId && p.requester_company_id === companyId)
    );
    return found ? found.status : null;
  };

  return (
    <div className="space-y-4 md:space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl md:text-2xl font-bold text-white tracking-tight flex items-center">
            <UserCheck className="h-5 w-5 md:h-6 md:w-6 mr-2 text-purple-400" />
            Заявки на B2B Партнерство
          </h2>
          <p className="text-xs md:text-sm text-slate-400 mt-0.5">
            Подтвердите сотрудничество для открытия возможности обмена сканами
          </p>
        </div>
      </div>

      {msg && (
        <Alert
          variant={msg.type === 'success' ? 'success' : 'destructive'}
          className={
            msg.type === 'success'
              ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-400'
              : 'border-red-500/50 bg-red-500/10 text-red-400'
          }
        >
          {msg.type === 'success' ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
          <AlertDescription>{msg.text}</AlertDescription>
        </Alert>
      )}

      {/* МОБИЛЬНЫЕ SEGMENTED CONTROLS (Крупные тач-зоны под палец на смартфонах) */}
      <div className="bg-slate-900/60 p-1 rounded-2xl border border-slate-800 flex items-center justify-between">
        <button
          onClick={() => setActiveTab('inbox')}
          className={`flex-1 flex items-center justify-center space-x-2 py-3 rounded-xl text-xs md:text-sm font-semibold transition-all min-h-[48px] ${
            activeTab === 'inbox'
              ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/30'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Inbox className="h-4 w-4" />
          <span>Входящие ({inboxRequests.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('outbox')}
          className={`flex-1 flex items-center justify-center space-x-2 py-3 rounded-xl text-xs md:text-sm font-semibold transition-all min-h-[48px] ${
            activeTab === 'outbox'
              ? 'bg-purple-600 text-white shadow-lg shadow-purple-600/30'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Send className="h-4 w-4" />
          <span>Исходящие ({outboxRequests.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('catalog')}
          className={`flex-1 flex items-center justify-center space-x-2 py-3 rounded-xl text-xs md:text-sm font-semibold transition-all min-h-[48px] ${
            activeTab === 'catalog'
              ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-600/30'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Globe className="h-4 w-4" />
          <span>Поиск партнеров</span>
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center p-12 text-slate-400">
          <Loader2 className="h-6 w-6 animate-spin mr-2" />
          <span>Загрузка заявок на партнерство...</span>
        </div>
      ) : (
        <>
          {/* 1. Входящие Заявки */}
          {activeTab === 'inbox' && (
            <div className="space-y-3">
              {inboxRequests.length === 0 ? (
                <div className="p-8 text-center text-slate-500 text-xs bg-slate-900/40 rounded-2xl border border-slate-800">
                  Входящие заявки на партнерство отсутствуют
                </div>
              ) : (
                inboxRequests.map((req) => (
                  <Card key={req.id} className="bg-slate-900/60 border-slate-800 p-4 space-y-3">
                    <div className="flex items-start justify-between">
                      <div>
                        <h4 className="font-bold text-white text-sm flex items-center">
                          <Building2 className="h-4 w-4 text-blue-400 mr-1.5 flex-shrink-0" />
                          <span>{req.requester_company?.name || 'Организация'}</span>
                        </h4>
                        <p className="text-[11px] font-mono text-amber-400 mt-0.5">ИНН: {req.requester_company?.inn}</p>
                      </div>

                      <Badge
                        variant={
                          req.status === 'approved'
                            ? 'success'
                            : req.status === 'rejected'
                            ? 'destructive'
                            : 'warning'
                        }
                      >
                        {req.status === 'approved' ? 'Подтверждено' : req.status === 'pending' ? 'На рассмотрении' : 'Отклонено'}
                      </Badge>
                    </div>

                    {req.status === 'pending' && (
                      <div className="flex items-center justify-end space-x-2 pt-2 border-t border-slate-800/60">
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => handleRespond(req.id, 'rejected')}
                          disabled={isPending}
                          className="min-h-[44px] text-xs"
                        >
                          <XCircle className="h-4 w-4 mr-1" />
                          Отклонить
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => handleRespond(req.id, 'approved')}
                          disabled={isPending}
                          className="bg-emerald-600 hover:bg-emerald-500 text-white min-h-[44px] text-xs font-bold"
                        >
                          <CheckCircle2 className="h-4 w-4 mr-1" />
                          Подтвердить партнерство
                        </Button>
                      </div>
                    )}
                  </Card>
                ))
              )}
            </div>
          )}

          {/* 2. Исходящие Заявки */}
          {activeTab === 'outbox' && (
            <div className="space-y-3">
              {outboxRequests.length === 0 ? (
                <div className="p-8 text-center text-slate-500 text-xs bg-slate-900/40 rounded-2xl border border-slate-800">
                  Вы пока не отправляли заявок на партнерство
                </div>
              ) : (
                outboxRequests.map((req) => (
                  <Card key={req.id} className="bg-slate-900/60 border-slate-800 p-4 space-y-3">
                    <div className="flex items-start justify-between">
                      <div>
                        <h4 className="font-bold text-white text-sm flex items-center">
                          <Building2 className="h-4 w-4 text-purple-400 mr-1.5 flex-shrink-0" />
                          <span>{req.target_company?.name || 'Организация'}</span>
                        </h4>
                        <p className="text-[11px] font-mono text-slate-400 mt-0.5">ИНН: {req.target_company?.inn}</p>
                      </div>

                      <Badge
                        variant={
                          req.status === 'approved'
                            ? 'success'
                            : req.status === 'rejected'
                            ? 'destructive'
                            : 'warning'
                        }
                      >
                        {req.status === 'approved' ? 'Подтверждено' : req.status === 'pending' ? 'Ожидает ответа' : 'Отклонено'}
                      </Badge>
                    </div>
                  </Card>
                ))
              )}
            </div>
          )}

          {/* 3. Поиск новых партнеров в каталоге */}
          {activeTab === 'catalog' && (
            <div className="space-y-4">
              <Card className="bg-slate-900/40 border-slate-800 p-3">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                  <Input
                    placeholder="Поиск организации по названию или ИНН..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-9 bg-slate-950/60 border-slate-800 text-slate-100 text-xs md:text-sm min-h-[44px]"
                  />
                </div>
              </Card>

              <div className="space-y-3">
                {allCompanies
                  .filter((c) => c.name.toLowerCase().includes(searchTerm.toLowerCase()) || c.inn.includes(searchTerm))
                  .map((comp) => {
                    const pState = getPartnershipState(comp.id);

                    return (
                      <Card key={comp.id} className="bg-slate-900/60 border-slate-800 p-4 space-y-3">
                        <div className="flex items-start justify-between">
                          <div>
                            <h4 className="font-bold text-white text-sm flex items-center">
                              <Building2 className="h-4 w-4 text-blue-400 mr-1.5 flex-shrink-0" />
                              <span>{comp.name}</span>
                            </h4>
                            <p className="text-[11px] font-mono text-slate-400 mt-0.5">ИНН: {comp.inn}</p>
                          </div>
                          <Badge variant="outline" className="text-[10px] border-slate-800 text-slate-300">
                            {comp.industry || 'Услуги'}
                          </Badge>
                        </div>

                        <div className="flex items-center justify-between pt-2 border-t border-slate-800/60">
                          {pState === 'approved' && (
                            <span className="text-xs text-emerald-400 font-medium flex items-center">
                              <UserCheck className="h-4 w-4 mr-1" />
                              Партнеры
                            </span>
                          )}
                          {pState === 'pending' && (
                            <span className="text-xs text-amber-400 font-medium flex items-center">
                              <Clock className="h-4 w-4 mr-1" />
                              Заявка отправлена
                            </span>
                          )}
                          {!pState && (
                            <Button
                              size="sm"
                              onClick={() => handleSendRequest(comp.id, comp.name)}
                              disabled={isPending}
                              className="w-full sm:w-auto bg-blue-600 hover:bg-blue-500 text-white text-xs min-h-[44px]"
                            >
                              <UserPlus className="h-4 w-4 mr-1.5" />
                              Запросить сотрудничество
                            </Button>
                          )}
                        </div>
                      </Card>
                    );
                  })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
