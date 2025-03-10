
const { createClient } = require('@supabase/supabase-js');

// // URL et clé d'accès de votre projet Supabase
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

// Initialisation du client Supabase
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

module.exports = supabase;
