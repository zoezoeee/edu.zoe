-- ============================================================
--  16_member_sort_order_fix.sql — 구성원 정렬 기능 수정 (한 파일로 끝)
--
--  ★ Supabase 대시보드 → SQL Editor 에서 이 파일 전체를 한 번 실행해주세요.
--    · 10, 11번 파일의 내용을 모두 포함합니다(그래서 10, 11은 따로 실행할 필요 없습니다.
--      이미 실행했더라도 이 파일을 다시 실행해도 안전합니다).
--    · 구성원/부서/서명 기록을 삭제하지 않습니다. 이름, 부서 소속, 활성 상태,
--      구분(member_type)도 바꾸지 않습니다. 바뀌는 값은 sort_order(표시 순서)뿐입니다.
--    · 이미 관리자가 지정한 순서(0이 아닌 값이 있는 부서)는 초기화 단계에서 건드리지 않습니다.
--
--  내용
--    1) members.sort_order 컬럼 (이미 있으면 그대로)
--    2) 순서가 전부 0인 부서/학교만 한 번 채움 (등록 시각 → 이름 순)
--    3) 새 부서/구성원을 맨 뒤에 붙이는 트리거
--    4) reorder_departments(uuid[]), reorder_members(uuid, uuid[])  ← ▲▼ 버튼이 호출
--    5) bulk_import_members — 엑셀 행 순서를 부서별 sort_order 에 저장 (신규 + 기존 구성원)
--    6) get_training_targets — 부서 순서 → 구성원 순서로 정렬
--    7) get_department_members — 학교 공통 주소 화면의 구성원 정렬 (ORDER BY 한 곳만)
--
--  ※ get_public_departments 는 이미 departments.sort_order 로 정렬하므로 건드리지 않습니다.
-- ============================================================

-- ------------------------------------------------------------
-- 1) 컬럼 추가
-- ------------------------------------------------------------
alter table members
  add column if not exists sort_order integer not null default 0;


-- ------------------------------------------------------------
-- 2) 처음 한 번: 순서가 전부 0인 부서/학교만 채움 (이미 지정된 곳은 건드리지 않음)
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

