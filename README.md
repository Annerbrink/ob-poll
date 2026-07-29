# 1 X 2-omröstning

Inbäddningsbar tippningsmodul för fotbollsmatcher. Skribenten fyller i de två lagen,
läsarna tippar **1** (hemmavinst), **X** (oavgjort) eller **2** (bortavinst) och
resultatet visas i procent. Röster och omröstningar sparas serverside, så alla
läsare ser samma siffror.

## Kom igång

```bash
npm install
ADMIN_TOKEN=valfri-hemlig-sträng npm start
```

- Skribentvy: <http://localhost:3000/skribent.html>
- Widget: `http://localhost:3000/widget.html?poll=<id>`

Sätts inte `ADMIN_TOKEN` genereras en tillfällig token som skrivs ut i loggen.

### Miljövariabler

| Variabel | Standard | Beskrivning |
| --- | --- | --- |
| `PORT` | `3000` | Port. |
| `ADMIN_TOKEN` | slumpas vid start | Token som krävs för att skapa och ta bort omröstningar. |
| `DATABASE_FILE` | `data/polls.db` | Var SQLite-filen ligger. |
| `FRAME_ANCESTORS` | – | Sätt till t.ex. `https://*.olandsbladet.se` för att bara tillåta inbäddning på egna domäner. |

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

All läsning och skrivning går genom `src/repository.js`, som är den enda modul som
känner till databasen. Standardimplementationen är SQLite (`data/polls.db`) med två
tabeller enligt `src/schema.sql`:

- `polls` – id, lagnamn, avspark, stängningstid, skapad av, skapad när
- `votes` – en rad per läsare och omröstning (`PRIMARY KEY (poll_id, voter_id)`), så en
  läsare som ändrar sig flyttar sin röst i stället för att lägga till en ny

Ska omröstningarna ligga i tidningens egen databas i stället byter man ut
`createRepository()` mot en implementation med samma sju metoder – `createPoll`,
`getPoll`, `listPolls`, `deletePoll`, `castVote`, `getVote` och `getTally`. Inget
annat i koden rör lagringen.

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

Täcker procentavrundning, skapande av omröstning, att en ändrad röst flyttas i stället
för att räknas dubbelt, att resultat överlever en omstart, stängd omröstning samt
behörighets- och valideringsfel.
