-- ============================================================
--  15_readonly_checks.sql — 실제 Supabase 확인용 읽기 전용 쿼리 모음
--
--  ★ 전부 SELECT 전용입니다. 데이터·구조·함수·권한을 바꾸지 않습니다.
--  ★ Supabase 대시보드 → SQL Editor 에서 쿼리를 '하나씩' 드래그로 선택한 뒤 Run 하세요.
--    (여러 개를 한꺼번에 실행하면 마지막 결과만 보입니다)
--  ★ 결과 표는 이름·구성원 정보가 들어 있으니, 공유할 때 화면 캡처보다 필요한 행만 복사해 주세요.
--  ★ 결과는 '현재 운영 DB'의 실제 상태입니다. 문서와 다르면 문서가 아니라 이 결과가 기준입니다.
-- ============================================================

-- ------------------------------------------------------------
-- Q01. 환경: DB 버전과 정렬 규칙(collation)
-- ------------------------------------------------------------
select version() as 버전,
       current_setting('server_version') as server_version,
       (select datcollate from pg_database where datname = current_database()) as 정렬규칙_collation;

-- ------------------------------------------------------------
-- Q02. [외래키 ①] members를 참조하는 모든 외래 키와 ON DELETE 동작
-- ------------------------------------------------------------
select c.conrelid::regclass as 참조하는_테이블,
       a.attname as 컬럼,
       c.conname as 제약이름,
       case c.confdeltype when 'a' then 'NO ACTION' when 'r' then 'RESTRICT' when 'c' then 'CASCADE'
                          when 'n' then 'SET NULL' when 'd' then 'SET DEFAULT' end as on_delete,
       case c.confupdtype when 'a' then 'NO ACTION' when 'r' then 'RESTRICT' when 'c' then 'CASCADE'
                          when 'n' then 'SET NULL' when 'd' then 'SET DEFAULT' end as on_update,
       c.condeferrable as 지연가능,
       pg_get_constraintdef(c.oid) as 정의
from pg_constraint c
join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
where c.contype = 'f' and c.confrelid = 'public.members'::regclass
order by 1, 2;

-- ------------------------------------------------------------
-- Q03. [외래키] departments를 참조하는 모든 외래 키와 ON DELETE 동작 (부서 행을 남겨 두는 이유 확인용)
-- ------------------------------------------------------------
select c.conrelid::regclass as 참조하는_테이블,
       a.attname as 컬럼,
       c.conname as 제약이름,
       case c.confdeltype when 'a' then 'NO ACTION' when 'r' then 'RESTRICT' when 'c' then 'CASCADE'
                          when 'n' then 'SET NULL' when 'd' then 'SET DEFAULT' end as on_delete,
       pg_get_constraintdef(c.oid) as 정의
from pg_constraint c
join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
where c.contype = 'f' and c.confrelid = 'public.departments'::regclass
order by 1, 2;

-- ------------------------------------------------------------
-- Q04. [외래키] public 스키마 전체 외래 키 목록 (빠진 참조가 없는지 전체 확인)
-- ------------------------------------------------------------
select c.conrelid::regclass as 테이블,
       c.conname as 제약이름,
       c.confrelid::regclass as 참조대상,
       case c.confdeltype when 'a' then 'NO ACTION' when 'r' then 'RESTRICT' when 'c' then 'CASCADE'
                          when 'n' then 'SET NULL' when 'd' then 'SET DEFAULT' end as on_delete,
       pg_get_constraintdef(c.oid) as 정의
from pg_constraint c
where c.contype = 'f' and c.connamespace = 'public'::regnamespace
order by 1, 2;

-- ------------------------------------------------------------
-- Q05. [외래키 ②] 외래 키는 없지만 구성원/부서를 가리킬 수 있는 컬럼 (느슨한 참조)
-- ------------------------------------------------------------
select table_name as 테이블, column_name as 컬럼, data_type as 자료형, is_nullable as null_허용
from information_schema.columns
where table_schema = 'public'
  and column_name ~* '(member|dept|department)'
order by table_name, column_name;

-- ------------------------------------------------------------
-- Q06. [트리거] members, departments 및 관련 테이블의 기존 트리거(정의 포함)
-- ------------------------------------------------------------
select tgrelid::regclass as 테이블,
       tgname as 트리거,
       tgenabled as 활성여부,
       pg_get_triggerdef(oid) as 정의
