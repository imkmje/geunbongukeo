-- 근본국어 2026-11 바뀐 점만 모은 파일 (supabase/schema.sql에도 같은 내용이 들어 있다)
-- 사용법: Supabase 대시보드 → SQL Editor → 이 파일 전체를 붙여넣고 Run. 한 번 실행하면 되고, 여러 번 실행해도 안전하다.
-- 바뀌는 것
--  1. 결과를 공개하면 그 반의 응시도 닫힌다(표에서 자동으로). 이미 응시를 닫지 않고 공개한 반도 바로잡는다.
--  2. 반 관리 '잠금만 풀기': 교사가 비밀번호는 그대로 두고 잠긴 학생의 잠금만 푼다(teacher_unlock_student).
--  3. 학생 결과 화면의 반 통계(반 평균·문항 정답률 등)는 반 응시 인원이 5명보다 적으면 보내지 않는다.
--  4. 반을 숨겨도 로그인해 있던 학생 화면에 '로그인 시간이 지났습니다' 대신 '수업이 끝난 반…'이 뜬다.
-- 이 파일을 실행하기 전에도 교사·학생 화면은 그대로 쓸 수 있다('잠금만 풀기'만 안내가 뜬다).
-- 먼저 supabase/schema.sql을 한 번이라도 실행한 프로젝트에서 쓴다(retries·feedback 표와 _ox 함수가 있어야 함).

-- 반 숨기기 / 다시 보이기. 아무것도 지우지 않는다.
-- 숨겨도 로그인 세션은 지우지 않는다: 로그인해 있던 학생이 다음에 무엇을 누르면 _session_student가 'class_hidden'을 알려
-- 학생 화면에 '수업이 끝난 반…'이 뜬다(세션을 지우면 '로그인 시간이 지났습니다'로 잘못 보였다). 숨긴 반 학생은 어차피 아무 함수도 쓸 수 없다.
create or replace function public.teacher_set_class_hidden(p_class uuid, p_hidden boolean)
returns json language plpgsql volatile security definer
set search_path = public
as $$
declare n int;
begin
  if not public.is_teacher() then raise exception 'not_teacher' using errcode = '42501'; end if;
  update public.classes set hidden = p_hidden, hidden_at = case when p_hidden then now() else null end where id = p_class;
  if not found then return json_build_object('ok', false, 'error', 'not_found'); end if;
  select count(*) into n from public.students where class_id = p_class;
  return json_build_object('ok', true, 'students', n);
end $$;

-- 작은 반 통계 기준: 응시 인원(stats.n)이 이 수보다 적으면 학생 화면에 반 통계(반 평균·문항 정답률·선지 비율·영역·유형)를 주지 않는다.
-- (몇 명뿐이면 반 평균으로 다른 학생 점수를 짐작할 수 있다.) 기준을 바꾸려면 아래 숫자 하나만 고친다.
create or replace function public._class_stats_min_n()
returns int language sql immutable
as $$ select 5 $$;

