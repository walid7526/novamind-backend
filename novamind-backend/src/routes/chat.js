const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { authenticate, optionalAuth } = require('../middleware/auth');
const { generateAIResponse, getAvailableModels, MODEL_CONFIG } = require('../services/ai');
const { searchWeb, formatResultsForAI } = require('../services/search');


// ==============================
// LIMITES GEAR 1
// ==============================
// Contexte par Gear (nombre de messages gardés en mémoire)
const GEAR_CONTEXT_LIMITS = {
  1: 20,   // Gear 1 — tient sur conversation normale, perd le fil sur très longues
  2: 40,   // Gear 2 — confortable
  3: 80,   // Gear 3 — bon
  4: 150,  // Gear 4 — très bon
  5: 500,  // Gear 5 — quasi-illimité (500 messages de contexte)
}
const GEAR1_MAX_HISTORY = 20

// ==============================
// NOUVELLES LIMITES GEAR 1
// (extension — ne modifie pas l'existant)
// ==============================

// Rate limiting messages Gear 1 : max 20 messages/heure
const GEAR1_RATE_LIMIT = 20
const GEAR1_RATE_WINDOW_MS = 60 * 60 * 1000 // 1 heure

// Priorité serveur : délai artificiel en période de charge Gear 1 (ms)
const GEAR1_SERVER_DELAY = () => Math.floor(Math.random() * 800) + 200 // 200-1000ms

// Modèles fallback selon charge
const GEAR1_MODELS = {
  normal: 'gpt-4o-mini',    // Modèle normal Gear 1
  overload: 'openai/gpt-4o-mini', // Même modèle léger si surcharge
}

// ==============================
// ANTI-ABUS GEAR 4 — invisible, progressif
// ==============================

// Seuils de détection d'usage extrême
const GEAR4_ABUSE = {
  window_ms: 60 * 60 * 1000,  // Fenêtre d'analyse : 1 heure
  threshold_warn: 80,           // 80 msg/h → léger ralentissement (500ms)
  threshold_moderate: 150,      // 150 msg/h → ralentissement modéré (1.5s)
  threshold_heavy: 250,         // 250 msg/h → ralentissement fort (3s)
}

// Calcule le délai anti-abus selon l'usage
const getGear4Delay = async (userId, queryFn) => {
  const windowStart = new Date(Date.now() - GEAR4_ABUSE.window_ms)
  const result = await queryFn(
    `SELECT COUNT(*) FROM messages WHERE user_id = $1 AND role = 'user' AND created_at >= $2`,
    [userId, windowStart.toISOString()]
  )
  const count = parseInt(result.rows[0].count)

  if (count >= GEAR4_ABUSE.threshold_heavy) {
    // Usage extrême — ralentissement fort (invisible, progressif)
    const delay = 3000 + Math.floor(Math.random() * 2000) // 3-5s
    console.log(`[Gear4 Anti-abuse] Usage extrême (${count} msg/h) — délai ${delay}ms`)
    return delay
  }
  if (count >= GEAR4_ABUSE.threshold_moderate) {
    // Usage élevé — ralentissement modéré
    return 1500 + Math.floor(Math.random() * 1000) // 1.5-2.5s
  }
  if (count >= GEAR4_ABUSE.threshold_warn) {
    // Usage important — léger ralentissement
    return 500 + Math.floor(Math.random() * 500) // 0.5-1s
  }
  return 0 // Usage normal — aucun délai
}

// ==============================
// ANTI-ABUS GEAR 5 — quasi-illimité mais protégé
// Seuils très élevés, totalement invisibles en usage normal
// ==============================
const GEAR5_ABUSE = {
  window_ms: 60 * 60 * 1000,   // Fenêtre : 1 heure
  threshold_warn: 300,           // 300 msg/h → micro-délai (200ms)
  threshold_moderate: 500,       // 500 msg/h → délai léger (800ms)
  threshold_heavy: 800,          // 800 msg/h → délai modéré (2s)
  threshold_critical: 1200,      // 1200 msg/h → protection maximale (4s)
}

