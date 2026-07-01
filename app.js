// app.js - ApplyTrack SPA Router, Auth, Onboarding and Dashboard Controller

let supabaseClient = null;
let currentUser = null;
let currentProfile = null;

// Initialize Supabase Client if keys are available
function initSupabase() {
  if (!window.USE_MOCK_AUTH && window.supabase) {
    try {
      supabaseClient = window.supabase.createClient(window.ENV.SUPABASE_URL, window.ENV.SUPABASE_ANON_KEY);
      console.log("ApplyTrack: Supabase client initialized successfully.");
    } catch (e) {
      console.error("ApplyTrack: Failed to initialize Supabase, switching to Mock mode.", e);
      window.USE_MOCK_AUTH = true;
    }
  } else {
    console.log("ApplyTrack: Using Mock Authentication Mode.");
  }
}

/* ==========================================================================
   AUTH SERVICE (Supports Real Supabase & Persistent Local Mock Auth)
   ========================================================================== */

// Helper to get active session
async function checkAuthSession() {
  if (window.USE_MOCK_AUTH) {
    const sessionStr = localStorage.getItem('applytrack_session');
    if (sessionStr) {
      const session = JSON.parse(sessionStr);
      currentUser = session.user;
      currentProfile = session.profile;
      return currentUser;
    }
    currentUser = null;
    currentProfile = null;
    return null;
  } else {
    try {
      const { data: { session }, error } = await supabaseClient.auth.getSession();
      if (error) throw error;
      if (session) {
        currentUser = session.user;
        // Fetch profile
        const { data: profile, error: pError } = await supabaseClient
          .from('profiles')
          .select('*')
          .eq('id', currentUser.id)
          .single();
        
        if (pError && pError.code === 'PGRST116') {
          // Profile does not exist yet (could happen in edge cases), create it
          const { data: newProfile, error: insError } = await supabaseClient
            .from('profiles')
            .insert([{ id: currentUser.id, full_name: currentUser.user_metadata.full_name || 'User', gmail_connected: false, onboarding_completed: false, last_synced: null, sync_error: false }])
            .select()
            .single();
          if (insError) throw insError;
          currentProfile = newProfile;
        } else if (pError) {
          throw pError;
        } else {
          currentProfile = profile;
        }
        return currentUser;
      }
      currentUser = null;
      currentProfile = null;
      return null;
    } catch (e) {
      console.error("Auth Session Error:", e);
      return null;
    }
  }
}

// User Registration
async function registerUser(email, password, fullName) {
  if (window.USE_MOCK_AUTH) {
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        let users = JSON.parse(localStorage.getItem('applytrack_users') || '[]');
        if (users.find(u => u.email.toLowerCase() === email.toLowerCase())) {
          return reject(new Error("An account with this email already exists."));
        }
        const userId = 'mock-uid-' + Math.random().toString(36).substr(2, 9);
        const newUser = { id: userId, email: email, user_metadata: { full_name: fullName } };
        const newProfile = { id: userId, full_name: fullName, gmail_connected: false, onboarding_completed: false, last_synced: null, sync_error: false };
        
        users.push({ ...newUser, password, profile: newProfile });
        localStorage.setItem('applytrack_users', JSON.stringify(users));
        
        // Log user in automatically
        saveMockSession(newUser, newProfile);
        resolve({ user: newUser, profile: newProfile });
      }, 800);
    });
  } else {
    const { data, error } = await supabaseClient.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName
        }
      }
    });
    if (error) throw error;
    
    // In Supabase, if email confirmation is required, session might not be active yet
    // Wait a brief moment to see if we got user data
    if (data && data.user) {
      currentUser = data.user;
      // Triggers handle the profile in database, return user
      return { user: data.user };
    }
    return data;
  }
}

// User Login
async function loginUser(email, password) {
  if (window.USE_MOCK_AUTH) {
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        const users = JSON.parse(localStorage.getItem('applytrack_users') || '[]');
        const userMatch = users.find(u => u.email.toLowerCase() === email.toLowerCase() && u.password === password);
        if (!userMatch) {
          return reject(new Error("Invalid email or password."));
        }
        const user = { id: userMatch.id, email: userMatch.email, user_metadata: userMatch.user_metadata };
        const profile = userMatch.profile;
        saveMockSession(user, profile);
        resolve({ user, profile });
      }, 800);
    });
  } else {
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) throw error;
    currentUser = data.user;
    
    // Fetch profile
    const { data: profile, error: pError } = await supabaseClient
      .from('profiles')
      .select('*')
      .eq('id', currentUser.id)
      .single();
    if (pError) throw pError;
    currentProfile = profile;
    return { user: data.user, profile };
  }
}

// Google OAuth Simulation/Trigger
async function continueWithGoogle() {
  if (window.USE_MOCK_AUTH) {
    showToast("Simulating Google OAuth Connection...", "info");
    return new Promise((resolve) => {
      setTimeout(() => {
        const email = "demo.user@gmail.com";
        const fullName = "Google Demo User";
        let users = JSON.parse(localStorage.getItem('applytrack_users') || '[]');
        let userMatch = users.find(u => u.email.toLowerCase() === email.toLowerCase());
        
        if (!userMatch) {
          const userId = 'google-uid-demo';
          userMatch = { id: userId, email, password: 'google-oauth-dummy', user_metadata: { full_name: fullName }, profile: { id: userId, full_name: fullName, gmail_connected: false, onboarding_completed: false, last_synced: null, sync_error: false } };
          users.push(userMatch);
          localStorage.setItem('applytrack_users', JSON.stringify(users));
        }
        
        saveMockSession(userMatch, userMatch.profile);
        showToast("Connected via Google Account!", "success");
        resolve({ user: userMatch, profile: userMatch.profile });
        navigate('#/onboarding');
      }, 1500);
    });
  } else {
    const { error } = await supabaseClient.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin
      }
    });
    if (error) throw error;
  }
}

// User Logout
async function logoutUser() {
  if (window.USE_MOCK_AUTH) {
    localStorage.removeItem('applytrack_session');
    currentUser = null;
    currentProfile = null;
    showToast("Successfully logged out.", "success");
    navigate('#/');
  } else {
    const { error } = await supabaseClient.auth.signOut();
    if (error) throw error;
    currentUser = null;
    currentProfile = null;
    showToast("Successfully logged out.", "success");
    navigate('#/');
  }
}

// Password Recovery
async function sendPasswordRecovery(email) {
  if (window.USE_MOCK_AUTH) {
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        const users = JSON.parse(localStorage.getItem('applytrack_users') || '[]');
        const userMatch = users.find(u => u.email.toLowerCase() === email.toLowerCase());
        if (!userMatch) {
          // Security best practice: don't reveal if account exists, just resolve
          resolve(true);
        } else {
          resolve(true);
        }
      }, 800);
    });
  } else {
    const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + '#/reset-password'
    });
    if (error) throw error;
    return true;
  }
}

// Update Onboarding Profile States
async function updateProfileState(fields) {
  if (window.USE_MOCK_AUTH) {
    if (!currentProfile) return;
    
    // Update local profile
    Object.assign(currentProfile, fields);
    
    // Save inside session
    const sessionStr = localStorage.getItem('applytrack_session');
    if (sessionStr) {
      const session = JSON.parse(sessionStr);
      session.profile = currentProfile;
      localStorage.setItem('applytrack_session', JSON.stringify(session));
    }
    
    // Update users database
    const users = JSON.parse(localStorage.getItem('applytrack_users') || '[]');
    const userIndex = users.findIndex(u => u.id === currentUser.id);
    if (userIndex !== -1) {
      users[userIndex].profile = currentProfile;
      localStorage.setItem('applytrack_users', JSON.stringify(users));
    }
    return currentProfile;
  } else {
    const { data, error } = await supabaseClient
      .from('profiles')
      .update(fields)
      .eq('id', currentUser.id)
      .select()
      .single();
    if (error) throw error;
    currentProfile = data;
    return currentProfile;
  }
}

// Helpers for mock sessions
function saveMockSession(user, profile) {
  currentUser = user;
  currentProfile = profile;
  localStorage.setItem('applytrack_session', JSON.stringify({ user, profile }));
}

/* ==========================================================================
   UI UTILITIES
   ========================================================================== */

function showToast(message, type = 'info') {
  // Remove existing toasts
  const existingToasts = document.querySelectorAll('.validation-toast');
  existingToasts.forEach(toast => toast.remove());

  const toast = document.createElement('div');
  toast.className = `validation-toast ${type}`;
  
  let icon = '<i class="fas fa-info-circle"></i>';
  if (type === 'success') icon = '<i class="fas fa-check-circle"></i>';
  if (type === 'error') icon = '<i class="fas fa-exclamation-circle"></i>';
  
  toast.innerHTML = `${icon} <span>${message}</span>`;
  document.body.appendChild(toast);
  
  // Animate in
  setTimeout(() => toast.classList.add('show'), 100);
  
  // Animate out
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

function setupLandingNavigation() {
  const hamburger = document.getElementById('landing-hamburger-btn');
  const closeBtn = document.getElementById('close-landing-drawer-btn');
  const overlay = document.getElementById('landing-drawer-overlay');
  
  if (hamburger && overlay) {
    const newHamburger = hamburger.cloneNode(true);
    hamburger.parentNode.replaceChild(newHamburger, hamburger);
    
    newHamburger.addEventListener('click', () => {
      overlay.classList.add('open');
    });
  }
  
  if (closeBtn && overlay) {
    const newClose = closeBtn.cloneNode(true);
    closeBtn.parentNode.replaceChild(newClose, closeBtn);
    
    newClose.addEventListener('click', () => {
      overlay.classList.remove('open');
    });
  }
  
  if (overlay) {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.classList.remove('open');
      }
    });

    overlay.querySelectorAll('.landing-drawer-item, .btn').forEach(el => {
      el.addEventListener('click', () => {
        overlay.classList.remove('open');
      });
    });
  }
}

