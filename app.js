// ============================================================
//  연수 전자서명 시스템 — 교직원 서명 화면 로직
//  대상: 교직원 연수 대상자 (학생 아님)
//
//  이 파일이 하는 일:
//   1) URL에서 학교 코드(org)와 연수 ID(training)를 읽는다
//   2) Supabase RPC로 연수 정보 / 대상자 목록을 가져온다
//   3) 부서 → 성명 선택, 중복 서명 여부 확인
//   4) 서명 캔버스 처리
//   5) 제출 시 (있다면) Apps Script로 이미지 업로드 → Supabase에 서명 기록 저장
//
//  아직 없는 것 (정직하게 표시):
//   - 이 프로젝트용 Google Apps Script는 아직 배포되지 않았습니다.
//     APPS_SCRIPT_URL이 비어있는 동안은 이미지 업로드 단계를
//     건너뛰고 서명 기록만 저장합니다 (개발/테스트용 동작).
// ============================================================

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

// ---------- URL 파라미터 ----------
const urlParams = new URLSearchParams(window.location.search);
const ORG_CODE = urlParams.get('org');
let TRAINING_ID = urlParams.get('training');   // 학교 공통 주소 흐름에서는 연수를 고를 때 설정됨

// 접속 방식
//  - ?org=학교코드                 → 학교 공통 주소 흐름 (부서 → 성명 → 오늘의 연수 목록 → 서명)
//  - ?org=학교코드&training=연수ID → 기존 연수별 주소 흐름 (기존 동작 그대로)
const IS_ORG_MODE = !!ORG_CODE && !TRAINING_ID;

// ---------- DOM 참조 ----------
const el = {
  orgName: document.getElementById('orgName'),
  orgNotice: document.getElementById('orgNotice'),

  stateLoading: document.getElementById('stateLoading'),
  stateLinkError: document.getElementById('stateLinkError'),
  linkErrorMessage: document.getElementById('linkErrorMessage'),
  stateWelcome: document.getElementById('stateWelcome'),
  stateForm: document.getElementById('stateForm'),
  stateSubmitting: document.getElementById('stateSubmitting'),
  stateSubmitError: document.getElementById('stateSubmitError'),
  submitErrorMessage: document.getElementById('submitErrorMessage'),
  stateSuccess: document.getElementById('stateSuccess'),
  successMemberName: document.getElementById('successMemberName'),

  trainingTitle: document.getElementById('trainingTitle'),
  trainingDate: document.getElementById('trainingDate'),
  trainingTarget: document.getElementById('trainingTarget'),

  departmentSelect: document.getElementById('departmentSelect'),
  memberSelect: document.getElementById('memberSelect'),
  alreadySignedHint: document.getElementById('alreadySignedHint'),

  stepSign: document.getElementById('stepSign'),
  signatureCanvas: document.getElementById('signatureCanvas'),
  signaturePlaceholder: document.getElementById('signaturePlaceholder'),
  clearSignatureBtn: document.getElementById('clearSignatureBtn'),
  signatureNotice: document.getElementById('signatureNotice'),

  devNote: document.getElementById('devNote'),
  submitBtn: document.getElementById('submitBtn'),
  retryBtn: document.getElementById('retryBtn'),

  // 학교 공통 주소 흐름 전용
  stateMain: document.getElementById('stateMain'),
  orgDepartmentSelect: document.getElementById('orgDepartmentSelect'),
  orgMemberSelect: document.getElementById('orgMemberSelect'),
  orgIdentifyNote: document.getElementById('orgIdentifyNote'),
  orgStepTrainings: document.getElementById('orgStepTrainings'),
  orgSelectedLabel: document.getElementById('orgSelectedLabel'),
  orgRefreshBtn: document.getElementById('orgRefreshBtn'),
  orgTrainingsLoading: document.getElementById('orgTrainingsLoading'),
  orgTrainingsError: document.getElementById('orgTrainingsError'),
  orgTrainingsErrorMessage: document.getElementById('orgTrainingsErrorMessage'),
  orgTrainingsRetryBtn: document.getElementById('orgTrainingsRetryBtn'),
  orgTrainingsEmpty: document.getElementById('orgTrainingsEmpty'),
  orgTrainingList: document.getElementById('orgTrainingList'),
  stepIdentify: document.getElementById('stepIdentify'),
  signerBar: document.getElementById('signerBar'),
  signerName: document.getElementById('signerName'),
  backToListBtn: document.getElementById('backToListBtn'),
  successBackBtn: document.getElementById('successBackBtn'),
  errorBackBtn: document.getElementById('errorBackBtn'),
};

