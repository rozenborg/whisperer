import crypto from 'crypto'

export function normalizeUrl(raw) {
  try {
    const u = new URL(raw)
    u.hash = ''
    // Remove common tracking params
    const params = u.searchParams
    ;['utm_source','utm_medium','utm_campaign','utm_term','utm_content','utm_id','mc_cid','mc_eid','ref'].forEach((k)=>params.delete(k))
    u.search = params.toString()
    return u.toString()
  } catch {
    return raw || ''
  }
}

export function urlFingerprint(url) {
  return crypto.createHash('sha1').update(url || '').digest('hex')
}

