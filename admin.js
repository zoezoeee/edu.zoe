// ============================================================
//  연수 전자서명 시스템 — 관리자 화면 로직
//
//  이 파일이 하는 일:
//   1) Supabase Auth 세션 확인 (새로고침해도 로그인 유지)
//   2) 세션이 없으면 로그인 화면 표시
//   3) 이메일/비밀번호 로그인 (Supabase Auth)
//   4) 로그인 성공 시, organization_admins에 등록된 관리자인지 확인
//      → 등록되어 있지 않으면 즉시 로그아웃 + 접근 차단
//   5) 관리자로 확인되면 소속 학교 정보와 함께 관리자 홈 화면 표시
//   6) 로그아웃
//   7) 관리자 홈의 메뉴 카드(연수관리 / 구성원관리) 클릭 시 해당 화면으로 이동
//   8) (Phase 8) 연수관리: 목록/월별그룹/월필터/등록/수정/보관/복원
//   9) (이번 단계) 연수 삭제: delete_training RPC 호출
//
//  권한 판단 방식(중요):
//   - localStorage나 URL 파라미터로 관리자 여부를 판단하지 않습니다.
//   - 매번 Supabase에 실제로 organization_admins 행이 있는지
//     물어봐서 확인합니다. 이 조회 자체가 RLS로 보호되므로,
//     로그인은 했지만 organization_admins에 없는 사용자는
//     조회 결과가 항상 "0건"으로 나옵니다(다른 사람 것도 안 보임).
// ============================================================

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

const el = {
  stateLoading: document.getElementById('adminStateLoading'),
  loginScreen: document.getElementById('adminLoginScreen'),
  homeScreen: document.getElementById('adminHomeScreen'),

  loginForm: document.getElementById('loginForm'),
  loginEmail: document.getElementById('loginEmail'),
  loginPassword: document.getElementById('loginPassword'),
  loginError: document.getElementById('loginError'),
  loginSubmitBtn: document.getElementById('loginSubmitBtn'),

  adminOrgName: document.getElementById('adminOrgName'),
  adminOrgNameInline: document.getElementById('adminOrgNameInline'),
  adminEmail: document.getElementById('adminEmail'),
  logoutBtn: document.getElementById('logoutBtn'),

  menuGrid: document.getElementById('adminMenuGrid'),

  trainingsScreen: document.getElementById('adminTrainingsScreen'),
  trainingsBackBtn: document.getElementById('trainingsBackBtn'),
  openTrainingFormBtn: document.getElementById('openTrainingFormBtn'),
  showArchivedCheckbox: document.getElementById('showArchivedCheckbox'),
  monthFilter: document.getElementById('monthFilter'),
  trainingsLoading: document.getElementById('trainingsLoading'),
  trainingsError: document.getElementById('trainingsError'),
  trainingsErrorMessage: document.getElementById('trainingsErrorMessage'),
  trainingsEmpty: document.getElementById('trainingsEmpty'),
  trainingGroups: document.getElementById('trainingGroups'),

  trainingFormOverlay: document.getElementById('trainingFormOverlay'),
  trainingFormTitle: document.getElementById('trainingFormTitle'),
  trainingForm: document.getElementById('trainingForm'),
  tfTitle: document.getElementById('tfTitle'),
  tfTargetType: document.getElementById('tfTargetType'),
  tfTargetTypeNote: document.getElementById('tfTargetTypeNote'),
  tfDate: document.getElementById('tfDate'),
  tfSignStartAmpm: document.getElementById('tfSignStartAmpm'),
  tfSignStartHour: document.getElementById('tfSignStartHour'),
  tfSignStartMinute: document.getElementById('tfSignStartMinute'),
  tfSignEndAmpm: document.getElementById('tfSignEndAmpm'),
  tfSignEndHour: document.getElementById('tfSignEndHour'),
  tfSignEndMinute: document.getElementById('tfSignEndMinute'),
  tfDateMismatchWarning: document.getElementById('tfDateMismatchWarning'),
  trainingFormError: document.getElementById('trainingFormError'),
  trainingFormCancelBtn: document.getElementById('trainingFormCancelBtn'),
  trainingFormSaveBtn: document.getElementById('trainingFormSaveBtn'),

  membersScreen: document.getElementById('adminMembersScreen'),
  membersBackBtn: document.getElementById('membersBackBtn'),
  openMemberFormBtn: document.getElementById('openMemberFormBtn'),
  emptyOpenMemberFormBtn: document.getElementById('emptyOpenMemberFormBtn'),
  addDepartmentBtn: document.getElementById('addDepartmentBtn'),
  showInactiveMembersCheckbox: document.getElementById('showInactiveMembersCheckbox'),
  memberDeptFilter: document.getElementById('memberDeptFilter'),
  membersLoading: document.getElementById('membersLoading'),
  membersError: document.getElementById('membersError'),
  membersErrorMessage: document.getElementById('membersErrorMessage'),
  membersEmpty: document.getElementById('membersEmpty'),
  memberList: document.getElementById('memberList'),

  memberFormOverlay: document.getElementById('memberFormOverlay'),
  memberFormTitle: document.getElementById('memberFormTitle'),
  memberForm: document.getElementById('memberForm'),
  mfDepartment: document.getElementById('mfDepartment'),
  mfName: document.getElementById('mfName'),
  mfMemberType: document.getElementById('mfMemberType'),
  memberFormError: document.getElementById('memberFormError'),
  memberFormCancelBtn: document.getElementById('memberFormCancelBtn'),
  memberFormSaveBtn: document.getElementById('memberFormSaveBtn'),

  // 구성원 엑셀 일괄등록 (Phase 1: 검증/미리보기, Phase 2: 실제 저장)
  downloadMemberTemplateBtn: document.getElementById('downloadMemberTemplateBtn'),
  excelUploadRow: document.getElementById('excelUploadRow'),
  memberExcelFileInput: document.getElementById('memberExcelFileInput'),
  memberExcelFileName: document.getElementById('memberExcelFileName'),
  validateMemberExcelBtn: document.getElementById('validateMemberExcelBtn'),
  excelImportError: document.getElementById('excelImportError'),
  excelPreviewSection: document.getElementById('excelPreviewSection'),
  excelPreviewSummary: document.getElementById('excelPreviewSummary'),
  excelPreviewTableBody: document.getElementById('excelPreviewTableBody'),
  saveMemberExcelBtn: document.getElementById('saveMemberExcelBtn'),
  excelSaveError: document.getElementById('excelSaveError'),
  excelSaveSuccess: document.getElementById('excelSaveSuccess'),

  // 서명 현황
  signaturesScreen: document.getElementById('adminSignaturesScreen'),
  signaturesBackBtn: document.getElementById('signaturesBackBtn'),
  sigTrainingTitle: document.getElementById('sigTrainingTitle'),
  sigTrainingMeta: document.getElementById('sigTrainingMeta'),
  sigSummary: document.getElementById('sigSummary'),
  sigTotalCount: document.getElementById('sigTotalCount'),
  sigSignedCount: document.getElementById('sigSignedCount'),
  sigUnsignedCount: document.getElementById('sigUnsignedCount'),
  sigNote: document.getElementById('sigNote'),
  sigSearchInput: document.getElementById('sigSearchInput'),
  sigTypeFilter: document.getElementById('sigTypeFilter'),
  sigStatusFilter: document.getElementById('sigStatusFilter'),
  sigRefreshBtn: document.getElementById('sigRefreshBtn'),
  sigLoading: document.getElementById('sigLoading'),
  sigError: document.getElementById('sigError'),
  sigErrorMessage: document.getElementById('sigErrorMessage'),
  sigEmpty: document.getElementById('sigEmpty'),
  sigEmptyMessage: document.getElementById('sigEmptyMessage'),
  sigList: document.getElementById('sigList'),
};

// 로그인한 관리자의 소속 학교 정보 (organization_admins 조회 결과에서만 채워짐)
// → 연수관리에서 org_id가 필요할 때 이 값을 재사용합니다. URL/localStorage/
//   사용자 입력에서 org_id를 가져오지 않습니다.
const currentAdmin = {
  orgId: null,
  orgName: null,
  publicCode: null,
};

// 연수관리 화면 자체 상태
const trainingsState = {
  all: [],              // 서버에서 받아온 전체 연수(옵션에 따라 보관 포함)
  includeArchived: false,
  selectedMonthKey: null,   // null이면 "전체"
  expandedMonths: new Set(),
  editingId: null,       // 수정 중인 연수 id (null이면 신규 등록)
};

// 구성원관리 화면 자체 상태
const membersState = {
  all: [],               // 서버에서 받아온 구성원 전체(옵션에 따라 비활성 포함)
  departments: [],        // 현재 학교의 부서 목록
  includeInactive: false,
  selectedDeptId: null,   // null이면 "전체"
  editingId: null,        // 수정 중인 구성원 id (null이면 신규 등록)
};

// 구성원 엑셀 일괄등록 상태
//  - rows: "검증하기" 결과 (미리보기에 쓰이는 행 데이터). 이 배열이
//    비어있지 않고 오류가 0건일 때만 "저장하기" 버튼이 활성화됩니다.
//  - 실제 DB 반영은 반드시 bulk_import_members RPC를 통해서만
//    이루어집니다 (브라우저에서 members 테이블 직접 insert/update 없음).
const excelImportState = {
  selectedFile: null,
  rows: [],
  busy: false, // 검증/저장 진행 중에는 드롭으로 파일을 바꾸지 못하게 막는 용도
};

function showOnly(sectionEl) {
  [el.stateLoading, el.loginScreen, el.homeScreen, el.trainingsScreen, el.membersScreen, el.signaturesScreen].forEach((s) => {
    s.hidden = s !== sectionEl;
  });
}

