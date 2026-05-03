const express = require('express')
const router = express.Router()
const multer = require('multer')
const path = require('path')
const fs = require('fs')
const { execSync } = require('child_process')
const OpenAI = require('openai')
const { query } = require('../config/database')
const { authenticate } = require('../middleware/auth')

let _openai = null
const getOpenAI = () => {
  if (!_openai) {
    const { default: OpenAI } = require("openai")
    _openai = new OpenAI({ apiKey: process.env.OPENROUTER_API_KEY, baseURL: "https://openrouter.ai/api/v1" })
  }
  return _openai}

// ==============================
// CONFIG MULTER
// ==============================
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = '/tmp/novamind-uploads'
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    cb(null, dir)
  },
  filename: (req, file, cb) => {
    const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    cb(null, `${unique}${path.extname(file.originalname)}`)
  },
})

const fileFilter = (req, file, cb) => {
  const allowed = [
    // Images
    'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic',
    // Documents
    'application/pdf', 'text/plain', 'text/csv',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    // Audio (Gear 2+)
    'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav',
    'audio/mp4', 'audio/m4a', 'audio/x-m4a', 'audio/ogg',
    'audio/webm', 'audio/aac',
    // Vidéo (Gear 3+)
    'video/mp4', 'video/quicktime', 'video/x-msvideo',
    'video/webm', 'video/mpeg', 'video/x-matroska',
  ]
  if (allowed.includes(file.mimetype) || file.mimetype.startsWith('audio/') || file.mimetype.startsWith('video/')) {
    cb(null, true)
  } else {
    cb(new Error('Type de fichier non supporté'), false)
  }
}

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB pour vidéo
})

// ==============================
// LIMITES PAR GEAR
// ==============================
const UPLOAD_LIMITS = { 1: 3, 2: 10, 3: 30, 4: 100 } // Gear 5 : pas de limite fixe — anti-abus uniquement

// ==============================
// PIPELINE AUDIO — Whisper
// ==============================
const transcribeAudio = async (audioPath) => {
  const audioStream = fs.createReadStream(audioPath)
  const response = await getOpenAI().audio.transcriptions.create({
    file: audioStream,
    model: 'whisper-1',
    language: 'fr',
    response_format: 'text',
  })
  return response
}

// ==============================
// PIPELINE VIDÉO — FFmpeg + Whisper
// ==============================
const processVideo = async (videoPath) => {
  const audioPath = videoPath.replace(/\.[^.]+$/, '_audio.mp3')
  const framesDir = videoPath.replace(/\.[^.]+$/, '_frames')

  // Extraction audio via FFmpeg
  execSync(`ffmpeg -i "${videoPath}" -vn -acodec mp3 -ar 16000 -ac 1 -b:a 64k "${audioPath}" -y 2>/dev/null`)

  let transcript = ''
  let frameDescriptions = []

  // Transcription audio avec Whisper
  if (fs.existsSync(audioPath)) {
    transcript = await transcribeAudio(audioPath)
    fs.unlinkSync(audioPath) // Nettoyage
  }

  // Extraction frames clés (1 frame toutes les 30 secondes)
  try {
    fs.mkdirSync(framesDir, { recursive: true })
    execSync(`ffmpeg -i "${videoPath}" -vf "fps=1/30,scale=512:-1" "${framesDir}/frame_%04d.jpg" -y 2>/dev/null`)

    const frames = fs.readdirSync(framesDir).filter(f => f.endsWith('.jpg')).slice(0, 5) // Max 5 frames

    if (frames.length > 0) {
      // Analyse visuelle des frames avec GPT-4o Vision
      const frameContents = frames.map(f => {
        const imgData = fs.readFileSync(path.join(framesDir, f))
        return {
          type: 'image_url',
          image_url: { url: `data:image/jpeg;base64,${imgData.toString('base64')}`, detail: 'low' }
        }
      })

      const visionResponse = await getOpenAI().chat.completions.create({
        model: 'gpt-4o',
        messages: [{
          role: 'user',
          content: [
            ...frameContents,
            { type: 'text', text: 'Décris brièvement ce que tu vois dans ces images extraites de la vidéo (contexte visuel, personnes, lieux, objets importants).' }
          ]
        }],
        max_tokens: 500,
      })
      frameDescriptions = visionResponse.choices[0].message.content
    }

    // Nettoyage frames
    frames.forEach(f => fs.unlinkSync(path.join(framesDir, f)))
    fs.rmdirSync(framesDir)
  } catch (e) {
    console.log('Extraction frames échouée (pas grave):', e.message)
  }

  return { transcript, frameDescriptions }
}

