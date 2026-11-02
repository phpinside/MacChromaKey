import { stat } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'

export function defaultExportPath(input: string): string {
  return join(dirname(input), `${basename(input, extname(input))}_alpha.mov`)
}

// Batch exports never overwrite existing files or collide when inputs share a basename.
export async function batchExportPaths(inputs: string[], directory: string): Promise<string[]> {
  const reserved = new Set<string>()
  const outputs: string[] = []
  for (const input of inputs) {
    const name = basename(input, extname(input)) + '_alpha'
    let candidate = join(directory, `${name}.mov`)
    let suffix = 2
    while (
      reserved.has(candidate.toLowerCase()) ||
      (await stat(candidate).then(
        () => true,
        (error: NodeJS.ErrnoException) => {
          if (error.code === 'ENOENT') return false
          throw error
        }
      ))
    )
      candidate = join(directory, `${name}_${suffix++}.mov`)
    reserved.add(candidate.toLowerCase())
    outputs.push(candidate)
  }
  return outputs
}