function showLoginScreen(errorMessage) {
  if (errorMessage) {
    el.loginError.textContent = errorMessage;
    el.loginError.hidden = false;
  } else {
    el.loginError.hidden = true;
  }
  showOnly(el.loginScreen);
}

// ============================================================
// 1. 시작: 현재 세션 확인
// ============================================================
async function init() {
  showOnly(el.stateLoading);

  const { data, error } = await supabaseClient.auth.getSession();

  if (error) {
    console.error(error);
    showLoginScreen('로그인 상태를 확인하는 중 문제가 발생했습니다. 다시 로그인해주세요.');
    return;
  }

  const session = data.session;
  if (!session) {
    showLoginScreen();
    return;
  }

  await checkAdminAndEnter(session.user);
}

// ============================================================
// 2. organization_admins 기준으로 관리자 권한 확인
//    (컬럼명은 02_final_schema_security.sql에 실제 존재하는
//     org_id / user_id / role 그대로 사용, 새 컬럼 가정 없음)
// ============================================================
async function checkAdminAndEnter(user) {
  const { data, error } = await supabaseClient
    .from('organization_admins')
    .select('org_id, role, organizations ( name, public_code, brand_color )')
    .eq('user_id', user.id);

  if (error) {
    console.error(error);
    await supabaseClient.auth.signOut();
    showLoginScreen('권한 확인 중 문제가 발생했습니다. 다시 로그인해주세요.');
    return;
  }

  if (!data || data.length === 0) {
    // organization_admins에 등록되지 않은 계정 → 관리자 아님 → 접근 차단
    await supabaseClient.auth.signOut();
    showLoginScreen('관리자 권한이 없는 계정입니다. 담당자에게 문의해주세요.');
    return;
  }

  renderAdminHome(user, data[0]);
}

// ============================================================
// 3. 관리자 홈 화면 표시
// ============================================================
function renderAdminHome(user, adminRow) {
  const org = adminRow.organizations;

  el.adminEmail.textContent = user.email;

  const orgName = org && org.name ? org.name : '(소속 학교 정보 확인 필요)';
  el.adminOrgName.textContent = orgName;
  el.adminOrgNameInline.textContent = orgName;

  if (org && org.brand_color) {
    document.documentElement.style.setProperty('--brand-color', org.brand_color);
  }

  // 이후 연수관리 등에서 재사용할 소속 학교 정보 저장
  // (로그인 시 organization_admins 조회로 얻은 값만 사용 — URL/입력값 아님)
  currentAdmin.orgId = adminRow.org_id;
  currentAdmin.orgName = orgName;
  currentAdmin.publicCode = org ? org.public_code : null;

  showOnly(el.homeScreen);
}

// ============================================================
// 4. 로그인 폼 제출
// ============================================================
el.loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const email = el.loginEmail.value.trim();
  const password = el.loginPassword.value;

  if (!email || !password) return;

  setLoginSubmitting(true);
  el.loginError.hidden = true;

  try {
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });

    if (error) {
      // 원본 오류는 화면에 노출하지 않고 콘솔에만 남깁니다.
      console.error('signInWithPassword error:', error);
      showLoginScreen('로그인하지 못했습니다. 이메일과 비밀번호를 확인한 후 다시 시도해주세요.');
      return;
    }

    await checkAdminAndEnter(data.user);
  } catch (err) {
    console.error(err);
    showLoginScreen('로그인 중 문제가 발생했습니다. 인터넷 연결을 확인한 후 다시 시도해주세요.');
  } finally {
    setLoginSubmitting(false);
  }
});

function setLoginSubmitting(isSubmitting) {
  el.loginSubmitBtn.disabled = isSubmitting;
  el.loginSubmitBtn.textContent = isSubmitting ? '로그인 중…' : '로그인';
}

// ============================================================
// 5. 로그아웃
// ============================================================
el.logoutBtn.addEventListener('click', async () => {
  await supabaseClient.auth.signOut();
  el.loginEmail.value = '';
  el.loginPassword.value = '';
  showLoginScreen();
});

// ============================================================
// 5-1. 관리자 홈 메뉴 카드
//      '연수관리' / '구성원관리' 모두 실제 화면으로 연결.
// ============================================================
if (el.menuGrid) {
  el.menuGrid.addEventListener('click', (e) => {
    const card = e.target.closest('.admin-menu-card');
    if (!card) return;

    if (card.dataset.menuKey === 'trainings') {
      openTrainingsScreen();
    } else if (card.dataset.menuKey === 'members') {
      openMembersScreen();
    }
  });
}

el.trainingsBackBtn.addEventListener('click', () => {
  showOnly(el.homeScreen);
});

el.membersBackBtn.addEventListener('click', () => {
  showOnly(el.homeScreen);
});

function formatDateDot(dateStr) {
  return dateStr ? dateStr.replaceAll('-', '.') : '-';
}

// ------------------------------------------------------------
// 서명 시작/종료 일시(sign_start_at, sign_end_at) — Asia/Seoul 기준
// timestamptz 변환 유틸
//
//  - datetime-local 입력값(예: "2026-10-08T15:30")은 브라우저의
//    로컬 시간대와 무관하게 "한국 시간(KST, UTC+9)으로 입력한
//    시각"으로 간주합니다. 한국은 서머타임이 없으므로 항상 +09:00
//    오프셋을 붙여 저장하면 정확합니다.
//  - 표시할 때도 보는 사람의 브라우저 시간대와 무관하게 항상
//    Asia/Seoul 기준으로 보이도록 Intl.DateTimeFormat에
//    timeZone: 'Asia/Seoul'을 명시합니다.
// ------------------------------------------------------------

// "2026-10-08T15:30" → "2026-10-08T15:30:00+09:00" (저장용 ISO 문자열)
function fromKstInputValueToIso(value) {
  if (!value) return null;
  return `${value}:00+09:00`;
}

// 저장된 timestamptz 값 → datetime-local 입력창에 넣을 "YYYY-MM-DDTHH:mm" (한국 시간 기준)
function toKstInputValue(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return '';

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d);

  const map = {};
  parts.forEach((p) => { map[p.type] = p.value; });
  return `${map.year}-${map.month}-${map.day}T${map.hour}:${map.minute}`;
}

// 저장된 timestamptz 두 값 → "2026.10.08. 15:30 ~ 16:30" (한국 시간 기준 표시용)
function formatSignWindow(startIso, endIso) {
  if (!startIso || !endIso) return null;
  const start = new Date(startIso);
  const end = new Date(endIso);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return null;

  const dateFmt = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const timeFmt = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false,
  });

  return `서명가능 ${dateFmt.format(start)} ${timeFmt.format(start)} ~ ${timeFmt.format(end)}`;
}

// ============================================================
// 7. (Phase 8) 연수관리
//    - 조회: trainings 테이블에서 org_id = currentAdmin.orgId 인 것만
//      (RLS가 서버에서도 동일하게 강제하므로 이중으로 안전함)
//    - 등록/수정: org_id는 항상 currentAdmin.orgId를 그대로 사용
//      (사용자가 org_id를 입력하거나 바꿀 수 있는 UI 없음)
//    - "보관"(status='archived')은 그대로 유지합니다 (물리 삭제 없이
//      숨기는 용도).
//    - 이번 단계에서 "삭제" 기능을 추가합니다. trainings에는 DELETE를
//      허용하는 RLS 정책이 없고, signatures/training_members/
//      training_target_departments → trainings 의 FK가 모두
//      ON DELETE NO ACTION이라 단순 DELETE로는 지워지지 않습니다.
//      그래서 관리자 권한을 서버에서 직접 확인하고 자식 데이터부터
//      순서대로 지우는 SECURITY DEFINER RPC(delete_training)를
//      추가로 사용합니다. (아래 delete_training 함수 참고,
//      Supabase에 별도 SQL 실행 필요 — 보고에 SQL 첨부)
// ============================================================

async function openTrainingsScreen() {
  showOnly(el.trainingsScreen);
  trainingsState.selectedMonthKey = null;
  el.showArchivedCheckbox.checked = false;
  trainingsState.includeArchived = false;
  await loadTrainings();
}

async function loadTrainings() {
  el.trainingsError.hidden = true;
  el.trainingsEmpty.hidden = true;
  el.trainingGroups.innerHTML = '';
  el.monthFilter.hidden = true;
  el.trainingsLoading.hidden = false;

  try {
    let query = supabaseClient
      .from('trainings')
      .select('id, title, target_type, date, status, sign_start_at, sign_end_at')
      .eq('org_id', currentAdmin.orgId)
      .order('date', { ascending: false });

    if (!trainingsState.includeArchived) {
      query = query.eq('status', 'active');
    }

    const { data, error } = await query;
    if (error) throw error;

    trainingsState.all = data || [];

    if (trainingsState.all.length === 0) {
      el.trainingsEmpty.hidden = false;
    } else {
      const monthKeys = [...new Set(trainingsState.all.map((t) => t.date.slice(0, 7)))]
        .sort((a, b) => b.localeCompare(a));

      // 최신 월은 항상 기본으로 펼쳐지도록 합니다. (이전에는 최초 1회만
      // 자동으로 펼쳤는데, 그 뒤 다른 월을 열어본 적이 있으면 새로
      // 추가된 최신 월이 자동으로 펼쳐지지 않아 "새로 등록한 연수가
      // 안 보인다"고 느껴지는 문제가 있었습니다. 사용자가 직접 접은
      // 월은 그대로 유지되고, 최신 월만 매번 다시 펼쳐집니다.)
      if (monthKeys.length > 0) {
        trainingsState.expandedMonths.add(monthKeys[0]);
      }

      renderMonthFilter(monthKeys);
      renderTrainingGroups(monthKeys);
    }
  } catch (err) {
    console.error(err);
    el.trainingsErrorMessage.textContent =
      '연수 목록을 불러오지 못했습니다. 인터넷 연결을 확인한 후 다시 시도해주세요.';
    el.trainingsError.hidden = false;
  } finally {
    el.trainingsLoading.hidden = true;
  }
}

