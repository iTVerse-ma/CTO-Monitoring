/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // The console runs behind Traefik + Authentik; it talks to Odoo/Postgres over
  // the docker network. Keep server-only secrets out of the client bundle.
  serverExternalPackages: ['pg'],
};

module.exports = nextConfig;