function updateNavigation() {
  const navActions = document.getElementById('nav-actions');
  const navLinks = document.getElementById('nav-links');
  
  if (!navActions) return;

  setupLandingNavigation();

  if (currentUser) {
    // Authenticated links
    navLinks.innerHTML = `
      <a href="#/dashboard" class="nav-link">Dashboard</a>
      <a href="#/settings" class="nav-link">Settings</a>
      <a href="#/onboarding" class="nav-link">Setup Guide</a>
    `;
    navActions.innerHTML = `
      <span class="user-display" style="font-weight: 600; font-size: 0.9rem; color: var(--color-primary);">
        <i class="far fa-user-circle"></i> ${currentProfile?.full_name || currentUser.email}
      </span>
      <button id="logout-btn" class="btn btn-outline btn-sm">Log Out</button>
    `;
    
    document.getElementById('logout-btn')?.addEventListener('click', async () => {
      try {
        await logoutUser();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  } else {
    // Guest Links
    navLinks.innerHTML = `
      <a href="#/" class="nav-link">Features</a>
      <a href="#/" class="nav-link">Problem</a>
      <a href="#/" class="nav-link">FAQ</a>
    `;
    navActions.innerHTML = `
      <a href="#/login" class="btn btn-outline btn-sm">Log In</a>
      <a href="#/signup" class="btn btn-primary btn-sm">Get Started</a>
    `;
  }
}

// Loading state overlay helper
function setButtonLoading(buttonEl, isLoading, defaultText = "Submit") {
  if (isLoading) {
    buttonEl.disabled = true;
    buttonEl.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Processing...`;
  } else {
    buttonEl.disabled = false;
    buttonEl.innerHTML = defaultText;
  }
}

/* ==========================================================================
   PAGE RENDERERS
   ========================================================================== */

// 1. LANDING PAGE
function renderLanding() {
  const root = document.getElementById('app-root');
  root.innerHTML = `
    <!-- Hero Section -->
    <header class="hero-section">
      <div class="app-container" style="display: flex; flex-direction: column; align-items: center;">
        <span class="hero-tag">Gmail Auto-Sync MVP</span>
        <h1 class="hero-title">Never Lose Track of a Job Application Again</h1>
        <p class="hero-subtitle">
          Connect your Gmail and let AI organize your applications, interviews, rejections, and offers automatically.
        </p>
        <div class="hero-ctas">
          <a href="#/signup" class="btn btn-primary btn-lg">Get Started Free</a>
          <a href="#/login" class="btn btn-secondary btn-lg">Sign In</a>
        </div>
        
        <!-- Beautiful Dynamic Preview Dashboard -->
        <div class="hero-preview">
          <div class="hero-preview-header">
            <div class="window-dots">
              <span class="window-dot"></span>
              <span class="window-dot"></span>
              <span class="window-dot"></span>
            </div>
            <div class="preview-title">ApplyTrack Dashboard Mockup</div>
            <div style="width: 38px;"></div>
          </div>
          <div class="hero-preview-board">
            <div class="preview-col">
              <div class="preview-col-title">Applied <span class="preview-col-count">3</span></div>
              <div class="preview-card">
                <div class="preview-card-logo">Stripe</div>
                <div class="preview-card-role">Product Designer</div>
                <div class="preview-card-meta">
                  <span>San Francisco</span>
                  <span class="card-badge applied">Applied</span>
                </div>
              </div>
              <div class="preview-card">
                <div class="preview-card-logo">Google</div>
                <div class="preview-card-role">UX Engineer</div>
                <div class="preview-card-meta">
                  <span>New York</span>
                  <span class="card-badge applied">Applied</span>
                </div>
              </div>
            </div>
            
            <div class="preview-col">
              <div class="preview-col-title">Interviewing <span class="preview-col-count">1</span></div>
              <div class="preview-card">
                <div class="preview-card-logo">Figma</div>
                <div class="preview-card-role">Senior Designer</div>
                <div class="preview-card-meta">
                  <span>Remote</span>
                  <span class="card-badge interview">Interview</span>
                </div>
              </div>
            </div>
            
            <div class="preview-col">
              <div class="preview-col-title">Offers <span class="preview-col-count">1</span></div>
              <div class="preview-card">
                <div class="preview-card-logo">Slack</div>
                <div class="preview-card-role">Product Manager</div>
                <div class="preview-card-meta">
                  <span>San Francisco</span>
                  <span class="card-badge offer">Offer</span>
                </div>
              </div>
            </div>
            
            <div class="preview-col">
              <div class="preview-col-title">Rejected <span class="preview-col-count">0</span></div>
              <div class="empty-col-message" style="padding: 20px 0; font-size: 0.75rem;">No rejections detected yet.</div>
            </div>
          </div>
        </div>
      </div>
    </header>

    <!-- Problem Statement Section -->
    <section class="problem-section">
      <div class="app-container">
        <div class="section-header">
          <span class="section-label">The Frustrating Reality</span>
          <h2 class="section-title">Job Hunting is Hard Enough. Don't Let Spreadsheets Slow You Down.</h2>
          <p class="section-desc">Traditional application tracking is broken, manual, and wastes valuable time.</p>
        </div>
        
        <div class="problem-grid">
          <div class="problem-card">
            <div class="problem-icon"><i class="fas fa-table"></i></div>
            <h3 class="problem-title">Messy Spreadsheets</h3>
            <p class="problem-desc">Forgetting to update columns, losing links, and manually copy-pasting details from emails is a pain.</p>
          </div>
          <div class="problem-card">
            <div class="problem-icon"><i class="fas fa-bell-slash"></i></div>
            <h3 class="problem-title">Missed Interview Invites</h3>
            <p class="problem-desc">Important scheduler links and response requests get buried in your messy, crowded inbox.</p>
          </div>
          <div class="problem-card">
            <div class="problem-icon"><i class="fas fa-redo"></i></div>
            <h3 class="problem-title">Double Applying</h3>
            <p class="problem-desc">Accidentally applying to the same role on different platforms months apart looks unprofessional.</p>
          </div>
        </div>
      </div>
    </section>

    <!-- Features Overview Section -->
    <section class="features-section">
      <div class="app-container">
        <div class="features-grid">
          <div class="features-list">
            <div class="section-header" style="text-align: left; margin-bottom: 24px; max-width: 100%;">
              <span class="section-label">Automated System</span>
              <h2 class="section-title">How ApplyTrack Works</h2>
              <p class="section-desc">Our intelligent engine scans incoming job-related correspondence securely and automatically tracks the details.</p>
            </div>
            
            <div class="feature-item">
              <div class="feature-item-icon"><i class="fab fa-google"></i></div>
              <div class="feature-item-content">
                <h4 class="feature-item-title">Gmail Authentication</h4>
                <p class="feature-item-desc">Securely connect your Gmail in seconds using official OAuth protocols. We only scan job notifications.</p>
              </div>
            </div>
            
            <div class="feature-item">
              <div class="feature-item-icon"><i class="fas fa-robot"></i></div>
              <div class="feature-item-content">
                <h4 class="feature-item-title">AI Application Detection</h4>
                <p class="feature-item-desc">Our AI parses confirmation emails from LinkedIn, Indeed, Greenhouse, and others, extracting the company, title, and salary details.</p>
              </div>
            </div>
            
            <div class="feature-item">
              <div class="feature-item-icon"><i class="fas fa-chart-line"></i></div>
              <div class="feature-item-content">
                <h4 class="feature-item-title">Realtime Dashboard</h4>
                <p class="feature-item-desc">Visualise your applications cleanly. Moving cards dynamically and tracking next steps is seamless.</p>
              </div>
            </div>
          </div>
          
          <!-- Features Graphic Panel (Visual representation of parsing) -->
          <div class="features-graphic">
            <div class="mail-toast">
              <div class="mail-avatar">L</div>
              <div class="mail-body">
                <div class="mail-sender">LinkedIn Careers</div>
                <div class="mail-subject">Application Confirmed: UI Engineer at Stripe</div>
              </div>
              <span class="mail-badge-detect"><i class="fas fa-sparkles"></i> AI Detected</span>
            </div>
            <div class="mail-toast" style="animation-delay: 1.5s;">
              <div class="mail-avatar">G</div>
              <div class="mail-body">
                <div class="mail-sender">Greenhouse</div>
                <div class="mail-subject">Figma: Invitation to Interview</div>
              </div>
              <span class="mail-badge-detect" style="background-color: var(--color-warning-light); color: var(--color-warning);"><i class="fas fa-calendar-alt"></i> AI Scheduler</span>
            </div>
            
            <div style="margin-top: 24px; border-top: 1px dashed var(--color-border); padding-top: 20px; text-align: center; color: var(--color-text-secondary); font-size: 0.85rem;">
              <i class="fas fa-lock"></i> Bank-grade 256-bit encryption for all connected data
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- Call to Action Section -->
    <section class="cta-section">
      <div class="app-container">
        <h2 class="cta-title">Take Control of Your Career Path</h2>
        <p class="cta-subtitle">Connect your Gmail and never let a job application drop. Sign up for free today.</p>
        <a href="#/signup" class="btn btn-secondary btn-lg" style="color: var(--color-primary); background-color: #FFFFFF;">Start Tracking Now</a>
      </div>
    </section>
  `;
}

// 2. SIGN UP PAGE
function renderSignUp() {
  const root = document.getElementById('app-root');
  root.innerHTML = `
    <div class="auth-page-container">
      <div class="auth-split-bg">
        <div class="logo" style="color: #FFFFFF;">
          <span class="logo-icon" style="background: #FFFFFF; color: var(--color-primary);">A</span> ApplyTrack
        </div>
        
        <div class="auth-quote-container">
          <p class="auth-quote">"This app saved me from missing a Greenhouse scheduler link that sat in my spam. Best application manager out there."</p>
          <div>
            <div class="auth-author">Elena Rostova</div>
            <div class="auth-author-role">Software Engineer, Vercel</div>
          </div>
        </div>
        
        <div style="font-size: 0.8rem; color: rgba(255, 255, 255, 0.4);">
          &copy; 2026 ApplyTrack Inc. All rights reserved.
        </div>
      </div>
      
      <div class="auth-card-container">
        <div class="auth-card">
          <div class="auth-header">
            <h2 class="auth-title">Create your account</h2>
            <p class="auth-subtitle">Already have an account? <a href="#/login">Log In</a></p>
          </div>
          
          <form id="signup-form" class="auth-form" novalidate>
            <div class="form-group">
              <label class="form-label" for="signup-name">Full Name</label>
              <div class="input-wrapper">
                <input class="form-input" type="text" id="signup-name" placeholder="John Doe" required>
              </div>
              <span id="error-name" class="form-error"></span>
            </div>
            
            <div class="form-group">
              <label class="form-label" for="signup-email">Email Address</label>
              <div class="input-wrapper">
                <input class="form-input" type="email" id="signup-email" placeholder="you@example.com" required>
              </div>
              <span id="error-email" class="form-error"></span>
            </div>
            
            <div class="form-group">
              <label class="form-label" for="signup-password">Password</label>
              <div class="input-wrapper">
                <input class="form-input" type="password" id="signup-password" placeholder="••••••••" required>
                <button type="button" class="toggle-password" data-target="signup-password">SHOW</button>
              </div>
              <span id="error-password" class="form-error"></span>
            </div>
            
            <div class="form-group">
              <label class="form-label" for="signup-confirm">Confirm Password</label>
              <div class="input-wrapper">
                <input class="form-input" type="password" id="signup-confirm" placeholder="••••••••" required>
                <button type="button" class="toggle-password" data-target="signup-confirm">SHOW</button>
              </div>
              <span id="error-confirm" class="form-error"></span>
            </div>
            
            <button type="submit" id="signup-submit" class="btn btn-primary" style="width: 100%; margin-top: 10px;">Create Account</button>
          </form>
          
          <div class="divider">Or</div>
          
          <button type="button" id="google-signup-btn" class="btn btn-google">
            <svg viewBox="0 0 24 24" width="18" height="18" xmlns="http://www.w3.org/2000/svg">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.65 2.84c.87-2.6 3.3-4.52 6.16-4.52z" fill="#EA4335"/>
            </svg>
            Continue with Google
          </button>
        </div>
      </div>
    </div>
  `;

  // Attach Password Visibility Toggle
  setupPasswordToggles();

  // Attach submit logic
  const form = document.getElementById('signup-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    // Clear errors
    document.querySelectorAll('.form-error').forEach(el => el.textContent = '');
    document.querySelectorAll('.form-input').forEach(el => el.classList.remove('error'));

    const name = document.getElementById('signup-name').value.trim();
    const email = document.getElementById('signup-email').value.trim();
    const password = document.getElementById('signup-password').value;
    const confirm = document.getElementById('signup-confirm').value;

    let hasErrors = false;

    if (!name) {
      document.getElementById('error-name').textContent = "Full name is required";
      document.getElementById('signup-name').classList.add('error');
      hasErrors = true;
    }
    
    if (!email || !validateEmail(email)) {
      document.getElementById('error-email').textContent = "Please enter a valid email address";
      document.getElementById('signup-email').classList.add('error');
      hasErrors = true;
    }

    if (password.length < 6) {
      document.getElementById('error-password').textContent = "Password must be at least 6 characters";
      document.getElementById('signup-password').classList.add('error');
      hasErrors = true;
    }

    if (password !== confirm) {
      document.getElementById('error-confirm').textContent = "Passwords do not match";
      document.getElementById('signup-confirm').classList.add('error');
      hasErrors = true;
    }

    if (hasErrors) return;

    const btn = document.getElementById('signup-submit');
    setButtonLoading(btn, true);

    try {
      const signupResult = await registerUser(email, password, name);
      showToast("Account created successfully!", "success");
      
      // If Supabase authentication triggers registration, verify if a confirmation is needed
      if (!window.USE_MOCK_AUTH) {
        showToast("Please check your email to verify your account.", "info");
      }
      
      navigate('#/onboarding');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setButtonLoading(btn, false, "Create Account");
    }
  });

  // Google OAuth button logic
  document.getElementById('google-signup-btn').addEventListener('click', async () => {
    try {
      await continueWithGoogle();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}

// 3. LOGIN PAGE
function renderLogin() {
  const root = document.getElementById('app-root');
  root.innerHTML = `
    <div class="auth-page-container">
      <div class="auth-split-bg">
        <div class="logo" style="color: #FFFFFF;">
          <span class="logo-icon" style="background: #FFFFFF; color: var(--color-primary);">A</span> ApplyTrack
        </div>
        
        <div class="auth-quote-container">
          <p class="auth-quote">"ApplyTrack made tracking 50+ roles a breeze. I could focus on my interview prep instead of manually logging columns."</p>
          <div>
            <div class="auth-author">Marcus Vance</div>
            <div class="auth-author-role">Product Designer, Stripe</div>
          </div>
        </div>
        
        <div style="font-size: 0.8rem; color: rgba(255, 255, 255, 0.4);">
          &copy; 2026 ApplyTrack Inc. All rights reserved.
        </div>
      </div>
      
      <div class="auth-card-container">
        <div class="auth-card">
          <div class="auth-header">
            <h2 class="auth-title">Log In to ApplyTrack</h2>
            <p class="auth-subtitle">Don't have an account? <a href="#/signup">Sign Up</a></p>
          </div>
          
          <form id="login-form" class="auth-form" novalidate>
            <div class="form-group">
              <label class="form-label" for="login-email">Email Address</label>
              <div class="input-wrapper">
                <input class="form-input" type="email" id="login-email" placeholder="you@example.com" required>
              </div>
              <span id="error-login-email" class="form-error"></span>
            </div>
            
            <div class="form-group">
              <div class="form-options" style="margin-bottom: 2px;">
                <label class="form-label" for="login-password" style="margin-bottom: 0;">Password</label>
                <a href="#/forgot-password" class="forgot-link">Forgot Password?</a>
              </div>
              <div class="input-wrapper">
                <input class="form-input" type="password" id="login-password" placeholder="••••••••" required>
                <button type="button" class="toggle-password" data-target="login-password">SHOW</button>
              </div>
              <span id="error-login-password" class="form-error"></span>
            </div>
            
            <button type="submit" id="login-submit" class="btn btn-primary" style="width: 100%; margin-top: 10px;">Log In</button>
          </form>
          
          <div class="divider">Or</div>
          
          <button type="button" id="google-login-btn" class="btn btn-google">
            <svg viewBox="0 0 24 24" width="18" height="18" xmlns="http://www.w3.org/2000/svg">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.65 2.84c.87-2.6 3.3-4.52 6.16-4.52z" fill="#EA4335"/>
            </svg>
            Continue with Google
          </button>
        </div>
      </div>
    </div>
  `;

  // Password toggle setup
  setupPasswordToggles();

  // Attach submit logic
  const form = document.getElementById('login-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    // Clear errors
    document.querySelectorAll('.form-error').forEach(el => el.textContent = '');
    document.querySelectorAll('.form-input').forEach(el => el.classList.remove('error'));

    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    
    let hasErrors = false;

    if (!email || !validateEmail(email)) {
      document.getElementById('error-login-email').textContent = "Please enter a valid email address";
      document.getElementById('login-email').classList.add('error');
      hasErrors = true;
    }

    if (!password) {
      document.getElementById('error-login-password').textContent = "Password is required";
      document.getElementById('login-password').classList.add('error');
      hasErrors = true;
    }

    if (hasErrors) return;

    const btn = document.getElementById('login-submit');
    setButtonLoading(btn, true);

    try {
      const loginResult = await loginUser(email, password);
      showToast("Welcome back!", "success");
      
      // Route based on profile completion status
      if (loginResult.profile && loginResult.profile.onboarding_completed) {
        navigate('#/dashboard');
      } else {
        navigate('#/onboarding');
      }
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setButtonLoading(btn, false, "Log In");
    }
  });

  // Google OAuth button logic
  document.getElementById('google-login-btn').addEventListener('click', async () => {
    try {
      await continueWithGoogle();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}

// 4. FORGOT PASSWORD PAGE
function renderForgotPassword() {
  const root = document.getElementById('app-root');
  root.innerHTML = `
    <div class="auth-page-container">
      <div class="auth-split-bg">
        <div class="logo" style="color: #FFFFFF;">
          <span class="logo-icon" style="background: #FFFFFF; color: var(--color-primary);">A</span> ApplyTrack
        </div>
        
        <div class="auth-quote-container">
          <p class="auth-quote">"Security is paramount. The platform maintains robust encryption protocols giving me peace of mind when syncing my professional email."</p>
          <div>
            <div class="auth-author">Sophia Lin</div>
            <div class="auth-author-role">Security Lead, Ramp</div>
          </div>
        </div>
        
        <div style="font-size: 0.8rem; color: rgba(255, 255, 255, 0.4);">
          &copy; 2026 ApplyTrack Inc. All rights reserved.
        </div>
      </div>
      
      <div class="auth-card-container">
        <div id="forgot-card-content" class="auth-card">
          <div class="auth-header">
            <h2 class="auth-title">Reset password</h2>
            <p class="auth-subtitle">Enter your email and we'll send you recovery steps.</p>
          </div>
          
          <form id="forgot-form" class="auth-form" novalidate>
            <div class="form-group">
              <label class="form-label" for="forgot-email">Email Address</label>
              <div class="input-wrapper">
                <input class="form-input" type="email" id="forgot-email" placeholder="you@example.com" required>
              </div>
              <span id="error-forgot-email" class="form-error"></span>
            </div>
            
            <button type="submit" id="forgot-submit" class="btn btn-primary" style="width: 100%; margin-top: 10px;">Send Recovery Email</button>
          </form>
          
          <div style="margin-top: 24px; text-align: center; font-size: 0.9rem;">
            <a href="#/login" class="forgot-link"><i class="fas fa-arrow-left"></i> Back to Log In</a>
          </div>
        </div>
      </div>
    </div>
  `;

  // Attach submit logic
  const form = document.getElementById('forgot-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    // Clear errors
    document.getElementById('error-forgot-email').textContent = '';
    const emailInput = document.getElementById('forgot-email');
    emailInput.classList.remove('error');

    const email = emailInput.value.trim();

    if (!email || !validateEmail(email)) {
      document.getElementById('error-forgot-email').textContent = "Please enter a valid email address";
      emailInput.classList.add('error');
      return;
    }

    const btn = document.getElementById('forgot-submit');
    setButtonLoading(btn, true);

    try {
      await sendPasswordRecovery(email);
      
      // Switch view to recovery sent success state
      const card = document.getElementById('forgot-card-content');
      card.innerHTML = `
        <div class="success-card">
          <div class="success-icon">
            <i class="far fa-envelope-open"></i>
          </div>
          <h2 class="auth-title">Check your inbox</h2>
          <p class="auth-subtitle" style="margin-bottom: 24px; text-align: center;">
            We have sent password recovery instructions to <strong>${email}</strong>.
          </p>
          <a href="#/login" class="btn btn-primary" style="width: 100%;">Return to Log In</a>
        </div>
      `;
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      if (btn) setButtonLoading(btn, false, "Send Recovery Email");
    }
  });
}

// 5. WELCOME ONBOARDING (Step-by-step Wizard)
let onboardingStep = 1;

function renderOnboarding() {
  const root = getAppViewRoot();
  
  // Basic shell layout for Onboarding page
  root.innerHTML = `
    <div class="onboarding-page-container">
      <div class="onboarding-container">
        <!-- Progress Steps -->
        <div class="onboarding-progress">
          <div id="progress-bar" class="progress-bar-fill" style="width: 0%;"></div>
          <div class="progress-step active" data-step="1">1</div>
          <div class="progress-step" data-step="2">2</div>
          <div class="progress-step" data-step="3">3</div>
          <div class="progress-step" data-step="4">4</div>
        </div>
        
        <!-- Step Views will be injected here -->
        <div id="onboarding-step-holder" class="onboarding-step-view"></div>
        
        <!-- Actions footer -->
        <div class="onboarding-actions">
          <button id="onboard-back" class="btn btn-outline" style="visibility: hidden;">Back</button>
          <button id="onboard-next" class="btn btn-primary">Continue</button>
        </div>
      </div>
    </div>
  `;

  // Attach event handlers
  document.getElementById('onboard-next').addEventListener('click', handleOnboardingNext);
  document.getElementById('onboard-back').addEventListener('click', handleOnboardingBack);

  onboardingStep = 1;
  updateOnboardingStep();
}

function updateOnboardingStep() {
  const holder = document.getElementById('onboarding-step-holder');
  const nextBtn = document.getElementById('onboard-next');
  const backBtn = document.getElementById('onboard-back');
  const progressBar = document.getElementById('progress-bar');
  
  if (!holder) return;

  // Update progress bar fill & step active states
  const percent = ((onboardingStep - 1) / 3) * 100;
  progressBar.style.width = `${percent}%`;
  
  document.querySelectorAll('.progress-step').forEach(stepEl => {
    const s = parseInt(stepEl.getAttribute('data-step'));
    stepEl.className = 'progress-step';
    if (s < onboardingStep) {
      stepEl.classList.add('completed');
      stepEl.innerHTML = '<i class="fas fa-check"></i>';
    } else if (s === onboardingStep) {
      stepEl.classList.add('active');
      stepEl.innerHTML = s;
    } else {
      stepEl.innerHTML = s;
    }
  });

  // Toggle Back Button visibility
  if (onboardingStep === 1) {
    backBtn.style.visibility = 'hidden';
  } else {
    backBtn.style.visibility = 'visible';
  }

  // Render Step Contents
  switch (onboardingStep) {
    case 1:
      holder.innerHTML = `
        <div class="onboarding-header">
          <h2 class="onboarding-title">Welcome to ApplyTrack!</h2>
          <p class="onboarding-desc">Let's set up your AI-powered application manager and clear out the clutter. This will only take 60 seconds.</p>
        </div>
        <div class="onboarding-content">
          <div class="onboarding-illustration">
            <!-- Sleek, generated illustration showing a dashboard structure -->
            <img src="assets/dashboard_mockup.png" alt="ApplyTrack Mockup" style="max-height: 220px; border-radius: var(--radius-md);">
          </div>
          <p style="text-align: center; font-size: 0.95rem; color: var(--color-text-secondary); line-height: 1.5;">
            Hey <strong>${currentProfile?.full_name || 'there'}</strong>! We will guide you through connecting your inbox and launching your first pipeline dashboard tracking.
          </p>
        </div>
      `;
      nextBtn.innerHTML = `Get Started <i class="fas fa-arrow-right"></i>`;
      break;

    case 2:
      holder.innerHTML = `
        <div class="onboarding-header">
          <h2 class="onboarding-title">How Gmail Auto-Sync Works</h2>
          <p class="onboarding-desc">We scan only job-related emails to keep your board updated automatically.</p>
        </div>
        <div class="onboarding-content">
          <div class="explainer-cards">
            <div class="explainer-card">
              <div class="explainer-card-icon"><i class="fas fa-filter"></i></div>
              <div>
                <h4 class="explainer-card-title">Job Specific Scanner</h4>
                <p class="explainer-card-desc">Our filters ignore personal and unrelated business emails. We specifically check keywords matching 'app confirms', 'interview invites', and 'offers'.</p>
              </div>
            </div>
            
            <div class="explainer-card">
              <div class="explainer-card-icon"><i class="fas fa-shield-alt"></i></div>
              <div>
                <h4 class="explainer-card-title">Privacy Focused & RLS Secure</h4>
                <p class="explainer-card-desc">Authorized via Google Secure OAuth. Your actual credentials are never processed or saved by us, ensuring absolute data security.</p>
              </div>
            </div>
            
            <div class="explainer-card">
              <div class="explainer-card-icon"><i class="fas fa-sync"></i></div>
              <div>
                <h4 class="explainer-card-title">Continuous Background Sync</h4>
                <p class="explainer-card-desc">Even when you're sleeping, our background job matches responses, moving applications from 'Applied' to 'Interviewing' immediately.</p>
              </div>
            </div>
          </div>
        </div>
      `;
      nextBtn.innerHTML = `Understand & Continue <i class="fas fa-arrow-right"></i>`;
      break;

    case 3:
      const isConnected = currentProfile?.gmail_connected;
      holder.innerHTML = `
        <div class="onboarding-header">
          <h2 class="onboarding-title">Link your Google Inbox</h2>
          <p class="onboarding-desc">Grant ApplyTrack secure read-only credentials to scan job correspondences.</p>
        </div>
        <div class="onboarding-content">
          <div class="permissions-overlay-card">
            <div class="permissions-overlay-title">
              <i class="fas fa-shield-alt" style="color: var(--color-secondary);"></i> Gmail API Permissions Requested:
            </div>
            <ul class="permissions-list">
              <li class="permissions-list-item">
                <i class="fas fa-check-circle" style="color: var(--color-success);"></i>
                <div>
                  <strong>Read-only access</strong>: We only read message headers and bodies to extract application details. We cannot send, delete, or modify your emails.
                </div>
              </li>
              <li class="permissions-list-item">
                <i class="fas fa-check-circle" style="color: var(--color-success);"></i>
                <div>
                  <strong>Job-Filter Restrictive scanning</strong>: Our parser ignores personal emails, bank notifications, and social updates. It only scans emails matching automated hiring tools (Greenhouse, Workday, LinkedIn, etc.).
                </div>
              </li>
              <li class="permissions-list-item">
                <i class="fas fa-check-circle" style="color: var(--color-success);"></i>
                <div>
                  <strong>Secure Encryption</strong>: OAuth tokens are encrypted in transit and at rest using AES-256 standard. You can revoke access instantly in your Google settings.
                </div>
              </li>
            </ul>
          </div>

          <div class="gmail-connect-box" style="width: 100%;">
            <div class="gmail-icon-large">
              <i class="fab fa-google"></i>
            </div>
            
            ${isConnected ? `
              <div class="gmail-connected-badge">
                <i class="fas fa-check-circle"></i> Gmail Linked Successfully
              </div>
              <p class="gmail-status-text">Connected: <strong>${currentUser.email}</strong></p>
            ` : `
              <button id="gmail-connect-btn" class="btn btn-secondary" style="border-color: var(--color-border); font-size: 1rem; padding: 12px 24px;">
                <i class="fab fa-google" style="color: #EA4335;"></i> Connect Gmail Account
              </button>
              <p class="gmail-status-text">We request read-only access to messages that look like job confirmations or follow-ups.</p>
            `}
          </div>
        </div>
      `;
      
      // If connected, CTA text says Continue. If not connected, disable/require connect or allow skip.
      if (isConnected) {
        nextBtn.innerHTML = `Verify Connection <i class="fas fa-arrow-right"></i>`;
        nextBtn.disabled = false;
      } else {
        nextBtn.innerHTML = `Skip for Now <i class="fas fa-forward"></i>`;
        nextBtn.disabled = false;
        
        // Connect Gmail button event handler
        document.getElementById('gmail-connect-btn')?.addEventListener('click', simulateGmailConnect);
      }
      break;

    case 4:
      holder.innerHTML = `
        <div class="onboarding-header">
          <h2 class="onboarding-title">AI Sync Finalized!</h2>
          <p class="onboarding-desc">Your onboarding is completed. Your tracking board is initialized and ready.</p>
        </div>
        <div class="onboarding-content">
          <div class="onboarding-illustration" style="margin: 24px 0;">
            <img src="assets/gmail_connect.png" alt="Onboarding Done" style="max-height: 200px; border-radius: var(--radius-md);">
          </div>
          <div style="background-color: var(--color-success-light); border: 1px solid rgba(16, 185, 129, 0.2); border-radius: var(--radius-md); padding: 16px; color: var(--color-success); font-weight: 600; text-align: center; font-size: 0.95rem;">
            <i class="fas fa-sparkles"></i> AI Engine actively scanning: Detected 4 applications from the last 30 days!
          </div>
        </div>
      `;
      nextBtn.innerHTML = `Launch Dashboard <i class="fas fa-rocket"></i>`;
      break;
  }
}

// Handler for Gmail Sync simulation
async function simulateGmailConnect() {
  const btn = document.getElementById('gmail-connect-btn') || document.getElementById('settings-connect-btn') || document.getElementById('settings-reconnect-btn');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Opening Google OAuth...`;
  }
  
  // Simulate Google OAuth Popup window
  const width = 500, height = 660;
  const left = (screen.width - width) / 2;
  const top = (screen.height - height) / 2;
  
  const popup = window.open('', 'google_oauth_popup', `width=${width},height=${height},top=${top},left=${left},resizable=yes,scrollbars=yes`);
  
  if (popup) {
    popup.document.write(`
      <html>
        <head>
          <title>Sign in - Google Accounts</title>
          <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #F8FAFC; color: #1E293B; }
            .card { background: #fff; padding: 40px; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.06); max-width: 440px; width: 100%; border: 1px solid #E2E8F0; box-sizing: border-box; }
            .google-logo { display: flex; align-items: center; justify-content: center; gap: 8px; margin-bottom: 24px; font-weight: 700; font-size: 1.4rem; color: #475569; }
            h2 { font-size: 1.35rem; font-weight: 600; color: #0F172A; text-align: center; margin-bottom: 12px; line-height: 1.3; }
            .account-indicator { display: flex; align-items: center; gap: 10px; justify-content: center; font-size: 0.9rem; color: #475569; border: 1px solid #E2E8F0; padding: 6px 12px; border-radius: 9999px; margin-bottom: 24px; }
            .permissions-heading { font-weight: 700; font-size: 0.95rem; color: #334155; margin-bottom: 16px; }
            .scope-box { display: flex; gap: 12px; background: #F8FAFC; padding: 16px; border-radius: 8px; border: 1px solid #E2E8F0; margin-bottom: 24px; text-align: left; }
            .scope-box i { color: #2563EB; font-size: 1.2rem; margin-top: 2px; }
            .scope-text { font-size: 0.85rem; color: #475569; line-height: 1.4; }
            .scope-title { font-weight: 700; color: #1E293B; margin-bottom: 4px; }
            .warning-text { font-size: 0.8rem; color: #64748B; margin-bottom: 32px; line-height: 1.4; text-align: left; border-top: 1px solid #E2E8F0; padding-top: 16px; }
            .actions { display: flex; justify-content: flex-end; gap: 12px; }
            .btn { padding: 10px 18px; border-radius: 6px; font-weight: 600; font-size: 0.85rem; cursor: pointer; border: 1px solid transparent; transition: 0.15s; }
            .btn-cancel { background: #FFFFFF; border-color: #CBD5E1; color: #475569; }
            .btn-cancel:hover { background: #F1F5F9; }
            .btn-allow { background: #2563EB; color: #FFFFFF; }
            .btn-allow:hover { background: #1D4ED8; }
            .spinner { font-size: 2rem; color: #2563EB; animation: spin 1s infinite linear; margin-bottom: 16px; }
            @keyframes spin { 100% { transform: rotate(360deg); } }
          </style>
        </head>
        <body>
          <div class="card" id="consent-card">
            <div class="google-logo"><i class="fab fa-google" style="color: #4285F4;"></i> Google Accounts</div>
            <h2>ApplyTrack wants to access your Google Account</h2>
            <div class="account-indicator">
              <i class="far fa-user-circle"></i> <span>${currentUser.email}</span>
            </div>
            
            <div class="permissions-heading">This will allow ApplyTrack to:</div>
            <div class="scope-box">
              <i class="fas fa-envelope-open-text"></i>
              <div class="scope-text">
                <div class="scope-title">View your email messages and settings</div>
                Read-only metadata access to scan your email headers and body contents specifically matching job updates.
              </div>
            </div>
            
            <div class="warning-text">
              By clicking Allow, you authorize ApplyTrack to use your information in accordance with their Terms of Service and Privacy Policy. You can edit or revoke these permissions anytime in your Google Account settings.
            </div>
            
            <div class="actions">
              <button class="btn btn-cancel" onclick="window.close()">Cancel</button>
              <button class="btn btn-allow" onclick="grantAccess()">Allow</button>
            </div>
          </div>

          <script>
            function grantAccess() {
              const card = document.getElementById('consent-card');
              card.innerHTML = \`
                <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 250px;">
                  <div class="spinner"><i class="fas fa-spinner"></i></div>
                  <h2 style="margin-top: 0; font-size: 1.25rem;">Granting Access...</h2>
                  <p style="color: #64748B; font-size: 0.9rem; text-align: center;">Connecting securely and saving credentials token.</p>
                </div>
              \`;
              
              setTimeout(() => {
                window.opener.postMessage('gmail_connected_success', '*');
              }, 1500);
            }
          </script>
        </body>
      </html>
    `);
    popup.document.close();
  }

  // Fallback if popup is blocked
  const timeoutId = setTimeout(async () => {
    window.removeEventListener('message', messageHandler);
    try {
      await updateProfileState({ 
        gmail_connected: true,
        sync_error: false,
        last_synced: new Date().toISOString()
      });
      showToast("Successfully linked Gmail account!", "success");
      if (window.location.hash === '#/onboarding') {
        onboardingStep = 4;
        updateOnboardingStep();
      } else {
        handleRouting();
      }
    } catch (err) {
      showToast(err.message, 'error');
    }
  }, 12000); // 12 seconds backup fallback

  // Set up message listener
  const messageHandler = async (event) => {
    if (event.data === 'gmail_connected_success') {
      clearTimeout(timeoutId);
      window.removeEventListener('message', messageHandler);
      if (popup) popup.close();
      
      try {
        await updateProfileState({ 
          gmail_connected: true,
          sync_error: false,
          last_synced: new Date().toISOString()
        });
        showToast("Successfully linked Gmail account!", "success");
        if (window.location.hash === '#/onboarding') {
          onboardingStep = 4;
          updateOnboardingStep();
        } else {
          handleRouting();
        }
      } catch (err) {
        showToast(err.message, 'error');
      }
    }
  };
  
  window.addEventListener('message', messageHandler);
}

async function handleOnboardingNext() {
  if (onboardingStep < 4) {
    if (onboardingStep === 3 && !currentProfile?.gmail_connected) {
      // User clicked "Skip for Now" without connecting Gmail
      showToast("Inbox sync skipped. You can link your Gmail later in settings.", "info");
    }
    onboardingStep++;
    updateOnboardingStep();
  } else {
    // Finish onboarding
    const btn = document.getElementById('onboard-next');
    setButtonLoading(btn, true);
    try {
      await updateProfileState({ onboarding_completed: true });
      showToast("Setup completed!", "success");
      navigate('#/dashboard');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setButtonLoading(btn, false, "Launch Dashboard");
    }
  }
}

function handleOnboardingBack() {
  if (onboardingStep > 1) {
    onboardingStep--;
    updateOnboardingStep();
  }
}

// Status transition weights
const STATUS_WEIGHT = {
  'applied': 1,
  'assessment': 2,
  'interview': 3,
  'rejected': 4,
  'offer': 5
};

// Notifications Database Manager (local persistence and Supabase adapter)
async function fetchNotifications() {
  if (window.USE_MOCK_AUTH) {
    let stored = localStorage.getItem('applytrack_notifications');
    if (!stored) {
      // Seed default mock notifications
      const defaultNotices = [
        {
          id: "mock-notif-1",
          user_id: "mock-user-id",
          job_id: "google-mock-id", // Google mock job
          title: "Google Technical Portfolio Review",
          message: "A portfolio review has been scheduled for tomorrow at 2:00 PM PST. Zoom link attached.",
          type: "Interview Scheduled",
          status: "unread",
          created_at: new Date(Date.now() - 3600 * 1000 * 2).toISOString() // 2 hours ago
        },
        {
          id: "mock-notif-2",
          user_id: "mock-user-id",
          job_id: "figma-mock-id", // Figma mock job
          title: "Figma Follow-Up Recommended",
          message: "Application submitted 14 days ago with no response. Consider sending a friendly follow-up email.",
          type: "Reminder Due",
          status: "unread",
          created_at: new Date(Date.now() - 3600 * 1000 * 24).toISOString() // 1 day ago
        },
        {
          id: "mock-notif-3",
          user_id: "mock-user-id",
          job_id: "stripe-mock-id",
          title: "Stripe Application Synced",
          message: "New application synced automatically from Stripe recruitment confirmation email.",
          type: "Application Updated",
          status: "unread",
          created_at: new Date(Date.now() - 3600 * 1000 * 48).toISOString() // 2 days ago
        }
      ];
      localStorage.setItem('applytrack_notifications', JSON.stringify(defaultNotices));
      return defaultNotices;
    }
    return JSON.parse(stored);
  } else {
    const { data, error } = await supabaseClient
      .from('notifications')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data;
  }
}

async function addNotification(title, message, type, jobId = null) {
  if (window.USE_MOCK_AUTH) {
    const list = await fetchNotifications();
    const newNotice = {
      id: "mock-notif-" + Date.now(),
      user_id: "mock-user-id",
      job_id: jobId,
      title: title,
      message: message,
      type: type,
      status: "unread",
      created_at: new Date().toISOString()
    };
    list.unshift(newNotice);
    localStorage.setItem('applytrack_notifications', JSON.stringify(list));
    return newNotice;
  } else {
    const newNotice = {
      user_id: currentUser.id,
      job_id: jobId,
      title: title,
      message: message,
      type: type,
      status: "unread",
      created_at: new Date().toISOString()
    };
    const { data, error } = await supabaseClient
      .from('notifications')
      .insert(newNotice)
      .select()
      .single();
    if (error) throw error;
    return data;
  }
}

async function updateNotificationStatus(id, status) {
  if (window.USE_MOCK_AUTH) {
    const list = await fetchNotifications();
    const item = list.find(n => n.id === id);
    if (item) {
      item.status = status;
      localStorage.setItem('applytrack_notifications', JSON.stringify(list));
    }
  } else {
    const { error } = await supabaseClient
      .from('notifications')
      .update({ status: status })
      .eq('id', id);
    if (error) throw error;
  }
}

async function markAllNotificationsAsRead() {
  if (window.USE_MOCK_AUTH) {
    const list = await fetchNotifications();
    list.forEach(n => {
      if (n.status === 'unread') n.status = 'read';
    });
    localStorage.setItem('applytrack_notifications', JSON.stringify(list));
  } else {
    const { error } = await supabaseClient
      .from('notifications')
      .update({ status: 'read' })
      .eq('status', 'unread');
    if (error) throw error;
  }
}

async function updateFollowUpFields(jobId, followUpDate, followUpStatus, lastFollowUp) {
  if (window.USE_MOCK_AUTH) {
    const list = getJobs();
    const item = list.find(j => String(j.id) === String(jobId));
    if (item) {
      item.follow_up_date = followUpDate || null;
      item.follow_up_status = followUpStatus || 'none';
      item.last_follow_up = lastFollowUp || null;
      localStorage.setItem('applytrack_jobs', JSON.stringify(list));
    }
  } else {
    const { error } = await supabaseClient
      .from('jobs')
      .update({
        follow_up_date: followUpDate || null,
        follow_up_status: followUpStatus || 'none',
        last_follow_up: lastFollowUp || null,
        updated_at: new Date().toISOString()
      })
      .eq('id', jobId);
    if (error) throw error;
  }
}

async function deleteNotification(id) {
  if (window.USE_MOCK_AUTH) {
    const list = await fetchNotifications();
    const filtered = list.filter(n => n.id !== id);
    localStorage.setItem('applytrack_notifications', JSON.stringify(filtered));
  } else {
    const { error } = await supabaseClient
      .from('notifications')
      .delete()
      .eq('id', id);
    if (error) throw error;
  }
}

// Jobs Database Manager (local persistence and Supabase adapter)
async function fetchJobs() {
  if (window.USE_MOCK_AUTH) {
    return getJobs();
  } else {
    const { data, error } = await supabaseClient
      .from('jobs')
      .select('*')
      .order('updated_at', { ascending: false });
    if (error) throw error;
    return data;
  }
}

async function saveJobs(newJobsList) {
  if (window.USE_MOCK_AUTH) {
    return addJobs(newJobsList);
  } else {
    const formattedJobs = newJobsList.map(j => ({
      user_id: currentUser.id,
      company: j.company,
      role: j.role,
      status: j.status,
      source: j.source,
      recruiter_email: j.recruiter_email || null,
      email_subject: j.email_subject || null,
      confidence_score: j.confidence_score || 100.0,
      category: j.category || null,
      resume_id: j.resume_id || null,
      date: j.date || new Date().toISOString(),
      updated_at: new Date().toISOString()
    }));
    
    const { data, error } = await supabaseClient
      .from('jobs')
      .upsert(formattedJobs, { onConflict: 'user_id,company,role' })
      .select();
      
    if (error) throw error;
    return data;
  }
}

function getJobs() {
  let jobs = localStorage.getItem('applytrack_jobs');
  let parsed = jobs ? JSON.parse(jobs) : null;
  
  // Force reset if jobs is empty or using the old structure without notes/activities/metadata
  if (!parsed || parsed.length === 0 || !parsed[0].hasOwnProperty('recruiter_name')) {
    const defaultJobs = [
      { 
        id: 1, 
        company: 'Stripe', 
        role: 'Product Designer', 
        date: 'Applied 2 days ago', 
        status: 'applied', 
        source: 'LinkedIn',
        employment_type: 'Full-time',
        location: 'San Francisco, CA (Hybrid)',
        salary_range: '$140,000 - $165,000',
        job_url: 'https://stripe.com/jobs/product-designer',
        recruiter_name: 'Sarah Jenkins',
        recruiter_email: 'sarah.jenkins@stripe.com',
        recruiter_linkedin: 'https://linkedin.com/in/sarah-jenkins-stripe',
        recruiter_phone: '+1 (555) 012-3456',
        notes: [
          {
            id: 'note_1',
            content: 'Met with hiring manager Sarah. She liked my Figma layout systems and portfolio case study on checkout optimizations.',
            created_at: new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString(),
            updated_at: new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString()
          },
          {
            id: 'note_2',
            content: 'Need to follow up next Tuesday if no automatic status updates from pipeline.',
            created_at: new Date(Date.now() - 1 * 24 * 3600 * 1000).toISOString(),
            updated_at: new Date(Date.now() - 1 * 24 * 3600 * 1000).toISOString()
          }
        ],
        attachments: [
          {
            id: 'att_1',
            file_name: 'Osaze_Design_Resume.pdf',
            file_url: '#',
            file_type: 'resume',
            created_at: new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString()
          }
        ],
        activities: [
          {
            id: 'act_1_1',
            event_type: 'created',
            description: 'Application created via LinkedIn import.',
            created_at: new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString()
          },
          {
            id: 'act_1_2',
            event_type: 'details_updated',
            description: 'Updated recruiter contact details (Sarah Jenkins).',
            created_at: new Date(Date.now() - 2 * 24 * 3600 * 1000 + 3600000).toISOString()
          }
        ]
      },
      { 
        id: 2, 
        company: 'Google', 
        role: 'UX Engineer', 
        date: 'Applied 5 days ago', 
        status: 'applied', 
        source: 'Referral',
        employment_type: 'Full-time',
        location: 'Mountain View, CA (On-site)',
        salary_range: '$160,000 - $190,000',
        job_url: 'https://careers.google.com/jobs',
        recruiter_name: 'David Miller',
        recruiter_email: 'david.miller@google.com',
        recruiter_linkedin: 'https://linkedin.com/in/david-miller-recruiting',
        recruiter_phone: '+1 (650) 253-0000',
        notes: [
          {
            id: 'note_google_1',
            content: 'Referred by senior software engineer friend. Resubmitted application through internal careers link.',
            created_at: new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString(),
            updated_at: new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString()
          }
        ],
        attachments: [],
        activities: [
          {
            id: 'act_google_1',
            event_type: 'created',
            description: 'Application submitted via referral portal.',
            created_at: new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString()
          }
        ]
      },
      { 
        id: 3, 
        company: 'Figma', 
        role: 'Senior Designer', 
        date: 'Interview 26 June', 
        status: 'interview', 
        source: 'Greenhouse',
        employment_type: 'Full-time',
        location: 'Remote (USA)',
        salary_range: '$170,000 - $205,000',
        job_url: 'https://figma.com/careers',
        recruiter_name: 'Emily Watson',
        recruiter_email: 'emily@figma.com',
        recruiter_linkedin: 'https://linkedin.com/in/emily-watson-recruits',
        recruiter_phone: '+1 (415) 555-0144',
        notes: [
          {
            id: 'note_figma_1',
            content: 'Technical portfolio review scheduled for tomorrow at 2:00 PM PST. Reviewing slide deck on design systems.',
            created_at: new Date(Date.now() - 1 * 24 * 3600 * 1000).toISOString(),
            updated_at: new Date(Date.now() - 1 * 24 * 3600 * 1000).toISOString()
          }
        ],
        attachments: [
          {
            id: 'att_figma_1',
            file_name: 'Case_Study_DesignSystems.pdf',
            file_url: '#',
            file_type: 'portfolio',
            created_at: new Date(Date.now() - 4 * 24 * 3600 * 1000).toISOString()
          }
        ],
        activities: [
          {
            id: 'act_figma_1',
            event_type: 'created',
            description: 'Application created via Greenhouse.',
            created_at: new Date(Date.now() - 10 * 24 * 3600 * 1000).toISOString()
          },
          {
            id: 'act_figma_2',
            event_type: 'status_changed',
            description: 'Status updated from APPLIED to INTERVIEW.',
            created_at: new Date(Date.now() - 4 * 24 * 3600 * 1000).toISOString()
          }
        ]
      },
      { 
        id: 4, 
        company: 'Slack', 
        role: 'Product Manager', 
        date: 'Received yesterday', 
        status: 'offer', 
        source: 'Direct',
        employment_type: 'Full-time',
        location: 'San Francisco, CA (Hybrid)',
        salary_range: '$150,000 - $185,000',
        job_url: 'https://slack.com/careers',
        recruiter_name: 'Michael Chang',
        recruiter_email: 'mchang@slack-corp.com',
        recruiter_linkedin: 'https://linkedin.com/in/michael-chang-recruitment',
        recruiter_phone: '+1 (415) 555-0177',
        notes: [
          {
            id: 'note_slack_1',
            content: 'Offer details: base salary $165k, 15% bonus, and standard stock grants. Need to reply by next Friday.',
            created_at: new Date(Date.now() - 12 * 3600 * 1000).toISOString(),
            updated_at: new Date(Date.now() - 12 * 3600 * 1000).toISOString()
          }
        ],
        attachments: [
          {
            id: 'att_slack_1',
            file_name: 'Slack_Offer_Letter.pdf',
            file_url: '#',
            file_type: 'other',
            created_at: new Date(Date.now() - 12 * 3600 * 1000).toISOString()
          }
        ],
        activities: [
          {
            id: 'act_slack_1',
            event_type: 'created',
            description: 'Application submitted directly on Slack website.',
            created_at: new Date(Date.now() - 15 * 24 * 3600 * 1000).toISOString()
          },
          {
            id: 'act_slack_2',
            event_type: 'status_changed',
            description: 'Status updated from APPLIED to INTERVIEW.',
            created_at: new Date(Date.now() - 8 * 24 * 3600 * 1000).toISOString()
          },
          {
            id: 'act_slack_3',
            event_type: 'status_changed',
            description: 'Status updated from INTERVIEW to OFFER.',
            created_at: new Date(Date.now() - 12 * 3600 * 1000).toISOString()
          }
        ]
      },
      { 
        id: 5, 
        company: 'HackerRank', 
        role: 'Software Engineer', 
        date: 'Assessment scheduled', 
        status: 'assessment', 
        source: 'Greenhouse',
        employment_type: 'Contract',
        location: 'Remote (USA)',
        salary_range: '$85 - $100 / hour',
        job_url: 'https://hackerrank.com/careers',
        recruiter_name: 'Jessica Taylor',
        recruiter_email: 'jessica@hackerrank.com',
        recruiter_linkedin: 'https://linkedin.com/in/jessica-taylor-hackerrank',
        recruiter_phone: '+1 (800) 555-0100',
        notes: [
          {
            id: 'note_hr_1',
            content: 'Received 90-minute coding challenge containing algorithms and SQL optimization questions.',
            created_at: new Date(Date.now() - 1 * 24 * 3600 * 1000).toISOString(),
            updated_at: new Date(Date.now() - 1 * 24 * 3600 * 1000).toISOString()
          }
        ],
        attachments: [],
        activities: [
          {
            id: 'act_hr_1',
            event_type: 'created',
            description: 'Application created via Greenhouse.',
            created_at: new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString()
          },
          {
            id: 'act_hr_2',
            event_type: 'status_changed',
            description: 'Status updated from APPLIED to ASSESSMENT.',
            created_at: new Date(Date.now() - 1 * 24 * 3600 * 1000).toISOString()
          }
        ]
      }
    ];
    localStorage.setItem('applytrack_jobs', JSON.stringify(defaultJobs));
    return defaultJobs;
  }
  return parsed;
}

function addJobs(newJobsList) {
  let jobs = getJobs();
  newJobsList.forEach(newJob => {
    const existingIndex = jobs.findIndex(
      j => j.company.toLowerCase() === newJob.company.toLowerCase() && 
           j.role.toLowerCase() === newJob.role.toLowerCase()
    );
    if (existingIndex !== -1) {
      const existingJob = jobs[existingIndex];
      const newWeight = STATUS_WEIGHT[newJob.status] || 0;
      const oldWeight = STATUS_WEIGHT[existingJob.status] || 0;
      
      // Update status only if weight is equal or higher (prevents downgrades)
      const shouldUpdateStatus = newWeight >= oldWeight;
      const updatedStatus = shouldUpdateStatus ? newJob.status : existingJob.status;
      
      let activities = existingJob.activities || [];
      if (shouldUpdateStatus && existingJob.status !== updatedStatus) {
        activities.push({
          id: 'act_sync_' + Date.now() + '_' + Math.random(),
          event_type: 'status_changed',
          description: `Auto-sync: Status upgraded from ${existingJob.status.toUpperCase()} to ${updatedStatus.toUpperCase()} via scanned email.`,
          created_at: new Date().toISOString()
        });
      }
      
      jobs[existingIndex] = {
        ...existingJob,
        status: updatedStatus,
        date: newJob.date,
        source: newJob.source || existingJob.source,
        recruiter_email: newJob.recruiter_email || existingJob.recruiter_email,
        email_subject: newJob.email_subject || existingJob.email_subject,
        confidence_score: newJob.confidence_score || existingJob.confidence_score,
        category: newJob.category || existingJob.category,
        activities: activities,
        updated_at: new Date().toISOString()
      };
    } else {
      const newId = Date.now() + Math.random();
      jobs.unshift({
        id: newId,
        company: newJob.company,
        role: newJob.role,
        status: newJob.status,
        date: newJob.date,
        source: newJob.source || 'Email Synced',
        recruiter_email: newJob.recruiter_email || '',
        email_subject: newJob.email_subject || '',
        confidence_score: newJob.confidence_score || 100.0,
        category: newJob.category || '',
        employment_type: 'Full-time',
        location: 'Remote',
        salary_range: 'N/A',
        job_url: '',
        recruiter_name: '',
        recruiter_linkedin: '',
        recruiter_phone: '',
        notes: [],
        attachments: [],
        activities: [
          {
            id: 'act_init_' + Date.now(),
            event_type: 'created',
            description: `Application auto-detected from parsed email (Confidence: ${newJob.confidence_score || 100}%).`,
            created_at: new Date().toISOString()
          }
        ],
        updated_at: new Date().toISOString()
      });
    }
  });
  localStorage.setItem('applytrack_jobs', JSON.stringify(jobs));
  return jobs;
}

async function fetchJobDetails(jobId) {
  if (window.USE_MOCK_AUTH) {
    const jobs = getJobs();
    const job = jobs.find(j => String(j.id) === String(jobId));
    if (!job) throw new Error("Application not found.");
    
    const notes = [...(job.notes || [])].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    const attachments = [...(job.attachments || [])].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    const activities = [...(job.activities || [])].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    
    return { job, notes, attachments, activities };
  } else {
    const [jobRes, notesRes, attachmentsRes, activitiesRes] = await Promise.all([
      supabaseClient.from('jobs').select('*').eq('id', jobId).single(),
      supabaseClient.from('job_notes').select('*').eq('job_id', jobId).order('created_at', { ascending: false }),
      supabaseClient.from('job_attachments').select('*').eq('job_id', jobId).order('created_at', { ascending: false }),
      supabaseClient.from('job_activities').select('*').eq('job_id', jobId).order('created_at', { ascending: true })
    ]);
    
    if (jobRes.error) throw jobRes.error;
    if (notesRes.error) throw notesRes.error;
    if (attachmentsRes.error) throw attachmentsRes.error;
    if (activitiesRes.error) throw activitiesRes.error;
    
    return {
      job: jobRes.data,
      notes: notesRes.data,
      attachments: attachmentsRes.data,
      activities: activitiesRes.data
    };
  }
}

async function addJobNote(jobId, content) {
  const newNote = {
    content,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  
  if (window.USE_MOCK_AUTH) {
    let jobs = getJobs();
    const idx = jobs.findIndex(j => String(j.id) === String(jobId));
    if (idx === -1) throw new Error("Application not found");
    
    newNote.id = 'note_' + Date.now() + '_' + Math.random();
    jobs[idx].notes = jobs[idx].notes || [];
    jobs[idx].notes.unshift(newNote);
    
    jobs[idx].activities = jobs[idx].activities || [];
    jobs[idx].activities.push({
      id: 'act_' + Date.now(),
      event_type: 'note_added',
      description: 'Note added: "' + (content.length > 30 ? content.slice(0, 30) + '...' : content) + '"',
      created_at: new Date().toISOString()
    });
    
    localStorage.setItem('applytrack_jobs', JSON.stringify(jobs));
    return newNote;
  } else {
    newNote.job_id = jobId;
    newNote.user_id = currentUser.id;
    const noteRes = await supabaseClient.from('job_notes').insert(newNote).select().single();
    if (noteRes.error) throw noteRes.error;
    
    await supabaseClient.from('job_activities').insert({
      job_id: jobId,
      user_id: currentUser.id,
      event_type: 'note_added',
      description: 'Note added: "' + (content.length > 30 ? content.slice(0, 30) + '...' : content) + '"'
    });
    
    return noteRes.data;
  }
}

async function updateJobNote(jobId, noteId, content) {
  if (window.USE_MOCK_AUTH) {
    let jobs = getJobs();
    const idx = jobs.findIndex(j => String(j.id) === String(jobId));
    if (idx === -1) throw new Error("Application not found");
    
    const noteIdx = jobs[idx].notes?.findIndex(n => String(n.id) === String(noteId));
    if (noteIdx === undefined || noteIdx === -1) throw new Error("Note not found");
    
    jobs[idx].notes[noteIdx].content = content;
    jobs[idx].notes[noteIdx].updated_at = new Date().toISOString();
    
    localStorage.setItem('applytrack_jobs', JSON.stringify(jobs));
    return jobs[idx].notes[noteIdx];
  } else {
    const res = await supabaseClient.from('job_notes').update({
      content,
      updated_at: new Date().toISOString()
    }).eq('id', noteId).select().single();
    if (res.error) throw res.error;
    return res.data;
  }
}

async function deleteJobNote(jobId, noteId) {
  if (window.USE_MOCK_AUTH) {
    let jobs = getJobs();
    const idx = jobs.findIndex(j => String(j.id) === String(jobId));
    if (idx === -1) throw new Error("Application not found");
    
    jobs[idx].notes = (jobs[idx].notes || []).filter(n => String(n.id) !== String(noteId));
    localStorage.setItem('applytrack_jobs', JSON.stringify(jobs));
  } else {
    const res = await supabaseClient.from('job_notes').delete().eq('id', noteId);
    if (res.error) throw res.error;
  }
}

async function addJobAttachment(jobId, fileObj) {
  const name = fileObj.name;
  const size = (fileObj.size / 1024).toFixed(1) + ' KB';
  const type = fileObj.name.toLowerCase().includes('resume') ? 'resume' : 
               fileObj.name.toLowerCase().includes('cover') ? 'cover_letter' : 
               fileObj.name.toLowerCase().includes('portfolio') ? 'portfolio' : 'other';
               
  let url = '#';
  try {
    url = URL.createObjectURL(fileObj);
  } catch (e) {
    console.error("Failed to create Object URL:", e);
  }
  
  const newAttachment = {
    file_name: name,
    file_url: url,
    file_type: type,
    created_at: new Date().toISOString()
  };
  
  if (window.USE_MOCK_AUTH) {
    let jobs = getJobs();
    const idx = jobs.findIndex(j => String(j.id) === String(jobId));
    if (idx === -1) throw new Error("Application not found");
    
    newAttachment.id = 'att_' + Date.now() + '_' + Math.random();
    jobs[idx].attachments = jobs[idx].attachments || [];
    jobs[idx].attachments.unshift(newAttachment);
    
    jobs[idx].activities = jobs[idx].activities || [];
    jobs[idx].activities.push({
      id: 'act_' + Date.now(),
      event_type: 'attachment_added',
      description: `Attachment added: ${name} (${type.replace('_', ' ')})`,
      created_at: new Date().toISOString()
    });
    
    localStorage.setItem('applytrack_jobs', JSON.stringify(jobs));
    return newAttachment;
  } else {
    newAttachment.job_id = jobId;
    newAttachment.user_id = currentUser.id;
    
    try {
      const fileExt = name.split('.').pop();
      const filePath = `${currentUser.id}/${jobId}/${Date.now()}_${name}`;
      const { data, error } = await supabaseClient.storage.from('attachments').upload(filePath, fileObj);
      if (!error && data) {
        const publicUrlRes = supabaseClient.storage.from('attachments').getPublicUrl(filePath);
        newAttachment.file_url = publicUrlRes.data.publicUrl;
      }
    } catch (storageErr) {
      console.warn("Supabase storage upload failed, falling back to local object url reference:", storageErr);
    }
    
    const attRes = await supabaseClient.from('job_attachments').insert(newAttachment).select().single();
    if (attRes.error) throw attRes.error;
    
    await supabaseClient.from('job_activities').insert({
      job_id: jobId,
      user_id: currentUser.id,
      event_type: 'attachment_added',
      description: `Attachment added: ${name} (${type.replace('_', ' ')})`
    });
    
    return attRes.data;
  }
}

async function deleteJobAttachment(jobId, attachmentId) {
  if (window.USE_MOCK_AUTH) {
    let jobs = getJobs();
    const idx = jobs.findIndex(j => String(j.id) === String(jobId));
    if (idx === -1) throw new Error("Application not found");
    
    jobs[idx].attachments = (jobs[idx].attachments || []).filter(a => String(a.id) !== String(attachmentId));
    localStorage.setItem('applytrack_jobs', JSON.stringify(jobs));
  } else {
    const res = await supabaseClient.from('job_attachments').delete().eq('id', attachmentId);
    if (res.error) throw res.error;
  }
}

async function updateJobRecruiter(jobId, recruiterData) {
  if (window.USE_MOCK_AUTH) {
    let jobs = getJobs();
    const idx = jobs.findIndex(j => String(j.id) === String(jobId));
    if (idx === -1) throw new Error("Application not found");
    
    jobs[idx].recruiter_name = recruiterData.recruiter_name;
    jobs[idx].recruiter_email = recruiterData.recruiter_email;
    jobs[idx].recruiter_linkedin = recruiterData.recruiter_linkedin;
    jobs[idx].recruiter_phone = recruiterData.recruiter_phone;
    
    jobs[idx].activities = jobs[idx].activities || [];
    jobs[idx].activities.push({
      id: 'act_' + Date.now(),
      event_type: 'recruiter_updated',
      description: `Recruiter details updated: ${recruiterData.recruiter_name || 'N/A'}`,
      created_at: new Date().toISOString()
    });
    
    localStorage.setItem('applytrack_jobs', JSON.stringify(jobs));
    return jobs[idx];
  } else {
    const res = await supabaseClient.from('jobs').update(recruiterData).eq('id', jobId).select().single();
    if (res.error) throw res.error;
    
    await supabaseClient.from('job_activities').insert({
      job_id: jobId,
      user_id: currentUser.id,
      event_type: 'recruiter_updated',
      description: `Recruiter details updated: ${recruiterData.recruiter_name || 'N/A'}`
    });
    
    return res.data;
  }
}

async function updateJobMetadata(jobId, metadataData) {
  if (window.USE_MOCK_AUTH) {
    let jobs = getJobs();
    const idx = jobs.findIndex(j => String(j.id) === String(jobId));
    if (idx === -1) throw new Error("Application not found");
    
    jobs[idx].employment_type = metadataData.employment_type;
    jobs[idx].location = metadataData.location;
    jobs[idx].salary_range = metadataData.salary_range;
    jobs[idx].job_url = metadataData.job_url;
    
    jobs[idx].activities = jobs[idx].activities || [];
    jobs[idx].activities.push({
      id: 'act_' + Date.now(),
      event_type: 'details_updated',
      description: 'Job details updated.',
      created_at: new Date().toISOString()
    });
    
    localStorage.setItem('applytrack_jobs', JSON.stringify(jobs));
    return jobs[idx];
  } else {
    const res = await supabaseClient.from('jobs').update(metadataData).eq('id', jobId).select().single();
    if (res.error) throw res.error;
    
    await supabaseClient.from('job_activities').insert({
      job_id: jobId,
      user_id: currentUser.id,
      event_type: 'details_updated',
      description: 'Job details updated.'
    });
    
    return res.data;
  }
}

async function updateJobResume(jobId, resumeId) {
  if (window.USE_MOCK_AUTH) {
    let jobs = getJobs();
    const idx = jobs.findIndex(j => String(j.id) === String(jobId));
    if (idx === -1) throw new Error("Application not found");
    
    // Fetch resume name for activity log
    const resumes = getResumes();
    const resume = resumes.find(r => String(r.id) === String(resumeId));
    const resumeName = resume ? resume.name : 'None';
    
    jobs[idx].resume_id = resumeId;
    
    jobs[idx].activities = jobs[idx].activities || [];
    jobs[idx].activities.push({
      id: 'act_' + Date.now(),
      event_type: 'details_updated',
      description: `Assigned resume version: ${resumeName}`,
      created_at: new Date().toISOString()
    });
    
    localStorage.setItem('applytrack_jobs', JSON.stringify(jobs));
    return jobs[idx];
  } else {
    let resumeName = 'None';
    if (resumeId) {
      const { data: resume } = await supabaseClient.from('resumes').select('name').eq('id', resumeId).maybeSingle();
      if (resume) resumeName = resume.name;
    }
    
    const res = await supabaseClient.from('jobs').update({ resume_id: resumeId }).eq('id', jobId).select().single();
    if (res.error) throw res.error;
    
    await supabaseClient.from('job_activities').insert({
      job_id: jobId,
      user_id: currentUser.id,
      event_type: 'details_updated',
      description: `Assigned resume version: ${resumeName}`
    });
    
    return res.data;
  }
}

async function fetchResumes() {
  if (window.USE_MOCK_AUTH) {
    return getResumes();
  } else {
    const { data, error } = await supabaseClient
      .from('resumes')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data;
  }
}

async function saveResumeVersion(name, fileName, fileType, content) {
  if (window.USE_MOCK_AUTH) {
    let resumes = getResumes();
    const newResume = {
      id: 'res_' + Date.now(),
      name,
      file_name: fileName,
      file_type: fileType,
      content,
      created_at: new Date().toISOString()
    };
    resumes.unshift(newResume);
    localStorage.setItem('applytrack_resumes', JSON.stringify(resumes));
    return newResume;
  } else {
    const { data, error } = await supabaseClient
      .from('resumes')
      .insert({
        user_id: currentUser.id,
        name,
        file_name: fileName,
        file_type: fileType,
        content
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  }
}

async function deleteResumeVersion(id) {
  if (window.USE_MOCK_AUTH) {
    let resumes = getResumes();
    resumes = resumes.filter(r => String(r.id) !== String(id));
    localStorage.setItem('applytrack_resumes', JSON.stringify(resumes));
    return true;
  } else {
    const { error } = await supabaseClient
      .from('resumes')
      .delete()
      .eq('id', id);
    if (error) throw error;
    return true;
  }
}

function getResumes() {
  let resumes = localStorage.getItem('applytrack_resumes');
  if (!resumes) {
    const defaultResumes = [
      {
        id: 'res_default_1',
        name: 'Product Designer Resume v1.0',
        file_name: 'osaze_designer_cv_v1.pdf',
        file_type: 'pdf',
        content: 'Experienced UX/Product Designer with a focus on Figma design systems, usability optimization, and interactive prototyping.',
        created_at: new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString()
      },
      {
        id: 'res_default_2',
        name: 'Technical Developer Resume v2.1',
        file_name: 'osaze_dev_cv_v2.docx',
        file_type: 'docx',
        content: 'Frontend Developer with deep React, CSS layout systems, state management, and robust HTML prototyping expertise.',
        created_at: new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString()
      }
    ];
    localStorage.setItem('applytrack_resumes', JSON.stringify(defaultResumes));
    return defaultResumes;
  }
  return JSON.parse(resumes);
}

async function updateJobStatus(jobId, oldStatus, newStatus) {
  if (window.USE_MOCK_AUTH) {
    let jobs = getJobs();
    const idx = jobs.findIndex(j => String(j.id) === String(jobId));
    if (idx === -1) throw new Error("Application not found");
    
    jobs[idx].status = newStatus;
    jobs[idx].activities = jobs[idx].activities || [];
    jobs[idx].activities.push({
      id: 'act_' + Date.now(),
      event_type: 'status_changed',
      description: `Status updated from ${oldStatus.toUpperCase()} to ${newStatus.toUpperCase()}`,
      created_at: new Date().toISOString()
    });
    
    localStorage.setItem('applytrack_jobs', JSON.stringify(jobs));
    return jobs[idx];
  } else {
    const res = await supabaseClient.from('jobs').update({
      status: newStatus,
      updated_at: new Date().toISOString()
    }).eq('id', jobId).select().single();
    if (res.error) throw res.error;
    
    await supabaseClient.from('job_activities').insert({
      job_id: jobId,
      user_id: currentUser.id,
      event_type: 'status_changed',
      description: `Status updated from ${oldStatus.toUpperCase()} to ${newStatus.toUpperCase()}`
    });
    
    return res.data;
  }
}

function getInterviews() {
  let interviews = localStorage.getItem('applytrack_interviews');
  if (!interviews) {
    const jobs = getJobs();
    const figmaJob = jobs.find(j => j.company === 'Figma');
    const slackJob = jobs.find(j => j.company === 'Slack');
    
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split('T')[0];
    
    const nextWeek = new Date();
    nextWeek.setDate(nextWeek.getDate() + 5);
    const nextWeekStr = nextWeek.toISOString().split('T')[0];

    const defaultInterviews = [
      {
        id: 'int_figma_1',
        job_id: figmaJob ? figmaJob.id : 3,
        company: 'Figma',
        role: figmaJob ? figmaJob.role : 'Senior Designer',
        interview_type: 'Technical Interview',
        date: tomorrowStr,
        time: '14:00',
        time_zone: 'PST',
        meeting_link: 'https://zoom.us/j/figma-tech-review',
        interviewer_name: 'Emily Watson',
        interviewer_email: 'emily@figma.com',
        notes: 'Technical portfolio review: present case study on design systems.',
        status: 'Upcoming',
        reminders: ['1 Hour Before', '15 Minutes Before']
      },
      {
        id: 'int_slack_1',
        job_id: slackJob ? slackJob.id : 4,
        company: 'Slack',
        role: slackJob ? slackJob.role : 'Product Manager',
        interview_type: 'Final Interview',
        date: nextWeekStr,
        time: '10:00',
        time_zone: 'PST',
        meeting_link: 'https://zoom.us/j/slack-final-panel',
        interviewer_name: 'Michael Chang',
        interviewer_email: 'mchang@slack-corp.com',
        notes: 'Executive final review with Director of Product.',
        status: 'Upcoming',
        reminders: ['24 Hours Before', '1 Hour Before']
      }
    ];
    localStorage.setItem('applytrack_interviews', JSON.stringify(defaultInterviews));
    return defaultInterviews;
  }
  return JSON.parse(interviews);
}

async function fetchInterviews() {
  if (window.USE_MOCK_AUTH) {
    return getInterviews();
  } else {
    const { data, error } = await supabaseClient
      .from('interviews')
      .select('*, jobs(company, role)')
      .order('date', { ascending: true })
      .order('time', { ascending: true });
    if (error) throw error;
    
    return data.map(item => ({
      ...item,
      company: item.jobs?.company || 'Unknown',
      role: item.jobs?.role || 'Job'
    }));
  }
}

async function createInterview(interviewData) {
  if (window.USE_MOCK_AUTH) {
    let interviews = getInterviews();
    const jobs = getJobs();
    const matchedJob = jobs.find(j => String(j.id) === String(interviewData.job_id));
    
    const newInt = {
      ...interviewData,
      id: 'int_' + Date.now() + '_' + Math.random(),
      company: matchedJob ? matchedJob.company : 'Unknown',
      role: matchedJob ? matchedJob.role : 'Job',
      status: 'Upcoming'
    };
    
    interviews.push(newInt);
    localStorage.setItem('applytrack_interviews', JSON.stringify(interviews));
    
    if (matchedJob) {
      const idx = jobs.findIndex(j => String(j.id) === String(matchedJob.id));
      jobs[idx].activities = jobs[idx].activities || [];
      jobs[idx].activities.push({
        id: 'act_' + Date.now(),
        event_type: 'details_updated',
        description: `Scheduled ${interviewData.interview_type} on ${interviewData.date} at ${interviewData.time}`,
        created_at: new Date().toISOString()
      });
      localStorage.setItem('applytrack_jobs', JSON.stringify(jobs));
    }
    
    return newInt;
  } else {
    const formatted = {
      job_id: interviewData.job_id,
      user_id: currentUser.id,
      interview_type: interviewData.interview_type,
      date: interviewData.date,
      time: interviewData.time,
      time_zone: interviewData.time_zone || 'UTC',
      meeting_link: interviewData.meeting_link || null,
      interviewer_name: interviewData.interviewer_name || null,
      interviewer_email: interviewData.interviewer_email || null,
      notes: interviewData.notes || null,
      status: 'Upcoming',
      reminders: interviewData.reminders || []
    };
    
    const { data, error } = await supabaseClient.from('interviews').insert(formatted).select().single();
    if (error) throw error;
    
    await supabaseClient.from('job_activities').insert({
      job_id: interviewData.job_id,
      user_id: currentUser.id,
      event_type: 'details_updated',
      description: `Scheduled ${interviewData.interview_type} on ${interviewData.date} at ${interviewData.time}`
    });
    
    return data;
  }
}

async function updateInterview(interviewId, updatedFields) {
  if (window.USE_MOCK_AUTH) {
    let interviews = getInterviews();
    const idx = interviews.findIndex(i => String(i.id) === String(interviewId));
    if (idx === -1) throw new Error("Interview not found");
    
    const oldStatus = interviews[idx].status;
    interviews[idx] = {
      ...interviews[idx],
      ...updatedFields
    };
    
    localStorage.setItem('applytrack_interviews', JSON.stringify(interviews));
    
    if (updatedFields.status && updatedFields.status !== oldStatus) {
      let jobs = getJobs();
      const jobIdx = jobs.findIndex(j => String(j.id) === String(interviews[idx].job_id));
      if (jobIdx !== -1) {
        jobs[jobIdx].activities = jobs[jobIdx].activities || [];
        jobs[jobIdx].activities.push({
          id: 'act_' + Date.now(),
          event_type: 'status_changed',
          description: `${interviews[idx].interview_type} marked as ${updatedFields.status.toUpperCase()}`,
          created_at: new Date().toISOString()
        });
        localStorage.setItem('applytrack_jobs', JSON.stringify(jobs));
      }
    }
    
    return interviews[idx];
  } else {
    const { data, error } = await supabaseClient
      .from('interviews')
      .update(updatedFields)
      .eq('id', interviewId)
      .select()
      .single();
    if (error) throw error;
    
    if (updatedFields.status) {
      await supabaseClient.from('job_activities').insert({
        job_id: data.job_id,
        user_id: currentUser.id,
        event_type: 'status_changed',
        description: `${data.interview_type} marked as ${updatedFields.status.toUpperCase()}`
      });
    }
    
    return data;
  }
}

async function deleteInterview(interviewId) {
  if (window.USE_MOCK_AUTH) {
    let interviews = getInterviews();
    interviews = interviews.filter(i => String(i.id) !== String(interviewId));
    localStorage.setItem('applytrack_interviews', JSON.stringify(interviews));
  } else {
    const { error } = await supabaseClient.from('interviews').delete().eq('id', interviewId);
    if (error) throw error;
  }
}

// Relative Sync Time formatting logic
function getRelativeTimeString(dateStr) {
  if (!dateStr) return 'Never';
  const now = new Date();
  const past = new Date(dateStr);
  const diffMs = now - past;
  const diffSecs = Math.floor(diffMs / 1000);
  
  if (diffSecs < 10) return 'Just now';
  if (diffSecs < 60) return `${diffSecs}s ago`;
  
  const diffMins = Math.floor(diffSecs / 60);
  if (diffMins < 60) return `${diffMins} min${diffMins > 1 ? 's' : ''} ago`;
  
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
  
  return past.toLocaleDateString();
}

let relativeTimeInterval = null;

function startRelativeTimeUpdater() {
  if (relativeTimeInterval) clearInterval(relativeTimeInterval);
  relativeTimeInterval = setInterval(() => {
    const el = document.getElementById('last-synced-time');
    if (el && currentProfile?.last_synced) {
      el.textContent = getRelativeTimeString(currentProfile.last_synced);
    }
    const settingsEl = document.getElementById('settings-last-synced');
    if (settingsEl && currentProfile?.last_synced) {
      settingsEl.textContent = getRelativeTimeString(currentProfile.last_synced);
    }
  }, 10000); // Check every 10 seconds
}

// Heuristic Email Parser Engine
function parseEmail(email) {
  const subject = email.subject || '';
  const body = email.body || '';
  const from = email.from || '';
  
  let score = 30; // Baseline
  
  // 1. Check sender domains & platforms
  let source = 'Company Portal';
  if (from.includes('linkedin.com') || body.toLowerCase().includes('linkedin easy apply')) {
    source = 'LinkedIn';
    score += 25;
  } else if (from.includes('indeed.com') || body.toLowerCase().includes('indeed apply')) {
    source = 'Indeed';
    score += 25;
  } else if (from.includes('greenhouse.io') || from.includes('greenhouse-mail.io')) {
    source = 'Greenhouse';
    score += 25;
  } else if (from.includes('lever.co')) {
    source = 'Lever';
    score += 25;
  } else if (from.includes('workable.com')) {
    source = 'Workable';
    score += 25;
  } else if (from.includes('ashbyhq.com') || from.includes('ashby.co')) {
    source = 'Ashby';
    score += 25;
  } else if (from.match(/@(stripe|figma|google|airbnb|netflix|dropbox)\.com/i)) {
    score += 20; // Direct company domains
  }
  
  // 2. Identify Category & Status
  let category = '';
  let status = '';
  
  const cleanSubject = subject.toLowerCase();
  const cleanBody = body.toLowerCase();
  
  // Offer Letter
  if (cleanSubject.includes('offer') || cleanBody.includes('offer of employment') || cleanBody.includes('pleased to offer you')) {
    category = 'Offer Letter';
    status = 'offer';
    score += 30;
  }
  // Rejection
  else if (cleanSubject.includes('application update') || cleanBody.includes('not move forward') || cleanBody.includes('pursue other candidates') || cleanBody.includes('decided to move forward with other') || cleanBody.includes('unsuccessful') || cleanBody.includes('unfortunately')) {
    category = 'Rejection';
    status = 'rejected';
    score += 30;
  }
  // Assessment Invitation
  else if (cleanSubject.includes('assessment') || cleanSubject.includes('test') || cleanBody.includes('codesignal') || cleanBody.includes('hackerrank') || cleanBody.includes('coding test') || cleanBody.includes('technical assessment')) {
    category = 'Assessment Invitation';
    status = 'assessment';
    score += 25;
  }
  // Interview Invitation
  else if (cleanSubject.includes('interview') || cleanSubject.includes('schedule') || cleanBody.includes('schedule a call') || cleanBody.includes('zoom link') || cleanBody.includes('phone screen') || cleanBody.includes('calendly')) {
    category = 'Interview Invitation';
    status = 'interview';
    score += 30;
  }
  // Recruiter Outreach
  else if (cleanSubject.includes('opportunity') || cleanSubject.includes('chat about') || cleanBody.includes('saw your profile') || cleanBody.includes('interesting background') || cleanBody.includes('fit for our team')) {
    category = 'Recruiter Outreach';
    status = 'applied';
    score += 20;
  }
  // Application Received
  else if (cleanSubject.includes('received') || cleanSubject.includes('confirmation') || cleanSubject.includes('applying') || cleanBody.includes('thank you for applying') || cleanBody.includes('confirming receipt') || cleanBody.includes('submitted your application')) {
    category = 'Application Received';
    status = 'applied';
    score += 25;
  }
  
  // 3. Keyword scan for confidence adjustment
  const jobKeywords = ['resume', 'position', 'role', 'apply', 'hiring', 'applicant', 'job', 'team', 'candidate'];
  jobKeywords.forEach(kw => {
    if (cleanBody.includes(kw)) score += 3;
    if (cleanSubject.includes(kw)) score += 5;
  });
  
  // Privacy Filters / Ignored cues
  const personalKeywords = ['dinner', 'family', 'pasta', 'tacos', 'love you', 'weekend plans', 'movies', 'trailer', 'streaming', 'season 5', 'gift card', 'receipt'];
  personalKeywords.forEach(kw => {
    if (cleanBody.includes(kw) || cleanSubject.includes(kw)) score -= 40;
  });
  
  // Normalize score
  score = Math.max(0, Math.min(100, score));
  const detected = score >= 75 && category !== '';
  
  // 4. Extract Company & Role Heuristics
  let company = 'Unknown';
  let role = 'Job Application';
  
  // Regex pattern for "[Role] at [Company]" or similar in subject
  const atMatch = subject.match(/(.+?)\s+at\s+([A-Za-z0-9\s\.\,\-]+)/i);
  const withMatch = subject.match(/(.+?)\s+with\s+([A-Za-z0-9\s\.\,\-]+)/i);
  
  if (atMatch) {
    role = atMatch[1].trim();
    company = atMatch[2].trim();
  } else if (withMatch) {
    role = withMatch[1].trim();
    company = withMatch[2].trim();
  } else {
    // Attempt parsing from sender name or domains
    const fromDomainMatch = from.match(/@([a-zA-Z0-9\-\.]+)\.[a-zA-Z]{2,}/);
    if (fromDomainMatch) {
      const dom = fromDomainMatch[1].toLowerCase();
      if (!['gmail', 'yahoo', 'outlook', 'hotmail', 'protonmail', 'linkedin', 'indeed', 'greenhouse', 'lever', 'ashbyhq', 'workable'].includes(dom)) {
        company = dom.charAt(0).toUpperCase() + dom.slice(1);
      }
    }
  }
  
  // Attempt job title matching from subject
  const roleKeywords = ['Software Engineer', 'Frontend Engineer', 'Backend Engineer', 'UX Designer', 'UX Engineer', 'Product Designer', 'Senior Designer', 'Product Manager', 'Data Scientist'];
  for (const rKey of roleKeywords) {
    if (cleanSubject.includes(rKey.toLowerCase())) {
      role = rKey;
      break;
    }
  }
  
  // Clean up company names that contain job sites suffixes
  if (company.toLowerCase().includes('careers') || company.toLowerCase().includes('jobs')) {
    company = company.replace(/jobs|careers/gi, '').trim();
  }
  
  // Clean up extracted symbols
  company = company.replace(/^(confirmation:|update:|offer:|interview:)/i, '').trim();
  role = role.replace(/^(confirmation:|update:|offer:|interview:)/i, '').trim();
  
  // Extract Recruiter email
  let recruiter_email = null;
  const emailRegex = /<([^>]+)>/;
  const matchEmail = from.match(emailRegex);
  if (matchEmail) {
    recruiter_email = matchEmail[1];
  } else if (from.includes('@')) {
    recruiter_email = from.trim();
  }
  
  return {
    detected,
    category,
    status,
    company: company !== 'Unknown' ? company : 'Company Portal',
    role,
    source,
    recruiter_email,
    email_subject: subject,
    confidence_score: score
  };
}

// Mock Inbox Emails to Scan
const MOCK_INBOX_EMAILS = [
  {
    from: "Stripe Recruiting <recruiting@stripe.com>",
    subject: "ApplyTrack App: Invitation to Interview - Product Designer",
    body: "Hi Job Seeker, we reviewed your profile and want to invite you to schedule a call for our Product Designer position. Please click here to schedule a phone screen on Calendly.",
    date: new Date(Date.now() - 3600000).toISOString() // 1 hour ago
  },
  {
    from: "Google Careers <careers@google.com>",
    subject: "Offer Letter: UX Engineer at Google",
    body: "Dear Job Seeker, we are pleased to offer you employment as a UX Engineer at Google! Please view your contract and salary package attached.",
    date: new Date(Date.now() - 7200000).toISOString() // 2 hours ago
  },
  {
    from: "Ashby Recruiting <no-reply@ashbyhq.com>",
    subject: "Netflix Application Update - Product Manager",
    body: "Hi Job Seeker, thank you for applying to the Product Manager role. Unfortunately, we decided to move forward with other candidates who more closely fit our needs. We appreciate your interest in Netflix.",
    date: new Date(Date.now() - 10800000).toISOString() // 3 hours ago
  },
  {
    from: "LinkedIn Jobs <jobs-noreply@linkedin.com>",
    subject: "Your application to Figma was received",
    body: "Figma has received your application for Senior Designer. We will review your resume and experience and reach out shortly.",
    date: new Date(Date.now() - 14400000).toISOString() // 4 hours ago
  },
  {
    from: "Lever System <lever-system@lever.co>",
    subject: "Airbnb Application Confirmation - Frontend Engineer",
    body: "Thank you for submitting your resume for Frontend Engineer at Airbnb. We have received your application and will follow up with next steps.",
    date: new Date(Date.now() - 18000000).toISOString() // 5 hours ago
  },
  {
    from: "Wellfound Support <recruiter@wellfound.com>",
    subject: "Dropbox: Invitation to Complete Coding Assessment",
    body: "Please click the link below to complete the technical assessment and coding test on HackerRank for the Software Engineer position at Dropbox.",
    date: new Date(Date.now() - 21600000).toISOString() // 6 hours ago
  },
  {
    from: "TLDR Web Dev <newsletter@tldr.tech>",
    subject: "TLDR Web Dev: React 19 released!",
    body: "React 19 is now stable. Learn about the new features like server components, actions, and more. This is your daily dev newsletter digest.",
    date: new Date(Date.now() - 25200000).toISOString() // 7 hours ago
  },
  {
    from: "Netflix Streaming <netflix-noreply@netflix.com>",
    subject: "New Arrival: Stranger Things Season 5 Trailer!",
    body: "Stranger Things Season 5 official trailer is here. Watch it now on Netflix. Don't miss your favorite characters return this summer.",
    date: new Date(Date.now() - 28800000).toISOString() // 8 hours ago
  }
];

// Visual Sync Log Modal
function openSyncLogModal(scanLogs) {
  // Remove existing modal if any
  document.getElementById('sync-log-modal')?.remove();
  
  // Calculate summary counts
  const totalScanned = scanLogs.length;
  const detected = scanLogs.filter(l => l.detected).length;
  const ignored = scanLogs.filter(l => !l.detected).length;
  
  // Count merges/updates vs additions
  const updates = scanLogs.filter(l => l.detected && l.action === 'update').length;
  const additions = scanLogs.filter(l => l.detected && l.action === 'new').length;
  
  const modal = document.createElement('div');
  modal.id = 'sync-log-modal';
  modal.className = 'modal-overlay';
  
  modal.innerHTML = `
    <div class="modal-container">
      <div class="modal-header">
        <div class="modal-title-row">
          <i class="fas fa-microchip"></i>
          <div class="modal-title-text">
            <h3>Detection Engine Pipeline Log</h3>
            <p>Heuristic scan results matching job-related email confirmations.</p>
          </div>
        </div>
        <button class="btn-close-modal" id="btn-close-sync-modal"><i class="fas fa-times"></i></button>
      </div>
      
      <div class="modal-body">
        <!-- Pipeline Summary Stats -->
        <div class="pipeline-stats-row">
          <div class="pipeline-stat-box">
            <span class="pipeline-stat-val">${totalScanned}</span>
            <span class="pipeline-stat-lbl">Scanned</span>
          </div>
          <div class="pipeline-stat-box" style="border-left: 3px solid var(--color-success);">
            <span class="pipeline-stat-val" style="color: var(--color-success);">${additions}</span>
            <span class="pipeline-stat-lbl">Added</span>
          </div>
          <div class="pipeline-stat-box" style="border-left: 3px solid var(--color-secondary);">
            <span class="pipeline-stat-val" style="color: var(--color-secondary);">${updates}</span>
            <span class="pipeline-stat-lbl">Updated</span>
          </div>
          <div class="pipeline-stat-box">
            <span class="pipeline-stat-val" style="color: var(--color-text-secondary);">${ignored}</span>
            <span class="pipeline-stat-lbl">Ignored</span>
          </div>
        </div>
        
        <!-- Filter Tabs -->
        <div class="modal-tabs">
          <button class="modal-tab-btn active" data-filter="all">All (${totalScanned})</button>
          <button class="modal-tab-btn" data-filter="detected">Job Emails (${detected})</button>
          <button class="modal-tab-btn" data-filter="ignored">Ignored (${ignored})</button>
        </div>
        
        <!-- Scanned logs list -->
        <div class="pipeline-log-list" id="pipeline-log-list-container">
          <!-- Rendered dynamically -->
        </div>
      </div>
      
      <div class="modal-footer">
        <button class="btn btn-primary" id="btn-close-sync-modal-ok">Got it</button>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  // Close event listeners
  const closeModal = () => {
    modal.remove();
    // Re-render dashboard to show new/updated cards
    if (window.location.hash === '#/dashboard') {
      renderDashboard();
    } else if (window.location.hash === '#/settings') {
      renderSettings();
    }
  };
  
  document.getElementById('btn-close-sync-modal').addEventListener('click', closeModal);
  document.getElementById('btn-close-sync-modal-ok').addEventListener('click', closeModal);
  
  // Render function for tabs
  const renderLogItems = (filter) => {
    const container = document.getElementById('pipeline-log-list-container');
    if (!container) return;
    
    container.innerHTML = '';
    
    const filteredLogs = scanLogs.filter(log => {
      if (filter === 'detected') return log.detected;
      if (filter === 'ignored') return !log.detected;
      return true;
    });
    
    if (filteredLogs.length === 0) {
      container.innerHTML = `<div style="text-align:center; padding:32px; color:var(--color-text-secondary); font-size:0.9rem;">No email entries matches this filter.</div>`;
      return;
    }
    
    filteredLogs.forEach(log => {
      const item = document.createElement('div');
      item.className = 'pipeline-log-item';
      
      // Action badge
      let badgeHTML = '';
      if (!log.detected) {
        badgeHTML = `<span class="badge-action ignored">Ignored</span>`;
      } else if (log.action === 'new') {
        badgeHTML = `<span class="badge-action new"><i class="fas fa-plus"></i> New</span>`;
      } else {
        badgeHTML = `<span class="badge-action update"><i class="fas fa-exchange-alt"></i> Merge</span>`;
      }
      
      // Confidence color
      let confColorClass = 'low';
      if (log.confidence_score >= 80) confColorClass = 'high';
      else if (log.confidence_score >= 50) confColorClass = 'medium';
      
      // Extracted text
      let detailsHTML = '';
      if (log.detected) {
        let actionDesc = '';
        if (log.action === 'new') {
          actionDesc = `Added to <strong>${log.status.toUpperCase()}</strong> column`;
        } else {
          actionDesc = log.actionDetails || `Merged duplicate match`;
        }
        
        detailsHTML = `
          <div class="pipeline-log-details">
            <span class="extracted-entity">
              Extracted: <strong>${log.company}</strong> &bull; <em>${log.role}</em> (${log.source})
              <div style="font-size: 0.75rem; color: var(--color-text-secondary); margin-top: 4px;">
                ${actionDesc}
              </div>
            </span>
            <div class="confidence-indicator">
              <span>${log.confidence_score}% Match</span>
              <div class="confidence-bar-bg">
                <div class="confidence-bar-fill ${confColorClass}" style="width: ${log.confidence_score}%;"></div>
              </div>
            </div>
          </div>
        `;
      } else {
        detailsHTML = `
          <div class="pipeline-log-details">
            <span class="extracted-entity" style="color: var(--color-text-secondary); font-style: italic;">
              Privacy Filter: Non-job related correspondence. Content scanning skipped.
            </span>
            <div class="confidence-indicator">
              <span>${log.confidence_score}% Match</span>
              <div class="confidence-bar-bg">
                <div class="confidence-bar-fill ${confColorClass}" style="width: ${log.confidence_score}%;"></div>
              </div>
            </div>
          </div>
        `;
      }
      
      item.innerHTML = `
        <div class="pipeline-log-header">
          <div class="email-meta-info">
            <div class="email-subject-line">
              <i class="far fa-envelope" style="color: var(--color-text-secondary);"></i> 
              ${log.email_subject}
            </div>
            <div class="email-address-lbl">
              From: ${log.from}
            </div>
          </div>
          <div class="log-action-badges">
            ${badgeHTML}
            ${log.detected ? `<span class="badge-status ${log.status}">${log.category}</span>` : ''}
          </div>
        </div>
        ${detailsHTML}
      `;
      container.appendChild(item);
    });
  };
  
  // Initial render
  renderLogItems('all');
  
  // Tabs click listeners
  const tabBtns = modal.querySelectorAll('.modal-tab-btn');
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      tabBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderLogItems(btn.getAttribute('data-filter'));
    });
  });
}

// 6. DASHBOARD PAGE
// Dashboard state management variables
let dashboardSearchQuery = "";
let dashboardStatusFilter = "all";
let dashboardActiveView = "table";
let kanbanActiveColumn = "applied";
let dashboardFilterOpen = false;
let dashboardFilterStatuses = [];
let dashboardFilterRoles = [];
let dashboardFilterLocationTypes = [];
let dashboardFilterPlatforms = [];
let dashboardFilterDateApplied = "all";
let dashboardFilterSalaryMin = "";
let dashboardFilterSalaryMax = "";
let dashboardSortBy = "recent";
let dashboardHasInterviewsThisWeek = false;

// Calendar state management variables
let calendarActiveView = "month";
let calendarSelectedDate = new Date();

// Notifications state management variables
let notificationsFilter = "unread"; // 'unread', 'read', 'archived'
let notificationsList = [];

async function updateMenuNotificationBadges() {
  try {
    const list = await fetchNotifications();
    const unread = list.filter(n => n.status === 'unread').length;
    
    const sidebarCount = document.getElementById('sidebar-unread-count');
    const mobileCount = document.getElementById('mobile-unread-count');
    
    if (sidebarCount) {
      if (unread > 0) {
        sidebarCount.textContent = unread;
        sidebarCount.style.display = 'inline-block';
      } else {
        sidebarCount.style.display = 'none';
      }
    }
    
    if (mobileCount) {
      if (unread > 0) {
        mobileCount.textContent = unread;
        mobileCount.style.display = 'inline-block';
      } else {
        mobileCount.style.display = 'none';
      }
    }
  } catch (err) {
    console.error("Failed to update notification badges:", err);
  }
}

async function runSmartAlertsEngine() {
  try {
    const [jobs, notices] = await Promise.all([
      fetchJobs(),
      fetchNotifications()
    ]);
    
    let generatedAny = false;
    const now = new Date();
    
    for (const job of jobs) {
      // 1. Submit > 14 days with no response
      if (job.status === 'applied') {
        const jDate = parseJobDate(job);
        const diffMs = now - jDate;
        const diffDays = Math.floor(diffMs / (24 * 3600 * 1000));
        
        if (diffDays >= 14) {
          const exists = notices.some(n => String(n.job_id) === String(job.id) && n.title.includes("Follow-Up Recommended"));
          if (!exists) {
            await addNotification(
              `${job.company} Follow-Up Recommended`,
              `Application submitted ${diffDays} days ago with no response. We recommend sending a follow-up email to their hiring team.`,
              "Reminder Due",
              job.id
            );
            generatedAny = true;
          }
        }
      }
      
      // 2. Follow-up scheduler is due and status is 'pending'
      if (job.follow_up_status === 'pending' && job.follow_up_date) {
        const fDate = new Date(job.follow_up_date);
        const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const fMidnight = new Date(fDate.getFullYear(), fDate.getMonth(), fDate.getDate());
        
        if (fMidnight <= todayMidnight) {
          const exists = notices.some(n => String(n.job_id) === String(job.id) && n.title.includes("Follow-Up Reminder") && n.status === 'unread');
          if (!exists) {
            await addNotification(
              `${job.company} Follow-Up Reminder`,
              `Your scheduled follow-up outreach for the ${job.role} role at ${job.company} is due today.`,
              "Reminder Due",
              job.id
            );
            generatedAny = true;
          }
        }
      }
    }
    
    if (generatedAny) {
      updateMenuNotificationBadges();
    }
  } catch (err) {
    console.error("Smart alerts engine failed:", err);
  }
}

function getAvatarColor(char) {
  const colors = [
    '#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', 
    '#EC4899', '#06B6D4', '#14B8A6', '#84CC16', '#6366F1'
  ];
  const index = char.charCodeAt(0) % colors.length;
  return colors[index];
}

/* ==========================================================================
   MILESTONE 7: ADVANCED SEARCH & FILTERING HELPERS
   ========================================================================== */

function parseJobDate(job) {
  if (!job || !job.date) return new Date();
  
  const d = new Date(job.date);
  if (!isNaN(d.getTime())) return d;
  
  const daysAgoMatch = String(job.date).match(/(\d+)\s+days?\s+ago/i);
  if (daysAgoMatch) {
    const days = parseInt(daysAgoMatch[1], 10);
    return new Date(Date.now() - days * 24 * 3600 * 1000);
  }
  
  const months = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december", "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const lowerDate = String(job.date).toLowerCase();
  for (const month of months) {
    if (lowerDate.includes(month)) {
      const dayMatch = lowerDate.match(/\d+/);
      if (dayMatch) {
        const day = parseInt(dayMatch[0], 10);
        const currentYear = new Date().getFullYear();
        const testD = new Date(`${month} ${day}, ${currentYear}`);
        if (!isNaN(testD.getTime())) return testD;
      }
    }
  }
  
  if (job.activities && job.activities.length > 0) {
    const actDate = new Date(job.activities[0].created_at);
    if (!isNaN(actDate.getTime())) return actDate;
  }
  
  return new Date();
}

function parseSalary(salaryStr) {
  if (!salaryStr) return { min: 0, max: 0 };
  const clean = salaryStr.toLowerCase().replace(/,/g, '');
  const matches = clean.match(/\d+\s*k\b|\d+/g);
  
  if (!matches || matches.length === 0) return { min: 0, max: 0 };
  
  const parseVal = (str) => {
    let val = parseFloat(str);
    if (str.includes('k')) val *= 1000;
    return val;
  };
  
  const values = matches.map(parseVal);
  if (values.length === 1) {
    return { min: values[0], max: values[0] };
  }
  return { min: Math.min(...values), max: Math.max(...values) };
}

function isInterviewThisWeek(intObj) {
  if (!intObj || !intObj.date) return false;
  const intDate = new Date(intObj.date);
  if (isNaN(intDate.getTime())) return false;
  
  const today = new Date();
  const sun = new Date(today);
  sun.setDate(today.getDate() - today.getDay());
  sun.setHours(0, 0, 0, 0);
  
  const sat = new Date(sun);
  sat.setDate(sun.getDate() + 6);
  sat.setHours(23, 59, 59, 999);
  return intDate >= sun && intDate <= sat;
}

async function renderDashboard() {
  const root = getAppViewRoot();
  
  root.innerHTML = `
    <div style="display:flex; justify-content:center; align-items:center; min-height:400px; flex-direction:column; gap:16px;">
      <i class="fas fa-spinner fa-spin" style="font-size:2rem; color:var(--color-secondary);"></i>
      <p style="color:var(--color-text-secondary); font-weight:500;">Loading your pipeline...</p>
    </div>
  `;

  try {
    const [mockJobs, interviews] = await Promise.all([
      fetchJobs(),
      fetchInterviews()
    ]);

    let allNotes = [];
    if (!window.USE_MOCK_AUTH) {
      try {
        const { data: notesData } = await supabaseClient.from('job_notes').select('*');
        allNotes = notesData || [];
      } catch (notesErr) {
        console.error("Failed to load notes for search indexing:", notesErr);
      }
    }

    const isError = localStorage.getItem('applytrack_simulate_error') === 'true' || currentProfile?.sync_error;
    const syncState = currentProfile?.gmail_connected && !isError;
    const lastSyncedText = currentProfile?.last_synced ? getRelativeTimeString(currentProfile.last_synced) : 'Never';

    if (mockJobs.length === 0) {
      root.innerHTML = `
        <div class="dashboard-page-container" style="display: flex; align-items: center; justify-content: center; min-height: 70vh;">
          <div class="empty-state-container" style="text-align: center; padding: 48px; max-width: 500px; margin: 0 auto; background-color: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-lg); box-shadow: var(--shadow-md);">
            <div style="background-color: var(--color-secondary-light); color: var(--color-secondary); width: 80px; height: 80px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 2.5rem; margin: 0 auto 24px auto;">
              <i class="fab fa-google"></i>
            </div>
            <h2 style="font-size: 1.5rem; font-weight: 800; color: var(--color-primary); margin-bottom: 12px;">Connect Gmail to start tracking</h2>
            <p style="color: var(--color-text-secondary); margin-bottom: 32px; line-height: 1.5; font-size: 0.95rem;">
              ApplyTrack can organize application confirmations, interview invites, assessments, offers, and rejections automatically from your inbox.
            </p>
            <button id="dashboard-connect-btn" class="btn btn-primary btn-lg" style="width: 100%; display: flex; align-items: center; justify-content: center; gap: 10px;">
              <i class="fab fa-google"></i> Connect Gmail Account
            </button>
          </div>
        </div>
      `;
      
      document.getElementById('dashboard-connect-btn')?.addEventListener('click', async () => {
        await simulateGmailConnect();
      });
      return;
    }

    // Dynamic stats mapping
    const totalCount = mockJobs.length;
    const appliedCount = mockJobs.filter(j => j.status === 'applied').length;
    const interviewCount = mockJobs.filter(j => j.status === 'interview').length;
    const assessmentCount = mockJobs.filter(j => j.status === 'assessment').length;
    const offerCount = mockJobs.filter(j => j.status === 'offer').length;
    const rejectedCount = mockJobs.filter(j => j.status === 'rejected').length;

    // Dynamically fetch unique platforms and roles
    const uniquePlatforms = [...new Set(mockJobs.map(j => j.source).filter(Boolean))];
    const uniqueRoles = [...new Set(mockJobs.map(j => j.role).filter(Boolean))];

    root.innerHTML = `
      <div class="dashboard-page-container">
        
        <!-- Error Alert Banner -->
        ${isError ? `
          <div class="alert-banner danger">
            <div class="alert-banner-content">
              <i class="fas fa-exclamation-triangle" style="font-size: 1.2rem;"></i>
              <span><strong>Gmail Sync Error:</strong> Your Gmail authorization has expired. Reconnect in Settings.</span>
            </div>
            <a href="#/settings" class="btn btn-secondary btn-sm" style="color: var(--color-danger); border-color: rgba(239, 68, 68, 0.3); background-color: #FFFFFF;">
              Reconnect Gmail
            </a>
          </div>
        ` : ''}

        <!-- Metrics cards row -->
        <div class="dashboard-stats-5">
          <div class="stat-card" style="border-bottom: 3px solid var(--color-secondary);">
            <div class="stat-icon total"><i class="fas fa-briefcase"></i></div>
            <div class="stat-info">
              <span class="stat-num">${appliedCount}</span>
              <span class="stat-label">Applied</span>
            </div>
          </div>
          <div class="stat-card" style="border-bottom: 3px solid var(--color-warning);">
            <div class="stat-icon assessment"><i class="fas fa-file-code"></i></div>
            <div class="stat-info">
              <span class="stat-num">${assessmentCount}</span>
              <span class="stat-label">Assessment</span>
            </div>
          </div>
          <div class="stat-card" style="border-bottom: 3px solid #8B5CF6;">
            <div class="stat-icon interviews"><i class="fas fa-video"></i></div>
            <div class="stat-info">
              <span class="stat-num">${interviewCount}</span>
              <span class="stat-label">Interview</span>
            </div>
          </div>
          <div class="stat-card" style="border-bottom: 3px solid var(--color-success);">
            <div class="stat-icon offers"><i class="fas fa-trophy"></i></div>
            <div class="stat-info">
              <span class="stat-num">${offerCount}</span>
              <span class="stat-label">Offer</span>
            </div>
          </div>
          <div class="stat-card" style="border-bottom: 3px solid var(--color-danger);">
            <div class="stat-icon rejections"><i class="fas fa-times-circle"></i></div>
            <div class="stat-info">
              <span class="stat-num">${rejectedCount}</span>
              <span class="stat-label">Rejections</span>
            </div>
          </div>
        </div>

        <!-- Dashboard Control Bar -->
        <div class="dashboard-controls-row">
          <div class="search-wrapper">
            <i class="fas fa-search"></i>
            <input type="text" id="dashboard-search" class="search-input" placeholder="Search by Company, Role, Recruiter or Notes..." value="${dashboardSearchQuery}">
          </div>
          
          <div style="display: flex; gap: 16px; align-items: center; flex-wrap: wrap;">
            <div class="filter-pills-row">
              <button class="filter-pill ${dashboardStatusFilter === 'all' ? 'active' : ''}" data-filter="all">All (${totalCount})</button>
              <button class="filter-pill ${dashboardStatusFilter === 'applied' ? 'active' : ''}" data-filter="applied">Applied (${appliedCount})</button>
              <button class="filter-pill ${dashboardStatusFilter === 'assessment' ? 'active' : ''}" data-filter="assessment">Assessment (${assessmentCount})</button>
              <button class="filter-pill ${dashboardStatusFilter === 'interview' ? 'active' : ''}" data-filter="interview">Interview (${interviewCount})</button>
              <button class="filter-pill ${dashboardStatusFilter === 'offer' ? 'active' : ''}" data-filter="offer">Offer (${offerCount})</button>
              <button class="filter-pill ${dashboardStatusFilter === 'rejected' ? 'active' : ''}" data-filter="rejected">Rejected (${rejectedCount})</button>
            </div>
            
            <button id="toggle-filters-btn" class="btn-filters-toggle ${dashboardFilterOpen ? 'active' : ''}">
              <i class="fas fa-sliders-h"></i> Filters
            </button>

            <div class="view-toggle-container">
              <button class="view-toggle-btn ${dashboardActiveView === 'table' ? 'active' : ''}" data-view="table" title="Table View">
                <i class="fas fa-list"></i> Table
              </button>
              <button class="view-toggle-btn ${dashboardActiveView === 'board' ? 'active' : ''}" data-view="board" title="Kanban Board View">
                <i class="fas fa-columns"></i> Board
              </button>
            </div>
          </div>
        </div>

        <!-- Expandable Advanced Filters Drawer -->
        <div class="advanced-filters-panel ${dashboardFilterOpen ? 'open' : ''}" id="advanced-filters-section">
          <div class="filters-grid">
            
            <!-- Job Title Roles Checkboxes -->
            <div class="filter-column">
              <div class="filter-column-title">Job Title</div>
              <div class="filter-options-list" style="max-height: 150px; overflow-y: auto;">
                ${uniqueRoles.map(role => `
                  <label class="filter-checkbox-label">
                    <input type="checkbox" value="${role}" class="filter-role" ${dashboardFilterRoles.includes(role) ? 'checked' : ''}> ${role}
                  </label>
                `).join('') || '<span style="color:var(--color-text-secondary); font-size:0.8rem; font-style:italic;">No roles found</span>'}
              </div>
            </div>

            <!-- Status Checkboxes -->
            <div class="filter-column">
              <div class="filter-column-title">Status</div>
              <div class="filter-options-list">
                <label class="filter-checkbox-label">
                  <input type="checkbox" value="applied" class="filter-status" ${dashboardFilterStatuses.includes('applied') ? 'checked' : ''}> Applied
                </label>
                <label class="filter-checkbox-label">
                  <input type="checkbox" value="assessment" class="filter-status" ${dashboardFilterStatuses.includes('assessment') ? 'checked' : ''}> Assessment
                </label>
                <label class="filter-checkbox-label">
                  <input type="checkbox" value="interview" class="filter-status" ${dashboardFilterStatuses.includes('interview') ? 'checked' : ''}> Interview
                </label>
                <label class="filter-checkbox-label">
                  <input type="checkbox" value="offer" class="filter-status" ${dashboardFilterStatuses.includes('offer') ? 'checked' : ''}> Offer
                </label>
                <label class="filter-checkbox-label">
                  <input type="checkbox" value="rejected" class="filter-status" ${dashboardFilterStatuses.includes('rejected') ? 'checked' : ''}> Rejected
                </label>
              </div>
            </div>
            
            <!-- Work Style -->
            <div class="filter-column">
              <div class="filter-column-title">Work Style</div>
              <div class="filter-options-list">
                <label class="filter-checkbox-label">
                  <input type="checkbox" value="remote" class="filter-loc-type" ${dashboardFilterLocationTypes.includes('remote') ? 'checked' : ''}> Remote
                </label>
                <label class="filter-checkbox-label">
                  <input type="checkbox" value="hybrid" class="filter-loc-type" ${dashboardFilterLocationTypes.includes('hybrid') ? 'checked' : ''}> Hybrid
                </label>
                <label class="filter-checkbox-label">
                  <input type="checkbox" value="onsite" class="filter-loc-type" ${dashboardFilterLocationTypes.includes('onsite') ? 'checked' : ''}> On-site
                </label>
              </div>
            </div>
            
            <!-- Source Platforms -->
            <div class="filter-column">
              <div class="filter-column-title">Source Platform</div>
              <div class="filter-options-list" id="filter-platforms-list">
                ${uniquePlatforms.map(platform => `
                  <label class="filter-checkbox-label">
                    <input type="checkbox" value="${platform}" class="filter-platform" ${dashboardFilterPlatforms.includes(platform) ? 'checked' : ''}> ${platform}
                  </label>
                `).join('') || '<span style="color:var(--color-text-secondary); font-size:0.8rem; font-style:italic;">No platforms found</span>'}
              </div>
            </div>
            
            <!-- Date Applied -->
            <div class="filter-column">
              <div class="filter-column-title">Date Applied</div>
              <select id="filter-date-applied" class="salary-select-input">
                <option value="all" ${dashboardFilterDateApplied === 'all' ? 'selected' : ''}>Anytime</option>
                <option value="today" ${dashboardFilterDateApplied === 'today' ? 'selected' : ''}>Today</option>
                <option value="week" ${dashboardFilterDateApplied === 'week' ? 'selected' : ''}>Past 7 days</option>
                <option value="month" ${dashboardFilterDateApplied === 'month' ? 'selected' : ''}>Past 30 days</option>
                <option value="older" ${dashboardFilterDateApplied === 'older' ? 'selected' : ''}>Older than 30 days</option>
              </select>
            </div>
            
            <!-- Salary Target -->
            <div class="filter-column">
              <div class="filter-column-title">Min/Max Salary</div>
              <div class="salary-inputs-row">
                <select id="filter-salary-min" class="salary-select-input">
                  <option value="">Min ($)</option>
                  <option value="80000" ${dashboardFilterSalaryMin === '80000' ? 'selected' : ''}>$80k</option>
                  <option value="100000" ${dashboardFilterSalaryMin === '100000' ? 'selected' : ''}>$100k</option>
                  <option value="120000" ${dashboardFilterSalaryMin === '120000' ? 'selected' : ''}>$120k</option>
                  <option value="140000" ${dashboardFilterSalaryMin === '140000' ? 'selected' : ''}>$140k</option>
                  <option value="160000" ${dashboardFilterSalaryMin === '160000' ? 'selected' : ''}>$160k</option>
                  <option value="180000" ${dashboardFilterSalaryMin === '180000' ? 'selected' : ''}>$180k</option>
                </select>
                <select id="filter-salary-max" class="salary-select-input">
                  <option value="">Max ($)</option>
                  <option value="100000" ${dashboardFilterSalaryMax === '100000' ? 'selected' : ''}>$100k</option>
                  <option value="120000" ${dashboardFilterSalaryMax === '120000' ? 'selected' : ''}>$120k</option>
                  <option value="140000" ${dashboardFilterSalaryMax === '140000' ? 'selected' : ''}>$140k</option>
                  <option value="160000" ${dashboardFilterSalaryMax === '160000' ? 'selected' : ''}>$160k</option>
                  <option value="180000" ${dashboardFilterSalaryMax === '180000' ? 'selected' : ''}>$180k</option>
                  <option value="220000" ${dashboardFilterSalaryMax === '220000' ? 'selected' : ''}>$220k+</option>
                </select>
              </div>
            </div>

            <!-- Sort By selection -->
            <div class="filter-column">
              <div class="filter-column-title">Sort By</div>
              <select id="filter-sort-by" class="salary-select-input">
                <option value="recent" ${dashboardSortBy === 'recent' ? 'selected' : ''}>Most Recent</option>
                <option value="oldest" ${dashboardSortBy === 'oldest' ? 'selected' : ''}>Oldest</option>
                <option value="salary" ${dashboardSortBy === 'salary' ? 'selected' : ''}>Highest Salary</option>
                <option value="interview" ${dashboardSortBy === 'interview' ? 'selected' : ''}>Interview Stage</option>
                <option value="offer" ${dashboardSortBy === 'offer' ? 'selected' : ''}>Offer Stage</option>
              </select>
            </div>
            
          </div>
          
          <div style="display:flex; justify-content:flex-end; gap:12px; border-top:1px solid var(--color-border); padding-top:16px;">
            <button id="btn-clear-all-filters" class="btn btn-outline btn-sm" style="color:var(--color-danger); border-color:transparent;">
              Clear All Filters
            </button>
          </div>
        </div>

        <!-- Primary View Target Mount Area -->
        <div id="dashboard-view-target"></div>
      </div>
    `;

    const filterAndRender = () => {
      let filtered = [...mockJobs];
      
      // 1. Status Quick Filter
      if (dashboardStatusFilter !== 'all') {
        filtered = filtered.filter(j => j.status === dashboardStatusFilter);
      }
      
      // 2. Status Advanced Checkbox Filter
      if (dashboardFilterStatuses.length > 0) {
        filtered = filtered.filter(j => dashboardFilterStatuses.includes(j.status));
      }

      // 2b. Role Advanced Checkbox Filter
      if (dashboardFilterRoles.length > 0) {
        filtered = filtered.filter(j => j.role && dashboardFilterRoles.includes(j.role));
      }
      
      // 3. Global Multi-field Search
      if (dashboardSearchQuery) {
        const query = dashboardSearchQuery.toLowerCase().trim();
        filtered = filtered.filter(j => {
          const matchCompany = j.company && j.company.toLowerCase().includes(query);
          const matchRole = j.role && j.role.toLowerCase().includes(query);
          const matchRecruiterEmail = j.recruiter_email && j.recruiter_email.toLowerCase().includes(query);
          const matchRecruiterName = j.recruiter_name && j.recruiter_name.toLowerCase().includes(query);
          
          let matchNotes = false;
          if (window.USE_MOCK_AUTH) {
            matchNotes = (j.notes || []).some(n => n.content && n.content.toLowerCase().includes(query));
          } else {
            matchNotes = allNotes.some(n => String(n.job_id) === String(j.id) && n.content && n.content.toLowerCase().includes(query));
          }
          
          return matchCompany || matchRole || matchRecruiterEmail || matchRecruiterName || matchNotes;
        });
      }

      // 4. Date Applied Filters
      if (dashboardFilterDateApplied !== 'all') {
        const now = new Date();
        filtered = filtered.filter(j => {
          const jDate = parseJobDate(j);
          const diffMs = now - jDate;
          const diffDays = Math.floor(diffMs / (24 * 3600 * 1000));
          
          if (dashboardFilterDateApplied === 'today') return diffDays <= 0;
          if (dashboardFilterDateApplied === 'week') return diffDays <= 7;
          if (dashboardFilterDateApplied === 'month') return diffDays <= 30;
          if (dashboardFilterDateApplied === 'older') return diffDays > 30;
          if (dashboardFilterDateApplied === 'older_7_days') return diffDays > 7;
          return true;
        });
      }

      // 5. Work Style Locations Filter
      if (dashboardFilterLocationTypes.length > 0) {
        filtered = filtered.filter(j => {
          if (!j.location) return false;
          const locLower = j.location.toLowerCase();
          const isRemote = locLower.includes('remote');
          const isHybrid = locLower.includes('hybrid');
          const isOnsite = locLower.includes('on-site') || locLower.includes('onsite') || (!isRemote && !isHybrid);
          
          const types = [];
          if (isRemote) types.push('remote');
          if (isHybrid) types.push('hybrid');
          if (isOnsite) types.push('onsite');
          
          return dashboardFilterLocationTypes.some(type => types.includes(type));
        });
      }

      // 6. Source Platforms Filter
      if (dashboardFilterPlatforms.length > 0) {
        filtered = filtered.filter(j => j.source && dashboardFilterPlatforms.includes(j.source));
      }

      // 7. Salary Filters
      if (dashboardFilterSalaryMin) {
        const minVal = parseInt(dashboardFilterSalaryMin, 10);
        filtered = filtered.filter(j => {
          const salary = parseSalary(j.salary_range);
          return salary.max >= minVal || salary.min >= minVal;
        });
      }
      
      if (dashboardFilterSalaryMax) {
        const maxVal = parseInt(dashboardFilterSalaryMax, 10);
        filtered = filtered.filter(j => {
          const salary = parseSalary(j.salary_range);
          return salary.min <= maxVal || salary.max <= maxVal;
        });
      }

      // 8. Custom views interviews check
      if (dashboardHasInterviewsThisWeek) {
        const weekJobIds = interviews.filter(isInterviewThisWeek).map(i => String(i.job_id));
        filtered = filtered.filter(j => weekJobIds.includes(String(j.id)));
      }

      // 9. Sorting Options
      if (dashboardSortBy) {
        filtered.sort((a, b) => {
          if (dashboardSortBy === 'recent') {
            return parseJobDate(b) - parseJobDate(a);
          }
          if (dashboardSortBy === 'oldest') {
            return parseJobDate(a) - parseJobDate(b);
          }
          if (dashboardSortBy === 'salary') {
            const salA = parseSalary(a.salary_range).max;
            const salB = parseSalary(b.salary_range).max;
            return salB - salA;
          }
          if (dashboardSortBy === 'interview') {
            const weightA = a.status === 'interview' ? 1 : 0;
            const weightB = b.status === 'interview' ? 1 : 0;
            if (weightB !== weightA) return weightB - weightA;
            return parseJobDate(b) - parseJobDate(a);
          }
          if (dashboardSortBy === 'offer') {
            const weightA = a.status === 'offer' ? 1 : 0;
            const weightB = b.status === 'offer' ? 1 : 0;
            if (weightB !== weightA) return weightB - weightA;
            return parseJobDate(b) - parseJobDate(a);
          }
          return 0;
        });
      }

      const viewContainer = document.getElementById('dashboard-view-target');
      if (!viewContainer) return;
      
      if (dashboardActiveView === 'table') {
        viewContainer.innerHTML = `
          <div class="table-responsive-container">
            <div class="app-table-container">
              <table class="app-table">
                <thead>
                  <tr>
                    <th>Company</th>
                    <th>Role</th>
                    <th>Status</th>
                    <th>Source</th>
                    <th>Date Applied</th>
                    <th>Last Updated</th>
                  </tr>
                </thead>
                <tbody id="table-body-target"></tbody>
              </table>
            </div>
          </div>
        `;
        
        const tbody = document.getElementById('table-body-target');
        if (filtered.length === 0) {
          tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:48px; color:var(--color-text-secondary);">No matching applications found.</td></tr>`;
          return;
        }
        
        filtered.forEach(job => {
          const initial = job.company ? job.company.charAt(0).toUpperCase() : 'A';
          const avatarColor = getAvatarColor(initial);
          
          let displayAppliedDate = 'N/A';
          if (job.date) {
            if (job.date.includes('-')) {
              const dateObj = new Date(job.date);
              if (!isNaN(dateObj)) {
                displayAppliedDate = dateObj.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
              }
            } else {
              displayAppliedDate = job.date;
            }
          }

          let displayUpdatedDate = 'Just now';
          if (job.updated_at) {
            displayUpdatedDate = getRelativeTimeString(job.updated_at);
          }

          const tr = document.createElement('tr');
          tr.style.cursor = 'pointer';
          tr.addEventListener('click', () => {
            navigate('#/application/' + job.id);
          });

          tr.innerHTML = `
            <td>
              <div style="display: flex; align-items: center; gap: 12px;">
                <div class="company-avatar" style="background-color: ${avatarColor}20; color: ${avatarColor};">
                  ${initial}
                </div>
                <strong>${job.company}</strong>
              </div>
            </td>
            <td>${job.role}</td>
            <td><span class="badge-status ${job.status}">${job.status.charAt(0).toUpperCase() + job.status.slice(1)}</span></td>
            <td>${job.source}</td>
            <td>${displayAppliedDate}</td>
            <td class="relative-time-field" data-time="${job.updated_at}">${displayUpdatedDate}</td>
          `;
          tbody.appendChild(tr);
        });
      } else {
        const colAppliedCount = filtered.filter(j => j.status === 'applied').length;
        const colAssessmentCount = filtered.filter(j => j.status === 'assessment').length;
        const colInterviewCount = filtered.filter(j => j.status === 'interview').length;
        const colOfferCount = filtered.filter(j => j.status === 'offer').length;
        const colRejectedCount = filtered.filter(j => j.status === 'rejected').length;

        viewContainer.innerHTML = `
          <!-- Kanban column switcher tabs on mobile -->
          <div class="mobile-kanban-tabs">
            <button class="mobile-kanban-tab-btn ${kanbanActiveColumn === 'applied' ? 'active' : ''}" data-col="applied">Applied (${colAppliedCount})</button>
            <button class="mobile-kanban-tab-btn ${kanbanActiveColumn === 'assessment' ? 'active' : ''}" data-col="assessment">Assessment (${colAssessmentCount})</button>
            <button class="mobile-kanban-tab-btn ${kanbanActiveColumn === 'interview' ? 'active' : ''}" data-col="interview">Interview (${colInterviewCount})</button>
            <button class="mobile-kanban-tab-btn ${kanbanActiveColumn === 'offer' ? 'active' : ''}" data-col="offer">Offer (${colOfferCount})</button>
            <button class="mobile-kanban-tab-btn ${kanbanActiveColumn === 'rejected' ? 'active' : ''}" data-col="rejected">Rejected (${colRejectedCount})</button>
          </div>

          <div class="kanban-board">
            <div class="kanban-col ${kanbanActiveColumn === 'applied' ? 'mobile-active' : ''}">
              <div class="kanban-col-header" style="border-top-color: var(--color-secondary);">
                <span>Applied</span>
                <span class="kanban-col-count" id="col-applied-count">0</span>
              </div>
              <div class="kanban-cards-list" id="col-applied-list"></div>
            </div>
            
            <div class="kanban-col ${kanbanActiveColumn === 'assessment' ? 'mobile-active' : ''}">
              <div class="kanban-col-header" style="border-top-color: var(--color-warning);">
                <span>Assessment</span>
                <span class="kanban-col-count" id="col-assessment-count">0</span>
              </div>
              <div class="kanban-cards-list" id="col-assessment-list"></div>
            </div>
            
            <div class="kanban-col ${kanbanActiveColumn === 'interview' ? 'mobile-active' : ''}">
              <div class="kanban-col-header" style="border-top-color: #8B5CF6;">
                <span>Interviewing</span>
                <span class="kanban-col-count" id="col-interview-count">0</span>
              </div>
              <div class="kanban-cards-list" id="col-interview-list"></div>
            </div>
            
            <div class="kanban-col ${kanbanActiveColumn === 'offer' ? 'mobile-active' : ''}">
              <div class="kanban-col-header" style="border-top-color: var(--color-success);">
                <span>Offer</span>
                <span class="kanban-col-count" id="col-offer-count">0</span>
              </div>
              <div class="kanban-cards-list" id="col-offer-list"></div>
            </div>
            
            <div class="kanban-col ${kanbanActiveColumn === 'rejected' ? 'mobile-active' : ''}">
              <div class="kanban-col-header" style="border-top-color: var(--color-danger);">
                <span>Rejected</span>
                <span class="kanban-col-count" id="col-rejected-count">0</span>
              </div>
              <div class="kanban-cards-list" id="col-rejected-list"></div>
            </div>
          </div>
        `;
        
        document.getElementById('col-applied-count').textContent = colAppliedCount;
        document.getElementById('col-assessment-count').textContent = colAssessmentCount;
        document.getElementById('col-interview-count').textContent = colInterviewCount;
        document.getElementById('col-offer-count').textContent = colOfferCount;
        document.getElementById('col-rejected-count').textContent = colRejectedCount;
        
        const lists = {
          applied: document.getElementById('col-applied-list'),
          assessment: document.getElementById('col-assessment-list'),
          interview: document.getElementById('col-interview-list'),
          offer: document.getElementById('col-offer-list'),
          rejected: document.getElementById('col-rejected-list')
        };
        
        filtered.forEach(job => {
          const listEl = lists[job.status];
          if (listEl) {
            const card = document.createElement('div');
            card.className = 'kanban-card';
            card.style.cursor = 'pointer';
            card.addEventListener('click', () => navigate('#/application/' + job.id));
            
            card.innerHTML = `
              <div class="kanban-company">${job.company}</div>
              <div class="kanban-role">${job.role}</div>
              <div class="kanban-meta">${job.source}</div>
            `;
            listEl.appendChild(card);
          }
        });
        
        Object.keys(lists).forEach(status => {
          const listEl = lists[status];
          if (listEl && listEl.children.length === 0) {
            listEl.innerHTML = `
              <div class="empty-col-message">
                No matches.
              </div>
            `;
          }
        });

        // Toggle mobile Kanban column tab selectors
        viewContainer.querySelectorAll('.mobile-kanban-tab-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            kanbanActiveColumn = btn.getAttribute('data-col');
            filterAndRender();
          });
        });
      }
    };
    
    filterAndRender();

    // Event Bindings
    const searchInput = document.getElementById('dashboard-search');
    searchInput?.addEventListener('input', (e) => {
      dashboardSearchQuery = e.target.value.toLowerCase();
      filterAndRender();
    });
    
    document.querySelectorAll('.filter-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        document.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        dashboardStatusFilter = pill.getAttribute('data-filter');
        filterAndRender();
      });
    });
    
    document.querySelectorAll('.view-toggle-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.view-toggle-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        dashboardActiveView = btn.getAttribute('data-view');
        filterAndRender();
      });
    });

    // Toggle advanced filters panel drawer
    document.getElementById('toggle-filters-btn')?.addEventListener('click', () => {
      const btn = document.getElementById('toggle-filters-btn');
      const panel = document.getElementById('advanced-filters-section');
      dashboardFilterOpen = !dashboardFilterOpen;
      if (dashboardFilterOpen) {
        btn.classList.add('active');
        panel.classList.add('open');
      } else {
        btn.classList.remove('active');
        panel.classList.remove('open');
      }
    });

    // Advanced checkbox Roles
    document.querySelectorAll('.filter-role').forEach(cb => {
      cb.addEventListener('change', () => {
        const val = cb.value;
        if (cb.checked) {
          if (!dashboardFilterRoles.includes(val)) dashboardFilterRoles.push(val);
        } else {
          dashboardFilterRoles = dashboardFilterRoles.filter(v => v !== val);
        }
        filterAndRender();
      });
    });

    // Advanced checkbox Statuses
    document.querySelectorAll('.filter-status').forEach(cb => {
      cb.addEventListener('change', () => {
        const val = cb.value;
        if (cb.checked) {
          if (!dashboardFilterStatuses.includes(val)) dashboardFilterStatuses.push(val);
        } else {
          dashboardFilterStatuses = dashboardFilterStatuses.filter(v => v !== val);
        }
        filterAndRender();
      });
    });

    // Advanced checkbox Location types
    document.querySelectorAll('.filter-loc-type').forEach(cb => {
      cb.addEventListener('change', () => {
        const val = cb.value;
        if (cb.checked) {
          if (!dashboardFilterLocationTypes.includes(val)) dashboardFilterLocationTypes.push(val);
        } else {
          dashboardFilterLocationTypes = dashboardFilterLocationTypes.filter(v => v !== val);
        }
        filterAndRender();
      });
    });

    // Advanced checkbox Platforms
    document.querySelectorAll('.filter-platform').forEach(cb => {
      cb.addEventListener('change', () => {
        const val = cb.value;
        if (cb.checked) {
          if (!dashboardFilterPlatforms.includes(val)) dashboardFilterPlatforms.push(val);
        } else {
          dashboardFilterPlatforms = dashboardFilterPlatforms.filter(v => v !== val);
        }
        filterAndRender();
      });
    });

    // Advanced select Date
    document.getElementById('filter-date-applied')?.addEventListener('change', (e) => {
      dashboardFilterDateApplied = e.target.value;
      filterAndRender();
    });

    // Advanced select Salary Min
    document.getElementById('filter-salary-min')?.addEventListener('change', (e) => {
      dashboardFilterSalaryMin = e.target.value;
      filterAndRender();
    });

    // Advanced select Salary Max
    document.getElementById('filter-salary-max')?.addEventListener('change', (e) => {
      dashboardFilterSalaryMax = e.target.value;
      filterAndRender();
    });

    // Advanced select Sort By
    document.getElementById('filter-sort-by')?.addEventListener('change', (e) => {
      dashboardSortBy = e.target.value;
      filterAndRender();
    });

    // Clear all filters action
    document.getElementById('btn-clear-all-filters')?.addEventListener('click', () => {
      dashboardSearchQuery = "";
      dashboardStatusFilter = "all";
      dashboardFilterStatuses = [];
      dashboardFilterRoles = [];
      dashboardFilterLocationTypes = [];
      dashboardFilterPlatforms = [];
      dashboardFilterDateApplied = "all";
      dashboardFilterSalaryMin = "";
      dashboardFilterSalaryMax = "";
      dashboardSortBy = "recent";
      dashboardHasInterviewsThisWeek = false;
      
      if (searchInput) searchInput.value = "";
      
      document.querySelectorAll('.filter-pill').forEach(p => {
        if (p.getAttribute('data-filter') === 'all') p.classList.add('active');
        else p.classList.remove('active');
      });
      
      const dateSelect = document.getElementById('filter-date-applied');
      if (dateSelect) dateSelect.value = "all";
      
      const minSelect = document.getElementById('filter-salary-min');
      if (minSelect) minSelect.value = "";
      const maxSelect = document.getElementById('filter-salary-max');
      if (maxSelect) maxSelect.value = "";
      
      const sortSelect = document.getElementById('filter-sort-by');
      if (sortSelect) sortSelect.value = "recent";
      
      const panel = document.getElementById('advanced-filters-section');
      if (panel) {
        panel.querySelectorAll('.filter-role').forEach(cb => cb.checked = false);
        panel.querySelectorAll('.filter-status').forEach(cb => cb.checked = false);
        panel.querySelectorAll('.filter-loc-type').forEach(cb => cb.checked = false);
        panel.querySelectorAll('.filter-platform').forEach(cb => cb.checked = false);
      }
      
      filterAndRender();
    });

    // Sync button logic
    document.getElementById('sync-inbox-btn')?.addEventListener('click', async () => {
      const syncBtn = document.getElementById('sync-inbox-btn');
      const oldText = syncBtn.innerHTML;
      syncBtn.disabled = true;
      syncBtn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Syncing...`;
      
      const success = await triggerManualSync();
      
      syncBtn.disabled = false;
      syncBtn.innerHTML = oldText;
      
      if (success) {
        renderDashboard();
      }
    });

    startRelativeTimeUpdater();
  } catch (err) {
    console.error("Dashboard render error:", err);
    showToast(err.message, 'error');
  }
}

/* ==========================================================================
   MILESTONE 8: NOTIFICATIONS CENTER CONTROLLER
   ========================================================================== */
async function renderNotifications() {
  const root = getAppViewRoot();
  
  root.innerHTML = `
    <div style="display:flex; justify-content:center; align-items:center; min-height:400px; flex-direction:column; gap:16px;">
      <i class="fas fa-spinner fa-spin" style="font-size:2rem; color:var(--color-secondary);"></i>
      <p style="color:var(--color-text-secondary); font-weight:500;">Loading notifications...</p>
    </div>
  `;

  try {
    const list = await fetchNotifications();
    notificationsList = list;
    
    const unreadCount = list.filter(n => n.status === 'unread').length;
    const readCount = list.filter(n => n.status === 'read').length;
    const archivedCount = list.filter(n => n.status === 'archived').length;

    root.innerHTML = `
      <div class="notification-page-container">
        <div class="notification-header-row">
          <div>
            <h1 class="page-title" style="margin-bottom:4px;">Notification Center</h1>
            <p style="color:var(--color-text-secondary); font-size:0.9rem;">Manage all follow-up updates, reminders, and alerts.</p>
          </div>
          ${notificationsFilter === 'unread' && unreadCount > 0 ? `
            <button id="btn-mark-all-read" class="btn btn-secondary btn-sm" style="display:inline-flex; align-items:center; gap:6px;">
              <i class="fas fa-check-double"></i> Mark All as Read
            </button>
          ` : ''}
        </div>

        <div class="notification-tabs">
          <button class="notification-tab-btn ${notificationsFilter === 'unread' ? 'active' : ''}" data-tab="unread">
            Unread <span class="badge-pill">${unreadCount}</span>
          </button>
          <button class="notification-tab-btn ${notificationsFilter === 'read' ? 'active' : ''}" data-tab="read">
            Read <span class="badge-pill">${readCount}</span>
          </button>
          <button class="notification-tab-btn ${notificationsFilter === 'archived' ? 'active' : ''}" data-tab="archived">
            Archived <span class="badge-pill">${archivedCount}</span>
          </button>
        </div>

        <div class="notification-list" id="notifications-items-target"></div>
      </div>
    `;

    const itemsContainer = document.getElementById('notifications-items-target');
    const filteredNotices = list.filter(n => n.status === notificationsFilter);

    if (filteredNotices.length === 0) {
      itemsContainer.innerHTML = `
        <div style="text-align:center; padding:64px 24px; color:var(--color-text-secondary); background-color:var(--color-surface); border:1px solid var(--color-border); border-radius:var(--radius-lg);">
          <i class="far fa-bell-slash" style="font-size:2.5rem; color:var(--color-text-secondary); opacity:0.5; margin-bottom:16px; display:block;"></i>
          <h3 style="font-weight:600; color:var(--color-text); margin-bottom:4px;">No ${notificationsFilter} notifications</h3>
          <p style="font-size:0.88rem;">We'll alert you when there are updates or recommended follow-ups.</p>
        </div>
      `;
    } else {
      filteredNotices.forEach(notif => {
        let iconClass = 'icon-updated';
        let iconMarkup = '<i class="fas fa-bell"></i>';

        if (notif.type === 'Interview Scheduled') {
          iconClass = 'icon-interview';
          iconMarkup = '<i class="fas fa-calendar-alt"></i>';
        } else if (notif.type === 'Assessment Received') {
          iconClass = 'icon-assessment';
          iconMarkup = '<i class="fas fa-file-code"></i>';
        } else if (notif.type === 'Offer Received') {
          iconClass = 'icon-offer';
          iconMarkup = '<i class="fas fa-trophy"></i>';
        } else if (notif.type === 'Application Updated') {
          iconClass = 'icon-updated';
          iconMarkup = '<i class="fas fa-sync-alt"></i>';
        } else if (notif.type === 'Reminder Due') {
          iconClass = 'icon-reminder';
          iconMarkup = '<i class="fas fa-exclamation-circle"></i>';
        }

        const relativeTime = getRelativeTimeString(notif.created_at);

        const card = document.createElement('div');
        card.className = `notification-item ${notif.status === 'unread' ? 'unread' : ''}`;
        
        let actionButtons = '';
        if (notificationsFilter === 'unread') {
          actionButtons = `
            <button class="notification-action-btn success btn-mark-read" data-id="${notif.id}" title="Mark as Read">
              <i class="fas fa-check"></i>
            </button>
            <button class="notification-action-btn btn-archive" data-id="${notif.id}" title="Archive">
              <i class="fas fa-archive"></i>
            </button>
          `;
        } else if (notificationsFilter === 'read') {
          actionButtons = `
            <button class="notification-action-btn btn-mark-unread" data-id="${notif.id}" title="Mark as Unread">
              <i class="fas fa-envelope"></i>
            </button>
            <button class="notification-action-btn btn-archive" data-id="${notif.id}" title="Archive">
              <i class="fas fa-archive"></i>
            </button>
          `;
        } else if (notificationsFilter === 'archived') {
          actionButtons = `
            <button class="notification-action-btn success btn-unarchive" data-id="${notif.id}" title="Restore to Read">
              <i class="fas fa-undo"></i>
            </button>
            <button class="notification-action-btn danger btn-delete-notif" data-id="${notif.id}" title="Delete Permanently">
              <i class="fas fa-trash-alt"></i>
            </button>
          `;
        }

        card.innerHTML = `
          <div class="notification-icon-wrapper ${iconClass}">
            ${iconMarkup}
          </div>
          <div class="notification-body-content" style="cursor:${notif.job_id ? 'pointer' : 'default'};">
            <div class="notification-title">${notif.title}</div>
            <div class="notification-message">${notif.message}</div>
            <div class="notification-timestamp">
              <i class="far fa-clock"></i> ${relativeTime}
            </div>
          </div>
          <div class="notification-actions-btn-group">
            ${actionButtons}
          </div>
        `;

        if (notif.job_id) {
          card.querySelector('.notification-body-content').addEventListener('click', () => {
            navigate('#/application/' + notif.job_id);
          });
        }

        itemsContainer.appendChild(card);
      });
    }

    // Attach Event Listeners
    document.querySelectorAll('.notification-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        notificationsFilter = btn.getAttribute('data-tab');
        renderNotifications();
      });
    });

    document.getElementById('btn-mark-all-read')?.addEventListener('click', async () => {
      try {
        await markAllNotificationsAsRead();
        showToast("All notifications marked as read", "success");
        await renderNotifications();
        updateMenuNotificationBadges();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });

    document.querySelectorAll('.btn-mark-read').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-id');
        try {
          await updateNotificationStatus(id, 'read');
          await renderNotifications();
          updateMenuNotificationBadges();
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });

    document.querySelectorAll('.btn-mark-unread').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-id');
        try {
          await updateNotificationStatus(id, 'unread');
          await renderNotifications();
          updateMenuNotificationBadges();
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });

    document.querySelectorAll('.btn-archive').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-id');
        try {
          await updateNotificationStatus(id, 'archived');
          showToast("Notification archived", "info");
          await renderNotifications();
          updateMenuNotificationBadges();
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });

    document.querySelectorAll('.btn-unarchive').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-id');
        try {
          await updateNotificationStatus(id, 'read');
          showToast("Notification restored to Read", "success");
          await renderNotifications();
          updateMenuNotificationBadges();
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });

    document.querySelectorAll('.btn-delete-notif').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-id');
        if (confirm("Are you sure you want to delete this notification permanently?")) {
          try {
            await deleteNotification(id);
            showToast("Notification deleted", "info");
            await renderNotifications();
            updateMenuNotificationBadges();
          } catch (err) {
            showToast(err.message, 'error');
          }
        }
      });
    });

  } catch (err) {
    console.error("Notifications render error:", err);
    showToast(err.message, 'error');
  }
}

// 7. SETTINGS PAGE
function renderSettings() {
  const root = getAppViewRoot();
  
  const isError = localStorage.getItem('applytrack_simulate_error') === 'true' || currentProfile?.sync_error;
  const syncState = currentProfile?.gmail_connected && !isError;
  const lastSyncedText = currentProfile?.last_synced ? getRelativeTimeString(currentProfile.last_synced) : 'Never';
  const simulateError = localStorage.getItem('applytrack_simulate_error') === 'true';

  root.innerHTML = `
    <div class="settings-page-container">
      
      <!-- Error Alert Banner -->
      ${isError ? `
        <div class="alert-banner danger" style="margin-bottom: 24px;">
          <div class="alert-banner-content">
            <i class="fas fa-exclamation-triangle" style="font-size: 1.2rem;"></i>
            <span><strong>Gmail Sync Error:</strong> Your Gmail authorization has expired. Reconnect below.</span>
          </div>
        </div>
      ` : ''}

      <div style="margin-bottom: 32px;">
        <h1 class="page-title" style="margin-bottom: 4px;">Account Settings</h1>
        <p style="color: var(--color-text-secondary); font-size: 0.95rem;">Configure notifications, integrations, and workspace preferences.</p>
      </div>

      <!-- Horizontal settings tabs row -->
      <div class="settings-tabs-row">
        <button class="settings-tab-btn" id="settings-tab-profile">
          <i class="fas fa-user"></i> General Profile
        </button>
        <button class="settings-tab-btn active" id="settings-tab-gmail">
          <i class="fab fa-google" style="color:#3B82F6;"></i> Gmail Sync
        </button>
        <button class="settings-tab-btn" id="settings-tab-security">
          <i class="fas fa-lock"></i> Security & Tokens
        </button>
      </div>

      <!-- Main card -->
      <div class="settings-card">
        <h3 class="settings-card-title">Gmail Integration Settings</h3>

        <!-- Sync Connection Status row -->
        <div class="settings-item-row">
          <div class="settings-item-info">
            <span class="settings-item-label">Sync Connection Status</span>
            <span class="settings-item-desc">Check if ApplyTrack is connected to Gmail to scan incoming job messages.</span>
          </div>
          <div>
            ${isError ? `
              <span class="badge-status disconnected-badge"><span style="width:8px; height:8px; border-radius:50%; background-color:#B91C1C; display:inline-block; margin-right:4px;"></span> Error</span>
            ` : syncState ? `
              <span class="badge-status connected-badge"><span style="width:8px; height:8px; border-radius:50%; background-color:#15803D; display:inline-block; margin-right:4px;"></span> Connected</span>
            ` : `
              <span class="badge-status disconnected-badge"><span style="width:8px; height:8px; border-radius:50%; background-color:#B91C1C; display:inline-block; margin-right:4px;"></span> Disconnected</span>
            `}
          </div>
        </div>

        <!-- Connected Google Account row -->
        <div class="settings-item-row">
          <div class="settings-item-info">
            <span class="settings-item-label">Connected Google Account</span>
            <span class="settings-item-desc">This account is used to authorize the scan job inbox readings.</span>
          </div>
          <div style="font-weight: 700; color: var(--color-text);">
            ${currentProfile?.gmail_connected ? currentUser.email : 'None'}
          </div>
        </div>

        <!-- Last Successful Sync row -->
        <div class="settings-item-row">
          <div class="settings-item-info">
            <span class="settings-item-label">Last Successful Sync</span>
            <span class="settings-item-desc">Timestamp showing when your inbox was scanned for confirmations.</span>
          </div>
          <div style="font-weight: 600; color: var(--color-text-secondary);" id="settings-last-synced">
            ${lastSyncedText}
          </div>
        </div>

        <!-- Sync Actions row -->
        <div class="settings-item-row">
          <div class="settings-item-info">
            <span class="settings-item-label">Sync Actions</span>
            <span class="settings-item-desc">Disconnect access keys, re-verify scope permissions, or run a manual search query.</span>
          </div>
          <div style="display: flex; gap: 12px; flex-wrap: wrap;">
            ${syncState ? `
              <button id="settings-sync-btn" class="settings-action-btn"><i class="fas fa-sync-alt"></i> Sync Now</button>
              <button id="settings-disconnect-btn" class="settings-action-btn disconnect"><i class="fas fa-times"></i> Disconnect</button>
            ` : isError ? `
              <button id="settings-reconnect-btn" class="settings-action-btn" style="border-color:var(--color-secondary); color:var(--color-secondary);"><i class="fas fa-sync-alt"></i> Reconnect Gmail</button>
              <button id="settings-disconnect-btn" class="settings-action-btn disconnect"><i class="fas fa-times"></i> Disconnect</button>
            ` : `
              <button id="settings-connect-btn" class="settings-action-btn" style="border-color:var(--color-secondary); color:var(--color-secondary);"><i class="fab fa-google"></i> Connect Gmail</button>
            `}
          </div>
        </div>

        <!-- Simulation panel for developers -->
        <div class="sandbox-divider"></div>
        
        <div style="margin-bottom: 24px;">
          <h4 style="font-size: 1.05rem; font-weight: 700; color: var(--color-primary); margin-bottom: 6px; display: flex; align-items: center; gap: 8px;">
            <i class="fas fa-flask" style="color: var(--color-secondary);"></i> Developer Testing Sandbox
          </h4>
          <p style="font-size: 0.85rem; color: var(--color-text-secondary); line-height: 1.4;">
            Use these tools to simulate edge cases and evaluate the UI's reaction to API sync failures.
          </p>
        </div>
        
        <div class="sandbox-card">
          <div class="settings-item-info">
            <span class="settings-item-label" style="font-size: 0.95rem;">Simulate Sync Error</span>
            <span class="settings-item-desc" style="font-size: 0.82rem; max-width: 480px;">
              Simulate an expired OAuth credentials token or connection failure. This triggers warnings on settings and dashboard.
            </span>
          </div>
          <div class="switch-container" style="display: flex; align-items: center; gap: 12px;">
            <label class="switch">
              <input type="checkbox" id="simulate-error-switch" ${simulateError ? 'checked' : ''}>
              <span class="slider"></span>
            </label>
            <span style="font-size: 0.85rem; font-weight: 700; color: ${simulateError ? 'var(--color-danger)' : 'var(--color-text-secondary)'}; min-width: 80px;" id="simulate-error-label">
              ${simulateError ? 'ERROR ACTIVE' : 'NORMAL'}
            </span>
          </div>
        </div>

      </div>
    </div>
  `;

  // Attach button event handlers
  document.getElementById('settings-connect-btn')?.addEventListener('click', handleSettingsConnect);
  document.getElementById('settings-reconnect-btn')?.addEventListener('click', handleSettingsConnect);
  document.getElementById('settings-disconnect-btn')?.addEventListener('click', handleSettingsDisconnect);
  
  document.getElementById('settings-tab-profile')?.addEventListener('click', () => {
    showToast('General Profile Settings are coming in Milestone 3', 'info');
  });
  document.getElementById('settings-tab-security')?.addEventListener('click', () => {
    showToast('Advanced Security settings are coming in Milestone 3', 'info');
  });

  document.getElementById('settings-sync-btn')?.addEventListener('click', async () => {
    const btn = document.getElementById('settings-sync-btn');
    const oldText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Syncing...`;
    
    await triggerManualSync();
    
    btn.disabled = false;
    btn.innerHTML = oldText;
    document.getElementById('settings-last-synced').textContent = getRelativeTimeString(currentProfile.last_synced);
  });

  // Switch event handler
  document.getElementById('simulate-error-switch')?.addEventListener('change', (e) => {
    const active = e.target.checked;
    localStorage.setItem('applytrack_simulate_error', active ? 'true' : 'false');
    
    // Update local label
    const label = document.getElementById('simulate-error-label');
    if (label) {
      label.textContent = active ? 'ERROR ACTIVE' : 'NORMAL';
      label.style.color = active ? 'var(--color-danger)' : 'var(--color-text-secondary)';
    }

    // Update profile
    updateProfileState({ sync_error: active });
    
    showToast(active ? "Simulating connection token error." : "Sync error simulation disabled.", active ? "error" : "success");
    
    // Reload route to apply changes globally
    setTimeout(() => handleRouting(), 500);
  });

  startRelativeTimeUpdater();
}

