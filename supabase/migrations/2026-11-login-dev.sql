-- 근본국어 2026-11 바뀐 점만: 학생 로그인 기기 번호 받는 자리(student_login_dev). supabase/schema.sql에도 같은 내용이 있다.
-- 사용법: Supabase 대시보드 → SQL Editor → 이 파일 전체를 붙여넣고 Run. 여러 번 실행해도 안전하다. 언제 실행해도 된다.
-- 바뀌는 것: 없다(잠금 규칙은 그대로 5번 틀리면 10분). 학생 화면이 로그인할 때 보내는 기기 번호를 받을 자리만 만든다.
--  * 이 함수는 기기 번호를 쓰지도 저장하지도 않고 예전 student_login을 그대로 부른다.
--  * 잠금 방식 선택안 D(optional-lockout-d-device.sql)를 고르면 이 함수가 '로그인했던 기기 기억'으로 바뀐다.
--    이 파일(또는 schema.sql)을 다시 실행하면 기본으로 돌아간다.
--  * 이 파일을 실행하지 않아도 학생 화면은 예전 student_login으로 로그인한다(요청이 한 번 더 갈 뿐).
-- 먼저 supabase/schema.sql을 한 번이라도 실행한 프로젝트에서 쓴다(student_login이 있어야 함).

create or replace function public.student_login_dev(p_sid text, p_password text, p_device text default null)
returns json language sql volatile
set search_path = public
as $$ select public.student_login(p_sid, p_password) $$;
revoke execute on function public.student_login_dev(text, text, text) from public, anon, authenticated;
grant execute on function public.student_login_dev(text, text, text) to anon, authenticated;