// 이번 화면에서 사용할 상태값
const state = {
  targets: [],            // get_training_targets 결과 전체
  selectedMemberId: null,
  selectedMemberName: '',
  alreadySigned: false,
  hasSignature: false,
  submitting: false,
};

// ---------- 화면 전환 헬퍼 ----------
function showOnly(sectionEl) {
  const all = [
    el.stateLoading, el.stateLinkError, el.stateForm,
    el.stateSubmitting, el.stateSubmitError, el.stateSuccess,
    el.stateMain, el.stateWelcome,
  ];
  all.forEach((s) => { s.hidden = s !== sectionEl; });

  // 목록으로 돌아가는 버튼은 학교 공통 주소 흐름에서만 보입니다 (기존 연수별 주소 화면은 그대로)
  el.successBackBtn.hidden = !(IS_ORG_MODE && sectionEl === el.stateSuccess);
  el.errorBackBtn.hidden = !(IS_ORG_MODE && sectionEl === el.stateSubmitError);
}

// 서명 이미지 저장(Apps Script) 미연결 시 안내 (기존 연수별 주소 / 학교 공통 주소 모두 사용)
function showDevNoteIfNeeded() {
  if (!APPS_SCRIPT_URL) {
    el.devNote.hidden = false;
    el.devNote.textContent =
      '⚠️ 개발 중 안내: 서명 이미지 저장 기능(Google Apps Script)이 아직 연결되지 않아, ' +
      '지금 제출하면 서명 기록만 저장되고 서명 이미지는 저장되지 않습니다.';
  }
}

// ============================================================
// 1. 초기 진입: 링크 유효성부터 확인
// ============================================================
async function init() {
  // 기본 주소(학교/연수 정보가 주소에 전혀 없음) → 오류가 아니라 안내 화면.
  //  - org / training 파라미터 자체가 없을 때만 해당합니다 (특정 학교 코드를 기본값으로 쓰지 않음).
  //  - ?org= 처럼 파라미터는 있는데 값이 비었거나, training만 있는 경우 등
  //    잘못된 주소는 아래의 기존 오류 처리를 그대로 탑니다.
  if (!urlParams.has('org') && !urlParams.has('training')) {
    showOnly(el.stateWelcome);
    return;
  }

  if (!ORG_CODE || !TRAINING_ID) {
    el.linkErrorMessage.textContent =
      '연수 링크에 필요한 정보가 없습니다. 안내받은 링크를 다시 확인해주세요.';
    showOnly(el.stateLinkError);
    return;
  }

  showDevNoteIfNeeded();

  try {
    const { data: trainingRows, error: trainingError } = await supabaseClient
      .rpc('get_training_public', { p_org_code: ORG_CODE, p_training_id: TRAINING_ID });

    if (trainingError) throw trainingError;

    if (!trainingRows || trainingRows.length === 0) {
      el.linkErrorMessage.textContent =
        '연수를 찾을 수 없습니다. 이미 종료되었거나 링크가 정확하지 않을 수 있습니다.';
      showOnly(el.stateLinkError);
      return;
    }

    renderTrainingInfo(trainingRows[0]);

    const { data: targetRows, error: targetError } = await supabaseClient
      .rpc('get_training_targets', { p_org_code: ORG_CODE, p_training_id: TRAINING_ID });

    if (targetError) throw targetError;

    state.targets = targetRows || [];
    renderDepartmentOptions(state.targets);

    showOnly(el.stateForm);
  } catch (err) {
    console.error(err);
    el.linkErrorMessage.textContent =
      '연수 정보를 불러오는 중 문제가 발생했습니다. 인터넷 연결을 확인한 후 다시 시도해주세요.';
    showOnly(el.stateLinkError);
  }
}

// ============================================================
// 2. 연수 정보 렌더링
// ============================================================
function renderTrainingInfo(training) {
  document.title = `${training.title} - 연수 전자서명`;

  el.orgName.textContent = training.org_name || '연수 전자서명 시스템';
  el.orgNotice.textContent = training.notice_text || '';

  if (training.brand_color) {
    document.documentElement.style.setProperty('--brand-color', training.brand_color);
  }

  el.trainingTitle.textContent = training.title;

  const dateText = training.training_date
    ? new Date(training.training_date).toLocaleDateString('ko-KR', {
        year: 'numeric', month: 'long', day: 'numeric', weekday: 'short',
      })
    : '-';
  el.trainingDate.textContent = training.time_desc
    ? `${dateText} · ${training.time_desc}`
    : dateText;

  el.trainingTarget.textContent = training.target_desc || '해당 연수 대상 교직원';
}

