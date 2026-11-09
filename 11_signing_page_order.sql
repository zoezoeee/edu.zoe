-- ============================================================
--  11_signing_page_order.sql — 서명 페이지(개별 연수 링크)의 정렬 기준만 변경
--
--  ★ Supabase 대시보드 → SQL Editor 에서 이 파일 전체를 한 번 실행해주세요.
--    ★ 반드시 10_member_dept_order.sql 을 먼저 실행한 뒤에 실행하세요.
--      (members.sort_order 컬럼이 있어야 이 함수가 만들어집니다)
--
--  바뀌는 것은 마지막 ORDER BY 한 줄뿐입니다. 그 밖의 모든 것은
--  08_training_target_type.sql 로 만든 현재 함수와 완전히 같습니다.
--    · 반환 형식   : (member_id uuid, member_name text, department_name text) — 그대로
--    · 대상자 규칙 : 교원 연수 → 교원 / 교직원 연수 → 교원+교직원, 활성 구성원만 — 그대로
--    · 학교 분리   : public_code로 학교를 찾고 그 학교 구성원만 — 그대로
--    · 보안 설정   : SECURITY DEFINER + search_path 고정 — 그대로
--    · 실행 권한   : anon, authenticated — 그대로 (PUBLIC 실행 권한 없음)
--
--  정렬 기준
--    이전: d.sort_order, d.name, m.name           (부서 번호가 모두 0이라 사실상 가나다순)
--    이후: 부서 순서(sort_order → 등록 시각 → ID) → 부서 안 구성원 순서(sort_order → 이름 → ID)
--          부서가 없는 구성원은 맨 뒤
--  → 관리자가 구성원관리에서 저장한 순서가 서명 화면에 그대로 전달됩니다.
--    (app.js의 가나다 재정렬 2줄은 함께 제거합니다.)
--
--  create or replace 를 쓰므로 기존 권한 설정이 유지되며, 아래에서 한 번 더 명시합니다.
-- ============================================================

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
