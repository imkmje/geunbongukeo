// Supabase 연결 정보. 둘 다 공개되도록 만든 값이다(데이터는 접근 규칙으로 보호된다).
// service_role / secret 키는 절대 여기에 넣지 않는다.
window.GB_CONFIG = {
  url: 'https://jvmpkcvxjsbmdhetooqe.supabase.co',
  key: 'sb_publishable_NRLhgnWY6QTwNNI7ZjVE6w_1q4MpbH-',
  // 교사 로그인 칸에 @ 없이 아이디만 적으면 이 주소를 붙인다(예: kmj → kmj@geunbongukeo.local).
  loginDomain: 'geunbongukeo.local'
};