function handleSettingsConnect() {
  simulateGmailConnect();
}

async function handleSettingsDisconnect() {
  const confirmDisconnect = confirm("Are you sure you want to disconnect Gmail? ApplyTrack will stop tracking new job confirmations.");
  if (!confirmDisconnect) return;
  
  try {
    await updateProfileState({ 
      gmail_connected: false, 
      sync_error: false,
      last_synced: null 
    });
    showToast("Disconnected Gmail account.", "info");
    handleRouting();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function triggerManualSync() {
  return new Promise((resolve) => {
    setTimeout(async () => {
      try {
        const isError = localStorage.getItem('applytrack_simulate_error') === 'true';
        if (isError) {
          await updateProfileState({ sync_error: true });
          showToast("Sync failed: Authorization token expired.", "error");
          handleRouting();
          resolve(false);
          return;
        }

        // Fetch current jobs to check for duplicates
        let currentJobs = [];
        if (window.USE_MOCK_AUTH) {
          currentJobs = getJobs();
        } else {
          const { data, error } = await supabaseClient.from('jobs').select('*');
          if (error) throw error;
          currentJobs = data;
        }

        const scanLogs = [];
        const detectedJobs = [];

        // Parse each mock email
        MOCK_INBOX_EMAILS.forEach(email => {
          const parsed = parseEmail(email);
          parsed.from = email.from;
          parsed.date = email.date;
          
          if (parsed.detected) {
            // Find duplicate
            const existingJob = currentJobs.find(
              j => j.company.toLowerCase() === parsed.company.toLowerCase() &&
                   j.role.toLowerCase() === parsed.role.toLowerCase()
            );
            
            if (existingJob) {
              parsed.action = 'update';
              const newWeight = STATUS_WEIGHT[parsed.status] || 0;
              const oldWeight = STATUS_WEIGHT[existingJob.status] || 0;
              
              if (newWeight >= oldWeight && existingJob.status !== parsed.status) {
                parsed.actionDetails = `Upgraded status from <strong>${existingJob.status.toUpperCase()}</strong> to <strong>${parsed.status.toUpperCase()}</strong>`;
              } else if (existingJob.status === parsed.status) {
                parsed.actionDetails = `Verified existing status: <strong>${existingJob.status.toUpperCase()}</strong>`;
              } else {
                parsed.actionDetails = `Ignored status downgrade (current board status: <strong>${existingJob.status.toUpperCase()}</strong>)`;
              }
            } else {
              parsed.action = 'new';
            }
            detectedJobs.push({
              company: parsed.company,
              role: parsed.role,
              status: parsed.status,
              source: parsed.source,
              recruiter_email: parsed.recruiter_email,
              email_subject: parsed.email_subject,
              confidence_score: parsed.confidence_score,
              category: parsed.category,
              date: parsed.date
            });
          } else {
            parsed.action = 'ignored';
          }
          
          scanLogs.push(parsed);
        });

        // Save detected jobs (this upserts or appends depending on mode)
        await saveJobs(detectedJobs);

        // Update profile last synced timestamp
        await updateProfileState({ 
          last_synced: new Date().toISOString(),
          sync_error: false
        });
        
        showToast("Inbox sync completed!", "success");
        
        // Open the logs visual modal
        openSyncLogModal(scanLogs);
        
        resolve(true);
      } catch (err) {
        showToast(err.message, 'error');
        resolve(false);
      }
    }, 1500);
  });
}

/* ==========================================================================
   ROUTER & APP CYCLE
   ========================================================================== */

function getAppViewRoot() {
  const contentView = document.getElementById('app-content-view');
  return contentView || document.getElementById('app-root');
}

function renderAppShell(currentHash) {
  const root = document.getElementById('app-root');
  const activeTab = currentHash.includes('settings') ? 'settings' : currentHash.includes('onboarding') ? 'onboarding' : currentHash.includes('interviews') ? 'interviews' : currentHash.includes('notifications') ? 'notifications' : currentHash.includes('insights') ? 'insights' : currentHash.includes('resume-analyzer') ? 'resume-analyzer' : 'dashboard';
  
  root.innerHTML = `
    <div class="app-shell">
      <!-- Mobile Brand Header -->
      <header class="mobile-header">
        <a href="#/dashboard" class="mobile-header-brand">
          <span class="logo-icon">A</span>
          ApplyTrack
        </a>
        <button class="mobile-hamburger-btn" id="mobile-hamburger-btn">
          <i class="fas fa-bars"></i>
        </button>
      </header>

      <!-- Left Sidebar for Desktop/Tablet -->
      <aside class="app-sidebar">
        <a href="#/dashboard" class="sidebar-brand">
          <span class="logo-icon">A</span>
          <span class="logo-text">ApplyTrack</span>
        </a>
        <nav class="sidebar-nav">
          <a href="#/dashboard" class="sidebar-link ${activeTab === 'dashboard' ? 'active' : ''}" id="sidebar-link-dashboard">
            <i class="fas fa-chart-pie"></i> <span>Dashboard</span>
          </a>
          <a href="#/insights" class="sidebar-link ${activeTab === 'insights' ? 'active' : ''}" id="sidebar-link-insights">
            <i class="fas fa-brain"></i> <span>AI Insights</span>
          </a>
          <a href="#/interviews" class="sidebar-link ${activeTab === 'interviews' ? 'active' : ''}" id="sidebar-link-interviews">
            <i class="fas fa-calendar-alt"></i> <span>Interviews</span>
          </a>
          <a href="#/resume-analyzer" class="sidebar-link ${activeTab === 'resume-analyzer' ? 'active' : ''}" id="sidebar-link-resume-analyzer">
            <i class="fas fa-file-invoice"></i> <span>Resume Analyzer</span>
          </a>
          <a href="#/notifications" class="sidebar-link ${activeTab === 'notifications' ? 'active' : ''}" id="sidebar-link-notifications" style="position:relative; display:flex; align-items:center;">
            <i class="fas fa-bell"></i> <span>Notifications</span>
            <span class="sidebar-badge" id="sidebar-unread-count" style="display:none;">0</span>
          </a>
          <a href="#/settings" class="sidebar-link ${activeTab === 'settings' ? 'active' : ''}" id="sidebar-link-settings">
            <i class="fas fa-cog"></i> <span>Settings</span>
          </a>
          <a href="#/onboarding" class="sidebar-link ${activeTab === 'onboarding' ? 'active' : ''}" id="sidebar-link-onboarding">
            <i class="fas fa-map-signs"></i> <span>Setup Guide</span>
          </a>
        </nav>
        
        <div class="sidebar-footer">
          <div class="sidebar-user">
            <i class="far fa-user-circle"></i>
            <span class="sidebar-user-info" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 160px;">
              ${currentProfile?.full_name || currentUser.email}
            </span>
          </div>
          <button id="sidebar-logout-btn" class="btn btn-logout btn-outline btn-sm" style="border-color: rgba(255, 255, 255, 0.15); color: #FFFFFF; width: 100%; display: flex; align-items: center; justify-content: center; gap: 8px;">
            <i class="fas fa-sign-out-alt"></i> <span>Log Out</span>
          </button>
        </div>
      </aside>
      
      <!-- Mobile Slide-out Drawer Overlay -->
      <div class="mobile-drawer-overlay" id="mobile-drawer-overlay">
        <div class="mobile-drawer-content">
          <div class="mobile-drawer-header">
            <div>
              <span class="logo-icon">A</span>
              ApplyTrack
            </div>
            <button class="close-drawer-btn" id="close-drawer-btn"><i class="fas fa-times"></i></button>
          </div>
          <div class="mobile-drawer-body">
            <a href="#/insights" class="drawer-link" id="drawer-link-insights">
              <i class="fas fa-brain"></i> AI Insights
            </a>
            <a href="#/resume-analyzer" class="drawer-link" id="drawer-link-resume-analyzer">
              <i class="fas fa-file-invoice"></i> Resume Analyzer
            </a>
            <a href="#/onboarding" class="drawer-link" id="drawer-link-onboarding">
              <i class="fas fa-map-signs"></i> Setup Guide
            </a>
            <div class="drawer-divider"></div>
            <div class="drawer-user-info">
              <i class="far fa-user-circle"></i>
              <span id="drawer-user-email">
                ${currentProfile?.full_name || currentUser.email}
              </span>
            </div>
            <button id="drawer-logout-btn" class="btn btn-outline btn-sm" style="width:100%; border-color:var(--color-danger); color:var(--color-danger); margin-top:auto; display:flex; align-items:center; justify-content:center; gap:8px; min-height:44px;">
              <i class="fas fa-sign-out-alt"></i> Log Out
            </button>
          </div>
        </div>
      </div>

      <!-- Main Content Area -->
      <main class="app-content-pane">
        <div id="app-content-view">
          <!-- Route content injected dynamically -->
        </div>
      </main>
      
      <!-- Bottom Navigation for Mobile -->
      <nav class="bottom-nav">
        <a href="#/dashboard" class="bottom-nav-item ${activeTab === 'dashboard' ? 'active' : ''}" id="bottom-link-dashboard">
          <i class="fas fa-chart-pie"></i>
          <span>Dashboard</span>
        </a>
        <a href="#/interviews" class="bottom-nav-item ${activeTab === 'interviews' ? 'active' : ''}" id="bottom-link-interviews">
          <i class="fas fa-calendar-alt"></i>
          <span>Interviews</span>
        </a>
        <a href="#/notifications" class="bottom-nav-item ${activeTab === 'notifications' ? 'active' : ''}" id="bottom-link-notifications" style="position:relative;">
          <i class="fas fa-bell"></i>
          <span>Alerts</span>
          <span class="bottom-nav-badge" id="mobile-unread-count" style="display:none;">0</span>
        </a>
        <a href="#/settings" class="bottom-nav-item ${activeTab === 'settings' ? 'active' : ''}" id="bottom-link-settings">
          <i class="fas fa-cog"></i>
          <span>Settings</span>
        </a>
      </nav>
    </div>
  `;
  
  // Logout handler
  const handleLogout = async () => {
    try {
      await logoutUser();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };
  
  // Sidebar & Drawer triggers
  document.getElementById('sidebar-logout-btn')?.addEventListener('click', handleLogout);
  document.getElementById('drawer-logout-btn')?.addEventListener('click', handleLogout);
  
  const drawerOverlay = document.getElementById('mobile-drawer-overlay');
  
  document.getElementById('mobile-hamburger-btn')?.addEventListener('click', () => {
    drawerOverlay?.classList.add('open');
  });
  
  document.getElementById('close-drawer-btn')?.addEventListener('click', () => {
    drawerOverlay?.classList.remove('open');
  });
  
  drawerOverlay?.addEventListener('click', (e) => {
    if (e.target === drawerOverlay) {
      drawerOverlay.classList.remove('open');
    }
  });

  document.getElementById('drawer-link-onboarding')?.addEventListener('click', () => {
    drawerOverlay?.classList.remove('open');
  });

  document.getElementById('drawer-link-insights')?.addEventListener('click', () => {
    drawerOverlay?.classList.remove('open');
  });

  document.getElementById('drawer-link-resume-analyzer')?.addEventListener('click', () => {
    drawerOverlay?.classList.remove('open');
  });
  
  // Initial count update
  updateMenuNotificationBadges();
}

function updateAppShellActiveLink(currentHash) {
  const activeTab = currentHash.includes('settings') ? 'settings' : currentHash.includes('onboarding') ? 'onboarding' : currentHash.includes('interviews') ? 'interviews' : currentHash.includes('notifications') ? 'notifications' : currentHash.includes('insights') ? 'insights' : currentHash.includes('resume-analyzer') ? 'resume-analyzer' : 'dashboard';
  
  document.querySelectorAll('.sidebar-link, .bottom-nav-item').forEach(link => {
    link.classList.remove('active');
  });
  
  document.getElementById(`sidebar-link-${activeTab}`)?.classList.add('active');
  document.getElementById(`bottom-link-${activeTab}`)?.classList.add('active');
}

function navigate(hash) {
  window.location.hash = hash;
}

// Router map
const routes = {
  '#/': { render: renderLanding, authRequired: false },
  '#/login': { render: renderLogin, authRequired: false, guestOnly: true },
  '#/signup': { render: renderSignUp, authRequired: false, guestOnly: true },
  '#/forgot-password': { render: renderForgotPassword, authRequired: false, guestOnly: true },
  '#/onboarding': { render: renderOnboarding, authRequired: true },
  '#/dashboard': { render: renderDashboard, authRequired: true, onboardingRequired: true },
  '#/insights': { render: renderInsights, authRequired: true, onboardingRequired: true },
  '#/resume-analyzer': { render: renderResumeAnalyzer, authRequired: true, onboardingRequired: true },
  '#/settings': { render: renderSettings, authRequired: true, onboardingRequired: true },
  '#/interviews': { render: renderInterviews, authRequired: true, onboardingRequired: true },
  '#/notifications': { render: renderNotifications, authRequired: true, onboardingRequired: true },
  '#/application/:id': {
    render: () => {
      const parts = window.location.hash.split('/');
      const id = parts[parts.length - 1];
      return renderApplicationDetail(id);
    },
    authRequired: true,
    onboardingRequired: true
  }
};

async function handleRouting() {
  try {
    const currentHash = window.location.hash || '#/';
    
    // 1. Fetch current session with safety fallback
    try {
      await checkAuthSession();
    } catch (sessionErr) {
      console.error("Session check error, falling back to clean state:", sessionErr);
      currentUser = null;
      currentProfile = null;
    }
    
    // 2. Refresh UI Nav
    updateNavigation();
    
    // Find routing rules
    let routeKey = currentHash;
    if (currentHash.startsWith('#/application/')) {
      routeKey = '#/application/:id';
    }
    const route = routes[routeKey] || routes['#/']; // default back to landing page if path not found

    // 3. Auth Route Guards
    if (route.authRequired && !currentUser) {
      // Save attempted route and redirect
      showToast("Please sign in to view this page", "error");
      navigate('#/login');
      return;
    }
    
    if (currentUser && (currentHash === '#/' || currentHash === '#' || route.guestOnly)) {
      // Logged in user trying to access landing, login, or signup
      if (currentProfile?.onboarding_completed) {
        navigate('#/dashboard');
      } else {
        navigate('#/onboarding');
      }
      return;
    }

    if (route.onboardingRequired && currentUser && !currentProfile?.onboarding_completed) {
      // Logged in but onboarding isn't complete: force onboarding
      showToast("Please complete onboarding first", "info");
      navigate('#/onboarding');
      return;
    }

    // 4. Hide/Show Navbar and Footer for Shell Layout
    const navbar = document.querySelector('.navbar');
    const footer = document.querySelector('.footer');
    
    if (currentUser && route.authRequired) {
      if (navbar) navbar.style.display = 'none';
      if (footer) footer.style.display = 'none';
      
      const hasShell = document.getElementById('app-content-view') !== null;
      if (!hasShell) {
        renderAppShell(currentHash);
      } else {
        updateAppShellActiveLink(currentHash);
        updateMenuNotificationBadges();
      }
      runSmartAlertsEngine();
    } else {
      if (navbar) navbar.style.display = 'flex';
      if (footer) footer.style.display = 'block';
    }

    // Render view
    await route.render();
  } catch (err) {
    console.error("Routing Render Error:", err);
    const root = document.getElementById('app-root');
    if (root) {
      root.innerHTML = `
        <div class="app-container" style="padding: 80px 24px; text-align: center; max-width: 600px; margin: 0 auto;">
          <div style="background-color: var(--color-danger-light); color: var(--color-danger); width: 64px; height: 64px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 2rem; margin: 0 auto 24px auto;">
            <i class="fas fa-exclamation-triangle"></i>
          </div>
          <h2 style="font-size: 1.5rem; font-weight: 800; color: var(--color-primary); margin-bottom: 8px;">Application Error</h2>
          <p style="color: var(--color-text-secondary); margin-bottom: 24px; line-height: 1.5;">
            An error occurred while loading this page: <strong>${err.message}</strong>
          </p>
          <pre style="text-align: left; background-color: #F1F5F9; padding: 20px; border-radius: var(--radius-md); border: 1px solid var(--color-border); font-family: monospace; font-size: 0.8rem; overflow-x: auto; max-height: 200px;">${err.stack}</pre>
          <button onclick="window.location.hash='#/'; window.location.reload();" class="btn btn-primary" style="margin-top: 24px;">Reload Application</button>
        </div>
      `;
    }
  }
}

/* ==========================================================================
   SUPPORTING HELPER LOGIC
   ========================================================================== */

function validateEmail(email) {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email);
}

function setupPasswordToggles() {
  document.querySelectorAll('.toggle-password').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-target');
      const input = document.getElementById(targetId);
      if (input) {
        if (input.type === 'password') {
          input.type = 'text';
          btn.textContent = 'HIDE';
        } else {
          input.type = 'password';
          btn.textContent = 'SHOW';
        }
      }
    });
  });
}

