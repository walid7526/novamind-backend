const express = require('express')
const router = express.Router()
const fs = require('fs')
const path = require('path')
const { query } = require('../config/database')
const { authenticate } = require('../middleware/auth')
const { generateApplication, encryptKey, decryptKey, isForbiddenRequest } = require('../services/appGenerator')

// ==============================
// POST /api/gear5/generate
// Lance la génération d'une application complète
// ==============================
router.post('/generate', authenticate, async (req, res) => {
  try {
    const isAdmin = req.user.role === 'admin'
    const userGear = req.user.gear || 1

    if (!isAdmin && userGear < 5) {
      return res.status(403).json({
        error: 'La génération d\'applications est réservée au Gear 5 — Infinite.',
        code: 'GEAR_REQUIRED',
        required_gear: 5,
      })
    }

    const { description, api_keys = {}, model } = req.body
    // Gear 5 : Claude Opus par défaut, changeable par l'utilisateur
    const userModel = model || null // null = utilise GEAR5_DEFAULT_MODEL dans appGenerator

    if (!description?.trim()) {
      return res.status(400).json({ error: 'Description du projet requise' })
    }

    if (isForbiddenRequest(description)) {
      return res.status(403).json({
        error: 'Cette demande ne peut pas être traitée. Elle semble liée à des activités non autorisées.',
        code: 'FORBIDDEN_REQUEST',
      })
    }

    // SSE pour le streaming de la progression
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders()

    const sendProgress = (data) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`)
    }

    // Chiffrement des clés API fournies
    const encryptedKeys = {}
    for (const [name, value] of Object.entries(api_keys)) {
      if (value?.trim()) {
        encryptedKeys[name] = encryptKey(value)
      }
    }

    // Création du projet en base
    const projectRecord = await query(
      `INSERT INTO generated_projects (user_id, name, description, status)
       VALUES ($1, $2, $3, 'generating') RETURNING id`,
      [req.user.id, description.slice(0, 100), description]
    )
    const projectId = projectRecord.rows[0].id

    sendProgress({ type: 'project_created', project_id: projectId })

    try {
      // Lance le pipeline de génération
      const result = await generateApplication({
        description,
        userId: req.user.id,
        userApiKeys: api_keys,
        userModel,
        onProgress: (progress) => {
          sendProgress({ type: 'progress', ...progress })
        },
      })

      // Sauvegarde des clés chiffrées en base
      for (const [name, encrypted] of Object.entries(encryptedKeys)) {
        await query(
          `INSERT INTO user_api_keys (user_id, project_id, key_name, key_value_encrypted)
           VALUES ($1, $2, $3, $4)`,
          [req.user.id, projectId, name, encrypted]
        )
      }

      // Mise à jour du projet en base
      await query(
        `UPDATE generated_projects SET
          name = $1, project_type = $2, tech_stack = $3,
          status = 'ready', files = $4, zip_path = $5,
          version = 1, updated_at = NOW()
         WHERE id = $6`,
        [
          result.analysis.name,
          result.analysis.type,
          JSON.stringify(result.analysis.tech_stack),
          JSON.stringify(result.allFiles),
          result.zipPath,
          projectId,
        ]
      )

      // Sauvegarde version 1
      await query(
        `INSERT INTO project_versions (project_id, version, files, changelog)
         VALUES ($1, 1, $2, 'Version initiale')`,
        [projectId, JSON.stringify(result.allFiles)]
      )

      sendProgress({
        type: 'done',
        project_id: projectId,
        analysis: result.analysis,
        validation: result.validation,
        files_count: Object.keys(result.allFiles).length,
        download_url: `/api/gear5/download/${projectId}`,
      })

      res.end()

    } catch (genError) {
      await query(
        'UPDATE generated_projects SET status = $1, error_log = $2 WHERE id = $3',
        ['error', genError.message, projectId]
      )
      sendProgress({ type: 'error', error: genError.message, project_id: projectId })
      res.end()
    }

  } catch (error) {
    console.error('Erreur génération app:', error)
    if (!res.headersSent) {
      res.status(500).json({ error: 'Erreur lors de la génération' })
    }
  }
})

// ==============================
// GET /api/gear5/projects
// Liste des projets de l'utilisateur
// ==============================
router.get('/projects', authenticate, async (req, res) => {
  try {
    const isAdmin = req.user.role === 'admin'
    if (!isAdmin && req.user.gear < 5) {
      return res.status(403).json({ error: 'Gear 5 requis', code: 'GEAR_REQUIRED' })
    }

    const result = await query(
      `SELECT id, name, description, project_type, tech_stack, status, version, created_at, updated_at
       FROM generated_projects WHERE user_id = $1 ORDER BY updated_at DESC`,
      [req.user.id]
    )
    res.json({ projects: result.rows })
  } catch (e) {
    res.status(500).json({ error: 'Erreur récupération projets' })
  }
})

// ==============================
// GET /api/gear5/projects/:id
// Détails + fichiers d'un projet
// ==============================
router.get('/projects/:id', authenticate, async (req, res) => {
  try {
    const result = await query(
      'SELECT * FROM generated_projects WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    )
    if (!result.rows.length) return res.status(404).json({ error: 'Projet introuvable' })

    const versions = await query(
      'SELECT id, version, changelog, created_at FROM project_versions WHERE project_id = $1 ORDER BY version DESC',
      [req.params.id]
    )

    const project = result.rows[0]
    // Ne jamais exposer les clés en clair
    delete project.files?.env

    res.json({ project, versions: versions.rows })
  } catch (e) {
    res.status(500).json({ error: 'Erreur' })
  }
})

// ==============================
// GET /api/gear5/download/:id
// Téléchargement du ZIP
// ==============================
router.get('/download/:id', authenticate, async (req, res) => {
  try {
    const isAdmin = req.user.role === 'admin'
    if (!isAdmin && req.user.gear < 5) {
      return res.status(403).json({ error: 'Gear 5 requis' })
    }

    const result = await query(
      'SELECT name, zip_path, status FROM generated_projects WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    )

    if (!result.rows.length) return res.status(404).json({ error: 'Projet introuvable' })
    const project = result.rows[0]

    if (project.status !== 'ready') {
      return res.status(400).json({ error: 'Projet pas encore prêt' })
    }

    if (!project.zip_path || !fs.existsSync(project.zip_path)) {
      return res.status(404).json({ error: 'Fichier ZIP introuvable' })
    }

    res.setHeader('Content-Type', 'application/zip')
    res.setHeader('Content-Disposition', `attachment; filename="${project.name}.zip"`)
    fs.createReadStream(project.zip_path).pipe(res)

  } catch (e) {
    res.status(500).json({ error: 'Erreur téléchargement' })
  }
})

// ==============================
// POST /api/gear5/projects/:id/iterate
// Améliorer ou modifier un module du projet
// ==============================
router.post('/projects/:id/iterate', authenticate, async (req, res) => {
  try {
    const isAdmin = req.user.role === 'admin'
    if (!isAdmin && req.user.gear < 5) {
      return res.status(403).json({ error: 'Gear 5 requis' })
    }

    const { instruction, module } = req.body // module: 'backend' | 'frontend' | 'specific_file'
    if (!instruction) return res.status(400).json({ error: 'Instruction requise' })

    const projectResult = await query(
      'SELECT * FROM generated_projects WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    )
    if (!projectResult.rows.length) return res.status(404).json({ error: 'Projet introuvable' })

    const project = projectResult.rows[0]
    const currentFiles = project.files || {}

    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders()

    const sendEvent = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`)

    sendEvent({ type: 'progress', message: '🔄 Analyse de la modification...' })

    const { generateAIResponse } = require('../services/ai')
    const response = await generateAIResponse({
      model: 'gpt-4o',
      messages: [{
        role: 'user',
        content: `Tu es un développeur expert. Voici le projet existant :
Nom : ${project.name}
Type : ${project.project_type}
Fichiers actuels : ${JSON.stringify(Object.keys(currentFiles))}

Instruction de modification : ${instruction}
Module ciblé : ${module || 'tout le projet'}

Génère UNIQUEMENT les fichiers modifiés en JSON :
{ "chemin/fichier.js": "nouveau contenu complet" }

Ne génère que les fichiers qui changent vraiment.`
      }],
      stream: false,
      userGear: 5,
      isAdmin: true,
    })

    let modifiedFiles = {}
    try {
      const clean = response.content.replace(/```json\n?|\n?```/g, '').trim()
      modifiedFiles = JSON.parse(clean)
    } catch {
      sendEvent({ type: 'error', error: 'Impossible de parser les modifications' })
      return res.end()
    }

    const newFiles = { ...currentFiles, ...modifiedFiles }
    const newVersion = (project.version || 1) + 1

    // Sauvegarder la version précédente
    await query(
      `INSERT INTO project_versions (project_id, version, files, changelog)
       VALUES ($1, $2, $3, $4)`,
      [req.params.id, project.version, JSON.stringify(currentFiles), `Version ${project.version}`]
    )

    // Recréer le ZIP avec les modifications
    const { createProjectZip } = require('../services/appGenerator')
    // Séparer backend et frontend
    const backendFiles = {}
    const frontendFiles = {}
    for (const [k, v] of Object.entries(newFiles)) {
      if (k.startsWith('src/') || k.includes('index.html') || k.includes('vite') || k.includes('tailwind')) {
        frontendFiles[k] = v
      } else {
        backendFiles[k] = v
      }
    }

    sendEvent({ type: 'progress', message: '📦 Reconstruction du ZIP...' })
    const { createProjectZip: cpz } = require('../services/appGenerator')

    // Update en base
    await query(
      `UPDATE generated_projects SET files = $1, version = $2, updated_at = NOW() WHERE id = $3`,
      [JSON.stringify(newFiles), newVersion, req.params.id]
    )

    // Sauvegarde nouvelle version
    await query(
      `INSERT INTO project_versions (project_id, version, files, changelog)
       VALUES ($1, $2, $3, $4)`,
      [req.params.id, newVersion, JSON.stringify(newFiles), instruction.slice(0, 200)]
    )

    sendEvent({
      type: 'done',
      modified_files: Object.keys(modifiedFiles),
      new_version: newVersion,
      download_url: `/api/gear5/download/${req.params.id}`,
    })
    res.end()

  } catch (e) {
    console.error('Erreur itération:', e)
    if (!res.headersSent) res.status(500).json({ error: 'Erreur itération' })
  }
})

