import { describe, expect, it } from 'vitest'
import { rational, videoInfo, type ProbeDocument } from './probe'

describe('probe metadata parsing', () => {
  it('uses fractional fps, video duration and ignores attached cover art', () => {
    const document: ProbeDocument = {
      streams: [
        {
          index: 0,
          codec_type: 'video',
          width: 100,
          height: 100,
          disposition: { attached_pic: 1 }
        },
        {
          index: 1,
          codec_type: 'video',
          width: 1920,
          height: 1080,
          duration: '3.5',
          avg_frame_rate: '30000/1001'
        },
        { index: 2, codec_type: 'audio' }
      ],
      format: { duration: '4' }
    }
    expect(videoInfo(document)).toEqual({
      width: 1920,
      height: 1080,
      duration: 3.5,
      fps: 30000 / 1001,
      hasAudio: true
    })
  })

  it('falls back to format duration and nominal fps', () => {
    expect(
      videoInfo({
        streams: [
          {
            index: 0,
            codec_type: 'video',
            width: 320,
            height: 180,
            avg_frame_rate: '0/0',
            r_frame_rate: '24/1'
          }
        ],
        format: { duration: '2' }
      })
    ).toEqual({ width: 320, height: 180, duration: 2, fps: 24, hasAudio: false })
    expect(rational('1/0')).toBe(0)
    expect(rational('N/A')).toBe(0)
  })

  it('rejects audio-only files and missing/invalid video duration', () => {
    expect(() => videoInfo({ streams: [{ index: 0, codec_type: 'audio' }] })).toThrow('视频流')
    expect(() =>
      videoInfo({
        streams: [{ index: 0, codec_type: 'video', width: 320, height: 180, r_frame_rate: '24/1' }]
      })
    ).toThrow('时长')
  })
})
