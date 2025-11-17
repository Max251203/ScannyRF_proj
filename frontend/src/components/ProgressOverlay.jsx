import { useMemo } from 'react'

/**
 * Простой оверлей прогресса:
 * - open: boolean
 * - label: string ('Загрузка' | 'Восстановление' | 'Скачивание' | ...)
 * - percent: 0..100 (если indeterminate=false)
 * - indeterminate: boolean (по умолчанию true)
 */
export default function ProgressOverlay({ open=false, label='Загрузка', percent=0, indeterminate=true }) {
  const pct = Math.max(0, Math.min(100, Math.round(percent || 0)))
  const title = useMemo(() => {
    if (indeterminate) return label
    return `${label} — ${pct}%`
  }, [indeterminate, label, pct])

  if (!open) return null
  return (
    <div className="progress-overlay" role="status" aria-live="polite" aria-label={title}>
      <div className="po-card">
        <div className="po-title">{label}</div>
        <div className={`po-bar ${indeterminate ? 'ind' : ''}`}>
          <div className="po-fill" style={indeterminate ? undefined : { width: `${pct}%` }} />
        </div>
        {!indeterminate && <div className="po-pct">{pct}%</div>}
      </div>
    </div>
  )
}