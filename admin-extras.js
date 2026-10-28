// ============================================================
//  연수 전자서명 시스템 — 관리자 추가 기능 (admin-extras.js)
//
//   1) 관리자 홈: "연수 전자서명 공유" — 학교 공통 주소 표시 / 링크 복사 / QR코드 생성·PNG 저장
//   2) 구성원관리: 선택한 부서를 소속 구성원과 함께 삭제 (과거 서명 기록은 보존)
//
//  ★ admin.js를 수정하지 않습니다. admin.js가 만든 전역 값(currentAdmin, membersState,
//    supabaseClient)과 함수(renderAdminHome, renderDeptFilter, loadDepartmentsAndMembers)를
//    "덧붙여" 씁니다. admin.html에서 admin.js 다음에 불러와야 합니다.
//  ★ QR코드는 브라우저 안에서 만들어집니다(qrcode-generator.js, MIT). 주소 외의 어떤 정보도
//    외부로 보내지 않고, 외부 QR 서비스를 사용하지 않습니다.
// ============================================================
(function () {
  'use strict';

  function make(tag, className, content) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (content !== undefined && content !== null) node.textContent = content;
    return node;
  }

  // ==========================================================
  //  1. 연수 전자서명 공유 (학교 공통 주소 / 링크 복사 / QR코드)
  // ==========================================================
  const share = {
    panel: null,
    addressInput: null,
    status: null,
    copyBtn: null,
    qrBtn: null,
    qrBox: null,
    qrImg: null,
    qrSaveBtn: null,
    address: '',
    qrDataUrl: '',
  };

  // 학교 공통 주소 = (이 관리자 페이지가 있는 폴더) + ?org=학교코드
  //  · 학교 코드는 로그인한 관리자의 소속 학교 정보(currentAdmin.publicCode)에서만 가져옵니다.
  //    특정 학교 코드를 코드에 고정하지 않습니다.
  //  · 주소의 앞부분은 현재 접속 주소에서 만듭니다. GitHub Pages라면
  //    https://아이디.github.io/저장소/admin.html → https://아이디.github.io/저장소/?org=학교코드
  function buildCommonAddress(publicCode) {
    const url = new URL(window.location.href);
    url.search = '';
    url.hash = '';
    url.pathname = url.pathname.replace(/[^/]*$/, '');
    url.searchParams.set('org', publicCode);
    return url.toString();
  }

  function isLocalAddress(addressText) {
    try {
      const u = new URL(addressText);
      return u.protocol === 'file:' || u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '';
    } catch (err) {
      return false;
    }
  }

  function setShareStatus(message, kind) {
    if (!share.status) return;
    share.status.textContent = message || '';
    share.status.className = 'share-status' + (kind ? ' is-' + kind : '');
    share.status.hidden = !message;
  }

  async function copyText(textToCopy) {
    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(textToCopy);
        return true;
      } catch (err) {
        // 아래의 예전 방식으로 다시 시도
      }
    }
    const ta = document.createElement('textarea');
    ta.value = textToCopy;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '0';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (err) { ok = false; }
    ta.remove();
    return ok;
  }

  // QR코드를 PNG 데이터 주소로 만듭니다. (흰 배경 + 검은 모듈 + 주변 여백 4칸 = QR 표준 여백)
  function createQrPngDataUrl(textToEncode) {
    if (typeof qrcode !== 'function') {
      const err = new Error('QR 생성 도구가 없습니다.');
      err.code = 'QR_LIB_MISSING';
      throw err;
    }
    const qr = qrcode(0, 'M');   // 크기 자동, 오류 정정 수준 M
    qr.addData(textToEncode);
    qr.make();

    const count = qr.getModuleCount();
    const quiet = 4;
    const scale = Math.max(6, Math.floor(1024 / (count + quiet * 2)));
    const size = (count + quiet * 2) * scale;

    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      const err = new Error('이 브라우저에서는 이미지를 만들 수 없습니다.');
      err.code = 'NO_CANVAS';
      throw err;
    }
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#000000';
    for (let r = 0; r < count; r += 1) {
      for (let c = 0; c < count; c += 1) {
        if (qr.isDark(r, c)) ctx.fillRect((c + quiet) * scale, (r + quiet) * scale, scale, scale);
      }
    }
    return canvas.toDataURL('image/png');
  }

  function safeFileName(name) {
    return String(name || '').replace(/[\\/:*?"<>|\s]+/g, '_').replace(/^_+|_+$/g, '') || '학교';
  }

  function ensureSharePanel() {
    if (share.panel && document.body.contains(share.panel)) return share.panel;
    const grid = document.getElementById('adminMenuGrid');
    if (!grid) return null;

    const panel = make('section', 'share-panel');
    panel.id = 'sharePanel';
    panel.setAttribute('aria-labelledby', 'shareTitle');

    const title = make('h2', 'share-title', '연수 전자서명 공유');
    title.id = 'shareTitle';
    panel.appendChild(title);
    panel.appendChild(make('p', 'share-desc', '학교 구성원에게 아래 링크 또는 QR코드를 안내해 주세요.'));

    const input = make('input', 'share-address');
    input.type = 'text';
    input.id = 'shareAddressInput';
    input.readOnly = true;
    input.setAttribute('aria-label', '학교 공통 주소');
    panel.appendChild(input);

    const actions = make('div', 'share-actions');
    const copyBtn = make('button', 'btn btn-primary btn-compact', '링크 복사');
    copyBtn.type = 'button';
    copyBtn.id = 'shareCopyBtn';
    const qrBtn = make('button', 'btn btn-ghost btn-compact', 'QR코드 생성');
    qrBtn.type = 'button';
    qrBtn.id = 'shareQrBtn';
    actions.appendChild(copyBtn);
    actions.appendChild(qrBtn);
    panel.appendChild(actions);

    const status = make('p', 'share-status');
    status.id = 'shareStatus';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.hidden = true;
    panel.appendChild(status);

    const qrBox = make('div', 'share-qr');
    qrBox.id = 'shareQrBox';
    qrBox.hidden = true;
    const qrImg = make('img', 'share-qr-img');
    qrImg.id = 'shareQrImg';
    qrImg.alt = '학교 공통 주소 QR코드';
    const qrSide = make('div', 'share-qr-side');
    qrSide.appendChild(make('p', 'share-qr-caption', '스마트폰 카메라로 스캔하면 학교 공통 주소로 이동합니다.'));
    const saveBtn = make('button', 'btn btn-primary btn-compact', 'QR코드 이미지 저장');
    saveBtn.type = 'button';
    saveBtn.id = 'shareQrSaveBtn';
    qrSide.appendChild(saveBtn);
    qrBox.appendChild(qrImg);
    qrBox.appendChild(qrSide);
    panel.appendChild(qrBox);

    grid.insertAdjacentElement('afterend', panel);

    share.panel = panel;
    share.addressInput = input;
    share.status = status;
    share.copyBtn = copyBtn;
    share.qrBtn = qrBtn;
    share.qrBox = qrBox;
    share.qrImg = qrImg;
    share.qrSaveBtn = saveBtn;

    copyBtn.addEventListener('click', onCopyLink);
    qrBtn.addEventListener('click', onCreateQr);
    saveBtn.addEventListener('click', onSaveQr);
    input.addEventListener('focus', () => input.select());
    return panel;
  }

  // 관리자 홈이 표시될 때마다(로그인/재로그인 포함) 현재 관리자의 학교 기준으로 다시 채웁니다.
  function refreshSharePanel() {
    if (!ensureSharePanel()) return;

    share.qrDataUrl = '';
    share.qrImg.removeAttribute('src');
    share.qrBox.hidden = true;
    setShareStatus('');

    const code = currentAdmin && currentAdmin.publicCode;
    if (!code) {
      share.address = '';
      share.addressInput.value = '';
      share.copyBtn.disabled = true;
      share.qrBtn.disabled = true;
      setShareStatus('학교 공통 주소에 필요한 학교 코드를 확인할 수 없습니다. 담당자에게 문의해주세요.', 'error');
      return;
    }

    share.address = buildCommonAddress(code);
    share.addressInput.value = share.address;
    share.copyBtn.disabled = false;
    share.qrBtn.disabled = false;

    if (isLocalAddress(share.address)) {
      setShareStatus('현재 로컬(테스트) 주소로 접속 중이라 위 주소도 로컬 주소입니다. 배포된 사이트의 관리자 페이지에서 열면 실제 공유용 주소가 표시됩니다.', 'warn');
    }
  }

  async function onCopyLink() {
    if (!share.address) return;
    const ok = await copyText(share.address);
    if (ok) {
      setShareStatus('링크를 복사했습니다. 원하는 곳에 붙여넣기(Ctrl+V)하세요.', 'ok');
    } else {
      share.addressInput.focus();
      share.addressInput.select();
      setShareStatus('자동 복사에 실패했습니다. 위 주소가 선택되어 있으니 Ctrl+C로 직접 복사해주세요.', 'error');
    }
  }

  function onCreateQr() {
    if (!share.address) return;
    try {
      share.qrDataUrl = createQrPngDataUrl(share.address);
      share.qrImg.src = share.qrDataUrl;
      share.qrBox.hidden = false;
      setShareStatus('QR코드를 만들었습니다. 아래 버튼으로 이미지를 저장할 수 있습니다.', 'ok');
    } catch (err) {
      console.error('QR코드 생성 오류:', err);
      share.qrDataUrl = '';
      share.qrBox.hidden = true;
      let message;
      if (err && err.code === 'QR_LIB_MISSING') {
        message = 'QR코드 생성 도구를 불러오지 못했습니다. qrcode-generator.js 파일이 admin.html과 같은 폴더에 있는지 확인해주세요.';
      } else if (err && err.code === 'NO_CANVAS') {
        message = 'QR코드 이미지를 만들 수 없는 브라우저입니다. 다른 브라우저(Chrome, Edge 등)로 시도해주세요.';
      } else {
        message = 'QR코드를 만들지 못했습니다. 주소가 너무 길거나 올바르지 않을 수 있습니다. 문제가 계속되면 담당자에게 문의해주세요.';
      }
      setShareStatus(message, 'error');
    }
  }

  function onSaveQr() {
    if (!share.qrDataUrl) return;
    const link = document.createElement('a');
    link.href = share.qrDataUrl;
    link.download = '연수서명_QR_' + safeFileName(currentAdmin.orgName) + '.png';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setShareStatus('QR코드 이미지(PNG)를 저장했습니다. 저장되지 않으면 이미지를 길게 누르거나 마우스 오른쪽 버튼으로 저장해주세요.', 'ok');
  }

  // 관리자 홈이 그려질 때(admin.js의 renderAdminHome) 공유 영역도 함께 채웁니다.
  if (typeof window.renderAdminHome === 'function') {
    const originalRenderAdminHome = window.renderAdminHome;
    window.renderAdminHome = function () {
      const result = originalRenderAdminHome.apply(this, arguments);
      try {
        refreshSharePanel();
      } catch (err) {
        console.error('공유 영역 표시 오류:', err);
      }
      return result;
    };
  } else {
    console.warn('admin-extras.js: renderAdminHome을 찾지 못해 공유 영역을 추가하지 않았습니다.');
  }

  // 로그인 상태가 남아 있어 admin.js가 관리자 홈을 이 파일보다 먼저 그려 버린 경우를 대비해,
  // 이미 관리자 정보가 채워져 있으면 지금 바로 공유 영역을 채웁니다.
  if (typeof currentAdmin !== 'undefined' && currentAdmin && currentAdmin.orgId) {
    try {
      refreshSharePanel();
    } catch (err) {
      console.error('공유 영역 표시 오류:', err);
    }
  }

  // ==========================================================
  //  2. 구성원관리 — 선택한 부서를 소속 구성원과 함께 삭제
  // ==========================================================
  const deptDelete = { bar: null, nameEl: null, btn: null, result: null, busy: false };

  function ensureDeptDeleteBar() {
    if (deptDelete.bar && document.body.contains(deptDelete.bar)) return true;
    const filter = document.getElementById('memberDeptFilter');
    if (!filter) return false;

    const bar = make('div', 'dept-delete-bar');
    bar.id = 'deptDeleteBar';
    bar.hidden = true;
    const label = make('span', 'dept-delete-label', '선택한 부서: ');
    const nameEl = make('strong', 'dept-delete-name');
    label.appendChild(nameEl);
    const btn = make('button', 'btn-link dept-delete-btn', '이 부서 삭제');
    btn.type = 'button';
    btn.id = 'deptDeleteBtn';
    bar.appendChild(label);
    bar.appendChild(btn);

    const result = make('p', 'dept-delete-result');
    result.id = 'deptDeleteResult';
    result.setAttribute('role', 'status');
    result.hidden = true;

    filter.insertAdjacentElement('afterend', bar);
    bar.insertAdjacentElement('afterend', result);

    deptDelete.bar = bar;
    deptDelete.nameEl = nameEl;
    deptDelete.btn = btn;
    deptDelete.result = result;
    btn.addEventListener('click', onDeleteSelectedDepartment);
    return true;
  }

  function showDeptDeleteResult(message, kind) {
    if (!deptDelete.result) return;
    deptDelete.result.textContent = message;
    deptDelete.result.className = 'dept-delete-result' + (kind ? ' is-' + kind : '');
    deptDelete.result.hidden = !message;
  }

  // 부서 칩에서 부서를 고르면 "이 부서 삭제" 줄이 나타납니다. ("전체"를 고르면 숨김)
  function updateDeptDeleteBar() {
    if (!ensureDeptDeleteBar()) return;
    const id = membersState.selectedDeptId;
    const dept = id ? membersState.departments.find((d) => d.id === id) : null;
    deptDelete.bar.hidden = !dept;
    if (dept) {
      deptDelete.nameEl.textContent = dept.name;
      showDeptDeleteResult('');   // 다른 작업을 시작하면 이전 결과 안내는 지움
    }
  }

  async function onDeleteSelectedDepartment() {
    if (deptDelete.busy) return;

    const deptId = membersState.selectedDeptId;
    const dept = deptId ? membersState.departments.find((d) => d.id === deptId) : null;
    if (!dept) {
      window.alert('삭제할 부서를 먼저 선택해주세요. 위의 부서 버튼을 눌러 부서를 선택하면 삭제할 수 있습니다.');
      return;
    }

    deptDelete.busy = true;
    deptDelete.btn.disabled = true;
    showDeptDeleteResult('');

    try {
      // 1) 삭제 대상 구성원 수 확인 (이 학교, 이 부서만)
      const { data: members, error: countError } = await supabaseClient
        .from('members')
        .select('id, is_active')
        .eq('org_id', currentAdmin.orgId)
        .eq('department_id', deptId);

      if (countError) {
        console.error('부서 구성원 수 조회 오류:', countError);
        window.alert('부서 정보를 확인하지 못했습니다. 인터넷 연결을 확인한 후 다시 시도해주세요.');
        return;
      }

      const activeCount = (members || []).filter((m) => m.is_active).length;

      // 2) 최종 확인
      const confirmed = window.confirm(
        '이 부서를 삭제하시겠습니까?\n\n' +
        '삭제 대상 부서: ' + dept.name + '\n' +
        '소속 구성원: ' + activeCount + '명\n\n' +
        '※ 이 부서와 소속 구성원이 함께 삭제됩니다. 삭제된 구성원은 구성원 목록에서 사라집니다.\n' +
        '※ 과거 연수 서명 기록은 그대로 보존됩니다.'
      );
      if (!confirmed) return;

      // 3) 서버에서 권한 확인 + 한 번에(트랜잭션) 처리
      const { data, error } = await supabaseClient.rpc('delete_department_with_members', {
        p_department_id: deptId,
      });

      if (error) {
        console.error('부서 삭제 RPC 오류:', error);
        window.alert('부서를 삭제하지 못했습니다. 아무 것도 삭제되지 않았습니다. 잠시 후 다시 시도해주세요.');
        return;
      }

      if (!data || !data.success) {
        window.alert((data && data.message) || '부서를 삭제하지 못했습니다.');
        // 이미 삭제된 부서 등 화면이 오래된 경우를 위해 목록을 다시 불러옴
        membersState.selectedDeptId = null;
        await loadDepartmentsAndMembers();
        return;
      }

      // 4) 목록 갱신 후 결과 안내
      membersState.selectedDeptId = null;
      await loadDepartmentsAndMembers();
      showDeptDeleteResult(
        '"' + data.department_name + '" 부서와 소속 구성원 ' + data.deleted_member_count +
        '명을 삭제했습니다. 과거 서명 기록은 그대로 보존됩니다.',
        'ok'
      );
    } catch (err) {
      console.error('부서 삭제 오류:', err);
      window.alert('부서 삭제 중 문제가 발생했습니다. 인터넷 연결을 확인한 후 다시 시도해주세요.');
    } finally {
      deptDelete.busy = false;
      deptDelete.btn.disabled = false;
    }
  }

  // 부서 칩이 다시 그려질 때(admin.js의 renderDeptFilter) 삭제 줄도 함께 갱신합니다.
  if (typeof window.renderDeptFilter === 'function') {
    const originalRenderDeptFilter = window.renderDeptFilter;
    window.renderDeptFilter = function () {
      const result = originalRenderDeptFilter.apply(this, arguments);
      try {
        updateDeptDeleteBar();
      } catch (err) {
        console.error('부서 삭제 영역 표시 오류:', err);
      }
      return result;
    };
  } else {
    console.warn('admin-extras.js: renderDeptFilter를 찾지 못해 부서 삭제 영역을 추가하지 않았습니다.');
  }

  // 점검/테스트용 (화면 기능에는 영향 없음)
  window.__adminExtras = { buildCommonAddress, createQrPngDataUrl, copyText, safeFileName };
})();
