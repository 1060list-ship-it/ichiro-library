'use server'

import { redirect } from 'next/navigation'
import { sanitizeReturnTo } from '@/lib/auth'
import { createSupabaseServerClient } from '@/lib/supabase-server'

export type LoginActionState = {
  error: string | null
}

export async function loginAction(formData: FormData): Promise<LoginActionState> {
  const email = String(formData.get('email') ?? '').trim()
  const password = String(formData.get('password') ?? '')
  const returnTo = sanitizeReturnTo(String(formData.get('returnTo') ?? '/member'))

  if (!email || !password) {
    return { error: 'メールアドレスとパスワードを入力してください。' }
  }

  const supabase = await createSupabaseServerClient()
  try {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (error) {
      return { error: 'メールアドレスまたはパスワードが正しくありません。' }
    }
  } catch {
    return { error: 'ログインに失敗しました。時間をおいて再度お試しください。' }
  }

  redirect(returnTo)
}
