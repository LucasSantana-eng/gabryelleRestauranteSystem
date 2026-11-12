begin;

create table if not exists public.online_orders (
    id uuid primary key default gen_random_uuid(),
    client_request_id uuid,
    tracking_hash text,
    status text not null default 'pending',
    payload jsonb not null default '{}'::jsonb,
    rejection_reason text,
    pos_imported boolean not null default false,
    created_at timestamptz not null default now()
);

alter table public.online_orders
    add column if not exists id uuid,
    add column if not exists client_request_id uuid,
    add column if not exists tracking_hash text,
    add column if not exists status text not null default 'pending',
    add column if not exists payload jsonb not null default '{}'::jsonb,
    add column if not exists rejection_reason text,
    add column if not exists pos_imported boolean not null default false,
    add column if not exists created_at timestamptz not null default now();

update public.online_orders
set id = gen_random_uuid()
where id is null;

update public.online_orders
set client_request_id = gen_random_uuid()
where client_request_id is null;

update public.online_orders
set status = 'pending'
where status is null;

update public.online_orders
set payload = '{}'::jsonb
where payload is null;

update public.online_orders
set created_at = now()
where created_at is null;

alter table public.online_orders
    alter column id set default gen_random_uuid(),
    alter column id set not null,
    alter column client_request_id set not null,
    alter column status set default 'pending',
    alter column status set not null,
    alter column payload set default '{}'::jsonb,
    alter column payload set not null,
    alter column pos_imported set default false,
    alter column pos_imported set not null,
    alter column created_at set default now(),
    alter column created_at set not null;

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conrelid = 'public.online_orders'::regclass
          and contype = 'p'
    ) then
        alter table public.online_orders
            add constraint online_orders_pkey primary key (id);
    end if;

    if not exists (
        select 1
        from pg_constraint
        where conrelid = 'public.online_orders'::regclass
          and conname = 'online_orders_status_check'
    ) then
        alter table public.online_orders
            add constraint online_orders_status_check
            check (status in ('pending', 'accepted', 'rejected'));
    end if;
end
$$;

create unique index if not exists online_orders_client_request_id_uidx
    on public.online_orders (client_request_id);

create index if not exists online_orders_pending_created_at_idx
    on public.online_orders (created_at)
    where status = 'pending';

alter table public.online_orders enable row level security;

do $$
declare
    existing_policy record;
begin
    for existing_policy in
        select policyname
        from pg_policies
        where schemaname = 'public'
          and tablename = 'online_orders'
    loop
        execute format(
            'drop policy if exists %I on public.online_orders',
            existing_policy.policyname
        );
    end loop;
end
$$;

revoke all on public.online_orders from anon, authenticated;
grant all on public.online_orders to service_role;

commit;