// ============================================================
// 3. 부서 → 성명 선택
// ============================================================
function renderDepartmentOptions(targets) {
  const departmentNames = [...new Set(
    targets.map((t) => t.department_name || '부서 미지정')
  )].sort((a, b) => a.localeCompare(b, 'ko'));

  el.departmentSelect.innerHTML =
    '<option value="">부서를 선택해주세요</option>' +
    departmentNames.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('');
}

el.departmentSelect.addEventListener('change', () => {
  const dept = el.departmentSelect.value;
  resetMemberSelection();

  if (!dept) {
    el.memberSelect.innerHTML = '<option value="">부서를 먼저 선택해주세요</option>';
    el.memberSelect.disabled = true;
    return;
  }

  const members = state.targets
    .filter((t) => (t.department_name || '부서 미지정') === dept)
    .sort((a, b) => a.member_name.localeCompare(b.member_name, 'ko'));

  el.memberSelect.innerHTML =
    '<option value="">성명을 선택해주세요</option>' +
    members.map((m) => `<option value="${m.member_id}">${escapeHtml(m.member_name)}</option>`).join('');
  el.memberSelect.disabled = false;
});

el.memberSelect.addEventListener('change', async () => {
  const memberId = el.memberSelect.value;
  const option = el.memberSelect.selectedOptions[0];

  if (!memberId) {
    resetMemberSelection();
    return;
  }

  state.selectedMemberId = memberId;
  state.selectedMemberName = option ? option.textContent : '';

  await checkAlreadySigned();
});

function resetMemberSelection() {
  state.selectedMemberId = null;
  state.selectedMemberName = '';
  state.alreadySigned = false;
  el.alreadySignedHint.hidden = true;
  el.stepSign.hidden = true;
  resetSignature();   // 이전 사람이 그린 서명이 남아 제출되지 않도록 함께 초기화 (내부에서 제출 버튼 상태도 갱신)
}

async function checkAlreadySigned() {
  try {
    const { data, error } = await supabaseClient.rpc('check_already_signed', {
      p_org_code: ORG_CODE,
      p_training_id: TRAINING_ID,
      p_member_id: state.selectedMemberId,
    });
    if (error) throw error;

    state.alreadySigned = !!data;
    el.alreadySignedHint.hidden = !state.alreadySigned;
    el.stepSign.hidden = state.alreadySigned;

    if (!state.alreadySigned) {
      requestAnimationFrame(setupCanvasSize);
    }
    updateSubmitButtonState();
  } catch (err) {
    console.error(err);
    // 확인에 실패해도 서명 자체는 진행할 수 있게 하되,
    // 최종 방어선(서버의 unique 제약)이 중복 제출을 막아줍니다.
    state.alreadySigned = false;
    el.alreadySignedHint.hidden = true;
    el.stepSign.hidden = false;
    requestAnimationFrame(setupCanvasSize);
    updateSubmitButtonState();
  }
}

// ============================================================
// 4. 서명 캔버스
// ============================================================
const ctx = el.signatureCanvas.getContext('2d');
let drawing = false;
let lastPoint = null;
let canvasCssWidth = 0;   // 마지막으로 캔버스를 설정했을 때의 화면상 가로 폭

// 캔버스의 width/height를 다시 설정하면 그려둔 서명이 모두 지워지므로,
// 크기를 설정할 때마다 서명 상태(hasSignature/안내 문구/제출 버튼)도 함께 초기화해
// "그림은 없는데 제출 버튼은 켜져 있는" 불일치가 생기지 않게 합니다.
function setupCanvasSize() {
  const rect = el.signatureCanvas.parentElement.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  canvasCssWidth = rect.width;
  el.signatureCanvas.width = rect.width * ratio;
  el.signatureCanvas.height = 220 * ratio;
  ctx.scale(ratio, ratio);
  ctx.lineWidth = 2.4;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#1B2333';
  resetSignature();
}

