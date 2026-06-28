import { NextResponse } from 'next/server'
import { getCurrentUserRole } from '@/lib/auth'

export async function GET() {
  const role = await getCurrentUserRole()
  return NextResponse.json({ role })
}
