import { createClient } from '@supabase/supabase-js';

// Setup Supabase Client
// Replace these with your actual Supabase URL and Anon Key in a real environment
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://xyzcompany.supabase.co';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'public-anon-key';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export async function connectNotionOAuth() {
  // Initiates Notion OAuth flow via Supabase
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'notion',
    options: {
      redirectTo: window.location.origin
    }
  });

  if (error) {
    console.error('Error logging in with Notion:', error.message);
    throw error;
  }
  return data;
}

export async function checkSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    console.error('Session error:', error.message);
    return null;
  }
  return data.session;
}

export async function signOut() {
  await supabase.auth.signOut();
}
