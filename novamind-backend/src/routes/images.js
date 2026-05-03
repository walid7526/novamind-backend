const express = require('express')
const router = express.Router()
const OpenAI = require('openai')
const { query } = require('../config/database')
const { authenticate, requireGear } = require('../middleware/auth')

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

// ==============================
// POST /api/images/generate
// ==============================
router.post('/generate', authenticate, async (req, res) => {
  try {
    const { prompt, size = '1024x1024', quality = 'standard' } = req.body
    const isAdmin = req.user.role === 'admin'
    const userGear = req.user.gear

    if (!prompt?.trim()) {
      return res.status(400).json({ error: 'Prompt requis' })
    }

    // Vérification Gear
    if (!isAdmin && userGear < 3) {
      return res.status(403).json({ error: 'Gear 3 requis pour la génération d\'images', code: 'GEAR_REQUIRED' })
    }
    if (!isAdmin && quality === 'hd' && userGear < 4) {
      return res.status(403).json({ error: 'Gear 4 requis pour la qualité HD', code: 'GEAR_REQUIRED' })
    }

    // Tailles supportées par DALL-E 3
    const validSizes = ['1024x1024', '1792x1024', '1024x1792']
    const dalleSize = validSizes.includes(size) ? size : '1024x1024'
    const dalleQuality = quality === 'hd' ? 'hd' : 'standard'

    // Appel DALL-E 3
    const response = await openai.images.generate({
      model: 'dall-e-3',
      prompt: prompt.slice(0, 4000),
      n: 1,
      size: dalleSize,
      quality: dalleQuality,
      response_format: 'url',
    })

    const imageUrl = response.data[0].url
    const revisedPrompt = response.data[0].revised_prompt || prompt

    // Sauvegarde en base
    const result = await query(
      `INSERT INTO generated_images (user_id, prompt, image_url, model, resolution)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.user.id, revisedPrompt, imageUrl, 'dall-e-3', dalleSize]
    )

    res.json({ image: result.rows[0] })
  } catch (error) {
    console.error('Erreur génération image:', error)
    if (error.code === 'content_policy_violation') {
      return res.status(400).json({ error: 'Ce prompt viole les règles de contenu. Essayez une description différente.' })
    }
    res.status(500).json({ error: 'Erreur lors de la génération de l\'image' })
  }
})

// ==============================
// GET /api/images
// Historique des images
// ==============================
router.get('/', authenticate, async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query
    const offset = (page - 1) * limit

    const result = await query(
      `SELECT * FROM generated_images WHERE user_id = $1
       ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [req.user.id, limit, offset]
    )

    res.json({ images: result.rows })
  } catch (error) {
    res.status(500).json({ error: 'Erreur récupération historique' })
  }
})

// ==============================
// DELETE /api/images/:id
// ==============================
router.delete('/:id', authenticate, async (req, res) => {
  try {
    await query(
      'DELETE FROM generated_images WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    )
    res.json({ message: 'Image supprimée' })
  } catch (error) {
    res.status(500).json({ error: 'Erreur suppression' })
  }
})

module.exports = router
