-- Wish Garden / Supabase production schema. Run once in Supabase SQL Editor.
-- Browser roles cannot access base tables; all access is mediated by validated functions.
create extension if not exists pgcrypto;

create table if not exists public.owner_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '花园主人', created_at timestamptz not null default now()
);
create table if not exists public.friends (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.owner_profiles(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  birthday text not null check (birthday ~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'),
  note text not null default '', invite_hash text not null unique, invite_active boolean not null default true,
  invite_version integer not null default 1, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.friend_memberships (
  user_id uuid not null references auth.users(id) on delete cascade, friend_id uuid not null references public.friends(id) on delete cascade,
  invite_version integer not null, created_at timestamptz not null default now(), primary key (user_id, friend_id)
);
create table if not exists public.wishes (
  id uuid primary key default gen_random_uuid(), friend_id uuid not null references public.friends(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80), product_url text not null default '',
  price_cents integer check (price_cents is null or price_cents >= 0), priority text not null check (priority in ('high','medium','low')),
  note text not null default '', status text not null default 'pending' check (status in ('pending','purchased','given')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists friends_owner_id_idx on public.friends(owner_id);
create index if not exists friends_owner_birthday_idx on public.friends(owner_id,birthday);
create index if not exists memberships_user_idx on public.friend_memberships(user_id);
create index if not exists wishes_friend_id_idx on public.wishes(friend_id);
create index if not exists wishes_friend_status_idx on public.wishes(friend_id,status);

alter table public.owner_profiles enable row level security; alter table public.owner_profiles force row level security;
alter table public.friends enable row level security; alter table public.friends force row level security;
alter table public.friend_memberships enable row level security; alter table public.friend_memberships force row level security;
alter table public.wishes enable row level security; alter table public.wishes force row level security;
revoke all on public.owner_profiles, public.friends, public.friend_memberships, public.wishes from anon, authenticated;

create or replace function public.require_owner() returns uuid language plpgsql stable security definer set search_path='' as $$
declare v_uid uuid:=auth.uid(); begin
  if v_uid is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) or not exists(select 1 from public.owner_profiles where id=v_uid) then raise exception 'not_owner'; end if;
  return v_uid;
end $$;
create or replace function public.require_friend() returns uuid language plpgsql stable security definer set search_path='' as $$
declare v_id uuid; begin
  select f.id into v_id from public.friend_memberships m join public.friends f on f.id=m.friend_id
  where m.user_id=auth.uid() and f.invite_active and m.invite_version=f.invite_version order by m.created_at desc limit 1;
  if v_id is null then raise exception 'friend_access_denied'; end if; return v_id;
end $$;
create or replace function public.owner_assert() returns boolean language plpgsql stable security definer set search_path='' as $$ begin perform public.require_owner(); return true; end $$;

create or replace function public.owner_dashboard() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_owner uuid:=public.require_owner(); begin return jsonb_build_object('friends',coalesce((
  select jsonb_agg(jsonb_build_object('id',f.id,'name',f.name,'birthday',f.birthday,'note',f.note,'inviteActive',f.invite_active,
    'wishCount',(select count(*) from public.wishes w where w.friend_id=f.id),
    'pendingCount',(select count(*) from public.wishes w where w.friend_id=f.id and w.status='pending'),
    'purchasedCount',(select count(*) from public.wishes w where w.friend_id=f.id and w.status='purchased'),
    'givenCount',(select count(*) from public.wishes w where w.friend_id=f.id and w.status='given')) order by f.birthday)
  from public.friends f where f.owner_id=v_owner),'[]'::jsonb)); end $$;

create or replace function public.owner_friend(p_friend_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_owner uuid:=public.require_owner(); v_result jsonb; begin
  select jsonb_build_object('friend',jsonb_build_object('id',f.id,'name',f.name,'birthday',f.birthday,'note',f.note,'inviteActive',f.invite_active,
    'wishes',coalesce((select jsonb_agg(jsonb_build_object('id',w.id,'name',w.name,'productUrl',w.product_url,'priceCents',w.price_cents,'priority',w.priority,'note',w.note,'status',w.status) order by w.created_at desc) from public.wishes w where w.friend_id=f.id),'[]'::jsonb)))
  into v_result from public.friends f where f.id=p_friend_id and f.owner_id=v_owner;
  if v_result is null then raise exception 'not_found'; end if; return v_result; end $$;

create or replace function public.owner_create_friend(p_name text,p_birthday text,p_note text default '') returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_owner uuid:=public.require_owner(); v_friend public.friends; v_token text:=encode(gen_random_bytes(24),'hex'); begin
  insert into public.friends(owner_id,name,birthday,note,invite_hash) values(v_owner,trim(p_name),p_birthday,coalesce(p_note,''),encode(digest(v_token,'sha256'),'hex')) returning * into v_friend;
  return jsonb_build_object('friend',jsonb_build_object('id',v_friend.id,'name',v_friend.name,'birthday',v_friend.birthday,'note',v_friend.note,'inviteActive',true),'inviteToken',v_token); end $$;
create or replace function public.owner_update_friend(p_friend_id uuid,p_name text,p_birthday text,p_note text default '') returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_owner uuid:=public.require_owner(); begin update public.friends set name=trim(p_name),birthday=p_birthday,note=coalesce(p_note,''),updated_at=now() where id=p_friend_id and owner_id=v_owner; if not found then raise exception 'not_found'; end if; return public.owner_friend(p_friend_id); end $$;
create or replace function public.owner_delete_friend(p_friend_id uuid) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_owner uuid:=public.require_owner(); begin delete from public.friends where id=p_friend_id and owner_id=v_owner; if not found then raise exception 'not_found'; end if; return '{"ok":true}'::jsonb; end $$;
create or replace function public.owner_regenerate_invite(p_friend_id uuid) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_owner uuid:=public.require_owner(); v_token text:=encode(gen_random_bytes(24),'hex'); v_friend public.friends; begin
  update public.friends set invite_hash=encode(digest(v_token,'sha256'),'hex'),invite_active=true,invite_version=invite_version+1,updated_at=now() where id=p_friend_id and owner_id=v_owner returning * into v_friend;
  if v_friend.id is null then raise exception 'not_found'; end if; return jsonb_build_object('friend',(public.owner_friend(p_friend_id)->'friend'),'inviteToken',v_token); end $$;
create or replace function public.owner_revoke_invite(p_friend_id uuid) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_owner uuid:=public.require_owner(); begin update public.friends set invite_active=false,invite_version=invite_version+1,updated_at=now() where id=p_friend_id and owner_id=v_owner; if not found then raise exception 'not_found'; end if; return public.owner_friend(p_friend_id); end $$;
create or replace function public.owner_set_wish_status(p_wish_id uuid,p_status text) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_owner uuid:=public.require_owner(); begin if p_status not in ('pending','purchased','given') then raise exception 'invalid_status'; end if;
  update public.wishes w set status=p_status,updated_at=now() from public.friends f where w.id=p_wish_id and f.id=w.friend_id and f.owner_id=v_owner;
  if not found then raise exception 'not_found'; end if; return '{"ok":true}'::jsonb; end $$;
create or replace function public.owner_export() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_owner uuid:=public.require_owner(); begin return jsonb_build_object('exportedAt',now(),'friends',coalesce((select jsonb_agg(jsonb_build_object('id',f.id,'name',f.name,'birthday',f.birthday,'note',f.note,'inviteActive',f.invite_active,'wishes',coalesce((select jsonb_agg(to_jsonb(w)-'friend_id') from public.wishes w where w.friend_id=f.id),'[]'::jsonb))) from public.friends f where f.owner_id=v_owner),'[]'::jsonb)); end $$;

create or replace function public.claim_invite(p_token text) returns boolean language plpgsql volatile security definer set search_path='' as $$
declare v_friend public.friends; begin
  if auth.uid() is null or not coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then raise exception 'invite_invalid'; end if;
  select * into v_friend from public.friends where invite_active and invite_hash=encode(digest(p_token,'sha256'),'hex');
  if v_friend.id is null then raise exception 'invite_invalid'; end if;
  delete from public.friend_memberships where user_id=auth.uid(); insert into public.friend_memberships(user_id,friend_id,invite_version) values(auth.uid(),v_friend.id,v_friend.invite_version); return true; end $$;
create or replace function public.friend_context() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_id uuid:=public.require_friend(); begin return (select jsonb_build_object('friend',jsonb_build_object('id',f.id,'name',f.name,'birthday',f.birthday,
  'wishes',coalesce((select jsonb_agg(jsonb_build_object('id',w.id,'name',w.name,'productUrl',w.product_url,'priceCents',w.price_cents,'priority',w.priority,'note',w.note) order by w.created_at desc) from public.wishes w where w.friend_id=f.id),'[]'::jsonb))) from public.friends f where f.id=v_id); end $$;
create or replace function public.friend_save_wish(p_wish_id uuid,p_name text,p_product_url text,p_price_cents integer,p_priority text,p_note text) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_friend uuid:=public.require_friend(); v_id uuid; begin
  if p_priority not in ('high','medium','low') or trim(p_name)='' or char_length(p_name)>80 or (p_price_cents is not null and p_price_cents<0) then raise exception 'invalid_wish'; end if;
  if p_wish_id is null then insert into public.wishes(friend_id,name,product_url,price_cents,priority,note) values(v_friend,trim(p_name),coalesce(p_product_url,''),p_price_cents,p_priority,coalesce(p_note,'')) returning id into v_id;
  else update public.wishes set name=trim(p_name),product_url=coalesce(p_product_url,''),price_cents=p_price_cents,priority=p_priority,note=coalesce(p_note,''),updated_at=now() where id=p_wish_id and friend_id=v_friend returning id into v_id; if v_id is null then raise exception 'not_found'; end if; end if;
  return jsonb_build_object('ok',true,'id',v_id); end $$;
create or replace function public.friend_delete_wish(p_wish_id uuid) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_friend uuid:=public.require_friend(); begin delete from public.wishes where id=p_wish_id and friend_id=v_friend; if not found then raise exception 'not_found'; end if; return '{"ok":true}'::jsonb; end $$;

revoke all on function public.require_owner() from public; revoke all on function public.require_friend() from public;
grant execute on function public.owner_assert(),public.owner_dashboard(),public.owner_export() to authenticated;
grant execute on function public.owner_friend(uuid),public.owner_delete_friend(uuid),public.owner_regenerate_invite(uuid),public.owner_revoke_invite(uuid),public.friend_delete_wish(uuid) to authenticated;
grant execute on function public.owner_create_friend(text,text,text),public.owner_update_friend(uuid,text,text,text) to authenticated;
grant execute on function public.owner_set_wish_status(uuid,text),public.claim_invite(text),public.friend_context() to authenticated;
grant execute on function public.friend_save_wish(uuid,text,text,integer,text,text) to authenticated;

-- After creating the owner in Authentication > Users, run once with the real email:
-- insert into public.owner_profiles(id) select id from auth.users where email='YOUR_OWNER_EMAIL';
