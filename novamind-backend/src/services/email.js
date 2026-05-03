const { Resend } = require('resend')

const resend = new Resend(process.env.RESEND_API_KEY)
const FROM = process.env.EMAIL_FROM || 'NovaMind <noreply@novamind.ai>'
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://novamind.ai'

const colors = {
  bg: '#0a0a0f', surface: '#13131f', accent: '#7c6af7',
  text: '#e8e8f0', muted: '#6b6b8a', success: '#10b981',
  warning: '#f59e0b', danger: '#ef4444',
}

const GEAR_TITLES = {
  1: { name: 'Gear 1 — Free', title: 'Sea Rookie', color: colors.muted },
  2: { name: 'Gear 2 — Plus', title: 'Rookie Pirate', color: '#10b981' },
  3: { name: 'Gear 3 — Pro', title: 'New World Explorer', color: '#6366f1' },
  4: { name: 'Gear 4 — Ultra', title: 'Haki Awakened', color: '#f59e0b' },
  5: { name: 'Gear 5 — Infinite', title: 'Legendary Awakening', color: colors.accent },
}

const wrap = (body) => `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:${colors.bg};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 20px;">
<tr><td align="center"><table style="max-width:560px;width:100%;">
<tr><td align="center" style="padding-bottom:28px;">
  <div style="background:${colors.accent};width:44px;height:44px;border-radius:12px;text-align:center;line-height:44px;font-size:22px;display:inline-block;">⚡</div>
  <div style="color:${colors.text};font-size:20px;font-weight:800;margin-top:10px;">Nova<span style="color:${colors.accent};">Mind</span></div>
</td></tr>
<tr><td style="background:${colors.surface};border-radius:18px;padding:36px;border:1px solid #1e1e30;">
${body}
</td></tr>
<tr><td align="center" style="padding-top:20px;color:${colors.muted};font-size:12px;">
  NovaMind · <a href="${FRONTEND_URL}" style="color:${colors.accent};text-decoration:none;">novamind.ai</a>
</td></tr>
</table></td></tr></table></body></html>`

const btn = (t, url, c = colors.accent) =>
  `<div style="text-align:center;margin:24px 0;"><a href="${url}" style="background:${c};color:#fff;font-weight:700;font-size:14px;padding:13px 30px;border-radius:12px;text-decoration:none;display:inline-block;">${t}</a></div>`

const h1 = (t) => `<h1 style="color:${colors.text};font-size:22px;font-weight:800;margin:0 0 8px;">${t}</h1>`
const p  = (t) => `<p style="color:${colors.muted};font-size:14px;line-height:1.7;margin:0 0 14px;">${t}</p>`
const hr = `<hr style="border:none;border-top:1px solid #1e1e30;margin:20px 0;">`

// ==============================
// ENVOI PRINCIPAL
// ==============================
const sendEmail = async ({ to, subject, html }) => {
  try {
    const res = await resend.emails.send({ from: FROM, to, subject, html })
    console.log(`✅ Email → ${to} : ${subject}`)
    return res
  } catch (err) {
    console.error(`❌ Email échoué → ${to} :`, err.message)
    // Ne pas bloquer l'app si l'email échoue
    return null
  }
}

// ==============================
// 1. BIENVENUE + VÉRIFICATION
// ==============================
const sendWelcomeEmail = ({ to, username, verifyUrl }) =>
  sendEmail({
    to, subject: '⚡ Bienvenue sur NovaMind — Confirmez votre email',
    html: wrap(`
      ${h1('Bienvenue sur NovaMind ! ⚡')}
      ${p(`Bonjour <strong style="color:${colors.text};">${username}</strong>, votre compte a été créé avec succès.`)}
      ${p('Confirmez votre adresse email pour accéder à toutes les fonctionnalités.')}
      ${btn('✅ Confirmer mon email', verifyUrl)}
      ${hr}
      ${p('<small>Ce lien expire dans 24h. Si vous n\'avez pas créé de compte, ignorez cet email.</small>')}
    `)
  })

