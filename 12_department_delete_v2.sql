-- ============================================================
--  12_department_delete_v2.sql
--  delete_department_with_members — "앞으로" 부서를 삭제할 때의 구성원 처리 방식 변경
--
--  ★ Supabase 대시보드 → SQL Editor 에서 이 파일 전체를 한 번 실행해주세요.
--    · 09_department_delete.sql 로 만든 같은 이름의 함수를 교체합니다.
--      (create or replace — 함수 이름/인자/반환 형식/호출 방법이 같아 화면 코드와 호환)
--    · 이 파일을 실행하는 것만으로는 기존 데이터가 하나도 삭제되지 않습니다.
--      삭제는 나중에 관리자가 화면에서 "이 부서 삭제"를 눌렀을 때,
--      그 부서에 대해서만 일어납니다.
--    · 과거에 부서를 삭제해서 남아 있는 비활성 구성원 데이터는 이 파일이 건드리지 않습니다.
--      (정리 방법은 13/14 파일에서 따로 확인 후 진행합니다)
--
--  바뀌는 동작 (부서를 삭제할 때, 그 부서의 "활성" 구성원에 대해)
--
--   이전(09)  모든 활성 구성원을 비활성화(is_active = false) → 비활성 구성원으로 계속 남음
--   이후(12)  · 서명 기록이 "없는" 구성원 → 연수 대상 연결(training_members)을 지우고
--                구성원 행을 실제로 삭제 (비활성 구성원으로 남지 않음)
--             · 서명 기록이 "있는" 구성원 → 삭제하지 않음. signatures.member_id가
--                members(id)를 참조하고 있어 삭제하면 서명 이력 연결이 깨지기 때문.
--                비활성화만 해서 보존 (화면에서는 삭제된 부서 소속이므로 목록에서 숨김)
--
--   그대로인 것
--    · 부서 자체는 삭제하지 않고 비활성화(is_active = false)  — 보존된 구성원이 부서를 참조하므로
--    · 부서 삭제 전에 이미 개별적으로 비활성화되어 있던 구성원은 건드리지 않음(보존)
--    · signatures 테이블은 읽기만 하고 변경/삭제하지 않음
--    · 호출자가 그 학교 관리자인지 서버에서 확인, 다른 학교 부서는 처리 불가
--    · 한 번 호출 = 하나의 트랜잭션: 중간에 오류가 나면(예: 예상 못 한 참조 때문에
--      삭제가 막히는 경우) 전부 취소되어 일부만 삭제된 상태가 남지 않음
--    · SECURITY DEFINER + search_path 고정, 로그인한 관리자(authenticated)만 실행 가능
--
--  반환 값: success, department_name,
--           deleted_member_count (실제로 삭제한 구성원 수),
--           kept_member_count    (서명 기록이 있어 보존한 구성원 수)
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

  -- 3) 서명 기록이 없는 "활성" 구성원: 연수 대상 연결을 먼저 정리한 뒤 실제 삭제
  delete from training_members tm
   using members m
   where tm.member_id = m.id
     and m.org_id = v_org_id
     and m.department_id = p_department_id
     and m.is_active
     and not exists (select 1 from signatures s where s.member_id = m.id);

  delete from members m
   where m.org_id = v_org_id
     and m.department_id = p_department_id
     and m.is_active
     and not exists (select 1 from signatures s where s.member_id = m.id);
  get diagnostics v_deleted = row_count;

  -- 4) 남은 "활성" 구성원 = 서명 기록이 있는 구성원 → 삭제하지 않고 비활성화로 보존
  update members
     set is_active = false,
         updated_at = now()
   where org_id = v_org_id
     and department_id = p_department_id
     and is_active;
  get diagnostics v_kept = row_count;

  -- 5) 부서 비활성화
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
