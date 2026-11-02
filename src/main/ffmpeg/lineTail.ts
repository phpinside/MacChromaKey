import { StringDecoder } from 'node:string_decoder'
// Bound incomplete lines too: readline would buffer an arbitrarily long metadata line.
export class LineTail {
  readonly lines: string[] = []
  private decoder = new StringDecoder('utf8')
  private pending = ''
  push(chunk: Buffer): void {
    this.append(this.decoder.write(chunk))
  }
  finish(): void {
    this.append(this.decoder.end())
    if (this.pending) this.line(this.pending)
    this.pending = ''
  }
  private line(value: string): void {
    this.lines.push(value.replace(/\r$/, '').slice(-8192))
    if (this.lines.length > 50) this.lines.shift()
  }
  private append(text: string): void {
    const parts = text.split('\n')
    if (parts.length === 1) {
      this.pending = (this.pending + text).slice(-8192)
      return
    }
    this.line(this.pending + parts[0])
    for (let index = 1; index < parts.length - 1; index++) this.line(parts[index])
    this.pending = parts.at(-1)!.slice(-8192)
  }
}
