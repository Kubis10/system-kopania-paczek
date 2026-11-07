# przesyłka.

Polski panel nadawania i śledzenia paczek, z osobnym REST API. Monorepo: Next.js 16 + React + TypeScript, NestJS/Express, PostgreSQL 16 i Redis 7.

## Lokalny podgląd

Wymagany Node.js 22 lub nowszy. Pierwsze uruchomienie:

```powershell
npm install
npm --prefix backend install
npm --prefix frontend install
npm run configure:local
npm run dev
```

`configure:local` tworzy lub aktualizuje ignorowany przez Git `.env`, generuje brakujące sekrety JWT/AES i ustawia tryb developerski z danymi demo. Zachowuje konfigurację SMTP; nigdy nie wypisuje kluczy. Nie jest potrzebny plik `.env.example`.

Panel: <http://localhost:3000>. API: <http://localhost:4000/api/health>. Lokalny backend domyślnie włącza jawnie oznaczony tryb demonstracyjny z fikcyjnymi przesyłkami. Dane demo żyją w pamięci i znikają po restarcie. W widoku demo kod odbioru to `123456`; tworzone paczki pokazują jednorazowy kod w szczegółach. Selektor w **Ustawienia konta** pozwala sprawdzić widoki klienta, kuriera i administratora.

Wbudowane konto trybu demo: login `aleksandra@demo.przesylka.pl`; hasło nie jest wymagane, aplikacja loguje automatycznie. Rolę widoku wybierzesz w **Ustawienia konta**.

## Lokalna baza danych

Ta ścieżka uruchamia API i frontend lokalnie, a PostgreSQL oraz Redis w Dockerze. Przygotuj `.env` i lokalne sekrety:

```powershell
npm run configure:local
```

W `.env` ustaw `DEMO_MODE=false`, `DATABASE_URL=postgres://courier:courier_dev@localhost:5433/courier`, `REDIS_URL=redis://:redis_dev@localhost:6379`, `ADMIN_EMAIL` oraz `ADMIN_PASSWORD` (minimum 12 znaków). Uruchom PostgreSQL i Redis:

```powershell
docker compose -f docker-compose.dev.yml up -d database redis
```

Następnie wykonaj migrację, utwórz administratora i uruchom aplikację:

```powershell
npm --prefix backend run migrate
npm --prefix backend run seed:admin
npm run dev
```

Loginem administratora jest wartość `ADMIN_EMAIL`, a hasłem wartość `ADMIN_PASSWORD` z `.env`. Konta klientów i kurierów zakłada administrator przez chroniony endpoint `POST /api/admin/users`; loginem i hasłem są wartości podane podczas tworzenia konta. Logowanie przyjmuje konta wcześniej utworzone; publiczna rejestracja jest wyłączona.

Alternatywnie pełny stos deweloperski uruchom jednym poleceniem: `docker compose -f docker-compose.dev.yml up -d --build`. Compose wykona migrację i idempotentny seed. Konta do logowania:

| Rola | Login | Hasło |
| --- | --- | --- |
| Klient demo | `klient@localhost.test` | `StudentDemo2026!` domyślnie; wartość `DEMO_SEED_PASSWORD` z `.env`, jeśli ustawiono ją przed pierwszym seedem |
| Kurier demo | `kurier@localhost.test` | takie samo jak dla klienta demo |
94g4yJiZH3ePAdI-rlLzFHiefLYeE3lJvzD36HdvBe0

Seed tworzy też 16 przykładowych paczek. PIN odbioru tych paczek to `123456`. To dane wyłącznie lokalne do prezentacji projektu.

## API

- `POST /api/auth/demo` (wyłącznie w trybie demo), `POST /api/auth/login`, `POST /api/auth/verify-2fa`, `POST /api/auth/refresh`, `POST /api/auth/logout`, `GET /api/auth/me`
- `POST /api/auth/2fa/setup`, `POST /api/auth/2fa/enable`, `POST /api/auth/2fa/disable`
- `GET/POST /api/parcels`, `GET /api/parcels/:id`, `PATCH /api/parcels/:id/status`
- `POST /api/parcels/:id/pay` — symulowana płatność lokalna
- `GET /api/track/:number` (publiczne śledzenie bez danych odbiorcy)
- `GET /api/admin/audit`, `GET/POST /api/admin/users`

Administrator może tworzyć konta klientów i kurierów w **Ustawieniach konta → Konta użytkowników**. Przy nadaniu paczki do doręczenia wybiera kuriera z listy tych kont.

