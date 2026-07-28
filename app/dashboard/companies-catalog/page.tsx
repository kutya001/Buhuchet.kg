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
  Globe,
  Search,
  Building2,
  UserCheck,
  Clock,
  UserPlus,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Filter,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { sendPartnershipRequestAction } from '../partnerships/actions';
import { INDUSTRIES, type Company, type CompanyPartnership } from '@/types/database.types';

export default function CompaniesCatalogPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [partnerships, setPartnerships] = useState<CompanyPartnership[]>([]);
  const [currentCompanyId, setCurrentCompanyId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [isPending, startTransition] = useTransition();

  const [searchTerm, setSearchTerm] = useState('');
  const [selectedIndustry, setSelectedIndustry] = useState<string>('all');

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

    // 1. Все зарегистрированные компании
    const { data: compData } = await supabase
      .from('companies')
      .select('*')
      .eq('is_active', true)
      .order('name');

    if (compData) {
      setCompanies((compData as Company[]).filter((c) => c.id !== myCompanyId));
    }

    // 2. Все партнерские связи текущей компании
    if (myCompanyId) {
      const { data: partData } = await supabase
        .from('company_partnerships')
        .select('*')
        .or(`requester_company_id.eq.${myCompanyId},target_company_id.eq.${myCompanyId}`);

      if (partData) {
        setPartnerships(partData as CompanyPartnership[]);
      }
    }

    setLoading(false);
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleSendRequest = (targetCompanyId: string, companyName: string) => {
    setMsg(null);
    startTransition(async () => {
      const res = await sendPartnershipRequestAction(targetCompanyId);
      if (res.success) {
        setMsg({ type: 'success', text: `Заявка на сотрудничество отправлена компании "${companyName}"` });
        loadData();
      } else {
        setMsg({ type: 'error', text: res.error || 'Ошибка отправки заявки' });
      }
    });
  };

  const getPartnershipState = (companyId: string) => {
    const found = partnerships.find(
      (p) =>
        (p.requester_company_id === currentCompanyId && p.target_company_id === companyId) ||
        (p.target_company_id === currentCompanyId && p.requester_company_id === companyId)
    );
    return found ? found.status : null;
  };

  const filteredCompanies = companies.filter((c) => {
    const matchesSearch =
      c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.inn.includes(searchTerm);

    const matchesIndustry =
      selectedIndustry === 'all' || (c.industry || 'Услуги / Консалтинг') === selectedIndustry;

    return matchesSearch && matchesIndustry;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white tracking-tight flex items-center">
            <Globe className="h-6 w-6 mr-2 text-blue-400" />
            Каталог Организаций Платформы B2B
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            Поиск контрагентов по Отраслям КР и отправка заявок на прямое сотрудничество
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

      {/* Фильтры */}
      <Card className="bg-slate-900/40 border-slate-800 p-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
            <Input
              placeholder="Поиск по наименованию, ИНН 14 цифр..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 bg-slate-950/60 border-slate-800 text-slate-100 text-sm"
            />
          </div>

          <div>
            <select
              value={selectedIndustry}
              onChange={(e) => setSelectedIndustry(e.target.value)}
              className="w-full h-10 rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">Все отрасли Кыргызстана</option>
              {INDUSTRIES.map((ind) => (
                <option key={ind} value={ind}>
                  {ind}
                </option>
              ))}
            </select>
          </div>
        </div>
      </Card>

      {/* Реестр Организаций */}
      <Card className="bg-slate-900/40 border-slate-800 overflow-hidden">
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center p-12 text-slate-400">
              <Loader2 className="h-6 w-6 animate-spin mr-2" />
              <span>Загрузка каталога компаний...</span>
            </div>
          ) : filteredCompanies.length === 0 ? (
            <div className="p-12 text-center text-slate-500">
              Организации по вашему запросу не найдены
            </div>
          ) : (
            <Table>
              <TableHeader className="bg-slate-950/60">
                <TableRow>
                  <TableHead>Организация</TableHead>
                  <TableHead>ИНН КР (14 цифр)</TableHead>
                  <TableHead>Отрасль</TableHead>
                  <TableHead>Статус Партнерства</TableHead>
                  <TableHead className="text-right">Действие</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredCompanies.map((company) => {
                  const pState = getPartnershipState(company.id);

                  return (
                    <TableRow key={company.id}>
                      <TableCell>
                        <div className="font-semibold text-white text-sm flex items-center space-x-1.5">
                          <Building2 className="h-4 w-4 text-blue-400 flex-shrink-0" />
                          <span>{company.name}</span>
                        </div>
                      </TableCell>

                      <TableCell className="font-mono text-sm text-slate-300 font-bold">
                        {company.inn}
                      </TableCell>

                      <TableCell>
                        <Badge variant="outline" className="border-slate-800 text-slate-300 bg-slate-950/60">
                          {company.industry || 'Услуги / Консалтинг'}
                        </Badge>
                      </TableCell>

                      <TableCell>
                        {pState === 'approved' && (
                          <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                            <UserCheck className="h-3.5 w-3.5 mr-1" />
                            Партнерство подтверждено
                          </span>
                        )}
                        {pState === 'pending' && (
                          <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">
                            <Clock className="h-3.5 w-3.5 mr-1" />
                            Заявка на рассмотрении
                          </span>
                        )}
                        {!pState && (
                          <span className="text-xs text-slate-500 font-mono">Не связано</span>
                        )}
                      </TableCell>

                      <TableCell className="text-right">
                        {!pState && (
                          <Button
                            size="sm"
                            onClick={() => handleSendRequest(company.id, company.name)}
                            disabled={isPending}
                            className="bg-blue-600 hover:bg-blue-500 text-white text-xs"
                          >
                            {isPending ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                            ) : (
                              <UserPlus className="h-3.5 w-3.5 mr-1" />
                            )}
                            Запросить сотрудничество
                          </Button>
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
