const express = require('express')
const router = express.Router()
const { query } = require('../config/database')
const { authenticate } = require('../middleware/auth')
const { generateAIResponse } = require('../services/ai')

// ==============================
// CALCUL NEXT RUN
// ==============================
const calculateNextRun = (frequency, timeOfDay, dayOfWeek, dayOfMonth) => {
  const now = new Date()
  const [hours, minutes] = (timeOfDay || '09:00').split(':').map(Number)
  let next = new Date()
  next.setSeconds(0, 0)
  next.setHours(hours, minutes)

  switch (frequency) {
    case 'once':
      if (next <= now) next.setDate(next.getDate() + 1)
      break
    case 'daily':
      if (next <= now) next.setDate(next.getDate() + 1)
      break
    case 'weekly': {
      const targetDay = dayOfWeek || 1 // Lundi par défaut
      const currentDay = now.getDay()
      let daysUntil = targetDay - currentDay
      if (daysUntil < 0 || (daysUntil === 0 && next <= now)) daysUntil += 7
      next.setDate(now.getDate() + daysUntil)
      break
    }
    case 'monthly': {
      const targetDay = dayOfMonth || 1
      next.setDate(targetDay)
      if (next <= now) {
        next.setMonth(next.getMonth() + 1)
        next.setDate(targetDay)
      }
      break
    }
  }
  return next
}

// ==============================
// GET /api/tasks
// ==============================
router.get('/', authenticate, async (req, res) => {
  try {
    const isAdmin = req.user.role === 'admin'
    if (!isAdmin && req.user.gear < 2) {
      return res.status(403).json({ error: 'Gear 2 requis pour les tâches planifiées', code: 'GEAR_REQUIRED' })
    }

    const result = await query(
      'SELECT * FROM scheduled_tasks WHERE user_id = $1 ORDER BY created_at DESC',
      [req.user.id]
    )
    res.json({ tasks: result.rows })
  } catch (e) {
    res.status(500).json({ error: 'Erreur récupération tâches' })
  }
})

// ==============================
// POST /api/tasks
// ==============================
router.post('/', authenticate, async (req, res) => {
  try {
    const isAdmin = req.user.role === 'admin'
    if (!isAdmin && req.user.gear < 2) {
      return res.status(403).json({ error: 'Gear 2 requis', code: 'GEAR_REQUIRED' })
    }

    const { title, description, prompt, frequency, day_of_week, day_of_month, time_of_day } = req.body

    if (!title || !prompt || !frequency) {
      return res.status(400).json({ error: 'Titre, prompt et fréquence requis' })
    }

    const nextRun = calculateNextRun(frequency, time_of_day, day_of_week, day_of_month)

    const result = await query(
      `INSERT INTO scheduled_tasks (user_id, title, description, prompt, frequency, day_of_week, day_of_month, time_of_day, next_run)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [req.user.id, title, description, prompt, frequency, day_of_week, day_of_month, time_of_day || '09:00', nextRun]
    )

    res.status(201).json({ task: result.rows[0] })
  } catch (e) {
    res.status(500).json({ error: 'Erreur création tâche' })
  }
})

// ==============================
// PATCH /api/tasks/:id
// ==============================
router.patch('/:id', authenticate, async (req, res) => {
  try {
    const { title, description, prompt, frequency, day_of_week, day_of_month, time_of_day, is_active } = req.body

    const nextRun = frequency ? calculateNextRun(frequency, time_of_day, day_of_week, day_of_month) : undefined

    const result = await query(
      `UPDATE scheduled_tasks SET
        title = COALESCE($1, title),
        description = COALESCE($2, description),
        prompt = COALESCE($3, prompt),
        frequency = COALESCE($4, frequency),
        day_of_week = COALESCE($5, day_of_week),
        day_of_month = COALESCE($6, day_of_month),
        time_of_day = COALESCE($7, time_of_day),
        is_active = COALESCE($8, is_active),
        next_run = COALESCE($9, next_run),
        updated_at = NOW()
       WHERE id = $10 AND user_id = $11 RETURNING *`,
      [title, description, prompt, frequency, day_of_week, day_of_month, time_of_day, is_active, nextRun, req.params.id, req.user.id]
    )

    if (!result.rows.length) return res.status(404).json({ error: 'Tâche introuvable' })
    res.json({ task: result.rows[0] })
  } catch (e) {
    res.status(500).json({ error: 'Erreur modification tâche' })
  }
})

// ==============================
// DELETE /api/tasks/:id
// ==============================
router.delete('/:id', authenticate, async (req, res) => {
  try {
    await query('DELETE FROM scheduled_tasks WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id])
    res.json({ message: 'Tâche supprimée' })
  } catch (e) {
    res.status(500).json({ error: 'Erreur suppression' })
  }
})

// ==============================
// POST /api/tasks/:id/run
// Exécuter une tâche manuellement
// ==============================
router.post('/:id/run', authenticate, async (req, res) => {
  try {
    const taskResult = await query(
      'SELECT * FROM scheduled_tasks WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    )
    if (!taskResult.rows.length) return res.status(404).json({ error: 'Tâche introuvable' })

    const task = taskResult.rows[0]

    const aiResponse = await generateAIResponse({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: task.prompt }],
      stream: false,
      userGear: req.user.gear,
      isAdmin: req.user.role === 'admin',
    })

    // Sauvegarde le résultat + update next_run
    const nextRun = task.frequency !== 'once'
      ? calculateNextRun(task.frequency, task.time_of_day, task.day_of_week, task.day_of_month)
      : null

    await query(
      `UPDATE scheduled_tasks SET
        result = $1, last_run = NOW(), next_run = $2,
        is_active = $3, updated_at = NOW()
       WHERE id = $4`,
      [aiResponse.content, nextRun, task.frequency !== 'once', task.id]
    )

    res.json({ result: aiResponse.content, next_run: nextRun })
  } catch (e) {
    res.status(500).json({ error: 'Erreur exécution tâche' })
  }
})

module.exports = router
