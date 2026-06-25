import type { VercelRequest, VercelResponse } from '@vercel/node'

// Helper for polling delay
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' })
  }

  const endpoint = process.env.AZURE_ENDPOINT
  const key = process.env.AZURE_KEY

  if (!endpoint || !key) {
    return res.status(500).json({ 
      error: 'Azure credentials are not configured on the server.' 
    })
  }

  try {
    let buffer: Buffer
    if (Buffer.isBuffer(req.body)) {
      buffer = req.body
    } else if (req.body && typeof req.body.image === 'string') {
      const base64Data = req.body.image.replace(/^data:image\/\w+;base64,/, '')
      buffer = Buffer.from(base64Data, 'base64')
    } else {
      return res.status(400).json({ error: 'Missing or invalid image payload. Expected raw binary blob.' })
    }

    // 1. Submit the image for analysis
    const analyzeUrl = `${endpoint.replace(/\/$/, '')}/vision/v3.2/read/analyze`
    
    const analyzeRes = await fetch(analyzeUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'Ocp-Apim-Subscription-Key': key
      },
      body: buffer
    })

    if (!analyzeRes.ok) {
      const errText = await analyzeRes.text()
      console.error('Azure Vision analyze error:', errText)
      return res.status(analyzeRes.status).json({ error: 'Failed to initiate analysis with Azure.' })
    }

    // 2. Get the polling URL from the headers
    const operationLocation = analyzeRes.headers.get('Operation-Location')
    if (!operationLocation) {
      return res.status(500).json({ error: 'No Operation-Location returned from Azure.' })
    }

    // 3. Poll for the result
    let status = 'running'
    let attempts = 0
    let resultJson: any = null
    const MAX_ATTEMPTS = 15 // 15 seconds max

    while ((status === 'running' || status === 'notStarted') && attempts < MAX_ATTEMPTS) {
      await delay(1000) // Poll every 1 second
      attempts++

      const pollRes = await fetch(operationLocation, {
        headers: {
          'Ocp-Apim-Subscription-Key': key
        }
      })

      if (!pollRes.ok) {
        return res.status(pollRes.status).json({ error: 'Failed to poll Azure operation status.' })
      }

      resultJson = await pollRes.json()
      status = resultJson.status
    }

    if (status !== 'succeeded') {
      return res.status(408).json({ error: 'Azure OCR operation timed out or failed.' })
    }

    // 4. Extract lines of text from the result
    const textLines: string[] = []
    if (resultJson.analyzeResult && resultJson.analyzeResult.readResults) {
      for (const page of resultJson.analyzeResult.readResults) {
        for (const line of page.lines) {
          if (line.text) {
            textLines.push(line.text)
          }
        }
      }
    }

    return res.status(200).json({ lines: textLines })

  } catch (err: any) {
    console.error('Azure OCR Endpoint Error:', err)
    return res.status(500).json({ error: err.message || 'Internal Server Error' })
  }
}
