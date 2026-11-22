-- 근본국어 (geunbongukeo) 데이터베이스 구조
-- 사용법: Supabase 대시보드 → SQL Editor → 이 파일 전체를 붙여넣고 Run.
-- 여러 번 실행해도 안전하도록 작성했다(이미 있는 것은 건너뛰거나 다시 만든다).
--
-- 원칙
--  * 모든 표에 RLS를 켠다. 공개 키(anon)만으로는 어떤 표도 직접 읽거나 쓸 수 없다.
--  * 교사: teachers 표에 등록된 로그인 계정만 모든 표를 읽고 쓴다.
--  * 학생: 표를 직접 만지지 못하고, 아래 student_* 함수만 부를 수 있다.

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
  code_hash    text,                                               -- 개인 코드(암호화)
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

create index if not exists submissions_student_idx on public.submissions(student_id);
create index if not exists students_class_idx on public.students(class_id);

-- ───────────────────────── 교사 판별 ─────────────────────────
create or replace function public.is_teacher()
returns boolean language sql stable security definer
set search_path = public
as $$ select exists (select 1 from public.teachers where user_id = auth.uid()) $$;

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
  return s;
end $$;

-- 로그인: 학번 + 코드. 5번 틀리면 10분 잠금.
create or replace function public.student_login(p_sid text, p_code text)
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
  if s.code_hash = crypt(upper(trim(p_code)), s.code_hash) then
    update public.students set fail_count = 0, locked_until = null where id = s.id;
    delete from public.student_sessions where expires_at < now();
    insert into public.student_sessions(student_id) values (s.id) returning token into tok;
    return json_build_object('ok', true, 'token', tok, 'sid', s.sid, 'name', s.name);
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
  s := public._session_student(p_token);
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
  s := public._session_student(p_token);
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
  s := public._session_student(p_token);
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

-- ───────────────────────── 교사용 함수 ─────────────────────────
-- 개인 코드 생성: 반 전체(p_class) 또는 한 학생(p_student). 새 코드는 이때 한 번만 보여 준다.
create or replace function public.teacher_issue_codes(p_class uuid default null, p_student uuid default null, p_only_missing boolean default false)
returns table(sid text, name text, code text) language plpgsql volatile security definer
set search_path = public, extensions
as $$
declare r record; c text; alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; i int;
begin
  if not public.is_teacher() then raise exception 'not_teacher' using errcode = '42501'; end if;
  for r in select st.id, st.sid, st.name, st.code_hash from public.students st
            where (p_student is not null and st.id = p_student)
               or (p_student is null and st.class_id = p_class)
            order by st.sid loop
    if p_only_missing and r.code_hash is not null then continue; end if;
    c := '';
    for i in 1..6 loop
      c := c || substr(alphabet, 1 + (get_byte(gen_random_bytes(1), 0) % length(alphabet)), 1);
    end loop;
    update public.students set code_hash = crypt(c, gen_salt('bf', 8)), fail_count = 0, locked_until = null where id = r.id;
    delete from public.student_sessions where student_id = r.id;
    sid := r.sid; name := r.name; code := c;
    return next;
  end loop;
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
grant execute on function public.teacher_issue_codes(uuid, uuid, boolean) to authenticated;
-- _session_student는 아무에게도 주지 않는다(다른 함수 안에서만 쓰임).

-- ───────────────────────── 교사 등록 (따로 한 번 실행) ─────────────────────────
-- Authentication → Users에서 교사 계정을 만든 뒤, 아래 줄의 이메일을 바꿔 실행한다.
-- insert into public.teachers(user_id) select id from auth.users where email = '선생님@이메일' on conflict do nothing;
