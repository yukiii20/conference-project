import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { Avatar } from './Avatar'

export function PortalHeader({ roleLabel }: { roleLabel: string }) {
  const navigate = useNavigate()
  const [fullName, setFullName] = useState('')
  const [photoPath, setPhotoPath] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const { data: userData } = await supabase.auth.getUser()
      if (!userData.user) return
      const { data: profile } = await supabase
        .from('profiles')
        .select('full_name, photo_path')
        .eq('id', userData.user.id)
        .single()
      if (cancelled) return
      setFullName(profile?.full_name ?? userData.user.email ?? '')
      setPhotoPath(profile?.photo_path ?? null)
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  async function handleSignOut() {
    await supabase.auth.signOut()
    navigate('/login')
  }

  return (
    <header className="flex flex-wrap items-center justify-between gap-3 bg-button px-4 py-3 text-white">
      <span className="font-semibold">Conference management system</span>
      <div className="flex items-center gap-3 text-sm">
        <Avatar photoPath={photoPath} name={fullName} size="h-7 w-7" />
        <span>{fullName}</span>
        <span className="rounded-full bg-white/20 px-2 py-0.5 text-xs">{roleLabel}</span>
        <Link to="/profile" className="rounded border border-white/40 px-3 py-1 hover:bg-white/10">
          Profile
        </Link>
        <Link to="/change-password" className="rounded border border-white/40 px-3 py-1 hover:bg-white/10">
          Change password
        </Link>
        <button type="button" onClick={handleSignOut} className="rounded border border-white/40 px-3 py-1 hover:bg-white/10">
          Sign out
        </button>
      </div>
    </header>
  )
}
