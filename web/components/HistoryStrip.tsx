import type { HistoryEntryWithStatus } from "../../src/db"
import { colourFor } from "../status"

// The recorded sessions, newest last, seven to a page. Each disc is one session,
// coloured by the gap to the session before it and labelled with the reps it
// asked for. A disabled arrow keeps its slot so the strip does not jump.
export function HistoryStrip(props: {
  history: HistoryEntryWithStatus[]
  page: number
  pageSize: number
  pageCount: number
  onPage: (page: number) => void
}) {
  const { history, page, pageSize, pageCount, onPage } = props
  const start = page * pageSize
  const slots = Array.from({ length: pageSize }, (_, index) => start + index)

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--s2)" }}>
      <div class="row" style={{ gap: "var(--s2)" }}>
        <button
          type="button"
          class="ghost"
          style={{ flex: "0 0 36px", visibility: page > 0 ? "visible" : "hidden" }}
          aria-label="Previous page"
          onClick={() => onPage(page - 1)}
        >
          ‹
        </button>

        <div class="row" style={{ flex: 1, gap: "var(--s2)", justifyContent: "center" }}>
          {slots.map((globalIndex) => {
            const entry = history[globalIndex]
            return (
              <span
                key={globalIndex}
                class="disc"
                title={entry ? `${entry.reps}×` : "empty"}
                style={{
                  width: "32px",
                  height: "32px",
                  fontSize: "12px",
                  background: entry ? colourFor(entry.status) : "transparent",
                  border: `1px solid ${entry ? colourFor(entry.status) : "var(--line)"}`,
                }}
              >
                {entry ? `${entry.reps}×` : ""}
              </span>
            )
          })}
        </div>

        <button
          type="button"
          class="ghost"
          style={{ flex: "0 0 36px", visibility: page < pageCount - 1 ? "visible" : "hidden" }}
          aria-label="Next page"
          onClick={() => onPage(page + 1)}
        >
          ›
        </button>
      </div>

      {pageCount > 1 && (
        <div class="center faint" style={{ fontSize: "11px" }}>
          {page + 1} / {pageCount}
        </div>
      )}
    </div>
  )
}
