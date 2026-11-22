# 근본국어

고2 국어 방과후 수업용 문항 분석·피드백 웹앱. 학생은 학번과 비밀번호로 로그인해 답안을 내고 자기 결과와 누적 기록을 보며, 교사는 반별 문항 분석과 학생별 피드백을 본다.

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
- 학생 비밀번호는 bcrypt로 저장하며, 5번 틀리면 10분 잠긴다. 처음(또는 교사가 초기화한 뒤) 비밀번호는 학번이고, 그 상태로 로그인하면 새 비밀번호(6자 이상, 학번과 다르게)를 정하기 전에는 시험 목록·제출·결과를 볼 수 없다.
- 학번은 친구도 알 수 있으므로, 학생이 비밀번호를 바꾸기 전에 다른 학생이 먼저 들어갈 수 있다. 첫 로그인 즉시 바꾸게 하고, 이상하면 교사가 초기화한다(초기화하면 그 학생의 로그인도 모두 끊긴다).

## 운영
- 교사 화면 → 반 관리 탭: 반 고르기 → 반 요약(학생 수, 비밀번호 상태: 아직 학번 그대로/직접 정함/잠김) → 학생 표(찾기, 비밀번호 초기화, 다른 반으로 옮기기, 반에서 빼기). 명단 붙여넣기는 저장 전에 새로 추가/옮김/이름 바뀜/그대로/고칠 줄(줄 번호)을 미리 보여 준다.
- 반 숨기기: 수업이 끝난 반을 숨기면 그 반 학생은 로그인할 수 없고 응시도 열 수 없지만, 학생·답안·결과 기록은 그대로 남는다. '숨긴 반 보기'를 켜면 분석·누적 추이에 다시 포함되고, '다시 보이기'로 되돌린다. 반이 없는 학생은 예전처럼 로그인은 되지만 볼 시험이 없다.
- 시험 만들기: 정답·전국 정답률·영역·지문 세트(`# 정답:`, `# 영역:`, `# 세트:` 줄), 해설(`[번호]`), 오답 선지 오류 유형을 붙여넣는다.
- 차시 파일 두 개: `NN차시_사이트등록_통계.txt`는 시험 편집의 '전국 정답률' 칸에, `NN차시_사이트등록_해설.txt`는 '해설' 칸에 통째로 붙여넣는다. `# 정답:` 줄의 개수에 맞춰 문항 수가 자동으로 맞춰진다.
- 테스트: `node --test tests/*.test.js` (실제 차시 파일은 저장소 밖 `../winter-edit` 또는 `GB_SAMPLES` 폴더가 있을 때만 확인).
- 반마다 응시를 열고 닫으며, 결과도 반마다 공개한다.
- `.github/workflows/keepalive.yml`이 매일 `keepalive()` 함수를 불러 무료 프로젝트가 일시 정지되지 않게 한다.
- 교사 로그인 칸에 `@` 없이 아이디만 적으면 `js/config.js`의 `loginDomain`을 붙인다(예: `kmj` → `kmj@geunbongukeo.local`). 그 주소로 Supabase 교사 계정을 만들어 두면 된다.

`js/vendor/supabase-2.118.0.js`는 [supabase-js](https://github.com/supabase/supabase-js) (MIT) 배포본이다.

아이콘(`icons/`)의 글자는 [Black Han Sans](https://fonts.google.com/specimen/Black+Han+Sans) (SIL Open Font License 1.1) 글자 모양을 도형으로 바꾼 것이다.
