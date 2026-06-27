/**
 * File processing service — OCR and text extraction.
 *
 * All processing happens in memory (no filesystem writes),
 * making it compatible with serverless environments like Vercel.
 */

import { PDFParse } from 'pdf-parse'
import mammoth from 'mammoth'

// ---- Types ----

export interface ProcessedFile {
  /** Original filename */
  filename: string
  /** MIME type */
  mimetype: string
  /** File size in bytes */
  size: number
  /** Extracted text content */
  text: string
  /** Base64 data URL for images (used for multimodal LLM input) */
  dataUrl?: string
}

// ---- Constants ----

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp'])
const ALLOWED_DOC_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
])

// ---- OCR via DeepSeek VL ----

async function performOCR(base64Image: string, mimeType: string): Promise<string> {
  const apiKey = process.env.DEEPSEEK_API_KEY
  if (!apiKey) {
    throw new Error('DEEPSEEK_API_KEY environment variable is required.')
  }

  const dataUrl = `data:${mimeType};base64,${base64Image}`

  const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: '请仔细识别图片中的所有文字内容，包括表格、表单字段、标签等。直接输出识别到的文字，不要添加额外说明。' },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        },
      ],
      max_tokens: 4096,
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`DeepSeek API error (${response.status}): ${errorText}`)
  }

  const data = (await response.json()) as {
    choices: Array<{ message: { content: string } }>
  }

  return data.choices[0]?.message?.content ?? ''
}

// ---- Text extraction from documents ----

async function extractPdfText(buffer: Buffer): Promise<string> {
  const parser = new PDFParse({ data: buffer })
  try {
    const textResult = await parser.getText()
    return textResult.text
  } finally {
    await parser.destroy()
  }
}

async function extractDocxText(buffer: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer })
  return result.value
}

function extractPlainText(buffer: Buffer): string {
  return buffer.toString('utf-8')
}

// ---- Main processing function ----

/**
 * Process an uploaded file buffer.
 *
 * - Images: OCR via DeepSeek VL, returns text + dataUrl for multimodal context
 * - PDFs: text extraction via pdf-parse
 * - DOC/DOCX: text extraction via mammoth
 * - TXT: direct UTF-8 read
 */
export async function processFile(
  buffer: Buffer,
  filename: string,
  mimetype: string,
): Promise<ProcessedFile> {
  // Validate file size
  if (buffer.length > MAX_FILE_SIZE) {
    throw new Error(`File size exceeds maximum limit of ${MAX_FILE_SIZE / 1024 / 1024}MB`)
  }

  // Image processing — OCR
  if (ALLOWED_IMAGE_TYPES.has(mimetype)) {
    const base64 = buffer.toString('base64')
    const dataUrl = `data:${mimetype};base64,${base64}`
    const text = await performOCR(base64, mimetype)

    return {
      filename,
      mimetype,
      size: buffer.length,
      text,
      dataUrl,
    }
  }

  // Document processing
  if (!ALLOWED_DOC_TYPES.has(mimetype)) {
    throw new Error(`Unsupported file type: ${mimetype}. Allowed: images, PDF, DOC, DOCX, TXT`)
  }

  let text = ''

  if (mimetype === 'application/pdf') {
    text = await extractPdfText(buffer)
  } else if (
    mimetype === 'application/msword' ||
    mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    text = await extractDocxText(buffer)
  } else {
    // text/plain
    text = extractPlainText(buffer)
  }

  return {
    filename,
    mimetype,
    size: buffer.length,
    text,
  }
}

/**
 * Validate that the file type is supported.
 */
export function isAllowedFileType(mimetype: string): boolean {
  return ALLOWED_IMAGE_TYPES.has(mimetype) || ALLOWED_DOC_TYPES.has(mimetype)
}

/**
 * Check if the MIME type is an image type.
 */
export function isImageType(mimetype: string): boolean {
  return ALLOWED_IMAGE_TYPES.has(mimetype)
}
