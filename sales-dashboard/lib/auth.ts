// Access gate for the commercials' create-only console. Authentik forward-auth
// (the shared `authentik-forwardauth` middleware) authenticates any Connecteo
// Authentik user and passes the trusted `X-authentik-groups` header; we restrict
// to the sales group here. Same header-trust model as Grafana on this platform.
//
// NOTE: this is app-level gating on top of SSO. A dedicated Authentik proxy
// provider bound to the group would enforce it BEFORE the app — a future
// hardening; for now the header (set by the outpost via Traefik) is the source.
import { headers } from 'next/headers';

// Groups allowed into the commercials console. Owners + the Authentik admin
// (akadmin) can use it too — so the platform admin login works as-is for now.
export const ALLOWED_GROUPS = ['Commerciaux', 'Connecteo Owners', 'authentik Admins'];

function parseGroups(raw: string | null): string[] {
  // Authentik joins group names with "|"; tolerate "," too.
  return (raw || '').split(/[|,]/).map((s) => s.trim()).filter(Boolean);
}

export function isAllowed(groups: string[]): boolean {
  return groups.some((g) => ALLOWED_GROUPS.includes(g));
}

// For server components (page/layout): read the forward-auth headers.
export async function currentUser() {
  const h = await headers();
  const groups = parseGroups(h.get('x-authentik-groups'));
  return {
    username: h.get('x-authentik-username') || h.get('x-authentik-email') || 'inconnu',
    groups,
    allowed: isAllowed(groups),
  };
}

// For route handlers: gate by the request's forward-auth header.
export function requestAllowed(request: Request): boolean {
  return isAllowed(parseGroups(request.headers.get('x-authentik-groups')));
}
