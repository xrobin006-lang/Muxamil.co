import { NextRequest } from 'next/server'
import { ok, fail, guard, errors } from '@/lib/api-helpers'
import { getActiveUser } from '@/lib/auth'
import {
  BUCKETS,
  storageUpload,
  storagePublicUrl,
  storageSignedUrl,
  storagePathFor,
} from '@/lib/supabase'

const CATEGORY_LIMITS: Record<string, { types: Record<string, number>; maxBytes: number }> = {
  avatar: {
    maxBytes: 5 * 1024 * 1024,
    types: {
      'image/jpeg': 5 * 1024 * 1024,
      'image/png': 5 * 1024 * 1024,
      'image/webp': 5 * 1024 * 1024,
      'image/gif': 5 * 1024 * 1024,
    },
  },
  banner: {
    // mux-banners bucket limit is 8 MB per object.
    maxBytes: 8 * 1024 * 1024,
    types: {
      'image/jpeg': 8 * 1024 * 1024,
      'image/png': 8 * 1024 * 1024,
      'image/webp': 8 * 1024 * 1024,
      'image/gif': 8 * 1024 * 1024,
    },
  },
  'post-media': {
    maxBytes: 100 * 1024 * 1024,
    types: {
      'image/jpeg': 10 * 1024 * 1024,
      'image/png': 10 * 1024 * 1024,
      'image/webp': 10 * 1024 * 1024,
      'image/gif': 15 * 1024 * 1024,
      'video/mp4': 100 * 1024 * 1024,
      'video/webm': 100 * 1024 * 1024,
      'video/quicktime': 100 * 1024 * 1024,
      'audio/mpeg': 30 * 1024 * 1024,
      'audio/mp3': 30 * 1024 * 1024,
      'audio/wav': 30 * 1024 * 1024,
      'audio/x-wav': 30 * 1024 * 1024,
      'audio/ogg': 30 * 1024 * 1024,
      'audio/webm': 30 * 1024 * 1024,
      'audio/mp4': 30 * 1024 * 1024,
      'audio/x-m4a': 30 * 1024 * 1024,
      'application/pdf': 20 * 1024 * 1024,
    },
  },
  'community-media': {
    maxBytes: 100 * 1024 * 1024,
    types: {
      'image/jpeg': 10 * 1024 * 1024,
      'image/png': 10 * 1024 * 1024,
      'image/webp': 10 * 1024 * 1024,
      'image/gif': 15 * 1024 * 1024,
      'video/mp4': 100 * 1024 * 1024,
      'video/webm': 100 * 1024 * 1024,
      'audio/mpeg': 30 * 1024 * 1024,
      'audio/mp3': 30 * 1024 * 1024,
      'audio/wav': 30 * 1024 * 1024,
      'audio/ogg': 30 * 1024 * 1024,
      'application/pdf': 20 * 1024 * 1024,
    },
  },
  'payment-proof': {
    maxBytes: 4 * 1024 * 1024,
    types: {
      'image/jpeg': 4 * 1024 * 1024,
      'image/png': 4 * 1024 * 1024,
      'image/webp': 4 * 1024 * 1024,
    },
  },
  'message-media': {
    maxBytes: 25 * 1024 * 1024,
    types: {
      'image/jpeg': 10 * 1024 * 1024,
      'image/png': 10 * 1024 * 1024,
      'image/webp': 10 * 1024 * 1024,
      'image/gif': 10 * 1024 * 1024,
      'application/pdf': 20 * 1024 * 1024,
      // Voice messages: MediaRecorder produces audio/webm (opus) on Chrome/Edge/Firefox
      // and audio/mp4 (aac) on Safari.
      'audio/webm': 16 * 1024 * 1024,
      'audio/mp4': 16 * 1024 * 1024,
      'audio/ogg': 16 * 1024 * 1024,
      'audio/mpeg': 16 * 1024 * 1024,
      'audio/wav': 16 * 1024 * 1024,
    },
  },
}

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/ogg': 'ogg',
  'audio/webm': 'weba',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'application/pdf': 'pdf',
}

