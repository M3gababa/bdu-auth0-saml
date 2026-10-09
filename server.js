import { existsSync } from 'node:fs';
import express from 'express';
import session from 'express-session';
import passport from 'passport';
import { Strategy as SamlStrategy } from '@node-saml/passport-saml';

if (existsSync('.env')) process.loadEnvFile('.env'); // real environment variables take precedence

const required = (name) => {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing ${name}. Copy .env.example to .env and fill it in.`);
    process.exit(1);
  }
  return v;
};

// Use the custom domain if the tenant has one: it is also the IdP entityID (urn:<domain>)
const TENANT = required('AUTH0_DOMAIN');
const CLIENT_ID = required('AUTH0_CLIENT_ID');
const SESSION_SECRET = required('SESSION_SECRET');
const SP_ENTITY_ID = process.env.SP_ENTITY_ID || 'urn:saml-demo-sp'; // must match the addon's "audience"
const PORT = process.env.PORT || 3000;
const BASE = (process.env.APP_BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');

// Auth0 SAML endpoints (the same URL serves SP-initiated requests and IdP-initiated launches)
const IDP_SSO_URL = `https://${TENANT}/samlp/${CLIENT_ID}`;
const IDP_LOGOUT_URL = `https://${TENANT}/samlp/${CLIENT_ID}/logout`;
const IDP_METADATA_URL = `https://${TENANT}/samlp/metadata/${CLIENT_ID}`;

// Fetch the IdP signing certificate from metadata at startup
const metadata = await (await fetch(IDP_METADATA_URL)).text();
const idpCert = metadata.match(/<X509Certificate>([^<]+)<\/X509Certificate>/)?.[1];
if (!idpCert) throw new Error(`No signing cert found in ${IDP_METADATA_URL}`);

const samlStrategy = new SamlStrategy(
    {
      entryPoint: IDP_SSO_URL,
      logoutUrl: IDP_LOGOUT_URL,
      callbackUrl: `${BASE}/saml/acs`,
      issuer: SP_ENTITY_ID,
      idpCert,
      idpIssuer: `urn:${TENANT}`,
      audience: SP_ENTITY_ID,
      identifierFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
      // The addon has signResponse=true, so Auth0 signs the <Response>, not the <Assertion>
      wantAuthnResponseSigned: true,
      wantAssertionsSigned: false,
      acceptedClockSkewMs: 5000,
      // IdP-initiated responses carry no InResponseTo, so request-ID tracking must stay off
      validateInResponseTo: 'never',
    },
    (profile, done) => done(null, profile), // signon
    (profile, done) => done(null, profile), // logout
  );
passport.use(samlStrategy);
passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

const app = express();
app.use(express.static(new URL('./public', import.meta.url).pathname));
app.use(express.urlencoded({ extended: false }));
app.use(session({ secret: SESSION_SECRET, resave: false, saveUninitialized: false }));
app.use(passport.initialize());
app.use(passport.session());

const esc = (v) => String(v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const page = (body) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SAML Demo SP</title>
<link rel="stylesheet" href="/main.css"></head>
<body><div id="app"><main class="main-content"><div class="container" style="max-width:820px">${body}</div></main></div></body></html>`;

app.get('/', (req, res) => {
  if (req.isAuthenticated()) return res.redirect('/profile');
  res.send(
    page(`<div class="section">
  <h1>SAML Demo SP</h1>
  <p class="section-subtitle">Identity provider: <code>${esc(TENANT)}</code></p>
</div>
<div class="card section">
  <div class="card-header"><span class="card-title">SP-initiated</span><span class="badge badge-info">AuthnRequest</span></div>
  <p>The user starts here. This app sends a SAML request to Auth0, which authenticates the user and posts the assertion back to <code>/saml/acs</code>.</p>
  <div class="card-actions"><a class="btn btn-primary" href="/login">Sign in with SSO</a></div>
</div>
<div class="card section">
  <div class="card-header"><span class="card-title">IdP-initiated</span><span class="badge badge-warning">Unsolicited</span></div>
  <p>The user starts at the identity provider. Auth0 posts an assertion to <code>/saml/acs</code> without any prior request from this app.</p>
  <div class="card-actions"><a class="btn btn-accent" href="${esc(IDP_SSO_URL)}">Launch from the IdP</a></div>
</div>`),
  );
});

// SP-initiated: redirect to Auth0 with a SAMLRequest
app.get('/login', passport.authenticate('saml', { failureRedirect: '/', additionalParams: {} }));

// Assertion Consumer Service: receives BOTH SP-initiated and IdP-initiated responses.
// The only observable difference is the absence of InResponseTo in the IdP-initiated case.
app.post('/saml/acs', passport.authenticate('saml', { failureRedirect: '/' }), (req, res) => {
  // SP-initiated responses reference our AuthnRequest ID; IdP-initiated ones are unsolicited
  req.session.hasInResponseTo = /InResponseTo="/.test(req.user.getAssertionXml?.() ?? '');
  res.redirect('/profile');
});

app.get('/profile', (req, res) => {
  if (!req.isAuthenticated()) return res.redirect('/');
  const u = req.user;
  const sp = req.session.hasInResponseTo;
  const attrs = Object.entries(u.attributes ?? {})
    .map(([k, v]) => `<div class="info-item"><dt>${esc(k.split('/').pop())}</dt><dd>${esc(v)}</dd></div>`)
    .join('');
  res.send(
    page(`<div class="section"><h1>Signed in</h1></div>
<div class="card section">
  <div class="card-header">
    <span class="card-title">Flow detected</span>
    <span class="badge ${sp ? 'badge-info' : 'badge-warning'}">${sp ? 'SP-initiated' : 'IdP-initiated'}</span>
  </div>
  <p>${sp ? 'The assertion answers our AuthnRequest (<code>InResponseTo</code> present).' : 'Unsolicited assertion: there is no <code>InResponseTo</code>.'}</p>
</div>
<div class="card section">
  <div class="card-header"><span class="card-title">Assertion</span></div>
  <dl class="info-list">
    <div class="info-item"><dt>NameID</dt><dd>${esc(u.nameID)}</dd></div>
    <div class="info-item"><dt>Issuer</dt><dd>${esc(u.issuer ?? '')}</dd></div>
    ${attrs}
  </dl>
  <div class="card-actions"><a class="btn btn-secondary" href="/logout">Log out</a></div>
</div>`),
  );
});

// SP-initiated Single Logout: send a LogoutRequest to Auth0, which ends its session and answers on /saml/slo.
// The local session is only destroyed once that LogoutResponse comes back.
app.get('/logout', async (req, res, next) => {
  if (!req.isAuthenticated()) return res.redirect('/');
  try {
    const url = await samlStrategy._saml.getLogoutUrlAsync(req.user, '/', {});
    res.redirect(url);
  } catch (err) {
    next(err);
  }
});

app.get('/saml/slo', async (req, res, next) => {
  try {
    const originalQuery = new URL(req.originalUrl, BASE).search.slice(1);
    const { loggedOut } = await samlStrategy._saml.validateRedirectAsync(req.query, originalQuery);
    if (!loggedOut) return res.status(400).send('Unexpected SAML message on the SLO endpoint');
    req.logout((err) => (err ? next(err) : req.session.destroy(() => res.redirect('/'))));
  } catch (err) {
    next(err);
  }
});

app.listen(PORT, () => console.log(`SAML SP listening on ${BASE}`));
