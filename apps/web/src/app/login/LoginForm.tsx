'use client'

import { useActionState } from 'react'
import type { LoginActionState } from './actions'
import { loginAction } from './actions'

const initialState: LoginActionState = {
  error: null,
}

export default function LoginForm({ returnTo }: { returnTo: string }) {
  const [state, formAction, pending] = useActionState(
    async (_previousState: LoginActionState, formData: FormData) => loginAction(formData),
    initialState,
  )

  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="returnTo" value={returnTo} />

      <div className="space-y-2">
        <label htmlFor="email" className="text-sm font-medium text-gray-200">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          className="w-full rounded-xl border border-gray-800 bg-gray-950 px-4 py-3 text-sm text-white outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
          placeholder="you@example.com"
        />
      </div>

      <div className="space-y-2">
        <label htmlFor="password" className="text-sm font-medium text-gray-200">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="w-full rounded-xl border border-gray-800 bg-gray-950 px-4 py-3 text-sm text-white outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
          placeholder="••••••••"
        />
      </div>

      {state.error && (
        <p className="rounded-xl border border-red-950 bg-red-950/30 px-4 py-3 text-sm text-red-400">
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-70"
      >
        {pending ? 'ログイン中...' : 'ログイン'}
      </button>
    </form>
  )
}
