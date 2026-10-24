import type { CaptureFrame, CaptureServiceInit, CaptureServiceReadyInfo } from '../../shared/types'

interface Source {
  displayId: number
  video: HTMLVideoElement
  track: MediaStreamTrack
  imageCapture: { grabFrame: () => Promise<ImageBitmap> } | null
  canvas: HTMLCanvasElement
  ready: boolean
  error?: string
}

const ImageCaptureCtor = (
  window as unknown as {
    ImageCapture?: new (track: MediaStreamTrack) => { grabFrame: () => Promise<ImageBitmap> }
  }
).ImageCapture

let sources: Source[] = []
let grabChain: Promise<void> = Promise.resolve()

function waitVideoReady(video: HTMLVideoElement): Promise<void> {
  if (video.readyState >= 2 && video.videoWidth > 0) return Promise.resolve()
  return new Promise((resolve) => {
    const done = (): void => {
      video.removeEventListener('loadeddata', done)
      video.removeEventListener('resize', done)
      resolve()
    }
    video.addEventListener('loadeddata', done)
    video.addEventListener('resize', done)
  })
}

async function captureOne(src: Source): Promise<CaptureFrame | null> {
  let bitmap: ImageBitmap | null = null
  try {
    if (src.imageCapture) bitmap = await src.imageCapture.grabFrame()
  } catch {
    // 某些显卡/远程桌面下 ImageCapture 不可用，退化为读取 video 当前帧
  }

  const width = bitmap?.width || src.video.videoWidth
  const height = bitmap?.height || src.video.videoHeight
  if (!width || !height) return null

  const canvas = src.canvas
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width
    canvas.height = height
  }
  const ctx = canvas.getContext('2d', { alpha: false })
  if (!ctx) return null
  if (bitmap) {
    ctx.drawImage(bitmap, 0, 0)
    bitmap.close()
  } else {
    ctx.drawImage(src.video, 0, 0, width, height)
  }
  const dataUrl = canvas.toDataURL('image/png')
  const comma = dataUrl.indexOf(',')
  return {
    displayId: src.displayId,
    width,
    height,
    pngBase64: comma >= 0 ? dataUrl.slice(comma + 1) : ''
  }
}

async function grabAll(requestId: number): Promise<void> {
  const frames: CaptureFrame[] = []
  for (const src of sources) {
    if (!src.ready) continue
    try {
      const frame = await captureOne(src)
      if (frame) frames.push(frame)
    } catch (err) {
      console.warn('capture frame failed', src.displayId, err)
    }
  }
  window.api.captureService.sendFrames(requestId, frames)
}

async function startStreams(init: CaptureServiceInit): Promise<void> {
  for (const src of sources) {
    try {
      src.track.stop()
    } catch {
      /* ignore */
    }
  }
  sources = []

  for (const display of init.displays) {
    const source: Source = {
      displayId: display.id,
      video: document.createElement('video'),
      track: null as unknown as MediaStreamTrack,
      imageCapture: null,
      canvas: document.createElement('canvas'),
      ready: false
    }
    source.video.muted = true
    source.video.playsInline = true
    source.video.autoplay = true
    source.video.style.width = '320px'
    source.video.style.height = '180px'
    document.body.appendChild(source.video)
    sources.push(source)

    try {
      // 使用 Electron 的 desktop 源 + getUserMedia：getDisplayMedia 在 Windows
      // 下会把鼠标指针烧进每一帧，截图里会留下光标；getUserMedia 的桌面源不会。
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: display.sourceId,
            maxWidth: display.width,
            maxHeight: display.height,
            maxFrameRate: 15,
            cursor: 'never'
          }
        },
        audio: false
      } as unknown as MediaStreamConstraints)
      const track = stream.getVideoTracks()[0]
      if (!track) throw new Error('no video track')
      source.track = track
      source.video.srcObject = stream
      await source.video.play()
      await waitVideoReady(source.video)
      if (!source.video.videoWidth) {
        // 等一帧真正到达
        await new Promise((r) => setTimeout(r, 120))
      }
      source.imageCapture = ImageCaptureCtor ? new ImageCaptureCtor(track) : null
      source.ready = source.video.videoWidth > 0
      if (!source.ready) throw new Error('video has no frame')
    } catch (err) {
      source.error = err instanceof Error ? err.message : String(err)
      source.ready = false
      console.warn('capture stream failed', display.id, source.error)
    }
  }

  // 预热 PNG 编码器：第一次 1080p toDataURL 可能多花上百毫秒
  for (const src of sources) {
    if (!src.ready) continue
    try {
      await captureOne(src)
    } catch {
      /* ignore */
    }
  }

  const infos: CaptureServiceReadyInfo[] = sources.map((s) => ({
    displayId: s.displayId,
    width: s.video.videoWidth,
    height: s.video.videoHeight,
    ok: s.ready,
    error: s.error
  }))
  window.api.captureService.notifyReady(infos)
}

window.api.captureService.onInit((init) => {
  void startStreams(init)
})

window.api.captureService.onGrab((requestId) => {
  grabChain = grabChain.then(() => grabAll(requestId)).catch((err) => {
    console.error('grab failed', err)
  })
})
