const express = require('express')
const router = express.Router()
const { query } = require('../config/database')
const { authenticate } = require('../middleware/auth')

// Limites mémoire par Gear
// Gear 5 : pas de limite fixe — rotation automatique des souvenirs les moins importants
const MEMORY_LIMITS = { 1: 10, 2: 20, 3: 50, 4: 150 }

// GET /api/memory
router.get('/', authenticate, async (req, res) => {
  const result = await query(
    'SELECT * FROM ai_memories WHERE user_id = $1 ORDER BY importance DESC, created_at DESC',
    [req.user.id]
  )
  res.json({ memories: result.rows })
})

// POST /api/memory
router.post('/', authenticate, async (req, res) => {
  const { content, category, importance = 5 } = req.body
  if (!content) return res.status(400).json({ error: 'Contenu requis' })

  const isAdmin = req.user.role === 'admin'
  const userGear = req.user.gear || 1
  // Gear 5 : null = pas de limite fixe, rotation invisible uniquement
  const memoryLimit = isAdmin || userGear >= 5 ? null : (MEMORY_LIMITS[userGear] || 10)

  if (!isAdmin && memoryLimit !== null) {
    const countResult = await query(
      'SELECT COUNT(*) FROM ai_memories WHERE user_id = $1 AND is_active = true',
      [req.user.id]
    )
    const count = parseInt(countResult.rows[0].count)
    if (count >= memoryLimit) {
      // Gear 1-2 : message visible
      if (userGear <= 2) {
        return res.status(403).json({
          error: `Limite de ${memoryLimit} souvenirs atteinte. Passez au Gear supérieur.`,
          code: 'MEMORY_LIMIT_REACHED',
          limit: memoryLimit, used: count,
        })
      }
      // Gear 3+ : supprime le plus ancien silencieusement (rotation invisible)
      await query(
        `DELETE FROM ai_memories WHERE id = (
          SELECT id FROM ai_memories WHERE user_id = $1
          ORDER BY importance ASC, created_at ASC LIMIT 1
        )`,
        [req.user.id]
      )
    }
  }

  // Gear 5 : optimisation mémoire dynamique basée sur la charge serveur
  // Aucun seuil fixe — rotation uniquement si le serveur est sous pression
  if (!isAdmin && userGear >= 5) {
    const memUsage = process.memoryUsage()
    const memPressure = memUsage.heapUsed / memUsage.heapTotal
    if (memPressure > 0.80) {
      // Supprime silencieusement le souvenir le moins important si serveur sous pression
      await query(
        `DELETE FROM ai_memories WHERE id = (
          SELECT id FROM ai_memories WHERE user_id = $1
          ORDER BY importance ASC, created_at ASC LIMIT 1
        )`,
        [req.user.id]
      ).catch(() => {}) // Silencieux
    }
  }

  const result = await query(
    'INSERT INTO ai_memories (user_id, content, category, importance) VALUES ($1, $2, $3, $4) RETURNING *',
    [req.user.id, content, category, importance]
  )
  res.status(201).json({ memory: result.rows[0] })
})

// DELETE /api/memory/:id
router.delete('/:id', authenticate, async (req, res) => {
  await query('DELETE FROM ai_memories WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id])
  res.json({ message: 'Mémoire supprimée' })
})

// DELETE /api/memory/all
router.delete('/', authenticate, async (req, res) => {
  await query('DELETE FROM ai_memories WHERE user_id = $1', [req.user.id])
  res.json({ message: 'Toutes les mémoires supprimées' })
})

module.exports = router
