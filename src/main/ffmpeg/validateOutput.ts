import type { VideoInfo } from '../../shared/types'
import { primaryVideo, probeDocument, videoInfo, type ProbeOptions } from './probe'

export interface ValidatedVideo extends VideoInfo {
  codecName: 'hevc'
  pixelFormat: string
  alphaLayerId: number
}

interface NalUnit {
  type: number
  layer: number
  bytes: Buffer
}

// ffprobe -show_data emits 16-byte rows, with a fixed 39-character hex column.
export function parseHexDump(dump: string): Buffer {
  const hex = dump
    .split('\n')
    .filter((line) => /^[0-9a-f]{8}: /i.test(line))
    .map((line) => line.slice(10, 49).replace(/\s/g, ''))
    .join('')
  if (!hex || !/^(?:[0-9a-f]{2})+$/i.test(hex)) throw new Error('无效的 ffprobe 十六进制数据')
  return Buffer.from(hex, 'hex')
}

function nal(bytes: Buffer): NalUnit {
  if (bytes.length < 2 || bytes[0] & 0x80 || !(bytes[1] & 7)) {
    throw new Error('无效的 HEVC NAL 头')
  }
  return { type: (bytes[0] >> 1) & 63, layer: ((bytes[0] & 1) << 5) | (bytes[1] >> 3), bytes }
}

function configuration(bytes: Buffer): { lengthSize: number; units: NalUnit[] } {
  if (bytes.length < 23 || bytes[0] !== 1) throw new Error('缺少 HEVC hvcC 配置')
  const units: NalUnit[] = []
  let offset = 23
  for (let array = 0; array < bytes[22]; array++) {
    if (offset + 3 > bytes.length) throw new Error('hvcC 配置已截断')
    const type = bytes[offset] & 63
    const count = bytes.readUInt16BE(offset + 1)
    offset += 3
    for (let index = 0; index < count; index++) {
      if (offset + 2 > bytes.length) throw new Error('hvcC NAL 长度已截断')
      const length = bytes.readUInt16BE(offset)
      offset += 2
      if (offset + length > bytes.length) throw new Error('hvcC NAL 数据已截断')
      const unit = nal(bytes.subarray(offset, offset + length))
      if (unit.type !== type) throw new Error('hvcC NAL 类型不一致')
      units.push(unit)
      offset += length
    }
  }
  if (offset !== bytes.length) throw new Error('hvcC 配置长度无效')
  return { lengthSize: (bytes[21] & 3) + 1, units }
}

function packetUnits(bytes: Buffer, lengthSize: number): NalUnit[] {
  const units: NalUnit[] = []
  let offset = 0
  while (offset < bytes.length) {
    if (offset + lengthSize > bytes.length) throw new Error('HEVC packet 长度已截断')
    const length = bytes.readUIntBE(offset, lengthSize)
    offset += lengthSize
    if (offset + length > bytes.length) throw new Error('HEVC packet NAL 已截断')
    units.push(nal(bytes.subarray(offset, offset + length)))
    offset += length
  }
  return units
}

function rbsp(bytes: Buffer): Buffer {
  return Buffer.from(
    [...bytes].filter(
      (byte, index) =>
        !(index >= 2 && byte === 3 && bytes[index - 1] === 0 && bytes[index - 2] === 0)
    )
  )
}

function alphaPayload(bytes: Buffer): boolean {
  let offset = 0
  const bits = (count: number): number => {
    if (offset + count > bytes.length * 8) throw new Error('Alpha SEI 数据已截断')
    let value = 0
    for (let index = 0; index < count; index++, offset++) {
      value = (value << 1) | ((bytes[offset >> 3] >> (7 - (offset & 7))) & 1)
    }
    return value
  }
  if (bits(1)) return false // alpha_channel_cancel_flag
  const use = bits(3)
  return (
    use <= 1 && bits(3) === 0 && bits(9) === 0 && bits(9) === 255 && bits(1) === 0 && bits(1) === 0
  )
}

function hasAlphaSEI(unit: NalUnit): boolean {
  if (unit.type !== 39 || unit.layer !== 0) return false
  const bytes = rbsp(unit.bytes.subarray(2))
  let offset = 0
  while (offset < bytes.length && bytes[offset] !== 0x80) {
    let type = 0
    let size = 0
    while (offset < bytes.length && bytes[offset] === 255) {
      type += 255
      offset++
    }
    if (offset >= bytes.length) throw new Error('SEI 类型已截断')
    type += bytes[offset++]
    while (offset < bytes.length && bytes[offset] === 255) {
      size += 255
      offset++
    }
    if (offset >= bytes.length) throw new Error('SEI 长度已截断')
    size += bytes[offset++]
    if (offset + size > bytes.length) throw new Error('SEI 内容已截断')
    if (type === 165 && alphaPayload(bytes.subarray(offset, offset + size))) return true
    offset += size
  }
  return false
}

// Apple stores alpha as an auxiliary HEVC layer, not as the base decoder's pixel format.
// Verify active Alpha SEI, layer parameter sets, and actual base/alpha picture NALs.
export function appleAlphaLayer(extradata: Buffer, firstPacket: Buffer): number {
  const config = configuration(extradata)
  const units = config.units
  const pictures = packetUnits(firstPacket, config.lengthSize).filter((unit) => unit.type < 32)
  const alphaSPS = units.filter((unit) => unit.type === 33 && unit.layer !== 0)
  const layer = alphaSPS.find(
    (sps) =>
      units.some((unit) => unit.type === 34 && unit.layer === sps.layer) &&
      pictures.some((unit) => unit.layer === sps.layer)
  )?.layer
  if (
    !units.some((unit) => unit.type === 32 && unit.layer === 0) ||
    !units.some((unit) => unit.type === 33 && unit.layer === 0) ||
    !units.some((unit) => unit.type === 34 && unit.layer === 0) ||
    !units.some(hasAlphaSEI) ||
    !pictures.some((unit) => unit.layer === 0) ||
    layer === undefined
  ) {
    throw new Error(
      '未检测到有效的 Apple HEVC Alpha 层（需要 Alpha SEI、双层 SPS/PPS 和实际 Alpha 图像数据）'
    )
  }
  return layer
}

export async function validateOutput(
  input: string,
  options: ProbeOptions = {}
): Promise<ValidatedVideo> {
  const document = await probeDocument(input, options, [
    '-select_streams',
    'v:0',
    '-show_data',
    '-show_packets',
    '-read_intervals',
    '%+#1'
  ])
  const video = primaryVideo(document)
  if (video.codec_name !== 'hevc' || video.codec_tag_string !== 'hvc1') {
    throw new Error(
      `输出不是 Apple HEVC 视频（codec=${video.codec_name}, tag=${video.codec_tag_string}）`
    )
  }
  if (!video.extradata || !document.packets?.[0]?.data)
    throw new Error('输出缺少 HEVC 配置或视频帧')
  const alphaLayerId = appleAlphaLayer(
    parseHexDump(video.extradata),
    parseHexDump(document.packets[0].data)
  )
  // -select_streams is only used for the bitstream check; preserve actual audio detection separately.
  const allStreams = await probeDocument(input, options)
  return {
    ...videoInfo(allStreams),
    codecName: 'hevc',
    pixelFormat: video.pix_fmt ?? 'unknown',
    alphaLayerId
  }
}
