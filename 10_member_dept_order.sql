-- ============================================================
--  10_member_dept_order.sql — 부서·구성원 표시 순서 저장 기능
--
--  ★ Supabase 대시보드 → SQL Editor 에서 이 파일 전체를 한 번 실행해주세요.
--    · 기존 데이터를 삭제하거나 이름/부서/활성 상태를 바꾸지 않습니다.
--    · 서명 기록(signatures)은 읽지도 쓰지도 않습니다.
--    · 다시 실행해도 안전합니다(관리자가 정한 순서를 덮어쓰지 않습니다).
--
--  이 파일이 하는 일 (각각 꼭 필요한 이유):
--
--  1) members.sort_order 컬럼 추가 (integer, 기본값 0)
--     → 구성원은 지금까지 순서를 저장할 곳이 없어 항상 이름순으로만 보였습니다.
--     → 부서 순서는 departments.sort_order가 이미 있어 새 컬럼이 필요 없습니다.
--     → 구성원 순서는 "부서 안에서의 순서"입니다. (부서별 관리)
--
--  2) 처음 한 번만 현재 보이는 순서를 숫자로 채움
--     · 부서   : 학교별로, 부서를 등록한 순서(created_at)대로 1, 2, 3 …
--     · 구성원 : 학교·부서별로, 지금 화면에 보이는 순서(이름순)대로 1, 2, 3 …
--     → 이미 순서가 지정된 학교/부서(값이 0이 아닌 것이 있는 곳)는 건드리지 않습니다.
--
--  3) 새로 만든 부서/구성원을 자동으로 맨 뒤에 붙이는 트리거
--     → 관리자 화면의 "+ 부서 추가", "+ 구성원 추가", 엑셀 일괄등록은
--       순서 값을 지정하지 않으므로(0), 그대로 두면 기존 순서와 충돌합니다.
--       트리거가 맨 뒤 번호를 붙여 주므로 기존 코드를 수정하지 않아도 됩니다.
--     · 구성원을 다른 부서로 옮기거나 비활성 구성원을 복원하면 새 위치의 맨 뒤로 갑니다.
--       (다른 구성원의 순서는 바뀌지 않습니다)
--
--  4) 순서 저장 함수 2개 (한 번 호출 = 하나의 트랜잭션 → 일부만 저장되지 않음)
--     · reorder_departments(순서대로 나열한 부서 ID 배열)
--     · reorder_members(부서 ID, 순서대로 나열한 구성원 ID 배열)
--     → 서버에서 로그인한 관리자가 그 학교 관리자인지, 목록이 그 학교(그 부서)의
--       활성 항목과 정확히 일치하는지 확인한 뒤 1..N으로 번호를 다시 매깁니다.
--     · SECURITY DEFINER + search_path 고정, authenticated만 실행 가능
-- ============================================================


-- ------------------------------------------------------------
-- 1) 컬럼 추가
-- ------------------------------------------------------------
alter table members
  add column if not exists sort_order integer not null default 0;


-- ------------------------------------------------------------
-- 2) 처음 한 번: 현재 보이는 순서를 숫자로 채움 (이미 지정된 곳은 건드리지 않음)
-- ------------------------------------------------------------
-- 부서: 아직 순서가 지정되지 않은 학교(모든 부서의 sort_order = 0)만, 등록 순서대로
update departments d
   set sort_order = r.rn
  from (
    select id,
           row_number() over (partition by org_id order by created_at, id) as rn
    from departments
  ) r
 where d.id = r.id
   and not exists (
     select 1 from departments x
     where x.org_id = d.org_id and x.sort_order <> 0
   );

-- 구성원: 아직 순서가 지정되지 않은 (학교, 부서)만, 지금 보이는 순서(이름순)대로
update members m
   set sort_order = r.rn
  from (
    select id,
           row_number() over (
             partition by org_id, department_id
             order by name, created_at, id
           ) as rn
    from members
  ) r
 where m.id = r.id
   and not exists (
     select 1 from members x
     where x.org_id = m.org_id
       and x.department_id is not distinct from m.department_id
       and x.sort_order <> 0
   );


