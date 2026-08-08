# SUPABASE.md — Инструкция по работе с Supabase & MCP

Этот документ содержит стандарты работы с Supabase, конфигурацию MCP-инструментов, настройки аутентификации и правила генерации типов для Next.js App Router

---

## 1. КОНФИГУРАЦИЯ И ДАННЫЕ ПРОЕКТА
- **Project Ref (ID):** `hpfemrvqmlvhqbdmogcl`
- **MCP Server URL:** `https://mcp.supabase.com/mcp?project_ref=hpfemrvqmlvhqbdmogcl`

### Переменные окружения (`.env.local`):
```env
NEXT_PUBLIC_SUPABASE_URL=[https://hpfemrvqmlvhqbdmogcl.supabase.co](https://hpfemrvqmlvhqbdmogcl.supabase.co)
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_GDQc1xywOWgvo-e3BjSa5w_PgUPJkK4
SUPABASE_SERVICE_ROLE_KEY=твой_секретный_service_role_ключ

supabase login
supabase init
supabase link --project-ref hpfemrvqmlvhqbdmogcl

postgresql://postgres:[YOUR-PASSWORD]@db.hpfemrvqmlvhqbdmogcl.supabase.co:5432/postgres
