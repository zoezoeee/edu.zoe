-- ============================================================
--  17_check_org_flow_functions_READONLY.sql — 조회 전용 (데이터/함수를 바꾸지 않습니다)
--  학교 공통 주소(?org=) 화면이 쓰는 두 함수의 정렬 방식을 확인합니다.
--  결과(특히 def 열)를 그대로 복사해서 알려주시면 정렬 부분만 최소 수정해 드립니다.
-- ============================================================

-- A. 두 함수의 현재 정의
select proname,
       pg_get_function_arguments(oid) as args,
       pg_get_function_result(oid)    as result,
       prosecdef                      as security_definer,
       proconfig                      as config,
       pg_get_functiondef(oid)        as def
from pg_proc
where pronamespace = 'public'::regnamespace
  and proname in ('get_public_departments', 'get_department_members');

-- B. 실행 권한
select routine_name, grantee, privilege_type
from information_schema.role_routine_grants
where routine_schema = 'public'
  and routine_name in ('get_public_departments', 'get_department_members', 'get_training_targets',
                       'reorder_members', 'reorder_departments', 'bulk_import_members')
order by routine_name, grantee;

-- C. 현재 bulk_import_members 함수의 실제 정의 (Supabase에 배포된 버전 확인용)
select
    proname,
    pg_get_function_arguments(oid) as args,
    pg_get_function_result(oid)    as result,
    prosecdef                      as security_definer,
    proconfig                      as config,
    pg_get_functiondef(oid)        as def
from pg_proc
where oid = 'public.bulk_import_members(uuid, jsonb)'::regprocedure;
