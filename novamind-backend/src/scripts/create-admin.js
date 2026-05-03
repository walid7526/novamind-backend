/**
 * Script à exécuter une fois en production :
 * node src/scripts/create-admin.js
 *
 * Crée les deux comptes co-créateurs avec exactement les mêmes droits admin VIP
 */
const bcrypt = require('bcryptjs')
const { query } = require('../config/database')

// Les deux co-créateurs — même rôle admin, mêmes droits, aucune hiérarchie
const admins = [
  { email: 'kaddanwalidpro@gmail.com', name: 'Walid — Co-créateur NovaMind', password: null },
  { email: 'kaddanaminpro@gmail.com',  name: 'Admin — Co-créateur NovaMind', password: 'Hassan156' },
]

async function createAdmins() {
  for (const admin of admins) {
    const hash = await bcrypt.hash(admin.password || require('crypto').randomBytes(32).toString('hex'), 12)
    await query(
      `INSERT INTO users (email, name, password_hash, role, gear, title, email_verified, created_at)
       VALUES ($1, $2, $3, 'admin', 5, 'Legendary Awakening', true, NOW())
       ON CONFLICT (email) DO UPDATE SET
         role = 'admin',
         gear = 5,
         title = 'Legendary Awakening',
         email_verified = true,
         updated_at = NOW()`,
      [admin.email, admin.name, hash]
    )
    console.log('✓ Admin VIP créé :', admin.email, '— Rôle : admin — Titre : Legendary Awakening')
  }
  console.log('\n✅ Les deux co-créateurs ont exactement les mêmes droits admin VIP')
  process.exit(0)
}

createAdmins().catch(err => { console.error(err); process.exit(1) })
