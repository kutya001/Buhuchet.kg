'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, FileText, HardDrive, Building2, User } from 'lucide-react';

export function UnifiedBottomNav() {
  const pathname = usePathname();

  const navItems = [
    { label: 'Главная', href: '/uchet', icon: LayoutDashboard },
    { label: 'Документооборот', href: '/uchet/documents', icon: FileText },
    { label: 'Диск', href: '/uchet/files', icon: HardDrive },
    { label: 'Партнеры', href: '/uchet/counterparties', icon: Building2 },
    { label: 'Профиль', href: '/uchet/profile', icon: User },
  ];

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-card/95 backdrop-blur-lg border-t border-border px-2 py-1 flex items-center justify-around shadow-2xl min-h-[60px]">
      {navItems.map((item) => {
        const isActive = pathname === item.href || (item.href !== '/uchet' && pathname.startsWith(item.href));
        const Icon = item.icon;

        return (
          <Link
            key={item.href}
            href={item.href}
            className={`flex flex-col items-center justify-center py-1 px-2 rounded-xl transition-all min-h-[48px] min-w-[48px] ${
              isActive ? 'text-amber-400 font-bold' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Icon className={`h-5 w-5 ${isActive ? 'scale-110 text-amber-400' : ''}`} />
            <span className="text-[10px] mt-0.5 font-medium">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