function monthLabel(monthKey) {
  const [y, m] = monthKey.split('-');
  return `${y}년 ${parseInt(m, 10)}월`;
}

function renderMonthFilter(monthKeys) {
  el.monthFilter.hidden = false;
  el.monthFilter.innerHTML = '';

  const allChip = document.createElement('button');
  allChip.type = 'button';
  allChip.className = 'month-chip' + (trainingsState.selectedMonthKey === null ? ' is-active' : '');
  allChip.textContent = '전체';
  allChip.addEventListener('click', () => {
    trainingsState.selectedMonthKey = null;
    renderMonthFilter(monthKeys);
    renderTrainingGroups(monthKeys);
  });
  el.monthFilter.appendChild(allChip);

  monthKeys.forEach((key) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'month-chip' + (trainingsState.selectedMonthKey === key ? ' is-active' : '');
    chip.textContent = monthLabel(key);
    chip.addEventListener('click', () => {
      trainingsState.selectedMonthKey = key;
      trainingsState.expandedMonths.add(key);
      renderMonthFilter(monthKeys);
      renderTrainingGroups(monthKeys);
    });
    el.monthFilter.appendChild(chip);
  });
}

function renderTrainingGroups(monthKeys) {
  el.trainingGroups.innerHTML = '';

  const visibleKeys = trainingsState.selectedMonthKey
    ? monthKeys.filter((k) => k === trainingsState.selectedMonthKey)
    : monthKeys;

  visibleKeys.forEach((key) => {
    const items = trainingsState.all
      .filter((t) => t.date.slice(0, 7) === key)
      .sort((a, b) => b.date.localeCompare(a.date));

    const groupEl = document.createElement('div');
    groupEl.className = 'month-group' + (trainingsState.expandedMonths.has(key) ? ' is-open' : '');

    const header = document.createElement('button');
    header.type = 'button';
    header.className = 'month-group-header';
    header.innerHTML =
      `<span class="month-group-header-title">${escapeHtml(monthLabel(key))}` +
      `<span class="month-group-count">${items.length}건</span></span>` +
      `<span class="month-group-arrow">▾</span>`;
    header.addEventListener('click', () => {
      if (trainingsState.expandedMonths.has(key)) {
        trainingsState.expandedMonths.delete(key);
      } else {
        trainingsState.expandedMonths.add(key);
      }
      renderTrainingGroups(monthKeys);
    });

    const body = document.createElement('div');
    body.className = 'month-group-body';
    items.forEach((training) => body.appendChild(renderTrainingCard(training)));

    groupEl.appendChild(header);
    groupEl.appendChild(body);
    el.trainingGroups.appendChild(groupEl);
  });
}

// 연수 대상 유형 (구성원 구분 member_type과는 다른 개념):
//   '교원'   → 구분이 '교원'인 활성 구성원만 대상
//   '교직원' → 구분이 '교원' 또는 '교직원'인 활성 구성원 전체가 대상
const TRAINING_TARGET_TYPES = ['교원', '교직원'];
const targetTypeLabel = { '교원': '교원', '교직원': '교직원' };

function renderTrainingCard(training) {
  const card = document.createElement('div');
  card.className = 'training-card';

  const isArchived = training.status === 'archived';
  const metaParts = [
    formatDateDot(training.date),
    formatSignWindow(training.sign_start_at, training.sign_end_at) || '서명 가능 시간 미설정',
    `유형: ${targetTypeLabel[training.target_type] || training.target_type}`,
  ].filter(Boolean);

  card.innerHTML = `
    <div class="training-card-main">
      <p class="training-card-title">${escapeHtml(training.title)}${
        isArchived ? '<span class="training-card-archived-badge">보관됨</span>' : ''
      }</p>
      <p class="training-card-meta">${escapeHtml(metaParts.join(' · '))}</p>
    </div>
    <div class="training-card-actions">
      <button type="button" data-action="signatures">서명 현황</button>
      <button type="button" data-action="edit">수정</button>
      ${
        isArchived
          ? '<button type="button" data-action="restore">복원</button>'
          : '<button type="button" data-action="archive">보관</button>'
      }
      <button type="button" data-action="delete" class="is-danger">삭제</button>
    </div>
  `;

  card.querySelector('[data-action="signatures"]').addEventListener('click', () => openSignatureStatus(training));
  card.querySelector('[data-action="edit"]').addEventListener('click', () => openTrainingForm(training));

  const archiveBtn = card.querySelector('[data-action="archive"]');
  if (archiveBtn) {
    archiveBtn.addEventListener('click', () => archiveTraining(training));
  }
  const restoreBtn = card.querySelector('[data-action="restore"]');
  if (restoreBtn) {
    restoreBtn.addEventListener('click', () => restoreTraining(training));
  }
  card.querySelector('[data-action="delete"]').addEventListener('click', () => deleteTraining(training));

  return card;
}

el.showArchivedCheckbox.addEventListener('change', () => {
  trainingsState.includeArchived = el.showArchivedCheckbox.checked;
  loadTrainings();
});

// ---------- 등록/수정 폼 ----------
el.openTrainingFormBtn.addEventListener('click', () => openTrainingForm(null));
el.trainingFormCancelBtn.addEventListener('click', closeTrainingForm);

// ------------------------------------------------------------
// 서명 시작/종료 일시 입력을 "날짜 + 오전/오후 + 시 + 분" select
// 조합으로 구성합니다 (datetime-local의 네이티브 picker가 Chrome/
// Windows에서 선택 완료 후에도 닫히지 않는 문제를 우회하기 위함 —
// select는 옵션을 고르는 즉시 드롭다운이 닫히는 것이 모든 브라우저
//에서 보장됩니다). 여기서 만들어진 "YYYY-MM-DDTHH:mm" 문자열은
// 기존 fromKstInputValueToIso / toKstInputValue 함수에 그대로
// 넘기므로, KST 변환 로직 자체는 전혀 바꾸지 않았습니다.
// ------------------------------------------------------------

// 시(1~12) / 분(00~59) select의 옵션을 채웁니다.
function populateHourMinuteOptions() {
  const hourSelects = [el.tfSignStartHour, el.tfSignEndHour];
  const minuteSelects = [el.tfSignStartMinute, el.tfSignEndMinute];

  hourSelects.forEach((select) => {
    for (let h = 1; h <= 12; h++) {
      const opt = document.createElement('option');
      opt.value = String(h);
      opt.textContent = `${h}시`;
      select.appendChild(opt);
    }
  });

  minuteSelects.forEach((select) => {
    for (let m = 0; m < 60; m++) {
      const opt = document.createElement('option');
      opt.value = String(m);
      opt.textContent = `${String(m).padStart(2, '0')}분`;
      select.appendChild(opt);
    }
  });
}
populateHourMinuteOptions();

function to24Hour(hour12, ampm) {
  let h = parseInt(hour12, 10) % 12;
  if (ampm === 'PM') h += 12;
  return h;
}

function to12HourParts(hour24) {
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  const ampm = hour24 < 12 ? 'AM' : 'PM';
  return { hour12, ampm };
}

