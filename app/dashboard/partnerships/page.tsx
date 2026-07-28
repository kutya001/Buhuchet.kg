'use client';

import React, { useState, useEffect, useTransition } from 'react';
import { Card, CardContent } from '@/components/ui/card';
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
  Users,
  Inbox,
  Send,
  Building2,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { respondToPartnershipRequestAction } from './actions';
import type { CompanyPartnership, Company } from '@/types/database.types';

type ExtendedPartnership = CompanyPartnership & {
  requester_company?: Company | null;
  target_company?: Company | null;
};

export default function PartnershipsPage() {
  const [activeTab, setActiveTab] = useState<'inbox' | 'outbox'>('inbox');
  const [partnerships, setPartnerships] = useState<ExtendedPartnership[]>([]);
  const [currentCompanyId, setCurrentCompanyId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [isPending, startTransition] = useTransition();

  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const supabase = createClient();

  const loadPartnerships = async () => {
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

    if (myCompanyId) {
      const { data } = await supabase
        .from('company_partnerships')
        .select('*, requester_company:companies!requester_company_id(*), target_company:companies!target_company_id(*)')
        .or(`requester_company_id.eq.${myCompanyId},target_company_id.eq.${myCompanyId}`)
        .order('updated_at', { ascending: false });

      if (data) {
        setPartnerships(data as ExtendedPartnership[]);
      }
    }

    setLoading(false);
  };

  useEffect(() => {
    loadPartnerships();
  }, []);

  const handleRespond = (partnershipId: string, status: 'approved' | 'rejected', compName?: string) => {
    setMsg(null);
    startTransition(async () => {
      const res = await respondToPartnershipRequestAction(partnershipId, status);
      if (res.success) {
        setMsg({
          type: 'success',
          text: status === 'approved' ? `Партнерство с компанией "${compName}" принята!` : 'Заявка отклонена',
        });
        loadPartnerships();
      } else {
        setMsg({ type: 'error', text: res.error || 'Ошибка при ответе на заявку' });
      }
    });
  };

  const inboxRequests = partnerships.filter((p) => p.target_company_id === currentCompanyId);
  const outboxRequests = partnerships.filter((p) => p.requester_company_id === currentCompanyId);

  const currentList = activeTab === 'inbox' ? inboxRequests : outboxRequests;

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white tracking-tight flex items-center">
            <Users className="h-6 w-6 mr-2 text-purple-400" />
            Заявки на B2B Сотрудничество
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            Подтверждение двустороннего партнерства для обмена документами
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

      {/* Вкладки */}
      <div className="flex items-center space-x-2 border-b border-slate-800 pb-2">
        <button
          onClick={() => setActiveTab('inbox')}
          className={`flex items-center space-x-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
            activeTab === 'inbox'
              ? 'bg-purple-600/20 text-purple-400 border border-purple-500/30'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
          }`}
        >
          <Inbox className="h-4 w-4" />
          <span>Входящие заявки ({inboxRequests.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('outbox')}
          className={`flex items-center space-x-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
            activeTab === 'outbox'
              ? 'bg-blue-600/20 text-blue-400 border border-blue-500/30'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
          }`}
        >
          <Send className="h-4 w-4" />
          <span>Исходящие заявки ({outboxRequests.length})</span>
        </button>
      </div>

      {/* Таблица Заявок */}
      <Card className="bg-slate-900/40 border-slate-800 overflow-hidden">
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center p-12 text-slate-400">
              <Loader2 className="h-6 w-6 animate-spin mr-2" />
              <span>Загрузка заявок на партнерство...</span>
            </div>
          ) : currentList.length === 0 ? (
            <div className="p-12 text-center text-slate-500">
              {activeTab === 'inbox' ? 'Входящих заявок на сотрудничество пока нет' : 'Исходящих заявок пока нет'}
            </div>
          ) : (
            <Table>
              <TableHeader className="bg-slate-950/60">
                <TableRow>
                  <TableHead>Организация-партнер</TableHead>
                  <TableHead>ИНН КР</TableHead>
                  <TableHead>Отрасль</TableHead>
                  <TableHead>Дата Заявки</TableHead>
                  <TableHead>Статус</TableHead>
                  <TableHead className="text-right">Действие</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {currentList.map((p) => {
                  const partnerComp =
                    activeTab === 'inbox' ? p.requester_company : p.target_company;

                  return (
                    <TableRow key={p.id}>
                      <TableCell>
                        <div className="font-semibold text-white text-sm flex items-center space-x-1.5">
                          <Building2 className="h-4 w-4 text-purple-400 flex-shrink-0" />
                          <span>{partnerComp?.name || '—'}</span>
                        </div>
                      </TableCell>

                      <TableCell className="font-mono text-sm text-slate-300 font-bold">
                        {partnerComp?.inn || '—'}
                      </TableCell>

                      <TableCell>
                        <Badge variant="outline" className="border-slate-800 text-slate-300">
                          {partnerComp?.industry || 'Услуги / Консалтинг'}
                        </Badge>
                      </TableCell>

                      <TableCell className="font-mono text-xs text-slate-400">
                        {new Date(p.created_at).toLocaleDateString('ru-RU')}
                      </TableCell>

                      <TableCell>
                        {p.status === 'approved' && <Badge variant="success">Одобрено</Badge>}
                        {p.status === 'pending' && <Badge variant="warning">На рассмотрении</Badge>}
                        {p.status === 'rejected' && <Badge variant="destructive">Отклонено</Badge>}
                      </TableCell>

                      <TableCell className="text-right">
                        {activeTab === 'inbox' && p.status === 'pending' && (
                          <div className="flex items-center justify-end space-x-2">
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() => handleRespond(p.id, 'rejected')}
                              disabled={isPending}
                              className="text-xs"
                            >
                              <XCircle className="h-3.5 w-3.5 mr-1" />
                              Отклонить
                            </Button>
                            <Button
                              size="sm"
                              onClick={() => handleRespond(p.id, 'approved', partnerComp?.name)}
                              disabled={isPending}
                              className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs"
                            >
                              <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                              Принять партнерство
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