-- ------------------------------------------------------------
-- 3) 새 항목을 맨 뒤에 붙이는 트리거
-- ------------------------------------------------------------
create or replace function trg_fn_departments_append_sort_order()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.sort_order = 0 then
    -- 같은 학교에서 동시에 두 부서가 추가되어도 번호가 겹치지 않도록 학교 단위로 잠금
    perform pg_advisory_xact_lock(hashtextextended('departments_sort:' || new.org_id::text, 0));
    select coalesce(max(sort_order), 0) + 1
      into new.sort_order
    from departments
    where org_id = new.org_id;
  end if;
  return new;
end;
$$;

create or replace function trg_fn_members_append_sort_order()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_move_to_end boolean := false;
begin
  if tg_op = 'INSERT' then
    v_move_to_end := (new.sort_order = 0);
  else
    -- 다른 부서로 옮겼는데 순서 값은 그대로이면 새 부서의 맨 뒤로
    -- 비활성 구성원을 복원(비활성 → 활성)할 때도 맨 뒤로
    v_move_to_end :=
      (new.department_id is distinct from old.department_id and new.sort_order = old.sort_order)
      or (old.is_active = false and new.is_active = true and new.sort_order = old.sort_order);
  end if;

  if v_move_to_end then
    perform pg_advisory_xact_lock(hashtextextended(
      'members_sort:' || new.org_id::text || ':' || coalesce(new.department_id::text, 'none'), 0));
    select coalesce(max(sort_order), 0) + 1
      into new.sort_order
    from members
    where org_id = new.org_id
      and department_id is not distinct from new.department_id
      and id <> new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_departments_append_sort_order on departments;
create trigger trg_departments_append_sort_order
  before insert on departments
  for each row execute function trg_fn_departments_append_sort_order();

drop trigger if exists trg_members_append_sort_order_ins on members;
create trigger trg_members_append_sort_order_ins
  before insert on members
  for each row execute function trg_fn_members_append_sort_order();

drop trigger if exists trg_members_append_sort_order_upd on members;
create trigger trg_members_append_sort_order_upd
  before update on members
  for each row execute function trg_fn_members_append_sort_order();


-- ------------------------------------------------------------
-- 4-a) reorder_departments — 부서 순서 저장
-- ------------------------------------------------------------
create or replace function reorder_departments(p_ordered_ids uuid[])
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org_id uuid;
  v_count int;
  v_distinct int;
  v_found int;
  v_active int;
begin
  if p_ordered_ids is null or coalesce(array_length(p_ordered_ids, 1), 0) = 0 then
    return json_build_object('success', false, 'message', '순서를 저장할 부서가 없습니다.');
  end if;

  v_count := array_length(p_ordered_ids, 1);
  select count(distinct x) into v_distinct from unnest(p_ordered_ids) as x;
  if v_distinct <> v_count then
    return json_build_object('success', false, 'message', '부서 목록에 중복이 있습니다. 화면을 새로고침한 뒤 다시 시도해주세요.');
  end if;

  -- 학교는 "첫 번째 부서가 속한 학교"로 정하고, 나머지 부서가 모두 같은 학교인지 아래에서 확인
  select org_id into v_org_id from departments where id = p_ordered_ids[1];
  if v_org_id is null then
    return json_build_object('success', false, 'message', '존재하지 않는 부서가 포함되어 있습니다.');
  end if;

  if auth.uid() is null or not exists (
    select 1 from organization_admins where user_id = auth.uid() and org_id = v_org_id
  ) then
    return json_build_object('success', false, 'message', '부서 순서를 변경할 권한이 없습니다.');
  end if;

  -- 같은 학교의 부서 행을 잠가 동시 변경을 막음
  perform 1 from departments where org_id = v_org_id and is_active for update;

  select count(*) into v_found
  from departments
  where id = any(p_ordered_ids) and org_id = v_org_id and is_active;
  select count(*) into v_active
  from departments
  where org_id = v_org_id and is_active;

  if v_found <> v_count or v_active <> v_count then
    return json_build_object('success', false,
      'message', '부서 목록이 현재 상태와 다릅니다(다른 곳에서 부서가 추가/삭제되었을 수 있습니다). 화면을 새로고침한 뒤 다시 시도해주세요.');
  end if;

  update departments d
     set sort_order = o.pos
    from unnest(p_ordered_ids) with ordinality as o(id, pos)
   where d.id = o.id
     and d.org_id = v_org_id;

  return json_build_object('success', true, 'count', v_count);