-- 구성원: 아직 순서가 지정되지 않은 (학교, 부서)만, 등록 시각(created_at) → 이름 → id 순으로
--         (같은 엑셀로 한꺼번에 등록된 구성원은 created_at이 같으므로 이름순이 됩니다.
--          과거 엑셀의 행 순서는 DB에 남아 있지 않아 복원할 수 없습니다.)
update members m
   set sort_order = r.rn
  from (
    select id,
           row_number() over (
             partition by org_id, department_id
             order by created_at, name, id
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




-- ------------------------------------------------------------
-- 5) bulk_import_members — 엑셀 행 순서를 부서별 sort_order 로 저장
--    (07_bulk_import_members_rpc.sql 의 최신 버전에서 "순서 저장" 부분만 추가)
--    · 반환 형식/권한 확인/검증 규칙/부서 자동 생성/보안 설정은 그대로입니다.
--    · 추가된 것: (a) 엑셀 행 순서대로 읽기 (b) 마지막에 부서별 sort_order 저장
-- ------------------------------------------------------------
create or replace function bulk_import_members(p_org_id uuid, p_rows jsonb)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row jsonb;
  v_row_number int;
  v_name text;
  v_dept_name text;
  v_member_type text;
  v_dept_count int;
  v_dept_id uuid;
  v_existing_count int;
  v_existing_id uuid;
  v_dup record;                -- [추가] 엑셀 내부 중복 그룹 1건
  v_dup_row_number int;        -- 중복 그룹에 속한 행 번호
  v_new_dept_count int := 0;   -- [추가] 이번 저장에서 새로 만든 부서 수
  v_new_dept_names text[] := '{}';  -- [추가] 새로 만든 부서명 목록
  v_ordered_ids uuid[] := '{}';     -- [순서] 엑셀 행 순서대로 모은 구성원 id
  v_touched_depts uuid[] := '{}';   -- [순서] 이번 엑셀에 나온 부서 id
  v_lock_dept uuid;                 -- [순서] 부서별 잠금용
  v_errors jsonb := '[]'::jsonb;
  v_new_count int := 0;
  v_updated_count int := 0;
begin
  -- 0) 권한 확인 — 호출자가 이 학교(org)의 관리자로 등록되어 있는가
  if not exists (
    select 1 from organization_admins
    where user_id = auth.uid() and org_id = p_org_id
  ) then
    return json_build_object('success', false, 'message', '이 학교의 구성원을 등록/수정할 권한이 없습니다.');
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    return json_build_object('success', false, 'message', '저장할 데이터가 없습니다.');
  end if;

  -- 1) 1차 검증 — 아무 것도 저장하지 않고 전체 행을 먼저 검사만 합니다.
  --    (기본 값 검증 → 부서 존재 검증 → 기존 DB 이름+부서 중복 검증)
  for v_row in select * from jsonb_array_elements(p_rows)
  loop
    v_row_number := nullif(v_row->>'row_number', '')::int;
    v_name := nullif(btrim(v_row->>'name'), '');
    v_dept_name := nullif(regexp_replace(btrim(v_row->>'department'), '\s+', ' ', 'g'), '');
    v_member_type := nullif(btrim(v_row->>'member_type'), '');

    if v_name is null then
      v_errors := v_errors || jsonb_build_object('row_number', v_row_number, 'message', '이름이 비어 있습니다.');
      continue;
    end if;

    if v_dept_name is null then
      v_errors := v_errors || jsonb_build_object('row_number', v_row_number, 'message', '부서가 비어 있습니다.');
      continue;
    end if;

    if v_member_type is null or v_member_type not in ('교원', '교직원') then
      v_errors := v_errors || jsonb_build_object(
        'row_number', v_row_number,
        'message', '구분 값이 올바르지 않습니다. "교원" 또는 "교직원"만 입력할 수 있습니다.'
      );
      continue;
    end if;

    select count(*) into v_dept_count
    from departments
    where org_id = p_org_id
      and regexp_replace(btrim(name), '\s+', ' ', 'g') = v_dept_name
      and is_active;

    -- [변경] 부서가 없으면 오류가 아니라 "저장 단계에서 새로 생성할 부서"입니다.
    --        새 부서에는 기존 구성원이 있을 수 없으므로 아래 기존 구성원
    --        중복 확인은 건너뜁니다.
    if v_dept_count = 0 then
      continue;
    end if;

    if v_dept_count > 1 then
      v_errors := v_errors || jsonb_build_object(
        'row_number', v_row_number,
        'message', format('부서 "%s"라는 이름의 부서가 여러 개 있어 자동으로 확정할 수 없습니다.', v_dept_name)
      );
      continue;
    end if;

    select id into v_dept_id
    from departments
    where org_id = p_org_id
      and regexp_replace(btrim(name), '\s+', ' ', 'g') = v_dept_name
      and is_active;

    select count(*) into v_existing_count
    from members
    where org_id = p_org_id and department_id = v_dept_id and name = v_name;

    if v_existing_count >= 2 then
      v_errors := v_errors || jsonb_build_object(
        'row_number', v_row_number,
        'message', format('이름+부서가 같은 기존 구성원이 %s명 있어 자동으로 연결할 수 없습니다 (중복 구성원).', v_existing_count)
      );
      continue;
    end if;
  end loop;

  -- 1-b) [추가] 엑셀 내부 중복 검증 — 같은 "부서 + 이름"이 2행 이상이면
  --      해당 행 전부를 오류로 기록합니다. (이름·부서가 둘 다 비어 있지
  --      않은 행만 대상이며, 비어 있는 행은 위 1)에서 이미 오류 처리됨)
  --      부서는 위 1)과 같이 공백을 정리한 값으로 비교합니다.
  for v_dup in
    select
      regexp_replace(btrim(e.r->>'department'), '\s+', ' ', 'g') as dept_name,
      btrim(e.r->>'name') as member_name,
      array_agg(nullif(e.r->>'row_number', '')::int order by e.ord) as row_numbers
    from jsonb_array_elements(p_rows) with ordinality as e(r, ord)
    where nullif(btrim(e.r->>'name'), '') is not null
      and nullif(btrim(e.r->>'department'), '') is not null
    group by regexp_replace(btrim(e.r->>'department'), '\s+', ' ', 'g'), btrim(e.r->>'name')
    having count(*) >= 2
  loop
    foreach v_dup_row_number in array v_dup.row_numbers
    loop
      v_errors := v_errors || jsonb_build_object(
        'row_number', v_dup_row_number,
        'message', format(
          '엑셀 안에 부서 "%s", 이름 "%s"가 같은 행이 여러 개 있습니다 (행 %s). 한 구성원은 한 행만 입력해주세요.',
          v_dup.dept_name, v_dup.member_name, array_to_string(v_dup.row_numbers, ', ')
        )
      );
    end loop;
  end loop;

  -- 2) 하나라도 오류가 있으면 여기서 종료 — 아무 것도 저장하지 않습니다.
  if jsonb_array_length(v_errors) > 0 then
    return json_build_object(
      'success', false,
      'message', '검증 오류가 있어 저장하지 않았습니다. 오류 행을 수정한 뒤 다시 업로드해주세요.',
      'errors', v_errors
    );
  end if;

  -- 3) 전부 통과했을 때만 실제 저장 (여기서부터는 위 검증을 그대로
  --    통과한 데이터이므로, 다시 값 검증 없이 부서/기존 구성원만 재조회)
  --    [순서] 엑셀 행 순서(ordinality)를 보장하며 읽습니다.
  for v_row in
    select e.r from jsonb_array_elements(p_rows) with ordinality as e(r, ord) order by e.ord
  loop
    v_name := btrim(v_row->>'name');
    v_dept_name := regexp_replace(btrim(v_row->>'department'), '\s+', ' ', 'g');
    v_member_type := btrim(v_row->>'member_type');

    select id into v_dept_id
    from departments
    where org_id = p_org_id
      and regexp_replace(btrim(name), '\s+', ' ', 'g') = v_dept_name
      and is_active;

    if v_dept_id is null then
      -- [추가] 이 학교에 없는 부서 → 새로 생성 (org_id는 항상 p_org_id).
      --        같은 트랜잭션 안이므로 같은 부서명의 다음 행은 위 조회에서
      --        방금 만든 부서를 찾아 재사용합니다(중복 생성 없음).
      insert into departments (org_id, name)
      values (p_org_id, v_dept_name)
      returning id into v_dept_id;

      v_new_dept_count := v_new_dept_count + 1;
      v_new_dept_names := v_new_dept_names || v_dept_name;
      v_existing_id := null;
    else
      select id into v_existing_id
      from members
      where org_id = p_org_id and department_id = v_dept_id and name = v_name;
    end if;

    if v_existing_id is not null then
      update members
        set member_type = v_member_type,
            updated_at = now()
        where id = v_existing_id;
      v_updated_count := v_updated_count + 1;
    else
      insert into members (org_id, department_id, name, member_type)
      values (p_org_id, v_dept_id, v_name, v_member_type)
      returning id into v_existing_id;
      v_new_count := v_new_count + 1;
    end if;

    -- [순서] 엑셀 행 순서대로 구성원/부서를 기록 (검증 단계에서 엑셀 내부 중복은 이미 거부됨)
    v_ordered_ids := v_ordered_ids || v_existing_id;
    if not (v_dept_id = any(v_touched_depts)) then
      v_touched_depts := v_touched_depts || v_dept_id;
    end if;
  end loop;

  -- 4) [순서] 엑셀에 나온 부서별로, 엑셀 행 순서를 members.sort_order(1..N)에 저장합니다.
  --    · 신규/기존(수정) 구성원 모두 엑셀 행 순서대로 앞에서부터 배치
  --    · 그 부서의 활성 구성원 중 엑셀에 없는 사람은 기존 순서를 유지한 채 뒤에 배치
  --    · 엑셀에 나오지 않은 부서는 전혀 건드리지 않음 (부서별 독립 → 부서 간 충돌 없음)
  --    · 비활성 구성원은 건드리지 않음 (is_active, 서명 기록도 그대로)
  for v_lock_dept in select unnest(v_touched_depts) order by 1
  loop
    perform pg_advisory_xact_lock(hashtextextended(
      'members_sort:' || p_org_id::text || ':' || v_lock_dept::text, 0));
  end loop;

  update members m
     set sort_order = r.rn
    from (
      select mm.id,
             row_number() over (
               partition by mm.department_id
               order by (x.ord is null), x.ord, mm.sort_order, mm.name, mm.id
             )::int as rn
      from members mm
      left join unnest(v_ordered_ids) with ordinality as x(id, ord) on x.id = mm.id
      where mm.org_id = p_org_id
        and mm.is_active
        and mm.department_id = any(v_touched_depts)
    ) r
   where m.id = r.id
     and m.sort_order is distinct from r.rn;

  return json_build_object(
    'success', true,
    'new_count', v_new_count,
    'updated_count', v_updated_count,
    'new_department_count', v_new_dept_count,
    'new_departments', to_json(v_new_dept_names)
  );
