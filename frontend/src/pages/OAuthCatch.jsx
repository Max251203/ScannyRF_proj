import { useEffect } from 'react'

export default function OAuthCatch() {
  useEffect(() => {
    try {
      const full = window.location.hash || ''
      const frag = full.includes('#') ? full.split('#').pop() : full.slice(1)
      const p = new URLSearchParams(frag || '')
      const token = p.get('access_token') || ''
      const idt = p.get('id_token') || ''
      const state = p.get('state') || ''
      const email = p.get('email') || ''
      if (window.opener && state && (token || idt)) {
        window.opener.postMessage(
          { provider: state, access_token: token, id_token: idt, email },
          '*'
        )
      }
    } catch {}
    setTimeout(() => window.close(), 200)
  }, [])
  return <div style={{ padding: 20 }}>Закрываем окно…</div>
}