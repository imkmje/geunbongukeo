# 근본국어

고2 국어 방과후 수업용 문항 분석·피드백 웹앱. 학생은 학번과 개인 코드로 로그인해 답안을 내고 자기 결과와 누적 기록을 보며, 교사는 반별 문항 분석과 학생별 피드백을 본다.

- 학생 화면: `index.html`
- 교사 화면: `teacher.html`
- 데이터: Supabase (`supabase/schema.sql`)

## 처음 설치
1. Supabase 새 프로젝트를 만들고 SQL Editor에서 `supabase/schema.sql`을 실행한다(여러 번 실행해도 안전).
2. Authentication → Users에서 교사 계정을 만들고(Auto Confirm), SQL Editor에서 다음을 실행한다.
   `insert into public.teachers(user_id) select id from auth.users where email = '교사 이메일' on conflict do nothing;`
3. Authentication 설정에서 새 가입(Allow new users to sign up)을 끈다.
4. `js/config.js`에 Project URL과 publishable(anon) 키를 넣는다. service_role/secret 키는 절대 넣지 않는다.
5. GitHub Pages를 main 브랜치 루트로 켠다.

## 보안 구조
- 모든 표에 RLS가 켜져 있다. 공개 키만으로는 어떤 표도 읽거나 쓸 수 없다.
- 교사는 `teachers` 표에 등록된 계정만 모든 표를 읽고 쓴다.
- 학생은 표를 직접 만지지 못하고 `student_*` 함수만 쓴다. 정답·해설은 자기 반에 결과가 공개된 시험만 받는다.
- 개인 코드는 bcrypt로 저장하며, 5번 틀리면 10분 잠긴다.

## 운영
- 교사 화면 → 시험 관리 → 반 관리: 반 만들기, 수강생 표 붙여넣기(학번·이름 자동 인식), 개인 코드 발급(발급 직후 한 번만 보임).
- 시험 만들기: 정답·전국 정답률·영역·지문 세트(`# 정답:`, `# 영역:`, `# 세트:` 줄), 해설(`[번호]`), 오답 선지 오류 유형을 붙여넣는다.
- 반마다 응시를 열고 닫으며, 결과도 반마다 공개한다.
- `.github/workflows/keepalive.yml`이 매일 `keepalive()` 함수를 불러 무료 프로젝트가 일시 정지되지 않게 한다.
- 교사 로그인 칸에 `@` 없이 아이디만 적으면 `js/config.js`의 `loginDomain`을 붙인다(예: `kmj` → `kmj@geunbongukeo.local`). 그 주소로 Supabase 교사 계정을 만들어 두면 된다.

`js/vendor/supabase-2.118.0.js`는 [supabase-js](https://github.com/supabase/supabase-js) (MIT) 배포본이다.

아이콘(`icons/`)의 글자는 [Black Han Sans](https://fonts.google.com/specimen/Black+Han+Sans) (SIL Open Font License 1.1) 글자 모양을 도형으로 바꾼 것이다.
