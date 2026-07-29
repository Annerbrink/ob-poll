# 1 X 2-omröstning

Inbäddningsbar tippningsmodul för fotbollsmatcher. Skribenten fyller i de två lagen,
läsarna tippar **1** (hemmavinst), **X** (oavgjort) eller **2** (bortavinst) och
resultatet visas i procent. Röster och omröstningar sparas serverside, så alla
läsare ser samma siffror.

## Två sätt att köra

Samma kod kör på båda: `src/handler.js` är skriven mot webbplattformens `Request`
och `Response`, och båda ingångarna ger den ett datalager.

| | Cloudflare Workers | Lokalt |
| --- | --- | --- |
| Ingång | `src/worker.js` | `server.js` |
| Datalager | D1 (`src/repository-d1.js`) | SQLite-fil (`src/repository-sqlite.js`) |
| Statiska filer | Workers Assets | inbyggd filserver |

### Lokalt

```bash
npm install
ADMIN_TOKEN=valfri-hemlig-sträng npm start
```

- Skribentvy: <http://localhost:3000/skribent.html>
- Widget: `http://localhost:3000/widget.html?poll=<id>`

Sätts inte `ADMIN_TOKEN` genereras en tillfällig token som skrivs ut i loggen.

### Cloudflare

```bash
npx wrangler d1 create ob-poll          # klistra in id:t i wrangler.toml
npx wrangler d1 migrations apply ob-poll --remote
npx wrangler secret put ADMIN_TOKEN
npx wrangler deploy
```

Kör lokalt mot en riktig Worker och en lokal D1 med `npm run dev` – lägg då
`ADMIN_TOKEN=...` i `.dev.vars` (som inte checkas in) och kör
`npx wrangler d1 migrations apply ob-poll --local` en gång.

Widgeten och skribentvyn serveras av Workers Assets, alltså direkt från kanten:
att öppna en artikel väcker aldrig workern, bara röstning och resultathämtning gör
det. Sätt `FRAME_ANCESTORS` i `wrangler.toml` innan omröstningen läggs i en artikel.

### Miljövariabler

| Variabel | Standard | Beskrivning |
| --- | --- | --- |
| `ADMIN_TOKEN` | slumpas lokalt vid start | Token som krävs för att skapa och ta bort omröstningar. På Cloudflare en secret. |
| `FRAME_ANCESTORS` | – | Vilka domäner som får bädda in widgeten, t.ex. `https://*.olandsbladet.se`. |
| `PORT` | `3000` | Bara lokalt. |
| `DATABASE_FILE` | `data/polls.db` | Bara lokalt. |

## Så gör skribenten

1. Öppna skribentvyn och klistra in skribenttoken (sparas i webbläsaren).
2. Fyll i hemmalag och bortalag. Avspark och stängningstid är valfria – anges avspark
   stänger omröstningen automatiskt då.
3. Klicka **Skapa omröstning** och kopiera inbäddningskoden till artikelns HTML-block.

Inbäddningskoden är en `<iframe>` plus ett kort skript som anpassar höjden:

```html
<iframe src="https://…/widget.html?poll=ifk-borgholm-vs-farjestadens-goif-f4b8d3"
        style="width:100%;max-width:520px;height:500px;border:0"
        loading="lazy"></iframe>
```

Tider tolkas och visas alltid i svensk tid, oavsett var skribenten eller läsaren
befinner sig.

## Datalagret

All läsning och skrivning går genom ett datalager med sex metoder – `createPoll`,
`getPoll`, `listPolls`, `deletePoll`, `castVote` och `getVote` (plus `recount` för
reparation). Det finns i två utbytbara implementationer som delar schema och SQL,
eftersom D1 är SQLite:

- `src/repository-d1.js` – Cloudflare D1, används i produktion
- `src/repository-sqlite.js` – lokal fil, används vid utveckling

Schemat ligger i `migrations/0001_init.sql` och har två tabeller:

