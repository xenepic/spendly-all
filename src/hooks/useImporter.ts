import { useCallback, useState } from 'react'
import { db } from '../lib/db'
import { importCsv } from '../lib/importer'
import type { ImportHistory } from '../lib/types'

export type ImportResult = { fileName: string; ok: true; history: ImportHistory } | { fileName: string; ok: false; error: string }

export function useImporter() {
  const [busy, setBusy] = useState(false)
  const [results, setResults] = useState<ImportResult[]>([])

  const importFiles = useCallback(async (files: FileList | File[]) => {
    const list = [...files]
    if (list.length === 0) return
    setBusy(true)
    const out: ImportResult[] = []
    for (const f of list) {
      try {
        const history = await importCsv(db, await f.arrayBuffer(), f.name)
        out.push({ fileName: f.name, ok: true, history })
      } catch (e) {
        out.push({ fileName: f.name, ok: false, error: (e as Error).message })
      }
    }
    setResults(out)
    setBusy(false)
  }, [])

  return { busy, results, importFiles, clearResults: () => setResults([]) }
}
