-- 근본국어 (geunbongukeo) 데이터베이스 구조
-- 사용법: Supabase 대시보드 → SQL Editor → 이 파일 전체를 붙여넣고 Run.
-- 여러 번 실행해도 안전하도록 작성했다(이미 있는 것은 건너뛰거나 다시 만든다).
--
-- 원칙
--  * 모든 표에 RLS를 켠다. 공개 키(anon)만으로는 어떤 표도 직접 읽거나 쓸 수 없다.
--  * 교사: teachers 표에 등록된 로그인 계정만 모든 표를 읽고 쓴다.
--  * 학생: 표를 직접 만지지 못하고, 아래 student_* 함수만 부를 수 있다.
--  * 학생 비밀번호: 처음(또는 교사가 초기화한 뒤)에는 학번과 같다. 그 상태로 로그인하면
--    새 비밀번호(6자 이상, 학번과 다름)를 정하기 전에는 시험 목록·제출·결과 함수가 모두 거절된다.

create extension if not exists pgcrypto with schema extensions;

-- ───────────────────────── 표 ─────────────────────────
create table if not exists public.teachers (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.classes (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique check (length(trim(name)) between 1 and 40),
  created_at timestamptz not null default now()
);

create table if not exists public.students (
  id           uuid primary key default gen_random_uuid(),
  sid          text not null unique check (sid ~ '^[0-9]{5}$'),   -- 학번 5자리
  name         text not null check (length(trim(name)) between 1 and 30),
  class_id     uuid references public.classes(id) on delete set null,
  code_hash    text,                                               -- 비밀번호(bcrypt). 이름은 예전 '개인 코드' 때 그대로
  must_change_pw boolean not null default true,                    -- true면 로그인 직후 새 비밀번호를 정해야 함
  fail_count   int  not null default 0,
  locked_until timestamptz,
  created_at   timestamptz not null default now()
);

create table if not exists public.tests (
  id         uuid primary key default gen_random_uuid(),
  title      text not null check (length(trim(title)) between 1 and 100),
  test_date  date,
  items      jsonb not null default '[]'::jsonb,  -- [{no, area, type, pts, set}]
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.test_keys (
  test_id    uuid primary key references public.tests(id) on delete cascade,
  answers    text  not null default '',  -- 문항 순서대로 '1'~'5' ('0' = 미입력)
  nat        jsonb,                      -- 전국 정답률·선지 비율 [{r, d:[5]}|null]
  ex         jsonb,                      -- 해설 [text|null]
  tags       jsonb,                      -- 오답 선지 오류 유형 [{"2":"과잉 추론"}|null]
  updated_at timestamptz not null default now()
);

create table if not exists public.test_class (
  test_id     uuid not null references public.tests(id) on delete cascade,
  class_id    uuid not null references public.classes(id) on delete cascade,
  is_open     boolean not null default false,
  closed_once boolean not null default false,
  released    boolean not null default false,
  released_at timestamptz,
  stats       jsonb,                     -- 공개 시점의 반 통계(교사 화면에서 계산해 저장)
  primary key (test_id, class_id)
);

create table if not exists public.submissions (
  id           uuid primary key default gen_random_uuid(),
  test_id      uuid not null references public.tests(id) on delete cascade,
  student_id   uuid not null references public.students(id) on delete cascade,
  answers      text not null check (answers ~ '^[0-5]*$'),
  src          text not null default 'student' check (src in ('student','teacher')),
  submitted_at timestamptz not null default now(),
  unique (test_id, student_id)
);

create table if not exists public.student_sessions (
  token      uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  expires_at timestamptz not null default now() + interval '12 hours'
);

-- 예전 버전에서 만든 표에 새 칸 추가
alter table public.students add column if not exists must_change_pw boolean not null default true;
-- 반 숨기기: 수업이 끝난 반. 숨긴 반 학생은 로그인할 수 없지만 학생·답안·결과 기록은 그대로 남는다.
alter table public.classes add column if not exists hidden boolean not null default false;
alter table public.classes add column if not exists hidden_at timestamptz;

create index if not exists submissions_student_idx on public.submissions(student_id);
create index if not exists students_class_idx on public.students(class_id);

-- ───────────────────────── 학생 비밀번호: 기본값과 한 번만 하는 옮기기 ─────────────────────────
-- 새로 들어온 학생(명단 붙여넣기)은 비밀번호 = 학번, 첫 로그인 때 바꾸게 한다.
create or replace function public._students_default_pw()
returns trigger language plpgsql security definer
set search_path = public, extensions
as $$
begin
  if new.code_hash is null then
    new.code_hash := crypt(new.sid, gen_salt('bf', 8));
    new.must_change_pw := true;
  end if;
  return new;
end $$;
drop trigger if exists students_default_pw on public.students;
create trigger students_default_pw before insert on public.students
  for each row execute function public._students_default_pw();

-- 이미 실행한 옮기기를 기록하는 표(교사·학생 모두 직접 못 읽음)
create table if not exists public.schema_migrations (
  name   text primary key,
  run_at timestamptz not null default now()
);
alter table public.schema_migrations enable row level security;

-- 개인 코드 → 비밀번호 옮기기: 이 파일을 처음 다시 실행할 때 딱 한 번만,
-- 기존 학생 모두의 비밀번호를 학번으로 바꾸고 첫 로그인 때 새로 정하게 한다. 로그인 중인 학생은 모두 로그아웃된다.
-- (두 번째 실행부터는 건너뛰므로, 학생이 바꾼 비밀번호가 다시 학번으로 돌아가지 않는다.)
do $$
begin
  if not exists (select 1 from public.schema_migrations where name = 'student_pw_v1') then
    update public.students
       set code_hash = extensions.crypt(sid, extensions.gen_salt('bf', 8)),
           must_change_pw = true, fail_count = 0, locked_until = null;
    delete from public.student_sessions;
    insert into public.schema_migrations(name) values ('student_pw_v1');
  end if;
end $$;

-- 예전 개인 코드 발급 함수는 더 쓰지 않는다.
drop function if exists public.teacher_issue_codes(uuid, uuid, boolean);

-- ───────────────────────── 교사 판별 ─────────────────────────
create or replace function public.is_teacher()
returns boolean language sql stable security definer
set search_path = public
as $$ select exists (select 1 from public.teachers where user_id = auth.uid()) $$;

-- ───────────────────────── 사이트 설정(제목 등) ─────────────────────────
-- 누구나 읽을 수 있는 공개 정보. 교사만 고칠 수 있다.
create table if not exists public.site_settings (
  id               int primary key default 1 check (id = 1),
  title            text not null default '근본국어' check (length(trim(title)) between 1 and 40),
  student_subtitle text not null default '고2 국어 · 내 답안과 결과' check (length(student_subtitle) <= 60),
  teacher_subtitle text not null default '교사 · 문항 분석' check (length(teacher_subtitle) <= 60),
  updated_at       timestamptz not null default now()
);
insert into public.site_settings(id) values (1) on conflict do nothing;
alter table public.site_settings enable row level security;
drop policy if exists public_read on public.site_settings;
create policy public_read on public.site_settings for select to anon, authenticated using (true);
drop policy if exists teacher_write on public.site_settings;
create policy teacher_write on public.site_settings for update to authenticated using (public.is_teacher()) with check (public.is_teacher());

-- ───────────────────────── 접근 규칙(RLS) ─────────────────────────
do $$
declare t text;
begin
  foreach t in array array['teachers','classes','students','tests','test_keys','test_class','submissions','student_sessions'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists teacher_all on public.%I', t);
  end loop;
  -- 교사는 student_sessions를 제외한 모든 표를 읽고 쓴다.
  foreach t in array array['classes','students','tests','test_keys','test_class','submissions'] loop
    execute format('create policy teacher_all on public.%I for all to authenticated using (public.is_teacher()) with check (public.is_teacher())', t);
  end loop;
end $$;
-- teachers 표: 교사는 목록을 읽을 수만 있다(등록은 SQL Editor에서만).
create policy teacher_all on public.teachers for select to authenticated using (public.is_teacher());
-- student_sessions: 정책 없음 = 누구도 직접 못 읽음(함수만 사용).

-- ───────────────────────── 학생용 함수 ─────────────────────────
-- 세션 토큰 → 학생. 잘못되거나 만료되면 오류.
create or replace function public._session_student(p_token uuid)
returns public.students language plpgsql stable security definer
set search_path = public
as $$
declare s public.students;
begin
  select st.* into s from public.student_sessions ss join public.students st on st.id = ss.student_id
   where ss.token = p_token and ss.expires_at > now();
  if not found then raise exception 'invalid_session' using errcode = '28000'; end if;
  -- 숨긴 반 학생은 이미 로그인해 있어도 더 쓸 수 없다(반이 없는 학생은 예전처럼 로그인은 된다).
  if exists (select 1 from public.classes c where c.id = s.class_id and c.hidden) then
    raise exception 'class_hidden' using errcode = '28000';
  end if;
  return s;
end $$;

-- 위와 같지만, 비밀번호를 아직 바꾸지 않았으면 거절한다(시험 목록·제출·결과용).
create or replace function public._session_student_ready(p_token uuid)
returns public.students language plpgsql stable security definer
set search_path = public
as $$
declare s public.students;
begin
  s := public._session_student(p_token);
  if s.must_change_pw then raise exception 'must_change_password' using errcode = '28000'; end if;
  return s;
end $$;

-- 로그인: 학번 + 비밀번호. 5번 틀리면 10분 잠금. must_change가 true면 학생 화면이 비밀번호 바꾸기부터 보여 준다.
drop function if exists public.student_login(text, text);
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
    -- 비밀번호가 맞아도 숨긴 반 학생이면 들어가지 못한다(비밀번호를 맞힌 뒤에만 알려 준다).
    if exists (select 1 from public.classes c where c.id = s.class_id and c.hidden) then
      return json_build_object('ok', false, 'error', 'class_hidden');
    end if;
    delete from public.student_sessions where expires_at < now();
    insert into public.student_sessions(student_id) values (s.id) returning token into tok;
    return json_build_object('ok', true, 'token', tok, 'sid', s.sid, 'name', s.name, 'must_change', s.must_change_pw);
  end if;
  update public.students
     set fail_count   = case when fail_count + 1 >= 5 then 0 else fail_count + 1 end,
         locked_until = case when fail_count + 1 >= 5 then now() + interval '10 minutes' else null end
   where id = s.id;
  perform pg_sleep(0.4);
  return json_build_object('ok', false, 'error', 'wrong');
end $$;

create or replace function public.student_logout(p_token uuid)
returns void language sql volatile security definer
set search_path = public
as $$ delete from public.student_sessions where token = p_token $$;

-- 내 화면: 내 반에 열렸거나 공개된 시험 목록(정답 없이)
create or replace function public.student_home(p_token uuid)
returns json language plpgsql stable security definer
set search_path = public
as $$
declare s public.students; cls text;
begin
  s := public._session_student_ready(p_token);
  select name into cls from public.classes where id = s.class_id;
  return json_build_object(
    'sid', s.sid, 'name', s.name, 'class', cls,
    'tests', coalesce((
      select json_agg(json_build_object(
               'id', t.id, 'title', t.title, 'test_date', t.test_date, 'items', t.items,
               'is_open', tc.is_open, 'released', tc.released,
               'submitted_at', sub.submitted_at, 'answers', sub.answers)
             order by t.test_date desc nulls last, t.created_at desc)
        from public.test_class tc
        join public.tests t on t.id = tc.test_id
        left join public.submissions sub on sub.test_id = t.id and sub.student_id = s.id
       where tc.class_id = s.class_id and (tc.is_open or tc.released)), '[]'::json));
end $$;

-- 답안 제출: 내 반에 응시가 열려 있을 때만
create or replace function public.student_submit(p_token uuid, p_test uuid, p_answers text)
returns json language plpgsql volatile security definer
set search_path = public
as $$
declare s public.students; n int;
begin
  s := public._session_student_ready(p_token);
  if not exists (select 1 from public.test_class where test_id = p_test and class_id = s.class_id and is_open) then
    return json_build_object('ok', false, 'error', 'closed');
  end if;
  select jsonb_array_length(items) into n from public.tests where id = p_test;
  if p_answers !~ '^[0-5]*$' or length(p_answers) <> n then
    return json_build_object('ok', false, 'error', 'bad_answers');
  end if;
  insert into public.submissions(test_id, student_id, answers, src, submitted_at)
  values (p_test, s.id, p_answers, 'student', now())
  on conflict (test_id, student_id) do update
    set answers = excluded.answers, src = 'student', submitted_at = now();
  return json_build_object('ok', true, 'submitted_at', now());
end $$;

-- 결과: 내 반에 공개된 시험만(정답·해설·통계·내 답안). p_test가 null이면 공개된 전부(누적 기록용).
create or replace function public.student_results(p_token uuid, p_test uuid default null)
returns json language plpgsql stable security definer
set search_path = public
as $$
declare s public.students;
begin
  s := public._session_student_ready(p_token);
  return coalesce((
    select json_agg(json_build_object(
             'id', t.id, 'title', t.title, 'test_date', t.test_date, 'items', t.items,
             'key', k.answers, 'nat', k.nat, 'ex', k.ex, 'tags', k.tags,
             'stats', tc.stats, 'answers', sub.answers, 'submitted_at', sub.submitted_at)
           order by t.test_date nulls last, t.created_at)
      from public.test_class tc
      join public.tests t on t.id = tc.test_id
      left join public.test_keys k on k.test_id = t.id
      left join public.submissions sub on sub.test_id = t.id and sub.student_id = s.id
     where tc.class_id = s.class_id and tc.released
       and (p_test is null or t.id = p_test)), '[]'::json);
end $$;

-- 비밀번호 바꾸기. 처음(must_change) 상태면 지금 비밀번호를 묻지 않고, 아니면 지금 비밀번호가 맞아야 한다.
-- 규칙: 앞뒤 빈칸을 뺀 길이 6자 이상·72바이트 이하(한글은 24자 정도), 학번과 같으면 안 됨(js/logic.js의 pwProblem과 같은 규칙).
-- 바꾸면 이 학생의 다른 로그인은 모두 끊긴다(먼저 들어와 있던 다른 사람을 내보냄).
create or replace function public.student_change_password(p_token uuid, p_new text, p_old text default null)
returns json language plpgsql volatile security definer
set search_path = public, extensions
as $$
declare s public.students; pw text := trim(coalesce(p_new, ''));
begin
  s := public._session_student(p_token);
  if not s.must_change_pw and (p_old is null or s.code_hash <> crypt(trim(p_old), s.code_hash)) then
    perform pg_sleep(0.4);
    return json_build_object('ok', false, 'error', 'wrong_old');
  end if;
  if length(pw) < 6 then return json_build_object('ok', false, 'error', 'too_short'); end if;
  if octet_length(pw) > 72 then return json_build_object('ok', false, 'error', 'too_long'); end if;  -- bcrypt 한계(바이트)
  if pw = s.sid then return json_build_object('ok', false, 'error', 'same_as_sid'); end if;
  update public.students set code_hash = crypt(pw, gen_salt('bf', 8)), must_change_pw = false,
         fail_count = 0, locked_until = null where id = s.id;
  delete from public.student_sessions where student_id = s.id and token <> p_token;
  return json_build_object('ok', true);
end $$;

-- ───────────────────────── 교사용 함수 ─────────────────────────
-- 비밀번호 초기화: 한 학생의 비밀번호를 학번으로 되돌리고, 다음 로그인 때 새로 정하게 한다. 잠금도 풀린다.
-- 교사 계정(teachers 표)만 부를 수 있다. 반에 속한 학생만 대상으로 한다.
create or replace function public.teacher_reset_password(p_student uuid)
returns json language plpgsql volatile security definer
set search_path = public, extensions
as $$
declare s public.students;
begin
  if not public.is_teacher() then raise exception 'not_teacher' using errcode = '42501'; end if;
  select * into s from public.students where id = p_student and class_id is not null;
  if not found then return json_build_object('ok', false, 'error', 'not_found'); end if;
  update public.students set code_hash = crypt(s.sid, gen_salt('bf', 8)), must_change_pw = true,
         fail_count = 0, locked_until = null where id = s.id;
  delete from public.student_sessions where student_id = s.id;
  return json_build_object('ok', true, 'sid', s.sid, 'name', s.name);
end $$;
-- 반 숨기기 / 다시 보이기. 숨기면 그 반 학생의 로그인을 모두 끊는다. 아무것도 지우지 않는다.
create or replace function public.teacher_set_class_hidden(p_class uuid, p_hidden boolean)
returns json language plpgsql volatile security definer
set search_path = public
as $$
declare n int;
begin
  if not public.is_teacher() then raise exception 'not_teacher' using errcode = '42501'; end if;
  update public.classes set hidden = p_hidden, hidden_at = case when p_hidden then now() else null end where id = p_class;
  if not found then return json_build_object('ok', false, 'error', 'not_found'); end if;
  if p_hidden then
    delete from public.student_sessions ss using public.students st where st.id = ss.student_id and st.class_id = p_class;
  end if;
  select count(*) into n from public.students where class_id = p_class;
  return json_build_object('ok', true, 'students', n);
end $$;

-- 무료 프로젝트 일시 정지 방지용(.github/workflows/keepalive.yml이 매일 부른다). 데이터는 읽지 않는다.
create or replace function public.keepalive()
returns timestamptz language sql stable
as $$ select now() $$;

-- ───────────────────────── 실행 권한 ─────────────────────────
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.is_teacher() to authenticated;
grant execute on function public.keepalive() to anon, authenticated;
grant execute on function public.student_login(text, text) to anon, authenticated;
grant execute on function public.student_logout(uuid) to anon, authenticated;
grant execute on function public.student_home(uuid) to anon, authenticated;
grant execute on function public.student_submit(uuid, uuid, text) to anon, authenticated;
grant execute on function public.student_results(uuid, uuid) to anon, authenticated;
grant execute on function public.student_change_password(uuid, text, text) to anon, authenticated;
grant execute on function public.teacher_reset_password(uuid) to authenticated;
grant execute on function public.teacher_set_class_hidden(uuid, boolean) to authenticated;
-- _session_student, _session_student_ready, _students_default_pw는 아무에게도 주지 않는다(안에서만 쓰임).

-- ───────────────────────── 교사 등록 (따로 한 번 실행) ─────────────────────────
-- Authentication → Users에서 교사 계정을 만든 뒤, 아래 줄의 이메일을 바꿔 실행한다.
-- insert into public.teachers(user_id) select id from auth.users where email = '선생님@이메일' on conflict do nothing;
