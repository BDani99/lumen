# Lumen

**AI-alapú videógeneráló** — egy témából vagy saját forgatókönyvből teljes, elkészült videót épít: szöveg → narráció → jelenetképek/videóklipek → export, csatorna-alapú munkafolyamatban.

Adj meg egy címet és (opcionálisan) egy hosszúságot egy csatornához — Lumen megírja a forgatókönyvet, felolvastatja egy AI hanggal, minden mondathoz/jelenethez legyárt egy képet vagy videóklipet (AI-generálással vagy ingyenes stock médiával), majd exportálható formában (DaVinci Resolve-kompatibilis FCPXML + médiacsomag) adja vissza. Minden lépés valós idejű állapotkövetéssel, hibatűréssel (megszakadt futás folytatható) és előzetes költségbecsléssel fut.

---

## Tartalom

- [Funkciók](#funkciók)
- [Architektúra](#architektúra--kik-a-szereplők)
- [Környezeti változók](#környezeti-változók)
- [Helyi fejlesztés](#helyi-fejlesztés)
- [Supabase beállítás](#supabase-beállítás)
- [Deployment (Vercel)](#deployment-vercel--inngest-cloud)
- [Biztonság](#biztonság)

---

## Funkciók

**Forgatókönyvírás**
- AI szövegírás (Qwen modellcsalád OpenRouteren keresztül, választható modellel csatornánként), opcionális minőség-ellenőrzési, logikai-ellenőrzési és záró csiszolási (`polish`) lépéssel.
- Saját forgatókönyv is megadható — ilyenkor a szövegírás lépés kimarad, a pipeline a narrációnál folytatja.
- Karakter-névkészletek: újrafelhasználható, kategóriánkénti (férfi/női keresztnév, vezetéknév, helyek/címek) névlisták, amikből a generált szöveg konzisztens szereplőneveket választ — csatornánként kiválasztható preset.
- Kiejtési szótárak: szó/kifejezés-szintű felülbírálás a TTS-hez (pl. tulajdonnevek helyes kiejtése), csatornánként újrahasználható.

**Narráció (TTS)**
- ElevenLabs, MiniMax, Fish Audio egységes felületen, nyelv/nem/keresés szerint szűrhető hangkönyvtárral és előhallgatással.
- Beszédsebesség és kiejtési szótár hangonként/csatornánként állítható.

**Képek és videó**
- Jelenetképek AI-generálással (GPT Image 2, választható minőséggel) vagy mozgó klipek (Wan / Seedance modellek OpenRouteren, szöveg→videó vagy kép→videó stratégiával, felbontás és időtartam szerint konfigurálva).
- Ingyenes stock média fallback: Pexels, Pixabay, Wikimedia Commons, Internet Archive, Openverse — AI-alapú relevancia-ellenőrzéssel, hogy csak a jelenethez ténylegesen illő találat kerüljön be.
- Helyszín-bevezető képek: az elbeszélés új helyszínére automatikusan generál egy "establishing shot"-ot, de csak első előfordoláskor — nem ismétli minden visszatérésnél.
- Automatikus Ken Burns-szerű zoom effekt csatornaszinten állítható erősséggel.
- Borítókép-generálás (karakterglossary-tudatos prompt-tal), előzményekkel.

**Szerkesztő és export**
- Élő állapotkövetés (Supabase Realtime) a generálás minden fázisában, hibanaplóval.
- Egyedi jelenet-szerkesztő: kép/klip újragenerálás, jelenetek felcserélése, effekt-választás, forgatókönyv utólagos szerkesztése és folytatása.
- DaVinci Resolve-kompatibilis export: FCPXML idővonal + a hozzá tartozó médiafájlok egy letölthető ZIP-ben.
- **Pro pipeline** (választható, külön mód): többforrású "director cut" — helyszín-tudatos jelenetbontás, AI mozgóklip / AI kép / ingyenes stock média tudatos keverése költség-preset szerint (Takarékos / Kiegyensúlyozott / Prémium / Egyedi), saját FCPXML export.
- Minden generálási lépés előtt és után pontos, dollárra bontott költségbecslés (szöveg, kép, videó, hang külön-külön).

**Üzemeltetés**
- Multi-tenant: minden felhasználó csak a saját csatornáit/projektjeit látja (Supabase auth + RLS).
- Automatikus napi takarítás: lejárt/exportált projektek R2-médiája törlődik, a hivatkozások jelölve maradnak (újragenerálhatók az editorban).
- Felhasználónkénti rate limiting az AI-költséget generáló műveleteken (részletek: [Biztonság](#biztonság)).

---

## Architektúra — kik a szereplők?

| Komponens | Szerep |
|---|---|
| **Next.js 16 (App Router, React 19)** | Maga a webalkalmazás — UI, API route-ok, szerver akciók. |
| **Supabase** | Postgres adatbázis, email/jelszó auth, Row Level Security (multi-tenant izoláció), Realtime (élő állapotkövetés a szerkesztőben). |
| **Inngest** | Háttérfolyamatok motorja: a teljes script→hang→kép/videó pipeline lépésenkénti, újrapróbálható jobokban fut, cron-alapú takarítással (R2 média, rate-limit takarítás). Helyi fejlesztéshez külön dev szerver kell (lásd lent). |
| **Cloudflare R2** | A generált médiafájlok (jelenetképek, .mp4 klipek, borítóképek) tárhelye — az adatbázis csak URL-eket tárol. |
| **OpenAI / OpenRouter** | Egy kulcs, több modell: szövegírás (Qwen-család), képgenerálás (GPT Image 2), videógenerálás (Wan, Seedance) mind OpenRouteren/OpenAI-n keresztül. |
| **TTS API** | Narráció generálása (ElevenLabs / MiniMax / Fish Audio hangok egy közös API mögött) + kiejtési szótárak. |
| **Pexels / Pixabay / Wikimedia Commons / Internet Archive / Openverse** | Ingyenes stock média források — csak akkor kerülnek be egy jelenetbe, ha az AI-relevancia-ellenőrzés szerint tényleg illenek hozzá. |

### Kétterminálos fejlesztési modell

Az Inngest a generálási pipeline motorja — helyi fejlesztésben **két folyamatnak kell futnia egyszerre**: a Next.js dev szervernek és az Inngest Dev Servernek. Enélkül a "Videó generálása" gomb lenyomása után semmi nem történik (a job a várólistán marad). Lásd [Helyi fejlesztés](#helyi-fejlesztés).

---

## Környezeti változók

Másold a `.env.example`-t `.env.local`-ra, és töltsd ki. 🔒 = titkos, soha ne kerüljön kliens-kódba/git-be/logba.

### Inngest (helyi fejlesztéshez kötelező)

| Változó | Kötelező | Leírás |
|---|---|---|
| `INNGEST_DEV` | csak lokálisan | `1`-re állítva Dev Server módba kapcsolja az SDK-t. **Production/Preview-n NE állítsd be** — a Vercel Inngest integráció automatikusan beállítja a saját kulcsait. |

### Supabase

| Változó | Kötelező | Leírás |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | igen | A Supabase projekt URL-je. Publikus (kliens oldalon is használt). |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | igen | Publikus anon kulcs — RLS mögött biztonságos, kliens oldalon is használt. |
| `NEXT_PUBLIC_SITE_URL` | nem | Az alkalmazás publikus címe (pl. `https://lumen.example.com`) — a jelszó-visszaállító és megerősítő emailek linkjeihez. Ha üres, a Vercel production domain, majd a kérés hostja szolgál tartalékként. |
| `SUPABASE_SERVICE_ROLE_KEY` 🔒 | igen | Teljes DB-hozzáférés, megkerüli az RLS-t. **Csak szerver oldalon** használt. Soha ne oszd meg, rotáld azonnal, ha kiszivárgott. |

### AI / média

| Változó | Kötelező | Leírás |
|---|---|---|
| `OPENAI_API_KEY` 🔒 | igen | Szövegírás + képgenerálás (közvetlen OpenAI hívásokhoz). |
| `OPENROUTER_API_KEY` 🔒 | igen | Szövegírás (Qwen), képgenerálás és videógenerálás (Wan/Seedance) OpenRouteren keresztül. |
| `AI33_API_KEY` 🔒 | igen | TTS (ElevenLabs/MiniMax/Fish Audio) + kiejtési szótárak. |
| `PEXELS_API_KEY` 🔒 | opcionális | Ingyenes stock kép/videó forrás. Kulcs nélkül egyszerűen kimarad a fallback-láncból. |
| `PIXABAY_API_KEY` 🔒 | opcionális | Ugyanaz, Pixabay forrással. |

Wikimedia Commons, Openverse és Internet Archive nem igényel kulcsot.

### Cloudflare R2 (jelenetképek + videóklipek tárhelye)

| Változó | Kötelező | Leírás |
|---|---|---|
| `R2_ACCOUNT_ID` | ha videós módot/klip-tárolást használsz | Cloudflare account ID. |
| `R2_ACCESS_KEY_ID` 🔒 | ua. | R2 API token access key — **csak az egy bucketre korlátozott** tokent hozz létre, ne fiók-szintű jogosultsággal. |
| `R2_SECRET_ACCESS_KEY` 🔒 | ua. | R2 API token secret. |
| `R2_BUCKET` | ua. | A bucket neve. |
| `R2_PUBLIC_BASE_URL` | ua. | A bucket publikus URL-je (Public Development URL, vagy saját domain). CORS: `GET`/`HEAD` engedélyezve kell legyen. |

### Vercel / production Inngest (csak a Vercel projekt beállításaiban, nem `.env.local`-ban)

| Változó | Leírás |
|---|---|
| `INNGEST_SIGNING_KEY` / `INNGEST_EVENT_KEY` | Az [Inngest Vercel integration](https://vercel.com/integrations/inngest) automatikusan beállítja telepítéskor. |
| `INNGEST_SERVE_ORIGIN` | Opcionális, csak ha egyedi domain mögött fut az Inngest sync. |

---

## Helyi fejlesztés

### Első indítás

1. **Klónozás + függőségek:**
   ```powershell
   npm install
   ```
2. **Env fájl:**
   ```powershell
   copy .env.example .env.local
   ```
   Töltsd ki a fenti táblázat szerinti kulcsokat. Legalább: `INNGEST_DEV=1`, a Supabase 3 változója, `OPENAI_API_KEY`, `OPENROUTER_API_KEY`, `AI33_API_KEY`.
3. **Supabase projekt** — ha még nincs, lásd [Supabase beállítás](#supabase-beállítás).

### Minden indításkor — két terminál

**Terminál A — Next app:**
```powershell
npm run dev
```
→ [http://localhost:3000](http://localhost:3000)

**Terminál B — Inngest Dev Server:**
```powershell
npm run inngest:dev
```
→ [http://localhost:8288](http://localhost:8288) (Inngest dashboard — itt látod a futó/hibázó jobokat)

A videógenerálás (script / hang / képek) **csak akkor fut**, ha mindkettő megy egyszerre.

### Egyéb hasznos parancsok

| Parancs | Mit csinál |
|---|---|
| `npm run build` | Production build. |
| `npm run start` | Production szerver indítása (build után). |
| `npm run lint` | ESLint. |
| `npx tsc --noEmit` | TypeScript típusellenőrzés build nélkül. |

A `scripts/` mappa egyszeri, kézi karbantartó parancsfájlokat tartalmaz (R2-migráció/purge, megakadt projekt folytatása, szótár-tulajdonos backfill, első felhasználó létrehozása) — a `.ts` fájlok `npx tsx --env-file=.env.local scripts/<fájl>.ts` formában futtathatók, dry-run alapértelmezéssel (`--confirm` nélkül csak kiírják, mit tennének). A `create-user.mjs` egy Supabase-felhasználót hoz létre email-megerősítés nélkül: `node scripts/create-user.mjs <email> <jelszó>`.

### Windows: `npm run dev` és a Turbopack

A `dev` parancs szándékosan **webpack**-et használ (`next dev --webpack`), nem a Next.js 16 alapértelmezett Turbopack motorját. Ennek oka egy ismert, jelenleg még javítatlan Turbopack-hiba Windowson: a `next dev` leállításakor a Turbopack háttérfolyamatai (pl. `postcss.js` worker) nem szűnnek meg rendesen, "árva" processzekként a gépen maradnak — ismételt indítás/leállítás (pl. egy agent vagy szkript, ami sokszor újraindítja a dev szervert) percek alatt több ezer felhalmozódott `node.exe` processzt és 10+ GB felesleges RAM-használatot eredményezhet.

Forrás / részletek:
- [anthropics/claude-code#67163](https://github.com/anthropics/claude-code/issues/67163) — a Turbopack `postcss.js` worker-jei árván maradnak Windows alatt leálláskor.
- [vercel/next.js#94915](https://github.com/vercel/next.js/issues/94915) — a Turbopack dev cache-e és fájlfigyelője korlátlanul nőhet (16.2.9-en is megfigyelve), a webpack-re váltás a közösség által is megerősített stabil megoldás.

**Ha mégis ki akarod próbálni a Turbopackot** (pl. ha időközben megjelent egy javítás): `npm run dev:turbopack`. Figyeld a processzek számát közben (PowerShell: `(Get-Process node).Count`), és állítsd le azonnal, ha szokatlanul magasra szökik.

**Ez a hiba csak a `next dev`-et érinti** — a `npm run build` / `npm run start` (és így a Vercel deployment is) egyszeri lefutású, nem-figyelő módban használja a Turbopack-ot build-hez, ami strukturálisan nem érintett és ellenőrizve is lett (tiszta build, nincs elszabaduló processz).

---

## Supabase beállítás

1. Hozz létre egy új Supabase projektet.
2. **Új, üres projekthez** futtasd le egyszer a [`supabase/schema.sql`](supabase/schema.sql) fájlt a Dashboard SQL Editorában. Ez a teljes séma: táblák, indexek, RLS szabályok, triggerek, realtime és API-jogosultságok. Egy **már létező** adatbázist a `supabase/migrations/*.sql` fájlokkal léptess tovább, fájlnév szerinti sorrendben (`supabase db push` vagy egyesével). A migrációk csak a változásokat tartalmazzák, az alap táblákat (`channels`, `video_projects`, `video_scenes`) nem hozzák létre, ezért üres adatbázison önmagukban nem elegendők.
3. Dashboard → Authentication → Providers: kapcsold be az **Email** providert.
4. Fejlesztéshez ajánlott: Authentication beállításoknál kapcsold ki a **Confirm email**-t, különben regisztráció után email-megerősítés kell, mielőtt be lehetne lépni.
5. Authentication → URL Configuration → Site URL: `http://localhost:3000` fejlesztéshez (+ a production Vercel domain, ha már van). A **Redirect URLs** listába vedd fel a `<domain>/auth/callback` címet is (localhost és production), különben a jelszó-visszaállító és megerősítő linkek nem működnek.
6. Authentication → Emails → Templates: a **Confirm signup** és a **Reset password** sablon tartalmát cseréld a [`supabase/email-templates/`](supabase/email-templates) mappa fájljaira (tárgy: "Erősítsd meg az email címed", illetve "Jelszó visszaállítása"). A sablonok a linket a `/auth/confirm` végpontra irányítják `token_hash`-sel, így a megerősítés akkor is működik, ha a levelet másik böngészőben, másik eszközön vagy egy levelezőalkalmazás beépített nézetében nyitják meg. Az alapértelmezett sablon a `?code=` alapú (PKCE) utat használja, ami ilyenkor "a link érvénytelen" hibával áll meg, miközben az email már megerősítődött. A sablonok a **Site URL**-t használják (`{{ .SiteURL }}`), ezért az az alkalmazás címe legyen.
7. Ha egy már működő, egyfelhasználós telepítésből nyitod meg az alkalmazást több felhasználó felé: a meglévő kiejtési szótárak tulajdonos nélkül maradnának (a TTS API oldalán nincs user mező) — futtasd le egyszer:
   ```powershell
   npx tsx --env-file=.env.local scripts/backfill-dictionary-owners.ts <a-te-supabase-user-uuid-od> --confirm
   ```

Regisztráció: `/register` · Bejelentkezés: `/login` · Elfelejtett jelszó: `/forgot-password` · Fiók / jelszócsere: `/account`.

A jelszó legalább 8 karakter (legfeljebb 72 bájt), tartalmaz betűt és számot, nem szerepel a gyakori jelszavak között, és nem az email címből áll — ugyanez a szabály fut a böngészőben (erősségjelző) és a szerveren (kikényszerítés). Érdemes a Supabase Dashboard → Authentication → Providers → Email alatt a **Leaked password protection** opciót is bekapcsolni.

---

## Hibakezelés

Minden hiba magyar, felhasználóbarát szöveggel jelenik meg — nyers kivételszöveg (adatbázis-, szolgáltatói hibaüzenet) soha nem kerül a képernyőre.

- `src/lib/errors.ts` — központi magyar üzenetek, hálózati/időtúllépési hibák felismerése, Supabase auth- és adatbázis-hibák leképezése.
- `src/lib/api-response.ts` — szerver oldali `apiError` / `routeError`: egységes `{ error, code?, ref? }` válasz; a valódi hiba a szerverlogba kerül egy rövid `ref` kóddal.
- `src/lib/api-client.ts` — böngésző oldali `apiFetch` / `getErrorMessage`: hálózat, időtúllépés, lejárt munkamenet (401 → bejelentkezés), rate limit és nem-JSON válaszok kezelése.
- `error.tsx` / `global-error.tsx` — váratlan hibák hibakóddal (digest) és újrapróbálással; a szerver oldali oldalak lekérdezési hibái `ErrorState`-tel jelennek meg.
- Ha a Supabase környezeti változók hiányoznak vagy az auth szolgáltatás nem elérhető, a felhasználó erről magyar üzenetet kap, a szerverlog pedig megnevezi a hiányzó változót.

---

## Deployment (Vercel + Inngest Cloud)

1. Deployold a projektet Vercelre.
2. Állítsd be a [Környezeti változók](#környezeti-változók) táblázatában felsorolt összes szükséges kulcsot a Vercel projekt Settings → Environment Variables alatt. A `NEXT_PUBLIC_*` változókat **Config** (nem Secret) típussal vedd fel: a Vercel nem engedi titkosként a böngészőbe kerülő értékeket. A `SUPABASE_SERVICE_ROLE_KEY` és az R2/API kulcsok maradjanak Secret-ek. A `NEXT_PUBLIC_*` értékek build közben kerülnek a kódba, változtatás után újra kell deployolni.
3. Telepítsd az [Inngest Vercel integration](https://vercel.com/integrations/inngest)-et — ez automatikusan beállítja az `INNGEST_SIGNING_KEY` / `INNGEST_EVENT_KEY` változókat.
4. **Ne** állítsd be az `INNGEST_DEV`-et Production/Preview környezetben.
5. Ha Vercel Deployment Protection be van kapcsolva, az Inngesthez Protection Bypass szükséges (lásd az Inngest Vercel dokumentációját).

Új deploy után az Inngest Cloud automatikusan szinkronizálja a `/api/inngest` funkciókat.

**Több telepítés ugyanabból a kódból:** minden telepítésnek legyen saját Supabase projektje, R2 bucketje és Inngest appja. Közösen használva az adatok keverednének, az egyik telepítés takarító feladata a másik médiáját is törölné, az Inngest szinkron pedig átállíthatná a másik telepítés háttérfeladatait.

**Hibakeresés:** ha bejelentkezéskor a felhasználó a "Nem sikerült kapcsolódni a szerverhez" vagy az "A szolgáltatás nincs megfelelően beállítva" üzenetet látja, a Vercel → Logs alatt a `Supabase is not configured — missing env: …` sor megnevezi a hiányzó változót. Ha a változók megvannak, ellenőrizd, hogy a legutóbbi deploy újabb-e náluk, és hogy a Supabase projekt nem szünetel-e.

---

## Biztonság

Részletes architektúra-leírás: [`docs/SECURITY.md`](docs/SECURITY.md). Röviden:

- **API-kulcsok**: minden titkos kulcs kizárólag szerver oldali kódban (`src/lib/*.ts`) olvasódik, kliens-komponens soha nem éri el őket. Csak a Supabase URL és anon kulcs jut el a böngészőbe (ez tervezett és biztonságos, RLS mögött).
- **Jogosultság-ellenőrzés**: minden API route explicit tulajdonos-ellenőrzést végez, mielőtt bármilyen adatot olvasna/írna — lásd `src/lib/auth.ts` (`assert*Owned` függvények). Az RLS szabályok is megvannak minden táblán, defense-in-depth-ként.
- **Rate limiting**: az AI-hívást indító route-ok (generálás indítása, kép/klip-regenerálás, borítókép, hang-előhallgatás) felhasználónkénti, Supabase-alapú rate limithez vannak kötve — nincs korlátlan, egy fiókról indítható visszaélés.
- **Proxy védelem**: az egyetlen szerver oldali "fetch más URL-t" végpont (`/api/proxy`, a médialetöltéshez az editorban/exportban) szűk host-allowlistet és privát-IP-tiltást alkalmaz SSRF ellen.
- **Kulcs-rotáció**: a `SUPABASE_SERVICE_ROLE_KEY` és az R2 kulcsok a legérzékenyebbek — rotáld azonnal, ha valaha kiszivárogtak; R2-hez hozz létre bucket-szintre korlátozott API tokent, ne fiók-szintűt.