from pg_trigger
where not tgisinternal
  and tgrelid in ('public.members'::regclass, 'public.departments'::regclass,
                  'public.training_members'::regclass, 'public.signatures'::regclass,
                  'public.trainings'::regclass, 'public.upload_failures'::regclass)
order by 1, 2;

-- ------------------------------------------------------------
-- Q07. [함수] 관련 함수 목록: 인자, 반환 형식, SECURITY DEFINER, search_path 설정, 소유자, 실행 권한
-- ------------------------------------------------------------
select p.proname as 함수,
       pg_get_function_arguments(p.oid) as 인자,
       pg_get_function_result(p.oid) as 반환,
       p.prosecdef as security_definer,
       p.proconfig::text as 설정,
       pg_get_userbyid(p.proowner) as 소유자,
       p.proacl::text as 실행권한
from pg_proc p
where p.pronamespace = 'public'::regnamespace
  and p.prokind = 'f'
  and (p.proname in ('get_training_targets','get_public_departments','get_department_members',
                     'get_member_training_statuses','get_org_public_info','get_training_public',
                     'submit_signature','check_already_signed','log_upload_failure',
                     'delete_department_with_members','bulk_import_members','delete_training',
                     'reorder_members','reorder_departments','my_org_ids')
       or p.prosrc ilike '%members%' or p.prosrc ilike '%departments%')
order by 1;

-- ------------------------------------------------------------
-- Q08. [함수] 관련 함수의 전체 정의 (현재 설치된 실제 코드)
-- ------------------------------------------------------------
select p.proname as 함수,
       pg_get_functiondef(p.oid) as 정의
from pg_proc p
where p.pronamespace = 'public'::regnamespace
  and p.prokind = 'f'
  and p.proname in ('get_training_targets','get_public_departments','get_department_members',
                    'get_member_training_statuses','get_org_public_info','get_training_public',
                    'submit_signature','check_already_signed','log_upload_failure',
                    'delete_department_with_members','bulk_import_members','delete_training',
                    'reorder_members','reorder_departments','my_org_ids')
order by 1;

-- ------------------------------------------------------------
-- Q09. [보안] 관련 테이블의 RLS 정책
-- ------------------------------------------------------------
select tablename as 테이블, policyname as 정책, cmd as 작업, roles::text as 대상, qual as 조회조건, with_check as 저장조건
from pg_policies
where schemaname = 'public'
  and tablename in ('members','departments','signatures','training_members','training_target_departments','upload_failures','trainings')
order by tablename, cmd, policyname;

-- ------------------------------------------------------------
-- Q10. [보안] 관련 테이블의 anon / authenticated 테이블 권한
-- ------------------------------------------------------------
select table_name as 테이블, grantee as 대상, string_agg(privilege_type, ', ' order by privilege_type) as 권한
from information_schema.role_table_grants
where table_schema = 'public'
  and grantee in ('anon', 'authenticated')
  and table_name in ('members','departments','signatures','training_members','training_target_departments','upload_failures','trainings')
group by table_name, grantee
order by 1, 2;

-- ------------------------------------------------------------
-- Q11. [데이터] 테이블별 전체 행 수
-- ------------------------------------------------------------
select '학교(organizations)' as 표, count(*) as 행수 from organizations
union all select '관리자(organization_admins)', count(*) from organization_admins
union all select '부서(departments)', count(*) from departments
union all select '구성원(members)', count(*) from members
union all select '연수(trainings)', count(*) from trainings
union all select '서명 기록(signatures)', count(*) from signatures
union all select '연수 대상 구성원 연결(training_members)', count(*) from training_members
union all select '연수 대상 부서 연결(training_target_departments)', count(*) from training_target_departments
union all select '업로드 실패 기록(upload_failures)', count(*) from upload_failures
order by 1;

-- ------------------------------------------------------------
-- Q12. [외래키 ③] 연결 데이터 규모: training_members, training_target_departments, upload_failures
-- ------------------------------------------------------------
select 'training_members' as 표, count(*) as 행수 from training_members
union all select 'training_target_departments', count(*) from training_target_departments
union all select 'upload_failures(구성원 지정됨)', count(*) from upload_failures where member_id is not null;

