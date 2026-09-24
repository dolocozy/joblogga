import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { saveFile } from './download'

beforeEach(() => {
  vi.useFakeTimers()
  URL.createObjectURL = vi.fn(() => 'blob:fake-url')
  URL.revokeObjectURL = vi.fn()
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('saveFile', () => {
  it('triggers a download with the given name, then cleans up', () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const blob = new Blob(['a,b\r\n1,2'], { type: 'text/csv' })

    saveFile(blob, 'my-file.csv')

    expect(URL.createObjectURL).toHaveBeenCalledWith(blob)
    expect(click).toHaveBeenCalledTimes(1)
    const link = click.mock.contexts[0] as HTMLAnchorElement // the link that was clicked
    expect(link.download).toBe('my-file.csv')
    expect(link.href).toBe('blob:fake-url')
    // The temporary link is not left behind in the page.
    expect(document.querySelector('a[download]')).toBeNull()
  })

  it('releases the in-memory file shortly after, not immediately', () => {
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    saveFile(new Blob(['x']), 'f.csv')

    expect(URL.revokeObjectURL).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1000)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake-url')
  })
})
