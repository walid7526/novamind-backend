const express = require('express')
const router = express.Router()
const { query } = require('../config/database')
const { authenticate } = require('../middleware/auth')
const { generateAIResponse } = require('../services/ai')
const { searchWeb, formatResultsForAI } = require('../services/search')

// ==============================
// POST /api/think/message
// Mode Think — raisonnement approfondi (Gear 3+)
// ==============================
router.post('/message', authenticate, async (req, res) => {
  try {
    const { content, conversation_id, model = 'gpt-4o' } = req.body
    const isAdmin = req.user.role === 'admin'
    const userGear = req.user.gear || 1

    if (!isAdmin && userGear < 3) {
      return res.status(403).json({
        error: 'Le mode Think requiert le Gear 3 — Pro.',
        code: 'GEAR_REQUIRED',
        required_gear: 3,
      })
    }

    if (!content?.trim()) return res.status(400).json({ error: 'Message requis' })

    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders()

    // Étape 1 — Annonce que l'IA réfléchit
    res.write(`data: ${JSON.stringify({ type: 'thinking_start', message: 'NovaMind analyse votre question en profondeur...' })}\n\n`)

    // Prompt système Think — force le raisonnement étape par étape
    const thinkSystemPrompt = `Tu es NovaMind en mode Think — raisonnement approfondi.

Avant de répondre, tu DOIS :
1. Analyser la question sous tous ses angles
2. Identifier les points clés et les pièges potentiels
3. Considérer plusieurs approches
4. Choisir la meilleure réponse possible

Format de réponse :
<think>
[Ton raisonnement interne — analyse, réflexion, considérations]
</think>

[Ta réponse finale claire et précise]

Prends le temps nécessaire. La qualité prime sur la vitesse.`

    // Étape 2 — Génère la réponse avec raisonnement
    const streamResponse = await generateAIResponse({
      model,
      messages: [{ role: 'user', content }],
      systemPrompt: thinkSystemPrompt,
      stream: true,
      userGear: 5,
      isAdmin: true,
    })

    let fullContent = ''
    let inThinkBlock = false
    let thinkContent = ''
    let responseContent = ''
    let thinkSent = false

    for await (const chunk of streamResponse) {
      const delta = chunk.choices[0]?.delta?.content || ''
      if (!delta) continue
      fullContent += delta

      // Parse le bloc <think>
      if (fullContent.includes('<think>') && !inThinkBlock) {
        inThinkBlock = true
        res.write(`data: ${JSON.stringify({ type: 'thinking_progress', message: 'En train de raisonner...' })}\n\n`)
      }

      if (inThinkBlock) {
        thinkContent += delta
        if (fullContent.includes('</think>') && !thinkSent) {
          inThinkBlock = false
          thinkSent = true
          // Extrait le contenu de la réflexion
          const thinkMatch = fullContent.match(/<think>([\s\S]*?)<\/think>/)
          const cleanThink = thinkMatch ? thinkMatch[1].trim() : ''
          res.write(`data: ${JSON.stringify({ type: 'think_block', content: cleanThink })}\n\n`)
          res.write(`data: ${JSON.stringify({ type: 'thinking_done', message: 'Réflexion terminée, génération de la réponse...' })}\n\n`)
        }
      } else if (thinkSent) {
        // Streame la réponse finale
        responseContent += delta
        res.write(`data: ${JSON.stringify({ type: 'delta', delta })}\n\n`)
      }
    }

    // Si pas de bloc think détecté, envoie tout comme réponse normale
    if (!thinkSent) {
      res.write(`data: ${JSON.stringify({ type: 'delta', delta: fullContent })}\n\n`)
      responseContent = fullContent
    }

    // Sauvegarde en base
    if (conversation_id && responseContent) {
      await query(
        `INSERT INTO messages (conversation_id, user_id, role, content, ai_model)
         VALUES ($1, $2, 'user', $3, $4)`,
        [conversation_id, req.user.id, content, model]
      ).catch(() => {})
      await query(
        `INSERT INTO messages (conversation_id, user_id, role, content, ai_model)
         VALUES ($1, $2, 'assistant', $3, $4)`,
        [conversation_id, req.user.id, responseContent || fullContent, model]
      ).catch(() => {})
    }

    res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`)
    res.end()

  } catch (error) {
    console.error('Erreur mode Think:', error)
    res.write(`data: ${JSON.stringify({ type: 'error', error: error.message })}\n\n`)
    res.end()
  }
})

// ==============================
// POST /api/think/deep-research
// Deep Research — rapport complet multi-sources (Gear 4+)
// ==============================
router.post('/deep-research', authenticate, async (req, res) => {
  try {
    const { query: searchQuery, conversation_id } = req.body
    const isAdmin = req.user.role === 'admin'
    const userGear = req.user.gear || 1

    if (!isAdmin && userGear < 4) {
      return res.status(403).json({
        error: 'Deep Research requiert le Gear 4 — Ultra.',
        code: 'GEAR_REQUIRED',
        required_gear: 4,
      })
    }

    if (!searchQuery?.trim()) return res.status(400).json({ error: 'Sujet requis' })

    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders()

    // Étape 1 — Annonce
    res.write(`data: ${JSON.stringify({ type: 'start', message: '🔍 Lancement de la recherche approfondie...' })}\n\n`)

    // Étape 2 — Recherches multiples (3 angles différents)
    const searchAngles = [
      searchQuery,
      `${searchQuery} dernières actualités 2025`,
      `${searchQuery} analyse approfondie expert`,
    ]

    let allSources = []
    let allContext = ''

    for (let i = 0; i < searchAngles.length; i++) {
      res.write(`data: ${JSON.stringify({ type: 'searching', message: `📡 Recherche ${i + 1}/3 : ${searchAngles[i].slice(0, 50)}...`, step: i + 1, total: 3 })}\n\n`)

      try {
        const searchData = await searchWeb(searchAngles[i], 5)
        allSources = [...allSources, ...searchData.results]
        allContext += formatResultsForAI(searchData) + '\n\n'
        await new Promise(r => setTimeout(r, 500)) // Petite pause
      } catch (err) {
        console.log('Recherche échouée:', err.message)
      }
    }

    // Déduplique les sources par URL
    const uniqueSources = allSources.filter((s, i, arr) =>
      arr.findIndex(x => x.url === s.url) === i
    ).slice(0, 12)

    res.write(`data: ${JSON.stringify({ type: 'sources_found', sources: uniqueSources, count: uniqueSources.length })}\n\n`)
    res.write(`data: ${JSON.stringify({ type: 'analyzing', message: '🧠 Analyse et synthèse des sources...' })}\n\n`)

    // Étape 3 — Génère le rapport complet
    const reportPrompt = `Tu es un expert en recherche et analyse. Tu dois produire un rapport complet et structuré.

Voici les données collectées sur "${searchQuery}" :

${allContext}

Génère un rapport complet en français avec cette structure :

# 📊 Rapport Deep Research : ${searchQuery}

## 🎯 Résumé exécutif
[2-3 paragraphes résumant les points essentiels]

## 📌 Points clés
[5-8 points essentiels à retenir]

## 🔍 Analyse détaillée
[Analyse approfondie par sous-thèmes]

## 📈 Tendances et perspectives
[Ce qui se passe actuellement et ce qui est attendu]

## ⚠️ Points à surveiller
[Risques, controverses, points d'attention]

## 📚 Sources consultées
[Liste des sources principales utilisées]

---
*Rapport généré par NovaMind Deep Research*

Sois précis, factuel et cite les sources. Rapport minimum 600 mots.`

    const streamResponse = await generateAIResponse({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: reportPrompt }],
      stream: true,
      userGear: 5,
      isAdmin: true,
    })

    let fullReport = ''
    res.write(`data: ${JSON.stringify({ type: 'report_start', message: '📝 Génération du rapport...' })}\n\n`)

    for await (const chunk of streamResponse) {
      const delta = chunk.choices[0]?.delta?.content || ''
      if (delta) {
        fullReport += delta
        res.write(`data: ${JSON.stringify({ type: 'delta', delta })}\n\n`)
      }
    }

    // Sauvegarde
    if (conversation_id && fullReport) {
      await query(
        `INSERT INTO messages (conversation_id, user_id, role, content, ai_model)
         VALUES ($1, $2, 'user', $3, 'deep-research')`,
        [conversation_id, req.user.id, `[Deep Research] ${searchQuery}`]
      ).catch(() => {})
      await query(
        `INSERT INTO messages (conversation_id, user_id, role, content, ai_model)
         VALUES ($1, $2, 'assistant', $3, 'deep-research')`,
        [conversation_id, req.user.id, fullReport]
      ).catch(() => {})
    }

    res.write(`data: ${JSON.stringify({ type: 'done', word_count: fullReport.split(/\s+/).length })}\n\n`)
    res.end()

  } catch (error) {
    console.error('Erreur Deep Research:', error)
    res.write(`data: ${JSON.stringify({ type: 'error', error: error.message })}\n\n`)
    res.end()
  }
})

module.exports = router
