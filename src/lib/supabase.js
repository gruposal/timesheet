import { createClient } from '@supabase/supabase-js';

// IMPORTANT: use direct access without optional chaining so Vite can statically replace at build time
const { VITE_SUPABASE_URL: url, VITE_SUPABASE_ANON_KEY: anonKey } = import.meta.env;

export const supabase = (url && anonKey) ? createClient(url, anonKey) : null;
export const isSupabaseConfigured = Boolean(url && anonKey);

if (!isSupabaseConfigured) {
  // Ajuda no diagnóstico via console do navegador
  // eslint-disable-next-line no-console
  console.warn('[Supabase] Variáveis ausentes: defina VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY em .env.local');
} else {
  // eslint-disable-next-line no-console
  console.log('[Supabase] Configurado com URL:', url);
}

// Expor informações de diagnóstico seguras no console do navegador
try {
  if (typeof window !== 'undefined') {
    window.__supabaseDbg = {
      isSupabaseConfigured,
      hasUrl: Boolean(url),
      hasAnonKey: Boolean(anonKey),
    };
    window.__viteEnvKeys = Object.keys(import.meta.env || {});
  }
} catch {}





