create table if not exists public.online_orders (
    id uuid primary key default gen_random_uuid(),
    client_request_id uuid not null unique,
    tracking_hash text not null,
    status text not null default 'pending'
        check (status in ('pending', 'accepted', 'rejected')),
    payload jsonb not null,
    rejection_reason text,
    pos_imported boolean not null default false,
    created_at timestamptz not null default now()
);

create index if not exists online_orders_pending_created_at_idx
    on public.online_orders (created_at)
    where status = 'pending';

alter table public.online_orders enable row level security;

revoke all on public.online_orders from anon, authenticated;
grant all on public.online_orders to service_role;
