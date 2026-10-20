import { dayLabel } from "../status"

// The days-since-last-session disc, which is the plugin's bar icon at phone size.
export function DayBubble(props: {
  daysSinceLast: number
  everTrained: boolean
  status: number
  size?: number
  quiet?: boolean
}) {
  const { daysSinceLast, everTrained, status, size = 44, quiet = false } = props
  // The bar's copy drops the colour while the chain is on track, because a green
  // disc for an ordinary day is noise in a 27px slot. The panel's copy keeps it.
  const plain = quiet && status === 1
  const background = plain ? "var(--fg)" : `var(--${statusColour(status)})`

  return (
    <span
      class="disc"
      title={labelFor(status)}
      style={{
        width: `${size}px`,
        height: `${size}px`,
        background,
        color: plain ? "var(--bg)" : "#fff",
        fontSize: `${Math.max(8, Math.round(size * 0.38))}px`,
      }}
    >
      {dayLabel(everTrained, daysSinceLast)}
    </span>
  )
}

function statusColour(status: number): string {
  if (status === 1) return "on-track"
  if (status === 0) return "keep"
  return "drop"
}

function labelFor(status: number): string {
  if (status === 1) return "On track (2 days or less)"
  if (status === 0) return "Keep (3 days)"
  return "Drop (4 days or more)"
}
