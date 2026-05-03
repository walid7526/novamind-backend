const express = require('express')
const router = express.Router()
const { authenticate } = require('../middleware/auth')
const { generateAIResponse } = require('../services/ai')

// ==============================
// POST /api/code/execute
// Génère + explique du code (simulation sécurisée)
// ==============================
router.post('/execute', authenticate, async (req, res) => {
  try {
    const isAdmin = req.user.role === 'admin'
    const userGear = req.user.gear || 1

    if (!isAdmin && userGear < 4) {
      return res.status(403).json({
        error: 'L\'interpréteur de code requiert le Gear 4 — Ultra.',
        code: 'GEAR_REQUIRED',
        required_gear: 4,
      })
    }

    const { code, language = 'python', task } = req.body

    if (!code?.trim() && !task?.trim()) {
      return res.status(400).json({ error: 'Code ou tâche requis' })
    }

    // Prompt spécialisé pour l'analyse et exécution de code
    const systemPrompt = `Tu es un interpréteur de code expert intégré dans NovaMind.
Tu peux analyser, exécuter (simuler), déboguer et expliquer du code dans tous les langages.

Quand on te donne du code à exécuter :
1. Analyse le code ligne par ligne
2. Simule son exécution et montre le résultat attendu
3. Explique ce que fait le code
4. Signale les bugs ou améliorations possibles
5. Si c'est une analyse de données, génère des insights

Format de réponse :
\`\`\`résultat
[Sortie du code / résultat de l'exécution]
\`\`\`

**Analyse :**
[Explication du code et des résultats]

**Suggestions :**
[Améliorations possibles si pertinent]`

    const userMessage = task
      ? `Tâche : ${task}\n\nÉcris et exécute le code ${language} nécessaire.`
      : `Exécute ce code ${language} et explique le résultat :\n\`\`\`${language}\n${code}\n\`\`\``

    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders()

    res.write(`data: ${JSON.stringify({ type: 'start', message: `Exécution ${language}...` })}\n\n`)

    const streamResponse = await generateAIResponse({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: userMessage }],
      systemPrompt,
      stream: true,
      userGear: 5,
      isAdmin: true,
    })

    let fullContent = ''
    for await (const chunk of streamResponse) {
      const delta = chunk.choices[0]?.delta?.content || ''
      if (delta) {
        fullContent += delta
        res.write(`data: ${JSON.stringify({ type: 'delta', delta })}\n\n`)
      }
    }

    res.write(`data: ${JSON.stringify({ type: 'done', content: fullContent })}\n\n`)
    res.end()

  } catch (error) {
    console.error('Erreur interpréteur code:', error)
    res.write(`data: ${JSON.stringify({ type: 'error', error: error.message })}\n\n`)
    res.end()
  }
})

// ==============================
// POST /api/code/analyze
// Analyse un fichier de données (CSV, JSON)
// ==============================
router.post('/analyze', authenticate, async (req, res) => {
  try {
    const isAdmin = req.user.role === 'admin'
    const userGear = req.user.gear || 1

    if (!isAdmin && userGear < 4) {
      return res.status(403).json({ error: 'Gear 4 requis', code: 'GEAR_REQUIRED' })
    }

    const { data, question } = req.body
    if (!data) return res.status(400).json({ error: 'Données requises' })

    const prompt = `Analyse ces données et réponds à la question suivante : ${question || 'Donne-moi un résumé complet avec des insights clés.'}\n\nDonnées :\n${data.slice(0, 5000)}`

    const response = await generateAIResponse({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      systemPrompt: 'Tu es un expert en analyse de données. Fournis des insights précis, des statistiques clés et des visualisations textuelles si pertinent.',
      stream: false,
      userGear: 5,
      isAdmin: true,
    })

    res.json({ analysis: response.content })
  } catch (e) {
    res.status(500).json({ error: 'Erreur analyse données' })
  }
})

module.exports = router