// ==============================
// POST /api/gear5/projects/:id/rollback/:version
// Revenir à une version précédente
// ==============================
router.post('/projects/:id/rollback/:version', authenticate, async (req, res) => {
  try {
    const versionResult = await query(
      'SELECT * FROM project_versions WHERE project_id = $1 AND version = $2',
      [req.params.id, req.params.version]
    )
    if (!versionResult.rows.length) return res.status(404).json({ error: 'Version introuvable' })

    const versionData = versionResult.rows[0]
    await query(
      'UPDATE generated_projects SET files = $1, version = $2, updated_at = NOW() WHERE id = $3 AND user_id = $4',
      [versionData.files, versionData.version, req.params.id, req.user.id]
    )

    res.json({ message: `Rollback vers la version ${req.params.version} effectué`, version: versionData.version })
  } catch (e) {
    res.status(500).json({ error: 'Erreur rollback' })
  }
})

// ==============================
// DELETE /api/gear5/projects/:id
// ==============================
router.delete('/projects/:id', authenticate, async (req, res) => {
  try {
    const result = await query(
      'SELECT zip_path FROM generated_projects WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    )
    if (result.rows[0]?.zip_path) {
      try { fs.unlinkSync(result.rows[0].zip_path) } catch {}
    }
    await query('DELETE FROM generated_projects WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id])
    res.json({ message: 'Projet supprimé' })
  } catch (e) {
    res.status(500).json({ error: 'Erreur suppression' })
  }
})

module.exports = router
