// Create a login or set a new password. Only active members with the admin role may call this.
// Uses the Supabase service-role key, which exists only on the server (Vercel environment variable).
const URL_ = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;

async function sbFetch(path, opts = {}, key = SERVICE) {
  const r = await fetch(URL_ + path, { ...opts, headers: { apikey: key, Authorization: "Bearer " + key, "Content-Type": "application/json", ...(opts.headers || {}) } });
  const body = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, body };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST" && req.method !== "GET") return res.status(405).json({ error: "Use GET or POST" });
  if (!URL_ || !ANON || !SERVICE) return res.status(500).json({ error: "Server is not configured" });

  // 1. Who is calling? Verify their session token with Supabase.
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) return res.status(401).json({ error: "Sign in first" });
  const me = await fetch(URL_ + "/auth/v1/user", { headers: { apikey: ANON, Authorization: "Bearer " + token } });
  if (!me.ok) return res.status(401).json({ error: "Your session has expired. Sign in again." });
  const caller = (await me.json()).email?.toLowerCase();

  // 2. Is the caller an active administrator?
  const adm = await sbFetch("/rest/v1/members?select=roles,active&email=eq." + encodeURIComponent(caller));
  const row = Array.isArray(adm.body) ? adm.body[0] : null;
  if (!row || !row.active || !row.roles.includes("admin")) return res.status(403).json({ error: "Only administrators can manage logins" });

  // GET: login activity for the control panel (email, created, last sign-in). Nothing else is returned.
  if (req.method === "GET") {
    const users = [];
    for (let page = 1; page <= 20; page++) {
      const list = await sbFetch(`/auth/v1/admin/users?page=${page}&per_page=200`);
      const batch = list.body?.users || [];
      batch.forEach(u => users.push({ email: (u.email || "").toLowerCase(), created_at: u.created_at, last_sign_in_at: u.last_sign_in_at || null }));
      if (batch.length < 200) break;
    }
    return res.status(200).json({ users });
  }

  // 3. Validate the request.
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: "Invalid email" });
  if (password.length < 10) return res.status(400).json({ error: "Use at least 10 characters" });
  const mem = await sbFetch("/rest/v1/members?select=active&email=eq." + encodeURIComponent(email));
  if (!Array.isArray(mem.body) || !mem.body[0]?.active) return res.status(400).json({ error: "Add this person as an active member first" });

  // 4. Find an existing login, then update it or create a new one.
  let existing = null;
  for (let page = 1; page <= 20 && !existing; page++) {
    const list = await sbFetch(`/auth/v1/admin/users?page=${page}&per_page=200`);
    const users = list.body?.users || [];
    existing = users.find(u => (u.email || "").toLowerCase() === email) || null;
    if (users.length < 200) break;
  }
  const out = existing
    ? await sbFetch("/auth/v1/admin/users/" + existing.id, { method: "PUT", body: JSON.stringify({ password }) })
    : await sbFetch("/auth/v1/admin/users", { method: "POST", body: JSON.stringify({ email, password, email_confirm: true }) });
  if (!out.ok) return res.status(400).json({ error: out.body?.msg || out.body?.message || "Supabase refused the change" });
  console.log(`login ${existing ? "password reset" : "created"} for ${email} by ${caller}`);
  return res.status(200).json({ created: !existing });
}