// 서명 그림과 서명 상태를 함께 비움 (지우기 버튼, 크기 재설정, 구성원 변경에서 공용)
function resetSignature() {
  ctx.clearRect(0, 0, el.signatureCanvas.width, el.signatureCanvas.height);
  drawing = false;
  lastPoint = null;
  el.signaturePlaceholder.hidden = false;
  el.signatureNotice.hidden = true;
  state.hasSignature = false;
  updateSubmitButtonState();
}

function showSignatureNotice(message) {
  el.signatureNotice.textContent = message;
  el.signatureNotice.hidden = false;
}

// 실제 캔버스에 그려진 픽셀(투명하지 않은 점)이 하나라도 있는지 확인 — 제출 직전 최종 확인용
// true = 비어 있음 또는 확인할 수 없음 (두 경우 모두 제출을 막습니다)
function isSignatureCanvasBlank() {
  const { width, height } = el.signatureCanvas;
  if (!width || !height) return true;
  try {
    const data = ctx.getImageData(0, 0, width, height).data;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] !== 0) return false;
    }
    return true;
  } catch (err) {
    console.error('캔버스 내용을 확인하지 못했습니다.', err);
    return true;    // 서명이 있는지 확정할 수 없으면 안전하게 "없음"으로 보고 제출을 막음
  }
}

function getPoint(evt) {
  const rect = el.signatureCanvas.getBoundingClientRect();
  return { x: evt.clientX - rect.left, y: evt.clientY - rect.top };
}

el.signatureCanvas.addEventListener('pointerdown', (evt) => {
  drawing = true;
  lastPoint = getPoint(evt);
  el.signaturePlaceholder.hidden = true;
  el.signatureNotice.hidden = true;
});

el.signatureCanvas.addEventListener('pointermove', (evt) => {
  if (!drawing) return;
  const point = getPoint(evt);
  ctx.beginPath();
  ctx.moveTo(lastPoint.x, lastPoint.y);
  ctx.lineTo(point.x, point.y);
  ctx.stroke();
  lastPoint = point;

  if (!state.hasSignature) {
    state.hasSignature = true;
    updateSubmitButtonState();
  }
});

['pointerup', 'pointerleave', 'pointercancel'].forEach((evtName) => {
  el.signatureCanvas.addEventListener(evtName, () => { drawing = false; });
});

el.clearSignatureBtn.addEventListener('click', () => {
  resetSignature();
});

// 화면 크기가 바뀔 때: 캔버스는 가로 폭이 달라졌을 때만 다시 설정합니다.
//  - 기존 그림을 새 크기로 정확히 옮길 수 없으므로, 폭이 바뀌어 다시 설정하면
//    서명을 초기화하고 사용자에게 다시 서명하도록 안내합니다.
//  - 가로 폭이 그대로인 경우(모바일 주소창 높이 변화 등)는 서명을 그대로 유지합니다.
//  - 서명 화면이 가려져 있어 폭을 알 수 없는 경우(제출 중 등)에는 건드리지 않습니다.
window.addEventListener('resize', () => {
  if (el.stepSign.hidden) return;
  const width = el.signatureCanvas.parentElement.getBoundingClientRect().width;
  if (width === 0) return;
  if (Math.abs(width - canvasCssWidth) < 1) return;

  const hadSignature = state.hasSignature;
  setupCanvasSize();
  if (hadSignature) {
    showSignatureNotice('화면 크기가 바뀌어 서명이 지워졌습니다. 다시 서명해주세요.');
  }
});

// ============================================================
// 5. 제출 버튼 상태
// ============================================================
function updateSubmitButtonState() {
  const ready = !!state.selectedMemberId && !state.alreadySigned && state.hasSignature;
  el.submitBtn.disabled = !ready;
}

// ============================================================
// 6. 제출 처리
// ============================================================
el.submitBtn.addEventListener('click', handleSubmit);
el.retryBtn.addEventListener('click', () => {
  showOnly(el.stateForm);
});

// 제출 중에는 추가 제출을 무시합니다 (화면 전환 + 이 가드로 이중 제출 방지.
// 최종 중복 방어는 서버의 submit_signature / UNIQUE 제약이 그대로 담당합니다.)
async function handleSubmit() {
  if (state.submitting) return;

  // 서명 그림이 없으면 서버로 보내지 않음 (화면 상태와 실제 캔버스를 모두 확인)
  if (!state.hasSignature || isSignatureCanvasBlank()) {
    state.hasSignature = false;
    el.signaturePlaceholder.hidden = false;
    showSignatureNotice('서명이 확인되지 않습니다. 서명한 뒤 제출해주세요.');
    updateSubmitButtonState();
    return;
  }

  state.submitting = true;
  el.submitBtn.disabled = true;
  try {
    await submitSignatureFlow();
  } finally {
    state.submitting = false;
    updateSubmitButtonState();
  }
}