/** Magic-byte sniffing — never trust the declared MIME/extension alone. */
function sniff(buf: Buffer): string | null {
  if (buf.length < 12) return null
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg'
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png'
  if (buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp'
  if (buf.subarray(0, 3).toString('ascii') === 'GIF') return 'image/gif'
  if (buf.subarray(0, 4).toString('ascii') === '%PDF') return 'application/pdf'
  if (buf.subarray(4, 8).toString('ascii') === 'ftyp') return 'video/mp4'
  if (buf.subarray(0, 4).toString('ascii') === 'OggS') return 'audio/ogg'
  if (buf.subarray(0, 3).toString('ascii') === 'ID3') return 'audio/mpeg'
  if (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) return 'audio/mpeg'
  // webm/quicktime/m4a/wav cannot be sniffed cheaply — extension+mime check remains
  return null
}

/** Post/community media is bucketed by MIME family. */
function postBucketFor(mime: string): string {
  if (mime.startsWith('image/')) return BUCKETS.postImage
  if (mime.startsWith('video/')) return BUCKETS.postVideo
  return BUCKETS.postDocument
}

export async function POST(req: NextRequest) {
  return guard(async () => {
    const user = await getActiveUser()
    if (!user) return errors.unauthorized()

    const form = await req.formData().catch(() => null)
    if (!form) return fail('Invalid upload request.')

    const category = String(form.get('category') || '')
    const limits = CATEGORY_LIMITS[category]
    if (!limits) return fail('Unsupported upload category.')

    const file = form.get('file')
    if (!(file instanceof File)) return fail('No file provided.')
    if (file.size === 0) return fail('The file is empty.')
    if (file.size > limits.maxBytes) return fail('File is too large.')

    const declaredMime = file.type.toLowerCase().split(';')[0]
    const limitForMime = limits.types[declaredMime]
    if (!limitForMime) return fail('This file type is not allowed here.')
    if (file.size > limitForMime) return fail('File is too large.')

    // Filename sanity — reject path separators and control characters before
    // the name is ever used to build a storage path.
    if (/[\\/]/.test(file.name) || /[\x00-\x1f\x7f]/.test(file.name)) {
      return fail('Invalid file name.')
    }

    const buf = Buffer.from(await file.arrayBuffer())
    const sniffed = sniff(buf)
    // For types we can sniff, the sniffed type must match the declared family.
    if (sniffed && sniffed !== declaredMime) {
      const sniffedAllowed = !!limits.types[sniffed]
      if (!sniffedAllowed) return fail('This file type is not allowed here.')
    }

    // Guarantee the stored object keeps a sane extension for the declared MIME.
    const originalName = file.name.slice(0, 180)
    const ext = EXT_BY_MIME[declaredMime] || 'bin'
    const baseName = /\.[a-z0-9]{1,8}$/i.test(originalName) ? originalName : `${originalName || 'file'}.${ext}`

    let url: string
    let uploadPath: string
    if (category === 'avatar') {
      // Public bucket, one folder per profile.
      const path = storagePathFor(`profiles/${user.id}`, baseName)
      uploadPath = path
      await storageUpload(BUCKETS.avatar, path, buf, declaredMime)
      url = storagePublicUrl(BUCKETS.avatar, path)
    } else if (category === 'banner') {
      // Dedicated public bucket, one folder per profile.
      const path = storagePathFor(`profiles/${user.id}`, baseName)
      uploadPath = path
      await storageUpload(BUCKETS.banner, path, buf, declaredMime)
      url = storagePublicUrl(BUCKETS.banner, path)
    } else if (category === 'post-media' || category === 'community-media') {
      // Public buckets picked by MIME family, one folder per author.
      const bucket = postBucketFor(declaredMime)
      const path = storagePathFor(`posts/${user.id}`, baseName)
      uploadPath = path
      await storageUpload(bucket, path, buf, declaredMime)
      url = storagePublicUrl(bucket, path)
    } else if (category === 'payment-proof') {
      // Private payment screenshots.
      const paymentProofPath = storagePathFor('payment-proofs/' + user.id, baseName)
      await storageUpload(BUCKETS.message, paymentProofPath, buf, declaredMime)
      url = await storageSignedUrl(BUCKETS.message, paymentProofPath)
      uploadPath = paymentProofPath
    } else {
      // message-media — PRIVATE bucket, served through long-lived signed URLs.
      const path = storagePathFor(`messages/${user.id}`, baseName)
      uploadPath = path
      await storageUpload(BUCKETS.message, path, buf, declaredMime)
      url = await storageSignedUrl(BUCKETS.message, path)
    }

    return ok({
      url,
      path: uploadPath,
      fileName: file.name.slice(0, 180),
      mimeType: declaredMime,
      fileSize: file.size,
      fileType: classifyFile(declaredMime),
    })
  })
}

function classifyFile(mime: string): 'image' | 'video' | 'audio' | 'pdf' | 'document' {
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  if (mime === 'application/pdf') return 'pdf'
  return 'document'
}