// 6A. AI INSIGHTS & ANALYTICS PAGE
function computeAnalyticsMetrics(jobs, interviews) {
  const totalApps = jobs.length;
  
  // 1. Success Rate: (Offers + Interviewing + Assessment) / Total
  const successCount = jobs.filter(j => ['assessment', 'interviewing', 'offer'].includes(j.status.toLowerCase())).length;
  const successRate = totalApps > 0 ? Math.round((successCount / totalApps) * 100) : 0;
  
  // 2. Interview Conversion Rate: jobs converting to interviews
  const interviewCount = jobs.filter(j => ['interviewing', 'offer'].includes(j.status.toLowerCase())).length;
  const interviewConversion = totalApps > 0 ? Math.round((interviewCount / totalApps) * 100) : 0;
  
  // 3. Offer Conversion Rate: offers / interviews
  const offerCount = jobs.filter(j => j.status.toLowerCase() === 'offer').length;
  const offerConversion = interviewCount > 0 ? Math.round((offerCount / interviewCount) * 100) : 0;
  
  // 4. Average Response Time calculation
  let totalDays = 0;
  let matches = 0;
  jobs.forEach(job => {
    const jobInts = interviews.filter(i => 
      i.company.toLowerCase() === job.company.toLowerCase()
    );
    if (jobInts.length > 0 && job.date) {
      const jobDate = new Date(job.date + 'T12:00:00');
      let earliestIntDate = null;
      jobInts.forEach(i => {
        if (i.date) {
          const d = new Date(i.date + 'T12:00:00');
          if (!earliestIntDate || d < earliestIntDate) {
            earliestIntDate = d;
          }
        }
      });
      if (earliestIntDate) {
        const diffTime = earliestIntDate - jobDate;
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        if (diffDays >= 0) {
          totalDays += diffDays;
          matches++;
        }
      }
    }
  });
  const avgResponseTime = matches > 0 ? Math.round(totalDays / matches) : 14;
  
  // 5. Applications Sent This Week
  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
  const sentThisWeek = jobs.filter(j => j.date && new Date(j.date + 'T12:00:00') >= oneWeekAgo).length;

  // 6. Best Performing Platforms/Job Boards
  const sourceStats = {};
  jobs.forEach(j => {
    const src = j.source || 'Other';
    if (!sourceStats[src]) sourceStats[src] = { total: 0, converted: 0 };
    sourceStats[src].total++;
    if (['interviewing', 'offer'].includes(j.status.toLowerCase())) {
      sourceStats[src].converted++;
    }
  });
  let bestPlatform = 'LinkedIn';
  let highestPlatformRate = 0;
  Object.keys(sourceStats).forEach(src => {
    const rate = sourceStats[src].converted / sourceStats[src].total;
    if (rate > highestPlatformRate) {
      highestPlatformRate = rate;
      bestPlatform = src;
    }
  });

  // 7. Best Performing Job Titles
  const roleStats = {};
  jobs.forEach(j => {
    const role = j.role || 'Other';
    let roleGroup = role;
    if (role.toLowerCase().includes('designer')) roleGroup = 'Product Designer';
    else if (role.toLowerCase().includes('engineer') || role.toLowerCase().includes('developer')) roleGroup = 'Software Engineer';
    else if (role.toLowerCase().includes('manager')) roleGroup = 'Product Manager';

    if (!roleStats[roleGroup]) roleStats[roleGroup] = { total: 0, converted: 0 };
    roleStats[roleGroup].total++;
    if (['interviewing', 'offer'].includes(j.status.toLowerCase())) {
      roleStats[roleGroup].converted++;
    }
  });
  let bestTitle = 'Software Engineer';
  let highestTitleRate = 0;
  Object.keys(roleStats).forEach(role => {
    const rate = roleStats[role].converted / roleStats[role].total;
    if (rate > highestTitleRate) {
      highestTitleRate = rate;
      bestTitle = role;
    }
  });

  // 8. Most Active Companies
  const companyCounts = {};
  jobs.forEach(j => {
    companyCounts[j.company] = (companyCounts[j.company] || 0) + 1;
  });
  let mostActiveCompany = 'Google';
  let maxCompanyCount = 0;
  Object.keys(companyCounts).forEach(c => {
    if (companyCounts[c] > maxCompanyCount) {
      maxCompanyCount = companyCounts[c];
      mostActiveCompany = c;
    }
  });

  return {
    successRate,
    interviewConversion,
    offerConversion,
    avgResponseTime,
    sentThisWeek,
    bestPlatform,
    bestTitle,
    mostActiveCompany
  };
}