async function submitSignatureFlow() {
  showOnly(el.stateSubmitting);

  let imageFileId = null;

  // ---- (Phase 11 예정) Apps Script로 서명 이미지 업로드 ----
  if (APPS_SCRIPT_URL) {
    try {
      imageFileId = await uploadSignatureImage();
    } catch (err) {
      console.error(err);
      el.submitErrorMessage.textContent =
        '서명 이미지 저장에 실패했습니다. 인터넷 연결을 확인한 후 다시 시도해주세요.';
      showOnly(el.stateSubmitError);
      return;
    }
  }

  // ---- Supabase에 서명 기록 저장 ----
  try {
    const { data, error } = await supabaseClient.rpc('submit_signature', {
      p_org_code: ORG_CODE,
      p_training_id: TRAINING_ID,
      p_member_id: state.selectedMemberId,
      p_image_file_id: imageFileId,
    });

    if (error) throw error;

    if (!data || !data.success) {
      el.submitErrorMessage.textContent = (data && data.message) || '서명 제출에 실패했습니다.';
      showOnly(el.stateSubmitError);
      return;
    }

    el.successMemberName.textContent = state.selectedMemberName;
    showOnly(el.stateSuccess);

    // 학교 공통 주소 흐름: 완료 메시지를 잠시 보인 뒤 목록으로 돌아가 상태를 다시 조회
    // (내부에서 모든 오류를 처리하므로 이미 저장된 서명 결과에는 영향이 없습니다)
    if (IS_ORG_MODE) {
      returnToListAfterSuccess().catch((e) => console.error(e));
    }
  } catch (err) {
    console.error(err);

    // 이미지 업로드는 성공했는데 기록 저장에 실패한 경우 —
    // Apps Script가 연결된 이후에는 이 상황을 upload_failures에 남겨
    // 관리자가 확인할 수 있게 합니다.
    if (imageFileId) {
      try {
        await supabaseClient.rpc('log_upload_failure', {
          p_org_code: ORG_CODE,
          p_training_id: TRAINING_ID,
          p_member_id: state.selectedMemberId,
          p_image_file_id: imageFileId,
          p_reason: String(err && err.message ? err.message : err),
        });
      } catch (logErr) {
        console.error('실패 로그 저장에도 실패했습니다.', logErr);
      }
    }

    el.submitErrorMessage.textContent =
      '서명 저장에 실패했습니다. 인터넷 연결을 확인한 후 다시 시도해주세요. ' +
      '문제가 계속되면 담당자에게 문의해주세요.';
    showOnly(el.stateSubmitError);
  }
}

// ------------------------------------------------------------
// Apps Script 업로드 함수 (Phase 11에서 실제 배포 URL 연결 예정)
// 지금은 APPS_SCRIPT_URL이 비어있으면 이 함수 자체가 호출되지
// 않습니다 (handleSubmit 참고). 실제 Apps Script의 요청/응답
// 형식은 Phase 11에서 Code.gs를 작성하며 함께 확정합니다.
// ------------------------------------------------------------
async function uploadSignatureImage() {
  const dataUrl = el.signatureCanvas.toDataURL('image/png');

  const response = await fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    body: JSON.stringify({
      orgCode: ORG_CODE,
      trainingId: TRAINING_ID,
      memberId: state.selectedMemberId,
      signatureData: dataUrl,
    }),
  });

  const result = await response.json();
  if (!result || !result.success) {
    throw new Error((result && result.message) || 'Apps Script 업로드 실패');
  }
  return result.fileId;
}

// ---------- 유틸 ----------
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ============================================================
// 7. 학교 공통 주소 흐름 (?org=학교코드)
//    부서 선택 → 성명 선택 → 오늘의 연수 목록(서버가 상태 판정) → 서명 → 목록 복귀
//
//    사용하는 RPC (모두 이미 Supabase에 설치된 함수):
//      get_org_public_info(p_org_code)
//      get_public_departments(p_org_code)
//      get_department_members(p_org_code, p_department_id)
//      get_member_training_statuses(p_org_code, p_member_id)
//    서명 제출은 기존 submit_signature를 그대로 사용합니다.
//
//    대상 여부/서명 가능 시간은 브라우저에서 판단하지 않고 서버의
//    status_code만 표시합니다. 제출 때도 서버가 다시 검증합니다.
// ============================================================
const SUCCESS_MESSAGE_MS = 2000;
const NO_DEPARTMENT_VALUE = '__none__';   // '부서 미지정'(department_id=NULL) 선택값

