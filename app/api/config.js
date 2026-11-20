// Public configuration for the browser. The anon key is designed to be public;
// every table is protected by row-level security in the database.
export default function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({ url: process.env.SUPABASE_URL || "", anonKey: process.env.SUPABASE_ANON_KEY || "" });
}
