-- ============================================================
--  19_bulk_import_reactivate.sql
--  bulk_import_members — 삭제(숨김)되었던 구성원을 엑셀로 다시 등록하면 되살립니다
--
--  ★ 새 파일입니다. 실행 순서: 16_member_sort_order_fix_locks.sql → 18_member_delete.sql → 이 파일
--    (이 파일은 16번 보완판의 bulk_import_members 를 교체합니다. 16번을 먼저 실행해야 합니다.)
--  ★ 여러 번 실행해도 안전합니다. 이 파일을 실행하는 것만으로는 데이터가 바뀌지 않습니다.
--
--  왜 필요한가
--    · 이미 서명한 구성원을 "삭제"하면 서명 기록 보존을 위해 행이 숨김(is_active=false)으로 남습니다.
--    · 같은 이름·같은 부서로 엑셀을 다시 올리면, 지금은 숨겨진 행의 구분만 수정되고
--      계속 숨겨진 채여서 "저장 완료"인데 화면에 나타나지 않습니다.
--
--  바뀌는 것 (이 함수 안에서 딱 세 군데, 나머지는 16번 보완판과 글자 그대로 같습니다)
--    1) "같은 이름의 기존 구성원이 2명 이상이면 오류" 검사에서, 숨겨진(삭제된) 구성원은 세지 않습니다.
--       (활성 구성원이 2명 이상일 때만 오류. 화면의 미리보기도 같은 기준으로 바꿨습니다.)
--    2) 같은 부서에 같은 이름이 여러 명이면 활성 구성원을 우선 연결하고,
--       활성이 없을 때만 숨겨진 구성원 중 가장 최근에 만든 한 명과 연결합니다.
--    3) 연결된 구성원을 수정할 때 is_active = true 로 되돌립니다.
--       (활성 구성원은 이미 true 이므로 값이 바뀌지 않습니다. 이전 서명 기록은 그대로 이어집니다.)
--    · 반환 값에 reactivated_count(되살린 인원)가 하나 추가됩니다. 기존 키는 그대로입니다.
--
--  그대로인 것: 매개변수, 권한 확인(학교 관리자), 검증 규칙, 부서 자동 생성, 엑셀 행 순서 저장,
--    잠금 순서, SECURITY DEFINER, search_path, 실행 권한(authenticated)
-- ============================================================

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
  v_reactivated_count int := 0;     -- [추가] 삭제(숨김)되었다가 다시 등록된 구성원 수
  v_existing_active boolean := true; -- [추가] 일치한 기존 구성원이 활성 상태인지
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

    -- [변경] 삭제(숨김)된 구성원은 "중복"으로 세지 않습니다. 활성 구성원이 2명 이상일 때만 오류입니다.
    select count(*) into v_existing_count
    from members
    where org_id = p_org_id and department_id = v_dept_id and name = v_name
      and is_active;

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

  -- [동시성] 잠금 순서 고정: (새 부서를 만들 때만) 부서 잠금 → 엑셀에 나온 기존 부서의 구성원 잠금(id 순)
  --          행을 바꾸기 전에 먼저 잡아, reorder_* 와 서로 반대 순서로 기다리는 일이 없게 합니다.
  if exists (
    select 1 from jsonb_array_elements(p_rows) e
    where not exists (
      select 1 from departments d
      where d.org_id = p_org_id and d.is_active
        and regexp_replace(btrim(d.name), '\s+', ' ', 'g') = regexp_replace(btrim(e->>'department'), '\s+', ' ', 'g'))
  ) then
    perform pg_advisory_xact_lock(hashtextextended('departments_sort:' || p_org_id::text, 0));
  end if;
  for v_lock_dept in
    select d.id from departments d
    where d.org_id = p_org_id and d.is_active
      and regexp_replace(btrim(d.name), '\s+', ' ', 'g') in (
        select regexp_replace(btrim(e->>'department'), '\s+', ' ', 'g') from jsonb_array_elements(p_rows) e)
    order by d.id
  loop
    perform pg_advisory_xact_lock(hashtextextended(
      'members_sort:' || p_org_id::text || ':' || v_lock_dept::text, 0));
  end loop;

  -- 3) 전부 통과했을 때만 실제 저장 (여기서부터는 위 검증을 그대로
  --    통과한 데이터이므로, 다시 값 검증 없이 부서/기존 구성원만 재조회)
  --    [순서] 엑셀 행 순서(ordinality)를 보장하며 읽습니다.
  for v_row in
    select e.r from jsonb_array_elements(p_rows) with ordinality as e(r, ord) order by e.ord
  loop
    v_existing_active := true;
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
      -- [변경] 같은 이름이 여러 명이면 활성 구성원을 우선하고, 활성이 없을 때만
      --        삭제(숨김)된 구성원 중 가장 최근에 만든 한 명과 연결합니다.
      select id, is_active into v_existing_id, v_existing_active
      from members
      where org_id = p_org_id and department_id = v_dept_id and name = v_name
      order by is_active desc, created_at desc, id
      limit 1;
    end if;

    if v_existing_id is not null then
      -- [변경] 삭제(숨김)되었던 구성원이면 다시 활성으로 되돌립니다. 이전 서명 기록은 그대로 이어집니다.
      update members
        set member_type = v_member_type,
            is_active = true,
            updated_at = now()
        where id = v_existing_id;
      v_updated_count := v_updated_count + 1;
      if not v_existing_active then
        v_reactivated_count := v_reactivated_count + 1;
      end if;
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
    'reactivated_count', v_reactivated_count,
    'new_department_count', v_new_dept_count,
    'new_departments', to_json(v_new_dept_names)
  );
end;
$$;

-- 로그인한 관리자(authenticated)만 호출 가능 (anon에게는 부여하지 않음)
grant execute on function bulk_import_members(uuid, jsonb) to authenticated;
