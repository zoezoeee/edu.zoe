-- ============================================================
--  18_member_delete.sql
--  delete_member(uuid) — 구성원 개별 삭제 (서명 기록은 그대로 보존)
--
--  ★ 새 파일입니다. 기존 SQL/함수/테이블은 하나도 바꾸지 않습니다
--    (새 함수 delete_member 한 개만 추가). 여러 번 실행해도 안전합니다.
--  ★ 실행 순서: 12_department_delete_v3.sql → 이 파일
--
--  동작 (관리자가 구성원 한 명의 "삭제"를 눌렀을 때, 그 한 명에 대해서만)
--    · 서명 기록(signatures) / 연수 대상 연결(training_members) /
--      업로드 실패 기록(upload_failures) 이 "하나도 없는" 구성원
--        → 구성원 행을 완전히 삭제합니다.
--    · 하나라도 있는 구성원 (= 이미 서명했거나 연수 대상 연결이 있는 사람)
--        → 행은 남기고 is_active = false 로만 바꿉니다.
--          (과거 연수의 서명 기록이 이 행을 가리키고 있어서 지울 수 없습니다.
--           이 구성원은 구성원관리 목록에는 나타나지 않고, 이미 서명한
--           연수의 서명현황/서명부에는 서명 당시 이름 그대로 계속 표시됩니다.)
--    · signatures / training_members / upload_failures 는 읽기만 하고
--      INSERT / UPDATE / DELETE 를 하지 않습니다. CASCADE 도 쓰지 않습니다.
--
--  보안
--    · SECURITY DEFINER + search_path = public, pg_temp
--    · 로그인한 사용자가 "그 구성원이 속한 학교의 관리자"인지 organization_admins 로 확인
--      (다른 학교 구성원은 삭제할 수 없음, 로그인하지 않은 경우 거부)
--    · 실행 권한은 authenticated 만 (anon 에게는 주지 않음)
--
--  동시에 서명이 제출되는 경우
--    · 삭제 직전에 서명이 들어와 DB 가 삭제를 거부하면(외래키), 오류로 끝내지 않고
--      자동으로 "보존(비활성)" 처리로 바꿉니다. 서명 기록은 어떤 경우에도 손대지 않습니다.
-- ============================================================

create or replace function delete_member(p_member_id uuid)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org_id uuid;
  v_name text;
  v_is_active boolean;
  v_has_records boolean;
begin
  -- 1) 구성원과 소속 학교 확인 (동시 처리 방지를 위해 행 잠금)
  select org_id, name, is_active
    into v_org_id, v_name, v_is_active
  from members
  where id = p_member_id
  for no key update;

  if v_org_id is null then
    return json_build_object('success', false, 'message', '존재하지 않는 구성원입니다.');
  end if;

  -- 2) 호출자가 이 학교의 관리자인지 확인
  if auth.uid() is null or not exists (
    select 1 from organization_admins
    where user_id = auth.uid() and org_id = v_org_id
  ) then
    return json_build_object('success', false, 'message', '권한이 없습니다.');
  end if;

  -- 3) 이 구성원을 가리키는 기록이 있는지 확인 (읽기만 함)
  v_has_records :=
       exists (select 1 from signatures       where member_id = p_member_id)
    or exists (select 1 from training_members where member_id = p_member_id)
    or exists (select 1 from upload_failures  where member_id = p_member_id);

  if not v_has_records then
    begin
      delete from members where id = p_member_id;
      return json_build_object(
        'success', true, 'member_name', v_name, 'deleted', true, 'kept', false);
    exception when foreign_key_violation then
      -- 확인 직후 서명 등이 들어와 DB 가 삭제를 거부한 경우 → 아래 보존 처리로 이어짐
      null;
    end;
  end if;

  -- 4) 기록이 있는 구성원: 행은 남기고 비활성으로만 표시 (이미 비활성이면 그대로)
  if v_is_active then
    update members set is_active = false where id = p_member_id;
  end if;

  return json_build_object(
    'success', true, 'member_name', v_name, 'deleted', false, 'kept', true);
end;
$$;

revoke all on function delete_member(uuid) from public;
grant execute on function delete_member(uuid) to authenticated;


-- ============================================================
-- 실행 전 확인 사항 (실행할 필요 없음 — 읽고 확인만 하세요)
-- ============================================================
-- 1) 이 파일을 실행하는 것만으로는 기존 데이터가 하나도 바뀌지 않습니다.
--    구성원이 삭제/보존 처리되는 것은 관리자가 화면에서 "삭제"를 눌렀을 때,
--    그 구성원 한 명에 대해서만입니다.
-- 2) 이미 예전에 "삭제"(비활성화)해서 남아 있는 구성원은 이 파일이 건드리지 않습니다.
--    (화면에서는 숨겨지며, 정리는 13번 조회 → 별도 확인 후 진행)
-- 3) 실행 후 확인 (조회만):
--    select proname, prosecdef, proconfig
--    from pg_proc where proname = 'delete_member';
--    → prosecdef = true, proconfig = {search_path=public,pg_temp}
