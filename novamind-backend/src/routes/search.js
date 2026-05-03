const express = require('express')
const router = express.Router()
const { authenticate } = require('../middleware/auth')
const { searchWeb, formatResultsForAI } = require('../services/search')
const { generateAIResponse } = require('../services/ai')
const { query } = require('../config/database')

// ==============================
// POST /api/search/web
// Recherche web + réponse IA enrichie
// ==============================
router.post('/web', authenticate, async (req, res) => {
  try {
    const { q, conversation_id, model = 'gpt-4o', stream = true } = req.body
    const isFounder = req.user.role === 'founder'
    const userGear = req.user.gear

    if (!q?.trim()) return res.status(400).json({ error: 'Requête manquante' })

    // Gear 2 minimum pour la recherche web
    if (!isFounder && userGear < 2) {
      return res.status(403).json({ error: 'Gear 2 requis pour la recherche web', code: 'GEAR_REQUIRED' })
    }

    // 1. Recherche web
    let searchData
    try {
      searchData = await searchWeb(q, 5)
    } catch (searchErr) {
      return res.status(503).json({ error: 'Service de recherche indisponible. Configurez TAVILY_API_KEY ou BRAVE_API_KEY dans le .env' })
    }

    const webContext = formatResultsForAI(searchData)

    // 2. Prépare la réponse streamée
    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream')
      res.setHeader('Cache-Control', 'no-cache')
      res.setHeader('Connection', 'keep-alive')

      // Envoie d'abord les sources
      res.write(`data: ${JSON.stringify({
        type: 'sources',
        sources: searchData.results,
        query: searchData.query,
      })}\n\n`)

      const systemPrompt = `Tu es NovaMind, une IA avec accès à internet en temps réel.
Tu as effectué une recherche web et voici les résultats :

${webContext}

Utilise ces informations pour répondre de façon précise et à jour.
Cite tes sources en mentionnant les URLs pertinentes.
Si les résultats ne sont pas suffisants, dis-le clairement.
Réponds toujours en français sauf si on te demande autre chose.`

      const messages = [{ role: 'user', content: q }]
      let fullContent = ''

      try {
        const streamResponse = await generateAIResponse({
          model,
          messages,
          systemPrompt,
          stream: true,
          userGear: 5,
          isFounder: true,
        })

        if (model.startsWith('gpt')) {
          for await (const chunk of streamResponse) {
            const delta = chunk.choices[0]?.delta?.content || ''
            if (delta) {
              fullContent += delta
              res.write(`data: ${JSON.stringify({ type: 'delta', delta })}\n\n`)
            }
          }
        } else if (model.startsWith('claude')) {
          for await (const chunk of streamResponse) {
            if (chunk.type === 'content_block_delta') {
              const delta = chunk.delta?.text || ''
              fullContent += delta
              res.write(`data: ${JSON.stringify({ type: 'delta', delta })}\n\n`)
            }
          }
        }

        // Sauvegarde en base si conversation active
        if (conversation_id) {
          await query(
            `INSERT INTO messages (conversation_id, user_id, role, content, ai_model)
             VALUES ($1, $2, 'assistant', $3, $4)`,
            [conversation_id, req.user.id, fullContent, model]
          )
        }

        res.write(`data: ${JSON.stringify({ type: 'done', content: fullContent })}\n\n`)
        res.end()

      } catch (aiErr) {
        res.write(`data: ${JSON.stringify({ type: 'error', error: aiErr.message })}\n\n`)
        res.end()
      }

    } else {
      // Mode non-streamé
      res.json({ sources: searchData.results, query: searchData.query, answer: searchData.answer })
    }

  } catch (error) {
    console.error('Erreur recherche web:', error)
    res.status(500).json({ error: 'Erreur lors de la recherche' })
  }
})

// ==============================
// GET /api/search/status
// Vérifie si la recherche est configurée
// ==============================
router.get('/status', authenticate, (req, res) => {
  res.json({
    available: !!(process.env.TAVILY_API_KEY || process.env.BRAVE_API_KEY),
    provider: process.env.TAVILY_API_KEY ? 'tavily' : process.env.BRAVE_API_KEY ? 'brave' : null,
  })
})

module.exports = router