Każda nowa paczka ma status płatności `UNPAID`. Klient lub administrator może wybrać **Opłać testowo**, co zapisuje status `PAID` i pozwala kontynuować trasę. To symulacja do projektu: nie przyjmuje numeru karty, nie łączy się z bankiem i nie pobiera prawdziwych pieniędzy. Raport pokazuje sumę opłaconą i oczekującą.

Token dostępu jest ważny 15 minut; rotowany refresh token ma 7 dni i jest w ciasteczku HttpOnly, Secure w produkcji, SameSite=Strict. Przesyłka przechodzi statusy kolejno. Doręczenie wymaga Argon2id-hashowanego kodu PIN. Kurier widzi adres dopiero dla własnej paczki w statusie doręczenia. Dane osobowe i sekrety TOTP są szyfrowane AES-256-GCM na poziomie aplikacji.

### Authenticator i powiadomienia e-mail

W **Ustawienia konta** uruchom konfigurację 2FA, zeskanuj kod QR aplikacją Google Authenticator, Microsoft Authenticator, Authy lub inną zgodną z TOTP (RFC 6238), a potem potwierdź kodem 6-cyfrowym. Sekret jest pokazywany tylko podczas konfiguracji.

Aby włączyć e-maile, załóż konto SMTP u dostawcy z darmowym planem (np. Brevo), zweryfikuj adres nadawcy i wstaw jego dane do `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD` i `SMTP_FROM` w `.env`. Dla Brevo użyj hosta `smtp-relay.brevo.com`, portu `587`, TLS STARTTLS (`SMTP_SECURE=false`) oraz klucza SMTP z panelu dostawcy. Po restarcie API `/api/health` zwróci `emailNotifications: true`; formularz nadania wymaga e-maila odbiorcy, na który trafi PIN, a później aktualizacje statusu. Limity darmowego planu i weryfikację nadawcy ustala dostawca. Nie umieszczaj klucza SMTP w repozytorium.

## Docker i TLS

Wdrożenie wymaga certyfikatów TLS 1.3 w `certs/fullchain.pem` i `certs/privkey.pem`, poprawnego `.env` oraz hosta wskazującego na serwer. `.env` musi zawierać `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `REDIS_PASSWORD`, `FRONTEND_ORIGIN`, `JWT_SECRET` i `ENCRYPTION_KEY`; ustaw także `ADMIN_EMAIL` oraz `ADMIN_PASSWORD`, aby utworzyć pierwsze konto. Klucz AES powinien być losowymi 32 bajtami zapisanymi jako Base64, a `JWT_SECRET` powinien pochodzić z bezpiecznego generatora. Nie używaj wartości przykładowych na wdrożeniu.

Uruchom `docker compose up -d --build`. Kontener migracji wykona schemat przed uruchomieniem API. Pierwsze konto administratora załóż poleceniem `docker compose run --rm backend node dist/seed-admin.js`.

PostgreSQL i Redis są wyłącznie w wewnętrznej sieci Docker. Frontend i API działają jako nie-root w obrazach multi-stage; tylko Nginx publikuje porty. Utrzymuj kopię zapasową PostgreSQL i kopię klucza szyfrującego poza kontenerem. Utrata klucza uniemożliwia odszyfrowanie danych.

## Zakres demonstracyjny

E-maile wymagają skonfigurowania SMTP; SMS, numer VoIP, webhooki, rzeczywisty przydział tras, skanowanie etykiet i odzyskiwanie konta nie są podłączone. W trybie produkcyjnym PIN nie jest zwracany przez API; przed prawdziwymi doręczeniami ustaw i przetestuj SMTP.

## Kontrole

```powershell
npm --prefix backend test
npm --prefix backend run build
npm --prefix frontend exec -- tsc --noEmit -p frontend/tsconfig.json
npm --prefix frontend run lint
```

Audyt zależności produkcyjnych API i frontendu nie wykazuje podatności. Pełny audyt devDependencies frontendu wykrywa nierozwiązaną podatność `braces` w łańcuchu `eslint-config-next`; aktualnie opublikowana wersja 3.0.3 nadal jest objęta advisory, a sugerowany automatycznie downgrade ESLinta wymagałby zejścia do Next.js 14. CI skanuje produkcyjne zależności, kod (CodeQL), sekrety oraz obrazy kontenerów; deployment do rejestru i serwera wymaga konfiguracji sekretów oraz infrastruktury.
