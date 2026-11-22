-- 근본국어 (선택) 로그인 잠금 방식 A: 짧은 고정 잠금 — 5번 틀리면 3분 잠금 (지금은 10분)
-- 고를지 말지는 선생님이 정한다. 고르면 Supabase SQL Editor에서 이 파일만 실행한다(여러 번 실행해도 안전).
-- 되돌리려면 supabase/schema.sql을 다시 실행한다(10분 잠금으로 돌아감). A·B 중 하나만 실행한다(마지막에 실행한 것이 남음).
--
-- 좋은 점: 친구가 학번만 알고 일부러 틀려 잠가도 3분이면 풀린다. 바뀌는 것이 숫자 하나뿐이다.
-- 아쉬운 점: 비밀번호를 맞혀 보려는 사람에게도 더 빨리 기회가 돌아온다(하루 최대 약 2,400번 → 10분일 때의 3배 남짓).
--           학생 비밀번호가 '123456'처럼 쉬우면 어느 방식이든 뚫릴 수 있으므로, 쉬운 비밀번호를 막는 편이 더 효과가 크다.
-- 학생 화면의 '10분 동안 잠겼습니다' 문구: 서버가 잠금 해제 시각(until)을 함께 주므로 학생 화면이 그 시각을 보여 주면 맞다
-- (js/logic.js loginErrorMsg(code, until)).

create or replace function public.student_login(p_sid text, p_password text)
returns json language plpgsql volatile security definer
set search_path = public, extensions
as $$
declare s public.students; tok uuid;
begin
  select * into s from public.students where sid = trim(p_sid);
  if not found or s.code_hash is null then
    perform pg_sleep(0.4);
    return json_build_object('ok', false, 'error', 'wrong');
  end if;
  if s.locked_until is not null and s.locked_until > now() then
    return json_build_object('ok', false, 'error', 'locked', 'until', s.locked_until);
  end if;
  if s.code_hash = crypt(trim(p_password), s.code_hash) then
    update public.students set fail_count = 0, locked_until = null where id = s.id;
    if exists (select 1 from public.classes c where c.id = s.class_id and c.hidden) then
      return json_build_object('ok', false, 'error', 'class_hidden');
    end if;
    delete from public.student_sessions where expires_at < now();
    insert into public.student_sessions(student_id) values (s.id) returning token into tok;
    return json_build_object('ok', true, 'token', tok, 'sid', s.sid, 'name', s.name, 'must_change', s.must_change_pw);
  end if;
  update public.students
     set fail_count   = case when fail_count + 1 >= 5 then 0 else fail_count + 1 end,
         locked_until = case when fail_count + 1 >= 5 then now() + interval '3 minutes' else null end   -- ← 잠금 시간
   where id = s.id;
  perform pg_sleep(0.4);
  return json_build_object('ok', false, 'error', 'wrong');
end $$;
grant execute on function public.student_login(text, text) to anon, authenticated;
