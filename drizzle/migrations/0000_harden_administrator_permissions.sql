DROP POLICY IF EXISTS "profile_update_own" ON public.profiles;
DROP POLICY IF EXISTS "profile self update" ON public.profiles;

CREATE POLICY "profile self update safe"
ON public.profiles
FOR UPDATE
TO authenticated
USING (id = auth.uid())
WITH CHECK (
  id = auth.uid()
  AND is_super_admin = (
    SELECT existing.is_super_admin
    FROM public.profiles AS existing
    WHERE existing.id = auth.uid()
  )
  AND super_admin_onboarding_completed = (
    SELECT existing.super_admin_onboarding_completed
    FROM public.profiles AS existing
    WHERE existing.id = auth.uid()
  )
);

REVOKE ALL ON TABLE public.profiles FROM anon, authenticated;
GRANT SELECT ON TABLE public.profiles TO authenticated;
GRANT UPDATE (name, display_name, availability, custom_attributes, ui_settings, updated_at) ON TABLE public.profiles TO authenticated;
GRANT ALL ON TABLE public.profiles TO service_role;

REVOKE ALL ON TABLE public.account_users FROM anon, authenticated;
GRANT SELECT ON TABLE public.account_users TO authenticated;
GRANT UPDATE (availability, auto_offline, active_at, updated_at) ON TABLE public.account_users TO authenticated;
GRANT ALL ON TABLE public.account_users TO service_role;

REVOKE ALL ON TABLE public.user_roles FROM anon, authenticated;
GRANT SELECT ON TABLE public.user_roles TO authenticated;
GRANT ALL ON TABLE public.user_roles TO service_role;

REVOKE EXECUTE ON FUNCTION public.complete_super_admin_onboarding() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_super_admin_onboarding() TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.ensure_workspace() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_workspace() TO authenticated, service_role;