end;
$$;

-- 로그인한 관리자(authenticated)만 호출 가능 (anon에게는 부여하지 않음)
grant execute on function bulk_import_members(uuid, jsonb) to authenticated;

-- ------------------------------------------------------------
-- 6) get_training_targets — 서명 페이지(연수별 주소)의 정렬 기준
--    바뀌는 것은 마지막 ORDER BY 뿐: 부서 순서 → 부서 안 구성원 순서
--    반환 형식 / 대상자 규칙 / 학교 분리 / SECURITY DEFINER / 권한(anon, authenticated) 그대로
-- ------------------------------------------------------------
create or replace function public.get_training_targets(p_org_code text, p_training_id uuid)
returns table (member_id uuid, member_name text, department_name text)
language sql
stable
security definer
set search_path = public, pg_temp
as $body$
  select m.id, m.name, d.name
  from organizations o
  join trainings t on t.org_id = o.id and t.id = p_training_id
  join members m on m.org_id = o.id and m.is_active
  left join departments d on d.id = m.department_id and d.org_id = o.id
  where o.public_code = p_org_code
    and o.status = 'active'
    and t.status = 'active'
    and (
      (t.target_type = '교원'   and m.member_type = '교원')
      or
      (t.target_type = '교직원' and m.member_type in ('교원', '교직원'))
    )
  order by d.sort_order nulls last, d.created_at nulls last, d.id nulls last,
           m.sort_order, m.name, m.id;