function generateAIRecommendations(jobs, interviews, metrics) {
  const recommendations = [];
  
  // Recommendation 1: Referral analysis
  const referralJobs = jobs.filter(j => j.source && j.source.toLowerCase() === 'referral');
  const referralInterviews = referralJobs.filter(j => ['interviewing', 'offer'].includes(j.status.toLowerCase()));
  if (referralJobs.length > 0 && (referralInterviews.length / referralJobs.length) > 0.4) {
    recommendations.push("Most of your interviews came from referrals. Double down on networking and warm outreach.");
  } else {
    recommendations.push("Referrals convert at a 3x higher rate than cold applications. Try reaching out to employees for internal referrals.");
  }
  
  // Recommendation 2: Size success
  const categories = {};
  jobs.forEach(j => {
    const cat = j.category || 'Mid-Sized';
    if (!categories[cat]) categories[cat] = { total: 0, converted: 0 };
    categories[cat].total++;
    if (['interviewing', 'offer'].includes(j.status.toLowerCase())) {
      categories[cat].converted++;
    }
  });
  let bestCategory = 'Mid-Sized';
  let bestCategoryRate = 0;
  Object.keys(categories).forEach(cat => {
    const rate = categories[cat].converted / categories[cat].total;
    if (rate > bestCategoryRate && categories[cat].total >= 2) {
      bestCategoryRate = rate;
      bestCategory = cat;
    }
  });
  if (bestCategoryRate > 0) {
    recommendations.push(`You have a higher success rate applying to ${bestCategory.toLowerCase()} companies.`);
  } else {
    recommendations.push("Mid-sized tech companies (100-500 employees) currently have the fastest response times.");
  }
  
  // Recommendation 3: Best title
  if (metrics.bestTitle && metrics.interviewConversion > 0) {
    recommendations.push(`Your response rate is highest for ${metrics.bestTitle} roles.`);
  } else {
    recommendations.push("Try tailoring your resume keywords specifically for product/engineering search optimization.");
  }
  
  // Recommendation 4: Inactivity check
  if (jobs.length === 0) {
    recommendations.push("You haven't tracked any applications yet. Add or sync some jobs to kickstart your tracking!");
  } else {
    const sortedJobs = [...jobs].sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
    if (sortedJobs[0] && sortedJobs[0].date) {
      const latestJobDate = new Date(sortedJobs[0].date + 'T12:00:00');
      const diffTime = new Date() - latestJobDate;
      const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
      if (diffDays >= 7) {
        recommendations.push(`You've had no application activity for ${diffDays} days. Consider applying to new roles to keep your funnel active.`);
      } else {
        recommendations.push("Recommendation: Keep your momentum! Apply to 2-3 targeted roles mid-week for maximum visibility.");
      }
    } else {
      recommendations.push("Recommendation: Keep your momentum! Apply to 2-3 targeted roles mid-week for maximum visibility.");
    }
  }
  
  return recommendations;
}

