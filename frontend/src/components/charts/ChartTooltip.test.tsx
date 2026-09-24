import { render, screen } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { describe, expect, it } from 'vitest'
import ChartTooltip from './ChartTooltip'

type Props = ComponentProps<typeof ChartTooltip>

// Recharts hands the tooltip a big props object; we only use these fields, so
// the test supplies just those (the payload cast covers the fields we ignore).
const props = (row: { count: number; tooltipTitle: string }, active = true): Props => ({
  active,
  payload: [{ payload: row }] as unknown as Props['payload'],
  unit: 'applications',
})

describe('ChartTooltip', () => {
  it('shows the title, the value, and the unit', () => {
    render(<ChartTooltip {...props({ count: 1234, tooltipTitle: 'Week of Mar 2, 2026' })} />)
    expect(screen.getByText('Week of Mar 2, 2026')).toBeInTheDocument()
    expect(screen.getByText('1,234')).toBeInTheDocument()
    expect(screen.getByText('applications')).toBeInTheDocument()
  })

  it('renders nothing when the pointer is not over a mark', () => {
    const { container } = render(<ChartTooltip {...props({ count: 1, tooltipTitle: 'x' }, false)} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when there is no data under the pointer', () => {
    const { container } = render(<ChartTooltip active payload={[]} unit="applications" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('treats a title as text, never as markup', () => {
    const { container } = render(
      <ChartTooltip {...props({ count: 1, tooltipTitle: '<img src=x onerror="alert(1)">' })} />,
    )
    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByText('<img src=x onerror="alert(1)">')).toBeInTheDocument()
  })
})