const getGear5Delay = async (userId, queryFn) => {
  const windowStart = new Date(Date.now() - GEAR5_ABUSE.window_ms)
  const result = await queryFn(
    `SELECT COUNT(*) FROM messages WHERE user_id = $1 AND role = 'user' AND created_at >= $2`,
    [userId, windowStart.toISOString()]
  )
  const count = parseInt(result.rows[0].count)

  // Usage critique — protection maximale silencieuse
  if (count >= GEAR5_ABUSE.threshold_critical) {
    const delay = 4000 + Math.floor(Math.random() * 3000) // 4-7s
    console.log(`[Gear5 Anti-abuse] Usage critique (${count} msg/h) — délai ${delay}ms`)
    return delay
  }
  // Usage très élevé
  if (count >= GEAR5_ABUSE.threshold_heavy) {
    return 2000 + Math.floor(Math.random() * 1500) // 2-3.5s
  }
  // Usage élevé
  if (count >= GEAR5_ABUSE.threshold_moderate) {
    return 800 + Math.floor(Math.random() * 700) // 0.8-1.5s
  }
  // Usage important — micro-délai quasi imperceptible
  if (count >= GEAR5_ABUSE.threshold_warn) {
    return 200 + Math.floor(Math.random() * 300) // 0.2-0.5s
  }
  // Usage normal — aucun délai, expérience quasi-illimitée
  return 0
}

// Vérifie si le serveur est en surcharge (simulation basique)
const isServerOverloaded = () => {
  const hour = new Date().getHours()
  // Heures de pointe : 18h-22h → 30% de chance de surcharge
  if (hour >= 18 && hour <= 22) return Math.random() < 0.30
  // Reste du temps : 10% de chance
  return Math.random() < 0.10
}
const GEAR1_DEFAULT_MODEL = 'gpt-4o-mini' // Correspond à la clé dans MODEL_CONFIG
const GEAR1_MAX_TOKENS = 800 // Réponses courtes et moins détaillées

// ==============================
// DÉTECTION AUTOMATIQUE RECHERCHE WEB
// ==============================
const needsWebSearch = (message) => {
  const msg = message.toLowerCase()
  const triggers = [
    // Demandes explicites
    'recherche sur le web', 'cherche sur internet', 'cherche sur le web',
    'fais une recherche', 'recherche web', 'cherche sur google',
    'trouve sur internet', 'recherche en ligne',
    // Actualités / temps réel
    'actualité', 'actualités', 'dernières nouvelles', 'news',
    'aujourd\'hui', 'cette semaine', 'ce mois', 'en ce moment',
    'récemment', 'dernièrement', 'maintenant', 'current', 'latest',
    // Prix / données live
    'prix de', 'cours de', 'valeur de', 'combien coûte',
    'taux de', 'météo', 'température', 'prévisions',
    // Événements récents
    'résultat', 'résultats', 'score', 'match', 'classement',
    'élection', 'élections', 'sortie de', 'nouveau', 'nouveauté',
    // Personnes / entreprises récentes
    'qui est le nouveau', 'qui est la nouvelle', 'dernier album',
    'dernier film', 'dernière sortie', 'vient de sortir',
  ]
  return triggers.some(t => msg.includes(t))
}

// ==============================
// EXTRACTION REQUÊTE DE RECHERCHE
// ==============================
const extractSearchQuery = async (message) => {
  // Tente d'extraire la vraie requête du message utilisateur
  const cleaners = [
    /fais (?:une )?recherche (?:sur le web |sur internet |web |en ligne )?(?:sur |à propos de |concernant )?/i,
    /cherche (?:sur le web |sur internet |sur google |en ligne )?(?:des informations sur |des infos sur |)?/i,
    /trouve (?:sur internet |sur le web |en ligne )?(?:des informations sur |)?/i,
    /recherche web (?:sur |à propos de |)?/i,
  ]
  let cleaned = message
  for (const cleaner of cleaners) {
    cleaned = cleaned.replace(cleaner, '').trim()
  }
  return cleaned || message
}

// ==============================
// GET /api/chat/models
// ==============================
router.get('/models', authenticate, (req, res) => {
  const models = getAvailableModels(req.user.gear, req.user.role === 'admin')
  res.json({ models })
})