async function renderInsights() {
  const root = getAppViewRoot();
  
  // Show spinner loading state first
  root.innerHTML = `
    <div style="display:flex; justify-content:center; align-items:center; min-height:400px; flex-direction:column; gap:16px;">
      <i class="fas fa-spinner fa-spin" style="font-size:2rem; color:var(--color-secondary);"></i>
      <p style="color:var(--color-text-secondary); font-weight:500;">Computing AI analytics & charts...</p>
    </div>
  `;

  try {
    const [jobs, interviews] = await Promise.all([
      fetchJobs(),
      fetchInterviews()
    ]);

    const metrics = computeAnalyticsMetrics(jobs, interviews);
    const recommendations = generateAIRecommendations(jobs, interviews, metrics);

    // Grouping months for Line Chart
    const months = [];
    const counts = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthName = d.toLocaleDateString(undefined, { month: 'short' });
      months.push(monthName);
      
      const monthJobs = jobs.filter(j => {
        if (!j.date) return false;
        const jd = new Date(j.date + 'T12:00:00');
        return jd.getMonth() === d.getMonth() && jd.getFullYear() === d.getFullYear();
      });
      counts.push(monthJobs.length);
    }

    // SVG plotting variables
    const maxCount = Math.max(...counts, 5);
    const svgWidth = 500;
    const svgHeight = 220;
    const padLeft = 45;
    const padRight = 20;
    const padTop = 20;
    const padBottom = 35;
    const drawWidth = svgWidth - padLeft - padRight;
    const drawHeight = svgHeight - padTop - padBottom;

    // Generate path and points
    let pathD = '';
    const points = [];
    counts.forEach((val, i) => {
      const x = padLeft + i * (drawWidth / 5);
      const y = svgHeight - padBottom - (val / maxCount) * drawHeight;
      points.push({ x, y, val, month: months[i] });
      if (i === 0) {
        pathD = `M ${x} ${y}`;
      } else {
        pathD += ` L ${x} ${y}`;
      }
    });

    // Funnel percentages
    const totalCount = jobs.length;
    const assessmentCount = jobs.filter(j => ['assessment', 'interviewing', 'offer'].includes(j.status.toLowerCase())).length;
    const interviewingCount = jobs.filter(j => ['interviewing', 'offer'].includes(j.status.toLowerCase())).length;
    const offerCount = jobs.filter(j => j.status.toLowerCase() === 'offer').length;

    const assessmentPct = totalCount > 0 ? Math.round((assessmentCount / totalCount) * 100) : 0;
    const interviewingPct = totalCount > 0 ? Math.round((interviewingCount / totalCount) * 100) : 0;
    const offerPct = totalCount > 0 ? Math.round((offerCount / totalCount) * 100) : 0;

    // Platform breakdown
    const platforms = ['LinkedIn', 'Indeed', 'Referral', 'Career Page', 'Other'];
    const platformData = platforms.map(plat => {
      const platJobs = jobs.filter(j => (j.source || 'Other').toLowerCase().includes(plat.toLowerCase() === 'career page' ? 'career' : plat.toLowerCase()));
      const platInterviews = platJobs.filter(j => ['interviewing', 'offer'].includes(j.status.toLowerCase()));
      const rate = platJobs.length > 0 ? Math.round((platInterviews.length / platJobs.length) * 100) : 0;
      return { name: plat, count: platJobs.length, rate };
    }).sort((a, b) => b.count - a.count);

    // Status list counts
    const statusLabels = {
      'applied': { name: 'Applied', color: '#3B82F6' },
      'assessment': { name: 'Assessment', color: '#F59E0B' },
      'interviewing': { name: 'Interviewing', color: '#8B5CF6' },
      'offer': { name: 'Offer', color: '#10B981' },
      'rejected': { name: 'Rejected', color: '#EF4444' }
    };

    root.innerHTML = `
      <div class="insights-page-container">
        <!-- Header -->
        <div style="margin-bottom: 28px;">
          <h1 style="font-size: 1.75rem; font-weight: 800; color: var(--color-primary);">AI Insights & Analytics</h1>
          <p style="color: var(--color-text-secondary); margin-top: 4px;">Track funnel stages, platform performance, and custom recommendations.</p>
        </div>

        <!-- AI Recommendations Alert -->
        <div class="recommendation-panel">
          <h3 style="font-size: 1.1rem; font-weight: 800; color: var(--color-primary); display: flex; align-items: center; gap: 8px;">
            <i class="fas fa-brain" style="color: var(--color-secondary);"></i> AI Suggestions & Recommendations
          </h3>
          <div class="recommendations-list">
            ${recommendations.map(rec => `
              <div class="recommendation-item">
                <i class="fas fa-lightbulb"></i>
                <div class="recommendation-text">${rec}</div>
              </div>
            `).join('')}
          </div>
        </div>

        <!-- Analytics Cards Row -->
        <div class="insights-stats-grid">
          <div class="insight-metric-card">
            <div class="progress-ring-container">
              <svg width="72" height="72">
                <circle cx="36" cy="36" r="30" stroke="var(--color-border)" stroke-width="6" fill="transparent" />
                <circle cx="36" cy="36" r="30" stroke="var(--color-primary)" stroke-width="6" fill="transparent"
                  stroke-dasharray="188.4" stroke-dashoffset="${188.4 - (188.4 * metrics.successRate) / 100}"
                  stroke-linecap="round" transform="rotate(-90 36 36)" />
              </svg>
              <div class="progress-ring-text">${metrics.successRate}%</div>
            </div>
            <div>
              <div style="font-size: 0.85rem; font-weight: 700; color: var(--color-text-secondary); text-transform: uppercase;">Success Rate</div>
              <div style="font-size: 1.5rem; font-weight: 800; color: var(--color-primary); margin-top: 4px;">Active Funnel</div>
            </div>
          </div>

          <div class="insight-metric-card">
            <div class="progress-ring-container">
              <svg width="72" height="72">
                <circle cx="36" cy="36" r="30" stroke="var(--color-border)" stroke-width="6" fill="transparent" />
                <circle cx="36" cy="36" r="30" stroke="var(--color-secondary)" stroke-width="6" fill="transparent"
                  stroke-dasharray="188.4" stroke-dashoffset="${188.4 - (188.4 * metrics.interviewConversion) / 100}"
                  stroke-linecap="round" transform="rotate(-90 36 36)" />
              </svg>
              <div class="progress-ring-text">${metrics.interviewConversion}%</div>
            </div>
            <div>
              <div style="font-size: 0.85rem; font-weight: 700; color: var(--color-text-secondary); text-transform: uppercase;">Interview Rate</div>
              <div style="font-size: 1.5rem; font-weight: 800; color: var(--color-primary); margin-top: 4px;">Applied &rarr; Int</div>
            </div>
          </div>

          <div class="insight-metric-card">
            <div class="progress-ring-container">
              <svg width="72" height="72">
                <circle cx="36" cy="36" r="30" stroke="var(--color-border)" stroke-width="6" fill="transparent" />
                <circle cx="36" cy="36" r="30" stroke="#10B981" stroke-width="6" fill="transparent"
                  stroke-dasharray="188.4" stroke-dashoffset="${188.4 - (188.4 * metrics.offerConversion) / 100}"
                  stroke-linecap="round" transform="rotate(-90 36 36)" />
              </svg>
              <div class="progress-ring-text">${metrics.offerConversion}%</div>
            </div>
            <div>
              <div style="font-size: 0.85rem; font-weight: 700; color: var(--color-text-secondary); text-transform: uppercase;">Offer Conversion</div>
              <div style="font-size: 1.5rem; font-weight: 800; color: var(--color-primary); margin-top: 4px;">Int &rarr; Offer</div>
            </div>
          </div>

          <div class="insight-metric-card" style="gap: 16px;">
            <div style="background-color: rgba(139, 92, 246, 0.1); color: var(--color-secondary); width: 48px; height: 48px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 1.4rem;">
              <i class="far fa-clock"></i>
            </div>
            <div>
              <div style="font-size: 0.85rem; font-weight: 700; color: var(--color-text-secondary); text-transform: uppercase;">Avg Response</div>
              <div style="font-size: 1.5rem; font-weight: 800; color: var(--color-primary); margin-top: 4px;">${metrics.avgResponseTime} Days</div>
            </div>
          </div>
        </div>

        <!-- Charts Grid Rows -->
        <div class="charts-grid-row">
          
          <!-- Applications Over Time -->
          <div class="chart-card">
            <div class="chart-card-title">
              <i class="fas fa-chart-line"></i> Applications Over Time
            </div>
            <div class="svg-chart-wrapper">
              <svg viewBox="0 0 ${svgWidth} ${svgHeight}" preserveAspectRatio="xMidYMid meet">
                <!-- Grid Lines -->
                <line x1="${padLeft}" y1="${padTop}" x2="${svgWidth - padRight}" y2="${padTop}" class="chart-grid-line" />
                <line x1="${padLeft}" y1="${padTop + drawHeight / 2}" x2="${svgWidth - padRight}" y2="${padTop + drawHeight / 2}" class="chart-grid-line" />
                <line x1="${padLeft}" y1="${svgHeight - padBottom}" x2="${svgWidth - padRight}" y2="${svgHeight - padBottom}" style="stroke: var(--color-border); stroke-width: 1.5;" />
                
                <!-- Y-Axis Labels -->
                <text x="${padLeft - 10}" y="${padTop + 4}" text-anchor="end" style="font-size: 0.75rem; fill: var(--color-text-secondary); font-weight: 600;">${maxCount}</text>
                <text x="${padLeft - 10}" y="${padTop + drawHeight / 2 + 4}" text-anchor="end" style="font-size: 0.75rem; fill: var(--color-text-secondary); font-weight: 600;">${Math.round(maxCount / 2)}</text>
                <text x="${padLeft - 10}" y="${svgHeight - padBottom + 4}" text-anchor="end" style="font-size: 0.75rem; fill: var(--color-text-secondary); font-weight: 600;">0</text>
                
                <!-- Line Path -->
                <path d="${pathD}" fill="none" stroke="var(--color-secondary)" stroke-width="3" stroke-linecap="round" />
                
                <!-- Points and Labels -->
                ${points.map(pt => `
                  <circle cx="${pt.x}" cx-val="${pt.val}" cy="${pt.y}" r="5.5" class="chart-point" />
                  <!-- Tooltip count values -->
                  <text x="${pt.x}" y="${pt.y - 12}" text-anchor="middle" style="font-size: 0.75rem; fill: var(--color-primary); font-weight: 700;">${pt.val}</text>
                  <!-- X-Axis Label -->
                  <text x="${pt.x}" y="${svgHeight - padBottom + 20}" text-anchor="middle" style="font-size: 0.75rem; fill: var(--color-text-secondary); font-weight: 600;">${pt.month}</text>
                `).join('')}
              </svg>
            </div>
          </div>

          <!-- Interview Funnel Card -->
          <div class="chart-card">
            <div class="chart-card-title">
              <i class="fas fa-filter"></i> Conversion Funnel
            </div>
            <div class="funnel-container">
              <div class="funnel-stage-wrapper">
                <div class="funnel-stage" style="width: 100%; background: linear-gradient(90deg, #1E3A8A, var(--color-primary));">
                  <div class="funnel-stage-label"><i class="fas fa-paper-plane"></i> Applied</div>
                  <div class="funnel-stage-pct">${totalCount} Applications</div>
                </div>
              </div>
              
              <div class="funnel-stage-wrapper">
                <div class="funnel-stage" style="width: ${Math.max(40, 100 * (assessmentCount / (totalCount || 1)))}%; background: #3B82F6;">
                  <div class="funnel-stage-label"><i class="fas fa-tasks"></i> Assessment</div>
                  <div class="funnel-stage-pct">${assessmentCount} (${assessmentPct}%)</div>
                </div>
              </div>

              <div class="funnel-stage-wrapper">
                <div class="funnel-stage" style="width: ${Math.max(40, 100 * (interviewingCount / (totalCount || 1)))}%; background: #8B5CF6;">
                  <div class="funnel-stage-label"><i class="fas fa-comments"></i> Interviewing</div>
                  <div class="funnel-stage-pct">${interviewingCount} (${interviewingPct}%)</div>
                </div>
              </div>

              <div class="funnel-stage-wrapper">
                <div class="funnel-stage" style="width: ${Math.max(40, 100 * (offerCount / (totalCount || 1)))}%; background: #10B981;">
                  <div class="funnel-stage-label"><i class="fas fa-trophy"></i> Offers</div>
                  <div class="funnel-stage-pct">${offerCount} (${offerPct}%)</div>
                </div>
              </div>
            </div>
          </div>

        </div>

        <div class="charts-grid-row">
          
          <!-- Status Distribution Card -->
          <div class="chart-card" style="min-height: 320px;">
            <div class="chart-card-title">
              <i class="fas fa-chart-pie"></i> Status Breakdown
            </div>
            <div style="display: flex; flex-direction: column; gap: 14px; flex-grow: 1; justify-content: center;">
              ${Object.keys(statusLabels).map(key => {
                const count = jobs.filter(j => j.status.toLowerCase() === key).length;
                const pct = totalCount > 0 ? Math.round((count / totalCount) * 100) : 0;
                const status = statusLabels[key];
                return `
                  <div style="display: flex; align-items: center; justify-content: space-between; font-size: 0.9rem;">
                    <div style="display: flex; align-items: center; gap: 10px; font-weight: 600; color: var(--color-text);">
                      <span style="width: 12px; height: 12px; border-radius: 3px; background-color: ${status.color}; display: inline-block;"></span>
                      ${status.name}
                    </div>
                    <div style="display: flex; align-items: center; gap: 12px;">
                      <span style="font-weight: 700; color: var(--color-primary);">${count}</span>
                      <span style="color: var(--color-text-secondary); width: 40px; text-align: right; font-size: 0.8rem; font-weight: 600;">${pct}%</span>
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          </div>

          <!-- Platform Performance Card -->
          <div class="chart-card" style="min-height: 320px;">
            <div class="chart-card-title">
              <i class="fas fa-globe"></i> Platform Yields
            </div>
            <div class="platform-bars-list">
              ${platformData.map(plat => `
                <div class="platform-bar-row">
                  <div class="platform-bar-meta">
                    <span>${plat.name}</span>
                    <span style="color: var(--color-text-secondary); font-size: 0.8rem;">${plat.count} apps &bull; ${plat.rate}% Conversion</span>
                  </div>
                  <div class="platform-bar-container">
                    <div class="platform-bar-fill" style="width: ${plat.count > 0 ? Math.max(8, plat.rate) : 0}%;"></div>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>

        </div>
      </div>
    `;

  } catch (err) {
    console.error(err);
    root.innerHTML = `
      <div style="padding: 40px; text-align: center;">
        <div style="background-color: var(--color-danger-light); color: var(--color-danger); width: 64px; height: 64px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 2rem; margin: 0 auto 24px auto;">
          <i class="fas fa-exclamation-triangle"></i>
        </div>
        <h2 style="font-size: 1.5rem; font-weight: 800; color: var(--color-primary); margin-bottom: 8px;">Analytics Calculation Error</h2>
        <p style="color: var(--color-text-secondary); margin-bottom: 24px;">${err.message}</p>
        <button onclick="window.location.reload();" class="btn btn-primary">Retry</button>
      </div>
    `;
  }
}

// 6A-2. AI RESUME ANALYZER PAGE
async function renderResumeAnalyzer() {
  const root = getAppViewRoot();
  
  root.innerHTML = `
    <div style="display:flex; justify-content:center; align-items:center; min-height:400px; flex-direction:column; gap:16px;">
      <i class="fas fa-spinner fa-spin" style="font-size:2rem; color:var(--color-secondary);"></i>
      <p style="color:var(--color-text-secondary); font-weight:500;">Loading AI resume versions & details...</p>
    </div>
  `;

  async function loadAndRender() {
    try {
      const [jobs, resumes] = await Promise.all([
        fetchJobs(),
        fetchResumes()
      ]);

      root.innerHTML = `
        <div class="analyzer-page-container">
          <!-- Page Header -->
          <div style="margin-bottom: 28px;">
            <h1 style="font-size: 1.75rem; font-weight: 800; color: var(--color-primary);">AI Resume Analyzer</h1>
            <p style="color: var(--color-text-secondary); margin-top: 4px;">Optimize your resume for ATS match scoring and keywords visibility.</p>
          </div>

          <div class="analyzer-grid">
            <!-- Left Pane: Upload and Job Description -->
            <div style="display: flex; flex-direction: column; gap: 24px;">
              
              <!-- Resume Upload Zone Card -->
              <div class="card" style="padding: 24px;">
                <h3 style="font-size: 1.05rem; font-weight: 800; color: var(--color-primary); margin-bottom: 16px;">
                  <i class="fas fa-file-upload" style="color: var(--color-secondary); margin-right: 6px;"></i> Upload Resume Version
                </h3>
                
                <div class="form-group">
                  <label for="analyzer-resume-name">Resume Version Name</label>
                  <input type="text" id="analyzer-resume-name" placeholder="e.g. Product Designer CV - Stripe Version" style="width:100%;">
                </div>

                <div class="resume-upload-zone" id="resume-drop-zone">
                  <i class="far fa-file-pdf"></i>
                  <p style="font-weight: 700; color: var(--color-primary); font-size: 0.9rem;">Drag & drop your PDF or DOCX here</p>
                  <p style="font-size: 0.78rem; color: var(--color-text-secondary); margin-top: 4px;">or click to browse local files</p>
                  <input type="file" id="analyzer-file-input" accept=".pdf,.docx" style="display:none;">
                </div>
                <div id="selected-file-details" style="display:none; margin-top:12px; font-size:0.85rem; color:var(--color-text); font-weight:600; background-color:#F1F5F9; padding:8px 12px; border-radius:6px; align-items:center; justify-content:space-between;">
                  <span><i class="far fa-file" style="margin-right:6px; color:var(--color-danger);"></i> <span id="selected-file-name">filename.pdf</span></span>
                  <button id="clear-selected-file" style="background:transparent; border:none; color:var(--color-text-secondary); cursor:pointer;"><i class="fas fa-times"></i></button>
                </div>

                <button class="btn btn-primary" id="upload-resume-btn" style="width:100%; margin-top:16px; min-height:44px;">
                  <i class="fas fa-plus"></i> Save Resume Version
                </button>
              </div>

              <!-- Job Description Card -->
              <div class="card" style="padding: 24px;">
                <h3 style="font-size: 1.05rem; font-weight: 800; color: var(--color-primary); margin-bottom: 16px;">
                  <i class="fas fa-briefcase" style="color: var(--color-secondary); margin-right: 6px;"></i> Job Description
                </h3>

                <!-- Import dropdown selector -->
                <div class="form-group">
                  <label for="analyzer-job-select">Import from Saved Applications</label>
                  <select id="analyzer-job-select" style="width:100%;">
                    <option value="">[Select an application to import...]</option>
                    ${jobs.map(j => `<option value="${j.id}" data-role="${j.role}" data-company="${j.company}">${j.company} - ${j.role}</option>`).join('')}
                  </select>
                </div>

                <div class="form-group">
                  <label for="analyzer-job-desc">Paste Job Description Details</label>
                  <textarea id="analyzer-job-desc" rows="6" placeholder="Paste the text of the job description here to analyze ATS match scores..." style="width:100%;"></textarea>
                </div>

                <!-- Select Resume to Compare -->
                <div class="form-group">
                  <label for="analyzer-select-resume-version">Select Resume Version to Analyze</label>
                  <select id="analyzer-select-resume-version" style="width:100%;">
                    <option value="">[Choose a saved resume version...]</option>
                    ${resumes.map(r => `<option value="${r.id}">${r.name} (${r.file_name})</option>`).join('')}
                  </select>
                </div>

                <button class="btn btn-secondary" id="trigger-analysis-btn" style="width:100%; min-height:44px; margin-top:8px; display:flex; align-items:center; justify-content:center; gap:8px;">
                  <i class="fas fa-magic"></i> Run ATS AI Analysis
                </button>
              </div>

            </div>

            <!-- Right Pane: Analysis Results & Version History -->
            <div style="display: flex; flex-direction: column; gap: 24px;">
              
              <!-- AI Analysis Results Visual Area (Hidden initially) -->
              <div class="analysis-results-box" id="analysis-results-mount" style="display: none;">
                <!-- HTML injected dynamically on success -->
              </div>

              <!-- Resume Version History Card -->
              <div class="resume-history-card">
                <h3 style="font-size: 1.05rem; font-weight: 800; color: var(--color-primary); margin-bottom: 16px; display: flex; align-items: center; justify-content: space-between;">
                  <span>Resume Version History</span>
                  <span class="badge-status" style="background-color: var(--color-primary-light); color: var(--color-primary);">${resumes.length} Versions</span>
                </h3>
                
                <div class="resume-history-list">
                  ${resumes.length === 0 ? `
                    <p style="color: var(--color-text-secondary); font-size: 0.88rem; font-style: italic; text-align:center; padding:24px 0;">No resume versions saved. Upload one above!</p>
                  ` : resumes.map(r => `
                    <div class="resume-version-row">
                      <div class="resume-version-info">
                        <div class="resume-version-icon">
                          <i class="far ${r.file_type === 'pdf' ? 'fa-file-pdf' : 'fa-file-word'}"></i>
                        </div>
                        <div>
                          <div class="resume-version-name">${r.name}</div>
                          <div class="resume-version-meta">${r.file_name} &bull; ${new Date(r.created_at).toLocaleDateString()}</div>
                        </div>
                      </div>
                      <div style="display: flex; gap: 8px;">
                        <button class="btn btn-outline btn-sm use-resume-btn" data-id="${r.id}" title="Select for analysis" style="padding: 6px 10px; font-size: 0.75rem; border-color: var(--color-secondary); color: var(--color-secondary);">
                          Select
                        </button>
                        <button class="btn btn-outline btn-sm delete-resume-btn" data-id="${r.id}" title="Delete version" style="padding: 6px 10px; font-size: 0.75rem; border-color: var(--color-danger); color: var(--color-danger);">
                          <i class="far fa-trash-alt"></i>
                        </button>
                      </div>
                    </div>
                  `).join('')}
                </div>
              </div>

            </div>
          </div>
        </div>
      `;

      attachPageListeners(jobs, resumes);

    } catch (err) {
      console.error(err);
      root.innerHTML = `
        <div style="padding: 40px; text-align: center;">
          <h2 style="font-size: 1.5rem; font-weight: 800; color: var(--color-primary); margin-bottom: 8px;">Failed to load resume details</h2>
          <p style="color: var(--color-text-secondary); margin-bottom: 24px;">${err.message}</p>
          <button onclick="window.location.reload();" class="btn btn-primary">Retry</button>
        </div>
      `;
    }
  }

  let selectedFile = null;

  function attachPageListeners(jobs, resumes) {
    const dropZone = document.getElementById('resume-drop-zone');
    const fileInput = document.getElementById('analyzer-file-input');
    const fileDetails = document.getElementById('selected-file-details');
    const fileNameText = document.getElementById('selected-file-name');
    const clearFileBtn = document.getElementById('clear-selected-file');
    
    // File inputs hooks
    dropZone?.addEventListener('click', () => fileInput?.click());
    
    fileInput?.addEventListener('change', (e) => {
      if (e.target.files.length > 0) {
        setFile(e.target.files[0]);
      }
    });

    // Drop handler
    dropZone?.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.style.borderColor = 'var(--color-primary)';
      dropZone.style.backgroundColor = 'rgba(37, 99, 235, 0.08)';
    });

    dropZone?.addEventListener('dragleave', () => {
      dropZone.style.borderColor = 'rgba(37, 99, 235, 0.25)';
      dropZone.style.backgroundColor = 'rgba(37, 99, 235, 0.02)';
    });

    dropZone?.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.style.borderColor = 'rgba(37, 99, 235, 0.25)';
      dropZone.style.backgroundColor = 'rgba(37, 99, 235, 0.02)';
      if (e.dataTransfer.files.length > 0) {
        setFile(e.dataTransfer.files[0]);
      }
    });

    clearFileBtn?.addEventListener('click', () => {
      selectedFile = null;
      if (fileInput) fileInput.value = '';
      if (fileDetails) fileDetails.style.display = 'none';
      if (dropZone) dropZone.style.display = 'block';
    });

    function setFile(file) {
      selectedFile = file;
      if (fileNameText) fileNameText.textContent = `${file.name} (${Math.round(file.size / 1024)} KB)`;
      if (fileDetails) fileDetails.style.display = 'flex';
      if (dropZone) dropZone.style.display = 'none';
    }

    // Save Resume Version button click
    document.getElementById('upload-resume-btn')?.addEventListener('click', async () => {
      const nameInput = document.getElementById('analyzer-resume-name');
      const versionName = nameInput ? nameInput.value.trim() : '';

      if (!versionName) {
        showToast("Please provide a name for this resume version", "error");
        return;
      }

      if (!selectedFile) {
        showToast("Please drag & drop or select a resume file (PDF/DOCX)", "error");
        return;
      }

      const fileExt = selectedFile.name.split('.').pop().toLowerCase();
      if (!['pdf', 'docx'].includes(fileExt)) {
        showToast("Unsupported format. Please upload PDF or DOCX only.", "error");
        return;
      }

      try {
        setButtonLoading(document.getElementById('upload-resume-btn'), true, "Save Resume Version");
        
        // Simulating parsing of file content
        const simulatedTextContent = `Osaze Resume content - version: ${versionName}. Skills: User Interface design, Figma design system builder, React coding, usability validations.`;
        
        await saveResumeVersion(versionName, selectedFile.name, fileExt, simulatedTextContent);
        showToast("Resume version saved successfully!", "success");
        loadAndRender();
      } catch (err) {
        showToast(err.message, 'error');
        setButtonLoading(document.getElementById('upload-resume-btn'), false, "Save Resume Version");
      }
    });

    // Delete Resume Version triggers
    document.querySelectorAll('.delete-resume-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const id = btn.getAttribute('data-id');
        if (confirm("Are you sure you want to delete this resume version?")) {
          try {
            await deleteResumeVersion(id);
            showToast("Resume version deleted", "success");
            loadAndRender();
          } catch (err) {
            showToast(err.message, 'error');
          }
        }
      });
    });

    // Use for analysis trigger
    document.querySelectorAll('.use-resume-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = btn.getAttribute('data-id');
        const selectEl = document.getElementById('analyzer-select-resume-version');
        if (selectEl) {
          selectEl.value = id;
          showToast("Resume version selected for analysis", "info");
        }
      });
    });

    // Select application to import job description details
    const jobSelect = document.getElementById('analyzer-job-select');
    jobSelect?.addEventListener('change', () => {
      const jobId = jobSelect.value;
      if (!jobId) return;

      const job = jobs.find(j => String(j.id) === String(jobId));
      const textarea = document.getElementById('analyzer-job-desc');
      if (job && textarea) {
        textarea.value = `Role: ${job.role}\nCompany: ${job.company}\nLocation: ${job.location || 'Remote'}\nSalary: ${job.salary_range || 'N/A'}\n\nKey Qualifications:\n- Strong experience in ${job.role} development and layouts.\n- Experience in collaboration and design systems.\n- Accessibility (WCAG 2.1) compliance audits.\n- Measurable track record of achievements and metrics.`;
        showToast("Job description imported!", "success");
      }
    });

    // Trigger AI Analysis
    const runAnalysisBtn = document.getElementById('trigger-analysis-btn');
    runAnalysisBtn?.addEventListener('click', () => {
      const jobDesc = document.getElementById('analyzer-job-desc')?.value.trim();
      const resumeId = document.getElementById('analyzer-select-resume-version')?.value;

      if (!jobDesc) {
        showToast("Please provide or import a job description", "error");
        return;
      }

      if (!resumeId) {
        showToast("Please select a resume version to compare", "error");
        return;
      }

      const activeResume = resumes.find(r => String(r.id) === String(resumeId));
      if (!activeResume) return;

      setButtonLoading(runAnalysisBtn, true, "Running ATS AI Analysis");

      setTimeout(() => {
        let score = 72;
        const lowercaseDesc = jobDesc.toLowerCase();
        
        if (lowercaseDesc.includes('accessibility') || lowercaseDesc.includes('wcag')) score += 5;
        if (lowercaseDesc.includes('design system')) score += 8;
        if (lowercaseDesc.includes('achievement') || lowercaseDesc.includes('conversion')) score += 6;
        if (lowercaseDesc.includes('leadership')) score += 4;
        
        score = Math.min(score, 97);

        const isCompatible = score >= 80;
        const atsBadgeClass = isCompatible ? 'badge-ats-compatible' : 'badge-ats-warning';
        const atsStatusText = isCompatible ? 'Excellent (ATS Compatible)' : 'Good (Minor Tweaks Needed)';

        const missingKeywords = [];
        if (lowercaseDesc.includes('accessibility') || lowercaseDesc.includes('wcag')) {
          missingKeywords.push("Accessibility (WCAG 2.1)");
        }
        if (lowercaseDesc.includes('design system')) {
          missingKeywords.push("Design Systems (Figma)");
        }
        if (lowercaseDesc.includes('leadership') || lowercaseDesc.includes('lead')) {
          missingKeywords.push("Leadership / Mentorship");
        }
        if (lowercaseDesc.includes('testing') || lowercaseDesc.includes('unit')) {
          missingKeywords.push("Unit Testing & CI/CD");
        }
        
        if (missingKeywords.length === 0) {
          missingKeywords.push("Accessibility Experience", "Figma Design Systems", "A/B Conversion Testing");
        }

        const strengths = [
          "Strong keyword alignment in core technical capabilities.",
          "Clear structure and format parser-compliant.",
          "Good experience representation in layout design."
        ];

        const weaknesses = [
          "Missing explicit design systems case studies details.",
          "Needs more quantifiable, measurable metric statements (e.g. % improvement)."
        ];

        const suggestions = [
          "<strong>Add measurable achievements</strong>: Change passive roles to outcomes (e.g., 'Improved dashboard conversion metrics by 15%').",
          "<strong>Mention design systems</strong>: Explicitly include Figma libraries and component libraries building experience.",
          "<strong>Include accessibility experience</strong>: Detail WCAG compliance audit processes and accessibility checks.",
          "<strong>Add leadership examples</strong>: Include mentorship of junior designers/engineers where applicable."
        ];

        const resultsMount = document.getElementById('analysis-results-mount');
        if (resultsMount) {
          resultsMount.style.display = 'block';
          resultsMount.innerHTML = `
            <div style="background-color: var(--color-surface); padding: 24px; border-bottom:1px solid var(--color-border);">
              <h3 style="font-size: 1.1rem; font-weight: 800; color: var(--color-primary); display: flex; align-items: center; gap: 8px;">
                <i class="fas fa-magic" style="color: var(--color-secondary);"></i> AI Analysis Report
              </h3>
            </div>
            
            <div class="analysis-split-row">
              <div class="ats-score-wrapper" style="background-color: #F8FAFC;">
                <div class="progress-ring-container" style="width:96px; height:96px;">
                  <svg width="96" height="96">
                    <circle cx="48" cy="48" r="42" stroke="var(--color-border)" stroke-width="8" fill="transparent" />
                    <circle cx="48" cy="48" r="42" stroke="${isCompatible ? '#10B981' : 'var(--color-secondary)'}" stroke-width="8" fill="transparent"
                      stroke-dasharray="263.8" stroke-dashoffset="${263.8 - (263.8 * score) / 100}"
                      stroke-linecap="round" transform="rotate(-90 48 48)" />
                  </svg>
                  <div class="progress-ring-text" style="font-size: 1.15rem; font-weight:800;">${score}%</div>
                </div>
                <div class="ats-score-badge ${atsBadgeClass}">${atsStatusText}</div>
                <div style="font-size: 0.72rem; color: var(--color-text-secondary); margin-top: 8px; text-align: center; font-weight: 600;">
                  Readability: 82% &bull; ATS Score: ${score}%
                </div>
              </div>

              <div class="analysis-details-pane">
                <div style="margin-bottom: 16px;">
                  <h4 style="font-size: 0.85rem; font-weight: 800; color: var(--color-primary); text-transform: uppercase; margin-bottom: 8px;">Missing Skills & Keywords</h4>
                  <div style="margin-top: 4px;">
                    ${missingKeywords.map(k => `<span class="ats-pill-badge missing"><i class="fas fa-exclamation-circle"></i> ${k}</span>`).join('')}
                  </div>
                </div>

                <div style="display: grid; grid-template-columns: 1fr; gap: 12px;">
                  <div>
                    <h4 style="font-size: 0.85rem; font-weight: 800; color: var(--color-success); text-transform: uppercase; margin-bottom: 4px;">Strengths</h4>
                    <ul style="padding-left: 18px; margin: 0; font-size: 0.82rem; color: var(--color-text); line-height:1.4;">
                      ${strengths.map(s => `<li>${s}</li>`).join('')}
                    </ul>
                  </div>
                  <div>
                    <h4 style="font-size: 0.85rem; font-weight: 800; color: var(--color-danger); text-transform: uppercase; margin-bottom: 4px;">Weaknesses</h4>
                    <ul style="padding-left: 18px; margin: 0; font-size: 0.82rem; color: var(--color-text); line-height:1.4;">
                      ${weaknesses.map(w => `<li>${w}</li>`).join('')}
                    </ul>
                  </div>
                </div>
              </div>
            </div>

            <div style="background-color: #F8FAFC; padding: 24px; border-top: 1px solid var(--color-border);">
              <h4 style="font-size: 0.85rem; font-weight: 800; color: var(--color-primary); text-transform: uppercase; margin-bottom: 12px; display: flex; align-items: center; gap: 6px;">
                <i class="fas fa-lightbulb" style="color: var(--color-warning);"></i> AI ATS Optimization Suggestions
              </h4>
              <ul style="padding-left: 18px; margin: 0; font-size: 0.85rem; color: var(--color-text); display: flex; flex-direction: column; gap: 8px;">
                ${suggestions.map(s => `<li>${s}</li>`).join('')}
              </ul>
            </div>
          `;
          resultsMount.scrollIntoView({ behavior: 'smooth' });
        }

        setButtonLoading(runAnalysisBtn, false, "Run ATS AI Analysis");
      }, 1000);
    });
  }

  await loadAndRender();
}

