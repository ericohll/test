// Build-time configuration. Vite only exposes VITE_-prefixed env vars via
// import.meta.env, and `vite build` automatically loads `.env.production`
// (or `.env.<mode>.local`) at build time. deploy.sh is expected to generate
// frontend/.env.production from the stack outputs before running the build.

const apiUrl = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '');
const region = import.meta.env.VITE_REGION || 'ap-southeast-1';
const userPoolId = import.meta.env.VITE_USER_POOL_ID || '';
const userPoolClientId = import.meta.env.VITE_USER_POOL_CLIENT_ID || '';

const isConfigured = Boolean(apiUrl && userPoolClientId && region);

const config = { apiUrl, region, userPoolId, userPoolClientId, isConfigured };

export default config;
