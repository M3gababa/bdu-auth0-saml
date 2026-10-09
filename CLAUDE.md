# CLAUDE.md

Demo SAML 2.0 Service Provider (Express) using Auth0 as the IdP. See `README.md` for setup and Auth0 configuration.

## Commands

- `npm install`: install dependencies
- `npm start`: run the app (`node server.js`) on `$PORT` (default 3000)
- `node --check server.js`: quick syntax check (there is no test suite or linter)

## Layout

- `server.js`: the whole app (config, SAML strategy, routes, HTML templates)
- `public/main.css`, `public/colors.css`: styling supplied by the user, served statically. `main.css` imports `colors.css` by relative path, so keep them together
- `.env` (git-ignored) / `.env.example`: configuration, loaded with `process.loadEnvFile`
- ES modules (`"type": "module"`), Node 22+. Only runtime deps: `express`, `express-session`, `passport`, `@node-saml/passport-saml`

## Conventions

- All tenant-specific values come from `.env`. Never hardcode a domain, client ID, entity ID or secret in `server.js`. A missing required variable must exit with a clear message.
- Keep it dependency-light: no dotenv, no template engine, no bundler. Pages are template strings built with the `page()` helper.
- Escape every dynamic value rendered into HTML with `esc()`. Assertion attributes are user-controlled.
- Style with the existing classes in `public/main.css` (`card`, `btn-*`, `badge-*`, `info-list`...). Do not add inline styles or new CSS unless a class is genuinely missing.

## SAML behaviour that is easy to break

- **One ACS for both flows.** `POST /saml/acs` serves SP-initiated and IdP-initiated responses. IdP-initiated ones have no `InResponseTo`, so `validateInResponseTo` must stay `'never'`. The profile page detects the flow by looking for `InResponseTo="` in the assertion XML.
- **Auth0 signs the Response, not the Assertion** (addon `signResponse: true`). Keep `wantAuthnResponseSigned: true` and `wantAssertionsSigned: false`. Flipping them causes `Error: Invalid signature`.
- **`SP_ENTITY_ID` must equal the addon `audience`.** It is used as both the strategy `issuer` and `audience`.
- **`APP_BASE_URL` must match** the addon's recipient/destination (`/saml/acs`) and `logout.callback` (`/saml/slo`), and the app's allowed callback URL.
- **IdP cert is fetched from metadata at startup** (`/samlp/metadata/<client_id>`). The app fails fast if it cannot be read. Rotation needs a restart.
- **`idpIssuer` is `urn:$AUTH0_DOMAIN`.** With a custom domain, the metadata `entityID` is `urn:<custom-domain>`. Observed: a login through the custom domain showed an assertion issuer of `urn:<tenant>.<region>.auth0app.com` (the canonical domain) and still validated, so the issuer check may not be enforced as assumed. This was not investigated further.
- **SLO is SP-initiated only.** `/logout` redirects to Auth0 with a `LogoutRequest`; the local session is destroyed only in `/saml/slo` after the `LogoutResponse` validates. The request is unsigned (no SP key) and the code uses the library's private `samlStrategy._saml`. Both are known limitations.

## Auth0 tenant notes

- The Auth0 CLI is used for tenant setup. Always run `auth0 tenants list` and confirm the **active** tenant before creating or patching anything: several tenants are logged in on this machine, and `auth0 tenants use` changes the global active tenant.
- Do not modify existing apps or connections on a shared tenant without asking. Adding this app to a connection's enabled clients is the only change normally needed.
- The reference setup used an Auth0 app named "SAML Demo SP"; the tenant and client ID live only in the local `.env`.
- No test user credentials are stored in the repo. Do not commit `.env`.