const STATUS_LABELS = {
  not_target: '대상이 아닙니다',
  signed: '서명 완료',
  time_not_set: '서명 시간 미설정',
  before_start: '서명 시작 전',
  pending: '서명 대기',
  closed: '서명 종료',
};

// 느린 응답이 나중에 도착해 화면을 덮어쓰지 않도록 요청 번호를 둡니다.
const orgFlow = { deptToken: 0, trainingsToken: 0, returnToken: 0 };

async function initOrgFlow() {
  showOnly(el.stateLoading);

  try {
    const { data: orgRows, error: orgError } = await supabaseClient
      .rpc('get_org_public_info', { p_org_code: ORG_CODE });
    if (orgError) throw orgError;

    if (!orgRows || orgRows.length === 0) {
      el.linkErrorMessage.textContent =
        '학교를 확인할 수 없습니다. 안내받은 주소(QR)가 정확한지 다시 확인해주세요.';
      showOnly(el.stateLinkError);
      return;
    }
    renderOrgInfo(orgRows[0]);

    const { data: deptRows, error: deptError } = await supabaseClient
      .rpc('get_public_departments', { p_org_code: ORG_CODE });
    if (deptError) throw deptError;

    renderOrgDepartmentOptions(deptRows || []);
    showOnly(el.stateMain);
  } catch (err) {
    console.error(err);
    el.linkErrorMessage.textContent =
      '학교 정보를 불러오는 중 문제가 발생했습니다. 인터넷 연결을 확인한 후 다시 시도해주세요.';
    showOnly(el.stateLinkError);
  }
}

function renderOrgInfo(org) {
  el.orgName.textContent = org.org_name || '연수 전자서명 시스템';
  el.orgNotice.textContent = org.notice_text || '';
  document.title = `${org.org_name || '연수 전자서명 시스템'} - 연수 전자서명`;

  // 대표색은 #RRGGBB 형식일 때만 적용
  if (org.brand_color && /^#[0-9a-fA-F]{3,8}$/.test(org.brand_color)) {
    document.documentElement.style.setProperty('--brand-color', org.brand_color);
  }
}

function setSelectOptions(selectEl, placeholder, items) {
  selectEl.innerHTML = '';
  const first = document.createElement('option');
  first.value = '';
  first.textContent = placeholder;
  selectEl.appendChild(first);
  items.forEach((item) => {
    const opt = document.createElement('option');
    opt.value = item.value;
    opt.textContent = item.label;   // textContent: 이름/부서명을 HTML로 해석하지 않음
    selectEl.appendChild(opt);
  });
}

function renderOrgDepartmentOptions(departments) {
  if (departments.length === 0) {
    setSelectOptions(el.orgDepartmentSelect, '등록된 부서가 없습니다', []);
    el.orgDepartmentSelect.disabled = true;
    return;
  }
  setSelectOptions(
    el.orgDepartmentSelect,
    '부서를 선택해주세요',
    departments.map((d) => ({
      value: d.department_id || NO_DEPARTMENT_VALUE,
      label: d.department_name,
    }))
  );
  el.orgDepartmentSelect.disabled = false;
}

// 부서를 바꾸면 이전 구성원 선택과 연수 목록을 모두 초기화
function resetOrgSelection() {
  orgFlow.deptToken += 1;
  orgFlow.trainingsToken += 1;
  orgFlow.returnToken += 1;
  state.selectedMemberId = null;
  state.selectedMemberName = '';
  el.orgStepTrainings.hidden = true;
  el.orgTrainingList.innerHTML = '';
  el.orgIdentifyNote.hidden = true;
}

