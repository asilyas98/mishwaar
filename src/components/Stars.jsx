import { arNum } from '../lib/geo'

export function StarsDisplay({ summary }) {
  if (!summary || !summary.count) return <span className="stars muted">لا تقييمات بعد</span>
  const full = Math.round(summary.avg)
  return (
    <span className="stars" aria-label={`التقييم ${summary.avg.toFixed(1)} من ٥`}>
      <span className="star-row" aria-hidden="true">{'★'.repeat(full)}<span className="dim">{'★'.repeat(5 - full)}</span></span>
      <span className="num">{arNum(summary.avg.toFixed(1))}</span>
      <span className="muted">({arNum(summary.count)})</span>
    </span>
  )
}

const LABELS = ['سيئ', 'مقبول', 'جيد', 'جيد جدًا', 'ممتاز']

export function StarsInput({ value, onChange, disabled }) {
  return (
    <div className="stars-input" role="radiogroup" aria-label="قيّم هذا المكان">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={`${arNum(n)} — ${LABELS[n - 1]}`}
          className={n <= (value || 0) ? 'on' : ''}
          disabled={disabled}
          onClick={() => onChange(n)}
        >★</button>
      ))}
      <span className="muted">{value ? LABELS[value - 1] : 'اختر عدد النجوم'}</span>
    </div>
  )
}
