'use client';

import React, { useState, useEffect, useTransition } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Building2, Save, Loader2, CheckCircle2, AlertCircle, ShieldCheck } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { INDUSTRIES, type Company } from '@/types/database.types';

export default function CompanySettingsPage() {
  const [company, setCompany] = useState<Company | null>(null);
  const [loading, setLoading] = useState(true);
  const [isPending, startTransition] = useTransition();

  const [name, setName] = useState('');
  const [inn, setInn] = useState('');
  const [industry, setIndustry] = useState('Услуги / Консалтинг');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');

  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const supabase = createClient();

  useEffect(() => {
    async function loadCompany() {
      setLoading(true);
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (user) {
        const { data: prof } = await supabase
          .from('users')
          .select('company_id, companies(*)')
          .eq('id', user.id)
          .single();

        const comp = Array.isArray(prof?.companies) ? prof?.companies[0] : prof?.companies;
        if (comp) {
          setCompany(comp as Company);
          setName(comp.name);
          setInn(comp.inn);
          setIndustry(comp.industry || 'Услуги / Консалтинг');
          setPhone(comp.phone || '');
          setAddress(comp.address || '');
        }
      }
      setLoading(false);
    }

    loadCompany();
  }, []);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!company) return;

    setMsg(null);
    startTransition(async () => {
      const { error } = await supabase
        .from('companies')
        .update({
          name,
          industry,
          phone: phone || null,
          address: address || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', company.id);

      if (!error) {
        setMsg({ type: 'success', text: 'Реквизиты организации успешно обновлены' });
      } else {
        setMsg({ type: 'error', text: error.message || 'Ошибка сохранения' });
      }
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-400">
        <Loader2 className="h-8 w-8 animate-spin mr-2" />
        <span>Загрузка профиля компании...</span>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white tracking-tight flex items-center">
          <Building2 className="h-6 w-6 mr-2 text-amber-400" />
          Моя Организация & Реквизиты
        </h2>
        <p className="text-sm text-slate-400 mt-1">
          Настройки профиля юрлица, ИНН КР и Отрасли в B2B платформе
        </p>
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

      <Card className="bg-slate-900/40 border-slate-800">
        <form onSubmit={handleSave}>
          <CardHeader>
            <CardTitle className="text-lg">Официальные Данные Юридического Лица</CardTitle>
            <CardDescription>ИНН проверяется по реестру ГНС Кыргызстана</CardDescription>
          </CardHeader>

          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Официальное Наименование Организации *</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                className="bg-slate-950 border-slate-800 text-slate-100 font-semibold"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="inn">ИНН КР (14 цифр) *</Label>
                <div className="relative">
                  <Input
                    id="inn"
                    value={inn}
                    disabled
                    readOnly
                    className="bg-slate-950/60 border-slate-800 text-slate-400 font-mono"
                  />
                  <ShieldCheck className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-emerald-400" />
                </div>
                <p className="text-[10px] text-slate-500">Зафиксирован в налоговой системе КР</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="industry">Отрасль Организации *</Label>
                <select
                  id="industry"
                  value={industry}
                  onChange={(e) => setIndustry(e.target.value)}
                  className="w-full h-10 rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-amber-500"
                >
                  {INDUSTRIES.map((ind) => (
                    <option key={ind} value={ind}>
                      {ind}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
              <div className="space-y-2">
                <Label htmlFor="phone">Контактный Телефон</Label>
                <Input
                  id="phone"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+996 (555) 00-11-22"
                  className="bg-slate-950 border-slate-800 text-slate-100 font-mono"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="address">Юридический Адрес</Label>
                <Input
                  id="address"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="г. Бишкек, ул. Чуй 120"
                  className="bg-slate-950 border-slate-800 text-slate-100"
                />
              </div>
            </div>
          </CardContent>

          <CardFooter className="pt-4 pb-6 flex justify-end border-t border-slate-800">
            <Button
              type="submit"
              disabled={isPending}
              className="bg-amber-600 hover:bg-amber-500 text-white font-medium shadow-lg shadow-amber-600/20"
            >
              {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
              Сохранить реквизиты
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
