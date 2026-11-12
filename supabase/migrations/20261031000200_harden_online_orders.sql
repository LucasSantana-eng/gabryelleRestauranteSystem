alter table public.online_orders
    alter column id set default gen_random_uuid();

alter table public.online_orders
    add column if not exists client_request_id uuid,
    add column if not exists tracking_hash text,
    add column if not exists pos_imported boolean not null default false;

update public.online_orders
set client_request_id = gen_random_uuid()
where client_request_id is null;

alter table public.online_orders
    alter column client_request_id set not null;

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conrelid = 'public.online_orders'::regclass
          and contype = 'u'
          and pg_get_constraintdef(oid) = 'UNIQUE (client_request_id)'
    ) then
        create unique index if not exists online_orders_client_request_id_uidx
            on public.online_orders (client_request_id);
    end if;
end
$$;

create index if not exists online_orders_pending_created_at_idx
    on public.online_orders (created_at)
    where status = 'pending';

alter table public.online_orders enable row level security;

do $$
declare
    policy record;
begin
    for policy in
        select policyname
        from pg_policies
        where schemaname = 'public'
          and tablename = 'online_orders'
    loop
        execute format('drop policy if exists %I on public.online_orders', policy.policyname);
    end loop;
end
$$;

revoke all on public.online_orders from anon, authenticated;
grant all on public.online_orders to service_role;