// 4개 select/입력값을 읽어 "YYYY-MM-DDTHH:mm" 문자열로 조합
// (하나라도 비어 있으면 빈 문자열 반환)
// 연수 날짜(tfDate) + 오전오후/시/분(select)을 조합해 "YYYY-MM-DDTHH:mm"로 반환
function readKstDateTimeValue(prefix) {
  const dateVal = el.tfDate.value;
  const ampm = el[`${prefix}Ampm`].value;
  const hour12 = el[`${prefix}Hour`].value;
  const minute = el[`${prefix}Minute`].value;

  if (!dateVal || !ampm || hour12 === '' || minute === '') return '';

  const hour24 = to24Hour(hour12, ampm);
  return `${dateVal}T${String(hour24).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

// 저장된 timestamptz(iso) → 오전오후/시/분 select에 값 채우기
// (날짜는 더 이상 여기서 다루지 않고 "연수 날짜"를 그대로 사용합니다)
// 반환값: 저장돼 있던 값의 한국시간 기준 날짜 부분 (연수 날짜와 다른지 확인용, 값이 없으면 null)
function applyKstDateTimeValue(prefix, isoString) {
  const value = toKstInputValue(isoString); // "" 또는 "YYYY-MM-DDTHH:mm"

  if (!value) {
    el[`${prefix}Ampm`].value = 'AM';
    el[`${prefix}Hour`].value = '12';
    el[`${prefix}Minute`].value = '0';
    return null;
  }

  const [datePart, timePart] = value.split('T');
  const [h, m] = timePart.split(':').map((n) => parseInt(n, 10));
  const { hour12, ampm } = to12HourParts(h);

  el[`${prefix}Ampm`].value = ampm;
  el[`${prefix}Hour`].value = String(hour12);
  el[`${prefix}Minute`].value = String(m);
  return datePart;
}

function openTrainingForm(training) {
  trainingsState.editingId = training ? training.id : null;
  el.trainingFormTitle.textContent = training ? '연수 수정' : '연수 등록';
  el.trainingFormError.hidden = true;

  el.tfTitle.value = training ? training.title : '';
  el.tfTargetType.value =
    training && TRAINING_TARGET_TYPES.includes(training.target_type) ? training.target_type : '교직원';
  el.tfDate.value = training ? training.date : '';

  const startDatePart = applyKstDateTimeValue('tfSignStart', training ? training.sign_start_at : null);
  const endDatePart = applyKstDateTimeValue('tfSignEnd', training ? training.sign_end_at : null);

  // 기존에 저장된 서명 시작/종료의 날짜(한국시간 기준)가 연수 날짜와
  // 다른 경우, 조용히 덮어쓰지 않고 관리자에게 먼저 알립니다.
  // (그대로 저장하면 이제부터는 "연수 날짜" 기준으로 다시 저장됩니다.)
  const hasMismatch = !!training && (
    (startDatePart && startDatePart !== training.date) ||
    (endDatePart && endDatePart !== training.date)
  );
  el.tfDateMismatchWarning.hidden = !hasMismatch;

  el.tfTargetTypeNote.hidden = false;

  el.trainingFormOverlay.hidden = false;
}

function closeTrainingForm() {
  el.trainingFormOverlay.hidden = true;
  trainingsState.editingId = null;
  el.tfDateMismatchWarning.hidden = true;
  el.trainingForm.reset();
}

el.trainingForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const title = el.tfTitle.value.trim();
  const date = el.tfDate.value;
  const signStartValue = readKstDateTimeValue('tfSignStart');
  const signEndValue = readKstDateTimeValue('tfSignEnd');

  if (!title || !date) {
    el.trainingFormError.textContent = '연수 제목과 연수 날짜는 필수입니다.';
    el.trainingFormError.hidden = false;
    return;
  }

  if (!signStartValue) {
    el.trainingFormError.textContent = '서명 시작 일시를 입력해주세요.';
    el.trainingFormError.hidden = false;
    return;
  }

  if (!signEndValue) {
    el.trainingFormError.textContent = '서명 종료 일시를 입력해주세요.';
    el.trainingFormError.hidden = false;
    return;
  }

  const signStartIso = fromKstInputValueToIso(signStartValue);
  const signEndIso = fromKstInputValueToIso(signEndValue);
  const signStartDate = new Date(signStartIso);
  const signEndDate = new Date(signEndIso);

  if (isNaN(signStartDate.getTime()) || isNaN(signEndDate.getTime())) {
    el.trainingFormError.textContent = '서명 시작/종료 일시 형식이 올바르지 않습니다.';
    el.trainingFormError.hidden = false;
    return;
  }

  if (signEndDate.getTime() <= signStartDate.getTime()) {
    el.trainingFormError.textContent = '서명 종료 시간은 시작 시간보다 늦어야 합니다.';
    el.trainingFormError.hidden = false;
    return;
  }

  const payload = {
    title,
    target_type: el.tfTargetType.value,
    date,
    sign_start_at: signStartIso,
    sign_end_at: signEndIso,
  };

  el.trainingFormSaveBtn.disabled = true;
  el.trainingFormError.hidden = true;

  try {
    let error;
    if (trainingsState.editingId) {
      // 수정: 반드시 내 학교(org_id)의 연수만 대상으로 함
      ({ error } = await supabaseClient
        .from('trainings')
        .update(payload)
        .eq('id', trainingsState.editingId)
        .eq('org_id', currentAdmin.orgId));
    } else {
      // 등록: org_id는 로그인 시 확인된 값을 그대로 사용 (사용자 입력 아님)
      ({ error } = await supabaseClient
        .from('trainings')
        .insert({ ...payload, org_id: currentAdmin.orgId }));
    }

    if (error) throw error;

    closeTrainingForm();
    await loadTrainings();
  } catch (err) {
    console.error(err);
    el.trainingFormError.textContent = '저장에 실패했습니다. 인터넷 연결을 확인한 후 다시 시도해주세요.';
    el.trainingFormError.hidden = false;
  } finally {
    el.trainingFormSaveBtn.disabled = false;
  }
});

async function archiveTraining(training) {
  const ok = window.confirm(
    `'${training.title}' 연수를 보관 처리하시겠습니까?\n보관된 연수는 기본 목록에서 숨겨지며, 서명 기록은 그대로 보존됩니다.`
  );
  if (!ok) return;

  try {
    const { error } = await supabaseClient
      .from('trainings')
      .update({ status: 'archived' })
      .eq('id', training.id)
      .eq('org_id', currentAdmin.orgId);
    if (error) throw error;
    await loadTrainings();
  } catch (err) {
    console.error(err);
    alert('보관 처리에 실패했습니다. 다시 시도해주세요.');
  }
}

async function restoreTraining(training) {
  try {
    const { error } = await supabaseClient
      .from('trainings')
      .update({ status: 'active' })
      .eq('id', training.id)
      .eq('org_id', currentAdmin.orgId);
    if (error) throw error;
    await loadTrainings();
  } catch (err) {
    console.error(err);
    alert('복원에 실패했습니다. 다시 시도해주세요.');
  }
}

// 연수 삭제 — 자식 데이터(서명/대상지정) 삭제 순서와 권한 확인을
// delete_training RPC(서버 측)에서 처리합니다. 프론트에서는 여러
// DELETE를 순서대로 보내지 않고 이 RPC 하나만 호출합니다.
async function deleteTraining(training) {
  const ok = window.confirm(
    `이 연수를 삭제하시겠습니까?\n\n` +
    `연수명: ${training.title}\n` +
    `연수일: ${formatDateDot(training.date)}\n\n` +
    `삭제하면 해당 연수와 연결된 서명 및 대상 정보도 함께 삭제됩니다.`
  );
  if (!ok) return;

  try {
    const { data, error } = await supabaseClient.rpc('delete_training', {
      p_training_id: training.id,
    });
    if (error) throw error;

    if (!data || !data.success) {
      alert((data && data.message) || '삭제에 실패했습니다.');
      return;
    }

    await loadTrainings();
  } catch (err) {
    console.error(err);
    alert('삭제 중 문제가 발생했습니다. 인터넷 연결을 확인한 후 다시 시도해주세요.');
  }
}

// ============================================================
// 7. 구성원관리
//    - 조회: members/departments 테이블에서 org_id = currentAdmin.orgId
//      인 것만 (RLS가 서버에서도 동일하게 강제하므로 이중으로 안전함)
//    - 추가/수정: org_id는 항상 currentAdmin.orgId를 그대로 사용
//      (사용자가 org_id를 입력하거나 바꿀 수 있는 UI 없음)
//    - "삭제" 요청은 members.is_active = false 로 구현합니다(물리
//      삭제 아님). signatures.member_id → members.id 관계가
//      ON DELETE NO ACTION이라, 서명 기록이 있는 구성원을 물리
//      삭제하면 DB 에러가 나거나(있을 때) / 조용히 지워지거나
//      (없을 때) 동작이 일관되지 않습니다. 애초에 이 프로젝트는
//      "구성원 삭제 대신 비활성화" 원칙으로 설계되어 있으므로
//      (연수 보관/복원과 동일한 패턴), 여기서도 물리 삭제 대신
//      비활성화로 구현해 과거 서명 기록을 100% 안전하게 보존합니다.
//      비활성화된 구성원은 "복원" 버튼으로 다시 활성화할 수 있고,
//      "비활성 구성원 포함" 체크박스로 목록에서 다시 확인할 수
//      있습니다.
// ============================================================

const memberTypeOptions = ['교원', '교직원'];

async function openMembersScreen() {
  showOnly(el.membersScreen);
  membersState.selectedDeptId = null;
  el.showInactiveMembersCheckbox.checked = false;
  membersState.includeInactive = false;
  await loadDepartmentsAndMembers();
}

async function loadDepartmentsAndMembers() {
  el.membersError.hidden = true;
  el.membersEmpty.hidden = true;
  el.memberList.innerHTML = '';
  el.memberDeptFilter.hidden = true;
  el.membersLoading.hidden = false;

  try {
    const { data: depts, error: deptError } = await supabaseClient
      .from('departments')
      .select('id, name')
      .eq('org_id', currentAdmin.orgId)
      .eq('is_active', true)
      .order('sort_order', { ascending: true });
    if (deptError) throw deptError;

    membersState.departments = depts || [];
    populateDepartmentSelect();

    let query = supabaseClient
      .from('members')
      .select('id, name, member_type, department_id, is_active')
      .eq('org_id', currentAdmin.orgId)
      .order('name', { ascending: true });

    if (!membersState.includeInactive) {
      query = query.eq('is_active', true);
    }

    const { data: members, error: memberError } = await query;
    if (memberError) throw memberError;

    membersState.all = members || [];

    renderDeptFilter();
    renderMemberList();
  } catch (err) {
    console.error('구성원 목록 로딩 오류:', err);
    el.membersErrorMessage.textContent = '구성원 목록을 불러오지 못했습니다.';
    el.membersError.hidden = false;
  } finally {
    el.membersLoading.hidden = true;
  }
}

function departmentName(deptId) {
  const dept = membersState.departments.find((d) => d.id === deptId);
  return dept ? dept.name : '(부서 미상)';
}

function renderDeptFilter() {
  if (membersState.departments.length === 0) {
    el.memberDeptFilter.hidden = true;
    return;
  }

  el.memberDeptFilter.hidden = false;
  el.memberDeptFilter.innerHTML = '';

  const allChip = document.createElement('button');
  allChip.type = 'button';
  allChip.className = 'month-chip' + (membersState.selectedDeptId === null ? ' is-active' : '');
  allChip.textContent = '전체';
  allChip.addEventListener('click', () => {
    membersState.selectedDeptId = null;
    renderDeptFilter();
    renderMemberList();
  });
  el.memberDeptFilter.appendChild(allChip);

  membersState.departments.forEach((dept) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'month-chip' + (membersState.selectedDeptId === dept.id ? ' is-active' : '');
    chip.textContent = dept.name;
    chip.addEventListener('click', () => {
      membersState.selectedDeptId = dept.id;
      renderDeptFilter();
      renderMemberList();
    });
    el.memberDeptFilter.appendChild(chip);
  });
}

function renderMemberList() {
  const filtered = membersState.selectedDeptId
    ? membersState.all.filter((m) => m.department_id === membersState.selectedDeptId)
    : membersState.all;

  el.memberList.innerHTML = '';

  if (filtered.length === 0) {
    el.membersEmpty.hidden = false;
    return;
  }
  el.membersEmpty.hidden = true;

  filtered.forEach((member) => el.memberList.appendChild(renderMemberCard(member)));
}

function renderMemberCard(member) {
  const card = document.createElement('div');
  card.className = 'member-card';

  const isInactive = !member.is_active;

  card.innerHTML = `
    <div class="member-card-main">
      <p class="member-card-name">${escapeHtml(member.name)}
        <span class="member-type-badge">${escapeHtml(member.member_type)}</span>
        ${isInactive ? '<span class="member-inactive-badge">비활성</span>' : ''}
      </p>
      <p class="member-card-meta">${escapeHtml(departmentName(member.department_id))}</p>
    </div>
    <div class="member-card-actions">
      <button type="button" data-action="edit">수정</button>
      ${
        isInactive
          ? '<button type="button" data-action="restore">복원</button>'
          : '<button type="button" data-action="deactivate" class="is-danger">삭제</button>'
      }
    </div>
  `;

  card.querySelector('[data-action="edit"]').addEventListener('click', () => openMemberForm(member));

  const deactivateBtn = card.querySelector('[data-action="deactivate"]');
  if (deactivateBtn) {
    deactivateBtn.addEventListener('click', () => deactivateMember(member));
  }
  const restoreBtn = card.querySelector('[data-action="restore"]');
  if (restoreBtn) {
    restoreBtn.addEventListener('click', () => restoreMember(member));
  }

  return card;
}

el.showInactiveMembersCheckbox.addEventListener('change', () => {
  membersState.includeInactive = el.showInactiveMembersCheckbox.checked;
  loadDepartmentsAndMembers();
});

// ---------- 부서 추가 (간단한 프롬프트 — 구성원을 추가하려면 부서가
// 최소 1개는 있어야 하므로, 별도의 부서관리 화면 없이 최소한의
// 진입로만 제공합니다) ----------
el.addDepartmentBtn.addEventListener('click', async () => {
  const name = window.prompt('추가할 부서명을 입력해주세요.');
  if (!name || !name.trim()) return;

  try {
    const { error } = await supabaseClient
      .from('departments')
      .insert({ org_id: currentAdmin.orgId, name: name.trim() });
    if (error) throw error;
    await loadDepartmentsAndMembers();
  } catch (err) {
    console.error('부서 추가 오류:', err);
    alert('부서를 추가하지 못했습니다.');
  }
});

// ---------- 등록/수정 폼 ----------
function populateDepartmentSelect() {
  if (membersState.departments.length === 0) {
    el.mfDepartment.innerHTML = '<option value="">등록된 부서가 없습니다</option>';
    el.mfDepartment.disabled = true;
    return;
  }

  el.mfDepartment.disabled = false;
  el.mfDepartment.innerHTML = membersState.departments
    .map((d) => `<option value="${d.id}">${escapeHtml(d.name)}</option>`)
    .join('');
}

el.openMemberFormBtn.addEventListener('click', () => openMemberForm(null));
el.emptyOpenMemberFormBtn.addEventListener('click', () => openMemberForm(null));
el.memberFormCancelBtn.addEventListener('click', closeMemberForm);

function openMemberForm(member) {
  if (membersState.departments.length === 0) {
    alert('먼저 "+ 부서 추가"로 부서를 하나 이상 등록해주세요.');
    return;
  }

  membersState.editingId = member ? member.id : null;
  el.memberFormTitle.textContent = member ? '구성원 수정' : '구성원 추가';
  el.memberFormError.hidden = true;

  el.mfDepartment.value = member ? member.department_id : membersState.departments[0].id;
  el.mfName.value = member ? member.name : '';
  el.mfMemberType.value = member && memberTypeOptions.includes(member.member_type)
    ? member.member_type
    : '교직원';

  el.memberFormOverlay.hidden = false;
}

function closeMemberForm() {
  el.memberFormOverlay.hidden = true;
  membersState.editingId = null;
  el.memberForm.reset();
}

el.memberForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const departmentId = el.mfDepartment.value;
  const name = el.mfName.value.trim();
  const memberType = el.mfMemberType.value;

  if (!departmentId) {
    el.memberFormError.textContent = '부서를 선택해주세요.';
    el.memberFormError.hidden = false;
    return;
  }
  if (!name) {
    el.memberFormError.textContent = '성명을 입력해주세요.';
    el.memberFormError.hidden = false;
    return;
  }
  if (!memberTypeOptions.includes(memberType)) {
    el.memberFormError.textContent = '구분을 선택해주세요.';
    el.memberFormError.hidden = false;
    return;
  }

  const payload = { department_id: departmentId, name, member_type: memberType };

  el.memberFormSaveBtn.disabled = true;
  el.memberFormError.hidden = true;

  try {
    let error;
    if (membersState.editingId) {
      ({ error } = await supabaseClient
        .from('members')
        .update(payload)
        .eq('id', membersState.editingId)
        .eq('org_id', currentAdmin.orgId));
    } else {
      ({ error } = await supabaseClient
        .from('members')
        .insert({ ...payload, org_id: currentAdmin.orgId }));
    }

    if (error) throw error;

    const isEditing = !!membersState.editingId;
    closeMemberForm();
    await loadDepartmentsAndMembers();

    if (!isEditing) {
      // 방금 추가한 구성원이 즉시 보이도록, 부서 필터가 걸려있었다면 해제
      membersState.selectedDeptId = null;
      renderDeptFilter();
      renderMemberList();
    }
  } catch (err) {
    console.error('구성원 저장 오류:', err);
    el.memberFormError.textContent = membersState.editingId
      ? '구성원 정보를 수정하지 못했습니다.'
      : '구성원을 추가하지 못했습니다.';
    el.memberFormError.hidden = false;
  } finally {
    el.memberFormSaveBtn.disabled = false;
  }
});

// ---------- 삭제(비활성화) / 복원 ----------
async function deactivateMember(member) {
  const ok = window.confirm(
    '이 구성원을 삭제하시겠습니까?\n\n과거에 완료한 연수의 서명 기록은 보존됩니다.'
  );
  if (!ok) return;

  try {
    const { error } = await supabaseClient
      .from('members')
      .update({ is_active: false })
      .eq('id', member.id)
      .eq('org_id', currentAdmin.orgId);
    if (error) throw error;
    await loadDepartmentsAndMembers();
  } catch (err) {
    console.error('구성원 삭제 오류:', err);
    alert('구성원을 삭제하지 못했습니다.');
  }
}

async function restoreMember(member) {
  try {
    const { error } = await supabaseClient
      .from('members')
      .update({ is_active: true })
      .eq('id', member.id)
      .eq('org_id', currentAdmin.orgId);
    if (error) throw error;
    await loadDepartmentsAndMembers();
  } catch (err) {
    console.error('구성원 복원 오류:', err);
    alert('구성원 복원에 실패했습니다.');
  }
}

// ============================================================
// 7-1. 구성원 엑셀 일괄등록
//
//  Phase 1 — 검증/미리보기: 엑셀을 읽어 행별로 검사하고, 기존
//  구성원과 매칭한 결과(신규 등록 / 기존 구성원 수정 / 오류)를
//  화면에 보여줍니다. 이 단계는 조회(SELECT)만 하며 저장하지 않습니다.
//
//  Phase 2 — 실제 저장: 오류가 0건일 때만 활성화되는 "저장하기"
//  버튼을 눌러야 실제로 반영됩니다. 저장은 브라우저에서 members
//  테이블을 직접 insert/update하지 않고, 아래 RPC 한 번으로 처리합니다.
//    - bulk_import_members(p_org_id, p_rows)
//    - 서버(RPC) 안에서 전체 행을 다시 한 번 검증한 뒤, 하나라도
//      문제가 있으면 아무것도 저장하지 않고 오류만 반환합니다
//      (전부 성공하거나 전부 실패 — 부분 반영 없음).
//    - 07_bulk_import_members_rpc.sql 실행 필요 (별도 안내)
//
//  동일인 판별 기준: org_id + department_id + name (이름/부서 텍스트가
//  아니라, 부서명을 기존 departments와 매칭해 department_id로 비교).
//  엑셀의 부서명이 기존 departments에 없으면 오류가 아니라 "신규 부서"로
//  표시하고, 저장 시 RPC가 이 학교(org)에 새 부서를 자동 생성합니다
//  (부서 생성과 구성원 저장은 같은 트랜잭션 — 오류가 있으면 부서도 만들어지지 않음).
// ============================================================

const EXCEL_TEMPLATE_HEADERS = ['이름', '부서', '구분', '비고'];
const MEMBER_TYPE_VALUES = ['교원', '교직원'];

// ---------- 엑셀 양식 다운로드 ----------
el.downloadMemberTemplateBtn.addEventListener('click', () => {
  const rows = [
    EXCEL_TEMPLATE_HEADERS,
    ['홍길동', '교무부', '교원', ''],
    ['김철수', '행정실', '교직원', ''],
  ];

  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  worksheet['!cols'] = [{ wch: 12 }, { wch: 14 }, { wch: 10 }, { wch: 20 }];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, '구성원 양식');
  XLSX.writeFile(workbook, '구성원_일괄등록_양식.xlsx');
});

// ---------- 파일 선택 / 드래그 앤 드롭 공통 처리 ----------
function applyExcelFileSelection(file) {
  excelImportState.selectedFile = file || null;
  excelImportState.rows = [];

  el.memberExcelFileName.textContent = file ? file.name : '선택된 파일 없음';
  el.validateMemberExcelBtn.disabled = !file;

  el.excelImportError.hidden = true;
  el.excelPreviewSection.hidden = true;
  el.excelPreviewTableBody.innerHTML = '';
  el.excelSaveError.hidden = true;
  el.excelSaveSuccess.hidden = true;
  el.saveMemberExcelBtn.disabled = true;
}

// ---------- 파일 선택 ----------
el.memberExcelFileInput.addEventListener('change', () => {
  const file = el.memberExcelFileInput.files && el.memberExcelFileInput.files[0];
  applyExcelFileSelection(file || null);
});

// ---------- 드래그 앤 드롭 (파일 선택과 같은 처리로 연결) ----------
//  드래그 앤 드롭을 지원하지 않는 환경(모바일 등)에서는 이 이벤트가
//  발생하지 않을 뿐이며, 위의 "엑셀 파일 선택" 방식은 그대로 동작합니다.
function isFileDrag(evt) {
  return !!(evt.dataTransfer && Array.from(evt.dataTransfer.types || []).includes('Files'));
}

let excelDragDepth = 0; // 자식 요소를 지날 때 dragleave가 깜빡이는 문제 방지

el.excelUploadRow.addEventListener('dragenter', (evt) => {
  if (!isFileDrag(evt)) return;
  evt.preventDefault();
  excelDragDepth += 1;
  el.excelUploadRow.classList.add('is-dragover');
});

el.excelUploadRow.addEventListener('dragover', (evt) => {
  if (!isFileDrag(evt)) return;
  evt.preventDefault(); // 이게 있어야 drop 이벤트가 발생합니다
  evt.dataTransfer.dropEffect = 'copy';
});

el.excelUploadRow.addEventListener('dragleave', (evt) => {
  if (!isFileDrag(evt)) return;
  excelDragDepth = Math.max(0, excelDragDepth - 1);
  if (excelDragDepth === 0) el.excelUploadRow.classList.remove('is-dragover');
});

el.excelUploadRow.addEventListener('drop', (evt) => {
  if (!isFileDrag(evt)) return;
  evt.preventDefault();
  excelDragDepth = 0;
  el.excelUploadRow.classList.remove('is-dragover');

  if (excelImportState.busy) return; // 검증/저장 중에는 파일을 바꾸지 않음

  const files = Array.from(evt.dataTransfer.files || []);
  if (files.length === 0) return;

  if (files.length > 1) {
    showExcelImportError('엑셀 파일은 한 번에 하나만 올릴 수 있습니다.');
    return;
  }

  const file = files[0];
  if (!/\.xlsx$/i.test(file.name)) {
    showExcelImportError('.xlsx 형식의 엑셀 파일만 올릴 수 있습니다. 엑셀 양식을 다운로드하여 작성한 파일인지 확인해주세요.');
    return;
  }

  // 숨겨진 파일 입력과 상태를 맞춰 둡니다(지원하지 않는 환경이면 상태만 갱신).
  try {
    const dt = new DataTransfer();
    dt.items.add(file);
    el.memberExcelFileInput.files = dt.files; // change 이벤트는 발생하지 않음
  } catch (err) {
    console.warn('파일 입력 동기화를 건너뜁니다:', err);
  }

  applyExcelFileSelection(file);
});

// 업로드 영역을 살짝 벗어나 놓았을 때 브라우저가 엑셀 파일을 열어버리지 않도록 막습니다.
['dragover', 'drop'].forEach((type) => {
  window.addEventListener(type, (evt) => {
    if (isFileDrag(evt) && !el.excelUploadRow.contains(evt.target)) evt.preventDefault();
  });
});

// ---------- 검증하기 (Phase 1) ----------
el.validateMemberExcelBtn.addEventListener('click', async () => {
  if (!excelImportState.selectedFile) return;

  el.excelImportError.hidden = true;
  el.excelSaveError.hidden = true;
  el.excelSaveSuccess.hidden = true;
  el.excelPreviewSection.hidden = true;
  el.excelPreviewTableBody.innerHTML = '';
  el.saveMemberExcelBtn.disabled = true;
  el.validateMemberExcelBtn.disabled = true;
  excelImportState.busy = true;
  const originalLabel = el.validateMemberExcelBtn.textContent;
  el.validateMemberExcelBtn.textContent = '검증 중…';

  try {
    const parsedRows = await parseMemberExcelFile(excelImportState.selectedFile);

    if (parsedRows.length === 0) {
      showExcelImportError('엑셀 파일에서 입력된 데이터 행을 찾을 수 없습니다. 양식의 헤더(이름/부서/구분/비고)를 지우지 않았는지 확인해주세요.');
      return;
    }

    // 매칭을 위해 현재 학교(org)의 전체 구성원·전체 부서를 새로 조회합니다.
    // (조회만 — 기존 members/departments SELECT 정책을 그대로 사용,
    //  새 쿼리 권한/정책/RPC 추가 아님)
    const { existingMembers, existingDepartments } = await fetchAllMembersAndDepartmentsForMatching();

    const analyzed = markDuplicateRowsInExcel(
      analyzeExcelRowsAgainstExisting(parsedRows, existingMembers, existingDepartments)
    );
    excelImportState.rows = analyzed;

    renderExcelPreview(analyzed);
  } catch (err) {
    console.error('엑셀 검증 오류:', err);
    showExcelImportError('엑셀 파일을 읽는 중 문제가 발생했습니다. .xlsx 형식이 맞는지, 양식을 임의로 크게 변경하지 않았는지 확인해주세요.');
  } finally {
    excelImportState.busy = false;
    el.validateMemberExcelBtn.disabled = !excelImportState.selectedFile;
    el.validateMemberExcelBtn.textContent = originalLabel;
  }
});

function showExcelImportError(message) {
  el.excelImportError.textContent = message;
  el.excelImportError.hidden = false;
}

// 엑셀 파일 → [{ rowNumber, name, department, memberType, note }, ...]
// (완전히 빈 행은 건너뜁니다. rowNumber는 실제 엑셀 상의 행 번호입니다.)
function parseMemberExcelFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onerror = () => reject(new Error('파일을 읽을 수 없습니다.'));

    reader.onload = () => {
      try {
        const data = new Uint8Array(reader.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        if (!firstSheetName) {
          resolve([]);
          return;
        }

        const sheet = workbook.Sheets[firstSheetName];
        // header:1 → 각 행을 배열로 받음 (첫 행은 헤더로 간주하고 건너뜀)
        const raw = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

        const dataRows = raw.slice(1); // 1행(헤더) 제외
        const result = [];

        dataRows.forEach((row, idx) => {
          const excelRowNumber = idx + 2; // 헤더가 1행이므로 데이터는 2행부터
          const name = String(row[0] ?? '').trim();
          const department = String(row[1] ?? '').trim();
          const memberType = String(row[2] ?? '').trim();
          const note = String(row[3] ?? '').trim();

          // 네 칸이 모두 빈 행(엑셀 끝에 남는 빈 줄 등)은 무시
          if (!name && !department && !memberType && !note) return;

          result.push({ rowNumber: excelRowNumber, name, department, memberType, note });
        });

        resolve(result);
      } catch (err) {
        reject(err);
      }
    };

    reader.readAsArrayBuffer(file);
  });
}

// 현재 학교(org)의 전체 구성원·활성 부서를 새로 조회 (매칭 정확도를 위해
// "비활성 구성원 포함" 체크박스 상태와 무관하게 전체 구성원을 가져옵니다)
async function fetchAllMembersAndDepartmentsForMatching() {
  const [{ data: members, error: memberError }, { data: departments, error: deptError }] = await Promise.all([
    supabaseClient
      .from('members')
      .select('id, name, department_id, member_type, is_active')
      .eq('org_id', currentAdmin.orgId),
    supabaseClient
      .from('departments')
      .select('id, name')
      .eq('org_id', currentAdmin.orgId)
      .eq('is_active', true), // 삭제(비활성화)된 부서는 일괄등록에서 "없는 부서"로 취급 (bulk_import_members RPC와 같은 기준)
  ]);

  if (memberError) throw memberError;
  if (deptError) throw deptError;

  return { existingMembers: members || [], existingDepartments: departments || [] };
}

// 엑셀 각 행을 검증하고, 기존 구성원과 "org_id + department_id + name"
// 기준으로 매칭합니다. 실제 DB 반영은 하지 않고, 상태(신규 등록 /
// 기존 구성원 수정 / 오류)와 메시지만 계산해서 반환합니다.
function analyzeExcelRowsAgainstExisting(parsedRows, existingMembers, existingDepartments) {
  // 부서명(정규화) → 그 이름을 가진 부서 id 목록 (중복 부서명 대비)
  const deptIdsByName = new Map();
  existingDepartments.forEach((d) => {
    const key = normalizeMatchText(d.name);
    if (!deptIdsByName.has(key)) deptIdsByName.set(key, []);
    deptIdsByName.get(key).push(d.id);
  });

  // "정규화된 이름||department_id" → 일치하는 기존 구성원 배열
  const existingByKey = new Map();
  existingMembers.forEach((m) => {
    if (!m.department_id) return; // 부서 미지정 구성원은 엑셀 매칭 대상 아님
    const key = `${normalizeMatchText(m.name)}||${m.department_id}`;
    if (!existingByKey.has(key)) existingByKey.set(key, []);
    existingByKey.get(key).push(m);
  });

  return parsedRows.map((row) => {
    const result = { ...row, status: null, message: '', departmentId: null };

    if (!row.name) {
      result.status = 'error';
      result.message = `${row.rowNumber}행: 이름이 비어 있습니다.`;
      return result;
    }
    if (!row.department) {
      result.status = 'error';
      result.message = `${row.rowNumber}행: 부서가 비어 있습니다.`;
      return result;
    }
    if (!row.memberType) {
      result.status = 'error';
      result.message = `${row.rowNumber}행: 구분이 비어 있습니다.`;
      return result;
    }
    if (!MEMBER_TYPE_VALUES.includes(row.memberType)) {
      result.status = 'error';
      result.message = `${row.rowNumber}행: 구분 값이 올바르지 않습니다. "교원" 또는 "교직원"만 입력할 수 있습니다.`;
      return result;
    }

    // 부서명을 기존 departments와 비교 (앞뒤 공백 제거 + 연속 공백 정리 후 일치)
    const deptIds = deptIdsByName.get(normalizeMatchText(row.department)) || [];

    // 일치하는 부서가 없으면 오류가 아니라 "신규 부서"입니다.
    // (저장 시 서버 RPC가 이 학교에 새 부서를 한 번만 만들고 구성원을 연결합니다.
    //  새 부서에는 기존 구성원이 있을 수 없으므로 항상 신규 등록입니다.)
    if (deptIds.length === 0) {
      result.newDepartment = true;
      result.status = 'new';
      result.message = `신규 부서 "${normalizeMatchText(row.department)}"가 자동 생성되고, 구성원이 신규 등록됩니다.`;
      return result;
    }
    if (deptIds.length > 1) {
      result.status = 'error';
      result.message = `${row.rowNumber}행: 부서 "${row.department}"라는 이름의 부서가 여러 개 있어 자동으로 확정할 수 없습니다.`;
      return result;
    }

    const departmentId = deptIds[0];
    const key = `${normalizeMatchText(row.name)}||${departmentId}`;
    const matches = existingByKey.get(key) || [];

    if (matches.length >= 2) {
      result.status = 'error';
      result.message = `${row.rowNumber}행: 이름+부서가 같은 기존 구성원이 ${matches.length}명 있어 자동으로 연결할 수 없습니다 (중복 구성원).`;
      return result;
    }

    result.departmentId = departmentId;

    if (matches.length === 1) {
      result.status = 'update';
      result.message = '기존 구성원과 일치 — 구분 값이 수정됩니다.';
      return result;
    }

    result.status = 'new';
    result.message = '기존 부서를 사용하며, 일치하는 기존 구성원이 없어 신규 등록됩니다.';
    return result;
  });
}

// 엑셀 내부 중복 검사 — 같은 "부서 + 이름"이 2행 이상이면 해당 행 전부를 오류로 표시합니다.
// (서버 RPC bulk_import_members의 엑셀 내부 중복 검증과 같은 기준: 부서는 공백 정리 후,
//  이름은 앞뒤 공백 제거 후 일치. 구분 값이 같든 다르든 중복으로 봅니다.)
function markDuplicateRowsInExcel(analyzedRows) {
  const groups = new Map();

  analyzedRows.forEach((row) => {
    if (!row.name || !row.department) return; // 비어 있는 행은 이미 오류 처리됨
    const key = `${normalizeMatchText(row.department)}||${row.name}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  });

  groups.forEach((rows) => {
    if (rows.length < 2) return;

    const rowNumbers = rows.map((r) => r.rowNumber).join(', ');
    rows.forEach((row) => {
      const dupMessage =
        `${row.rowNumber}행: 엑셀 안에 부서 "${row.department}", 이름 "${row.name}"가 같은 행이 여러 개 있습니다 ` +
        `(행 ${rowNumbers}). 한 구성원은 한 행만 입력해주세요.`;
      row.message = row.status === 'error' ? `${row.message} / ${dupMessage}` : dupMessage;
      row.status = 'error';
    });
  });

  return analyzedRows;
}

