-- ============================================================
--  09_department_delete.sql
--  delete_department_with_members — 부서 + 소속 구성원 일괄 삭제 전용 RPC
--
--  ★ Supabase 대시보드 → SQL Editor 에서 이 파일 전체를 한 번 실행해주세요.
--    (새 함수 1개만 추가합니다. 기존 테이블/컬럼/RLS/트리거/다른 RPC는
--     전혀 건드리지 않습니다. 같은 내용을 다시 실행해도 안전합니다.)
--
--  "삭제"의 의미 — 기존 구성원 삭제 버튼과 같은 방식(비활성화)입니다:
--    · departments.is_active = false  → 구성원관리/부서 선택 목록에서 사라짐
--    · 그 부서 소속 members.is_active = false → 구성원 목록에서 사라짐
--      ("비활성 구성원 포함"을 켜면 다시 볼 수 있고 "복원"할 수 있음)
--    · 행(row)을 물리적으로 지우지 않습니다.
--
--  왜 물리 삭제가 아닌가 (과거 서명 기록 보존):
--    signatures.member_id → members(id) 외래 키가 있어, 서명 기록이 있는
--    구성원을 물리 삭제하면 실패하거나 기록 연결이 끊어집니다. 서명 기록에는
--    서명 당시의 name_snapshot / department_snapshot이 따로 저장되어 있지만,
--    기록과 구성원의 연결(member_id)까지 그대로 보존하려면 구성원 행을
--    남겨 두는 비활성화 방식이 가장 안전합니다. signatures 테이블은
--    이 함수에서 읽지도, 쓰지도, 지우지도 않습니다.
--
--  안전장치:
--    · SECURITY DEFINER + search_path 고정 (기존 delete_training과 같은 패턴)
--    · 호출자(auth.uid())가 그 부서가 속한 학교의 organization_admins에
--      등록되어 있는지 서버에서 확인 — 다른 학교 부서는 처리 불가
--    · 한 함수 호출 = 하나의 트랜잭션: 중간에 오류가 나면 전부 취소
--    · 부서 행을 FOR UPDATE로 잠가 같은 부서를 동시에 두 번 처리하지 않음
--    · 로그인한 관리자(authenticated)만 실행 가능 (anon/PUBLIC 실행 권한 없음)
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
  v_member_count int;
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

  -- 3) 이 학교, 이 부서의 활성 구성원을 비활성화 (서명 기록은 건드리지 않음)
  update members
     set is_active = false,
         updated_at = now()
   where org_id = v_org_id
     and department_id = p_department_id
     and is_active = true;
  get diagnostics v_member_count = row_count;

  -- 4) 부서 비활성화
  update departments
     set is_active = false
   where id = p_department_id;

  return json_build_object(
    'success', true,
    'department_name', v_name,
    'deleted_member_count', v_member_count
  );
end;
$$;

-- 로그인한 관리자(authenticated)만 호출 가능 (연수생 anon에게는 부여하지 않음)
revoke all on function delete_department_with_members(uuid) from public;
grant execute on function delete_department_with_members(uuid) to authenticated;

-- ============================================================
-- 검증용 (실행할 필요 없음 — 확인하고 싶을 때만, 모두 조회만 합니다)
-- ============================================================

-- select proname, prosecdef, proconfig from pg_proc where proname = 'delete_department_with_members';

-- 삭제(비활성화)된 부서와 그 구성원 수 확인
-- select d.name, d.is_active, count(m.id) as members
-- from departments d left join members m on m.department_id = d.id
-- group by d.id, d.name, d.is_active order by d.is_active desc, d.name;

-- 서명 기록이 그대로인지 확인 (삭제 전후로 같은 숫자여야 함)
-- select count(*) from signatures;
