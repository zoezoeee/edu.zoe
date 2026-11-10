-- ============================================================
--  12_department_delete_v3.sql
--  delete_department_with_members — 부서 삭제 시 구성원 처리 방식 (v2의 잘못된 부분 수정)
--
--  ★ 이 파일은 새 파일입니다. 12_department_delete_v2.sql 은 그대로 두었습니다.
--  ★ Supabase 대시보드 → SQL Editor 에서 실행하기 전에, 파일 맨 아래의
--    "실행 전 확인 사항"을 먼저 읽어주세요.
--    · 09 또는 v2 로 만든 같은 이름의 함수를 교체합니다(create or replace).
--      함수 이름, 인자, 반환 형식, 호출 방법이 같아 화면 코드와 호환됩니다.
--    · 이 파일을 실행하는 것만으로는 기존 데이터가 하나도 삭제되지 않습니다.
--      삭제는 나중에 관리자가 화면에서 "이 부서 삭제"를 눌렀을 때,
--      그 부서에 대해서만 일어납니다.
--
--  v2 에서 잘못된 부분
--    1) 연수 대상 연결(training_members)을 삭제했습니다.   → v3: 삭제하지 않음
--    2) 서명 기록만 보고 구성원을 삭제했습니다. 연수 대상 연결이나 업로드 실패
--       기록이 있어도 서명 기록이 없으면 구성원을 지웠습니다. → v3: 세 가지 기록이
--       하나라도 있으면 삭제하지 않음
--
--  v3 동작 (부서를 삭제할 때, 그 부서의 "활성" 구성원에 대해)
--    · 아래 세 가지 기록이 "하나도 없는" 구성원  → 구성원 행을 물리적으로 삭제
--         - signatures.member_id          (서명 기록)
--         - training_members.member_id    (연수 대상 연결)
--         - upload_failures.member_id     (업로드 실패 기록)
--    · 세 가지 중 "하나라도 있는" 구성원          → 삭제하지 않고 is_active = false 로 보존
--    · 부서 자체                                  → 삭제하지 않고 is_active = false 로 비활성화
--    · 부서 삭제 전에 이미 비활성이던 구성원      → 건드리지 않음(보존)
--
--  기록 보존 보장
--    · 이 함수에는 signatures / training_members / upload_failures 를 대상으로 하는
--      DELETE 또는 UPDATE 문이 없습니다. 이 세 테이블은 읽기(NOT EXISTS 조회)만 합니다.
--    · 구성원 삭제는 위 세 기록이 없는 경우로만 한정한 DELETE 한 문장입니다.
--    · signatures.member_id, training_members.member_id 는 members(id)를 참조하는
--      외래 키(ON DELETE 지정 없음 = NO ACTION)이므로, 만약 위 조건 검사 이후 그
--      구성원에게 서명/연결 기록이 생기는 드문 경우에도 삭제는 데이터베이스가 오류로
--      거부하고, 함수 전체가 취소됩니다(일부만 삭제된 상태가 남지 않음).
--
--  그대로인 것
--    · 호출자가 그 학교 관리자인지 서버에서 확인(다른 학교 부서는 처리 불가)
--    · 한 번 호출 = 하나의 트랜잭션, 부서 행 잠금(FOR UPDATE)
--    · SECURITY DEFINER + search_path 고정, 로그인한 관리자(authenticated)만 실행 가능
--    · 반환 형식(JSON): success, department_name, deleted_member_count, kept_member_count
--      실패 시: success = false, message
--      ※ kept_member_count 는 이제 "서명/연수 대상 연결/업로드 실패 기록이 있어 보존한
--        구성원 수"를 뜻합니다(v2 에서는 서명 기록이 있는 구성원 수).
-- ============================================================

create or replace function delete_department_with_members(p_department_id uuid)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org_id uuid;
  v_name text;
  v_is_active boolean;
  v_deleted int := 0;
  v_kept int := 0;