-- ------------------------------------------------------------
-- Q13. [데이터] training_members 연결 상세 — 어떤 연수에 어떤 구성원이 연결돼 있는지, 그 구성원의 현재 상태
-- ------------------------------------------------------------
select o.public_code as 학교,
       t.title as 연수,
       t.date as 연수일,
       m.name as 구성원,
       m.is_active as 구성원활성,
       d.name as 부서,
       d.is_active as 부서활성,
       (select count(*) from signatures s where s.member_id = m.id and s.training_id = tm.training_id) as 같은연수_서명수
from training_members tm
join members m on m.id = tm.member_id
join trainings t on t.id = tm.training_id
join organizations o on o.id = m.org_id
left join departments d on d.id = m.department_id
order by 1, 3, 2, 4;

-- ------------------------------------------------------------
-- Q14. [데이터] 구성원 상태별 기록 보유 현황 — 부서 삭제 시 '삭제 가능 / 보존 대상'을 가르는 근거
-- ------------------------------------------------------------
select m.is_active as 구성원활성,
       d.is_active as 부서활성_null이면_부서없음,
       count(*) as 인원,
       count(*) filter (where exists (select 1 from signatures s where s.member_id = m.id)) as 서명기록_있음,
       count(*) filter (where exists (select 1 from training_members tm where tm.member_id = m.id)) as 연수대상연결_있음,
       count(*) filter (where exists (select 1 from upload_failures f where f.member_id = m.id)) as 업로드실패기록_있음,
       count(*) filter (where not exists (select 1 from signatures s where s.member_id = m.id)
                          and not exists (select 1 from training_members tm where tm.member_id = m.id)
                          and not exists (select 1 from upload_failures f where f.member_id = m.id)) as 어떤기록도_없음
from members m
left join departments d on d.id = m.department_id
group by m.is_active, d.is_active
order by 1 desc, 2;

-- ------------------------------------------------------------
-- Q15. [데이터] 삭제된(비활성) 부서에 '활성' 구성원이 남아 있는지 (수정안 B가 막으려는 상태가 이미 있는지 확인)
-- ------------------------------------------------------------
select o.public_code as 학교, d.name as 부서, m.name as 구성원, m.member_type as 구분, m.created_at as 등록시각
from members m
join departments d on d.id = m.department_id and d.is_active = false
join organizations o on o.id = m.org_id
where m.is_active = true
order by 1, 2, 5;

-- ------------------------------------------------------------
-- Q16. [데이터] 부서 순서 현황 — 등록 순서(created_at)와 sort_order 값 비교
-- ------------------------------------------------------------
select o.public_code as 학교, d.sort_order, d.name as 부서, d.is_active as 활성, d.created_at as 등록시각
from departments d
join organizations o on o.id = d.org_id
order by o.public_code, d.is_active desc, d.sort_order, d.created_at;

-- ------------------------------------------------------------
-- Q17. [데이터] 학교별 부서 sort_order 분포 (모두 0이면 '순서 미지정' 상태)
-- ------------------------------------------------------------
select o.public_code as 학교,
       count(*) as 부서수,
       count(distinct d.sort_order) as 서로다른_순서값_수,
       min(d.sort_order) as 최소값,
       max(d.sort_order) as 최대값
from departments d
join organizations o on o.id = d.org_id
group by o.public_code
order by 1;

-- ------------------------------------------------------------
-- Q18. [이전 쿼리 ①] 공통 주소(?org=) 흐름 함수의 실제 정의 — 가장 중요
-- ------------------------------------------------------------
select proname, pg_get_function_arguments(oid) as args, pg_get_function_result(oid) as result, pg_get_functiondef(oid) as def
from pg_proc
where pronamespace = 'public'::regnamespace
  and proname in ('get_public_departments','get_department_members');

-- ------------------------------------------------------------
-- Q19. [이전 쿼리 ②] members, departments 실제 컬럼
-- ------------------------------------------------------------
select table_name, column_name, data_type, column_default, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name in ('members','departments')
order by table_name, ordinal_position;

-- ------------------------------------------------------------
-- Q20. [이전 쿼리 ③] 비활성 구성원 현황 (조회만)
-- ------------------------------------------------------------
select d.name as 부서, d.is_active as 부서활성, m.name as 이름, m.is_active as 구성원활성, m.updated_at,
       (select count(*) from signatures s where s.member_id = m.id) as 서명기록수,
       (select count(*) from training_members tm where tm.member_id = m.id) as 연수대상연결수
