// Odoo built-in DB API client — for THIS deployment, which exposes only the
// `web` controllers (no /jsonrpc, no /xmlrpc). So:
//   - DB lifecycle (create/duplicate/drop/backup/restore) -> /web/database/* (form posts)
//   - module installs on a new tenant -> /web/session/authenticate + /web/dataset/call_kw,
//     which are dbfilter-scoped, so they MUST carry Host: <db>.<domain> (and the Host
//     header is forbidden in fetch(), hence raw node:http for those calls).
import http from 'node:http';
import { Readable } from 'node:stream';

function target(inst) {
  const u = new URL(inst.odooUrl);
  return { host: u.hostname, port: Number(u.port) || 80 };
}

// Raw POST with full header control (lets us set Host for dbfilter routing).
function rawPost(inst, path, { contentType, body, host, cookie }: any): Promise<any> {
  const { host: h, port } = target(inst);
  return new Promise((resolve, reject) => {
    const headers = { 'Content-Type': contentType, 'Content-Length': Buffer.byteLength(body) };
    if (host) headers['Host'] = host;
    if (cookie) headers['Cookie'] = cookie;
    const req = http.request({ host: h, port, path, method: 'POST', headers }, (res) => {
      let b = '';
      res.on('data', (c) => (b += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b }));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function form(fields) {
  return new URLSearchParams(fields).toString();
}

// On success Odoo's /web/database/* form endpoints redirect (3xx); on failure they
// render the manager page (200) with the error inline.
function expectRedirect(res, what) {
  if (res.status >= 300 && res.status < 400) return true;
  const m = res.body && res.body.match(/(?:creation error|Error)[:\s]*([^<]{0,200})/i);
  throw new Error(m ? m[1].trim() : `${what} failed (HTTP ${res.status})`);
}

export async function createDatabase(inst, name, adminPassword) {
  const res = await rawPost(inst, '/web/database/create', {
    contentType: 'application/x-www-form-urlencoded',
    body: form({
      master_pwd: inst.masterPassword,
      name,
      login: 'admin',
      password: adminPassword,
      phone: '',
      lang: inst.defaultLang || 'en_US',
      country_code: (inst.defaultCountry || '').toLowerCase(),
    }),
  });
  return expectRedirect(res, 'create');
}

export async function duplicateDatabase(inst, source, target_) {
  const res = await rawPost(inst, '/web/database/duplicate', {
    contentType: 'application/x-www-form-urlencoded',
    body: form({ master_pwd: inst.masterPassword, name: source, new_name: target_ }),
  });
  return expectRedirect(res, 'duplicate');
}

export async function dropDatabase(inst, name) {
  const res = await rawPost(inst, '/web/database/drop', {
    contentType: 'application/x-www-form-urlencoded',
    body: form({ master_pwd: inst.masterPassword, name }),
  });
  return expectRedirect(res, 'drop');
}

// Set the new tenant's country + currency BEFORE the accounting modules install.
// Odoo selects the chart template from the company country at `account`-install time,
// so country-first makes the Moroccan l10n_ma chart (PCM/CGNC) + the legal 20/14/10/7
// TVA grid load instead of the generic chart. Runs while only `base` is installed.
// Tenant-scoped -> Host header.
export async function ensureLocalization(inst, db, adminPassword, { countryCode, currencyCode }) {
  const host = `${db}.${inst.domain}`;
  const auth = await rawPost(inst, '/web/session/authenticate', {
    contentType: 'application/json',
    host,
    body: JSON.stringify({ jsonrpc: '2.0', params: { db, login: 'admin', password: adminPassword } }),
  });
  const cookie = ((auth.headers['set-cookie'] || []).join(';')).split(';').find((s) => s.trim().startsWith('session_id'));
  const authJson = JSON.parse(auth.body);
  if (!authJson.result || !authJson.result.uid) throw new Error('could not authenticate to set localization');

  const callKw = async (model, method, args, kwargs = {}) => {
    const r = await rawPost(inst, '/web/dataset/call_kw', {
      contentType: 'application/json',
      host,
      cookie,
      body: JSON.stringify({ jsonrpc: '2.0', params: { model, method, args, kwargs } }),
    });
    const j = JSON.parse(r.body);
    if (j.error) throw new Error(j.error.data ? j.error.data.message : 'call_kw error');
    return j.result;
  };

  const vals: any = {};
  if (countryCode) {
    const cids = await callKw('res.country', 'search', [[['code', '=', String(countryCode).toUpperCase()]]], { limit: 1 });
    if (cids && cids.length) vals.country_id = cids[0];
  }
  if (currencyCode) {
    const curIds = await callKw('res.currency', 'search', [[['name', '=', String(currencyCode).toUpperCase()]]], { limit: 1, context: { active_test: false } });
    if (curIds && curIds.length) {
      await callKw('res.currency', 'write', [[curIds[0]], { active: true }]);
      vals.currency_id = curIds[0];
    }
  }
  if (Object.keys(vals).length === 0) return { localized: false };
  const ids = await callKw('res.company', 'search', [[]], { limit: 1 });
  const cid = Array.isArray(ids) && ids.length ? ids[0] : 1;
  await callKw('res.company', 'write', [[cid], vals]);
  return { localized: true, ...vals };
}

// Install modules on a freshly created tenant via a dbfilter-scoped web session.
export async function installModules(inst, db, adminPassword, modulesCsv) {
  const modules = (modulesCsv || '').split(',').map((m) => m.trim()).filter(Boolean);
  if (modules.length === 0) return { installed: [] };
  const host = `${db}.${inst.domain}`;

  const auth = await rawPost(inst, '/web/session/authenticate', {
    contentType: 'application/json',
    host,
    body: JSON.stringify({ jsonrpc: '2.0', params: { db, login: 'admin', password: adminPassword } }),
  });
  const setCookie = (auth.headers['set-cookie'] || []).join(';');
  const cookie = setCookie.split(';').find((s) => s.trim().startsWith('session_id'));
  const authJson = JSON.parse(auth.body);
  if (!authJson.result || !authJson.result.uid) throw new Error('could not authenticate on the new DB');

  const callKw = async (model, method, args) => {
    const r = await rawPost(inst, '/web/dataset/call_kw', {
      contentType: 'application/json',
      host,
      cookie,
      body: JSON.stringify({ jsonrpc: '2.0', params: { model, method, args, kwargs: {} } }),
    });
    const j = JSON.parse(r.body);
    if (j.error) throw new Error(j.error.data ? j.error.data.message : 'call_kw error');
    return j.result;
  };

  const ids = await callKw('ir.module.module', 'search', [[['name', 'in', modules]]]);
  if (!ids || ids.length === 0) throw new Error(`none of [${modules.join(', ')}] found`);
  await callKw('ir.module.module', 'button_immediate_install', [ids]);
  return { installed: modules };
}

// Set the new tenant's Connecteo One pack + client fiche on its res.company.
// Pack/fiche fields come from cto_security_profiles (install it first). The pack's
// apps are installed explicitly beforehand (installModules); cto_pack itself is
// just stored metadata (no server-side engine). Tenant-scoped -> Host header.
// Post-creation edits go through the dashboard's /api/profile (direct Postgres).
export async function setCompanyProfile(inst, db, adminPassword, vals) {
  const fields = Object.fromEntries(
    Object.entries(vals || {}).filter(([, v]) => v !== undefined && v !== null && v !== ''),
  );
  if (Object.keys(fields).length === 0) return { updated: [] };
  const host = `${db}.${inst.domain}`;

  const auth = await rawPost(inst, '/web/session/authenticate', {
    contentType: 'application/json',
    host,
    body: JSON.stringify({ jsonrpc: '2.0', params: { db, login: 'admin', password: adminPassword } }),
  });
  const cookie = ((auth.headers['set-cookie'] || []).join(';')).split(';').find((s) => s.trim().startsWith('session_id'));
  const authJson = JSON.parse(auth.body);
  if (!authJson.result || !authJson.result.uid) throw new Error('could not authenticate to set company profile');

  const callKw = async (model, method, args) => {
    const r = await rawPost(inst, '/web/dataset/call_kw', {
      contentType: 'application/json',
      host,
      cookie,
      body: JSON.stringify({ jsonrpc: '2.0', params: { model, method, args, kwargs: {} } }),
    });
    const j = JSON.parse(r.body);
    if (j.error) throw new Error(j.error.data ? j.error.data.message : 'call_kw error');
    return j.result;
  };

  const ids = await callKw('res.company', 'search', [[]]);
  const cid = Array.isArray(ids) && ids.length ? ids[0] : 1;
  await callKw('res.company', 'write', [[cid], fields]);
  return { updated: Object.keys(fields) };
}

// Create the tenant's own admin account (the one the CLIENT logs in with) and
// keep the default "admin" (uid 2) as a hidden Connecteo recovery account.
// The new admin is a "Direction" business admin: it clones the default admin's
// groups MINUS system + access-rights management (so it can't install apps /
// reach technical settings), PLUS the cto Direction profile. uid 1 (OdooBot) is
// already inactive; uid 2 stays active but the client has no UI to reach it.
// Tenant-scoped -> Host header. Returns { uid, login }.
export async function createTenantAdmin(inst, db, defaultAdminPassword, { login, name, password, lang }) {
  const host = `${db}.${inst.domain}`;
  const auth = await rawPost(inst, '/web/session/authenticate', {
    contentType: 'application/json',
    host,
    body: JSON.stringify({ jsonrpc: '2.0', params: { db, login: 'admin', password: defaultAdminPassword } }),
  });
  const cookie = ((auth.headers['set-cookie'] || []).join(';')).split(';').find((s) => s.trim().startsWith('session_id'));
  const authJson = JSON.parse(auth.body);
  const defaultUid = authJson.result && authJson.result.uid;
  if (!defaultUid) throw new Error('could not authenticate to create tenant admin');

  const callKw = async (model, method, args, kwargs = {}) => {
    const r = await rawPost(inst, '/web/dataset/call_kw', {
      contentType: 'application/json',
      host,
      cookie,
      body: JSON.stringify({ jsonrpc: '2.0', params: { model, method, args, kwargs } }),
    });
    const j = JSON.parse(r.body);
    if (j.error) throw new Error(j.error.data ? j.error.data.message : 'call_kw error');
    return j.result;
  };

  const ref = async (mod, xid) => {
    const res = await callKw('ir.model.data', 'check_object_reference', [mod, xid]);
    return Array.isArray(res) ? res[1] : null;
  };
  const gSystem = await ref('base', 'group_system');
  const gErpManager = await ref('base', 'group_erp_manager');
  const gNoOne = await ref('base', 'group_no_one');
  const gDirection = await ref('cto_security_profiles', 'group_cto_direction');

  // Clone the default admin's groups, drop system + access-rights mgmt + technical
  // (so the client can't install apps, manage access rights, or reach developer
  // features → can't self-escalate), add the cto Direction profile.
  const [adminRec] = await callKw('res.users', 'read', [[defaultUid], ['group_ids']]);
  const drop = new Set([gSystem, gErpManager, gNoOne].filter(Boolean));
  const groupIds = (adminRec.group_ids || []).filter((id) => !drop.has(id));
  if (gDirection && !groupIds.includes(gDirection)) groupIds.push(gDirection);

  const vals = {
    name: name || 'Administrateur',
    login,
    email: login.includes('@') ? login : false,
    password,
    lang: lang || 'fr_FR',
    group_ids: [[6, 0, groupIds]],
  };
  const uid = await callKw('res.users', 'create', [vals], { context: { no_reset_password: true } });
  return { uid, login };
}

// Reset the tenant's Direction admin password (recovery — Odoo stores passwords
// hashed, so the original can't be retrieved; we set a fresh one). Authenticates
// as the shared "admin", finds the Direction admin (excluding uid 1/2), writes the
// new password. Returns { login, password }. Tenant-scoped -> Host header.
export async function resetTenantAdmin(inst, db, adminPassword, newPassword) {
  const host = `${db}.${inst.domain}`;
  const auth = await rawPost(inst, '/web/session/authenticate', {
    contentType: 'application/json',
    host,
    body: JSON.stringify({ jsonrpc: '2.0', params: { db, login: 'admin', password: adminPassword } }),
  });
  const cookie = ((auth.headers['set-cookie'] || []).join(';')).split(';').find((s) => s.trim().startsWith('session_id'));
  const authJson = JSON.parse(auth.body);
  if (!authJson.result || !authJson.result.uid) throw new Error('could not authenticate to reset admin');

  const callKw = async (model, method, args, kwargs = {}) => {
    const r = await rawPost(inst, '/web/dataset/call_kw', {
      contentType: 'application/json',
      host,
      cookie,
      body: JSON.stringify({ jsonrpc: '2.0', params: { model, method, args, kwargs } }),
    });
    const j = JSON.parse(r.body);
    if (j.error) throw new Error(j.error.data ? j.error.data.message : 'call_kw error');
    return j.result;
  };

  const dirRef = await callKw('ir.model.data', 'check_object_reference', ['cto_security_profiles', 'group_cto_direction']);
  const gDirection = Array.isArray(dirRef) ? dirRef[1] : null;
  const ids = await callKw('res.users', 'search', [[
    ['group_ids', 'in', [gDirection]], ['id', 'not in', [1, 2]], ['active', '=', true],
  ]]);
  if (!ids || !ids.length) throw new Error('no tenant admin (Direction) found to reset');
  const uid = ids[0];
  const [rec] = await callKw('res.users', 'read', [[uid], ['login']]);
  await callKw('res.users', 'write', [[uid], { password: newPassword }], { context: { no_reset_password: true } });
  return { login: rec.login, password: newPassword };
}

// Re-apply the app-dependent Connecteo branding (appsbar icons + order, Stock
// rename) AFTER the pack's apps are installed. Odoo installs modules in
// dependency order and the pack apps don't depend on cto_branding, so they can
// land after cto_branding's post_init hook ran — this re-runs the branding over
// every installed app. Tenant-scoped -> Host header. Idempotent server-side.
export async function reapplyBranding(inst, db, adminPassword) {
  const host = `${db}.${inst.domain}`;
  const auth = await rawPost(inst, '/web/session/authenticate', {
    contentType: 'application/json',
    host,
    body: JSON.stringify({ jsonrpc: '2.0', params: { db, login: 'admin', password: adminPassword } }),
  });
  const cookie = ((auth.headers['set-cookie'] || []).join(';')).split(';').find((s) => s.trim().startsWith('session_id'));
  const authJson = JSON.parse(auth.body);
  if (!authJson.result || !authJson.result.uid) throw new Error('could not authenticate to re-apply branding');
  const r = await rawPost(inst, '/web/dataset/call_kw', {
    contentType: 'application/json',
    host,
    cookie,
    body: JSON.stringify({
      jsonrpc: '2.0',
      params: { model: 'res.company', method: 'cto_reapply_app_branding', args: [], kwargs: {} },
    }),
  });
  const j = JSON.parse(r.body);
  if (j.error) throw new Error(j.error.data ? j.error.data.message : 'reapply branding error');
  return j.result;
}

// Shared: authenticate to a tenant (Host-scoped) and return a call_kw helper that
// supports kwargs. Centralises the auth dance the module/warehouse ops below need.
async function tenantCallKw(inst, db, adminPassword) {
  const host = `${db}.${inst.domain}`;
  const auth = await rawPost(inst, '/web/session/authenticate', {
    contentType: 'application/json',
    host,
    body: JSON.stringify({ jsonrpc: '2.0', params: { db, login: 'admin', password: adminPassword } }),
  });
  const cookie = ((auth.headers['set-cookie'] || []).join(';')).split(';').find((s) => s.trim().startsWith('session_id'));
  const authJson = JSON.parse(auth.body);
  if (!authJson.result || !authJson.result.uid) throw new Error('could not authenticate on the tenant');
  return async (model, method, args, kwargs = {}) => {
    const r = await rawPost(inst, '/web/dataset/call_kw', {
      contentType: 'application/json',
      host,
      cookie,
      body: JSON.stringify({ jsonrpc: '2.0', params: { model, method, args, kwargs } }),
    });
    const j = JSON.parse(r.body);
    if (j.error) throw new Error(j.error.data ? j.error.data.message : 'call_kw error');
    return j.result;
  };
}

// Uninstall modules on an existing tenant (post-creation module edit). Only acts on
// modules that are actually installed. WARNING (surfaced to the operator in the UI):
// uninstalling an Odoo app drops that app's data — it is destructive and irreversible.
export async function uninstallModules(inst, db, adminPassword, modulesCsv) {
  const modules = (modulesCsv || '').split(',').map((m) => m.trim()).filter(Boolean);
  if (modules.length === 0) return { uninstalled: [] };
  const callKw = await tenantCallKw(inst, db, adminPassword);
  const ids = await callKw('ir.module.module', 'search',
    [[['name', 'in', modules], ['state', 'in', ['installed', 'to upgrade']]]]);
  if (!ids || ids.length === 0) return { uninstalled: [] };
  await callKw('ir.module.module', 'button_immediate_uninstall', [ids]);
  return { uninstalled: modules };
}

// Write the tenant's included-seat count (cto_pack_users) — used when extra users
// are sold on top of the pack. cto_security_profiles enforces this as the billable
// seat limit. Tenant-scoped. No-op when count is not a positive integer.
export async function setPackUsers(inst, db, adminPassword, count) {
  const n = Number.parseInt(count, 10);
  if (!Number.isFinite(n) || n < 0) return { updated: false };
  const callKw = await tenantCallKw(inst, db, adminPassword);
  const ids = await callKw('res.company', 'search', [[]], { limit: 1 });
  const cid = Array.isArray(ids) && ids.length ? ids[0] : 1;
  await callKw('res.company', 'write', [[cid], { cto_pack_users: n }]);
  return { updated: true, cto_pack_users: n };
}

// Ensure the tenant has at least `count` stock warehouses (one per dépôt). Creates
// "Dépôt N" / code "DN" until the target is reached. Requires `stock` installed
// (the model is absent otherwise) — caller treats failure as a non-fatal warning.
export async function ensureWarehouses(inst, db, adminPassword, count) {
  const target = Math.max(1, Number.parseInt(count, 10) || 1);
  const callKw = await tenantCallKw(inst, db, adminPassword);
  const existing = await callKw('stock.warehouse', 'search', [[]]); // throws if stock absent
  let n = Array.isArray(existing) ? existing.length : 0;
  const cids = await callKw('res.company', 'search', [[]], { limit: 1 });
  const cid = Array.isArray(cids) && cids.length ? cids[0] : 1;
  const created: any[] = [];
  while (n < target) {
    n += 1;
    const id = await callKw('stock.warehouse', 'create',
      [{ name: `Dépôt ${n}`, code: `D${n}`.slice(0, 5), company_id: cid }]);
    created.push(id);
  }
  return { warehouses: n, created };
}

// Configure a tenant's OUTGOING mail to use the internal Postfix smarthost
// (cto_postfix -> Brevo). Clients never touch mail settings (hidden), so the
// dashboard provisions it. Odoo-19-native: a mail.alias.domain drives the header
// From (default_from_email = <fromLocal>@<domain>), the envelope / Return-Path
// (bounce@<domain>) and DMARC alignment; the ir.mail_server is an AUTHLESS local
// relay (the Brevo SMTP key lives ONLY inside cto_postfix, never in a tenant DB).
// Global-send model: every notification leaves as "<Author> <contact@domain>" with
// Reply-To = the real author. Pass user+pass to fall back to an authenticated
// STARTTLS server instead. Tenant-scoped, idempotent.
export async function configureMailServer(inst, db, adminPassword, opts) {
  const o: any = opts || {};
  const host = o.host || inst.mailHost || 'cto_postfix';
  if (!host) return { configured: false, reason: 'missing smtp host' };
  const domain = o.domain || inst.mailDomain || inst.domain;
  const fromLocal = o.defaultFromLocal || 'contact';
  const callKw = await tenantCallKw(inst, db, adminPassword);

  // 1) mail.alias.domain (Odoo 17+): header From + bounce envelope + DMARC domain.
  const adVals: any = {
    name: domain,
    default_from: fromLocal,
    bounce_alias: o.bounceAlias || 'bounce',
    catchall_alias: o.catchallAlias || 'catchall',
  };
  const adIds = await callKw('mail.alias.domain', 'search', [[['name', '=', domain]]], { limit: 1 });
  let aliasDomainId;
  if (adIds && adIds.length) { aliasDomainId = adIds[0]; await callKw('mail.alias.domain', 'write', [[aliasDomainId], adVals]); }
  else { aliasDomainId = await callKw('mail.alias.domain', 'create', [adVals]); }
  const companyIds = await callKw('res.company', 'search', [[]]);
  if (companyIds && companyIds.length) await callKw('res.company', 'write', [companyIds, { alias_domain_id: aliasDomainId }]);

  // 2) ir.mail_server: authless internal relay to the Postfix smarthost (no creds),
  //    or an authenticated STARTTLS server when user+pass are supplied.
  const authless = !o.user || !o.pass;
  const NAME = o.name || 'Connecteo (relay)';
  const vals: any = {
    name: NAME,
    smtp_host: host,
    smtp_port: Number(o.port) || 587,
    smtp_encryption: o.encryption || (authless ? 'none' : 'starttls'),
    smtp_authentication: 'login',
    smtp_user: authless ? false : o.user,
    smtp_pass: authless ? false : o.pass,
    from_filter: o.fromFilter || domain,
  };
  // upsert by the current name OR the legacy "Connecteo (Mailjet)" record.
  const ids = await callKw('ir.mail_server', 'search', [['|', ['name', '=', NAME], ['name', '=', 'Connecteo (Mailjet)']]], { limit: 1 });
  let id;
  if (ids && ids.length) { id = ids[0]; await callKw('ir.mail_server', 'write', [[id], vals]); }
  else { id = await callKw('ir.mail_server', 'create', [vals]); }

  // 3) Legacy ICP fallbacks (alias.domain is authoritative in v19; harmless to keep).
  await callKw('ir.config_parameter', 'set_param', ['mail.default.from', `${fromLocal}@${domain}`]);
  await callKw('ir.config_parameter', 'set_param', ['mail.default.from_filter', domain]);

  return { configured: true, serverId: id, aliasDomainId, defaultFrom: `${fromLocal}@${domain}`, relay: `${host}:${Number(o.port) || 587}` };
}

// Streaming backup. dbfilter gates /web/database/backup by the request Host, so we
// send Host: <db>.<domain> (impossible via fetch) and stream the zip back as a web
// ReadableStream. Returns the stream, or throws with Odoo's error if it's not a zip.
export function backupStream(inst, name) {
  const { host: h, port } = target(inst);
  const body = form({ master_pwd: inst.masterPassword, name, backup_format: 'zip' });
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: h,
        port,
        path: '/web/database/backup',
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body),
          Host: `${name}.${inst.domain}`,
        },
      },
      (res) => {
        const ct = res.headers['content-type'] || '';
        if (res.statusCode !== 200 || ct.includes('text/html')) {
          let b = '';
          res.on('data', (c) => (b += c));
          res.on('end', () => {
            const m = b.match(/error:\s*([^<\n]{0,200})/i);
            reject(new Error(m ? m[1].trim() : `backup failed (HTTP ${res.statusCode})`));
          });
          return;
        }
        resolve(Readable.toWeb(res));
      },
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// Restore an uploaded .zip as `name`. copy=true neutralises (safe restore).
export async function restore(inst, name, file, copy) {
  const fd = new FormData();
  fd.set('master_pwd', inst.masterPassword);
  fd.set('name', name);
  fd.set('copy', copy ? 'true' : 'false');
  fd.set('backup_file', file, file.name || 'backup.zip');
  const res = await fetch(`${inst.odooUrl}/web/database/restore`, {
    method: 'POST',
    body: fd,
    redirect: 'manual',
  });
  // success -> opaque redirect (status 0) or 3xx; failure -> 200 with error HTML.
  if (res.status === 0 || (res.status >= 300 && res.status < 400)) return true;
  const body = await res.text();
  const m = body.match(/(?:Error|alert[^>]*>)([^<]{0,200})/i);
  throw new Error(m ? m[1].trim() : `restore failed (HTTP ${res.status})`);
}
