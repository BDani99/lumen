# Biztonsági architektúra

Ez a dokumentum röviden leírja, hogyan védi a Lumen a felhasználói adatokat és
a szerver oldali API-kulcsokat, és mi a tudatosan vállalt, dokumentált
kockázat, amit egy jövőbeli munka javíthat.

## Jogosultság-ellenőrzés: service-role kliens + kézi tulajdonos-ellenőrzés

A legtöbb API route (`src/app/api/**/route.ts`) a Supabase **service-role**
klienst használja (`supabaseAdmin`, `src/lib/supabase.ts`), ami megkerüli a
Row Level Security (RLS) szabályokat. Ehelyett minden route explicit
tulajdonos-ellenőrzést végez a `src/lib/auth.ts`-ben található
`assertChannelOwned` / `assertProjectOwned` / `assertNamePoolPresetOwned` /
`assertDictionaryOwned` segédfüggvényekkel, mielőtt bármilyen adatot
olvasna/írna.

**Ez a jelenlegi elsődleges védelmi vonal** — nem az RLS. Az RLS szabályok
(lásd `supabase/migrations/20260805120000_auth_multi_tenant.sql` és minden
újabb táblát létrehozó migráció) léteznek, és **defense-in-depth**-ként
működnek: ha egy service-role hívás valamiért RLS-t figyelembe vevő klienssel
futna, akkor is helyesen szűrne. De mivel a legtöbb route service-role
klienssel dolgozik, az RLS ma nem a tényleges határ.

**Kockázat:** ha egy route-ban lemarad egy `assert*Owned` hívás (mint ahogy a
`dictionaries` route-oknál történt — javítva, lásd `dictionary_owners`
tábla), az azonnal cross-tenant adatszivárgást okoz, mert nincs RLS
biztonsági háló mögötte.

**Jövőbeli munka (nem ebben a körben):** minden route átállítása a
kérésenkénti, felhasználó-scope-olt Supabase kliensre (`src/utils/supabase/server.ts`),
hogy az RLS legyen az elsődleges határ, a kézi ellenőrzések pedig csak extra
biztonsági réteg maradjanak. Ez ~19 route-ot érint, ezért külön, alaposan
tesztelt munkaként érdemes elvégezni, nem egy nagyobb átalakítás részeként.

## API-kulcsok

Minden titkos kulcs (`OPENAI_API_KEY`, `OPENROUTER_API_KEY`, `AI33_API_KEY`,
`PEXELS_API_KEY`, `PIXABAY_API_KEY`, `R2_ACCESS_KEY_ID`,
`R2_SECRET_ACCESS_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) kizárólag szerver oldali
modulokban (`src/lib/*.ts`) olvasódik, amiket csak API route-ok és Inngest
függvények importálnak — soha kliens-komponens (`"use client"`) nem éri el
őket. Csak a `NEXT_PUBLIC_SUPABASE_URL` és `NEXT_PUBLIC_SUPABASE_ANON_KEY`
jut el a böngészőbe, ezek pedig tervezetten publikusak (az anon kulcs az RLS
mögött biztonságos).

**Kulcs-rotáció / least privilege ajánlások:**
- `SUPABASE_SERVICE_ROLE_KEY` — a legérzékenyebb kulcs, teljes DB-hozzáférést
  ad RLS megkerülésével. Rotáld azonnal, ha valaha kiszivárgott (pl. log,
  kliens build, publikus repo). Ne oszd meg CI/CD rendszeren kívül.
- R2 API token — hozz létre egy, **csak az egy bucketre** korlátozott tokent
  (Cloudflare dashboard → R2 → Manage API Tokens), ne fiók-szintű
  jogosultsággal.
- OpenAI / OpenRouter / TTS API / Pexels / Pixabay kulcsok — ezek egy-egy
  megosztott, fiók-szintű kulcsok az egész alkalmazáshoz (nem
  per-felhasználó). Ha bármelyik szolgáltatónál lehetséges, állíts be
  költség-limitet/riasztást a fiókon, mert egy visszaélő felhasználó (rate
  limit ellenére is, lásd lent) végső soron ezekre a megosztott kulcsokra
  terhel költséget.

## Visszaélés elleni védelem (rate limiting)

Az AI-hívást indító route-ok (`POST /api/videos`, `POST /api/pro/videos`,
`POST /api/scenes`, `POST /api/scenes/regenerate-clip`,
`POST /api/projects/[id]/thumbnail`, `POST /api/voices/preview`)
felhasználónkénti, Supabase-alapú rate limithez vannak kötve
(`src/lib/rate-limit.ts`, `rate_limit_hits` tábla). A kezdő limitek
(óránként ~10 generálás-indítás, ~60 kép/klip-regenerálás, ~20 borítókép,
~30 hang-előhallgatás) induló becslések — valós használat alapján
hangolandók a route fájlokban (`checkRateLimit({ limit, windowSeconds })`
hívásoknál).

## Proxy SSRF védelem

A `GET /api/proxy` (`src/app/api/proxy/route.ts`) csak bejelentkezett
felhasználóknak elérhető, és csak egy szűk host-allowlistre engedi a
lekérdezést (`src/lib/proxy-allowlist.ts`: az R2 public base URL hostja,
`ai33.pro`, illetve a Pro pipeline által ténylegesen használt stock-média
CDN-ek — Pexels/Pixabay/Wikimedia/Archive.org). A hostname feloldott IP-jét
is ellenőrzi (privát/loopback/link-local tartományok, pl. a
`169.254.169.254` cloud metadata endpoint tiltva), redirectet csak egyszer,
újra-ellenőrizve követ, és a válaszméretet is korlátozza.