from members m
left join departments d on d.id = m.department_id
where m.is_active = false
order by d.is_active, d.name, m.updated_at, m.name;

-- ------------------------------------------------------------
-- Q21. [13번 파일 조회 1] 비활성 구성원 전체 현황 (같은 시각 함께 처리된 인원 포함)
-- ------------------------------------------------------------
select o.public_code as 학교, d.name as 부서, d.is_active as 부서활성, m.name as 이름, m.member_type as 구분,
       m.updated_at as 비활성처리시각,
       (select count(*) from signatures s where s.member_id = m.id) as 서명기록수,
       (select count(*) from training_members tm where tm.member_id = m.id) as 연수대상연결수,
       count(*) over (partition by m.department_id, m.updated_at) as 같은시각_처리된_인원
from members m
join organizations o on o.id = m.org_id
left join departments d on d.id = m.department_id
where m.is_active = false
order by o.public_code, d.is_active, d.name, m.updated_at, m.name;

-- ------------------------------------------------------------
-- Q22. [13번 파일 조회 2] 부서 상태 x 서명 기록 유무별 비활성 인원 요약
-- ------------------------------------------------------------
select o.public_code as 학교,
       case when d.id is null then '부서 없음' when d.is_active then '활성 부서' else '삭제된 부서' end as 부서상태,
       case when exists (select 1 from signatures s where s.member_id = m.id)
            then '서명 기록 있음(삭제 불가)' else '서명 기록 없음' end as 서명기록,
       count(*) as 인원
from members m
join organizations o on o.id = m.org_id
left join departments d on d.id = m.department_id
where m.is_active = false
group by 1, 2, 3
order by 1, 2, 3;

-- ------------------------------------------------------------
-- Q23. [13번 파일 조회 3] 정리 '후보' (후보일 뿐 — 삭제 대상으로 확정된 것이 아님)
-- ------------------------------------------------------------
select m.id as 구성원ID, o.public_code as 학교, d.name as 부서, m.name as 이름, m.updated_at as 비활성처리시각,
       count(*) over (partition by m.department_id, m.updated_at) as 같은시각_처리된_인원
from members m
join organizations o on o.id = m.org_id
join departments d on d.id = m.department_id and d.is_active = false
where m.is_active = false
  and not exists (select 1 from signatures s where s.member_id = m.id)
  and not exists (select 1 from training_members tm where tm.member_id = m.id)
order by o.public_code, d.name, m.updated_at, m.name;

-- ------------------------------------------------------------
-- Q24. [이전 통합 확인 쿼리] 컬럼, 트리거, 함수, 정렬 규칙 한 번에
-- ------------------------------------------------------------
select 'column'::text as 구분, (table_name || '.' || column_name)::text as 항목, data_type::text as 상세
from information_schema.columns
where table_schema = 'public'
  and ((table_name = 'members' and column_name in ('sort_order','updated_at','member_type','is_active','created_at'))
    or (table_name = 'departments' and column_name in ('sort_order','is_active','created_at')))
union all
select 'trigger', (tgrelid::regclass::text || '.' || tgname)::text, ''::text
from pg_trigger
where not tgisinternal and tgrelid in ('public.members'::regclass, 'public.departments'::regclass)
union all
select 'function', proname::text,
       (case when prosrc ilike '%is_active%' then 'is_active 언급 있음' else 'is_active 언급 없음' end)::text
from pg_proc
where pronamespace = 'public'::regnamespace
  and proname in ('delete_department_with_members','bulk_import_members','get_training_targets','reorder_members','reorder_departments')
union all
select 'collation', datname::text, datcollate::text
from pg_database where datname = current_database();

-- ------------------------------------------------------------
-- Q25. [선택] members.sort_order 분포 — 10번 SQL을 실행한 뒤에만 사용 (실행 전에는 컬럼이 없어 오류가 납니다)
-- ------------------------------------------------------------
select o.public_code as 학교, d.name as 부서, count(*) as 구성원수,
       count(distinct m.sort_order) as 서로다른_순서값_수, min(m.sort_order) as 최소, max(m.sort_order) as 최대
from members m
join organizations o on o.id = m.org_id
left join departments d on d.id = m.department_id
where m.is_active
group by o.public_code, d.name, d.sort_order
order by o.public_code, d.sort_order, d.name;
