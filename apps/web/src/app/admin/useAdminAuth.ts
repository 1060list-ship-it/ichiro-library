'use client'

import { useEffect, useState } from 'react'
import { checkAdminSession, clearAdminSession, verifyAdminPassword } from './actions'

const ADMIN_SESSION_STORAGE_KEY = 'ichiro-library-admin-auth'

export function useAdminAuth() {
  const [ready, setReady] = useState(false)
  const [authenticated, setAuthenticated] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true

    async function syncSession() {
      const stored = window.sessionStorage.getItem(ADMIN_SESSION_STORAGE_KEY) === 'true'

      if (!stored) {
        if (active) setReady(true)
        return
      }

      try {
        const valid = await checkAdminSession()

        if (!active) return

        if (valid) {
          setAuthenticated(true)
        } else {
          window.sessionStorage.removeItem(ADMIN_SESSION_STORAGE_KEY)
        }
      } catch {
        if (active) {
          window.sessionStorage.removeItem(ADMIN_SESSION_STORAGE_KEY)
        }
      } finally {
        if (active) setReady(true)
      }
    }

    syncSession()

    return () => {
      active = false
    }
  }, [])

  async function login(password: string) {
    setSubmitting(true)
    setError('')

    try {
      const result = await verifyAdminPassword(password)

      if (!result.ok) {
        setError(result.message)
        return false
      }

      window.sessionStorage.setItem(ADMIN_SESSION_STORAGE_KEY, 'true')
      setAuthenticated(true)
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : '認証に失敗しました。')
      return false
    } finally {
      setSubmitting(false)
    }
  }

  async function logout() {
    setSubmitting(true)

    try {
      await clearAdminSession()
    } finally {
      window.sessionStorage.removeItem(ADMIN_SESSION_STORAGE_KEY)
      setAuthenticated(false)
      setError('')
      setSubmitting(false)
    }
  }

  return {
    ready,
    authenticated,
    submitting,
    error,
    login,
    logout,
  }
}