// ==============================
// 2. RESET MOT DE PASSE
// ==============================
const sendResetPasswordEmail = ({ to, username, resetUrl }) =>
  sendEmail({
    to, subject: '🔐 NovaMind — Réinitialisation de votre mot de passe',
    html: wrap(`
      ${h1('Réinitialisation du mot de passe 🔐')}
      ${p(`Bonjour <strong style="color:${colors.text};">${username || 'cher utilisateur'}</strong>,`)}
      ${p('Vous avez demandé à réinitialiser votre mot de passe. Cliquez ci-dessous.')}
      ${btn('🔑 Réinitialiser mon mot de passe', resetUrl, colors.warning)}
      ${hr}
      ${p(`<small>Ce lien expire dans <strong style="color:${colors.text};">1 heure</strong>. Si ce n'est pas vous, ignorez cet email.</small>`)}
    `)
  })

// ==============================
// 3. CONFIRMATION CHANGEMENT MDP
// ==============================
const sendPasswordChangedEmail = ({ to, username }) =>
  sendEmail({
    to, subject: '✅ NovaMind — Votre mot de passe a été modifié',
    html: wrap(`
      ${h1('Mot de passe modifié ✅')}
      ${p(`Bonjour <strong style="color:${colors.text};">${username || 'cher utilisateur'}</strong>,`)}
      ${p('Votre mot de passe a été modifié avec succès.')}
      ${p(`Si ce n'est pas vous, <a href="${FRONTEND_URL}/security" style="color:${colors.accent};">sécurisez votre compte immédiatement</a>.`)}
      ${btn('🔒 Mes paramètres de sécurité', `${FRONTEND_URL}/security`)}
    `)
  })

// ==============================
// 4. PAIEMENT RÉUSSI + GEAR ACTIVÉ
// ==============================
const sendPaymentSuccessEmail = ({ to, username, gear, amount, billingPeriod }) => {
  const g = GEAR_TITLES[gear] || GEAR_TITLES[1]
  return sendEmail({
    to, subject: `🎉 NovaMind — ${g.name} activé !`,
    html: wrap(`
      ${h1('Paiement confirmé 🎉')}
      ${p(`Bonjour <strong style="color:${colors.text};">${username}</strong>, votre paiement a été traité avec succès.`)}
      <div style="background:${colors.bg};border-radius:12px;padding:20px;margin:16px 0;text-align:center;border:1px solid #1e1e30;">
        <div style="font-size:28px;">⚔️</div>
        <div style="color:${g.color};font-size:18px;font-weight:800;margin-top:6px;">${g.name}</div>
        <div style="color:${colors.muted};font-size:13px;">${g.title}</div>
        ${hr}
        <div style="color:${colors.text};font-size:22px;font-weight:800;">${amount}€<span style="color:${colors.muted};font-size:13px;font-weight:400;">/${billingPeriod === 'yearly' ? 'an' : 'mois'}</span></div>
      </div>
      ${btn('🚀 Accéder à NovaMind', `${FRONTEND_URL}/chat`)}
    `)
  })
}

// ==============================
// 5. CHANGEMENT D'ABONNEMENT
// ==============================
const sendSubscriptionChangedEmail = ({ to, username, oldGear, newGear }) => {
  const g = GEAR_TITLES[newGear] || GEAR_TITLES[1]
  const isUp = newGear > oldGear
  return sendEmail({
    to, subject: `📋 NovaMind — Votre abonnement a été ${isUp ? 'mis à niveau' : 'modifié'}`,
    html: wrap(`
      ${h1(isUp ? 'Abonnement mis à niveau 📈' : 'Abonnement modifié 📋')}
      ${p(`Bonjour <strong style="color:${colors.text};">${username}</strong>,`)}
      ${p(`Votre abonnement NovaMind a été ${isUp ? 'mis à niveau' : 'modifié'}.`)}
      <div style="background:${colors.bg};border-radius:12px;padding:18px;text-align:center;border:1px solid #1e1e30;">
        <div style="color:${g.color};font-size:17px;font-weight:800;">⚔️ ${g.name}</div>
        <div style="color:${colors.muted};font-size:13px;margin-top:4px;">${g.title}</div>
      </div>
      ${btn('Accéder à NovaMind', `${FRONTEND_URL}/chat`, g.color)}
    `)
  })
}

// ==============================
// 6. ANNULATION ABONNEMENT
// ==============================
const sendSubscriptionCancelledEmail = ({ to, username, endDate }) =>
  sendEmail({
    to, subject: '😢 NovaMind — Votre abonnement a été annulé',
    html: wrap(`
      ${h1('Abonnement annulé 😢')}
      ${p(`Bonjour <strong style="color:${colors.text};">${username}</strong>,`)}
      ${p(`Votre abonnement a été annulé. Vous conservez l'accès jusqu'au <strong style="color:${colors.text};">${endDate || 'fin de période'}</strong>.`)}
      ${p('Après cette date, votre compte passera automatiquement en Gear 1 gratuit.')}
      ${btn('🔄 Réactiver mon abonnement', `${FRONTEND_URL}/pricing`)}
    `)
  })

// ==============================
// 7. CONNEXION SUSPECTE
// ==============================
const sendSuspiciousLoginEmail = ({ to, username, ip, device, time }) =>
  sendEmail({
    to, subject: '🔍 NovaMind — Nouvelle connexion détectée',
    html: wrap(`
      ${h1('Connexion détectée 🔍')}
      ${p(`Bonjour <strong style="color:${colors.text};">${username}</strong>,`)}
      ${p('Une nouvelle connexion a été détectée sur votre compte.')}
      <div style="background:${colors.bg};border-radius:12px;padding:16px;border:1px solid ${colors.warning}40;margin:16px 0;">
        <div style="color:${colors.muted};font-size:13px;">📍 IP : <strong style="color:${colors.text};">${ip || 'Inconnue'}</strong></div>
        <div style="color:${colors.muted};font-size:13px;margin-top:6px;">💻 ${device || 'Appareil inconnu'}</div>
        <div style="color:${colors.muted};font-size:13px;margin-top:6px;">🕐 ${time || new Date().toLocaleString('fr-FR')}</div>
      </div>
      ${p('Si c\'est vous, ignorez cet email. Sinon, sécurisez votre compte.')}
      ${btn('🔒 Sécuriser mon compte', `${FRONTEND_URL}/security`, colors.danger)}
    `)
  })

module.exports = {
  sendEmail,
  sendWelcomeEmail,
  sendResetPasswordEmail,
  sendPasswordChangedEmail,
  sendPaymentSuccessEmail,
  sendSubscriptionChangedEmail,
  sendSubscriptionCancelledEmail,
  sendSuspiciousLoginEmail,
}
