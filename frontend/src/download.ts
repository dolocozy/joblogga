// Hands a file the app already has in memory to the browser as a download.
export function saveFile(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  // Give the browser a moment to start the download before releasing the memory.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