end;
$$;

revoke all on function reorder_departments(uuid[]) from public;
grant execute on function reorder_departments(uuid[]) to authenticated;


-- ------------------------------------------------------------
-- 4-b) reorder_members — 한 부서 안의 구성원 순서 저장
-- ------------------------------------------------------------
create or replace function reorder_members(p_department_id uuid, p_ordered_ids uuid[])
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org_id uuid;
  v_count int;
  v_distinct int;
  v_found int;
  v_active int;
begin
  select org_id into v_org_id from departments where id = p_department_id;
  if v_org_id is null then
    return json_build_object('success', false, 'message', '존재하지 않는 부서입니다.');
  end if;

  if auth.uid() is null or not exists (
    select 1 from organization_admins where user_id = auth.uid() and org_id = v_org_id
  ) then
    return json_build_object('success', false, 'message', '구성원 순서를 변경할 권한이 없습니다.');
  end if;

  if p_ordered_ids is null or coalesce(array_length(p_ordered_ids, 1), 0) = 0 then
    return json_build_object('success', false, 'message', '순서를 저장할 구성원이 없습니다.');
  end if;

  v_count := array_length(p_ordered_ids, 1);
  select count(distinct x) into v_distinct from unnest(p_ordered_ids) as x;
  if v_distinct <> v_count then
    return json_build_object('success', false, 'message', '구성원 목록에 중복이 있습니다. 화면을 새로고침한 뒤 다시 시도해주세요.');
  end if;

  -- 같은 부서의 활성 구성원 행을 잠가 동시 변경을 막음
  perform 1 from members
   where org_id = v_org_id and department_id = p_department_id and is_active for update;

  select count(*) into v_found
  from members
  where id = any(p_ordered_ids) and org_id = v_org_id
    and department_id = p_department_id and is_active;
  select count(*) into v_active
  from members
  where org_id = v_org_id and department_id = p_department_id and is_active;

  if v_found <> v_count or v_active <> v_count then
    return json_build_object('success', false,
      'message', '구성원 목록이 현재 상태와 다릅니다(다른 곳에서 구성원이 추가/삭제/이동되었을 수 있습니다). 화면을 새로고침한 뒤 다시 시도해주세요.');
  end if;

  update members m
     set sort_order = o.pos
    from unnest(p_ordered_ids) with ordinality as o(id, pos)
   where m.id = o.id
     and m.org_id = v_org_id
     and m.department_id = p_department_id;

  return json_build_object('success', true, 'count', v_count);
end;
$$;

revoke all on function reorder_members(uuid, uuid[]) from public;
grant execute on function reorder_members(uuid, uuid[]) to authenticated;


-- ============================================================
-- 검증용 (실행할 필요 없음 — 확인하고 싶을 때만, 모두 조회만 합니다)
-- ============================================================

-- 부서 순서 확인 (학교별 등록 순서대로 1,2,3… 이어야 함)
-- select o.public_code, d.sort_order, d.name, d.is_active
-- from departments d join organizations o on o.id = d.org_id
-- order by o.public_code, d.sort_order;

-- 부서별 구성원 순서 확인
-- select d.name as 부서, m.sort_order, m.name, m.is_active
-- from members m left join departments d on d.id = m.department_id
-- order by d.sort_order, m.sort_order, m.name;

-- 함수/트리거 확인
-- select proname, prosecdef, proconfig from pg_proc
-- where proname in ('reorder_departments','reorder_members','trg_fn_departments_append_sort_order','trg_fn_members_append_sort_order');