// ==============================
// POST /api/chat/message
// ==============================
router.post('/message', authenticate, async (req, res) => {
  try {
    const { conversation_id, content, model, stream = false, is_temporary = false } = req.body

    if (!content || !content.trim()) return res.status(400).json({ error: 'Message vide' })

    const isAdmin = req.user.role === 'admin'
    const userGear = req.user.gear || 1

    // ==============================
    // ANTI-ABUS GEAR 4 (invisible)
    // ==============================
    if (!isAdmin && userGear === 4) {
      const abuseDelay = await getGear4Delay(req.user.id, query)
      if (abuseDelay > 0) {
        await new Promise(r => setTimeout(r, abuseDelay))
      }
    }

    // ==============================
    // ANTI-ABUS GEAR 5 (quasi-illimité mais protégé)
    // Seuils très hauts — invisible en usage normal
    // ==============================
    if (!isAdmin && userGear === 5) {
      const abuseDelay = await getGear5Delay(req.user.id, query)
      if (abuseDelay > 0) {
        await new Promise(r => setTimeout(r, abuseDelay))
      }
    }

    // ==============================
    // EXTENSIONS GEAR 1
    // ==============================
    if (!isAdmin && userGear < 2) {

      // 1. Rate limiting : max 20 messages/heure
      const windowStart = new Date(Date.now() - GEAR1_RATE_WINDOW_MS)
      const msgCount = await query(
        `SELECT COUNT(*) FROM messages
         WHERE user_id = $1 AND role = 'user' AND created_at >= $2`,
        [req.user.id, windowStart.toISOString()]
      )
      const msgUsed = parseInt(msgCount.rows[0].count)
      if (msgUsed >= GEAR1_RATE_LIMIT) {
        return res.status(429).json({
          error: 'Limite de messages atteinte (20/heure en Gear 1). Réessayez dans quelques minutes ou passez au Gear 2.',
          code: 'RATE_LIMIT_REACHED',
          retry_after_minutes: 60,
          used: msgUsed,
          limit: GEAR1_RATE_LIMIT,
        })
      }

      // 2. Priorité serveur basse — délai artificiel
      await new Promise(r => setTimeout(r, GEAR1_SERVER_DELAY()))

      // 3. Bascule automatique si surcharge
      if (isServerOverloaded()) {
        // On reste sur gpt-4o-mini mais on peut logger pour monitoring
        console.log('[Gear1] Serveur en surcharge — modèle léger maintenu')
      }
    }

    // Gear 1 : force GPT-4o Mini peu importe ce que l'utilisateur choisit
    const selectedModel = (!isAdmin && userGear < 2) ? GEAR1_DEFAULT_MODEL : (model || req.user.preferred_ai_model || 'gpt-4o')

    // Crée ou récupère la conversation
    let convId = conversation_id
    if (!convId) {
      const convResult = await query(
        `INSERT INTO conversations (user_id, title, ai_model, is_temporary) VALUES ($1, $2, $3, $4) RETURNING id`,
        [req.user.id, content.slice(0, 60), selectedModel, is_temporary]
      )
      convId = convResult.rows[0].id
    } else {
      const check = await query('SELECT id FROM conversations WHERE id = $1 AND user_id = $2', [convId, req.user.id])
      if (!check.rows.length) return res.status(403).json({ error: 'Conversation introuvable' })
    }

    // Sauvegarde message user
    await query(
      `INSERT INTO messages (conversation_id, user_id, role, content, ai_model) VALUES ($1, $2, 'user', $3, $4)`,
      [convId, req.user.id, content, selectedModel]
    )

    // Contexte dynamique selon le Gear
    const historyLimit = isAdmin ? 999 : (GEAR_CONTEXT_LIMITS[userGear] || 20)
    const historyResult = await query(
      `SELECT role, content FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC LIMIT ${historyLimit}`,
      [convId]
    )

    // Instructions personnalisées utilisateur
    const instructionsResult = await query(
      'SELECT custom_instructions, ai_persona FROM users WHERE id = $1',
      [req.user.id]
    )
    const customInstructions = instructionsResult.rows[0]?.custom_instructions || ''
    const customPersona = instructionsResult.rows[0]?.ai_persona || ''

    // Mémoire IA
    let memoryContext = ''
    if (req.user.memory_enabled && !is_temporary) {
      const memories = await query(
        'SELECT content FROM ai_memories WHERE user_id = $1 AND is_active = true ORDER BY importance DESC LIMIT 10',
        [req.user.id]
      )
      if (memories.rows.length) {
        memoryContext = `\n\nMémoire utilisateur :\n${memories.rows.map(m => `- ${m.content}`).join('\n')}`
      }
    }

    // ==============================
    // DÉTECTION AUTOMATIQUE RECHERCHE WEB
    // ==============================
    let webContext = ''
    let webSources = []
    const shouldSearch = needsWebSearch(content) && (isAdmin || req.user.gear >= 2)
    const searchEnabled = !!(process.env.TAVILY_API_KEY || process.env.BRAVE_API_KEY)

    // Gear 2 : limite recherche web à 5/jour
    if (!isAdmin && userGear === 2) {
      const today = new Date(); today.setHours(0,0,0,0)
      const searchCount = await query(
        `SELECT COUNT(*) FROM security_logs WHERE user_id = $1 AND event_type = 'WEB_SEARCH' AND created_at >= $2`,
        [req.user.id, today.toISOString()]
      )
      if (parseInt(searchCount.rows[0].count) >= 5) {
        // Bloque la recherche web mais laisse quand même l'IA répondre sans web
        console.log('Limite recherche web Gear 2 atteinte')
      } else if (shouldSearch) {
        await query(
          `INSERT INTO security_logs (user_id, event_type, details) VALUES ($1, 'WEB_SEARCH', '{}')`,
          [req.user.id]
        )
      }
    }

    if (shouldSearch && searchEnabled) {
      try {
        const searchQuery = await extractSearchQuery(content)
        const searchData = await searchWeb(searchQuery, 5)
        webContext = '\n\n' + formatResultsForAI(searchData)
        webSources = searchData.results
        console.log(`🌐 Recherche web auto: "${searchQuery}"`)
      } catch (searchErr) {
        console.log('Recherche web échouée:', searchErr.message)
      }
    }

    const systemPrompt = `Tu es NovaMind, une IA conversationnelle avancée et bienveillante.
Tu réponds toujours dans la langue de l'utilisateur.
Tu es capable d'aider dans tous les domaines : rédaction, code, analyse, créativité, etc.
${isAdmin ? 'Tu parles à ton créateur et administrateur. Traite-le avec respect particulier.' : ''}
${customPersona ? `\nTon rôle et personnalité : ${customPersona}` : ''}
${customInstructions ? `\nInstructions spéciales de l'utilisateur (respecte-les toujours) :\n${customInstructions}` : ''}
${memoryContext}
${webContext ? `\nTu as accès aux résultats web suivants (utilise-les pour répondre de façon précise et actuelle) :\n${webContext}\n\nCite tes sources avec les URLs quand c'est pertinent.` : ''}
Sois concis quand c'est approprié, détaillé quand nécessaire.`

    const messages = historyResult.rows

    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream')
      res.setHeader('Cache-Control', 'no-cache')
      res.setHeader('Connection', 'keep-alive')
      res.setHeader('X-Conversation-Id', convId)
      res.flushHeaders()

      // Envoie les sources web si recherche effectuée
      if (webSources.length > 0) {
        res.write(`data: ${JSON.stringify({ type: 'web_sources', sources: webSources })}\n\n`)
      }

      let fullContent = ''
      try {
        const streamResponse = await generateAIResponse({
          model: selectedModel, messages, systemPrompt, stream: true,
          userGear: req.user.gear, isAdmin,
        })

        // Détection provider via MODEL_CONFIG (tous passent par OpenRouter = format OpenAI)
        for await (const chunk of streamResponse) {
          const delta = chunk.choices?.[0]?.delta?.content || ''
          if (delta) {
            fullContent += delta
            res.write(`data: ${JSON.stringify({ delta, conversation_id: convId })}\n\n`)
          }
        }

        await query(
          `INSERT INTO messages (conversation_id, user_id, role, content, ai_model) VALUES ($1, $2, 'assistant', $3, $4)`,
          [convId, req.user.id, fullContent, selectedModel]
        )
        await query('UPDATE conversations SET message_count = message_count + 2, updated_at = NOW() WHERE id = $1', [convId])

        if (req.user.memory_enabled && !is_temporary) autoSaveMemory(req.user.id, content, fullContent)

        res.write(`data: ${JSON.stringify({ done: true, conversation_id: convId, web_used: webSources.length > 0 })}\n\n`)
        res.end()
      } catch (streamError) {
        res.write(`data: ${JSON.stringify({ error: streamError.message })}\n\n`)
        res.end()
      }
      return
    }

    // Mode non-streamé
    const aiResponse = await generateAIResponse({
      model: selectedModel, messages, systemPrompt, stream: false,
      userGear: req.user.gear, isAdmin,
    })

    const savedMsg = await query(
      `INSERT INTO messages (conversation_id, user_id, role, content, ai_model, tokens_used)
       VALUES ($1, $2, 'assistant', $3, $4, $5) RETURNING id, created_at`,
      [convId, req.user.id, aiResponse.content, selectedModel, aiResponse.tokens_used]
    )
    await query('UPDATE conversations SET message_count = message_count + 2, updated_at = NOW() WHERE id = $1', [convId])

    res.json({
      message: { id: savedMsg.rows[0].id, role: 'assistant', content: aiResponse.content, model: selectedModel, created_at: savedMsg.rows[0].created_at },
      conversation_id: convId, tokens_used: aiResponse.tokens_used, web_sources: webSources,
    })

  } catch (error) {
    console.error('Erreur chat:', error)
    if (error.message.includes('requiert Gear')) return res.status(403).json({ error: error.message, code: 'GEAR_REQUIRED' })
    res.status(500).json({ error: 'Erreur lors de la génération de la réponse' })
  }
})