// 6B. INTERVIEWS PAGE
async function renderInterviews() {
  const root = getAppViewRoot();
  
  // Show spinner loading state first
  root.innerHTML = `
    <div style="display:flex; justify-content:center; align-items:center; min-height:400px; flex-direction:column; gap:16px;">
      <i class="fas fa-spinner fa-spin" style="font-size:2rem; color:var(--color-secondary);"></i>
      <p style="color:var(--color-text-secondary); font-weight:500;">Loading interviews & schedules...</p>
    </div>
  `;

  let activeModal = false;
  let editingInterviewId = null;

  async function loadAndRender() {
    try {
      const [interviews, jobs] = await Promise.all([
        fetchInterviews(),
        fetchJobs()
      ]);

      const formatLocalDate = (d) => {
        return d.toISOString().split('T')[0];
      };

      const getInterviewsForDate = (dateStr) => {
        return interviews.filter(i => i.date === dateStr);
      };

      const monthNames = [
        "January", "February", "March", "April", "May", "June", 
        "July", "August", "September", "October", "November", "December"
      ];

      const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
      const dayNamesShort = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

      let currentLabelText = "";
      if (calendarActiveView === 'month') {
        currentLabelText = `${monthNames[calendarSelectedDate.getMonth()]} ${calendarSelectedDate.getFullYear()}`;
      } else if (calendarActiveView === 'week') {
        const sunday = new Date(calendarSelectedDate);
        sunday.setDate(calendarSelectedDate.getDate() - calendarSelectedDate.getDay());
        const saturday = new Date(sunday);
        saturday.setDate(sunday.getDate() + 6);
        
        const formatShort = (d) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
        currentLabelText = `${formatShort(sunday)} - ${formatShort(saturday)}`;
      } else {
        currentLabelText = calendarSelectedDate.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });
      }

      root.innerHTML = `
        <div class="interviews-page-container">
          <!-- Page Header Controls -->
          <div class="interviews-header-row">
            <div>
              <h1 style="font-size: 1.75rem; font-weight: 800; color: var(--color-primary);">Interviews & Scheduling</h1>
              <p style="color: var(--color-text-secondary); margin-top: 4px;">Track upcoming events, calendar schedules, and recruiters.</p>
            </div>
            
            <button id="schedule-interview-trigger" class="btn btn-primary" style="display: flex; align-items: center; gap: 8px;">
              <i class="fas fa-plus"></i> Schedule Interview
            </button>
          </div>

          <!-- Controls subbar -->
          <div style="display: flex; justify-content: space-between; align-items: center; gap: 16px; flex-wrap: wrap; margin-bottom: 8px;">
            <div class="calendar-nav-controls">
              <button class="calendar-nav-btn" id="cal-prev" title="Previous"><i class="fas fa-chevron-left"></i></button>
              <button class="calendar-nav-btn" id="cal-today">Today</button>
              <button class="calendar-nav-btn" id="cal-next" title="Next"><i class="fas fa-chevron-right"></i></button>
              <span class="calendar-current-label">${currentLabelText}</span>
            </div>
            
            <div class="view-toggle-container">
              <button class="view-toggle-btn ${calendarActiveView === 'month' ? 'active' : ''}" data-view="month">Month</button>
              <button class="view-toggle-btn ${calendarActiveView === 'week' ? 'active' : ''}" data-view="week">Week</button>
              <button class="view-toggle-btn ${calendarActiveView === 'day' ? 'active' : ''}" data-view="day">Day</button>
            </div>
          </div>

          <!-- Split Page Grid -->
          <div class="interview-grid">
            <!-- Left pane: Calendar View card -->
            <div class="calendar-card-wrapper">
              <div id="calendar-view-mount" style="flex: 1; display: flex; flex-direction: column;"></div>
            </div>

            <!-- Right pane: Widgets list -->
            <div class="interviews-widgets">
              
              <!-- Selected Day Schedule Card -->
              <div class="interview-widget-card" style="border-top: 4px solid var(--color-primary);">
                <h3 style="font-size: 1.05rem; font-weight: 800; color: var(--color-primary); display: flex; align-items: center; justify-content: space-between;">
                  <span>Selected Date Schedule</span>
                  <span class="badge-status" style="background-color: var(--color-primary-light); color: var(--color-primary); font-size: 0.75rem; padding: 2px 8px;">
                    ${calendarSelectedDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                  </span>
                </h3>
                <div class="interview-widget-list">
                  ${(() => {
                    const dateStr = calendarSelectedDate.toISOString().split('T')[0];
                    const dayEvents = interviews.filter(i => i.date === dateStr);
                    if (dayEvents.length === 0) {
                      return `<p style="color: var(--color-text-secondary); font-size: 0.88rem; font-style: italic;">No interviews scheduled for this date.</p>`;
                    }
                    return dayEvents.map(event => {
                      const intDate = new Date(event.date + 'T' + event.time);
                      const formattedTime = intDate.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
                      return `
                        <div class="interview-item-row status-${event.status.toLowerCase()}" data-id="${event.id}">
                          <div class="interview-item-info">
                            <div class="interview-item-title">${event.company} &bull; ${event.role}</div>
                            <div class="interview-item-meta">
                              <span><i class="far fa-clock"></i> ${formattedTime}</span>
                              <span class="badge-status" style="background-color: var(--color-secondary-light); color: var(--color-secondary); font-size:0.65rem; padding: 2px 6px;">${event.interview_type}</span>
                            </div>
                            ${event.meeting_link ? `
                              <div style="margin-top: 8px;">
                                <a href="${event.meeting_link.startsWith('http') ? event.meeting_link : 'https://' + event.meeting_link}" target="_blank" class="btn btn-secondary btn-sm" style="display: inline-flex; align-items: center; gap: 6px; padding: 4px 8px; font-size:0.75rem; background-color: var(--color-secondary-light); color: var(--color-secondary); border-color: transparent;">
                                  <i class="fas fa-video"></i> Join Meeting
                                </a>
                              </div>
                            ` : ''}
                          </div>
                          <div class="interview-item-actions">
                            <button class="btn btn-outline btn-sm edit-int-btn" data-id="${event.id}" title="Edit interview" style="padding: 6px 8px; font-size:0.75rem; border-color:var(--color-border);"><i class="fas fa-pencil-alt"></i></button>
                            ${event.status === 'Upcoming' ? `
                              <button class="btn btn-outline btn-sm complete-int-btn" data-id="${event.id}" title="Mark completed" style="padding: 6px 8px; font-size:0.75rem; border-color:var(--color-success); color:var(--color-success);"><i class="fas fa-check"></i></button>
                              <button class="btn btn-outline btn-sm cancel-int-btn" data-id="${event.id}" title="Cancel interview" style="padding: 6px 8px; font-size:0.75rem; border-color:var(--color-danger); color:var(--color-danger);"><i class="fas fa-times"></i></button>
                            ` : ''}
                            <button class="btn btn-outline btn-sm delete-int-btn" data-id="${event.id}" title="Delete interview" style="padding: 6px 8px; font-size:0.75rem; border-color:var(--color-border); color:var(--color-danger);"><i class="far fa-trash-alt"></i></button>
                          </div>
                        </div>
                      `;
                    }).join('');
                  })()}
                </div>
              </div>

              <!-- Upcoming Interviews Card -->
              <div class="interview-widget-card" style="border-top: 4px solid var(--color-secondary);">
                <h3 style="font-size: 1.05rem; font-weight: 800; color: var(--color-primary); display: flex; align-items: center; justify-content: space-between;">
                  <span>Upcoming Interviews</span>
                  <span class="badge-status" style="background-color: var(--color-secondary-light); color: var(--color-secondary);">${interviews.filter(i => i.status === 'Upcoming').length}</span>
                </h3>
                
                <div class="interview-widget-list">
                  ${interviews.filter(i => i.status === 'Upcoming').length === 0 ? `
                    <p style="color: var(--color-text-secondary); font-size: 0.88rem; font-style: italic;">No upcoming interviews. Click Schedule to add one!</p>
                  ` : interviews.filter(i => i.status === 'Upcoming').map(int => {
                    const intDate = new Date(int.date + 'T' + int.time);
                    const formattedTime = intDate.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
                    const formattedDate = intDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
                    
                    return `
                      <div class="interview-item-row status-upcoming" data-id="${int.id}">
                        <div class="interview-item-info">
                          <div class="interview-item-title">${int.company} &bull; ${int.role}</div>
                          <div class="interview-item-meta">
                            <span><i class="far fa-calendar-alt"></i> ${formattedDate} at ${formattedTime} (${int.time_zone})</span>
                            <span class="badge-status" style="background-color: var(--color-secondary-light); color: var(--color-secondary); font-size:0.65rem; padding: 2px 6px;">${int.interview_type}</span>
                          </div>
                          ${int.meeting_link ? `
                            <div style="margin-top: 8px;">
                              <a href="${int.meeting_link.startsWith('http') ? int.meeting_link : 'https://' + int.meeting_link}" target="_blank" class="btn btn-secondary btn-sm" style="display: inline-flex; align-items: center; gap: 6px; padding: 4px 8px; font-size:0.75rem; background-color: var(--color-secondary-light); color: var(--color-secondary); border-color: transparent;">
                                <i class="fas fa-video"></i> Join Meeting
                              </a>
                            </div>
                          ` : ''}
                        </div>
                        <div class="interview-item-actions">
                          <button class="btn btn-outline btn-sm edit-int-btn" data-id="${int.id}" title="Edit interview" style="padding: 6px 8px; font-size:0.75rem; border-color:var(--color-border);"><i class="fas fa-pencil-alt"></i></button>
                          <button class="btn btn-outline btn-sm complete-int-btn" data-id="${int.id}" title="Mark completed" style="padding: 6px 8px; font-size:0.75rem; border-color:var(--color-success); color:var(--color-success);"><i class="fas fa-check"></i></button>
                          <button class="btn btn-outline btn-sm cancel-int-btn" data-id="${int.id}" title="Cancel interview" style="padding: 6px 8px; font-size:0.75rem; border-color:var(--color-danger); color:var(--color-danger);"><i class="fas fa-times"></i></button>
                        </div>
                      </div>
                    `;
                  }).join('')}
                </div>
              </div>

              <!-- Past/Completed/Cancelled Card -->
              <div class="interview-widget-card" style="border-top: 4px solid var(--color-border);">
                <h3 style="font-size: 1.05rem; font-weight: 800; color: var(--color-primary);">History</h3>
                
                <div class="interview-widget-list" style="max-height: 250px;">
                  ${interviews.filter(i => i.status !== 'Upcoming').length === 0 ? `
                    <p style="color: var(--color-text-secondary); font-size: 0.88rem; font-style: italic;">No completed or cancelled interviews yet.</p>
                  ` : interviews.filter(i => i.status !== 'Upcoming').map(int => {
                    const intDate = new Date(int.date + 'T' + int.time);
                    const formattedTime = intDate.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
                    const formattedDate = intDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
                    const isCompleted = int.status === 'Completed';
                    const statusClass = isCompleted ? 'status-completed' : 'status-cancelled';
                    const badgeBg = isCompleted ? 'var(--color-success-light)' : 'rgba(239, 68, 68, 0.1)';
                    const badgeColor = isCompleted ? 'var(--color-success)' : 'var(--color-danger)';
                    
                    return `
                      <div class="interview-item-row ${statusClass}">
                        <div class="interview-item-info">
                          <div class="interview-item-title" style="text-decoration: line-through; opacity: 0.65;">${int.company} &bull; ${int.role}</div>
                          <div class="interview-item-meta">
                            <span><i class="far fa-calendar-alt"></i> ${formattedDate} at ${formattedTime}</span>
                            <span class="badge-status" style="background-color: ${badgeBg}; color: ${badgeColor}; font-size:0.65rem; padding: 2px 6px;">${int.status}</span>
                          </div>
                        </div>
                        <div class="interview-item-actions">
                          <button class="btn btn-outline btn-sm delete-int-btn" data-id="${int.id}" title="Delete interview" style="padding: 6px 8px; font-size:0.75rem; border-color:var(--color-border); color:var(--color-danger);"><i class="far fa-trash-alt"></i></button>
                        </div>
                      </div>
                    `;
                  }).join('')}
                </div>
              </div>

            </div>
          </div>
        </div>
      `;

      mountCalendarView(interviews);
      attachPageListeners(jobs, interviews);

    } catch (err) {
      console.error(err);
      root.innerHTML = `
        <div style="padding: 40px; text-align: center;">
          <div style="background-color: var(--color-danger-light); color: var(--color-danger); width: 64px; height: 64px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 2rem; margin: 0 auto 24px auto;">
            <i class="fas fa-exclamation-triangle"></i>
          </div>
          <h2 style="font-size: 1.5rem; font-weight: 800; color: var(--color-primary); margin-bottom: 8px;">Failed to load interviews</h2>
          <p style="color: var(--color-text-secondary); margin-bottom: 24px;">${err.message}</p>
          <button onclick="window.location.reload();" class="btn btn-primary">Retry</button>
        </div>
      `;
    }
  }

  function mountCalendarView(interviews) {
    const calendarMount = document.getElementById('calendar-view-mount');
    if (!calendarMount) return;

    if (calendarActiveView === 'month') {
      renderMonthView(calendarMount, interviews);
    } else if (calendarActiveView === 'week') {
      renderWeekView(calendarMount, interviews);
    } else {
      renderDayView(calendarMount, interviews);
    }
  }

  function renderMonthView(mount, interviews) {
    const year = calendarSelectedDate.getFullYear();
    const month = calendarSelectedDate.getMonth();
    
    const firstDayIndex = new Date(year, month, 1).getDay(); // 0-6
    const lastDay = new Date(year, month + 1, 0).getDate();
    const prevLastDay = new Date(year, month, 0).getDate();
    
    let html = `
      <div class="calendar-month-grid">
        <div class="calendar-header-cell">Sun</div>
        <div class="calendar-header-cell">Mon</div>
        <div class="calendar-header-cell">Tue</div>
        <div class="calendar-header-cell">Wed</div>
        <div class="calendar-header-cell">Thu</div>
        <div class="calendar-header-cell">Fri</div>
        <div class="calendar-header-cell">Sat</div>
    `;

    // 1. Prev month trailing days
    for (let i = firstDayIndex; i > 0; i--) {
      const dateNum = prevLastDay - i + 1;
      const cellMonth = month === 0 ? 11 : month - 1;
      const cellYear = month === 0 ? year - 1 : year;
      const cellDateStr = `${cellYear}-${String(cellMonth + 1).padStart(2, '0')}-${String(dateNum).padStart(2, '0')}`;
      const dayEvents = interviews.filter(int => int.date === cellDateStr);

      html += `
        <div class="calendar-day-cell outside" data-date="${cellDateStr}">
          <span class="day-number">${dateNum}</span>
          <div class="day-events-container">
            ${dayEvents.map(event => {
              const badgeClass = getBadgeTypeClass(event.interview_type);
              const statusClass = event.status.toLowerCase();
              return `<span class="event-badge ${badgeClass} ${statusClass} desktop-event-badge" data-id="${event.id}">${event.company} (${event.interview_type.split(' ')[0]})</span>`;
            }).join('')}
            <div class="mobile-dots-row">
              ${dayEvents.map(event => {
                const dotColor = getEventBorderColor(event.interview_type);
                return `<span class="mobile-dot" style="background-color: ${dotColor};" title="${event.company}"></span>`;
              }).join('')}
            </div>
          </div>
        </div>
      `;
    }

    // 2. Current month days
    const today = new Date();
    for (let i = 1; i <= lastDay; i++) {
      const cellDateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
      const isToday = today.getDate() === i && today.getMonth() === month && today.getFullYear() === year;
      const dayEvents = interviews.filter(int => int.date === cellDateStr);

      html += `
        <div class="calendar-day-cell ${isToday ? 'today' : ''}" data-date="${cellDateStr}">
          <span class="day-number">${i}</span>
          <div class="day-events-container">
            ${dayEvents.map(event => {
              const badgeClass = getBadgeTypeClass(event.interview_type);
              const statusClass = event.status.toLowerCase();
              return `<span class="event-badge ${badgeClass} ${statusClass} desktop-event-badge" data-id="${event.id}" title="${event.company} - ${event.interview_type}">${event.company} (${event.interview_type.split(' ')[0]})</span>`;
            }).join('')}
            <div class="mobile-dots-row">
              ${dayEvents.map(event => {
                const dotColor = getEventBorderColor(event.interview_type);
                return `<span class="mobile-dot" style="background-color: ${dotColor};" title="${event.company}"></span>`;
              }).join('')}
            </div>
          </div>
        </div>
      `;
    }

    // 3. Next month leading days
    const totalCells = 42;
    const remainingCells = totalCells - (firstDayIndex + lastDay);
    for (let i = 1; i <= remainingCells; i++) {
      const cellMonth = month === 11 ? 0 : month + 1;
      const cellYear = month === 11 ? year + 1 : year;
      const cellDateStr = `${cellYear}-${String(cellMonth + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
      const dayEvents = interviews.filter(int => int.date === cellDateStr);

      html += `
        <div class="calendar-day-cell outside" data-date="${cellDateStr}">
          <span class="day-number">${i}</span>
          <div class="day-events-container">
            ${dayEvents.map(event => {
              const badgeClass = getBadgeTypeClass(event.interview_type);
              const statusClass = event.status.toLowerCase();
              return `<span class="event-badge ${badgeClass} ${statusClass} desktop-event-badge" data-id="${event.id}">${event.company} (${event.interview_type.split(' ')[0]})</span>`;
            }).join('')}
            <div class="mobile-dots-row">
              ${dayEvents.map(event => {
                const dotColor = getEventBorderColor(event.interview_type);
                return `<span class="mobile-dot" style="background-color: ${dotColor};" title="${event.company}"></span>`;
              }).join('')}
            </div>
          </div>
        </div>
      `;
    }

    html += `</div>`;
    mount.innerHTML = html;

    // Attach cell click handler to update selected date and reload schedule
    mount.querySelectorAll('.calendar-day-cell').forEach(cell => {
      cell.addEventListener('click', (e) => {
        if (e.target.closest('.desktop-event-badge') || e.target.closest('.mobile-dot')) return;
        const dateStr = cell.getAttribute('data-date');
        if (dateStr) {
          calendarSelectedDate = new Date(dateStr + 'T12:00:00');
          loadAndRender();
        }
      });
    });

    // Attach click handler to event badges to edit
    mount.querySelectorAll('.event-badge').forEach(badge => {
      badge.addEventListener('click', (e) => {
        e.stopPropagation();
        const intId = badge.getAttribute('data-id');
        openScheduleModal(intId);
      });
    });
  }

  function renderWeekView(mount, interviews) {
    const sunday = new Date(calendarSelectedDate);
    sunday.setDate(calendarSelectedDate.getDate() - calendarSelectedDate.getDay());
    
    const dayNamesShort = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const today = new Date();
    
    let html = `<div class="calendar-week-grid">`;
    
    for (let i = 0; i < 7; i++) {
      const currentDayDate = new Date(sunday);
      currentDayDate.setDate(sunday.getDate() + i);
      
      const dateStr = currentDayDate.toISOString().split('T')[0];
      const dateNum = currentDayDate.getDate();
      const dayName = dayNamesShort[i];
      const isToday = today.getDate() === dateNum && today.getMonth() === currentDayDate.getMonth() && today.getFullYear() === currentDayDate.getFullYear();
      
      const dayEvents = interviews.filter(int => int.date === dateStr);
      
      html += `
        <div class="week-column ${isToday ? 'today' : ''}" data-date="${dateStr}">
          <div class="week-column-header">
            <div class="week-day-name">${dayName}</div>
            <div class="week-day-date">${dateNum}</div>
          </div>
          <div class="week-events-list">
            ${dayEvents.length === 0 ? `
              <p style="color: var(--color-text-secondary); font-size: 0.75rem; text-align: center; margin-top: 24px; font-style: italic;">No events</p>
            ` : dayEvents.map(event => {
              const borderLeftColor = getEventBorderColor(event.interview_type);
              return `
                <div class="week-event-card" data-id="${event.id}" style="border-left: 3px solid ${borderLeftColor};">
                  <div class="week-event-time">${event.time}</div>
                  <div class="week-event-company">${event.company}</div>
                  <div class="week-event-type">${event.interview_type}</div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      `;
    }
    
    html += `</div>`;
    mount.innerHTML = html;

    // Attach click listeners to week columns/cards
    mount.querySelectorAll('.week-column').forEach(col => {
      col.addEventListener('click', (e) => {
        const card = e.target.closest('.week-event-card');
        if (card) {
          const intId = card.getAttribute('data-id');
          openScheduleModal(intId);
        } else {
          const dateStr = col.getAttribute('data-date');
          openScheduleModal(null, dateStr);
        }
      });
    });
  }

  function renderDayView(mount, interviews) {
    const dateStr = calendarSelectedDate.toISOString().split('T')[0];
    const dayEvents = interviews.filter(int => int.date === dateStr)
      .sort((a, b) => a.time.localeCompare(b.time));
    
    let html = `<div class="calendar-day-timeline">`;
    
    if (dayEvents.length === 0) {
      html += `
        <div style="text-align: center; padding: 48px; background-color: var(--color-bg); border-radius: 8px; border: 1px dashed var(--color-border);">
          <i class="far fa-calendar-times" style="font-size: 2rem; color: var(--color-text-secondary); margin-bottom: 12px; display: block;"></i>
          <p style="color: var(--color-text-secondary); font-size: 0.9rem; font-style: italic;">No interviews scheduled for this day.</p>
          <button class="btn btn-secondary btn-sm" id="timeline-add-interview-btn" style="margin-top: 12px;">
            <i class="fas fa-plus"></i> Schedule Interview
          </button>
        </div>
      `;
    } else {
      dayEvents.forEach(event => {
        const typeClass = getBadgeTypeClass(event.interview_type);
        const formatTime = (tStr) => {
          const [h, m] = tStr.split(':');
          const hr = parseInt(h);
          const ampm = hr >= 12 ? 'PM' : 'AM';
          const hr12 = hr % 12 || 12;
          return `${hr12}:${m} ${ampm}`;
        };
        
        html += `
          <div class="day-timeline-item">
            <div class="day-timeline-time">${formatTime(event.time)}</div>
            <div class="day-timeline-details ${typeClass}" data-id="${event.id}" style="cursor:pointer;">
              <div>
                <div class="day-timeline-title">${event.company} &bull; ${event.role}</div>
                <div class="day-timeline-subtitle">
                  <span class="badge-status" style="background-color: var(--color-secondary-light); color: var(--color-secondary); font-size: 0.65rem; padding: 2px 6px;">${event.interview_type}</span>
                  <span>Zone: ${event.time_zone}</span>
                  ${event.interviewer_name ? `<span>Interviewer: ${event.interviewer_name}</span>` : ''}
                </div>
                ${event.notes ? `<p style="margin: 8px 0 0 0; font-size: 0.8rem; color: var(--color-text-secondary); line-height: 1.4;">${event.notes}</p>` : ''}
              </div>
              
              <div style="display: flex; align-items: center; gap: 8px;">
                ${event.meeting_link ? `
                  <a href="${event.meeting_link.startsWith('http') ? event.meeting_link : 'https://' + event.meeting_link}" target="_blank" class="btn btn-secondary btn-sm" style="display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; font-size: 0.75rem;">
                    <i class="fas fa-video"></i> Join
                  </a>
                ` : ''}
                <button class="btn btn-outline btn-sm edit-day-int-btn" data-id="${event.id}"><i class="fas fa-pencil-alt"></i></button>
              </div>
            </div>
          </div>
        `;
      });
    }
    
    html += `</div>`;
    mount.innerHTML = html;

    // Attach click handlers
    document.getElementById('timeline-add-interview-btn')?.addEventListener('click', () => {
      openScheduleModal(null, dateStr);
    });

    mount.querySelectorAll('.day-timeline-details').forEach(card => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('a') || e.target.closest('button')) return;
        const intId = card.getAttribute('data-id');
        openScheduleModal(intId);
      });
    });

    mount.querySelectorAll('.edit-day-int-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const intId = btn.getAttribute('data-id');
        openScheduleModal(intId);
      });
    });
  }

  function getBadgeTypeClass(type) {
    if (type === 'Screening Call') return 'screening';
    if (type === 'HR Interview') return 'hr';
    if (type === 'Technical Interview') return 'technical';
    if (type === 'Portfolio Review') return 'portfolio';
    return 'final';
  }

  function getEventBorderColor(type) {
    if (type === 'Screening Call') return '#06B6D4';
    if (type === 'HR Interview') return '#8B5CF6';
    if (type === 'Technical Interview') return '#EC4899';
    if (type === 'Portfolio Review') return '#F59E0B';
    return '#10B981';
  }

  function attachPageListeners(jobs, interviews) {
    // 1. View Toggles (Month, Week, Day)
    document.querySelectorAll('.view-toggle-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        calendarActiveView = btn.getAttribute('data-view');
        loadAndRender();
      });
    });

    // 2. Navigation controls (Prev, Today, Next)
    document.getElementById('cal-today')?.addEventListener('click', () => {
      calendarSelectedDate = new Date();
      loadAndRender();
    });

    document.getElementById('cal-prev')?.addEventListener('click', () => {
      adjustSelectedDate(-1);
      loadAndRender();
    });

    document.getElementById('cal-next')?.addEventListener('click', () => {
      adjustSelectedDate( direction = 1);
      loadAndRender();
    });

    // 3. Trigger Schedule Interview Modal
    document.getElementById('schedule-interview-trigger')?.addEventListener('click', () => {
      openScheduleModal();
    });

    // 4. Quick Complete action
    document.querySelectorAll('.complete-int-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const intId = btn.getAttribute('data-id');
        try {
          btn.disabled = true;
          await updateInterview(intId, { status: 'Completed' });
          showToast("Interview marked as Completed", "success");
          loadAndRender();
        } catch (err) {
          btn.disabled = false;
          showToast(err.message, "error");
        }
      });
    });

    // 5. Quick Cancel action
    document.querySelectorAll('.cancel-int-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const intId = btn.getAttribute('data-id');
        try {
          btn.disabled = true;
          await updateInterview(intId, { status: 'Cancelled' });
          showToast("Interview cancelled", "info");
          loadAndRender();
        } catch (err) {
          btn.disabled = false;
          showToast(err.message, "error");
        }
      });
    });

    // 6. Delete action
    document.querySelectorAll('.delete-int-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm("Are you sure you want to delete this interview record?")) return;
        const intId = btn.getAttribute('data-id');
        try {
          btn.disabled = true;
          await deleteInterview(intId);
          showToast("Interview record deleted", "success");
          loadAndRender();
        } catch (err) {
          btn.disabled = false;
          showToast(err.message, "error");
        }
      });
    });

    // 6.5. Edit button action from upcoming widget list
    document.querySelectorAll('.edit-int-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const intId = btn.getAttribute('data-id');
        openScheduleModal(intId);
      });
    });

    // 7. Click list item rows to edit
    document.querySelectorAll('.interview-item-row.status-upcoming').forEach(row => {
      row.addEventListener('click', (e) => {
        if (e.target.closest('button') || e.target.closest('a')) return;
        const intId = row.getAttribute('data-id');
        openScheduleModal(intId);
      });
    });
  }

  function adjustSelectedDate(direction) {
    if (calendarActiveView === 'month') {
      calendarSelectedDate.setMonth(calendarSelectedDate.getMonth() + direction);
    } else if (calendarActiveView === 'week') {
      calendarSelectedDate.setDate(calendarSelectedDate.getDate() + (direction * 7));
    } else {
      calendarSelectedDate.setDate(calendarSelectedDate.getDate() + direction);
    }
  }

  async function openScheduleModal(interviewId = null, prefilledDate = null) {
    const isEdit = !!interviewId;
    editingInterviewId = interviewId;
    
    const jobs = await fetchJobs();

    let intData = {
      job_id: jobs.length > 0 ? jobs[0].id : 'new',
      interview_type: 'Screening Call',
      date: prefilledDate || new Date().toISOString().split('T')[0],
      time: '10:00',
      time_zone: 'EST',
      meeting_link: '',
      interviewer_name: '',
      interviewer_email: '',
      notes: '',
      reminders: ['1 Hour Before']
    };

    if (isEdit) {
      const interviews = await fetchInterviews();
      const matched = interviews.find(i => String(i.id) === String(interviewId));
      if (matched) intData = matched;
    }

    // Modal HTML overlay
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal-container" style="max-width: 550px;">
        <div class="modal-header" style="background-color: var(--color-primary); color: #FFFFFF; padding: 18px 24px;">
          <h3 style="font-size: 1.15rem; font-weight: 800; margin: 0; color:#FFFFFF;">
            ${isEdit ? '<i class="fas fa-edit"></i> Edit Interview Details' : '<i class="far fa-calendar-plus"></i> Schedule New Interview'}
          </h3>
          <button class="btn-close-modal" id="modal-close-btn" style="color: #FFFFFF; opacity: 0.85;"><i class="fas fa-times"></i></button>
        </div>
        <div class="modal-body" style="padding: 24px; max-height:70vh; overflow-y:auto; display:flex; flex-direction:column; gap:16px;">
          
          <div class="edit-form-group">
            <label style="font-size: 0.72rem; font-weight: 800; color: var(--color-text-secondary); text-transform: uppercase;">Job Application</label>
            <select id="form-int-job" class="status-select" style="width:100%;" ${isEdit ? 'disabled' : ''}>
              ${!isEdit ? `<option value="new" ${intData.job_id === 'new' ? 'selected' : ''}>[Create New Application...]</option>` : ''}
              ${jobs.map(j => `<option value="${j.id}" ${String(j.id) === String(intData.job_id) ? 'selected' : ''}>${j.company} - ${j.role}</option>`).join('')}
            </select>
          </div>

          <!-- New Job Inputs (Shown if "new" is selected) -->
          <div id="new-job-inputs-wrapper" style="display:${intData.job_id === 'new' ? 'grid' : 'none'}; grid-template-columns: 1fr 1fr; gap: 16px;">
            <div class="edit-form-group">
              <label style="font-size: 0.72rem; font-weight: 800; color: var(--color-text-secondary); text-transform: uppercase;">Company Name</label>
              <input type="text" id="form-new-company" class="detail-input" placeholder="e.g. Google">
            </div>
            <div class="edit-form-group">
              <label style="font-size: 0.72rem; font-weight: 800; color: var(--color-text-secondary); text-transform: uppercase;">Job Title / Role</label>
              <input type="text" id="form-new-role" class="detail-input" placeholder="e.g. Product Designer">
            </div>
          </div>

          <div style="display:grid; grid-template-columns: 1.2fr 1fr; gap:16px;">
            <div class="edit-form-group">
              <label style="font-size: 0.72rem; font-weight: 800; color: var(--color-text-secondary); text-transform: uppercase;">Interview Type</label>
              <select id="form-int-type" class="status-select" style="width:100%;">
                <option value="Screening Call" ${intData.interview_type === 'Screening Call' ? 'selected' : ''}>Screening Call</option>
                <option value="HR Interview" ${intData.interview_type === 'HR Interview' ? 'selected' : ''}>HR Interview</option>
                <option value="Technical Interview" ${intData.interview_type === 'Technical Interview' ? 'selected' : ''}>Technical Interview</option>
                <option value="Portfolio Review" ${intData.interview_type === 'Portfolio Review' ? 'selected' : ''}>Portfolio Review</option>
                <option value="Final Interview" ${intData.interview_type === 'Final Interview' ? 'selected' : ''}>Final Interview</option>
              </select>
            </div>
            
            <div class="edit-form-group">
              <label style="font-size: 0.72rem; font-weight: 800; color: var(--color-text-secondary); text-transform: uppercase;">Status</label>
              <select id="form-int-status" class="status-select" style="width:100%;">
                <option value="Upcoming" ${intData.status === 'Upcoming' ? 'selected' : ''}>Upcoming</option>
                <option value="Completed" ${intData.status === 'Completed' ? 'selected' : ''}>Completed</option>
                <option value="Cancelled" ${intData.status === 'Cancelled' ? 'selected' : ''}>Cancelled</option>
              </select>
            </div>
          </div>

          <div style="display:grid; grid-template-columns: repeat(3, 1fr); gap:12px;">
            <div class="edit-form-group">
              <label style="font-size: 0.72rem; font-weight: 800; color: var(--color-text-secondary); text-transform: uppercase;">Date</label>
              <input type="date" id="form-int-date" class="detail-input" value="${intData.date}">
            </div>
            <div class="edit-form-group">
              <label style="font-size: 0.72rem; font-weight: 800; color: var(--color-text-secondary); text-transform: uppercase;">Time</label>
              <input type="time" id="form-int-time" class="detail-input" value="${intData.time}">
            </div>
            <div class="edit-form-group">
              <label style="font-size: 0.72rem; font-weight: 800; color: var(--color-text-secondary); text-transform: uppercase;">Time Zone</label>
              <input type="text" id="form-int-zone" class="detail-input" value="${intData.time_zone}" placeholder="EST / PST">
            </div>
          </div>

          <div class="edit-form-group">
            <label style="font-size: 0.72rem; font-weight: 800; color: var(--color-text-secondary); text-transform: uppercase;">Meeting Link (Zoom, Meet, Teams...)</label>
            <input type="url" id="form-int-link" class="detail-input" value="${intData.meeting_link || ''}" placeholder="https://zoom.us/j/12345678">
          </div>

          <div style="display:grid; grid-template-columns: 1.2fr 1fr; gap:16px;">
            <div class="edit-form-group">
              <label style="font-size: 0.72rem; font-weight: 800; color: var(--color-text-secondary); text-transform: uppercase;">Interviewer Name</label>
              <input type="text" id="form-int-name" class="detail-input" value="${intData.interviewer_name || ''}" placeholder="Sarah Jenkins">
            </div>
            <div class="edit-form-group">
              <label style="font-size: 0.72rem; font-weight: 800; color: var(--color-text-secondary); text-transform: uppercase;">Interviewer Email</label>
              <input type="email" id="form-int-email" class="detail-input" value="${intData.interviewer_email || ''}" placeholder="sarah@company.com">
            </div>
          </div>

          <div class="edit-form-group">
            <label style="font-size: 0.72rem; font-weight: 800; color: var(--color-text-secondary); text-transform: uppercase;">Reminder Notifications</label>
            <div class="reminder-pills-row">
              <label class="reminder-checkbox-label ${intData.reminders.includes('24 Hours Before') ? 'checked' : ''}">
                <input type="checkbox" value="24 Hours Before" ${intData.reminders.includes('24 Hours Before') ? 'checked' : ''}> 24h Before
              </label>
              <label class="reminder-checkbox-label ${intData.reminders.includes('1 Hour Before') ? 'checked' : ''}">
                <input type="checkbox" value="1 Hour Before" ${intData.reminders.includes('1 Hour Before') ? 'checked' : ''}> 1h Before
              </label>
              <label class="reminder-checkbox-label ${intData.reminders.includes('15 Minutes Before') ? 'checked' : ''}">
                <input type="checkbox" value="15 Minutes Before" ${intData.reminders.includes('15 Minutes Before') ? 'checked' : ''}> 15m Before
              </label>
            </div>
          </div>

          <div class="edit-form-group">
            <label style="font-size: 0.72rem; font-weight: 800; color: var(--color-text-secondary); text-transform: uppercase;">Notes</label>
            <textarea id="form-int-notes" class="detail-textarea" placeholder="Questions to ask, dress code, portfolio focus areas...">${intData.notes || ''}</textarea>
          </div>
          
        </div>
        <div class="modal-footer" style="background-color: var(--color-bg); padding: 16px 24px; border-top: 1px solid var(--color-border); display:flex; justify-content:flex-end; gap:12px;">
          ${isEdit ? `
            <button id="modal-delete-int-btn" class="btn btn-outline" style="border-color:var(--color-danger); color:var(--color-danger); margin-right:auto;">
              <i class="far fa-trash-alt"></i> Delete Record
            </button>
          ` : ''}
          <button id="modal-cancel-btn" class="btn btn-secondary">Cancel</button>
          <button id="modal-save-btn" class="btn btn-primary">
            <i class="fas fa-save"></i> ${isEdit ? 'Save Changes' : 'Schedule'}
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // Toggle inline company and role inputs if "new" is selected
    const jobSelect = document.getElementById('form-int-job');
    const newJobWrapper = document.getElementById('new-job-inputs-wrapper');
    if (jobSelect && newJobWrapper) {
      jobSelect.addEventListener('change', () => {
        if (jobSelect.value === 'new') {
          newJobWrapper.style.display = 'grid';
        } else {
          newJobWrapper.style.display = 'none';
        }
      });
    }

    // Attach modal events
    const closeModal = () => {
      modal.remove();
    };

    document.getElementById('modal-close-btn').addEventListener('click', closeModal);
    document.getElementById('modal-cancel-btn').addEventListener('click', closeModal);
    
    // Checkbox pill visual toggle classes
    modal.querySelectorAll('.reminder-checkbox-label input[type=checkbox]').forEach(cb => {
      cb.addEventListener('change', () => {
        const parent = cb.closest('.reminder-checkbox-label');
        if (cb.checked) {
          parent.classList.add('checked');
        } else {
          parent.classList.remove('checked');
        }
      });
    });

    if (isEdit) {
      document.getElementById('modal-delete-int-btn').addEventListener('click', async () => {
        if (!confirm("Are you sure you want to delete this interview record?")) return;
        try {
          await deleteInterview(interviewId);
          showToast("Interview record deleted", "success");
          closeModal();
          loadAndRender();
        } catch (err) {
          showToast(err.message, "error");
        }
      });
    }

    document.getElementById('modal-save-btn').addEventListener('click', async () => {
      let jobIdVal = document.getElementById('form-int-job').value;
      const typeVal = document.getElementById('form-int-type').value;
      const statusVal = document.getElementById('form-int-status').value;
      const dateVal = document.getElementById('form-int-date').value;
      const timeVal = document.getElementById('form-int-time').value;
      const zoneVal = document.getElementById('form-int-zone').value.trim();
      const linkVal = document.getElementById('form-int-link').value.trim();
      const nameVal = document.getElementById('form-int-name').value.trim();
      const emailVal = document.getElementById('form-int-email').value.trim();
      const notesVal = document.getElementById('form-int-notes').value.trim();

      const reminderVals = [];
      modal.querySelectorAll('.reminder-pills-row input[type=checkbox]:checked').forEach(cb => {
        reminderVals.push(cb.value);
      });

      if (!dateVal || !timeVal) {
        showToast("Please select a valid date and time.", "error");
        return;
      }

      try {
        const saveBtn = document.getElementById('modal-save-btn');
        saveBtn.disabled = true;

        if (jobIdVal === 'new') {
          const companyName = document.getElementById('form-new-company').value.trim();
          const roleName = document.getElementById('form-new-role').value.trim();
          if (!companyName || !roleName) {
            showToast("Please enter both Company Name and Job Title", "error");
            saveBtn.disabled = false;
            return;
          }
          
          const createdJobs = await saveJobs([{
            company: companyName,
            role: roleName,
            status: 'interview',
            source: 'Manual Entry'
          }]);
          
          if (createdJobs && createdJobs.length > 0) {
            jobIdVal = createdJobs[0].id;
          } else {
            showToast("Failed to create new job application", "error");
            saveBtn.disabled = false;
            return;
          }
        }

        const postData = {
          job_id: jobIdVal,
          interview_type: typeVal,
          status: statusVal,
          date: dateVal,
          time: timeVal,
          time_zone: zoneVal || 'EST',
          meeting_link: linkVal,
          interviewer_name: nameVal,
          interviewer_email: emailVal,
          notes: notesVal,
          reminders: reminderVals
        };

        if (isEdit) {
          await updateInterview(interviewId, postData);
          showToast("Interview updated successfully", "success");
        } else {
          await createInterview(postData);
          showToast("Interview scheduled successfully", "success");
        }
        
        closeModal();
        loadAndRender();
      } catch (err) {
        document.getElementById('modal-save-btn').disabled = false;
        showToast(err.message, "error");
      }
    });
  }

  // Initial load
  await loadAndRender();
}