el.orgDepartmentSelect.addEventListener('change', async () => {
  const value = el.orgDepartmentSelect.value;
  resetOrgSelection();

  if (!value) {
    setSelectOptions(el.orgMemberSelect, '부서를 먼저 선택해주세요', []);
    el.orgMemberSelect.disabled = true;
    return;
  }

  const departmentId = value === NO_DEPARTMENT_VALUE ? null : value;
  const token = orgFlow.deptToken;

  setSelectOptions(el.orgMemberSelect, '구성원을 불러오는 중…', []);
  el.orgMemberSelect.disabled = true;

  try {
    const { data, error } = await supabaseClient.rpc('get_department_members', {
      p_org_code: ORG_CODE,
      p_department_id: departmentId,
    });
    if (token !== orgFlow.deptToken) return;
    if (error) throw error;

    const members = data || [];
    if (members.length === 0) {
      setSelectOptions(el.orgMemberSelect, '이 부서에 선택할 구성원이 없습니다', []);
      el.orgMemberSelect.disabled = true;
      return;
    }
    setSelectOptions(
      el.orgMemberSelect,
      '성명을 선택해주세요',
      members.map((m) => ({ value: m.member_id, label: m.member_name }))
    );
    el.orgMemberSelect.disabled = false;
  } catch (err) {
    if (token !== orgFlow.deptToken) return;
    console.error(err);
    setSelectOptions(el.orgMemberSelect, '구성원 목록을 불러오지 못했습니다', []);
    el.orgMemberSelect.disabled = true;
    el.orgIdentifyNote.textContent = '구성원 목록을 불러오지 못했습니다. 부서를 다시 선택해주세요.';
    el.orgIdentifyNote.hidden = false;
  }
});

el.orgMemberSelect.addEventListener('change', async () => {
  const memberId = el.orgMemberSelect.value;
  orgFlow.trainingsToken += 1;
  orgFlow.returnToken += 1;
  el.orgStepTrainings.hidden = true;
  el.orgTrainingList.innerHTML = '';

  if (!memberId) {
    state.selectedMemberId = null;
    state.selectedMemberName = '';
    return;
  }

  const option = el.orgMemberSelect.selectedOptions[0];
  state.selectedMemberId = memberId;
  state.selectedMemberName = option ? option.textContent : '';
  await loadMemberTrainings();
});

// 선택한 구성원의 오늘 연수 상태를 서버에서 조회해 표시
async function loadMemberTrainings() {
  const memberId = state.selectedMemberId;
  if (!memberId) return;

  const token = ++orgFlow.trainingsToken;

  el.orgStepTrainings.hidden = false;
  el.orgSelectedLabel.textContent = `${state.selectedMemberName}님`;
  el.orgTrainingsLoading.hidden = false;
  el.orgTrainingsError.hidden = true;
  el.orgTrainingsEmpty.hidden = true;
  el.orgTrainingList.innerHTML = '';
  el.orgRefreshBtn.disabled = true;

  try {
    const { data, error } = await supabaseClient.rpc('get_member_training_statuses', {
      p_org_code: ORG_CODE,
      p_member_id: memberId,
    });
    if (token !== orgFlow.trainingsToken) return;
    if (error) throw error;

    renderOrgTrainings(data || []);
  } catch (err) {
    if (token !== orgFlow.trainingsToken) return;
    console.error(err);
    el.orgTrainingsErrorMessage.textContent =
      '연수 목록을 불러오지 못했습니다. 인터넷 연결을 확인한 후 다시 시도해주세요.';
    el.orgTrainingsError.hidden = false;
  } finally {
    if (token === orgFlow.trainingsToken) {
      el.orgTrainingsLoading.hidden = true;
      el.orgRefreshBtn.disabled = false;
    }
  }
}

function renderOrgTrainings(rows) {
  el.orgTrainingList.innerHTML = '';
  el.orgTrainingsEmpty.hidden = rows.length > 0;

  rows.forEach((row) => {
    const code = Object.prototype.hasOwnProperty.call(STATUS_LABELS, row.status_code)
      ? row.status_code
      : null;                                  // 알 수 없는 상태 → 선택 불가로 처리
    const selectable = code === 'pending';

    const li = document.createElement('li');
    const item = document.createElement(selectable ? 'button' : 'div');
    item.className = 'org-training-item' + (selectable ? ' is-selectable' : '');
    if (selectable) {
      item.type = 'button';
      item.addEventListener('click', () => openSignView(row));
    } else {
      item.setAttribute('aria-disabled', 'true');
    }

    const title = document.createElement('span');
    title.className = 'org-training-title';
    title.textContent = row.title;

    const meta = document.createElement('span');
    meta.className = 'org-training-meta';
    meta.textContent = `${formatDateDot(row.training_date)} · 서명 가능 ${formatSignTimeRange(row.sign_start_at, row.sign_end_at)}`;

    const badge = document.createElement('span');
    badge.className = 'status-badge' + (code ? ` status-${code}` : '');
    badge.textContent = code ? STATUS_LABELS[code] : '상태 확인 필요';

    item.appendChild(title);
    item.appendChild(meta);
    item.appendChild(badge);
    li.appendChild(item);
    el.orgTrainingList.appendChild(li);
  });
}

