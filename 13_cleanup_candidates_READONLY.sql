-- ============================================================
--  13_cleanup_candidates_READONLY.sql — 과거 부서 삭제로 남은 비활성 구성원 "현황 조회"
--
--  ★ 이 파일은 조회(SELECT)만 합니다. 데이터를 바꾸거나 삭제하지 않습니다.
--    Supabase SQL Editor에서 아래 쿼리를 "하나씩" 실행하고 결과를 확인해주세요.
--
--  목적: 비활성 구성원 중 "부서 삭제 때문에 남은 것"과 "관리자가 개별로 비활성화한 것"을
--  이름/부서명만으로 추측하지 않고 확인하기 위한 자료를 만듭니다.
--
--  판단에 쓰는 근거 (확실한 것과 불확실한 것을 구분)
--   · 서명 기록 수 > 0         → 어떤 경우에도 삭제 불가 (서명 이력 보존)
--   · 부서활성 = false         → 삭제된 부서 소속 (부서 삭제를 거친 부서)
--   · 같은 부서에서 updated_at 이 "정확히 같은" 구성원이 2명 이상
--       → 09 함수가 한 번의 트랜잭션으로 함께 비활성화했을 가능성이 높음
--         (※ 높을 뿐 확정은 아님. 1명뿐인 부서는 이 근거를 쓸 수 없음)
--   · 부서가 아직 활성인데 구성원만 비활성 → 개별 비활성화 (이 파일의 정리 대상 아님)
-- ============================================================

-- [조회 1] 비활성 구성원 전체 현황 (먼저 이것부터 보세요)
select
  o.public_code                                   as 학교,
  d.name                                          as 부서,
  d.is_active                                     as 부서활성,
  m.name                                          as 이름,
  m.member_type                                   as 구분,
  m.updated_at                                    as 비활성처리시각,
  (select count(*) from signatures s where s.member_id = m.id)          as 서명기록수,
  (select count(*) from training_members tm where tm.member_id = m.id)  as 연수대상연결수,
  count(*) over (partition by m.department_id, m.updated_at)            as 같은시각_처리된_인원
from members m
join organizations o on o.id = m.org_id
left join departments d on d.id = m.department_id
where m.is_active = false
order by o.public_code, d.is_active, d.name, m.updated_at, m.name;


-- [조회 2] 요약: 부서 상태 × 서명 기록 유무별 인원 수
select
  o.public_code as 학교,
  case when d.id is null then '부서 없음'
       when d.is_active then '활성 부서'
       else '삭제된 부서' end                                           as 부서상태,
  case when exists (select 1 from signatures s where s.member_id = m.id)
       then '서명 기록 있음(삭제 불가)' else '서명 기록 없음' end        as 서명기록,
  count(*)                                                              as 인원
from members m
join organizations o on o.id = m.org_id
left join departments d on d.id = m.department_id
where m.is_active = false
group by 1, 2, 3
order by 1, 2, 3;


-- [조회 3] 정리 "후보" — 삭제된 부서 소속 + 서명 기록 없음 + 연수 대상 연결 없음
--   ※ 후보일 뿐입니다. 이 중에 "부서가 삭제되기 전에 관리자가 개별로 비활성화한 구성원"이
--     섞여 있을 수 있어, 이름/부서명만으로 삭제하지 않습니다.
--     "같은시각_처리된_인원"이 2 이상이면 부서 삭제 때 함께 처리됐을 가능성이 높습니다.
select
  m.id                                           as 구성원ID,
  o.public_code                                  as 학교,
  d.name                                         as 부서,
  m.name                                         as 이름,
  m.updated_at                                   as 비활성처리시각,
  count(*) over (partition by m.department_id, m.updated_at) as 같은시각_처리된_인원
from members m
join organizations o on o.id = m.org_id
join departments d on d.id = m.department_id and d.is_active = false
where m.is_active = false
  and not exists (select 1 from signatures s where s.member_id = m.id)
  and not exists (select 1 from training_members tm where tm.member_id = m.id)
order by o.public_code, d.name, m.updated_at, m.name;
