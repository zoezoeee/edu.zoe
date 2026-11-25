// ============================================================
//  연수 전자서명 시스템 — 기관설정 화면 (관리자)
//   · 기관명(organizations.name), 부제목(notice_text), 안내문(banner_text),
//     대표 색상(brand_color)을 수정합니다.
//   · 글자 크기는 고정이며(style.css), 내용만 바꿉니다.
//   · 내 학교(currentAdmin.orgId)의 organizations 행만 수정합니다.
//     (RLS: "관리자는 자기 학교 정보만 수정" 정책이 서버에서 한 번 더 막습니다)
//   · admin.js 다음에 불러와야 합니다. 기존 함수는 수정하지 않습니다.
// ============================================================
(function () {
  'use strict';

  const LIMITS = { name: 30, subtitle: 40, banner: 60 };
  const DEFAULT_COLOR = '#2A4B8D';
  const SWATCHES = [
    '#2A4B8D', '#003A9B', '#1E6F5C', '#2F7D32',
    '#6A3FA0', '#B3361E', '#8A5A00', '#37474F',
  ];

  const $ = (id) => document.getElementById(id);
  const ui = {
    grid: $('adminMenuGrid'),
    backBtn: $('orgSettingsBackBtn'),
    form: $('orgSettingsForm'),
    name: $('orgSettingName'),
    subtitle: $('orgSettingSubtitle'),
    banner: $('orgSettingBanner'),
    color: $('orgSettingColor'),
    colorCode: $('orgColorCode'),
    swatches: $('orgColorSwatches'),
    nameCount: $('orgNameCount'),
    subtitleCount: $('orgSubtitleCount'),
    bannerCount: $('orgBannerCount'),
    preview: $('orgPreview'),
    pvName: $('orgPreviewName'),
    pvSubtitle: $('orgPreviewSubtitle'),
    pvBanner: $('orgPreviewBanner'),
    error: $('orgSettingsError'),
    success: $('orgSettingsSuccess'),
    saveBtn: $('orgSettingsSaveBtn'),
  };
  if (!ui.form || !ui.grid) return;   // 화면이 없으면 아무것도 하지 않음

  let hasBannerColumn = true;   // 22_org_settings.sql 실행 전이면 false
  let saving = false;

  const isHexColor = (v) => /^#[0-9a-fA-F]{6}$/.test(v || '');

  function showError(msg) {
    ui.success.hidden = true;
    ui.error.textContent = msg;
    ui.error.hidden = !msg;
  }
  function showSuccess(msg) {
    ui.error.hidden = true;
    ui.success.textContent = msg;
    ui.success.hidden = !msg;
  }

  // 밝은 색은 흰 글씨가 잘 안 보이므로 안내만 합니다(저장은 막지 않음).
  function isLightColor(hex) {
    const n = parseInt(hex.slice(1), 16);
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.62;
  }

  function renderSwatches() {
    ui.swatches.innerHTML = '';
    SWATCHES.forEach((c) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'org-swatch';
      b.style.background = c;
      b.setAttribute('aria-label', '대표 색상 ' + c);
      b.dataset.color = c;
      ui.swatches.appendChild(b);
    });
  }

  function updatePreview() {
    const nameV = ui.name.value.trim();
    const subV = ui.subtitle.value.trim();
    const banV = ui.banner.value.trim();
    const color = isHexColor(ui.color.value) ? ui.color.value : DEFAULT_COLOR;

    ui.pvName.textContent = nameV || '(기관명)';
    ui.pvSubtitle.textContent = subV;           // 비우면 :empty 규칙으로 줄이 사라짐
    ui.pvBanner.textContent = banV;
    ui.pvBanner.hidden = !banV;
    ui.preview.style.setProperty('--brand-color', color);
    ui.colorCode.textContent = color.toUpperCase();

    ui.nameCount.textContent = ui.name.value.length + '/' + LIMITS.name;
    ui.subtitleCount.textContent = ui.subtitle.value.length + '/' + LIMITS.subtitle;
    ui.bannerCount.textContent = ui.banner.value.length + '/' + LIMITS.banner;

    if (isLightColor(color)) {
      ui.colorCode.dataset.warn = '밝은 색은 흰 글씨가 잘 안 보일 수 있어요';
    } else {
      delete ui.colorCode.dataset.warn;
    }
    ui.swatches.querySelectorAll('.org-swatch').forEach((b) => {
      b.classList.toggle('is-active', b.dataset.color.toLowerCase() === color.toLowerCase());
    });
  }

  async function loadSettings() {
    showError('');
    showSuccess('');
    ui.saveBtn.disabled = true;

    let res = await supabaseClient
      .from('organizations')
      .select('name, notice_text, brand_color, banner_text')
      .eq('id', currentAdmin.orgId)
      .maybeSingle();

    if (res.error) {
      // banner_text 컬럼이 아직 없는 경우(22번 SQL 미실행) → 나머지 항목만이라도 편집 가능하게 함
      hasBannerColumn = false;
      res = await supabaseClient
        .from('organizations')
        .select('name, notice_text, brand_color')
        .eq('id', currentAdmin.orgId)
        .maybeSingle();
    } else {
      hasBannerColumn = true;
    }

    if (res.error || !res.data) {
      console.error(res.error);
      showError('기관 정보를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.');
      return;
    }

    const d = res.data;
    ui.name.value = d.name || '';
    ui.subtitle.value = d.notice_text || '';
    ui.banner.value = hasBannerColumn ? (d.banner_text || '') : '';
    ui.banner.disabled = !hasBannerColumn;
    ui.color.value = isHexColor(d.brand_color) ? d.brand_color : DEFAULT_COLOR;
    updatePreview();

    if (!hasBannerColumn) {
      showError('안내문 기능을 쓰려면 먼저 22_org_settings.sql을 Supabase에서 실행해야 합니다. (기관명·부제목·색상은 지금도 저장할 수 있습니다.)');
    }
    ui.saveBtn.disabled = false;
  }

  function openScreen() {
    showOnly(el.orgSettingsScreen);
    loadSettings();
  }

  ui.grid.addEventListener('click', (e) => {
    const card = e.target.closest('.admin-menu-card');
    if (card && card.dataset.menuKey === 'org-settings') openScreen();
  });
  ui.backBtn.addEventListener('click', () => showOnly(el.homeScreen));

  [ui.name, ui.subtitle, ui.banner, ui.color].forEach((i) => {
    i.addEventListener('input', () => { showSuccess(''); updatePreview(); });
  });
  ui.swatches.addEventListener('click', (e) => {
    const b = e.target.closest('.org-swatch');
    if (!b) return;
    ui.color.value = b.dataset.color;
    showSuccess('');
    updatePreview();
  });

  ui.form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (saving) return;

    const nameV = ui.name.value.trim();
    const subV = ui.subtitle.value.trim();
    const banV = ui.banner.value.trim();
    const color = ui.color.value;

    if (!nameV) return showError('기관명을 입력해주세요.');
    if (nameV.length > LIMITS.name) return showError('기관명은 ' + LIMITS.name + '자 이내로 입력해주세요.');
    if (subV.length > LIMITS.subtitle) return showError('부제목은 ' + LIMITS.subtitle + '자 이내로 입력해주세요.');
    if (banV.length > LIMITS.banner) return showError('안내문은 ' + LIMITS.banner + '자 이내로 입력해주세요.');
    if (!isHexColor(color)) return showError('대표 색상 형식이 올바르지 않습니다.');
    if (!currentAdmin.orgId) return showError('소속 학교 정보를 확인할 수 없습니다. 다시 로그인해주세요.');

    const patch = { name: nameV, notice_text: subV || null, brand_color: color };
    if (hasBannerColumn) patch.banner_text = banV || null;

    saving = true;
    ui.saveBtn.disabled = true;
    ui.saveBtn.textContent = '저장 중…';
    showError('');
    showSuccess('');

    try {
      const { data, error } = await supabaseClient
        .from('organizations')
        .update(patch)
        .eq('id', currentAdmin.orgId)
        .select('id');

      if (error) throw error;
      if (!data || data.length === 0) {
        showError('저장되지 않았습니다. 수정 권한이 없는 계정일 수 있습니다.');
        return;
      }

      // 화면에 이미 표시된 값도 같이 갱신
      currentAdmin.orgName = nameV;
      if (el.adminOrgName) el.adminOrgName.textContent = nameV;
      if (el.adminOrgNameInline) el.adminOrgNameInline.textContent = nameV;
      document.documentElement.style.setProperty('--brand-color', color);

      showSuccess('저장했습니다. 구성원 서명 화면을 새로고침하면 바뀐 내용이 보입니다.');
    } catch (err) {
      console.error(err);
      showError('저장하지 못했습니다. 인터넷 연결을 확인한 후 다시 시도해주세요.');
    } finally {
      saving = false;
      ui.saveBtn.disabled = false;
      ui.saveBtn.textContent = '저장하기';
    }
  });

  renderSwatches();
})();
