// config.js - Configuration for ApplyTrack Supabase Integration
window.ENV = {
  // Replace these with your actual Supabase project credentials if you want to connect a live database
  SUPABASE_URL: "",
  SUPABASE_ANON_KEY: ""
};

// Check if keys are empty and set the mock mode flag
if (!window.ENV.SUPABASE_URL || !window.ENV.SUPABASE_ANON_KEY) {
  window.USE_MOCK_AUTH = true;
  console.warn("ApplyTrack: Running in Demo Mode (simulated local storage authentication). Set SUPABASE_URL and SUPABASE_ANON_KEY in config.js to connect a real database.");
} else {
  window.USE_MOCK_AUTH = false;
}