// ==============================
// MÉMOIRE AUTO
// ==============================
const autoSaveMemory = async (userId, userMessage, aiResponse) => {
  try {
    const keywords = ['je m\'appelle', 'mon nom', 'j\'aime', 'je travaille', 'j\'habite', 'mon préféré']
    if (keywords.some(kw => userMessage.toLowerCase().includes(kw))) {
      await query(
        `INSERT INTO ai_memories (user_id, content, category, importance) VALUES ($1, $2, 'auto', 5)`,
        [userId, `Contexte : ${userMessage.slice(0, 200)}`]
      )
    }
  } catch {}
}

// ==============================
// POST /api/chat/generate-title
// ==============================
router.post('/generate-title', authenticate, async (req, res) => {
  try {
    const { conversation_id, message } = req.body
    const response = await generateAIResponse({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: message }],
      systemPrompt: 'Génère un titre court (max 6 mots) pour cette conversation. Réponds UNIQUEMENT avec le titre, sans guillemets ni ponctuation.',
      stream: false, userGear: 5, isAdmin: true,
    })
    const title = response.content?.trim().slice(0, 60) || message.slice(0, 50)
    if (conversation_id) await query('UPDATE conversations SET title = $1 WHERE id = $2', [title, conversation_id])
    res.json({ title })
  } catch {
    res.json({ title: req.body.message?.slice(0, 50) || 'Nouvelle conversation' })
  }
})

