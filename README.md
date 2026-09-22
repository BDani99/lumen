# Lumen (Next.js + Inngest + Supabase)

## Helyi fejlesztés (2 terminál)

1. Másold az env sablont és töltsd ki a kulcsokat:

```powershell
copy .env.example .env.local
```

A `.env.local`-ban legyen legalább: `INNGEST_DEV=1` (dev szerver mód).  
**Ne** tedd ezt a változót Vercelre.

**Videós mód (Wan + R2):** a képes flow mellett választható Wan videógenerálás (OpenRouter, `OPENROUTER_API_KEY`). A jelenetképek (PNG) és `.mp4` fájlok Cloudflare R2-re mennek — kell: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_BASE_URL` (lásd `.env.example`). Bucket Settings → Public Development URL + CORS (`GET`/`HEAD`). Napi cron / export után a lejárt média `r2:deleted` jelölőt kap; az editorban újragenerálható (`video/regenerate-media`).

2. Terminál A — Next app:

```powershell
npm install
npm run dev
```

→ [http://localhost:3000](http://localhost:3000)

3. Terminál B — Inngest Dev Server:

```powershell
npm run inngest:dev
```

→ [http://localhost:8288](http://localhost:8288)

A videógenerálás (script / hang / képek) csak akkor fut, ha **mindkettő** megy.

## Auth (Supabase)

- Regisztráció: `/register` · Bejelentkezés: `/login` · Fiók / jelszócsere: `/account`
- Multi-tenant: minden user csak a saját csatornáit és projektjeit látja (RLS + `user_id`)
- Dashboard → Authentication: Email provider bekapcsolva
- Devhez ajánlott: **Confirm email** kikapcsolva, különben a signup után email-megerősítés kell
- Site URL: `http://localhost:3000` (+ Vercel domain productionön)

## Vercel + Inngest Cloud

1. Deployold a projektet Vercelre.
2. Állítsd be a Supabase / OpenAI / OpenRouter / AI33 / R2 (`R2_*`) / stb. env változókat a Vercel projektben.
3. Telepítsd az [Inngest Vercel integration](https://vercel.com/integrations/inngest)-t — ez automatikusan beállítja:
   - `INNGEST_SIGNING_KEY`
   - `INNGEST_EVENT_KEY`
4. **Ne** állítsd be az `INNGEST_DEV`-et Production / Preview környezetben.
5. Ha Vercel Deployment Protection be van kapcsolva, Inngesthez kell Protection Bypass (lásd Inngest Vercel docs).

Új deploy után az Inngest Cloud szinkronizálja a `/api/inngest` funkciókat.
