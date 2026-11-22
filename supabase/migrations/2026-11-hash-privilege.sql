-- 근본국어 2026-11 바뀐 점만: 교사 로그인으로도 학생 비밀번호 해시(students.code_hash)를 읽지 못하게. supabase/schema.sql에도 같은 내용이 있다.
-- 사용법: Supabase 대시보드 → SQL Editor → 이 파일 전체를 붙여넣고 Run. 여러 번 실행해도 안전하다.
--
-- ★ 순서가 중요하다: 교사 화면(js) 새 버전을 먼저 GitHub Pages에 올리고, 교사 화면이 새 버전으로 열리는 것을 확인한 뒤에 실행한다.
--   예전 교사 화면은 학생 표를 select('*')로 읽으므로, 이 파일을 먼저 실행하면 교사 화면이 '권한 없음'으로 열리지 않는다.
--   (그렇게 되면 아래 '되돌리기' 두 줄을 실행하면 바로 돌아온다.)
--
-- 바뀌는 것
--  * RLS는 '어떤 줄'을 볼지 정할 뿐 '어떤 칸'은 막지 못해서, 교사 화면이 학생 표를 통째로 읽으면 비밀번호 해시가
--    교사 브라우저까지 내려왔다. 이제 칸마다 권한을 준다.
--  * 교사(authenticated) 읽기: id, sid, name, class_id, must_change_pw, fail_count, locked_until, created_at — code_hash는 못 읽는다.
--  * 교사 새로 넣기·고치기: sid, name, class_id만(명단 붙여넣기 upsert, 반 옮기기·빼기). 비밀번호·잠금은 teacher_* 함수로만 바꾼다.
--  * 교사 지우기: 그대로(RLS로 교사만).
--  * 공개 키(anon): 학생 표의 어떤 칸도 못 읽고 못 쓴다(원래도 RLS로 막혀 있었다).
--  * 학생 함수(student_*)·교사 함수(teacher_*: 비밀번호 초기화, 잠금만 풀기, 반 숨기기, 개인정보 정리)는 소유자 권한으로 돌아 그대로 된다.
--  * 표 전체 권한을 거두면 칸 권한도 함께 거둬지므로, 여러 번 실행해도 결과가 같다.
--
-- 되돌리기(예전처럼 교사가 학생 표 전체를 읽게): 아래 두 줄을 SQL Editor에서 실행한다(공개 키는 RLS가 막으므로 다시 주지 않는다).
--   revoke all on table public.students from anon, authenticated;
--   grant select, insert, update, delete on table public.students to authenticated;

revoke all on table public.students from anon, authenticated;
grant select (id, sid, name, class_id, must_change_pw, fail_count, locked_until, created_at) on public.students to authenticated;
grant insert (sid, name, class_id) on public.students to authenticated;
grant update (sid, name, class_id) on public.students to authenticated;
grant delete on public.students to authenticated;
