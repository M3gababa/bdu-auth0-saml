# Auth0 SAML SSO demo

A small Express app that acts as a SAML 2.0 **Service Provider (SP)**, with **Auth0 as the Identity Provider (IdP)**.
It demonstrates, against any Auth0 tenant:

- **SP-initiated SSO**: the user starts at the app, which sends an `AuthnRequest` to Auth0.
- **IdP-initiated SSO**: the user starts at Auth0, which posts an unsolicited assertion to the app.
- **SP-initiated Single Logout (SLO)**: the app sends a `LogoutRequest` to Auth0 and ends its own session when Auth0 answers.

After login, the profile page shows which flow was used (it checks for `InResponseTo` in the assertion), plus the NameID, issuer and attributes.

## Requirements

- Node.js 22 or later (uses `process.loadEnvFile` and top-level `await`)
- An Auth0 tenant, and either the Dashboard or the [Auth0 CLI](https://github.com/auth0/auth0-cli) (`auth0 login` done)

## Quick start

```sh
npm install
cp .env.example .env     # then fill it in, see "Configure Auth0" below
npm start                # http://localhost:3000
```

## How it works

| Route | Purpose |
|---|---|
| `GET /` | Home page with the two entry points |
| `GET /login` | **SP-initiated**: redirects to Auth0 with a `SAMLRequest` |
| `POST /saml/acs` | Assertion Consumer Service. Receives **both** SP-initiated and IdP-initiated responses |
| `GET /profile` | Shows the authenticated user and the detected flow |
| `GET /logout` | Starts SLO: redirects to Auth0 with a `LogoutRequest` |
| `GET /saml/slo` | Receives Auth0's `LogoutResponse`, then destroys the local session |

Both flows land on the same ACS. The only observable difference is that an SP-initiated assertion answers a request (`InResponseTo` present), while an IdP-initiated one does not. That is why request-ID validation (`validateInResponseTo`) is disabled.

The IdP signing certificate is fetched from Auth0's SAML metadata at startup, so a certificate rotation only needs a restart.

## Configure Auth0

The app needs an Auth0 application with the **SAML2 Web App** addon. Replace `$APP_BASE_URL` below with the value you will put in `.env` (default `http://localhost:3000`).

| Setting | Value |
|---|---|
| Application type | Regular Web Application |
| Allowed callback URL | `$APP_BASE_URL/saml/acs` |
| Addon audience | `urn:saml-demo-sp` (must equal `SP_ENTITY_ID`) |
| Addon recipient / destination | `$APP_BASE_URL/saml/acs` |
| Addon logout callback | `$APP_BASE_URL/saml/slo` |
| Sign response | enabled |
| NameID format | `urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress` |
| Attribute mappings | `email` and `name` (see JSON below) |

The application must also be enabled on a database connection that contains the user you will log in with.

### Option A: Auth0 CLI

Make sure the CLI points at the right tenant first:

```sh
auth0 tenants list
auth0 tenants use <tenant-domain>
```

Then create the application and enable the addon:

```sh
APP_BASE_URL=http://localhost:3000

# 1. Create the application and note the client_id it prints
auth0 apps create --name "SAML Demo SP" --type regular \
  --callbacks "$APP_BASE_URL/saml/acs" --json --no-input

CLIENT_ID=<client_id from the output>

# 2. Enable and configure the SAML2 Web App addon
auth0 api patch clients/$CLIENT_ID --data '{
  "addons": {
    "samlp": {
      "audience": "urn:saml-demo-sp",
      "recipient": "'$APP_BASE_URL'/saml/acs",
      "destination": "'$APP_BASE_URL'/saml/acs",
      "mappings": {
        "email": "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress",
        "name": "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name"
      },
      "nameIdentifierFormat": "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress",
      "nameIdentifierProbes": ["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress"],
      "signResponse": true,
      "createUpnClaim": false,
      "passthroughClaimsWithNoMapping": false,
      "mapUnknownClaimsAsIs": false,
      "mapIdentities": false,
      "logout": { "callback": "'$APP_BASE_URL'/saml/slo", "slo_enabled": false }
    }
  }
}'

# 3. Enable the application on a database connection
auth0 api get connections --query "strategy=auth0"          # find the connection id (con_...)
auth0 api patch connections/<connection_id>/clients \
  --data '[{"client_id":"'$CLIENT_ID'","status":true}]'
```

### Option B: Dashboard

1. **Applications > Applications > Create Application**: name it `SAML Demo SP`, choose **Regular Web Applications**.
2. In **Settings**, set **Allowed Callback URLs** to `$APP_BASE_URL/saml/acs` and save.
3. Open the **Addons** tab, enable **SAML2 Web App**, then in its **Settings** tab:
   - **Application Callback URL**: `$APP_BASE_URL/saml/acs`
   - Replace the JSON settings with:
     ```json
     {
       "audience": "urn:saml-demo-sp",
       "recipient": "http://localhost:3000/saml/acs",
       "destination": "http://localhost:3000/saml/acs",
       "mappings": {
         "email": "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress",
         "name": "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name"
       },
       "nameIdentifierFormat": "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress",
       "nameIdentifierProbes": ["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress"],
       "signResponse": true,
       "logout": { "callback": "http://localhost:3000/saml/slo", "slo_enabled": false }
     }
     ```
   - Save.
4. **Authentication > Database > (your connection) > Applications**: enable `SAML Demo SP`.
5. Make sure a user exists in that connection (**User Management > Users**).

### Update `.env`

| Variable | Where to find it |
|---|---|
| `AUTH0_DOMAIN` | Your tenant domain, e.g. `my-tenant.eu.auth0.com`. **If the tenant has a custom domain, use it** (see the note below) |
| `AUTH0_CLIENT_ID` | Application **Settings > Client ID**, or the `client_id` printed by the CLI |
| `SP_ENTITY_ID` | Same value as the addon `audience` (default `urn:saml-demo-sp`) |
| `APP_BASE_URL` | Public URL of this app. Must match the ACS and SLO URLs configured in Auth0 |
| `PORT` | Local port (default `3000`). Keep it consistent with `APP_BASE_URL` |
| `SESSION_SECRET` | Any long random string: `openssl rand -hex 32` |

Example:

```dotenv
AUTH0_DOMAIN=my-tenant.eu.auth0.com
AUTH0_CLIENT_ID=AbCdEf123456
SP_ENTITY_ID=urn:saml-demo-sp
APP_BASE_URL=http://localhost:3000
PORT=3000
SESSION_SECRET=<output of openssl rand -hex 32>
```

You can check that the values are right by opening the SAML metadata, which must return XML:

```
https://<AUTH0_DOMAIN>/samlp/metadata/<AUTH0_CLIENT_ID>
```

> **Custom domains.** The `entityID` in that metadata is `urn:<domain>`, and it differs between the canonical domain and the custom domain. The app derives the expected IdP issuer from `AUTH0_DOMAIN`, so use the domain the tenant actually advertises.

### Switching tenant

1. Repeat the Auth0 configuration above on the new tenant.
2. Update `AUTH0_DOMAIN` and `AUTH0_CLIENT_ID` in `.env`.
3. Restart the app.

## Running the demo

1. **SP-initiated**: open `APP_BASE_URL`, click **Sign in with SSO**, authenticate at Auth0. The profile shows the **SP-initiated** badge.
2. **Logout**: click **Log out**. Auth0's session ends too, so signing in again asks for credentials.
3. **IdP-initiated**: from the home page click **Launch from the IdP**, or open `https://<AUTH0_DOMAIN>/samlp/<AUTH0_CLIENT_ID>` directly. The profile shows the **IdP-initiated** badge.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `Missing AUTH0_DOMAIN...` at startup | `.env` is missing or incomplete |
| `No signing cert found in ...` at startup | Wrong `AUTH0_DOMAIN` or `AUTH0_CLIENT_ID`, or the SAML addon is not enabled |
| `Invalid signature` | The addon signs the *response*, so the app must require a signed response and not a signed assertion (already configured). Also check that the cert in the metadata is the one in use, then restart |
| `Audience is invalid` | `SP_ENTITY_ID` differs from the addon `audience` |
| Login page reports a callback or destination mismatch | `APP_BASE_URL` differs from the ACS URL configured in Auth0 |
| Logging out then back in does not ask for credentials | `logout.callback` is not set, or `/saml/slo` is unreachable |
| Login fails with "user not found" or no connection | The app is not enabled on the connection, or the user does not exist there |

## Limitations

This is a demo, not production code.

- Plain HTTP and an in-memory session store. Use HTTPS and a real session store for anything beyond localhost.
- The `LogoutRequest` is not signed, because the SP has no signing key.
- Only SP-initiated logout is implemented. IdP-initiated logout (`slo_enabled`) is not.
- `/saml/slo` relies on the library's private `_saml` property, which may change between versions.