module.exports = router

// ==============================
// GET /api/chat/gear1-status
// Vérifie les limites Gear 1 en temps réel
// ==============================
router.get('/gear1-status', authenticate, async (req, res) => {
  try {
    const isAdmin = req.user.role === 'admin'
    const userGear = req.user.gear || 1

    if (isAdmin || userGear >= 2) {
      return res.json({ gear1: false, limits: null })
    }

    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const uploadCount = await query(
      'SELECT COUNT(*) FROM uploads WHERE user_id = $1 AND created_at >= $2',
      [req.user.id, today.toISOString()]
    )

    // Compte les messages de l'heure
    const windowStart = new Date(Date.now() - 60 * 60 * 1000)
    const msgCount = await query(
      `SELECT COUNT(*) FROM messages WHERE user_id = $1 AND role = 'user' AND created_at >= $2`,
      [req.user.id, windowStart.toISOString()]
    )
    const msgUsed = parseInt(msgCount.rows[0].count)

    res.json({
      gear1: true,
      model: 'GPT-4o Mini',
      limits: {
        uploads_used: parseInt(uploadCount.rows[0].count),
        uploads_max: 3,
        uploads_remaining: Math.max(0, 3 - parseInt(uploadCount.rows[0].count)),
        messages_used: msgUsed,
        messages_max: 20,
        messages_remaining: Math.max(0, 20 - msgUsed),
        context_messages: 20,
        web_search: false,
        image_generation: false,
        voice: false,
        priority: 'low',
      }
    })
  } catch (e) {
    res.status(500).json({ error: 'Erreur' })
  }
})

// ==============================
// Mise à jour gear1-status avec nouvelles infos
// ==============================
// (Remplace l'ancienne route gear1-status)
