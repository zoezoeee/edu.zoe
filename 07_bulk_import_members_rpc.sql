-- ============================================================
--  07_bulk_import_members_rpc.sql
--  bulk_import_members — 구성원 엑셀 일괄등록 "저장" 전용 RPC (Phase 2)
--
--  ★ Supabase 대시보드 → SQL Editor 에서 이 파일 전체를 한 번
--    실행해주세요. (기존 테이블/컬럼/RLS/트리거/다른 RPC는 전혀
--    건드리지 않고, 새 함수 1개만 추가합니다. 이미 정상 존재하는
--    members.member_type 컬럼/제약도 그대로 둡니다 — 이 SQL은
--    그 구조를 바꾸지 않습니다.)
--    (create or replace 이므로 이미 이전 버전을 실행했다면 같은
--     방식으로 다시 실행해 덮어써도 안전합니다.)
--
--  왜 RPC가 필요한가:
--    "엑셀 전체 행 검증 → 하나라도 오류면 아무것도 저장하지 않음"을
--    보장하려면 여러 insert/update가 하나의 트랜잭션으로 묶여야
--    합니다. 브라우저에서 여러 번의 개별 insert/update를 보내면
--    일부만 성공하고 일부는 실패하는 상황을 막을 수 없기 때문에,
--    서버(RPC) 안에서 "① 전체 재검증 → ② 통과했을 때만 전체 저장"
--    을 한 함수 호출(=하나의 트랜잭션) 안에서 처리합니다.
--
--  권한 확인 방식(기존 delete_training과 동일한 패턴):
--    호출자(auth.uid())가 p_org_id의 organization_admins에 실제로
--    등록되어 있는지 먼저 확인합니다. 아니면 아무 것도 하지 않고
--    실패 메시지를 반환합니다 — 다른 학교의 구성원은 절대 만들거나
--    수정할 수 없습니다.
--
--  동일인 판별 기준: org_id + department_id + name
--    - 엑셀의 "부서" 값은 기존 departments.name과 비교합니다.
--      (앞뒤 공백 제거 + 연속 공백을 한 칸으로 정리한 값으로 비교)
--    - [변경] 일치하는 부서가 없으면 오류가 아니라, 저장 단계에서 이
--      학교(p_org_id)에 새 부서를 자동 생성합니다. 같은 새 부서명이
--      엑셀에 여러 번 나와도 부서는 한 번만 생성되고 모든 구성원이
--      그 부서를 사용합니다. 부서 생성도 구성원 저장과 같은 트랜잭션
--      이므로, 검증 오류가 하나라도 있으면 부서도 만들어지지 않습니다.
--    - 같은 이름의 부서가 여러 개 있으면(방어적으로) 오류 — 자동으로
--      하나를 고르지 않습니다.
--    - [추가] 삭제(비활성화)된 부서(is_active = false)는 "없는 부서"로 봅니다.
--      삭제한 부서와 같은 이름이 엑셀에 있으면 숨겨진 옛 부서를 쓰지 않고
--      새 부서를 만들어 구성원을 연결합니다. (옛 부서와 그 구성원은 그대로 보존)
--    - 새 부서는 org_id와 name만 지정해 만듭니다(관리자 화면의
--      "+ 부서 추가"와 같은 방식 — 나머지 컬럼은 테이블 기본값).
--    - 이름+부서(department_id)가 같은 기존 구성원이 0명 → 신규 등록
--    - 1명 → 그 구성원의 member_type만 갱신 (id/org_id/department_id는
--      변경하지 않음)
--    - 2명 이상 → 오류(자동으로 한 명을 고르지 않음)
--
--  엑셀 내부 중복 검증:
--    업로드한 엑셀 안에서 같은 "부서 + 이름"이 2행 이상 나오면
--    (구분 값이 같든 다르든) 해당 행 전부를 오류로 처리하고
--    아무것도 저장하지 않습니다. (부서는 위와 같이 공백 정리 후,
--    이름은 앞뒤 공백만 제거한 값의 정확한 일치로 비교합니다.)
--
--  구분(member_type) 값은 반드시 '교원' 또는 '교직원'이어야 하며,
--  비어 있거나 다른 값이면 오류입니다(기본값에 의존해 임의로 채우지
--  않습니다 — 그 전에 이 함수가 먼저 명확한 오류로 걸러냅니다).
--
--  이 함수는 "이름/부서/구분"만 값으로 다룹니다. is_active 등 엑셀에
--  포함되지 않은 항목은 건드리지 않습니다.
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
  for v_row in select * from jsonb_array_elements(p_rows)
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
      values (p_org_id, v_dept_id, v_name, v_member_type);
      v_new_count := v_new_count + 1;
    end if;
  end loop;

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

-- ============================================================
-- 검증용 (실행할 필요 없음 — 확인하고 싶을 때만)
-- ============================================================

-- select proname, prosecdef, proconfig
-- from pg_proc
-- where proname = 'bulk_import_members';

-- select routine_name, grantee, privilege_type
-- from information_schema.role_routine_grants
-- where routine_name = 'bulk_import_members';
