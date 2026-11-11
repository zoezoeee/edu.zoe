-- ============================================================
--  20_check_deploy_status_READONLY.sql — 조회 전용 (데이터/함수를 바꾸지 않습니다)
--  Supabase에 필요한 SQL이 모두 적용되었는지 한 번에 확인합니다.
--  이 파일 전체를 SQL Editor에서 실행하면 표 하나가 나옵니다.
--  "상태" 열이 모두 OK 이면 적용 완료, "미설치/이전 버전"이 있으면 그 줄의 "실행할 파일"을 실행하세요.
-- ============================================================
with f as (
  select p.proname, pg_get_functiondef(p.oid) as def, p.prosecdef, p.proconfig
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace
    and p.proname in ('delete_member', 'delete_department_with_members', 'bulk_import_members',
                      'reorder_members', 'reorder_departments', 'get_training_targets', 'get_department_members')
)
select c.기능, c.실행할_파일,
       case
         when f.proname is null then '미설치'
         when c.표식 is not null and f.def not ilike '%' || c.표식 || '%' then '이전 버전'
         else 'OK'
       end as 상태
from (values
  ('구성원 개별 삭제 (delete_member)',                'delete_member',                  null,                 '18_member_delete.sql'),
  ('부서 삭제 (delete_department_with_members)',      'delete_department_with_members', 'kept_member_count',  '12_department_delete_v3.sql'),
  ('엑셀 일괄등록 - 삭제했던 구성원 재등록',          'bulk_import_members',            'reactivated_count',  '19_bulk_import_reactivate.sql'),
  ('엑셀 일괄등록 - 엑셀 행 순서 저장',               'bulk_import_members',            'v_ordered_ids',      '16_member_sort_order_fix_locks.sql'),
  ('구성원 순서 저장 (reorder_members)',              'reorder_members',                null,                 '16_member_sort_order_fix_locks.sql'),
  ('부서 순서 저장 (reorder_departments)',            'reorder_departments',            null,                 '16_member_sort_order_fix_locks.sql'),
  ('서명 페이지 정렬 (get_training_targets)',         'get_training_targets',           'sort_order',         '16_member_sort_order_fix_locks.sql'),
  ('공통 주소 구성원 정렬 (get_department_members)',  'get_department_members',         'sort_order',         '16_member_sort_order_fix_locks.sql')
) as c(기능, 함수, 표식, 실행할_파일)
left join f on f.proname = c.함수
order by c.실행할_파일, c.기능;
