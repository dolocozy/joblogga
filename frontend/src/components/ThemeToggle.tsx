import { NEXT_THEME, THEME_LABELS, useTheme } from '../theme'

// One button that steps System, Light, Dark and back round. It names the current choice in its text (never an icon alone), so
// it needs no legend, and says what a click does in its tooltip.
export default function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  return (
    <button
      type="button"
      onClick={() => setTheme(NEXT_THEME[theme])}
      title={`Switch to ${THEME_LABELS[NEXT_THEME[theme]].toLowerCase()}`}
      className="btn btn-secondary btn-sm whitespace-nowrap"
    >
      Theme: {THEME_LABELS[theme]}
    </button>
  )
}
