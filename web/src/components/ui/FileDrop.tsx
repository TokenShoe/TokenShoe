'use client'
/** CSV drag-and-drop / click to choose */
import { useRef, useState } from 'react'
import { clsx } from 'clsx'
import { Upload, FileText } from 'lucide-react'

export function FileDrop({ file, onFile, hint, accept = '.csv,text/csv' }: {
  file: File | null
  onFile: (f: File | null) => void
  hint?: React.ReactNode
  accept?: string
}) {
  const ref = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setOver(true) }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); onFile(e.dataTransfer.files[0] ?? null) }}
      onClick={() => ref.current?.click()}
      className={clsx(
        'cursor-pointer rounded-btn border border-dashed p-6 text-center transition-colors',
        over ? 'border-ink bg-ink/[0.03]' : 'border-border hover:border-ink/40',
      )}
    >
      <input ref={ref} type="file" accept={accept} className="hidden" onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
      {file ? (
        <div className="flex items-center justify-center gap-2 text-sm text-ink">
          <FileText size={16} /> <span className="font-medium truncate max-w-xs">{file.name}</span>
          <span className="text-muted">({(file.size / 1024).toFixed(1)} KB)</span>
        </div>
      ) : (
        <div className="space-y-1">
          <Upload size={18} className="mx-auto text-muted" />
          <div className="text-sm text-ink">Drop a CSV here or <span className="underline">browse</span></div>
          {hint && <div className="text-xs text-muted">{hint}</div>}
        </div>
      )}
    </div>
  )
}

/** A downloadable CSV template link */
export function CsvTemplateLink({ name, content }: { name: string; content: string }) {
  const href = `data:text/csv;charset=utf-8,${encodeURIComponent(content)}`
  return <a href={href} download={name} className="text-xs text-blue-text underline" onClick={(e) => e.stopPropagation()}>Download template</a>
}
