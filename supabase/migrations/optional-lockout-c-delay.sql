-- 근본국어 (선택) 로그인 잠금 방식 C: 잠그지 않고 기다리게 하기 — 틀릴 때마다 서버가 조금씩 더 오래 기다렸다가 답한다
-- 고를지 말지는 선생님이 정한다. 고르면 Supabase SQL Editor에서 이 파일만 실행한다(여러 번 실행해도 안전).
-- A·B·C 중 하나만 실행한다(마지막에 실행한 것이 남음). D(기기 기억)는 이것과 함께 쓸 수 있다.
-- 되돌리려면 supabase/schema.sql을 다시 실행한다(5번 틀리면 10분 잠금으로 돌아감).
-- 되돌릴 때는 그 뒤에 `update public.students set fail_count = 0;`도 실행한다(이 방식에서 쌓인 틀린 횟수가 5 이상이면
-- 기본 규칙에서 한 번만 더 틀려도 바로 잠기므로).
--
-- 규칙
--  * 학번은 잠기지 않는다. 비밀번호가 맞으면 언제든 바로 들어간다(앞에서 몇 번 틀렸든 기다리지 않음).
--  * 틀리면 그 학번의 연속으로 틀린 횟수만큼 서버가 기다렸다가 '틀렸다'고 답한다: 0.4초 → 0.8초 → 1.2초 → 1.6초 → 2초(최대).
--  * 맞히면 횟수가 0으로 돌아간다. 이 파일을 실행하는 순간 걸려 있던 잠금은 모두 풀린다.
--
-- 좋은 점
--  * 장난으로 학번을 잠글 수 없다. 2026-11 시험처럼 스크립트가 한 반을 7초 만에 잠가도, 진짜 학생은 맞는 비밀번호로 바로 들어간다.
--  * 교사가 '잠금만 풀기'를 누를 일이 없다. 학생 화면 문구도 바뀌지 않는다('학번 또는 비밀번호가 맞지 않습니다').
-- 아쉬운 점(중요)
--  * 비밀번호 맞혀 보기를 거의 막지 못한다. 기다림은 '한 요청'을 느리게 할 뿐이라, 스크립트가 요청을 동시에 여러 개 보내면
--    그만큼 빨라진다. 한 학생에게 동시에 15개씩 보내면 1초에 7~8번, 하루 수십만 번 맞혀 볼 수 있다
--    (지금 10분 잠금은 한 학생에 하루 약 720번). '123456'·생일 같은 쉬운 비밀번호는 몇 분 안에 뚫릴 수 있다.
--  * 기다리는 동안 데이터베이스 연결 하나를 붙잡고 있다(pg_sleep). Supabase 무료(Nano) 프로젝트는 API가 쓰는 연결 묶음이
--    십여 개뿐이라, 누가 틀린 요청을 동시에 수십 개씩 계속 보내면 연결이 모자라 모든 학생·교사 화면이 느려지거나
--    '연결 시간 초과'가 난다(사이트가 멈춘 것처럼 보임). 그래서 최대 기다림을 3초가 아니라 2초로 묶었다.
--    지금 10분 잠금은 잠긴 학번에 대한 요청을 비밀번호 확인도 기다림도 없이 바로 돌려보내므로 이런 부담이 적다.
--  * 수업 시작 때 224명이 한꺼번에 로그인하는 정도는 괜찮다: 오타로 한두 번 틀린 학생이 30명이어도
--    붙잡히는 연결 시간이 1분 동안 모두 합쳐 수십 초라, 평균으로는 연결 한두 개 몫이다.
--  * 최대 기다림을 바꾸려면 아래 least(..., 2.0)의 2.0을 고친다(3초 이상은 권하지 않는다).

create or replace function public.student_login(p_sid text, p_password text)
returns json language plpgsql volatile security definer
set search_path = public, extensions
as $$
declare s public.students; tok uuid; n int;
begin
  select * into s from public.students where sid = trim(p_sid);
  if not found or s.code_hash is null then
    perform pg_sleep(0.4);
    return json_build_object('ok', false, 'error', 'wrong');
  end if;
  -- 잠금은 보지 않는다(이 방식에는 잠금이 없다).
  if s.code_hash = crypt(trim(p_password), s.code_hash) then
    update public.students set fail_count = 0, locked_until = null where id = s.id;
    if exists (select 1 from public.classes c where c.id = s.class_id and c.hidden) then
      return json_build_object('ok', false, 'error', 'class_hidden');
    end if;
    delete from public.student_sessions where expires_at < now();
    insert into public.student_sessions(student_id) values (s.id) returning token into tok;
    return json_build_object('ok', true, 'token', tok, 'sid', s.sid, 'name', s.name, 'must_change', s.must_change_pw);
  end if;
  update public.students set fail_count = least(fail_count + 1, 1000), locked_until = null
   where id = s.id returning fail_count into n;
  perform pg_sleep(least(0.4 * n, 2.0));   -- ← 최대 기다림(초)
  return json_build_object('ok', false, 'error', 'wrong');
end $$;
revoke execute on function public.student_login(text, text) from public;
grant execute on function public.student_login(text, text) to anon, authenticated;

-- 이 방식에는 잠금이 없으므로 걸려 있던 잠금을 푼다(틀린 횟수는 기다림 계산에 쓰이므로 그대로 둔다).
update public.students set locked_until = null where locked_until is not null;
