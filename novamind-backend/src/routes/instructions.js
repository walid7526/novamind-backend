const express = require('express')
const router = express.Router()
const { query } = require('../config/database')
const { authenticate } = require('../middleware/auth')

// ==============================
// GET /api/instructions
// Récupère les instructions personnalisées
// ==============================
router.get('/', authenticate, async (req, res) => {
  try {
    const result = await query(
      'SELECT custom_instructions, ai_persona FROM users WHERE id = $1',
      [req.user.id]
    )
    res.json({
      instructions: result.rows[0]?.custom_instructions || '',
      persona: result.rows[0]?.ai_persona || '',
    })
  } catch (e) {
    res.status(500).json({ error: 'Erreur récupération instructions' })
  }
})

// ==============================
// PATCH /api/instructions
// Sauvegarde les instructions personnalisées
// ==============================
router.patch('/', authenticate, async (req, res) => {
  try {
    const { instructions, persona } = req.body

    await query(
      `UPDATE users SET
        custom_instructions = $1,
        ai_persona = $2,
        updated_at = NOW()
       WHERE id = $3`,
      [instructions?.slice(0, 1500) || '', persona?.slice(0, 500) || '', req.user.id]
    )

    res.json({ message: 'Instructions sauvegardées', instructions, persona })
  } catch (e) {
    res.status(500).json({ error: 'Erreur sauvegarde instructions' })
  }
})

module.exports = router