function normalizeMatchText(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

const excelStatusLabel = {
  new: '신규 등록',
  update: '기존 구성원 수정',
  error: '오류',
};

function renderExcelPreview(analyzedRows) {
  const counts = { new: 0, update: 0, error: 0 };
  analyzedRows.forEach((r) => { counts[r.status] += 1; });

  // 이번 저장으로 새로 만들어질 부서 (같은 이름은 한 번만 집계)
  const newDepartmentNames = [...new Set(
    analyzedRows
      .filter((r) => r.newDepartment && r.status !== 'error')
      .map((r) => normalizeMatchText(r.department))
  )];

  el.excelPreviewSummary.textContent =
    `총 ${analyzedRows.length}행 — 신규 등록 ${counts.new}건 · 기존 구성원 수정 ${counts.update}건 · 오류 ${counts.error}건` +
    (newDepartmentNames.length > 0
      ? ` · 신규 부서 자동 생성 ${newDepartmentNames.length}개 (${newDepartmentNames.join(', ')})`
      : '');

  el.excelPreviewTableBody.innerHTML = '';

  analyzedRows.forEach((row) => {
    const tr = document.createElement('tr');
    if (row.status === 'error') tr.className = 'excel-row-error';

    tr.innerHTML = `
      <td>${row.rowNumber}</td>
      <td>${escapeHtml(row.name)}</td>
      <td>${escapeHtml(row.department)}${row.newDepartment && row.status !== 'error' ? '<span class="excel-new-dept-tag">신규 부서</span>' : ''}</td>
      <td>${escapeHtml(row.memberType)}</td>
      <td>${escapeHtml(row.note)}</td>
      <td><span class="excel-status-badge is-${row.status}">${excelStatusLabel[row.status]}</span></td>
      <td>${escapeHtml(row.message)}</td>
    `;
    el.excelPreviewTableBody.appendChild(tr);
  });

  el.excelPreviewSection.hidden = false;
  el.excelSaveError.hidden = true;
  el.excelSaveSuccess.hidden = true;

  // 오류가 하나라도 있으면 저장 버튼을 아예 누르지 못하게 막습니다
  // (실제 최종 방어선은 서버 RPC의 재검증이지만, 화면에서부터 막아 혼란을 줄입니다)
  el.saveMemberExcelBtn.disabled = counts.error > 0;
}

// ---------- 저장하기 (Phase 2 — 실제 DB 반영) ----------
//  브라우저에서 members 테이블을 직접 insert/update하지 않고,
//  bulk_import_members RPC 한 번만 호출합니다. RPC 안에서 서버가
//  전체 행을 다시 검증하며, 하나라도 오류가 있으면 아무 것도
//  저장하지 않고 오류 목록만 돌려줍니다(부분 반영 없음).
el.saveMemberExcelBtn.addEventListener('click', async () => {
  if (excelImportState.rows.length === 0) return;

  const hasClientError = excelImportState.rows.some((r) => r.status === 'error');
  if (hasClientError) return; // 버튼이 disabled라 보통 여기 안 오지만 이중 방어

  el.excelSaveError.hidden = true;
  el.excelSaveSuccess.hidden = true;
  el.saveMemberExcelBtn.disabled = true;
  excelImportState.busy = true;
  const originalLabel = el.saveMemberExcelBtn.textContent;
  el.saveMemberExcelBtn.textContent = '저장 중…';

  const payloadRows = excelImportState.rows.map((r) => ({
    row_number: r.rowNumber,
    name: r.name,
    department: r.department,
    member_type: r.memberType,
  }));

  try {
    const { data, error } = await supabaseClient.rpc('bulk_import_members', {
      p_org_id: currentAdmin.orgId,
      p_rows: payloadRows,
    });

    if (error) throw error;

    if (!data || !data.success) {
      showExcelSaveError(data);
      return;
    }

    const createdDepartments = Array.isArray(data.new_departments) ? data.new_departments : [];
    el.excelSaveSuccess.textContent =
      `저장 완료 — 신규 등록 ${data.new_count ?? 0}명, 기존 구성원 수정 ${data.updated_count ?? 0}명` +
      (createdDepartments.length > 0
        ? `, 신규 부서 ${createdDepartments.length}개 생성 (${createdDepartments.join(', ')})`
        : '');
    el.excelSaveSuccess.hidden = false;

    // 저장 후에는 다시 업로드하기 전까지 재저장을 막습니다.
    excelImportState.rows = [];
    excelImportState.selectedFile = null;
    el.memberExcelFileInput.value = '';
    el.memberExcelFileName.textContent = '선택된 파일 없음';
    el.validateMemberExcelBtn.disabled = true;
    el.saveMemberExcelBtn.disabled = true;

    // 방금 반영된 내용이 바로 보이도록 구성원 목록 새로고침
    await loadDepartmentsAndMembers();
  } catch (err) {
    console.error('엑셀 일괄 저장 오류:', err);
    showExcelSaveError(null);
  } finally {
    excelImportState.busy = false;
    el.saveMemberExcelBtn.textContent = originalLabel;
  }
});

function showExcelSaveError(data) {
  const errors = data && Array.isArray(data.errors) ? data.errors : null;

  if (errors && errors.length > 0) {
    const items = errors
      .map((e) => `<li>${escapeHtml(e.row_number != null ? `${e.row_number}행: ${e.message}` : e.message)}</li>`)
      .join('');
    el.excelSaveError.innerHTML =
      `<strong>저장하지 못했습니다 — 아무 것도 반영되지 않았습니다.</strong><ul>${items}</ul>`;
  } else if (data && data.message) {
    el.excelSaveError.textContent = data.message;
  } else {
    el.excelSaveError.textContent =
      '저장 중 문제가 발생했습니다. 인터넷 연결을 확인한 후 다시 시도해주세요. (아무 것도 반영되지 않았습니다)';
  }

  el.excelSaveError.hidden = false;
  el.saveMemberExcelBtn.disabled = false;
}

// ============================================================
//  서명 현황
//  - 진입: 연수관리 목록의 각 연수 카드 → "서명 현황" 버튼
//  - 조회만 합니다(이 화면에서는 DB를 수정하지 않습니다). 검색/필터는
//    이미 불러온 데이터를 화면에서만 거릅니다.
//  - 대상자 선정 규칙은 서명 화면의 get_training_targets RPC(08_training_target_type.sql)와
//    같은 규칙입니다 (활성 구성원만, 이 학교(org_id)만):
//      · trainings.target_type = '교원'   → member_type = '교원'인 구성원만
//      · trainings.target_type = '교직원' → member_type이 '교원' 또는 '교직원'인 구성원 전체
//    (연수의 대상 유형과 구성원의 구분(member_type)은 다른 개념입니다.)
//  - 서명 여부: signatures에 (training_id, member_id) 기록이 있으면 "서명 완료".
//  - 모든 조회는 .eq('org_id', currentAdmin.orgId) + RLS(관리자 select 정책).
//    새 RPC/SQL은 필요하지 않습니다.
// ============================================================

const signatureState = {
  training: null,
  rows: [],          // [{ memberId, name, department, memberType, signed, signedAt }]
  extraSignatureCount: 0,
  statusFilter: 'all',
  requestId: 0,      // 연달아 조회할 때 이전 응답이 화면을 덮어쓰지 않도록
};

function formatSignedAt(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

function openSignatureStatus(training) {
  signatureState.training = training;
  signatureState.rows = [];
  signatureState.extraSignatureCount = 0;

  el.sigSearchInput.value = '';
  el.sigTypeFilter.value = '';
  setSignatureStatusChip('all');

  el.sigTrainingTitle.textContent = training.title;
  el.sigTrainingMeta.textContent = [
    formatDateDot(training.date),
    `대상 유형: ${targetTypeLabel[training.target_type] || training.target_type}`,
  ].join(' · ');

  showOnly(el.signaturesScreen);
  loadSignatureStatus();
}

function setSignatureStatusChip(status) {
  signatureState.statusFilter = status;
  el.sigStatusFilter.querySelectorAll('[data-sig-status]').forEach((chip) => {
    chip.classList.toggle('is-active', chip.dataset.sigStatus === status);
  });
}

async function loadSignatureStatus() {
  const training = signatureState.training;
  if (!training) return;

  const requestId = ++signatureState.requestId;
  const orgId = currentAdmin.orgId;

  el.sigLoading.hidden = false;
  el.sigError.hidden = true;
  el.sigEmpty.hidden = true;
  el.sigSummary.hidden = true;
  el.sigNote.hidden = true;
  el.sigList.innerHTML = '';

  try {
    // 1) 부서(이름 표시/정렬용), 활성 구성원, 이 연수의 서명 기록을 함께 조회
    const [deptRes, memberRes, sigRes] = await Promise.all([
      supabaseClient
        .from('departments')
        .select('id, name, sort_order')
        .eq('org_id', orgId),
      supabaseClient
        .from('members')
        .select('id, name, department_id, member_type')
        .eq('org_id', orgId)
        .eq('is_active', true),
      supabaseClient
        .from('signatures')
        .select('member_id, created_at')
        .eq('org_id', orgId)
        .eq('training_id', training.id),
    ]);

    if (deptRes.error) throw deptRes.error;
    if (memberRes.error) throw memberRes.error;
    if (sigRes.error) throw sigRes.error;

    // 2) target_type에 따른 대상자 선정 (서명 화면의 get_training_targets와 같은 규칙)
    let targetMembers;
    if (training.target_type === '교원') {
      targetMembers = (memberRes.data || []).filter((m) => m.member_type === '교원');
    } else if (training.target_type === '교직원') {
      targetMembers = (memberRes.data || []).filter((m) => m.member_type === '교원' || m.member_type === '교직원');
    } else {
      const unknownErr = new Error(`알 수 없는 대상 유형: ${training.target_type}`);
      unknownErr.code = 'UNKNOWN_TARGET_TYPE';
      throw unknownErr;
    }

    // 더 최근에 시작된 조회가 있으면 이 결과는 버립니다
    if (requestId !== signatureState.requestId) return;

    // 3) 서명 여부 결합
    const signedAtByMember = new Map();
    (sigRes.data || []).forEach((s) => signedAtByMember.set(s.member_id, s.created_at));

    const deptInfo = new Map((deptRes.data || []).map((d) => [d.id, d]));

    const rows = targetMembers.map((m) => {
      const dept = deptInfo.get(m.department_id);
      return {
        memberId: m.id,
        name: m.name,
        department: dept ? dept.name : '부서 미지정',
        deptOrder: dept && dept.sort_order != null ? dept.sort_order : Number.MAX_SAFE_INTEGER,
        memberType: m.member_type || '',
        signed: signedAtByMember.has(m.id),
        signedAt: signedAtByMember.get(m.id) || null,
      };
    });

    // 부서 순서(sort_order) → 부서명 → 이름 순
    rows.sort((a, b) =>
      a.deptOrder - b.deptOrder ||
      a.department.localeCompare(b.department, 'ko') ||
      a.name.localeCompare(b.name, 'ko')
    );

    const targetIds = new Set(rows.map((r) => r.memberId));
    signatureState.rows = rows;
    signatureState.extraSignatureCount = (sigRes.data || []).filter((s) => !targetIds.has(s.member_id)).length;

    el.sigLoading.hidden = true;
    renderSignatureStatus();
  } catch (err) {
    if (requestId !== signatureState.requestId) return;
    console.error('서명 현황 조회 오류:', err);
    el.sigLoading.hidden = true;
    el.sigErrorMessage.textContent = err && err.code === 'UNKNOWN_TARGET_TYPE'
      ? '이 연수의 대상 유형 값이 올바르지 않습니다. 연수 수정에서 대상 유형(교원/교직원)을 다시 저장해주세요.'
      : '서명 현황을 불러오지 못했습니다. 인터넷 연결을 확인한 후 "새로고침"을 눌러주세요.';
    el.sigError.hidden = false;
  }
}

// 이미 불러온 데이터를 화면에서만 거릅니다 (DB 조회/수정 없음)
function renderSignatureStatus() {
  const rows = signatureState.rows;
  const total = rows.length;
  const signed = rows.filter((r) => r.signed).length;

  el.sigTotalCount.textContent = String(total);
  el.sigSignedCount.textContent = String(signed);
  el.sigUnsignedCount.textContent = String(total - signed);

  el.sigSummary.hidden = false;

  if (signatureState.extraSignatureCount > 0) {
    el.sigNote.textContent =
      `대상자 목록에 없는 서명 기록이 ${signatureState.extraSignatureCount}건 있습니다 ` +
      '(비활성화된 구성원이거나 대상에서 제외된 경우). 위 집계에는 포함되지 않았습니다.';
    el.sigNote.hidden = false;
  } else {
    el.sigNote.hidden = true;
  }

  el.sigList.innerHTML = '';

  if (total === 0) {
    const type = signatureState.training && signatureState.training.target_type;
    el.sigEmptyMessage.textContent =
      type === '교원'
        ? '대상 구성원이 없습니다. 활성 상태의 "교원" 구성원이 등록되어 있는지 확인해주세요.'
        : '대상 구성원이 없습니다. 활성 상태의 구성원(교원/교직원)이 등록되어 있는지 확인해주세요.';
    el.sigEmpty.hidden = false;
    return;
  }

  const keyword = el.sigSearchInput.value.trim().toLowerCase();
  const typeFilter = el.sigTypeFilter.value;
  const statusFilter = signatureState.statusFilter;

  const filtered = rows.filter((r) => {
    if (keyword && !(r.name.toLowerCase().includes(keyword) || r.department.toLowerCase().includes(keyword))) {
      return false;
    }
    if (typeFilter && r.memberType !== typeFilter) return false;
    if (statusFilter === 'signed' && !r.signed) return false;
    if (statusFilter === 'unsigned' && r.signed) return false;
    return true;
  });

  if (filtered.length === 0) {
    el.sigEmptyMessage.textContent = '조건에 맞는 대상자가 없습니다.';
    el.sigEmpty.hidden = false;
    return;
  }

  el.sigEmpty.hidden = true;

  filtered.forEach((r) => {
    const card = document.createElement('div');
    card.className = 'member-card';
    card.innerHTML = `
      <div class="member-card-main">
        <p class="member-card-name">${escapeHtml(r.name)}
          ${r.memberType ? `<span class="member-type-badge">${escapeHtml(r.memberType)}</span>` : ''}
        </p>
        <p class="member-card-meta">${escapeHtml(r.department)}</p>
      </div>
      <div class="sig-status-side">
        <span class="sig-status-badge ${r.signed ? 'is-signed' : 'is-unsigned'}">${r.signed ? '서명 완료' : '미서명'}</span>
        ${r.signed && r.signedAt ? `<span class="sig-signed-at">${escapeHtml(formatSignedAt(r.signedAt))}</span>` : ''}
      </div>
    `;
    el.sigList.appendChild(card);
  });
}

el.signaturesBackBtn.addEventListener('click', () => {
  // 연수관리 화면으로 복귀 (목록/월 필터 상태는 그대로 유지)
  showOnly(el.trainingsScreen);
});
el.sigRefreshBtn.addEventListener('click', loadSignatureStatus);
el.sigSearchInput.addEventListener('input', () => {
  if (signatureState.rows.length > 0) renderSignatureStatus();
});
el.sigTypeFilter.addEventListener('change', () => {
  if (signatureState.rows.length > 0) renderSignatureStatus();
});
el.sigStatusFilter.addEventListener('click', (evt) => {
  const chip = evt.target.closest('[data-sig-status]');
  if (!chip) return;
  setSignatureStatusChip(chip.dataset.sigStatus);
  if (signatureState.rows.length > 0) renderSignatureStatus();
});

// ============================================================
// 8. 세션 만료 등으로 인증 상태가 바뀌면 반영
// ============================================================
supabaseClient.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_OUT') {
    showLoginScreen();
  }
});

// ---------- 유틸 ----------
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---------- 시작 ----------
init();
