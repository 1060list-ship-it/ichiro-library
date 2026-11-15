-- Temporarily restrict magazine content and its entity links to administrators.
-- The service role retains its existing pipeline access.
DROP POLICY IF EXISTS "magazines_anon_read" ON public.magazines;
DROP POLICY IF EXISTS "magazines_authenticated_read" ON public.magazines;
CREATE POLICY "magazines_admin_read" ON public.magazines
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role = 'admin'
  ));

DROP POLICY IF EXISTS "magazine_entities_anon_read" ON public.magazine_entities;
DROP POLICY IF EXISTS "magazine_entities_authenticated_read" ON public.magazine_entities;
CREATE POLICY "magazine_entities_admin_read" ON public.magazine_entities
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role = 'admin'
  ));
