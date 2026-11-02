import { describe, expect, it } from 'vitest'
import { appleAlphaLayer, parseHexDump } from './validateOutput'

function config(includeAlphaSEI = true, cancelled = false): Buffer {
  const header = Buffer.alloc(23)
  header[0] = 1
  header[21] = 3
  const arrays = [
    [Buffer.from('4001', 'hex')],
    [Buffer.from('4201', 'hex'), Buffer.from('4209', 'hex')],
    [Buffer.from('4401', 'hex'), Buffer.from('4409', 'hex')]
  ]
  if (includeAlphaSEI)
    arrays.push([Buffer.from(cancelled ? '4e01a50480007f9080' : '4e01a50400007f9080', 'hex')])
  header[22] = arrays.length
  return Buffer.concat([
    header,
    ...arrays.map((units) => {
      const prefix = Buffer.alloc(3)
      prefix[0] = (units[0][0] >> 1) & 63
      prefix.writeUInt16BE(units.length, 1)
      return Buffer.concat([
        prefix,
        ...units.map((unit) => {
          const length = Buffer.alloc(2)
          length.writeUInt16BE(unit.length)
          return Buffer.concat([length, unit])
        })
      ])
    })
  ])
}

describe('Apple HEVC alpha validation', () => {
  const pictures = Buffer.from('000000022801000000022809', 'hex')
  it('requires active Alpha SEI plus parameter sets and actual nonzero-layer picture data', () => {
    expect(appleAlphaLayer(config(), pictures)).toBe(1)
  })
  it('rejects multilayer video without Alpha SEI and cancelled Alpha SEI', () => {
    expect(() => appleAlphaLayer(config(false), pictures)).toThrow('Alpha')
    expect(() => appleAlphaLayer(config(true, true), pictures)).toThrow('Alpha')
  })
  it('rejects metadata without an actual alpha picture and truncated hvcC', () => {
    expect(() => appleAlphaLayer(config(), pictures.subarray(0, 6))).toThrow('Alpha')
    expect(() => appleAlphaLayer(config().subarray(0, 25), pictures)).toThrow('截断')
  })
  it('parses ffprobe hex rows without including ASCII text', () => {
    expect(
      parseHexDump(
        '\n00000000: 0000 001f 4e01 051a 4756 4adc 5c4c 433f  ....N...GVJ.\\LC?\n00000010: 94ef c511                                ....\n'
      )
    ).toEqual(Buffer.from('0000001f4e01051a47564adc5c4c433f94efc511', 'hex'))
  })
})
