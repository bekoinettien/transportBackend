const { createClient } = require('@supabase/supabase-js');

// URL et clé d'accès de votre projet Supabase
const SUPABASE_URL = process.env.SUPABASE_URL_PROFILE;
const SUPABASE_KEY = process.env.SUPABASE_KEY_PROFILE;

// Initialisation du client Supabase
const supabaseProfile = createClient(SUPABASE_URL, SUPABASE_KEY);

module.exports = supabaseProfile;