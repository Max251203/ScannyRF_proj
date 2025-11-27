import React from 'react'

export default function ProgressOverlay({ open, label, val, max, suffix = '' }) {
  if (!open) return null

  const safeMax = Math.max(1, max || 1)
  const safeVal = Math.min(safeMax, Math.max(0, val || 0))
  const pct = max > 0 ? (safeVal / safeMax) * 100 : 100

  return (
    <div className="progress-overlay">
      <div className="po-card">
        <div className="po-title">{label}</div>
        <div className="po-bar">
          <div className="po-fill" style={{ width: `${pct}%` }}>
            <div className="po-shimmer" />
          </div>
        </div>
        <div className="po-stat">
          {max > 0 ? `${safeVal} из ${safeMax} ${suffix}` : '...'}
        </div>
      </div>
    </div>
  )
}