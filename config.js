// ============================================================
//  Supabase 프로젝트 설정
//  아래 두 값은 Supabase 대시보드 → Project Settings → API 에서
//  가져온 이 프로젝트의 실제 연결값입니다.
//
//  SUPABASE_URL             : Project URL
//  SUPABASE_PUBLISHABLE_KEY : anon / publishable key
//                             (브라우저에 노출되어도 되는 "공개" 키입니다)
//
//  ★ 절대로 secret key(service_role key)는 여기에 넣지 마세요.
//    secret key는 브라우저 코드에 들어가는 순간 전 세계에 공개된
//    것과 같습니다.
// ============================================================
const SUPABASE_URL = 'https://ddzvfgxyahiefxudopox.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_sG8Vgsf5QLHZHQzlRseC4Q_t7-E8CQg';

// ============================================================
//  Google Apps Script 웹 앱 URL
//  ⚠️ 아직 이 프로젝트용 Apps Script가 배포되지 않았습니다
//     (Phase 11에서 실제 코드와 함께 안내드릴 예정입니다).
//     지금은 빈 문자열로 두면, 서명 이미지 업로드 없이
//     서명 기록만 저장되는 개발용 모드로 동작합니다.
// ============================================================
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwHMAdYp3KCI-nkmHcBLfl9gB_AL6SXDm31LcWYjInKigM8jFFLwyTe3bgO8wLqEaM_1g/exec';
