# social-publisher-mcp

Serwer MCP do publikacji postów na **LinkedIn**, **Facebooku** (strony) i **Instagramie** (konta Business/Creator) przez oficjalne API:
LinkedIn Posts API oraz Meta Graph API. Nie korzysta z pośredników typu Buffer czy Zapier.

## Narzędzia

| Narzędzie | Co robi |
|---|---|
| `check_connections` | Sprawdza, które platformy są skonfigurowane i czy tokeny działają |
| `linkedin_create_post` | Tekst, link (karta artykułu), 1–20 zdjęć; profil osobisty lub strona firmy |
| `facebook_create_post` | Tekst, link, 1–10 zdjęć lub wideo; planowanie (`scheduled_at`) |
| `instagram_create_post` | Zdjęcie, karuzela (2–10), Reels |
| `social_publish` | Jeden post na kilku platformach naraz, z opcjonalną treścią dla każdej z nich |

Każde narzędzie ma parametr `dry_run: true`, który pokazuje dokładnie, co zostałoby wysłane, i niczego nie publikuje.
Ustaw `SOCIAL_MCP_DRY_RUN=true`, żeby był to tryb domyślny.

Co serwer robi sam:
- tekst na LinkedIn jest konwertowany do formatu „little text”. Bez tego LinkedIn po cichu ucina posty, np. na pierwszym nawiasie. Hashtagi pozostają klikalne.
- wersja LinkedIn API jest wybierana automatycznie, bo stare wersje wygasają po około roku. Możesz ją przypiąć przez `LINKEDIN_API_VERSION`.
- serwer czeka, aż Instagram przetworzy media (status `FINISHED`), i dopiero wtedy publikuje.
- zdjęcia z plików lokalnych są wysyłane na LinkedIn i Facebooka. Instagram przyjmuje tylko publiczne URL-e.

## Kolejka publikacji (planowanie na wszystkich platformach)

LinkedIn i Instagram nie pozwalają planować postów przez API, dlatego serwer ma własną kolejkę w pliku `schedule.json`:

| Narzędzie / skrypt | Co robi |
|---|---|
| `schedule_post` | Dodaje post do kolejki na wybraną datę (`publish_at`, ISO 8601) |
| `list_scheduled` / `cancel_scheduled` | Podgląd i anulowanie |
| `run_due_posts` | Wysyła od razu wszystko, czego termin już minął |
| `npm run queue:import -- plik.json` | Dodaje cały plan treści naraz |
| `npm run publish-due` | Wysyła zaległe posty; uruchamiaj cyklicznie |

Opcja `wait_for_link` wstrzymuje post, dopóki link nie zwraca HTTP 200. Przydaje się, gdy zajawka ma wyjść w dniu publikacji wpisu.
Posty spóźnione o ponad 12 h (np. gdy komputer był wyłączony) nie są wysyłane, tylko oznaczane jako `expired`. Próg zmienisz w `SOCIAL_MCP_MAX_DELAY_HOURS`.
Wyniki każdego uruchomienia trafiają do `schedule.json.log`.

Uruchamianie co 10 minut w Harmonogramie zadań Windows:
```bash
schtasks /Create /SC MINUTE /MO 10 /TN "social-publisher" /TR "node C:\sciezka\do\social-mcp\dist\scripts\publish-due.js"
```

## Instalacja

```bash
npm install
npm run build
cp .env.example .env   # uzupełnij tokeny
```

Wymaga Node.js ≥ 20.12.

## Tokeny

### LinkedIn

1. Utwórz aplikację na https://www.linkedin.com/developers/apps (musi być powiązana ze stroną firmy).
2. W zakładce **Products** dodaj **Share on LinkedIn** i **Sign In with LinkedIn using OpenID Connect**.
   Do publikacji jako strona firmy potrzebny jest też **Community Management API**, a w `LINKEDIN_SCOPES` scope `w_organization_social`.
3. W zakładce **Auth** dodaj redirect URL: `http://localhost:8765/callback`.
4. Wpisz `LINKEDIN_CLIENT_ID` i `LINKEDIN_CLIENT_SECRET` do `.env`, a potem uruchom:
   ```bash
   npm run auth:linkedin -- --write
   ```
   Otworzy się przeglądarka. Po zalogowaniu token i `LINKEDIN_AUTHOR_URN` trafią do `.env`.
   Token jest ważny **60 dni**, potem trzeba powtórzyć ten krok.
   Żeby publikować jako firma, ustaw `LINKEDIN_AUTHOR_URN=urn:li:organization:<ID>`. ID znajdziesz w URL panelu admina strony.

### Facebook i Instagram

1. Utwórz aplikację typu **Business** na https://developers.facebook.com/apps.
2. Instagram musi być kontem **Business lub Creator** połączonym z Twoją stroną na Facebooku.
3. W [Graph API Explorer](https://developers.facebook.com/tools/explorer/) wybierz aplikację i wygeneruj User Token z uprawnieniami:
   `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `business_management`, `instagram_basic`, `instagram_content_publish`.
4. Wpisz `META_APP_ID` i `META_APP_SECRET` do `.env`, a potem uruchom:
   ```bash
   npm run auth:meta -- <token_z_explorera>
   ```
   Skrypt wypisze Twoje strony wraz z połączonymi kontami Instagram. Wybierz jedną:
   ```bash
   npm run auth:meta -- <token> --page <PAGE_ID> --write
   ```
   Do `.env` trafią `FACEBOOK_PAGE_ID`, `FACEBOOK_PAGE_ACCESS_TOKEN` (**bezterminowy**) i `INSTAGRAM_USER_ID`.

> Publikacja na stronach, którymi zarządzasz, działa w trybie deweloperskim aplikacji. App Review jest potrzebne dopiero wtedy, gdy z aplikacji mają korzystać inne osoby.

## Podłączenie do Claude

**Claude Code:**
```bash
claude mcp add social-publisher -- node C:/sciezka/do/social-mcp/dist/index.js
```

**Claude Desktop** (`%APPDATA%\Claude\claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "social-publisher": {
      "command": "node",
      "args": ["C:/sciezka/do/social-mcp/dist/index.js"]
    }
  }
}
```

Serwer sam wczytuje `.env` z katalogu projektu. Zamiast tego możesz podać zmienne w sekcji `"env"` konfiguracji.

## Przykładowe polecenia

- „Sprawdź połączenia z social media”
- „Opublikuj na LinkedIn i Facebooku: *Startujemy z nową usługą…* z linkiem https://firma.pl/usluga. Najpierw pokaż dry run”
- „Wrzuć na Instagram karuzelę z tych 3 zdjęć: … z opisem …”
- „Zaplanuj post na FB na poniedziałek 9:00”

## Ograniczenia API

- **LinkedIn**: brak planowania przez API; wideo i dokumenty (PDF) nie są obsługiwane w tej wersji serwera.
- **Instagram**: wymaga zdjęcia lub wideo (sam tekst nie jest możliwy) z publicznego URL-a https; zdjęcia w JPEG; maks. 2200 znaków i 30 hashtagów; linki w opisie nie są klikalne; limit to 100 publikacji na dobę; brak planowania przez API.
- **Facebook**: planowanie od 10 minut do 30 dni do przodu; tylko strony (Pages), nie profile prywatne. Meta nie pozwala publikować na profilach prywatnych przez API.

---

**Autor:** [LuMiGRAF Technology Lab](https://dev.lm-ads.com) · kontakt: l@lm-networks.pl · © 2026