// ==============================
// POST /api/uploads/analyze
// Pipeline complet : image, doc, audio, vidéo
// ==============================
router.post('/analyze', authenticate, upload.single('file'), async (req, res) => {
  const isAdmin = req.user.role === 'admin'
  const userGear = req.user.gear || 1

  if (!req.file) return res.status(400).json({ error: 'Aucun fichier reçu' })

  const file = req.file
  const isImage = file.mimetype.startsWith('image/')
  const isAudio = file.mimetype.startsWith('audio/') || ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/m4a', 'audio/x-m4a', 'audio/ogg'].includes(file.mimetype)
  const isVideo = file.mimetype.startsWith('video/')

  // Vérifications Gear
  if (isAudio && !isAdmin && userGear < 2) {
    fs.unlinkSync(file.path)
    return res.status(403).json({ error: 'Gear 2 requis pour analyser des fichiers audio', code: 'GEAR_REQUIRED' })
  }
  if (isVideo && !isAdmin && userGear < 3) {
    fs.unlinkSync(file.path)
    return res.status(403).json({ error: 'Gear 3 requis pour analyser des vidéos', code: 'GEAR_REQUIRED' })
  }

  // Limite uploads par jour
  // Gear 5 : pas de limite fixe d'uploads — protection uniquement via throttling backend
  const dailyLimit = isAdmin || userGear >= 5 ? null : (UPLOAD_LIMITS[userGear] || 3)
  if (!isAdmin) {
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const uploadCount = await query(
      'SELECT COUNT(*) FROM uploads WHERE user_id = $1 AND created_at >= $2',
      [req.user.id, today.toISOString()]
    )
    const count = parseInt(uploadCount.rows[0].count)
    if (count >= dailyLimit) {
      fs.unlinkSync(file.path)
      // Gear 1-2 : message visible + blocage
      // Gear 3+ : ralentissement invisible uniquement (pas de blocage visible)
      if (userGear <= 2) {
        return res.status(403).json({
          error: `Limite de ${dailyLimit} uploads/jour atteinte. Passez au Gear supérieur.`,
          code: 'DAILY_LIMIT_REACHED',
          limit: dailyLimit, used: count,
        })
      }
      // Gear 3+ → on laisse passer mais on ralentit (anti-abus invisible)
      await new Promise(r => setTimeout(r, 2000 + Math.random() * 2000))
    }
  }

  // Gear 5 : protection dynamique basée sur la charge serveur — aucun compteur
  if (!isAdmin && userGear >= 5) {
    const serverLoad = process.cpuUsage()
    const memUsage = process.memoryUsage()
    const memPressure = memUsage.heapUsed / memUsage.heapTotal
    // Délai uniquement si le serveur est sous pression — invisible et adaptatif
    if (memPressure > 0.85) {
      await new Promise(r => setTimeout(r, Math.floor(Math.random() * 1500) + 500))
    }
  }

  const { conversation_id, question } = req.body

  try {
    let analysisResult = ''
    let fileType = 'document'
    let transcriptText = ''

    // ==============================
    // PIPELINE IMAGE
    // ==============================
    if (isImage) {
      fileType = 'image'
      const base64 = fs.readFileSync(file.path).toString('base64')
      const userQuestion = question?.trim() || 'Décris cette image en détail.'
      const response = await getOpenAI().chat.completions.create({
        model: 'gpt-4o',
        messages: [{
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: `data:${file.mimetype};base64,${base64}` } },
            { type: 'text', text: userQuestion },
          ],
        }],
        max_tokens: 2000,
      })
      analysisResult = response.choices[0].message.content

    // ==============================
    // PIPELINE AUDIO
    // ==============================
    } else if (isAudio) {
      fileType = 'audio'
      const userQuestion = question?.trim() || 'Transcris et résume ce contenu audio.'

      // Transcription Whisper
      transcriptText = await transcribeAudio(file.path)

      // Analyse du contenu transcrit
      const response = await getOpenAI().chat.completions.create({
        model: 'gpt-4o',
        messages: [{
          role: 'user',
          content: `Voici la transcription de l'audio "${file.originalname}" :\n\n${transcriptText}\n\n${userQuestion}`,
        }],
        max_tokens: 2000,
      })
      analysisResult = `📝 **Transcription :**\n${transcriptText}\n\n---\n\n🧠 **Analyse :**\n${response.choices[0].message.content}`

    // ==============================
    // PIPELINE VIDÉO
    // ==============================
    } else if (isVideo) {
      fileType = 'video'
      const userQuestion = question?.trim() || 'Analyse cette vidéo : transcris le contenu audio et décris ce que tu vois.'

      // Extraction audio + frames via FFmpeg
      const { transcript, frameDescriptions } = await processVideo(file.path)
      transcriptText = transcript

      // Contexte complet pour l'IA
      let videoContext = `Fichier vidéo : "${file.originalname}"\n\n`
      if (transcript) videoContext += `📝 Transcription audio :\n${transcript}\n\n`
      if (frameDescriptions) videoContext += `🎬 Contenu visuel :\n${frameDescriptions}\n\n`

      const response = await getOpenAI().chat.completions.create({
        model: 'gpt-4o',
        messages: [{
          role: 'user',
          content: `${videoContext}\n${userQuestion}`,
        }],
        max_tokens: 2500,
      })

      analysisResult = videoContext + `---\n\n🧠 **Analyse IA :**\n${response.choices[0].message.content}`

    // ==============================
    // PIPELINE DOCUMENT TEXTE
    // ==============================
    } else {
      fileType = 'document'
      const userQuestion = question?.trim() || 'Résume ce document et extrais les points clés.'
      let textContent = ''
      try {
        textContent = fs.readFileSync(file.path, 'utf-8').slice(0, 50000)
      } catch {
        textContent = `[Fichier: ${file.originalname}]`
      }
      const response = await getOpenAI().chat.completions.create({
        model: 'gpt-4o',
        messages: [{
          role: 'user',
          content: `Fichier: "${file.originalname}"\n\n${textContent}\n\n${userQuestion}`,
        }],
        max_tokens: 2000,
      })
      analysisResult = response.choices[0].message.content
    }

    // Sauvegarde en base
    const saved = await query(
      `INSERT INTO uploads (user_id, conversation_id, filename, original_name, file_type, file_size, url, is_analyzed, analysis_result)
       VALUES ($1,$2,$3,$4,$5,$6,$7,true,$8) RETURNING *`,
      [req.user.id, conversation_id || null, file.filename, file.originalname, file.mimetype, file.size, `/uploads/${file.filename}`, analysisResult]
    )

    // Nettoyage fichier temp
    fs.unlink(file.path, () => {})

    res.json({
      upload: saved.rows[0],
      analysis: analysisResult,
      filename: file.originalname,
      file_type: fileType,
      is_image: isImage,
      is_audio: isAudio,
      is_video: isVideo,
      transcript: transcriptText || null,
    })

  } catch (error) {
    fs.unlink(file.path, () => {})
    console.error('Erreur analyse fichier:', error)
    res.status(500).json({ error: 'Erreur lors de l\'analyse du fichier : ' + error.message })
  }
})

// GET /api/uploads
router.get('/', authenticate, async (req, res) => {
  const result = await query(
    'SELECT id, original_name, file_type, file_size, is_analyzed, created_at FROM uploads WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50',
    [req.user.id]
  )
  res.json({ uploads: result.rows })
})

// DELETE /api/uploads/:id
router.delete('/:id', authenticate, async (req, res) => {
  await query('DELETE FROM uploads WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id])
  res.json({ message: 'Fichier supprimé' })
})

module.exports = router