-- 결과: 내 반에 공개된 시험만. p_test가 null이면 공개된 전부(누적 기록용).
--  stage 'result'(정답·해설 공개 전): 점수 계산용 ox, 반 통계(문항 정답률·영역·유형), 전국 정답률(r)만.
--     key·ex·tags·선지 비율(nat.d, stats.dist)·선생님 한마디는 null.
--  stage 'key'(정답·해설 공개 후): 위에 더해 key·ex·tags·nat·stats 전체, 다시 풀기 답, 선생님 한마디.
--  두 단계 모두: 반 응시 인원이 _class_stats_min_n()보다 적으면 stats는 null이고 stats_small은 true(그 밖에는 false).
create or replace function public.student_results(p_token uuid, p_test uuid default null)
returns json language plpgsql stable security definer
set search_path = public
as $$
declare s public.students; r record; res jsonb := '[]'::jsonb; ox text; st jsonb; small boolean;
begin
  s := public._session_student_ready(p_token);
  for r in
    select t.id, t.title, t.test_date, t.items, k.answers as key, k.nat, k.ex, k.tags, tc.stats,
           tc.key_released as kr, sub.answers, sub.submitted_at,
           rt.answers as r_answers, rt.submitted_at as r_at, fb.body as fb_body, fb.updated_at as fb_at
      from public.test_class tc
      join public.tests t on t.id = tc.test_id
      left join public.test_keys k on k.test_id = t.id
      left join public.submissions sub on sub.test_id = t.id and sub.student_id = s.id
      left join public.retries rt on rt.test_id = t.id and rt.student_id = s.id
      left join public.feedback fb on fb.test_id = t.id and fb.student_id = s.id
     where tc.class_id = s.class_id and tc.released
       and (p_test is null or t.id = p_test)
     order by t.test_date nulls last, t.created_at
  loop
    ox := public._ox(r.items, r.key, r.answers);
    small := r.stats is not null
             and coalesce(case when jsonb_typeof(r.stats->'n') = 'number' then (r.stats->>'n')::numeric end, 0) < public._class_stats_min_n();
    if r.kr then
      res := res || jsonb_build_array(jsonb_build_object(
        'id', r.id, 'title', r.title, 'test_date', r.test_date, 'items', r.items, 'stage', 'key',
        'key', r.key, 'nat', r.nat, 'ex', r.ex, 'tags', r.tags,
        'stats', case when small then null else r.stats end, 'stats_small', small,
        'answers', r.answers, 'submitted_at', r.submitted_at, 'ox', ox,
        'retry', case when r.r_answers is null then null else jsonb_build_object('answers', r.r_answers, 'submitted_at', r.r_at) end,
        'can_retry', false,
        'feedback', case when r.fb_body is null then null else jsonb_build_object('body', r.fb_body, 'updated_at', r.fb_at) end));
    else
      st := case when small then null else r.stats end;
      if st is not null then st := st - 'dist'; end if;
      res := res || jsonb_build_array(jsonb_build_object(
        'id', r.id, 'title', r.title, 'test_date', r.test_date, 'items', r.items, 'stage', 'result',
        'key', null, 'ex', null, 'tags', null, 'stats', st, 'stats_small', small,
        'nat', case when jsonb_typeof(r.nat) = 'array' then
                 (select jsonb_agg(case when jsonb_typeof(e) = 'object' then jsonb_build_object('r', e->'r') else null end order by o)
                    from jsonb_array_elements(r.nat) with ordinality x(e, o)) end,
        'answers', r.answers, 'submitted_at', r.submitted_at, 'ox', ox,
        'retry', case when r.r_answers is null then null else jsonb_build_object('answers', r.r_answers, 'submitted_at', r.r_at) end,
        'can_retry', r.answers is not null and r.r_answers is null and coalesce(ox, '') ~ '[XB]',
        'feedback', null));
    end if;
  end loop;
  return res::json;
end $$;

-- ═══ 2026-11 상태 정리: 결과 공개 = 응시 닫기 · 잠금만 풀기 · 작은 반 통계 가리기 ═══
-- (위쪽에서 바꾼 것: teacher_set_class_hidden은 숨겨도 로그인 세션을 지우지 않음, student_results는 작은 반 통계를 null로)

-- ───── 결과를 공개하면 응시도 닫는다 ─────
-- 학생은 결과 공개 뒤 더 낼 수 없으므로(student_submit: is_open and not released) 표의 is_open도 false로 맞춘다.
-- 교사 화면이 공개할 때 함께 저장하지만, 예전 화면이나 다른 경로로 공개해도 어긋나지 않게 표에서 한 번 더 지킨다.
create or replace function public._test_class_release_close()
returns trigger language plpgsql
set search_path = public
as $$
begin
  if new.released and new.is_open then
    new.is_open := false;
    new.closed_once := true;
  end if;
  return new;
end $$;
drop trigger if exists test_class_release_close on public.test_class;
create trigger test_class_release_close before insert or update on public.test_class
  for each row execute function public._test_class_release_close();
-- 이미 응시를 닫지 않고 공개한 반을 바로잡는다(맞는 줄이 없으면 아무것도 하지 않음).
update public.test_class set is_open = false, closed_once = true where released and is_open;

-- ───── 잠금만 풀기 ─────
-- 학번만 알면 다른 학생이 일부러 5번 틀려 잠글 수 있다. 교사가 비밀번호는 그대로 두고 잠금(틀린 횟수)만 푼다.
create or replace function public.teacher_unlock_student(p_student uuid)
returns json language plpgsql volatile security definer
set search_path = public
as $$
declare s public.students;
begin
  if not public.is_teacher() then raise exception 'not_teacher' using errcode = '42501'; end if;
  update public.students set fail_count = 0, locked_until = null where id = p_student returning * into s;
  if not found then return json_build_object('ok', false, 'error', 'not_found'); end if;
  return json_build_object('ok', true, 'sid', s.sid, 'name', s.name);
end $$;

-- ───── 실행 권한 ─────
revoke execute on function public._test_class_release_close() from public, anon, authenticated;
revoke execute on function public._class_stats_min_n() from public, anon, authenticated;
revoke execute on function public.teacher_unlock_student(uuid) from public, anon, authenticated;
grant execute on function public.teacher_unlock_student(uuid) to authenticated;
grant execute on function public.teacher_set_class_hidden(uuid, boolean) to authenticated;
grant execute on function public.student_results(uuid, uuid) to anon, authenticated;
-- _test_class_release_close, _class_stats_min_n은 아무에게도 주지 않는다(안에서만 쓰임).
