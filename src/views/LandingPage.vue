<script setup lang="ts">
import { useRouter } from 'vue-router'

const router = useRouter()

const launchApp = () => {
  router.push('/app')
}
</script>

<template>
  <div class="landing-page">
    <!-- Hero Section -->
    <header class="hero">
      <div class="hero-content">
        <h1>Squill</h1>
        <p class="tagline">A browser-based SQL editor for exploring your data</p>
        <p class="description">
          Run SQL queries on CSV files and databases directly in your browser using DuckDB.
          Your data never leaves your device.
        </p>
        <button class="cta-button" @click="launchApp">
          Open Editor
        </button>
      </div>
    </header>

    <!-- Features Section -->
    <section class="features">
      <h2>Features</h2>
      <div class="features-grid">
        <div class="feature-card">
          <h3>100% Client-Side</h3>
          <p>All processing happens in your browser. No data is sent to any server, ensuring complete privacy.</p>
        </div>
        <div class="feature-card">
          <h3>DuckDB Powered</h3>
          <p>Use the full power of DuckDB's SQL engine with WebAssembly, supporting complex analytical queries.</p>
        </div>
        <div class="feature-card">
          <h3>CSV Import</h3>
          <p>Drag and drop CSV files to instantly query them with SQL. No setup or configuration required.</p>
        </div>
        <div class="feature-card">
          <h3>BigQuery Integration</h3>
          <p>Connect to Google BigQuery to query your cloud data warehouse directly from the browser.</p>
        </div>
        <div class="feature-card">
          <h3>Infinite Canvas</h3>
          <p>Organize multiple queries and results on an infinite canvas. Chain queries together visually.</p>
        </div>
        <div class="feature-card">
          <h3>No Installation</h3>
          <p>Works entirely in your browser. No downloads, no accounts, no setup. Just open and start querying.</p>
        </div>
      </div>
    </section>

    <!-- How It Works Section -->
    <section class="how-it-works">
      <h2>How It Works</h2>
      <ol class="steps">
        <li>
          <strong>Open the editor</strong>
          <span>Click "Open Editor" to launch the SQL workspace</span>
        </li>
        <li>
          <strong>Load your data</strong>
          <span>Drag and drop CSV files or connect to BigQuery</span>
        </li>
        <li>
          <strong>Write SQL queries</strong>
          <span>Use the full SQL syntax supported by DuckDB</span>
        </li>
        <li>
          <strong>Explore results</strong>
          <span>View, filter, and export your query results</span>
        </li>
      </ol>
    </section>

    <!-- Footer -->
    <footer class="landing-footer">
      <div class="footer-content">
        <div class="footer-links">
          <router-link to="/privacy-policy">Privacy Policy</router-link>
          <router-link to="/terms-of-service">Terms of Service</router-link>
        </div>
        <p class="copyright">Squill - Open source SQL editor</p>
      </div>
    </footer>
  </div>
</template>

<style scoped>
.landing-page {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
  color: #1a1a1a;
  line-height: 1.6;
}

/* Hero Section */
.hero {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  padding: 80px 24px;
  text-align: center;
}

.hero-content {
  max-width: 800px;
  margin: 0 auto;
}

.hero h1 {
  font-size: 3.5rem;
  font-weight: 700;
  margin: 0 0 16px 0;
  letter-spacing: -0.02em;
}

.tagline {
  font-size: 1.5rem;
  opacity: 0.95;
  margin: 0 0 16px 0;
}

.description {
  font-size: 1.125rem;
  opacity: 0.9;
  margin: 0 0 32px 0;
  max-width: 600px;
  margin-left: auto;
  margin-right: auto;
}

.cta-button {
  background: white;
  color: #667eea;
  border: none;
  padding: 16px 48px;
  font-size: 1.125rem;
  font-weight: 600;
  border-radius: 8px;
  cursor: pointer;
  transition: transform 0.2s, box-shadow 0.2s;
}

.cta-button:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
}

.cta-button:active {
  transform: translateY(0);
}

/* Features Section */
.features {
  padding: 80px 24px;
  background: #fafafa;
}

.features h2 {
  text-align: center;
  font-size: 2rem;
  margin: 0 0 48px 0;
}

.features-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 24px;
  max-width: 1200px;
  margin: 0 auto;
}

.feature-card {
  background: white;
  padding: 32px;
  border-radius: 12px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}

.feature-card h3 {
  font-size: 1.25rem;
  margin: 0 0 12px 0;
  color: #667eea;
}

.feature-card p {
  margin: 0;
  color: #666;
}

/* How It Works Section */
.how-it-works {
  padding: 80px 24px;
  max-width: 800px;
  margin: 0 auto;
}

.how-it-works h2 {
  text-align: center;
  font-size: 2rem;
  margin: 0 0 48px 0;
}

.steps {
  list-style: none;
  padding: 0;
  margin: 0;
  counter-reset: step;
}

.steps li {
  display: flex;
  flex-direction: column;
  padding: 24px 0 24px 80px;
  position: relative;
  border-left: 2px solid #e0e0e0;
  margin-left: 24px;
}

.steps li:last-child {
  border-left-color: transparent;
}

.steps li::before {
  counter-increment: step;
  content: counter(step);
  position: absolute;
  left: -25px;
  top: 24px;
  width: 48px;
  height: 48px;
  background: #667eea;
  color: white;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  font-size: 1.25rem;
}

.steps li strong {
  font-size: 1.125rem;
  color: #1a1a1a;
}

.steps li span {
  color: #666;
  margin-top: 4px;
}

/* Footer */
.landing-footer {
  margin-top: auto;
  background: #1a1a1a;
  color: white;
  padding: 48px 24px;
}

.footer-content {
  max-width: 1200px;
  margin: 0 auto;
  text-align: center;
}

.footer-links {
  display: flex;
  justify-content: center;
  gap: 32px;
  margin-bottom: 24px;
}

.footer-links a {
  color: #aaa;
  text-decoration: none;
  transition: color 0.2s;
}

.footer-links a:hover {
  color: white;
}

.copyright {
  margin: 0;
  color: #666;
  font-size: 0.875rem;
}

/* Responsive */
@media (max-width: 768px) {
  .hero {
    padding: 60px 20px;
  }

  .hero h1 {
    font-size: 2.5rem;
  }

  .tagline {
    font-size: 1.25rem;
  }

  .features,
  .how-it-works {
    padding: 60px 20px;
  }

  .steps li {
    padding-left: 60px;
  }
}
</style>