// '2026-10-13' → '2026.10.13' (날짜 문자열을 그대로 가공: 시간대 변환 없음)
function formatDateDot(dateStr) {
  return dateStr ? String(dateStr).replaceAll('-', '.') : '-';
}

// 서명 가능 시간 표시 (항상 한국 시간 기준)
function formatSignTimeRange(startIso, endIso) {
  if (!startIso || !endIso) return '시간 미설정';
  const start = new Date(startIso);
  const end = new Date(endIso);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return '시간 미설정';

  const timeFmt = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  const dayFmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const mdFmt = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric',
  });

  if (dayFmt.format(start) === dayFmt.format(end)) {
    return `${timeFmt.format(start)} ~ ${timeFmt.format(end)}`;
  }
  return `${mdFmt.format(start)} ${timeFmt.format(start)} ~ ${mdFmt.format(end)} ${timeFmt.format(end)}`;
}

// 서명 가능(pending) 연수를 선택하면 기존 서명 화면(캔버스/지우기/제출)을 재사용
function openSignView(row) {
  if (row.status_code !== 'pending') return;   // 이중 방어 (서버가 제출 때 다시 검증)

  TRAINING_ID = row.training_id;
  state.alreadySigned = false;
  state.hasSignature = false;

  el.trainingTitle.textContent = row.title;
  el.trainingDate.textContent =
    `${formatDateDot(row.training_date)} · 서명 가능 ${formatSignTimeRange(row.sign_start_at, row.sign_end_at)}`;
  el.trainingTarget.parentElement.hidden = true;   // 대상 항목은 공개 화면에 표시하지 않음

  el.stepIdentify.hidden = true;                   // 본인 확인은 목록 화면에서 이미 완료
  el.alreadySignedHint.hidden = true;
  el.signerName.textContent = `${state.selectedMemberName}님`;
  el.signerBar.hidden = false;
  el.stepSign.hidden = false;
  showDevNoteIfNeeded();

  showOnly(el.stateForm);
  el.signaturePlaceholder.hidden = false;
  requestAnimationFrame(setupCanvasSize);          // 화면에 보인 뒤 캔버스 크기 설정(내용도 초기화됨)
  updateSubmitButtonState();
}

// 목록 화면으로 복귀. refetch가 true면 최신 상태를 다시 조회
function backToMainList({ refetch }) {
  orgFlow.returnToken += 1;      // 대기 중이던 '성공 후 자동 복귀'가 있으면 취소
  TRAINING_ID = null;
  state.hasSignature = false;
  el.stepSign.hidden = true;
  showOnly(el.stateMain);
  if (refetch) loadMemberTrainings();
}

// 서명 성공 후: 완료 메시지를 잠시 보이는 동안 목록을 다시 조회하고, 끝나면 목록으로 복귀
async function returnToListAfterSuccess() {
  const token = ++orgFlow.returnToken;
  const refresh = loadMemberTrainings();           // 오류는 내부에서 처리됨
  const wait = new Promise((resolve) => setTimeout(resolve, SUCCESS_MESSAGE_MS));
  await Promise.all([refresh, wait]);
  if (token !== orgFlow.returnToken) return;       // 그 사이 사용자가 직접 이동했으면 중단
  backToMainList({ refetch: false });
}

if (IS_ORG_MODE) {
  el.backToListBtn.addEventListener('click', () => backToMainList({ refetch: true }));
  el.successBackBtn.addEventListener('click', () => backToMainList({ refetch: false }));
  el.errorBackBtn.addEventListener('click', () => backToMainList({ refetch: true }));
  el.orgRefreshBtn.addEventListener('click', () => loadMemberTrainings());
  el.orgTrainingsRetryBtn.addEventListener('click', () => loadMemberTrainings());

  // 다시 화면으로 돌아왔을 때(시간이 지나 상태가 바뀌었을 수 있음) 목록 갱신
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && !el.stateMain.hidden && state.selectedMemberId) {
      loadMemberTrainings();
    }
  });
}

// ---------- 시작 ----------
if (IS_ORG_MODE) {
  initOrgFlow();
} else {
  init();
}
