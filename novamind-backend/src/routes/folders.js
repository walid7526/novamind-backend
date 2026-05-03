const express = require('express')
const router = express.Router()
const { query } = require('../config/database')
const { authenticate } = require('../middleware/auth')

// GET /api/folders
router.get('/', authenticate, async (req, res) => {
  try {
    const result = await query(
      `SELECT f.*, COUNT(c.id) as conversation_count
       FROM folders f
       LEFT JOIN conversations c ON c.folder_id = f.id
       WHERE f.user_id = $1
       GROUP BY f.id
       ORDER BY f.position ASC, f.created_at ASC`,
      [req.user.id]
    )
    res.json({ folders: result.rows })
  } catch (e) {
    res.status(500).json({ error: 'Erreur récupération dossiers' })
  }
})

// POST /api/folders
router.post('/', authenticate, async (req, res) => {
  try {
    const { name, emoji = '📁', color = '#7c6af7' } = req.body
    if (!name?.trim()) return res.status(400).json({ error: 'Nom requis' })

    const result = await query(
      `INSERT INTO folders (user_id, name, emoji, color)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [req.user.id, name.trim(), emoji, color]
    )
    res.status(201).json({ folder: result.rows[0] })
  } catch (e) {
    res.status(500).json({ error: 'Erreur création dossier' })
  }
})

// PATCH /api/folders/:id
router.patch('/:id', authenticate, async (req, res) => {
  try {
    const { name, emoji, color } = req.body
    const result = await query(
      `UPDATE folders SET
        name = COALESCE($1, name),
        emoji = COALESCE($2, emoji),
        color = COALESCE($3, color),
        updated_at = NOW()
       WHERE id = $4 AND user_id = $5 RETURNING *`,
      [name, emoji, color, req.params.id, req.user.id]
    )
    if (!result.rows.length) return res.status(404).json({ error: 'Dossier introuvable' })
    res.json({ folder: result.rows[0] })
  } catch (e) {
    res.status(500).json({ error: 'Erreur modification dossier' })
  }
})

// DELETE /api/folders/:id
router.delete('/:id', authenticate, async (req, res) => {
  try {
    // Retire les conversations du dossier avant de le supprimer
    await query('UPDATE conversations SET folder_id = NULL WHERE folder_id = $1 AND user_id = $2', [req.params.id, req.user.id])
    await query('DELETE FROM folders WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id])
    res.json({ message: 'Dossier supprimé' })
  } catch (e) {
    res.status(500).json({ error: 'Erreur suppression dossier' })
  }
})

// PATCH /api/folders/conversation/:convId — déplacer une conv dans un dossier
router.patch('/conversation/:convId', authenticate, async (req, res) => {
  try {
    const { folder_id } = req.body
    await query(
      'UPDATE conversations SET folder_id = $1, updated_at = NOW() WHERE id = $2 AND user_id = $3',
      [folder_id || null, req.params.convId, req.user.id]
    )
    res.json({ message: 'Conversation déplacée' })
  } catch (e) {
    res.status(500).json({ error: 'Erreur déplacement conversation' })
  }
})

module.exports = router
