import { useEffect } from 'react'

/**
 * Hook that listens for paste events and extracts image files from the clipboard.
 * Handles both directly pasted images (e.g., screenshots) and copied image files.
 */
export function useImagePaste(onFile: (file: File) => void): void {
  useEffect(() => {
    function handlePaste(e: ClipboardEvent) {
      const items = e.clipboardData?.items
      if (!items) return

      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile()
          if (file) {
            e.preventDefault()
            onFile(file)
            return
          }
        }
      }
    }

    document.addEventListener('paste', handlePaste)
    return () => {
      document.removeEventListener('paste', handlePaste)
    }
  }, [onFile])
}