- `polls` – id, lagnamn, avspark, stängningstid, skapad av, skapad när samt en löpande
  rösträkning (`count_1`, `count_x`, `count_2`)
- `votes` – en rad per läsare och omröstning (`PRIMARY KEY (poll_id, voter_id)`), så en
  läsare som ändrar sig flyttar sin röst i stället för att lägga till en ny

Rösträkningen ligger i `polls`-raden och uppdateras tillsammans med rösten – i en
transaktion lokalt, i en `batch` på D1. Att läsa ett resultat blir därmed en rad i
stället för en genomsökning av varje röst, vilket är skillnaden mellan att rymmas och
att inte rymmas i D1:s radbudget hur populär matchen än blir. `recount()` bygger om
siffrorna från rösterna om de någon gång behöver repareras.

Ska omröstningarna ligga i tidningens egen databas skriver man en tredje
implementation med samma metoder. Inget annat i koden rör lagringen. En lokal databas
som skapades innan rösträkningen fanns får kolumnerna tillagda och ifyllda vid start.

## API

| Metod | Väg | Åtkomst | Beskrivning |
| --- | --- | --- | --- |
| `POST` | `/api/polls` | skribent | Skapar omröstning från `homeTeam`, `awayTeam`, valfri `kickoff`/`closesAt`. |
| `GET` | `/api/polls` | skribent | Listar omröstningar med aktuella resultat. |
| `DELETE` | `/api/polls/:id` | skribent | Tar bort omröstningen och dess röster. |
| `GET` | `/api/polls/:id` | öppet | Match, röstantal, procent och läsarens eget val. |
| `POST` | `/api/polls/:id/votes` | öppet | Registrerar `choice` (`"1"`, `"X"` eller `"2"`). |

Skribentanropen kräver `Authorization: Bearer <ADMIN_TOKEN>`.

Procenttalen räknas ut med största-resten-metoden, så de tre talen alltid summerar
till exakt 100.

### Trafik och cachning

Resultatsvaret är avsiktligt opersonligt – ingen läsaridentitet, ingen cookie, inget som
skiljer två läsare åt – och skickas med `public, max-age=15`. Därför kan det cachas både
i webbläsaren och vid kanten, så en match som tar fart kostar ett ursprungsanrop per
intervall i stället för ett per läsare. Vilket tecken läsaren själv valde ligger i
`localStorage`, inte i svaret. Röstanropet och skribentvyn skickas med `no-store`.

Widgeten hämtar nya siffror var sextionde sekund, pausar helt när fliken ligger i
bakgrunden och slutar när omröstningen har stängt. Direkt efter att läsaren röstat
hämtas resultatet förbi cachen i 25 sekunder, annars skulle en cachad ögonblicksbild
från strax före rösten visa "Du tippade X · 0 röster".

## Design

`public/widget.css` använder designtoken hämtade från olandsbladet.se (temat
`gota-blue`): färger, radier, typsnittsstacken BNSansVariable och stöd för mörkt läge.
Typsnittet laddas från tidningens egen sökväg `/assets/rev/fonts/bnsans/…` och fungerar
därför direkt när modulen ligger på samma domän som sajten – annars faller den tillbaka
på systemets sans-serif.

## Röstspärr

Läsaren identifieras med ett slumpat id i `localStorage`, som speglas till en cookie.
Det hindrar dubbelröstning av misstag, men inte någon som medvetet rensar sin lagring.
Behövs starkare spärr får `resolveVoterId()` i `src/app.js` knytas till inloggat konto.

## Tester

```bash
npm test
```

Sjutton fall: procentavrundningen, hela API:et via `src/handler.js`, och samma svit
körd mot båda datalagren – att rösträkningen stämmer med en omräkning hur rösterna än
flyttas, att en borttagen omröstning tar sina röster med sig, och att resultat överlever
en omstart. D1-implementationen testas mot en stand-in som talar D1:s API ovanpå SQLite,
vilket provkör den riktiga SQL:en och batchningen men inte ersätter ett rökprov efter
`wrangler deploy`.
