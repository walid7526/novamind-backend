const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { query } = require('../config/database');
const { authenticate } = require('../middleware/auth');

// ==============================
// GET /api/conversations
// Liste toutes les conversations
// ==============================
router.get('/', authenticate, async (req, res) => {
  try {
    const { page = 1, limit = 20, search } = req.query;
    const offset = (page - 1) * limit;

    let sql = `
      SELECT c.id, c.title, c.ai_model, c.is_archived, c.is_public,
             c.message_count, c.created_at, c.updated_at,
             (SELECT content FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) as last_message
      FROM conversations c
      WHERE c.user_id = $1 AND c.is_temporary = false
    `;
    const params = [req.user.id];

    if (search) {
      sql += ` AND (c.title ILIKE $${params.length + 1} OR EXISTS (
        SELECT 1 FROM messages m WHERE m.conversation_id = c.id AND m.content ILIKE $${params.length + 1}
      ))`;
      params.push(`%${search}%`);
    }

    sql += ` ORDER BY c.updated_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const result = await query(sql, params);

    const countResult = await query(
      'SELECT COUNT(*) FROM conversations WHERE user_id = $1 AND is_temporary = false',
      [req.user.id]
    );

    res.json({
      conversations: result.rows,
      total: parseInt(countResult.rows[0].count),
      page: parseInt(page),
      limit: parseInt(limit),
    });
  } catch (error) {
    res.status(500).json({ error: 'Erreur lors de la récupération des conversations' });
  }
});

// ==============================
// GET /api/conversations/:id
// Détails + messages d'une conversation
// ==============================
router.get('/:id', authenticate, async (req, res) => {
  try {
    const convResult = await query(
      'SELECT * FROM conversations WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );

    if (!convResult.rows.length) {
      return res.status(404).json({ error: 'Conversation introuvable' });
    }

    const messagesResult = await query(
      `SELECT id, role, content, ai_model, has_attachment, attachment_url, created_at
       FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC`,
      [req.params.id]
    );

    res.json({
      conversation: convResult.rows[0],
      messages: messagesResult.rows,
    });
  } catch (error) {
    res.status(500).json({ error: 'Erreur lors de la récupération de la conversation' });
  }
});

// ==============================
// PATCH /api/conversations/:id/rename
// ==============================
router.patch('/:id/rename', authenticate, async (req, res) => {
  try {
    const { title } = req.body;
    if (!title?.trim()) return res.status(400).json({ error: 'Titre requis' });

    const result = await query(
      'UPDATE conversations SET title = $1, updated_at = NOW() WHERE id = $2 AND user_id = $3 RETURNING *',
      [title.trim(), req.params.id, req.user.id]
    );

    if (!result.rows.length) return res.status(404).json({ error: 'Conversation introuvable' });
    res.json({ conversation: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: 'Erreur lors du renommage' });
  }
});

// ==============================
// DELETE /api/conversations/:id
// ==============================
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const result = await query(
      'DELETE FROM conversations WHERE id = $1 AND user_id = $2 RETURNING id',
      [req.params.id, req.user.id]
    );

    if (!result.rows.length) return res.status(404).json({ error: 'Conversation introuvable' });
    res.json({ message: 'Conversation supprimée' });
  } catch (error) {
    res.status(500).json({ error: 'Erreur lors de la suppression' });
  }
});

// ==============================
// PATCH /api/conversations/:id/archive
// ==============================
router.patch('/:id/archive', authenticate, async (req, res) => {
  try {
    const result = await query(
      `UPDATE conversations SET is_archived = NOT is_archived, updated_at = NOW()
       WHERE id = $1 AND user_id = $2 RETURNING id, is_archived`,
      [req.params.id, req.user.id]
    );

    if (!result.rows.length) return res.status(404).json({ error: 'Conversation introuvable' });
    const archived = result.rows[0].is_archived;
    res.json({ message: archived ? 'Conversation archivée' : 'Conversation désarchivée', is_archived: archived });
  } catch (error) {
    res.status(500).json({ error: 'Erreur lors de l\'archivage' });
  }
});

// ==============================
// POST /api/conversations/:id/share
// Génère un lien public
// ==============================
router.post('/:id/share', authenticate, async (req, res) => {
  try {
    const token = uuidv4().replace(/-/g, '');
    const result = await query(
      `UPDATE conversations SET is_public = true, public_token = $1, updated_at = NOW()
       WHERE id = $2 AND user_id = $3 RETURNING public_token`,
      [token, req.params.id, req.user.id]
    );

    if (!result.rows.length) return res.status(404).json({ error: 'Conversation introuvable' });

    const shareUrl = `${process.env.FRONTEND_URL}/share/${result.rows[0].public_token}`;
    res.json({ url: shareUrl, token: result.rows[0].public_token });
  } catch (error) {
    res.status(500).json({ error: 'Erreur lors du partage' });
  }
});

// ==============================
// DELETE /api/conversations/:id/share
// Supprime le lien public
// ==============================
router.delete('/:id/share', authenticate, async (req, res) => {
  try {
    await query(
      'UPDATE conversations SET is_public = false, public_token = NULL WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    res.json({ message: 'Partage désactivé' });
  } catch (error) {
    res.status(500).json({ error: 'Erreur lors de la désactivation du partage' });
  }
});

// ==============================
// GET /api/conversations/share/:token
// Accès public à une conversation partagée
// ==============================
router.get('/share/:token', async (req, res) => {
  try {
    const convResult = await query(
      `SELECT c.id, c.title, c.ai_model, c.created_at FROM conversations c
       WHERE c.public_token = $1 AND c.is_public = true`,
      [req.params.token]
    );

    if (!convResult.rows.length) return res.status(404).json({ error: 'Conversation introuvable ou non partagée' });

    const messagesResult = await query(
      'SELECT role, content, created_at FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC',
      [convResult.rows[0].id]
    );

    res.json({ conversation: convResult.rows[0], messages: messagesResult.rows });
  } catch (error) {
    res.status(500).json({ error: 'Erreur' });
  }
});

// ==============================
// GET /api/conversations/:id/export
// Export en JSON ou texte
// ==============================
router.get('/:id/export', authenticate, async (req, res) => {
  try {
    const { format = 'json' } = req.query;

    const conv = await query(
      'SELECT * FROM conversations WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    if (!conv.rows.length) return res.status(404).json({ error: 'Conversation introuvable' });

    const messages = await query(
      'SELECT role, content, created_at FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC',
      [req.params.id]
    );

    if (format === 'txt') {
      const text = messages.rows.map(m =>
        `[${m.role.toUpperCase()}] ${new Date(m.created_at).toLocaleString('fr-FR')}\n${m.content}\n`
      ).join('\n---\n\n');

      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="conversation-${req.params.id}.txt"`);
      return res.send(text);
    }

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="conversation-${req.params.id}.json"`);
    res.json({ conversation: conv.rows[0], messages: messages.rows, exported_at: new Date().toISOString() });
  } catch (error) {
    res.status(500).json({ error: 'Erreur lors de l\'export' });
  }
});

module.exports = router;
