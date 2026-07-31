-- 003 revoked execute on handle_new_user from PUBLIC, but Supabase also grants
-- anon and authenticated explicitly, so the function stayed callable at
-- /rest/v1/rpc/handle_new_user. Explicit grants need an explicit revoke.
--
-- Safe for signup: a trigger fires its function without checking execute
-- privilege for the role performing the insert.
revoke all on function public.handle_new_user() from anon, authenticated;
