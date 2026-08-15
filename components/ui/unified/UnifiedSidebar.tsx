'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  FileText,
  FolderOpen,
  Users,
  Building2,
  Shield,
  CreditCard,
  Settings,
  ChevronLeft,
  ChevronRight,
  LogOut,
  LayoutDashboard,
  HardDrive,
  UserCheck,
  Database,
  Send,
  ArrowLeft,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { UserRole } from '@/types/database.types';

export interface SidebarNavItem {
  title: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string;
  roles?: UserRole[];
  superAdminOnly?: boolean;
}

export interface UnifiedSidebarProps {
  userRole?: UserRole;
  isSuperAdmin?: boolean;
  companyName?: string;
  isOpenMobile?: boolean;
  onCloseMobile?: () => void;
  className?: string;
}

const USER_NAV_ITEMS: SidebarNavItem[] = [
  {
    title: 'Главная Панель',
    href: '/dashboard',
    icon: LayoutDashboard,
  },
  {
    title: 'Документооборот',
    href: '/dashboard/documents',
    icon: FileText,
  },
  {
    title: 'Облачный диск',
    href: '/dashboard/files',
    icon: HardDrive,
  },
  {
    title: 'Контрагенты',
    href: '/dashboard/counterparties',
    icon: Building2,
  },
  {
    title: 'Сотрудники',
    href: '/dashboard/employees',
    icon: Users,
    roles: ['owner', 'accountant'],
  },
  {
    title: 'Профиль организации',
    href: '/dashboard/company',
    icon: Settings,
    roles: ['owner'],
  },
  {
    title: 'Подписка и баланс',
    href: '/dashboard/subscription',
    icon: CreditCard,
    roles: ['owner'],
  },
  {
    title: 'Суперадминка',
    href: '/super-admin/companies',
    icon: Shield,
    superAdminOnly: true,
  },
];

const SUPER_ADMIN_NAV_ITEMS: SidebarNavItem[] = [
  {
    title: 'Главная',
    href: '/super-admin',
    icon: LayoutDashboard,
  },
  {
    title: 'Организации',
    href: '/super-admin/companies',
    icon: Building2,
  },
  {
    title: 'Пользователи',
    href: '/super-admin/users',
    icon: Users,
  },
  {
    title: 'Служебный реестр файлов',
    href: '/super-admin/files',
    icon: HardDrive,
  },
  {
    title: 'Подписки',
    href: '/super-admin/subscriptions',
    icon: CreditCard,
  },
  {
    title: 'Telegram-боты',
    href: '/super-admin/telegram',
    icon: Send,
  },
  {
    title: 'Инспектор БД',
    href: '/super-admin/inspector',
    icon: Database,
  },
  {
    title: '← Рабочий кабинет',
    href: '/dashboard',
    icon: ArrowLeft,
  },
];

const GUEST_NAV_ITEMS: SidebarNavItem[] = [
  {
    title: 'Заявка в компанию',
    href: '/dashboard/pending',
    icon: Building2,
  },
  {
    title: 'Мой профиль',
    href: '/dashboard/profile',
    icon: Settings,
  },
];

export function UnifiedSidebar({
  userRole = 'manager',
  isSuperAdmin = false,
  companyName = 'Организация',
  isOpenMobile = false,
  onCloseMobile,
  className = '',
}: UnifiedSidebarProps) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  const isSuperAdminRoute = pathname.startsWith('/super-admin');
  const isGuestMode = !isSuperAdmin && (!companyName || companyName === 'Организация' || companyName === 'Без организации');

  const filteredNavItems = isSuperAdminRoute
    ? SUPER_ADMIN_NAV_ITEMS
    : isGuestMode
    ? GUEST_NAV_ITEMS
    : USER_NAV_ITEMS.filter((item) => {
        if (item.superAdminOnly && !isSuperAdmin) return false;
        if (item.roles && !item.roles.includes(userRole) && !isSuperAdmin) return false;
        return true;
      });

  const sidebarContent = (
    <div className="flex flex-col h-full bg-card border-r border-border shadow-2xl justify-between transition-all duration-300">
      {/* 1. БРЕНД И ПЕРЕКЛЮЧЕНИЕ СВОРАЧИВАНИЯ */}
      <div>
        <div className="p-4 flex items-center justify-between border-b border-border/80 min-h-[64px]">
          <div className="flex items-center space-x-3 truncate">
            <div className="h-9 w-9 rounded-xl bg-amber-500 flex items-center justify-center text-black font-extrabold text-lg flex-shrink-0 shadow-lg shadow-amber-500/20">
              B
            </div>
            {!collapsed && (
              <div className="truncate">
                <span className="font-bold text-foreground text-sm block truncate">Buhuchet.kg</span>
                <span className="text-[11px] text-muted-foreground truncate block">{companyName}</span>
              </div>
            )}
          </div>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => setCollapsed(!collapsed)}
            className="hidden md:flex h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
          >
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </Button>
        </div>

        {/* 2. НАВИГАЦИОННОЕ МЕНЮ МОДУЛЕЙ */}
        <nav className="p-2 space-y-1 mt-2">
          {filteredNavItems.map((item) => {
            const isActive = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href));
            const Icon = item.icon;

            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onCloseMobile}
                className={`flex items-center space-x-3 px-3 py-2.5 rounded-xl text-xs md:text-sm font-semibold transition-all min-h-[44px] ${
                  isActive
                    ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30 font-bold shadow-md'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'
                }`}
                title={collapsed ? item.title : undefined}
              >
                <Icon className={`h-5 w-5 flex-shrink-0 ${isActive ? 'text-amber-400' : 'text-muted-foreground'}`} />
                {!collapsed && <span className="truncate">{item.title}</span>}
                {!collapsed && item.badge && (
                  <Badge variant="outline" className="ml-auto text-[10px] border-amber-500/30 text-amber-400">
                    {item.badge}
                  </Badge>
                )}
              </Link>
            );
          })}
        </nav>
      </div>

      {/* 3. ПОДВАЛ И БОТ СТАТУС */}
      <div className="p-3 border-t border-border">
        {!collapsed ? (
          <div className="p-2.5 rounded-xl bg-background/60 border border-border flex items-center justify-between text-xs">
            <div className="flex items-center space-x-2 truncate">
              <UserCheck className="h-4 w-4 text-emerald-400 flex-shrink-0" />
              <span className="text-muted-foreground truncate">
                {isSuperAdmin ? 'Суперадмин' : userRole === 'owner' ? 'Владелец' : 'Сотрудник'}
              </span>
            </div>
            <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-[10px]">
              Онлайн
            </Badge>
          </div>
        ) : (
          <div className="flex justify-center">
            <UserCheck className="h-5 w-5 text-emerald-400" />
          </div>
        )}
      </div>
    </div>
  );

  return (
    <>
      {/* ДЕСКТОПНЫЙ СТАЦИОНАРНЫЙ SIDEBAR */}
      <aside
        className={`hidden md:block fixed top-0 left-0 z-40 h-screen transition-all duration-300 ${
          collapsed ? 'w-16' : 'w-64'
        } ${className}`}
      >
        {sidebarContent}
      </aside>

      {/* МОБИЛЬНЫЙ DRAWER OVERLAY */}
      {isOpenMobile && (
        <div className="md:hidden fixed inset-0 z-50 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-72 h-full">{sidebarContent}</div>
          <button
            onClick={onCloseMobile}
            className="absolute top-4 right-4 text-muted-foreground hover:text-foreground p-2"
          >
            ✕
          </button>
        </div>
      )}
    </>
  );
}
