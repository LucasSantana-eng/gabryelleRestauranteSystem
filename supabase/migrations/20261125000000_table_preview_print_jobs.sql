create table if not exists public.table_preview_print_jobs (
    id uuid primary key default gen_random_uuid(),
    requested_by text not null,
    target_id text not null,
    bill jsonb not null,
    status text not null default 'pending' check (status in ('pending', 'printing', 'printed', 'failed')),
    created_at timestamptz not null default now()
);

create index if not exists table_preview_print_jobs_target_pending_idx
    on public.table_preview_print_jobs (target_id, created_at)
    where status = 'pending';

alter table public.table_preview_print_jobs enable row level security;
revoke all on public.table_preview_print_jobs from anon, authenticated;
grant all on public.table_preview_print_jobs to service_role;
