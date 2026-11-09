-- ============================================================
--  14_cleanup_inactive_members_DRAFT_DO_NOT_RUN.sql
--
--  ⛔ 이 파일은 "초안"입니다. 승인 전에는 실행하지 마세요. ⛔
--
--  사용 순서
--   1) 13_cleanup_candidates_READONLY.sql 의 [조회 3] 결과를 확인합니다.
--   2) 지워도 되는 구성원(부서 삭제로 남은 것이 확실한 사람)만 골라 "구성원ID"를 복사합니다.
--      개별로 비활성화한 구성원이거나 확실하지 않은 사람은 목록에서 제외합니다.
--   3) 확인한 구성원ID 목록을 저에게 보여 주시고, 승인하신 뒤에만 아래 [단계 A]부터 실행합니다.
--
--  안전장치(아래 쿼리에 모두 포함되어 있어, ID를 잘못 넣어도 해당 행은 지워지지 않습니다)
--   · 비활성(is_active = false)인 구성원만
--   · 삭제된 부서(is_active = false) 소속인 구성원만
--   · 서명 기록이 하나라도 있으면 삭제하지 않음
--   · signatures 테이블은 읽기만 합니다(변경/삭제 없음)
--   · 먼저 "무엇이 지워질지" 미리 보고(단계 A), 그 다음 하나의 트랜잭션으로 지움(단계 B)
-- ============================================================

-- ------------------------------------------------------------
-- [단계 A] 미리보기 — 아무것도 지우지 않습니다
--   아래 ('...') 자리에 확인한 구성원ID를 쉼표로 구분해 넣으세요.
-- ------------------------------------------------------------
with target(id) as (
  select unnest(array[
    -- '00000000-0000-0000-0000-000000000000'::uuid,
    -- '00000000-0000-0000-0000-000000000001'::uuid
  ]::uuid[])
)
select m.id, o.public_code as 학교, d.name as 부서, m.name as 이름, m.updated_at,
       '삭제됨(단계 B 실행 시)' as 결과
from target t
join members m on m.id = t.id
join organizations o on o.id = m.org_id
join departments d on d.id = m.department_id
where m.is_active = false
  and d.is_active = false
  and not exists (select 1 from signatures s where s.member_id = m.id)
order by o.public_code, d.name, m.name;
-- → 미리보기에 나온 사람 수가 내가 고른 사람 수와 같은지 확인하세요.
--   다르면(조건에 맞지 않아 빠진 사람이 있으면) 그 사람은 지워지지 않습니다.


-- ------------------------------------------------------------
-- [단계 B] 실제 삭제 — 승인 후에만, [단계 A]와 같은 ID 목록으로 실행
-- ------------------------------------------------------------
-- begin;
--
-- with target(id) as (
--   select unnest(array[
--     -- 같은 ID 목록
--   ]::uuid[])
-- ),
-- ok as (
--   select m.id
--   from target t
--   join members m on m.id = t.id
--   join departments d on d.id = m.department_id
--   where m.is_active = false
--     and d.is_active = false
--     and not exists (select 1 from signatures s where s.member_id = m.id)
-- ),
-- del_links as (
--   delete from training_members tm using ok where tm.member_id = ok.id returning 1
-- )
-- delete from members m using ok where m.id = ok.id
-- returning m.id, m.name;
--
-- -- 결과가 맞으면 commit; 이상하면 rollback;
-- commit;
