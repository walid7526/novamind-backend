const express = require('express')
const router = express.Router()
const { query } = require('../config/database')
const { authenticate } = require('../middleware/auth')

// ==============================
// GET /api/export/conversation/:id/pdf
// Export d'une conversation en PDF (HTML → PDF côté client)
// ==============================
router.get('/conversation/:id/pdf', authenticate, async (req, res) => {
  try {
    const conv = await query(
      'SELECT * FROM conversations WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    )
    if (!conv.rows.length) return res.status(404).json({ error: 'Conversation introuvable' })

    const messages = await query(
      'SELECT role, content, ai_model, created_at FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC',
      [req.params.id]
    )

    const conversation = conv.rows[0]
    const msgs = messages.rows

    // Génère un HTML propre pour l'impression/PDF
    const html = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <title>${conversation.title || 'Conversation NovaMind'}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 13px; color: #1a1a2e; background: #fff; padding: 40px; max-width: 800px; margin: 0 auto; }
    .header { border-bottom: 2px solid #7c6af7; padding-bottom: 20px; margin-bottom: 30px; }
    .logo { font-size: 22px; font-weight: 800; color: #7c6af7; letter-spacing: -0.5px; }
    .title { font-size: 18px; font-weight: 700; color: #1a1a2e; margin-top: 8px; }
    .meta { font-size: 11px; color: #666; margin-top: 6px; }
    .stats { display: flex; gap: 20px; margin-top: 10px; }
    .stat { font-size: 11px; color: #666; background: #f5f5ff; padding: 4px 10px; border-radius: 20px; }
    .message { margin-bottom: 20px; padding: 16px 20px; border-radius: 12px; page-break-inside: avoid; }
    .message.user { background: #f0eeff; border-left: 3px solid #7c6af7; }
    .message.assistant { background: #f9f9ff; border-left: 3px solid #e0e0ff; }
    .role { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px; color: #7c6af7; }
    .role.assistant-role { color: #999; }
    .content { line-height: 1.7; white-space: pre-wrap; word-break: break-word; }
    .content code { background: #f0f0f0; padding: 1px 5px; border-radius: 4px; font-family: monospace; font-size: 12px; }
    .content pre { background: #1a1a2e; color: #e0e0ff; padding: 12px; border-radius: 8px; overflow-x: auto; margin: 8px 0; }
    .content pre code { background: none; color: inherit; }
    .time { font-size: 10px; color: #bbb; margin-top: 8px; }
    .model-tag { font-size: 10px; color: #bbb; background: #f0f0f0; padding: 2px 8px; border-radius: 10px; display: inline-block; margin-top: 6px; }
    .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #eee; font-size: 11px; color: #bbb; text-align: center; }
    @media print {
      body { padding: 20px; }
      .message { page-break-inside: avoid; }
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="logo">🧠 NovaMind</div>
    <div class="title">${(conversation.title || 'Conversation').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
    <div class="meta">Exporté le ${new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}</div>
    <div class="stats">
      <span class="stat">💬 ${msgs.length} messages</span>
      <span class="stat">🤖 ${conversation.ai_model || 'IA'}</span>
      <span class="stat">📅 ${new Date(conversation.created_at).toLocaleDateString('fr-FR')}</span>
    </div>
  </div>

  ${msgs.map(m => `
  <div class="message ${m.role}">
    <div class="role ${m.role === 'assistant' ? 'assistant-role' : ''}">${m.role === 'user' ? '👤 Vous' : '🧠 NovaMind'}</div>
    <div class="content">${m.content.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>')}</div>
    <div class="time">${new Date(m.created_at).toLocaleString('fr-FR')}</div>
    ${m.ai_model && m.role === 'assistant' ? `<div class="model-tag">${m.ai_model}</div>` : ''}
  </div>`).join('')}

  <div class="footer">
    Généré par NovaMind · novamind.ai
  </div>
</body>
</html>`

    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.setHeader('Content-Disposition', `inline; filename="novamind-${req.params.id}.html"`)
    res.send(html)

  } catch (error) {
    console.error('Erreur export PDF:', error)
    res.status(500).json({ error: 'Erreur lors de l\'export' })
  }
})

// ==============================
// GET /api/export/conversation/:id/word
// Export d'une conversation en DOCX (format RTF compatible Word)
// ==============================
router.get('/conversation/:id/word', authenticate, async (req, res) => {
  try {
    const conv = await query(
      'SELECT * FROM conversations WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    )
    if (!conv.rows.length) return res.status(404).json({ error: 'Conversation introuvable' })

    const messages = await query(
      'SELECT role, content, ai_model, created_at FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC',
      [req.params.id]
    )

    const conversation = conv.rows[0]
    const msgs = messages.rows

    // Génère un RTF compatible Word/LibreOffice
    const rtfContent = `{\\rtf1\\ansi\\deff0
{\\fonttbl{\\f0\\fswiss\\fcharset0 Arial;}{\\f1\\fmodern\\fcharset0 Courier New;}}
{\\colortbl;\\red124\\green106\\blue247;\\red26\\green26\\blue46;\\red100\\green100\\blue100;}
\\widowctrl\\hyphauto
\\pard\\qc\\f0\\fs36\\b\\cf1 NovaMind\\par
\\pard\\qc\\f0\\fs20\\b0\\cf3 Conversation Export\\par
\\pard\\qc\\f0\\fs16\\cf3 ${new Date().toLocaleDateString('fr-FR')}\\par
\\pard\\f0\\fs20\\cf2\\par
\\pard\\f0\\fs24\\b ${(conversation.title || 'Conversation').replace(/[\\{}]/g, '')}\\par
\\pard\\f0\\fs16\\cf3\\b0 ${msgs.length} messages · ${conversation.ai_model || 'NovaMind'} · ${new Date(conversation.created_at).toLocaleDateString('fr-FR')}\\par
\\pard\\f0\\fs20\\cf2\\par
${msgs.map(m => {
  const role = m.role === 'user' ? 'Vous' : 'NovaMind'
  const content = m.content.replace(/[\\{}]/g, '').replace(/\n/g, '\\par ')
  const time = new Date(m.created_at).toLocaleString('fr-FR')
  return `\\pard\\f0\\fs16\\b\\cf1 ${role}\\b0\\cf3  · ${time}\\par
\\pard\\f0\\fs18\\cf2 ${content}\\par
\\pard\\f0\\fs12\\par`
}).join('\n')}
\\pard\\qc\\f0\\fs14\\cf3 Généré par NovaMind · novamind.ai\\par
}`

    res.setHeader('Content-Type', 'application/rtf')
    res.setHeader('Content-Disposition', `attachment; filename="novamind-conversation.rtf"`)
    res.send(rtfContent)

  } catch (error) {
    console.error('Erreur export Word:', error)
    res.status(500).json({ error: 'Erreur lors de l\'export' })
  }
})

// ==============================
// GET /api/export/conversation/:id/markdown
// Export Markdown
// ==============================
router.get('/conversation/:id/markdown', authenticate, async (req, res) => {
  try {
    const conv = await query(
      'SELECT * FROM conversations WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    )
    if (!conv.rows.length) return res.status(404).json({ error: 'Conversation introuvable' })

    const messages = await query(
      'SELECT role, content, ai_model, created_at FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC',
      [req.params.id]
    )

    const conversation = conv.rows[0]
    const msgs = messages.rows

    const md = `# ${conversation.title || 'Conversation NovaMind'}

> Exporté le ${new Date().toLocaleDateString('fr-FR')} · ${msgs.length} messages · Modèle: ${conversation.ai_model || 'NovaMind'}

---

${msgs.map(m => {
  const role = m.role === 'user' ? '## 👤 Vous' : '## 🧠 NovaMind'
  const time = new Date(m.created_at).toLocaleString('fr-FR')
  return `${role}\n*${time}*\n\n${m.content}\n\n---`
}).join('\n\n')}

*Généré par [NovaMind](https://novamind.ai)*`

    res.setHeader('Content-Type', 'text/markdown; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="novamind-conversation.md"`)
    res.send(md)

  } catch (error) {
    res.status(500).json({ error: 'Erreur export Markdown' })
  }
})

module.exports = router
