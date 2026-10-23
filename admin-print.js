// ============================================================
//  연수 전자서명 시스템 — 연수별 서명부 출력 (admin-print.js)
//
//  ★ 읽기 전용 기능입니다. DB에 쓰거나 기존 RPC/RLS/인증을 바꾸지 않습니다.
//  ★ admin.js를 수정하지 않습니다. admin.js가 만든 전역 값(supabaseClient,
//    currentAdmin)과 연수 카드 렌더 함수(renderTrainingCard)를 "덧붙여" 씁니다.
//    (admin.html에서 admin.js 다음에 이 파일을 불러와야 합니다.)
//
//  동작:
//   1) 연수 목록의 각 카드에 "서명부 출력" 버튼을 추가합니다.
//   2) 버튼을 누르면 이 연수의 대상 구성원 + 서명 현황을 조회해
//      A4 서명부 미리보기를 엽니다. (학교 org_id 조건으로만 조회)
//   3) "인쇄 / PDF 저장"을 누르면 브라우저 인쇄 창이 열립니다.
//
//  대상자 규칙 (서명 현황 / get_training_targets와 동일):
//    · 활성(is_active) 구성원만, 이 학교(org_id)만
//    · 연수 대상 유형 '교원'   → member_type = '교원'
//    · 연수 대상 유형 '교직원' → member_type이 '교원' 또는 '교직원'
//
//  서명 이미지:
//    · signatures.image_file_id(Drive 파일 ID)가 있는 경우에만 이미지를 표시합니다.
//    · 이미지가 없거나 불러오지 못하면 임의로 만들지 않고 그 사실을 칸에 그대로 표시합니다.
//    · 이미지 주소는 buildSignatureImageUrl() 한 곳에서만 만듭니다.
//      (현재는 Drive 접근 권한이 있는 브라우저에서만 보일 수 있는 방식 —
//       안전한 전용 이미지 경로가 생기면 이 함수만 바꾸면 됩니다.)
// ============================================================
(function () {
  'use strict';

  // ---------- 서명 이미지 주소 (교체 지점) ----------
  // 공개 링크가 아닙니다. Drive 파일이 비공개이면, 그 파일에 접근 권한이 있는
  // Google 계정으로 로그인된 브라우저에서만 표시됩니다.
  function buildSignatureImageUrl(fileId) {
    return 'https://drive.google.com/thumbnail?id=' + encodeURIComponent(fileId) + '&sz=w600';
  }

  const IMAGE_TIMEOUT_MS = 20000;

  const sheetState = {
    overlay: null,
    opening: false,
    previousTitle: null,
    pendingImages: 0,
    shownImages: 0,
    failedImages: 0,
    timeoutId: null,
  };

  // ---------- 유틸 ----------
  function text(tag, className, content) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (content !== undefined && content !== null) node.textContent = content;
    return node;
  }

  function formatSheetDate(dateStr) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr || '');
    if (!m) return dateStr || '-';
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    const weekday = '일월화수목금토'[d.getUTCDay()];
    return m[1] + '. ' + Number(m[2]) + '. ' + Number(m[3]) + '. (' + weekday + ')';
  }

  function formatSignedAt(isoString) {
    if (!isoString) return '';
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return '';
    return new Intl.DateTimeFormat('ko-KR', {
      timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(d);
  }

  // 대상자 선정 — 서명 현황/get_training_targets와 같은 규칙
  // 알 수 없는 대상 유형이면 null (잘못된 명단을 만들지 않기 위함)
  function selectSheetTargets(targetType, members) {
    if (targetType === '교원') return members.filter((m) => m.member_type === '교원');
    if (targetType === '교직원') return members.filter((m) => m.member_type === '교원' || m.member_type === '교직원');
    return null;
  }

  // ---------- 부서 출력 순서 = 구성원관리에서 부서를 등록한 순서 ----------
  // departments 테이블에는 순서를 나타내는 값이 두 가지 있습니다.
  //   · sort_order : 기본값 0. "+ 부서 추가"와 엑셀 일괄등록은 이 값을 따로 지정하지 않으므로
  //                  보통 모든 부서가 0입니다. (값이 서로 다르게 지정되어 있으면 그 값이 우선)
  //   · created_at : 부서를 등록한 시각
  // 순서 기준: sort_order → created_at(등록 시각) → 조회 결과 순서(같은 시각일 때).
  // ※ 부서명 가나다순은 사용하지 않습니다.
  function rankDepartments(departments) {
    const numberOrMax = (v) => (v !== null && v !== undefined && Number.isFinite(Number(v)) ? Number(v) : Number.MAX_SAFE_INTEGER);
    const timeOrMax = (v) => {
      const t = v ? Date.parse(v) : NaN;
      return Number.isNaN(t) ? Number.MAX_SAFE_INTEGER : t;
    };
    const ordered = departments
      .map((d, index) => ({ d, index }))
      .sort((a, b) =>
        (numberOrMax(a.d.sort_order) - numberOrMax(b.d.sort_order)) ||
        (timeOrMax(a.d.created_at) - timeOrMax(b.d.created_at)) ||
        (a.index - b.index)
      );
    const rank = new Map();
    ordered.forEach((x, i) => rank.set(x.d.id, i));
    return rank;
  }

  // ---------- 데이터 조회 (읽기 전용, 이 학교 org_id만) ----------
  async function loadSheetData(training) {
    const orgId = currentAdmin.orgId;
    if (!orgId) throw new Error('소속 학교 정보를 확인할 수 없습니다.');

    const [memberRes, deptRes, sigRes] = await Promise.all([
      supabaseClient.from('members')
        .select('id, name, member_type, department_id, is_active')
        .eq('org_id', orgId)
        .eq('is_active', true),
      supabaseClient.from('departments')
        .select('id, name, sort_order, created_at')
        .eq('org_id', orgId)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true }),
      supabaseClient.from('signatures')
        .select('member_id, created_at, image_file_id')
        .eq('org_id', orgId)
        .eq('training_id', training.id),
    ]);

    if (memberRes.error) throw memberRes.error;
    if (deptRes.error) throw deptRes.error;
    if (sigRes.error) throw sigRes.error;

    const targets = selectSheetTargets(training.target_type, memberRes.data || []);
    if (targets === null) {
      const err = new Error('알 수 없는 대상 유형: ' + training.target_type);
      err.code = 'UNKNOWN_TARGET_TYPE';
      throw err;
    }

    const deptById = new Map((deptRes.data || []).map((d) => [d.id, d]));
    const deptRank = rankDepartments(deptRes.data || []);
    const sigByMember = new Map((sigRes.data || []).map((s) => [s.member_id, s]));
    const targetIds = new Set(targets.map((m) => m.id));
    const extraSignatureCount = (sigRes.data || []).filter((s) => !targetIds.has(s.member_id)).length;

    const rows = targets.map((m) => {
      const dept = deptById.get(m.department_id);
      const sig = sigByMember.get(m.id);
      return {
        deptName: dept ? dept.name : '(부서 미지정)',
        deptOrder: dept ? deptRank.get(dept.id) : Number.MAX_SAFE_INTEGER, // 부서 미지정은 맨 뒤
        name: m.name,
        signed: !!sig,
        fileId: sig && sig.image_file_id ? String(sig.image_file_id) : '',
        signedAt: sig ? sig.created_at : null,
      };
    });

    // 부서는 등록 순서대로, 같은 부서 안에서는 기존처럼 이름 가나다순
    rows.sort((a, b) =>
      (a.deptOrder - b.deptOrder) ||
      a.name.localeCompare(b.name, 'ko')
    );
    rows.forEach((r, i) => { r.no = i + 1; });

    return { rows, extraSignatureCount };
  }

  // ---------- 화면 ----------
  function closeSheet() {
    if (sheetState.timeoutId) { clearTimeout(sheetState.timeoutId); sheetState.timeoutId = null; }
    if (sheetState.overlay) {
      sheetState.overlay.remove();
      sheetState.overlay = null;
    }
    document.body.classList.remove('sigsheet-open');
    restoreTitle();
    document.removeEventListener('keydown', onSheetKeydown);
  }

  function restoreTitle() {
    if (sheetState.previousTitle !== null) {
      document.title = sheetState.previousTitle;
      sheetState.previousTitle = null;
    }
  }

  function onSheetKeydown(evt) {
    if (evt.key === 'Escape') closeSheet();
  }

  function createOverlay(training) {
    const overlay = text('div', 'sigsheet-overlay');
    overlay.id = 'sigSheetOverlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', '서명부 미리보기');

    const toolbar = text('div', 'sigsheet-toolbar');
    const info = text('div', 'sigsheet-toolbar-info');
    info.appendChild(text('strong', null, '서명부 미리보기'));
    const status = text('span', 'sigsheet-status', '불러오는 중…');
    status.id = 'sigSheetStatus';
    info.appendChild(status);

    const actions = text('div', 'sigsheet-toolbar-actions');
    const printBtn = text('button', 'btn btn-primary btn-compact', '인쇄 / PDF 저장');
    printBtn.type = 'button';
    printBtn.id = 'sigSheetPrintBtn';
    printBtn.disabled = true;
    const closeBtn = text('button', 'btn btn-ghost btn-compact', '닫기');
    closeBtn.type = 'button';
    closeBtn.id = 'sigSheetCloseBtn';
    actions.appendChild(printBtn);
    actions.appendChild(closeBtn);

    toolbar.appendChild(info);
    toolbar.appendChild(actions);

    const notices = text('div', 'sigsheet-notices');
    notices.id = 'sigSheetNotices';

    const scroll = text('div', 'sigsheet-scroll');
    const paper = text('div', 'sigsheet-pages');
    paper.id = 'sigSheetPaper';
    scroll.appendChild(paper);

    overlay.appendChild(toolbar);
    overlay.appendChild(notices);
    overlay.appendChild(scroll);

    closeBtn.addEventListener('click', closeSheet);
    printBtn.addEventListener('click', () => handlePrint(training));

    return overlay;
  }

  function updateStatusLine(summary) {
    const status = document.getElementById('sigSheetStatus');
    if (!status) return;
    const parts = [
      '대상 ' + summary.total + '명',
      '서명 ' + summary.signed + '명',
      '미서명 ' + summary.unsigned + '명',
    ];
    if (sheetState.pendingImages > 0) {
      parts.push('서명 이미지 불러오는 중 (' + sheetState.pendingImages + '건 남음)');
    } else if (summary.imageTotal > 0) {
      parts.push('서명 이미지 표시 ' + sheetState.shownImages + '건');
      if (sheetState.failedImages > 0) parts.push('불러오지 못함 ' + sheetState.failedImages + '건');
    }
    if (summary.noImageSigned > 0) parts.push('이미지 정보 없는 서명 ' + summary.noImageSigned + '건');
    status.textContent = parts.join(' · ');

    const printBtn = document.getElementById('sigSheetPrintBtn');
    if (printBtn) printBtn.disabled = sheetState.pendingImages > 0;
  }

  function renderNotice(message, kind) {
    const box = document.getElementById('sigSheetNotices');
    if (!box) return;
    const p = text('p', 'sigsheet-notice' + (kind ? ' is-' + kind : ''), message);
    box.appendChild(p);
  }

  // ---------- 페이지 배분 ----------
  // A4 세로 한 장을 좌/우 2개 영역으로 나누어 인원을 배치합니다.
  // 행 높이 8.6mm, 인쇄 가능 높이 277mm(위아래 여백 10mm) 기준으로 계산한
  // "한 영역(좌 또는 우)의 최대 행 수"입니다. (여유 약 10mm를 남겨 둔 값)
  //   · 첫 페이지: 제목/연수 정보가 들어가므로 27행  → 한 장 최대 54명
  //   · 이후 페이지: 간단한 머리글만 있으므로 29행  → 한 장 최대 58명
  // 값을 바꾸면 admin-print.css의 높이(--sig-row 등)와 함께 맞춰야 합니다.
  const ROWS_PER_SIDE_FIRST = 27;
  const ROWS_PER_SIDE_NEXT = 29;

  // rows(번호 순서대로)를 페이지별 { left, right }로 나눕니다.
  //  · 페이지를 채워 가며 다음 페이지로 넘어가므로, 필요할 때만 페이지가 늘어납니다.
  //  · 한 페이지 안에서는 앞쪽 절반이 왼쪽, 나머지가 오른쪽입니다(예: 54명 → 왼쪽 1~27, 오른쪽 28~54).
  //  · 번호는 전체에서 연속이며, 어떤 구성원도 빠지거나 두 번 나오지 않습니다.
  function paginateRows(rows) {
    const pages = [];
    let index = 0;
    while (index < rows.length) {
      const perSide = pages.length === 0 ? ROWS_PER_SIDE_FIRST : ROWS_PER_SIDE_NEXT;
      const chunk = rows.slice(index, index + perSide * 2);
      const leftCount = Math.ceil(chunk.length / 2);
      pages.push({ left: chunk.slice(0, leftCount), right: chunk.slice(leftCount) });
      index += chunk.length;
    }
    return pages;
  }

  // 서명 칸 하나 만들기 (이미지 / 이미지 정보 없음 / 비어 있음)
  function buildSignCell(row, summary) {
    const signCell = text('td', 'sigsheet-cell-sign');
    if (row.signed && row.fileId) {
      sheetState.pendingImages += 1;
      const img = document.createElement('img');
      img.className = 'sigsheet-sign-img';
      img.alt = row.name + ' 서명';
      img.referrerPolicy = 'no-referrer';
      img.addEventListener('load', () => settleImage(img, signCell, true, summary));
      img.addEventListener('error', () => settleImage(img, signCell, false, summary));
      signCell.appendChild(img);
      img.src = buildSignatureImageUrl(row.fileId);
    } else if (row.signed) {
      // 서명 기록은 있으나 이미지 파일 정보가 없음 — 서명 이미지를 만들어 넣지 않고,
      // 서명 완료로 오인하지 않도록 표시
      signCell.appendChild(text('span', 'sigsheet-sign-note', '서명 기록 있음 (이미지 없음)'));
    }
    // 미서명: 서명란은 비워 둠 (직접 서명)
    return signCell;
  }

  // 한 사람(또는 빈 칸) 분량의 5개 셀
  function appendMemberCells(tr, row, summary, isRightSide) {
    const first = row ? text('td', 'sigsheet-cell-no', String(row.no)) : text('td', 'sigsheet-cell-no');
    if (isRightSide) first.classList.add('sigsheet-split');
    tr.appendChild(first);
    tr.appendChild(text('td', 'sigsheet-cell-dept', row ? row.deptName : ''));
    tr.appendChild(text('td', 'sigsheet-cell-name', row ? row.name : ''));
    tr.appendChild(row ? buildSignCell(row, summary) : text('td', 'sigsheet-cell-sign'));
    tr.appendChild(text('td', 'sigsheet-cell-note'));
  }

  function buildPageTable(page, summary) {
    const table = text('table', 'sigsheet-table');

    const colgroup = document.createElement('colgroup');
    for (let side = 0; side < 2; side += 1) {
      ['sigsheet-col-no', 'sigsheet-col-dept', 'sigsheet-col-name', 'sigsheet-col-sign', 'sigsheet-col-note']
        .forEach((c) => colgroup.appendChild(text('col', c)));
    }
    table.appendChild(colgroup);

    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    for (let side = 0; side < 2; side += 1) {
      ['번호', '부서', '성명', '서명', '비고'].forEach((label, i) => {
        const th = text('th', null, label);
        if (side === 1 && i === 0) th.classList.add('sigsheet-split');
        headRow.appendChild(th);
      });
    }
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    for (let i = 0; i < page.left.length; i += 1) {
      const tr = document.createElement('tr');
      appendMemberCells(tr, page.left[i], summary, false);
      appendMemberCells(tr, page.right[i] || null, summary, true); // 오른쪽이 모자라면 빈 칸
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    return table;
  }

  function renderSheet(training, data) {
    const paper = document.getElementById('sigSheetPaper');
    if (!paper) return;
    paper.textContent = '';

    const schoolName = currentAdmin.orgName || '-';
    const summary = {
      total: data.rows.length,
      signed: data.rows.filter((r) => r.signed).length,
      unsigned: data.rows.filter((r) => !r.signed).length,
      imageTotal: data.rows.filter((r) => r.signed && r.fileId).length,
      noImageSigned: data.rows.filter((r) => r.signed && !r.fileId).length,
    };

    sheetState.pendingImages = 0;
    sheetState.shownImages = 0;
    sheetState.failedImages = 0;

    const pages = paginateRows(data.rows);

    if (pages.length === 0) {
      // 대상자가 없는 경우: 제목/연수 정보와 안내만 표시
      const page = text('section', 'sigsheet-page');
      page.appendChild(buildFirstPageHeader(training, schoolName));
      page.appendChild(text('p', 'sigsheet-empty',
        '대상 구성원이 없습니다. 활성 상태의 ' +
        (training.target_type === '교원' ? '"교원" ' : '교원/교직원 ') + '구성원이 등록되어 있는지 확인해주세요.'));
      paper.appendChild(page);
    }

    pages.forEach((pageData, pageIndex) => {
      const page = text('section', 'sigsheet-page');
      page.dataset.page = String(pageIndex + 1);
      page.appendChild(pageIndex === 0
        ? buildFirstPageHeader(training, schoolName)
        : buildContinuationHeader(training, schoolName, pageIndex + 1, pages.length));
      page.appendChild(buildPageTable(pageData, summary));
      paper.appendChild(page);
    });

    if (data.extraSignatureCount > 0) {
      renderNotice('대상자 목록에 없는 서명 기록 ' + data.extraSignatureCount +
        '건은 서명부에 포함되지 않았습니다 (비활성화된 구성원 등). 이 안내는 인쇄되지 않습니다.', 'info');
    }
    if (summary.imageTotal > 0) {
      renderNotice('서명 이미지는 Drive 접근 권한이 있는 Google 계정으로 로그인된 브라우저에서만 표시될 수 있습니다. ' +
        '이미지가 보이지 않으면 인쇄 전에 확인해주세요. 이 안내는 인쇄되지 않습니다.', 'info');
    }
    if (pages.length > 1) {
      renderNotice('인원이 많아 ' + pages.length + '쪽으로 나누어 출력됩니다 (번호는 이어서 매겨집니다). 이 안내는 인쇄되지 않습니다.', 'info');
    }

    sheetState.summary = summary;
    updateStatusLine(summary);

    if (sheetState.pendingImages > 0) {
      sheetState.timeoutId = setTimeout(() => {
        // 시간 내에 결과가 없는 이미지는 실패로 처리 (인쇄 버튼이 영원히 잠기지 않도록)
        paper.querySelectorAll('img.sigsheet-sign-img').forEach((img) => {
          const cell = img.parentNode;
          if (cell && !cell.dataset.settled) settleImage(img, cell, false, summary);
        });
      }, IMAGE_TIMEOUT_MS);
    }
  }

  // 첫 페이지 상단: 제목 + 연수 정보 (기존 연수 등록부 양식과 같은 배치)
  function buildFirstPageHeader(training, schoolName) {
    const header = text('header', 'sigsheet-header');
    header.appendChild(text('h1', 'sigsheet-title', '연수 서명부'));

    const dateLine = text('p', 'sigsheet-meta-line');
    dateLine.appendChild(text('span', 'sigsheet-meta-label', '연수 일자 :'));
    dateLine.appendChild(text('span', 'sigsheet-meta-value', formatSheetDate(training.date)));
    header.appendChild(dateLine);

    const titleLine = text('p', 'sigsheet-meta-line sigsheet-meta-split');
    const titleLeft = text('span', 'sigsheet-meta-left');
    titleLeft.appendChild(text('span', 'sigsheet-meta-label', '연수명 :'));
    titleLeft.appendChild(text('span', 'sigsheet-meta-value', training.title));
    titleLine.appendChild(titleLeft);
    titleLine.appendChild(text('span', 'sigsheet-school', schoolName));
    header.appendChild(titleLine);
    return header;
  }

  // 둘째 쪽 이후: 어느 연수의 몇 쪽인지 알 수 있는 짧은 머리글 (표 열 제목은 각 쪽에 다시 표시됨)
  function buildContinuationHeader(training, schoolName, pageNo, pageTotal) {
    const header = text('header', 'sigsheet-page-header');
    header.appendChild(text('span', 'sigsheet-page-header-title', '연수 서명부 · ' + training.title));
    header.appendChild(text('span', 'sigsheet-page-header-info', schoolName + ' · ' + pageNo + ' / ' + pageTotal + '쪽'));
    return header;
  }

  function settleImage(img, signCell, ok, summary) {
    if (signCell.dataset.settled) return; // 중복 호출 방지
    signCell.dataset.settled = ok ? 'ok' : 'fail';
    sheetState.pendingImages = Math.max(0, sheetState.pendingImages - 1);
    if (ok) {
      sheetState.shownImages += 1;
    } else {
      sheetState.failedImages += 1;
      img.remove();
      signCell.appendChild(text('span', 'sigsheet-sign-note is-fail', '이미지 불러오기 실패'));
    }
    updateStatusLine(summary);
    if (sheetState.pendingImages === 0 && sheetState.timeoutId) {
      clearTimeout(sheetState.timeoutId);
      sheetState.timeoutId = null;
    }
  }

  function handlePrint(training) {
    if (sheetState.pendingImages > 0) return;
    if (sheetState.failedImages > 0) {
      const ok = window.confirm(
        '서명 이미지 ' + sheetState.failedImages + '건을 불러오지 못했습니다.\n' +
        '해당 칸은 "이미지 불러오기 실패"로 인쇄됩니다. 그래도 인쇄하시겠습니까?'
      );
      if (!ok) return;
    }
    // PDF로 저장할 때 파일 이름으로 쓰이도록 인쇄하는 동안만 문서 제목을 바꿉니다.
    if (sheetState.previousTitle === null) sheetState.previousTitle = document.title;
    document.title = (training.title || '연수') + '_서명부';
    window.print();
  }

  async function openSignatureSheet(training) {
    if (sheetState.opening) return;
    sheetState.opening = true;
    try {
      closeSheet(); // 이미 열려 있으면 정리
      const overlay = createOverlay(training);
      sheetState.overlay = overlay;
      document.body.appendChild(overlay);
      document.body.classList.add('sigsheet-open');
      document.addEventListener('keydown', onSheetKeydown);

      try {
        const data = await loadSheetData(training);
        // 불러오는 동안 닫혔다면 아무것도 그리지 않음
        if (sheetState.overlay !== overlay) return;
        renderSheet(training, data);
      } catch (err) {
        console.error('서명부 조회 오류:', err);
        if (sheetState.overlay !== overlay) return;
        const status = document.getElementById('sigSheetStatus');
        if (status) status.textContent = '';
        renderNotice(
          err && err.code === 'UNKNOWN_TARGET_TYPE'
            ? '이 연수의 대상 유형 값이 올바르지 않습니다. 연수 수정에서 대상 유형(교원/교직원)을 다시 저장해주세요.'
            : '서명부를 불러오지 못했습니다. 인터넷 연결을 확인한 후 다시 시도해주세요.',
          'error'
        );
      }
    } finally {
      sheetState.opening = false;
    }
  }

  window.addEventListener('afterprint', restoreTitle);

  // ---------- 연수 카드에 "서명부 출력" 버튼 추가 ----------
  // admin.js의 renderTrainingCard를 "감싸서" 원래 카드를 그대로 만든 뒤 버튼만 덧붙입니다.
  // (admin.js 코드는 수정하지 않습니다. 함수가 없으면 버튼만 나타나지 않고 다른 기능은 영향 없음)
  if (typeof window.renderTrainingCard === 'function') {
    const originalRenderTrainingCard = window.renderTrainingCard;
    window.renderTrainingCard = function (training) {
      const card = originalRenderTrainingCard.apply(this, arguments);
      try {
        const actions = card && card.querySelector('.training-card-actions');
        if (actions && !actions.querySelector('[data-action="print-sheet"]')) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.dataset.action = 'print-sheet';
          btn.textContent = '서명부 출력';
          btn.addEventListener('click', () => openSignatureSheet(training));
          const anchor = actions.querySelector('[data-action="signatures"]');
          if (anchor && anchor.nextSibling) actions.insertBefore(btn, anchor.nextSibling);
          else actions.insertBefore(btn, actions.firstChild);
        }
      } catch (err) {
        console.error('서명부 출력 버튼 추가 오류:', err);
      }
      return card;
    };
  } else {
    console.warn('admin-print.js: renderTrainingCard를 찾지 못해 "서명부 출력" 버튼을 추가하지 않았습니다.');
  }

  // 점검/테스트용 (화면 기능에는 영향 없음)
  window.__sigSheet = { openSignatureSheet, selectSheetTargets, formatSheetDate, buildSignatureImageUrl, paginateRows, rankDepartments, ROWS_PER_SIDE_FIRST, ROWS_PER_SIDE_NEXT };
})();