// 7. APPLICATION DETAIL PAGE
async function renderApplicationDetail(jobId) {
  const root = getAppViewRoot();
  
  // Show spinner loading state first
  root.innerHTML = `
    <div style="display:flex; justify-content:center; align-items:center; min-height:400px; flex-direction:column; gap:16px;">
      <i class="fas fa-spinner fa-spin" style="font-size:2rem; color:var(--color-secondary);"></i>
      <p style="color:var(--color-text-secondary); font-weight:500;">Loading application details...</p>
    </div>
  `;

  // Local state for edit forms
  let isEditingRecruiter = false;
  let isEditingMetadata = false;
  let editingNoteId = null;

  async function loadAndRender() {
    try {
      const [{ job, notes, attachments, activities }, resumes] = await Promise.all([
        fetchJobDetails(jobId),
        fetchResumes()
      ]);

      const initial = job.company ? job.company.charAt(0).toUpperCase() : 'A';
      const avatarColor = getAvatarColor(initial);
      
      let displayAppliedDate = 'N/A';
      if (job.date) {
        if (job.date.includes('-')) {
          const dateObj = new Date(job.date);
          if (!isNaN(dateObj)) {
            displayAppliedDate = dateObj.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
          }
        } else {
          displayAppliedDate = job.date;
        }
      }

      let displayUpdatedDate = 'Just now';
      if (job.updated_at) {
        displayUpdatedDate = getRelativeTimeString(job.updated_at);
      }

      root.innerHTML = `
        <div class="application-detail-page">
          <!-- Back navigation -->
          <div class="back-btn-row">
            <a href="#/dashboard" class="back-btn">
              <i class="fas fa-arrow-left"></i> Back to Dashboard
            </a>
          </div>

          <!-- Header details -->
          <div class="detail-header">
            <div class="detail-header-left">
              <div class="detail-company-avatar" style="background-color: ${avatarColor}20; color: ${avatarColor};">
                ${initial}
              </div>
              <div class="detail-title-area">
                <h1>${job.role}</h1>
                <p>
                  <strong style="color: var(--color-primary);">${job.company}</strong>
                  <span style="color: var(--color-border);">|</span>
                  <span>Via ${job.source}</span>
                </p>
              </div>
            </div>
            
            <div class="status-select-wrapper">
              <span class="status-select-label">Status</span>
              <select id="detail-status-select" class="status-select">
                <option value="applied" ${job.status === 'applied' ? 'selected' : ''}>Applied</option>
                <option value="assessment" ${job.status === 'assessment' ? 'selected' : ''}>Assessment</option>
                <option value="interview" ${job.status === 'interview' ? 'selected' : ''}>Interviewing</option>
                <option value="offer" ${job.status === 'offer' ? 'selected' : ''}>Offer</option>
                <option value="rejected" ${job.status === 'rejected' ? 'selected' : ''}>Rejected</option>
              </select>
            </div>
          </div>

          <!-- Split layout -->
          <div class="detail-grid">
            <!-- Left Column: Timeline, Notes, Attachments -->
            <div class="detail-left-pane">
              
              <!-- Notes Section -->
              <div class="detail-card">
                <h3 class="detail-card-title">
                  <span><i class="far fa-clipboard" style="margin-right: 8px;"></i> Notes</span>
                </h3>
                
                <div class="notes-list" id="detail-notes-list">
                  ${notes.length === 0 ? `
                    <p style="color: var(--color-text-secondary); font-size: 0.9rem; font-style: italic; margin: 0;">No notes added yet. Add one below.</p>
                  ` : notes.map(note => {
                    const isNoteEditing = editingNoteId === String(note.id);
                    return `
                      <div class="note-card" data-note-id="${note.id}">
                        <div class="note-card-header">
                          <span>${getRelativeTimeString(note.created_at)}</span>
                          <div class="note-card-actions">
                            ${isNoteEditing ? '' : `
                              <button class="edit-btn" data-action="edit-note" data-note-id="${note.id}" title="Edit Note"><i class="fas fa-pencil-alt"></i></button>
                              <button class="delete-btn" data-action="delete-note" data-note-id="${note.id}" title="Delete Note"><i class="far fa-trash-alt"></i></button>
                            `}
                          </div>
                        </div>
                        <div class="note-card-body">
                          ${isNoteEditing ? `
                            <div class="note-form" style="margin-top: 8px;">
                              <textarea id="edit-note-text-${note.id}" class="detail-textarea">${note.content}</textarea>
                              <div class="edit-actions">
                                <button class="btn btn-secondary btn-sm" id="edit-note-cancel-${note.id}">Cancel</button>
                                <button class="btn btn-primary btn-sm" id="edit-note-save-${note.id}">Save Note</button>
                              </div>
                            </div>
                          ` : note.content}
                        </div>
                      </div>
                    `;
                  }).join('')}
                </div>

                <!-- Add Note Form -->
                <div class="note-form" style="border-top: 1px solid var(--color-border); padding-top: 20px;">
                  <textarea id="new-note-text" class="detail-textarea" placeholder="Add a new note (e.g. Interview scheduled for Friday, Hiring manager liked portfolio...)"></textarea>
                  <button id="add-note-btn" class="btn btn-primary btn-sm" style="align-self: flex-end;">
                    <i class="fas fa-plus"></i> Add Note
                  </button>
                </div>
              </div>

              <!-- Attachments Section -->
              <div class="detail-card">
                <h3 class="detail-card-title">
                  <span><i class="fas fa-paperclip" style="margin-right: 8px;"></i> Attachments</span>
                </h3>
                
                <div class="attachments-list" id="detail-attachments-list">
                  ${attachments.length === 0 ? `
                    <p style="color: var(--color-text-secondary); font-size: 0.9rem; font-style: italic; margin: 0 0 16px 0;">No attachments uploaded yet.</p>
                  ` : attachments.map(att => `
                    <div class="attachment-card">
                      <a href="${att.file_url}" target="_blank" class="attachment-info-cell" title="Click to view file">
                        <i class="far ${att.file_name.endsWith('.pdf') ? 'fa-file-pdf' : 'fa-file-alt'}"></i>
                        <div style="min-width: 0;">
                          <div class="attachment-name">${att.file_name}</div>
                          <div class="attachment-meta">${att.file_type.replace('_', ' ').toUpperCase()} &bull; Synced ${getRelativeTimeString(att.created_at)}</div>
                        </div>
                      </a>
                      <button class="attachment-delete-btn" data-action="delete-attachment" data-attachment-id="${att.id}">
                        <i class="far fa-trash-alt"></i>
                      </button>
                    </div>
                  `).join('')}
                </div>

                <div class="upload-btn-wrapper">
                  <button class="btn btn-secondary" style="width: 100%; display: flex; align-items: center; justify-content: center; gap: 8px;">
                    <i class="fas fa-cloud-upload-alt"></i> Upload PDF/Document
                  </button>
                  <input type="file" id="attachment-file-input" accept=".pdf,.doc,.docx,.txt,image/*">
                </div>
              </div>

              <!-- Activity Timeline Section -->
              <div class="detail-card">
                <h3 class="detail-card-title">
                  <span><i class="fas fa-history" style="margin-right: 8px;"></i> Activity Timeline</span>
                </h3>
                
                <div class="timeline-container">
                  <div class="timeline-line"></div>
                  ${activities.length === 0 ? `
                    <p style="color: var(--color-text-secondary); font-size: 0.9rem; font-style: italic; margin: 0;">No activities logged yet.</p>
                  ` : activities.map(act => `
                    <div class="timeline-item">
                      <div class="timeline-bullet ${act.event_type || 'created'}"></div>
                      <div class="timeline-header">
                        <span class="timeline-title">${act.description}</span>
                        <span class="timeline-time">${getRelativeTimeString(act.created_at)}</span>
                      </div>
                    </div>
                  `).join('')}
                </div>
              </div>

            </div>

            <!-- Right Column: Recruiter Info, Metadata -->
            <div class="detail-right-pane">
              
              <!-- Recruiter Card -->
              <div class="detail-card">
                <h3 class="detail-card-title">
                  <span><i class="far fa-address-card" style="margin-right: 8px;"></i> Recruiter Information</span>
                  ${isEditingRecruiter ? '' : `
                    <button class="btn btn-link" id="edit-recruiter-btn" style="padding: 0; color: var(--color-secondary); font-size: 0.9rem;" title="Edit contacts">
                      <i class="fas fa-pencil-alt"></i> Edit
                    </button>
                  `}
                </h3>

                ${isEditingRecruiter ? `
                  <div class="edit-form">
                    <div class="edit-form-group">
                      <label>Name</label>
                      <input type="text" id="edit-recruiter-name" class="detail-input" value="${job.recruiter_name || ''}" placeholder="Sarah Jenkins">
                    </div>
                    <div class="edit-form-group">
                      <label>Email</label>
                      <input type="email" id="edit-recruiter-email" class="detail-input" value="${job.recruiter_email || ''}" placeholder="sarah@company.com">
                    </div>
                    <div class="edit-form-group">
                      <label>LinkedIn URL</label>
                      <input type="url" id="edit-recruiter-linkedin" class="detail-input" value="${job.recruiter_linkedin || ''}" placeholder="linkedin.com/in/username">
                    </div>
                    <div class="edit-form-group">
                      <label>Phone Number</label>
                      <input type="tel" id="edit-recruiter-phone" class="detail-input" value="${job.recruiter_phone || ''}" placeholder="+1 (555) 012-3456">
                    </div>
                    <div class="edit-actions">
                      <button class="btn btn-secondary btn-sm" id="cancel-recruiter-edit">Cancel</button>
                      <button class="btn btn-primary btn-sm" id="save-recruiter-edit">Save Contacts</button>
                    </div>
                  </div>
                ` : `
                  <div class="recruiter-contacts">
                    <div class="recruiter-contact-item">
                      <i class="fas fa-user"></i>
                      <span>${job.recruiter_name || '<span style="color: var(--color-text-secondary); font-style: italic;">Not specified</span>'}</span>
                    </div>
                    <div class="recruiter-contact-item">
                      <i class="fas fa-envelope"></i>
                      <span>
                        ${job.recruiter_email ? `
                          <a href="mailto:${job.recruiter_email}">${job.recruiter_email}</a>
                        ` : '<span style="color: var(--color-text-secondary); font-style: italic;">Not specified</span>'}
                      </span>
                    </div>
                    <div class="recruiter-contact-item">
                      <i class="fab fa-linkedin"></i>
                      <span>
                        ${job.recruiter_linkedin ? `
                          <a href="${job.recruiter_linkedin.startsWith('http') ? job.recruiter_linkedin : 'https://' + job.recruiter_linkedin}" target="_blank">LinkedIn Profile</a>
                        ` : '<span style="color: var(--color-text-secondary); font-style: italic;">Not specified</span>'}
                      </span>
                    </div>
                    <div class="recruiter-contact-item">
                      <i class="fas fa-phone"></i>
                      <span>${job.recruiter_phone || '<span style="color: var(--color-text-secondary); font-style: italic;">Not specified</span>'}</span>
                    </div>
                  </div>
                `}
              </div>

              <!-- Job Info Card -->
              <div class="detail-card">
                <h3 class="detail-card-title">
                  <span><i class="fas fa-info-circle" style="margin-right: 8px;"></i> Job Information</span>
                  ${isEditingMetadata ? '' : `
                    <button class="btn btn-link" id="edit-metadata-btn" style="padding: 0; color: var(--color-secondary); font-size: 0.9rem;" title="Edit details">
                      <i class="fas fa-pencil-alt"></i> Edit
                    </button>
                  `}
                </h3>

                ${isEditingMetadata ? `
                  <div class="edit-form">
                    <div class="edit-form-group">
                      <label>Employment Type</label>
                      <select id="edit-job-type" class="status-select" style="width: 100%;">
                        <option value="Full-time" ${job.employment_type === 'Full-time' ? 'selected' : ''}>Full-time</option>
                        <option value="Part-time" ${job.employment_type === 'Part-time' ? 'selected' : ''}>Part-time</option>
                        <option value="Contract" ${job.employment_type === 'Contract' ? 'selected' : ''}>Contract</option>
                        <option value="Internship" ${job.employment_type === 'Internship' ? 'selected' : ''}>Internship</option>
                      </select>
                    </div>
                    <div class="edit-form-group">
                      <label>Location</label>
                      <input type="text" id="edit-job-location" class="detail-input" value="${job.location || ''}" placeholder="Remote / San Francisco, CA">
                    </div>
                    <div class="edit-form-group">
                      <label>Salary Range</label>
                      <input type="text" id="edit-job-salary" class="detail-input" value="${job.salary_range || ''}" placeholder="$120,000 - $150,000">
                    </div>
                    <div class="edit-form-group">
                      <label>Job Posting URL</label>
                      <input type="url" id="edit-job-url" class="detail-input" value="${job.job_url || ''}" placeholder="https://company.com/jobs/posting">
                    </div>
                    <div class="edit-actions">
                      <button class="btn btn-secondary btn-sm" id="cancel-metadata-edit">Cancel</button>
                      <button class="btn btn-primary btn-sm" id="save-metadata-edit">Save Details</button>
                    </div>
                  </div>
                ` : `
                  <div class="info-grid">
                    <div class="info-item">
                      <span class="info-item-label">Job Type</span>
                      <span class="info-item-value">${job.employment_type || 'Full-time'}</span>
                    </div>
                    <div class="info-item">
                      <span class="info-item-label">Location</span>
                      <span class="info-item-value">${job.location || 'N/A'}</span>
                    </div>
                    <div class="info-item">
                      <span class="info-item-label">Salary Range</span>
                      <span class="info-item-value">${job.salary_range || 'N/A'}</span>
                    </div>
                    <div class="info-item">
                      <span class="info-item-label">Job URL</span>
                      <span class="info-item-value">
                        ${job.job_url ? `
                          <a href="${job.job_url.startsWith('http') ? job.job_url : 'https://' + job.job_url}" target="_blank">View Posting <i class="fas fa-external-link-alt" style="font-size:0.75rem;"></i></a>
                        ` : '<span style="color: var(--color-text-secondary); font-style: italic;">N/A</span>'}
                      </span>
                    </div>
                    <div class="info-item">
                      <span class="info-item-label">Date Applied</span>
                      <span class="info-item-value">${displayAppliedDate}</span>
                    </div>
                    <div class="info-item">
                      <span class="info-item-label">Last Updated</span>
                      <span class="info-item-value" style="font-size:0.85rem; color:var(--color-text-secondary);">${displayUpdatedDate}</span>
                    </div>
                  </div>
                `}
              </div>

              <!-- Follow-Up Details Card -->
              <div class="detail-card">
                <h3 class="detail-card-title">
                  <span><i class="fas fa-reply" style="margin-right: 8px;"></i> Follow-Up Tracking</span>
                </h3>
                
                <!-- Smart Alert Warning inside Follow-Up card if recommended -->
                ${(() => {
                  if (job.status === 'applied') {
                    const jDate = parseJobDate(job);
                    const diffMs = new Date() - jDate;
                    const diffDays = Math.floor(diffMs / (24 * 3600 * 1000));
                    if (diffDays >= 14) {
                      return `
                        <div class="follow-up-alert-notice">
                          <i class="fas fa-exclamation-circle"></i>
                          <div>
                            <div class="follow-up-alert-title">Follow-up Recommended</div>
                            <div class="follow-up-alert-desc">Submitted ${diffDays} days ago with no response.</div>
                          </div>
                        </div>
                      `;
                    }
                  }
                  return '';
                })()}

                <div class="edit-form" style="display: block;">
                  <div class="edit-form-group">
                    <label>Follow-Up Status</label>
                    <select id="detail-follow-up-status" class="status-select" style="width: 100%;">
                      <option value="none" ${job.follow_up_status === 'none' || !job.follow_up_status ? 'selected' : ''}>None</option>
                      <option value="pending" ${job.follow_up_status === 'pending' ? 'selected' : ''}>Scheduled / Pending</option>
                      <option value="completed" ${job.follow_up_status === 'completed' ? 'selected' : ''}>Completed</option>
                    </select>
                  </div>
                  <div class="edit-form-group">
                    <label>Target Follow-Up Date</label>
                    <input type="date" id="detail-follow-up-date" class="detail-input" value="${job.follow_up_date ? job.follow_up_date.split('T')[0] : ''}">
                  </div>
                  <div class="edit-form-group">
                    <label>Last Outreach Date</label>
                    <input type="date" id="detail-last-follow-up" class="detail-input" value="${job.last_follow_up ? job.last_follow_up.split('T')[0] : ''}">
                  </div>
                  <button id="save-follow-up-btn" class="btn btn-primary btn-sm" style="width: 100%; display: flex; align-items: center; justify-content: center; gap: 8px;">
                    <i class="fas fa-save"></i> Save Follow-Up Plan
                  </button>
                </div>
              </div>

              <!-- Resume Version Card -->
              <div class="detail-card">
                <h3 class="detail-card-title">
                  <span><i class="fas fa-file-invoice" style="margin-right: 8px;"></i> Assigned Resume</span>
                </h3>
                
                <div class="edit-form" style="display: block;">
                  <div class="edit-form-group">
                    <label for="detail-resume-select">Resume Version</label>
                    <select id="detail-resume-select" class="status-select" style="width: 100%;">
                      <option value="">[No Resume Version Assigned]</option>
                      ${resumes.map(r => `
                        <option value="${r.id}" ${String(job.resume_id) === String(r.id) ? 'selected' : ''}>${r.name}</option>
                      `).join('')}
                    </select>
                  </div>
                  
                  ${(() => {
                    if (job.resume_id) {
                      const assigned = resumes.find(r => String(r.id) === String(job.resume_id));
                      if (assigned) {
                        return `
                          <div class="detail-resume-widget">
                            <div class="detail-resume-row">
                              <div>
                                <strong style="font-size:0.85rem; color:var(--color-primary);">${assigned.file_name}</strong>
                                <div style="font-size:0.75rem; color:var(--color-text-secondary); margin-top:2px;">
                                  Uploaded: ${new Date(assigned.created_at).toLocaleDateString()}
                                </div>
                              </div>
                              <a href="#/resume-analyzer" class="btn btn-secondary btn-sm" style="padding:6px 10px; font-size:0.75rem;">
                                <i class="fas fa-search"></i> Optimize
                              </a>
                            </div>
                          </div>
                        `;
                      }
                    }
                    return `<p style="color:var(--color-text-secondary); font-size:0.85rem; font-style:italic; margin-top:8px;">No resume assigned yet. Select a version above to associate it with this application.</p>`;
                  })()}
                </div>
              </div>

            </div>
          </div>
        </div>
      `;

      attachEventListeners(job);

    } catch (err) {
      console.error(err);
      root.innerHTML = `
        <div style="padding: 40px; text-align: center;">
          <div style="background-color: var(--color-danger-light); color: var(--color-danger); width: 64px; height: 64px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 2rem; margin: 0 auto 24px auto;">
            <i class="fas fa-exclamation-triangle"></i>
          </div>
          <h2 style="font-size: 1.5rem; font-weight: 800; color: var(--color-primary); margin-bottom: 8px;">Failed to load application</h2>
          <p style="color: var(--color-text-secondary); margin-bottom: 24px;">${err.message}</p>
          <a href="#/dashboard" class="btn btn-primary">Back to Dashboard</a>
        </div>
      `;
    }
  }

  function attachEventListeners(job) {
    // 0. Resume Version Dropdown select
    const resumeSelect = document.getElementById('detail-resume-select');
    resumeSelect?.addEventListener('change', async (e) => {
      const val = e.target.value || null;
      try {
        resumeSelect.disabled = true;
        await updateJobResume(jobId, val);
        showToast("Resume version assigned successfully!", "success");
        loadAndRender();
      } catch (err) {
        resumeSelect.disabled = false;
        showToast(err.message, "error");
      }
    });

    // 1. Status Dropdown select
    const statusSelect = document.getElementById('detail-status-select');
    statusSelect?.addEventListener('change', async (e) => {
      const newStatus = e.target.value;
      const oldStatus = job.status;
      if (newStatus === oldStatus) return;
      try {
        statusSelect.disabled = true;
        await updateJobStatus(jobId, oldStatus, newStatus);
        showToast("Status updated successfully", "success");
        loadAndRender();
      } catch (err) {
        statusSelect.disabled = false;
        showToast(err.message, "error");
      }
    });

    // 2. Add Note button
    document.getElementById('add-note-btn')?.addEventListener('click', async () => {
      const textarea = document.getElementById('new-note-text');
      const val = textarea?.value.trim();
      if (!val) return;
      try {
        const btn = document.getElementById('add-note-btn');
        btn.disabled = true;
        await addJobNote(jobId, val);
        showToast("Note added", "success");
        loadAndRender();
      } catch (err) {
        document.getElementById('add-note-btn').disabled = false;
        showToast(err.message, "error");
      }
    });

    // 3. Edit Note inline action buttons
    document.querySelectorAll('[data-action="edit-note"]').forEach(btn => {
      btn.addEventListener('click', () => {
        editingNoteId = btn.getAttribute('data-note-id');
        loadAndRender();
      });
    });

    // 4. Save/Cancel Note edit triggers
    if (editingNoteId) {
      document.getElementById(`edit-note-cancel-${editingNoteId}`)?.addEventListener('click', () => {
        editingNoteId = null;
        loadAndRender();
      });
      document.getElementById(`edit-note-save-${editingNoteId}`)?.addEventListener('click', async () => {
        const txt = document.getElementById(`edit-note-text-${editingNoteId}`).value.trim();
        if (!txt) return;
        try {
          await updateJobNote(jobId, editingNoteId, txt);
          showToast("Note updated", "success");
          editingNoteId = null;
          loadAndRender();
        } catch (err) {
          showToast(err.message, "error");
        }
      });
    }

    // 5. Delete Note triggers
    document.querySelectorAll('[data-action="delete-note"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm("Are you sure you want to delete this note?")) return;
        const noteId = btn.getAttribute('data-note-id');
        try {
          await deleteJobNote(jobId, noteId);
          showToast("Note deleted", "success");
          loadAndRender();
        } catch (err) {
          showToast(err.message, "error");
        }
      });
    });

    // 6. Recruiter inline Edit forms toggles
    document.getElementById('edit-recruiter-btn')?.addEventListener('click', () => {
      isEditingRecruiter = true;
      loadAndRender();
    });
    document.getElementById('cancel-recruiter-edit')?.addEventListener('click', () => {
      isEditingRecruiter = false;
      loadAndRender();
    });
    document.getElementById('save-recruiter-edit')?.addEventListener('click', async () => {
      const name = document.getElementById('edit-recruiter-name').value.trim();
      const email = document.getElementById('edit-recruiter-email').value.trim();
      const linkedin = document.getElementById('edit-recruiter-linkedin').value.trim();
      const phone = document.getElementById('edit-recruiter-phone').value.trim();
      try {
        await updateJobRecruiter(jobId, {
          recruiter_name: name,
          recruiter_email: email,
          recruiter_linkedin: linkedin,
          recruiter_phone: phone
        });
        showToast("Recruiter details updated", "success");
        isEditingRecruiter = false;
        loadAndRender();
      } catch (err) {
        showToast(err.message, "error");
      }
    });

    // 7. Job Details Metadata inline Edit form toggles
    document.getElementById('edit-metadata-btn')?.addEventListener('click', () => {
      isEditingMetadata = true;
      loadAndRender();
    });
    document.getElementById('cancel-metadata-edit')?.addEventListener('click', () => {
      isEditingMetadata = false;
      loadAndRender();
    });
    document.getElementById('save-metadata-edit')?.addEventListener('click', async () => {
      const type = document.getElementById('edit-job-type').value;
      const loc = document.getElementById('edit-job-location').value.trim();
      const sal = document.getElementById('edit-job-salary').value.trim();
      const urlVal = document.getElementById('edit-job-url').value.trim();
      try {
        await updateJobMetadata(jobId, {
          employment_type: type,
          location: loc,
          salary_range: sal,
          job_url: urlVal
        });
        showToast("Job details updated", "success");
        isEditingMetadata = false;
        loadAndRender();
      } catch (err) {
        showToast(err.message, "error");
      }
    });

    // 8. Attachment Upload file handler
    document.getElementById('attachment-file-input')?.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        showToast("Uploading attachment...", "info");
        await addJobAttachment(jobId, file);
        showToast("Attachment uploaded", "success");
        loadAndRender();
      } catch (err) {
        showToast(err.message, "error");
      }
    });

    // 9. Delete Attachment trigger
    document.querySelectorAll('[data-action="delete-attachment"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm("Are you sure you want to delete this file attachment?")) return;
        const attId = btn.getAttribute('data-attachment-id');
        try {
          await deleteJobAttachment(jobId, attId);
          showToast("Attachment removed", "success");
          loadAndRender();
        } catch (err) {
          showToast(err.message, "error");
        }
      });
    });

    // 10. Save Follow-Up click handler
    document.getElementById('save-follow-up-btn')?.addEventListener('click', async () => {
      const status = document.getElementById('detail-follow-up-status').value;
      const date = document.getElementById('detail-follow-up-date').value;
      const lastDate = document.getElementById('detail-last-follow-up').value;
      
      try {
        const btn = document.getElementById('save-follow-up-btn');
        btn.disabled = true;
        await updateFollowUpFields(jobId, date ? new Date(date).toISOString() : null, status, lastDate ? new Date(lastDate).toISOString() : null);
        showToast("Follow-up plan saved successfully", "success");
        loadAndRender();
        runSmartAlertsEngine();
      } catch (err) {
        document.getElementById('save-follow-up-btn').disabled = false;
        showToast(err.message, "error");
      }
    });
  }

  // Load and Render the page initial state
  await loadAndRender();
}

let triggeredReminders = {};

function initReminderService() {
  checkReminders();
  setInterval(checkReminders, 60000);
}

async function checkReminders() {
  if (!currentUser) return;
  try {
    const interviews = await fetchInterviews();
    const upcoming = interviews.filter(i => i.status === 'Upcoming');
    const now = new Date();
    
    upcoming.forEach(int => {
      const intDateTime = new Date(`${int.date}T${int.time}`);
      if (isNaN(intDateTime)) return;
      
      const diffMs = intDateTime - now;
      if (diffMs < 0) return;
      
      const diffMins = Math.floor(diffMs / 60000);
      
      (int.reminders || []).forEach(rem => {
        let match = false;
        if (rem === '15 Minutes Before' && diffMins >= 14 && diffMins <= 16) {
          match = true;
        } else if (rem === '1 Hour Before' && diffMins >= 58 && diffMins <= 62) {
          match = true;
        } else if (rem === '24 Hours Before' && diffMins >= 1435 && diffMins <= 1445) {
          match = true;
        }
        
        if (match) {
          const cacheKey = `${int.id}_${rem}`;
          if (!triggeredReminders[cacheKey]) {
            triggeredReminders[cacheKey] = true;
            showReminderToast(int, rem);
          }
        }
      });
    });
  } catch (err) {
    console.error("Reminder check failed:", err);
  }
}

function showReminderToast(interview, reminderName) {
  const banner = document.createElement('div');
  banner.className = 'alert-banner info';
  banner.style.position = 'fixed';
  banner.style.top = '24px';
  banner.style.right = '24px';
  banner.style.left = 'auto';
  banner.style.zIndex = '9999';
  banner.style.maxWidth = '400px';
  banner.style.boxShadow = 'var(--shadow-lg)';
  banner.style.animation = 'slideInRight 0.3s cubic-bezier(0.16, 1, 0.3, 1)';
  
  let label = 'starting soon';
  if (reminderName === '15 Minutes Before') label = 'starts in 15 minutes';
  if (reminderName === '1 Hour Before') label = 'starts in 1 hour';
  if (reminderName === '24 Hours Before') label = 'starts in 24 hours';
  
  banner.innerHTML = `
    <div class="alert-banner-content" style="display:flex; flex-direction:column; gap:8px; align-items:flex-start;">
      <div style="display:flex; align-items:center; gap:8px;">
        <i class="fas fa-bell" style="color:var(--color-secondary); font-size:1.15rem;"></i>
        <strong style="color:var(--color-primary); font-size:0.9rem;">Interview Reminder</strong>
      </div>
      <p style="margin:0; font-size:0.85rem; color:var(--color-text-secondary); line-height:1.4;">
        Your <strong>${interview.interview_type}</strong> with <strong>${interview.company}</strong> (${interview.role}) ${label}!
      </p>
      ${interview.meeting_link ? `
        <a href="${interview.meeting_link.startsWith('http') ? interview.meeting_link : 'https://' + interview.meeting_link}" target="_blank" class="btn btn-secondary btn-sm" style="margin-top: 4px; display:inline-flex; align-items:center; gap:6px; font-size:0.75rem; padding:4px 8px; color:var(--color-secondary); border-color:transparent; background-color:var(--color-secondary-light);">
          <i class="fas fa-video"></i> Join Meeting
        </a>
      ` : ''}
    </div>
    <button class="alert-banner-close" style="background:transparent; border:none; cursor:pointer; color:var(--color-text-secondary); align-self:flex-start; margin-left: 8px;"><i class="fas fa-times"></i></button>
  `;
  
  document.body.appendChild(banner);
  
  const close = () => {
    banner.style.animation = 'slideOutRight 0.3s forwards';
    banner.addEventListener('animationend', () => banner.remove());
  };
  
  banner.querySelector('.alert-banner-close').addEventListener('click', close);
  setTimeout(close, 8000);
}

// Initial bootstrapper
function initApp() {
  initSupabase();
  handleRouting();
  initReminderService();
  
  // Listen to hash change routing
  window.addEventListener('hashchange', handleRouting);
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
