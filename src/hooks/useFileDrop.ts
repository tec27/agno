import { useState } from 'react'

export function useFileDrop(onFile: (file: File) => void): {
  isDragging: boolean
  dropProps: {
    onDrop: (e: React.DragEvent) => void
    onDragOver: (e: React.DragEvent) => void
    onDragLeave: (e: React.DragEvent) => void
  }
} {
  const [isDragging, setIsDragging] = useState(false)

  return {
    isDragging,
    dropProps: {
      onDrop: e => {
        e.preventDefault()
        setIsDragging(false)
        const file = e.dataTransfer.files[0] as File | undefined
        if (file) onFile(file)
      },
      onDragOver: e => {
        e.preventDefault()
        setIsDragging(true)
      },
      onDragLeave: e => {
        e.preventDefault()
        setIsDragging(false)
      },
    },
  }
}
