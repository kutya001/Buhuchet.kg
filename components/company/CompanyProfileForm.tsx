'use client';

import React, { useState } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Building2, Mail, Phone, MapPin, User, Shield, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import type { Company, LegalForm } from '@/types/database.types';

interface CompanyProfileFormProps {
  company: Company;
  canEdit: boolean;
  onSave: (data: Partial<Company>) => Promise<{ success: boolean; error?: string }>;
}

export function CompanyProfileForm({ company, canEdit, onSave }: CompanyProfileFormProps) {
  const [name, setName] = useState(company.name || '');
  const [legalForm, setLegalForm] = useState<LegalForm>(company.legal_form || 'ОсОО');
  const [inn, setInn] = useState(company.inn || '');
  const [industry, setIndustry] = useState(company.industry || 'Услуги / Консалтинг');
  const [directorName, setDirectorName] = useState(company.director_name || '');
  const [phone, setPhone] = useState(company.phone || '');
  const [email, setEmail] = useState(company.email || '');
  const [legalAddress, setLegalAddress] = useState(company.legal_address || '');
  const [address, setAddress] = useState(company.address || '');

  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEdit) return;

    setSaving(true);
    setMsg(null);

    const res = await onSave({
      name,
      legal_form: legalForm,
      inn,
      industry,
      director_name: directorName,
      phone,
      email,
      legal_address: legalAddress,
      address,
    });

    setSaving(false);
    if (res.success) {
      setMsg({ type: 'success', text: 'Реквизиты организации успешно сохранены' });
    } else {
      setMsg({ type: 'error', text: res.error || 'Ошибка при сохранении профиля' });
    }
  };

  return (
    <Card className="bg-card/80 border-border rounded-2xl shadow-xl">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <CardTitle className="text-lg font-bold flex items-center gap-2">
              <Building2 className="w-5 h-5 text-primary" />
              <span>Юридические Реквизиты и Профиль</span>
            </CardTitle>
            <CardDescription className="text-xs text-muted-foreground">
              Официальные регистрационные данные организации в Кыргызской Республике
            </CardDescription>
          </div>

          <Badge variant="outline" className="font-mono text-xs px-2.5 py-1 border-primary/40 bg-primary/10 text-primary">
            ИНН: {company.inn}
          </Badge>
        </div>
      </CardHeader>

      <CardContent>
        {msg && (
          <div className={`p-3 rounded-xl mb-4 border text-xs flex items-center gap-2 ${
            msg.type === 'success' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 'bg-red-500/10 border-red-500/30 text-red-400'
          }`}>
            {msg.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
            <span>{msg.text}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* ОПФ */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Организационно-правовая форма (ОПФ)</Label>
              <select
                disabled={!canEdit}
                value={legalForm}
                onChange={(e) => setLegalForm(e.target.value as LegalForm)}
                className="w-full h-10 px-3 rounded-xl bg-muted/40 border border-border text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-60"
              >
                <option value="ОсОО">ОсОО (Общество с ограниченной ответственностью)</option>
                <option value="ИП">ИП (Индивидуальный Предприниматель)</option>
                <option value="ЗАО">ЗАО (Закрытое Акционерное Общество)</option>
                <option value="ОАО">ОАО (Открытое Акционерное Общество)</option>
              </select>
            </div>

            {/* Наименование */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Наименование Организации</Label>
              <Input
                disabled={!canEdit}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder='ОсОО "Компания"'
                className="h-10 text-xs bg-muted/40 rounded-xl"
              />
            </div>

            {/* ИНН */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">ИНН КР (14 цифр)</Label>
              <Input
                disabled={!canEdit}
                value={inn}
                onChange={(e) => setInn(e.target.value)}
                placeholder="20101202310050"
                maxLength={14}
                className="h-10 text-xs font-mono bg-muted/40 rounded-xl"
              />
            </div>

            {/* Отрасль */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Сфера Деятельности / Отрасль</Label>
              <Input
                disabled={!canEdit}
                value={industry}
                onChange={(e) => setIndustry(e.target.value)}
                placeholder="Услуги / Консалтинг / Оптовая торговля"
                className="h-10 text-xs bg-muted/40 rounded-xl"
              />
            </div>

            {/* Руководитель */}
            <div className="space-y-1.5 sm:col-span-2">
              <Label className="text-xs font-semibold">ФИО Руководителя / Директора</Label>
              <div className="relative">
                <User className="w-4 h-4 absolute left-3 top-3 text-muted-foreground" />
                <Input
                  disabled={!canEdit}
                  value={directorName}
                  onChange={(e) => setDirectorName(e.target.value)}
                  placeholder="Иванов Иван Иванович"
                  className="h-10 text-xs pl-9 bg-muted/40 rounded-xl"
                />
              </div>
            </div>

            {/* Телефон */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Контактный Телефон</Label>
              <div className="relative">
                <Phone className="w-4 h-4 absolute left-3 top-3 text-muted-foreground" />
                <Input
                  disabled={!canEdit}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+996 (555) 00-00-00"
                  className="h-10 text-xs pl-9 bg-muted/40 rounded-xl"
                />
              </div>
            </div>

            {/* Email */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Рабочий E-mail</Label>
              <div className="relative">
                <Mail className="w-4 h-4 absolute left-3 top-3 text-muted-foreground" />
                <Input
                  disabled={!canEdit}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="info@company.kg"
                  className="h-10 text-xs pl-9 bg-muted/40 rounded-xl"
                />
              </div>
            </div>

            {/* Юридический Адрес */}
            <div className="space-y-1.5 sm:col-span-2">
              <Label className="text-xs font-semibold">Юридический Адрес (по документу)</Label>
              <div className="relative">
                <MapPin className="w-4 h-4 absolute left-3 top-3 text-muted-foreground" />
                <Input
                  disabled={!canEdit}
                  value={legalAddress}
                  onChange={(e) => setLegalAddress(e.target.value)}
                  placeholder="г. Бишкек, ул. Киевская, 120"
                  className="h-10 text-xs pl-9 bg-muted/40 rounded-xl"
                />
              </div>
            </div>

            {/* Фактический Адрес */}
            <div className="space-y-1.5 sm:col-span-2">
              <Label className="text-xs font-semibold">Фактический / Офисный Адрес</Label>
              <div className="relative">
                <Building2 className="w-4 h-4 absolute left-3 top-3 text-muted-foreground" />
                <Input
                  disabled={!canEdit}
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="г. Бишкек, пр. Чуй, 245, офис 402"
                  className="h-10 text-xs pl-9 bg-muted/40 rounded-xl"
                />
              </div>
            </div>
          </div>

          {canEdit && (
            <div className="pt-2 flex justify-end">
              <Button type="submit" disabled={saving} className="rounded-xl h-10 text-xs font-bold gap-2 px-6">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Shield className="w-4 h-4" />}
                <span>Сохранить реквизиты</span>
              </Button>
            </div>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
