import { useRef, useState, useEffect, useCallback } from 'react'
import type { SavedItem } from '../App'
import { extractBatchNumber } from '../utils/extractBatchNumber'
import type { BatchExtractionResult } from '../utils/extractBatchNumber'

interface Props {
  onSaveItem: (item: SavedItem) => void
}

type OcrStatus = 'idle' | 'scanning' | 'done' | 'error'

export default function CameraScanner({ onSaveItem }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const [isStreaming, setIsStreaming] = useState(false)
  const [capturedImage, setCapturedImage] = useState<string | null>(null)
  const [productName, setProductName] = useState('')
  const [batchNo, setBatchNo] = useState('')
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [saveFlash, setSaveFlash] = useState(false)

  // OCR state
  const [ocrStatus, setOcrStatus] = useState<OcrStatus>('idle')
  const [ocrRawText, setOcrRawText] = useState('')
  const [batchConfidence, setBatchConfidence] = useState<BatchExtractionResult['confidence']>('low')

  /* ── Run OCR on Canvas via Vercel Backend ─────────────── */
  const runOcr = useCallback(
    async (canvas: HTMLCanvasElement) => {
      setOcrStatus('scanning')
      setOcrRawText('')
      setBatchConfidence('low')

      try {
        const blob = await new Promise<Blob | null>((resolve) => 
          canvas.toBlob(resolve, 'image/jpeg', 0.85)
        )
        
        if (!blob) throw new Error('Failed to create image blob')
        
        // Proxy the request through our Vercel Serverless Function
        const res = await fetch('/api/scan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: blob
        })

        if (!res.ok) {
          const errorData = await res.json()
          throw new Error(errorData.error || 'Failed to analyze image')
        }

        const data = await res.json()
        const lines: string[] = data.lines || []
        const cleaned = lines.join('\n').trim()

        setOcrRawText(cleaned)
        setOcrStatus('done')

        // Auto-fill product name with the first non-empty line
        if (cleaned) {
          const nonEmptyLines = lines.map((l) => l.trim()).filter(Boolean)
          if (nonEmptyLines.length > 0) {
            setProductName(nonEmptyLines[0])
          }

          // Extract batch number from OCR text
          const extraction = extractBatchNumber(cleaned)
          if (extraction.batchNo) {
            setBatchNo(extraction.batchNo)
            setBatchConfidence(extraction.confidence)
          }
        }
      } catch (err) {
        console.error('OCR error:', err)
        setOcrStatus('error')
      }
    },
    []
  )

  /* ── Start Camera ──────────────────────────────────────── */
  const startCamera = useCallback(async () => {
    setCameraError(null)
    setCapturedImage(null)
    setBatchNo('')

    try {
      const constraints: MediaStreamConstraints = {
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      }

      const stream = await navigator.mediaDevices.getUserMedia(constraints)
      streamRef.current = stream

      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
        setIsStreaming(true)
      }
    } catch (err) {
      console.error('Camera error:', err)
      setCameraError(
        'Unable to access camera. Please allow camera permissions and try again.'
      )
    }
  }, [])

  /* ── Stop Camera ───────────────────────────────────────── */
  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
    setIsStreaming(false)
  }, [])

  /* ── Capture Frame & Trigger OCR ───────────────────────── */
  const captureFrame = useCallback(() => {
    if (!videoRef.current || !canvasRef.current) return

    const video = videoRef.current
    const canvas = canvasRef.current
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Draw the current video frame to the canvas
    ctx.drawImage(video, 0, 0)
    
    // Save as thumbnail
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85)
    setCapturedImage(dataUrl)

    stopCamera()

    // Kick off OCR on the captured canvas
    runOcr(canvas)
  }, [stopCamera, runOcr])

  /* ── Retake ────────────────────────────────────────────── */
  const handleRetake = useCallback(() => {
    setCapturedImage(null)
    setProductName('')
    setBatchNo('')
    setBatchConfidence('low')
    setOcrStatus('idle')
    setOcrRawText('')
    startCamera()
  }, [startCamera])

  /* ── Save Item ─────────────────────────────────────────── */
  const handleSave = useCallback(() => {
    if (!productName.trim()) return

    const item: SavedItem = {
      id: crypto.randomUUID(),
      productName: productName.trim(),
      batchNo,
      timestamp: Date.now(),
      thumbnail: capturedImage,
    }

    onSaveItem(item)

    // Flash effect
    setSaveFlash(true)
    setTimeout(() => setSaveFlash(false), 400)

    // Reset for next scan
    setTimeout(() => {
      setCapturedImage(null)
      setProductName('')
      setBatchNo('')
      setBatchConfidence('low')
      setOcrStatus('idle')
      setOcrRawText('')
      startCamera()
    }, 600)
  }, [productName, batchNo, capturedImage, onSaveItem, startCamera])

  /* ── Lifecycle ─────────────────────────────────────────── */
  useEffect(() => {
    startCamera()
    return () => stopCamera()
  }, [startCamera, stopCamera])

  /* ── OCR status label helper ───────────────────────────── */
  const ocrLabel = (() => {
    switch (ocrStatus) {
      case 'scanning':
        return 'Processing via secure proxy…'
      case 'done':
        return ocrRawText ? 'Text detected' : 'No text found'
      case 'error':
        return 'Analysis failed'
      default:
        return null
    }
  })()

  return (
    <div className="flex-1 flex flex-col max-w-lg mx-auto w-full animate-fade-in">
      {/* ── Camera Viewport ──────────────────────────────── */}
      <div className="relative px-4 pt-4">
        <div
          id="camera-viewport"
          className="relative w-full overflow-hidden rounded-2xl bg-surface-900 border border-white/5 shadow-2xl"
          style={{ aspectRatio: '4 / 3' }}
        >
          {/* Video Element */}
          <video
            ref={videoRef}
            className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${
              capturedImage ? 'opacity-0' : 'opacity-100'
            }`}
            playsInline
            muted
            autoPlay
          />

          {/* Captured Image */}
          {capturedImage && (
            <img
              src={capturedImage}
              alt="Captured"
              className="absolute inset-0 w-full h-full object-cover animate-fade-in"
            />
          )}

          {/* Hidden Canvas for capturing */}
          <canvas ref={canvasRef} className="hidden" />

          {/* ── Overlay with Cut-out ────────────────────── */}
          {!capturedImage && isStreaming && (
            <>
              {/* Dark overlay with transparent center cutout */}
              <div className="absolute inset-0 pointer-events-none">
                <div className="absolute top-0 left-0 right-0 h-[15%] bg-black/50" />
                <div className="absolute bottom-0 left-0 right-0 h-[15%] bg-black/50" />
                <div className="absolute top-[15%] left-0 w-[12%] bottom-[15%] bg-black/50" />
                <div className="absolute top-[15%] right-0 w-[12%] bottom-[15%] bg-black/50" />
              </div>

              {/* ── Alignment Box ──────────────────────── */}
              <div
                className="absolute pointer-events-none"
                style={{
                  top: '15%',
                  left: '12%',
                  right: '12%',
                  bottom: '15%',
                }}
              >
                <div className="corner-brackets absolute inset-0">
                  <div className="corner-bl" />
                  <div className="corner-br" />
                </div>
                <div className="scan-line" style={{ left: 0, right: 0 }} />
                <div className="absolute bottom-3 left-0 right-0 flex justify-center">
                  <span className="px-3 py-1 rounded-full bg-black/60 backdrop-blur-sm text-[11px] font-medium text-surface-300 tracking-wide">
                    Align product within frame
                  </span>
                </div>
              </div>
            </>
          )}

          {/* ── Scanning Overlay ───────────────────────── */}
          {capturedImage && ocrStatus === 'scanning' && (
            <div className="absolute inset-0 bg-surface-950/60 backdrop-blur-[2px] flex flex-col items-center justify-center gap-3 animate-fade-in pointer-events-none z-10">
              {/* Animated scanner ring */}
              <div className="relative w-16 h-16">
                <div className="absolute inset-0 rounded-full border-2 border-primary-500/20" />
                <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-primary-400 animate-spin" />
                <div className="absolute inset-2 rounded-full border-2 border-transparent border-b-primary-300 animate-spin" style={{ animationDirection: 'reverse', animationDuration: '0.8s' }} />
                <div className="absolute inset-0 flex items-center justify-center">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="w-5 h-5 text-primary-400"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                    <line x1="16" y1="13" x2="8" y2="13" />
                    <line x1="16" y1="17" x2="8" y2="17" />
                    <polyline points="10 9 9 9 8 9" />
                  </svg>
                </div>
              </div>
              <div className="text-center">
                <p className="text-sm font-semibold text-white">
                  Processing via secure proxy…
                </p>
                <div className="mt-2 w-36 mx-auto">
                  <div className="h-1 rounded-full bg-white/10 overflow-hidden relative">
                    <div className="absolute top-0 bottom-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-primary-400 to-transparent animate-[slideRight_1s_ease-in-out_infinite]" />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── Camera Error State ──────────────────────── */}
          {cameraError && (
            <div className="absolute inset-0 flex flex-col items-center justify-center p-6 bg-surface-900">
              <div className="w-16 h-16 rounded-2xl bg-red-500/10 flex items-center justify-center mb-4">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="w-8 h-8 text-red-400"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
                  <line x1="2" y1="2" x2="22" y2="22" />
                </svg>
              </div>
              <p className="text-sm text-surface-400 text-center max-w-[250px] leading-relaxed">
                {cameraError}
              </p>
              <button
                onClick={startCamera}
                className="mt-4 px-5 py-2 rounded-xl bg-primary-600 hover:bg-primary-500 text-sm font-semibold text-white transition-colors btn-press"
              >
                Retry
              </button>
            </div>
          )}

          {/* ── Loading State ──────────────────────────── */}
          {!isStreaming && !capturedImage && !cameraError && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-surface-900">
              <div className="w-10 h-10 rounded-full border-2 border-primary-500/30 border-t-primary-500 animate-spin" />
              <p className="mt-3 text-xs text-surface-500 font-medium">
                Initializing camera…
              </p>
            </div>
          )}

          {/* ── Capture Button (floating) ──────────────── */}
          {isStreaming && !capturedImage && (
            <button
              id="btn-capture"
              onClick={captureFrame}
              className="absolute bottom-4 left-1/2 -translate-x-1/2 group btn-press"
              aria-label="Capture photo"
            >
              <div className="w-14 h-14 rounded-full bg-white/90 group-hover:bg-white border-4 border-white/30 group-hover:border-primary-400/50 shadow-lg group-hover:shadow-glow transition-all duration-200 flex items-center justify-center">
                <div className="w-10 h-10 rounded-full bg-white border-2 border-surface-200 group-hover:border-primary-300 transition-colors" />
              </div>
            </button>
          )}

          {/* ── Save Flash ─────────────────────────────── */}
          {saveFlash && (
            <div className="absolute inset-0 bg-primary-500/20 animate-fade-in pointer-events-none" />
          )}
        </div>

        {/* ── OCR Status Pill (below viewport) ────────── */}
        {ocrLabel && capturedImage && (
          <div className="flex justify-center mt-2.5 animate-fade-in">
            <span
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-semibold tracking-wide ${
                ocrStatus === 'scanning'
                  ? 'bg-primary-500/10 text-primary-400 border border-primary-500/20'
                  : ocrStatus === 'done' && ocrRawText
                    ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                    : ocrStatus === 'done' && !ocrRawText
                      ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                      : 'bg-red-500/10 text-red-400 border border-red-500/20'
              }`}
            >
              {ocrStatus === 'scanning' && (
                <span className="w-1.5 h-1.5 rounded-full bg-primary-400 animate-pulse" />
              )}
              {ocrStatus === 'done' && ocrRawText && (
                <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              )}
              {ocrLabel}
            </span>
          </div>
        )}
      </div>

      {/* ── Form Section ─────────────────────────────────── */}
      <div className="flex-1 flex flex-col px-4 pt-5 pb-6 gap-3 animate-slide-up">
        {/* Product Name */}
        <div className="group">
          <label
            htmlFor="input-product-name"
            className="block text-xs font-semibold text-surface-400 uppercase tracking-wider mb-1.5 ml-1 group-focus-within:text-primary-400 transition-colors"
          >
            Product Name
            {ocrStatus === 'done' && ocrRawText && (
              <span className="ml-2 normal-case tracking-normal text-[10px] text-emerald-400/80 font-medium">
                ✦ auto-filled by Azure
              </span>
            )}
          </label>
          <input
            id="input-product-name"
            type="text"
            placeholder="Enter product name…"
            value={productName}
            onChange={(e) => setProductName(e.target.value)}
            className={`focus-ring w-full px-4 py-3 rounded-xl bg-surface-800/80 border 
                       text-white placeholder-surface-500 text-sm font-medium
                       hover:border-white/10 focus:border-primary-500/40 focus:bg-surface-800
                       transition-all duration-200 ${
                         ocrStatus === 'done' && ocrRawText
                           ? 'border-emerald-500/20'
                           : 'border-white/5'
                       }`}
          />
        </div>

        {/* Batch No. */}
        <div className="group">
          <label
            htmlFor="input-batch-no"
            className="block text-xs font-semibold text-surface-400 uppercase tracking-wider mb-1.5 ml-1 group-focus-within:text-primary-400 transition-colors"
          >
            Batch No.
            {ocrStatus === 'done' && batchNo && batchConfidence !== 'low' && (
              <span
                className={`ml-2 normal-case tracking-normal text-[10px] font-medium ${
                  batchConfidence === 'high'
                    ? 'text-emerald-400/80'
                    : 'text-amber-400/80'
                }`}
              >
                {batchConfidence === 'high' ? '✦ extracted (high confidence)' : '✦ extracted (check value)'}
              </span>
            )}
          </label>
          <input
            id="input-batch-no"
            type="text"
            value={batchNo}
            onChange={(e) => setBatchNo(e.target.value)}
            placeholder="Extracted from scan or enter manually…"
            className={`focus-ring w-full px-4 py-3 rounded-xl bg-surface-800/80 border
                       text-white placeholder-surface-500 text-sm font-medium
                       hover:border-white/10 focus:border-primary-500/40 focus:bg-surface-800
                       transition-all duration-200 ${
                         ocrStatus === 'done' && batchNo && batchConfidence === 'high'
                           ? 'border-emerald-500/20'
                           : ocrStatus === 'done' && batchNo && batchConfidence === 'medium'
                             ? 'border-amber-500/20'
                             : 'border-white/5'
                       }`}
          />
        </div>

        {/* ── OCR Extracted Text (collapsible) ────────────── */}
        {ocrStatus === 'done' && ocrRawText && (
          <div className="animate-slide-up">
            <label className="block text-xs font-semibold text-surface-400 uppercase tracking-wider mb-1.5 ml-1">
              Detected Text
            </label>
            <div className="w-full px-4 py-3 rounded-xl bg-surface-800/40 border border-white/5 
                            text-surface-400 text-xs font-mono leading-relaxed max-h-20 overflow-y-auto">
              {ocrRawText}
            </div>
          </div>
        )}

        {/* ── Action Buttons ─────────────────────────────── */}
        <div className="flex gap-3 mt-2">
          <button
            id="btn-retake"
            onClick={handleRetake}
            className="btn-press flex-1 flex items-center justify-center gap-2 py-3.5 rounded-xl
                       bg-surface-800/80 hover:bg-surface-700/80 border border-white/5 hover:border-white/10
                       text-sm font-semibold text-surface-300 hover:text-white
                       transition-all duration-200"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="w-4 h-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
            </svg>
            Retake
          </button>

          <button
            id="btn-save"
            onClick={handleSave}
            disabled={!productName.trim() || !capturedImage}
            className="btn-press flex-1 flex items-center justify-center gap-2 py-3.5 rounded-xl
                       bg-gradient-to-r from-primary-600 to-primary-500 hover:from-primary-500 hover:to-primary-400
                       text-sm font-bold text-white shadow-glow hover:shadow-glow-lg
                       disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none disabled:from-surface-700 disabled:to-surface-600
                       transition-all duration-200"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="w-4 h-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
              <polyline points="17 21 17 13 7 13 7 21" />
              <polyline points="7 3 7 8 15 8" />
            </svg>
            Save Item
          </button>
        </div>
      </div>

      <style>{`
        @keyframes slideRight {
          0% { left: -33%; }
          100% { left: 100%; }
        }
      `}</style>
    </div>
  )
}