$body$;

revoke all on function public.get_training_targets(text, uuid) from public;
grant execute on function public.get_training_targets(text, uuid) to anon, authenticated;


-- ------------------------------------------------------------
-- 7) get_department_members(text, uuid) — 학교 공통 주소 화면의 구성원 정렬
--    바뀌는 것은 ORDER BY 한 곳뿐입니다:  m.name  →  m.sort_order, m.name, m.id
--
--    ★ 함수를 새로 쓰지 않습니다. 지금 DB에 들어 있는 정의를 그대로 읽어서
--      ORDER BY 부분만 바꿔 다시 만듭니다. 그래서 아래는 전부 글자 그대로 유지됩니다.
--        매개변수 · 반환 형식 · 학교별 분리 조건 · 활성 구성원 필터 · 미지정 부서 처리 ·
--        SECURITY DEFINER · search_path 설정 · 실행 권한(anon, authenticated)
--    · 이미 바뀐 상태(sort_order 정렬)이면 아무것도 하지 않습니다 → 여러 번 실행해도 안전
--    · "ORDER BY m.name" 이 정확히 한 곳이 아니면 함수를 건드리지 않고 경고(WARNING)만
--      표시합니다. (이 경우에도 위의 1~6번 변경은 그대로 적용됩니다.)
-- ------------------------------------------------------------
do $do$
declare
  v_oid oid;
  v_def text;
  v_new text;
  v_hits int;
begin
  select p.oid into v_oid
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace
    and p.proname = 'get_department_members'
    and oidvectortypes(p.proargtypes) = 'text, uuid';

  if v_oid is null then
    raise warning 'get_department_members(text, uuid) 를 찾지 못해 변경하지 않았습니다.';
    return;
  end if;

  v_def := pg_get_functiondef(v_oid);

  if v_def ~* 'order\s+by\s+m\.sort_order' then
    raise notice 'get_department_members: 이미 구성원 순서(sort_order)로 정렬하고 있어 변경하지 않았습니다.';
    return;
  end if;

  select count(*) into v_hits
  from regexp_matches(v_def, 'order\s+by\s+m\.name(\s*,\s*m\.id)?', 'gi');

  if v_hits <> 1 then
    raise warning 'get_department_members: "ORDER BY m.name" 이 % 곳이라 자동으로 바꾸지 않았습니다. 함수 정의를 알려주세요.', v_hits;
    return;
  end if;

  v_new := regexp_replace(
    v_def,
    'order\s+by\s+m\.name(\s*,\s*m\.id)?',
    'ORDER BY m.sort_order, m.name, m.id',
    'i'
  );

  execute v_new;   -- CREATE OR REPLACE FUNCTION (같은 매개변수/반환형/보안설정, 정렬만 다름)
  raise notice 'get_department_members: 정렬을 m.sort_order, m.name, m.id 로 변경했습니다.';
end
$do$;

-- 실행 권한: 기존과 같이 anon, authenticated (create or replace 는 기존 권한을 유지하며, 한 번 더 명시)
grant execute on function public.get_department_members(text, uuid) to anon, authenticated;