begin
  -- 1) 부서와 소속 학교 확인 (동시 처리 방지를 위해 행 잠금)
  select org_id, name, is_active
    into v_org_id, v_name, v_is_active
  from departments
  where id = p_department_id
  for update;

  if v_org_id is null then
    return json_build_object('success', false, 'message', '존재하지 않는 부서입니다.');
  end if;

  -- 2) 호출자가 이 학교의 관리자인지 확인 (로그인하지 않았으면 auth.uid()가 null → 거부)
  if auth.uid() is null or not exists (
    select 1 from organization_admins
    where user_id = auth.uid() and org_id = v_org_id
  ) then
    return json_build_object('success', false, 'message', '이 부서를 삭제할 권한이 없습니다.');
  end if;

  if v_is_active is not true then
    return json_build_object('success', false, 'message', '이미 삭제된 부서입니다.');
  end if;

  -- 3) 서명 기록 / 연수 대상 연결 / 업로드 실패 기록이 "모두 없는" 활성 구성원만 실제 삭제
  --    (기록 테이블의 행은 지우지 않습니다. 읽기만 합니다.)
  delete from members m
   where m.org_id = v_org_id
     and m.department_id = p_department_id
     and m.is_active
     and not exists (select 1 from signatures s        where s.member_id = m.id)
     and not exists (select 1 from training_members tm where tm.member_id = m.id)
     and not exists (select 1 from upload_failures f   where f.member_id = m.id);
  get diagnostics v_deleted = row_count;

  -- 4) 남은 "활성" 구성원 = 위 세 가지 기록 중 하나라도 있는 구성원
  --    → 삭제하지 않고 비활성화로 보존 (이미 비활성인 구성원은 대상이 아님)
  update members
     set is_active = false,
         updated_at = now()
   where org_id = v_org_id
     and department_id = p_department_id
     and is_active;
  get diagnostics v_kept = row_count;

  -- 5) 부서는 기존 방식대로 비활성화 (보존된 구성원이 부서를 참조하므로 삭제하지 않음)
  update departments
     set is_active = false
   where id = p_department_id;

  return json_build_object(
    'success', true,
    'department_name', v_name,
    'deleted_member_count', v_deleted,
    'kept_member_count', v_kept
  );
end;
$$;

revoke all on function delete_department_with_members(uuid) from public;
grant execute on function delete_department_with_members(uuid) to authenticated;


-- ============================================================
-- 실행 전 확인 사항 (실행할 필요 없음 — 읽고 확인만 하세요)
-- ============================================================
--  1) 15_readonly_checks.sql 의 Q02(외래 키), Q08(현재 delete_department_with_members 정의),
--     Q07(권한)을 먼저 확인합니다. members 를 참조하는 다른 외래 키가 있으면, 그 참조가 있는
--     구성원은 삭제가 오류로 거부되고 함수 전체가 취소됩니다(데이터는 그대로).
--  2) 이 함수가 만드는 삭제는 되돌릴 수 없습니다. 첫 사용 전에 members, departments,
--     signatures, training_members, upload_failures 표를 CSV 로 백업해 두세요.
--  3) 화면(admin-extras.js)의 삭제 확인창은 아직 "서명 기록이 있는 N명"만 따로 안내합니다.
--     v3 는 연수 대상 연결/업로드 실패 기록이 있는 구성원도 보존하므로, 화면 안내 숫자와
--     실제 결과가 다를 수 있습니다. 화면 문구 수정은 별도 승인 후 진행합니다(이 파일은
--     화면 코드를 바꾸지 않습니다).
--  4) 삭제된 부서에 다른 사용자가 같은 순간 구성원을 추가하는 경쟁 상태는 이 파일이
--     막지 않습니다(별도 트리거 안, 수정안 B 사항).
--  5) 먼저 테스트용 부서로 확인하세요. 서명이 쌓인 실제 부서는 마지막에 사용하세요.
--
-- 확인용 조회 (읽기 전용, 삭제 전후로 같은 숫자여야 하는 값)
-- select (select count(*) from signatures)        as 서명기록,
--        (select count(*) from training_members)  as 연수대상연결,
--        (select count(*) from upload_failures)   as 업로드실패기록;
