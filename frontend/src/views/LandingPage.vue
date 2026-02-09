<script setup lang="ts">
import { ref, reactive } from 'vue'
import { useRouter } from 'vue-router'
import { useHead } from '@unhead/vue'
import { marked } from 'marked'
import { DATABASE_ENGINES, DATABASE_INFO, type DatabaseEngine, type DatabaseInfo } from '../types/database'
import { changelog } from '../data/changelog'

const router = useRouter()

// Track loaded bird SVGs for fade-in effect
const loadedBirds = reactive({
  balcon: false,
  fromagerie: false,
  graph: false,
  selectBar: false,
  theatre: false,
  where: false,
  rolling: false,
  music: false,
  stand: false
})

// Database modal state
const selectedDatabase = ref<DatabaseInfo | null>(null)

const openDatabaseModal = (engine: DatabaseEngine) => {
  selectedDatabase.value = DATABASE_INFO[engine]
}

const closeDatabaseModal = () => {
  selectedDatabase.value = null
}

// Pro feature modal state
interface ProFeature {
  title: string
  description: string
  longDescription: string
  released: boolean
}

const proFeatures: ProFeature[] = [
  {
    title: 'Hex remover',
    description: 'Broken query? An LLM will lift the curse.',
    longDescription: 'When a query fails, Squill sends the error message and your SQL to an LLM, which analyzes the issue and suggests a corrected query. It understands your schema context and common SQL pitfalls across BigQuery, PostgreSQL, DuckDB, and Snowflake. One click to apply the fix.',
    released: true
  },
  {
    title: 'Ask a wizard',
    description: 'Pair-program SQL with an analytics agent in natural language.',
    longDescription: '',
    released: false
  },
  {
    title: 'Persistent storage',
    description: 'Save canvases to the cloud. Pick up where you left off.',
    longDescription: '',
    released: false
  },
  {
    title: 'Collaborative canvas',
    description: 'Work together in real-time. See each other\'s cursors.',
    longDescription: '',
    released: false
  },
  {
    title: 'Usage analytics',
    description: 'Track your query patterns. Measure table/column usage.',
    longDescription: '',
    released: false
  },
  {
    title: 'Shareable dashboards',
    description: 'Publish your analysis. Share with stakeholders.',
    longDescription: '',
    released: false
  }
]

const selectedProFeature = ref<ProFeature | null>(null)

const openProFeatureModal = (feature: ProFeature) => {
  if (feature.released) {
    selectedProFeature.value = feature
  }
}

const closeProFeatureModal = () => {
  selectedProFeature.value = null
}

// FAQ data (database-specific entries removed - now shown in database modal)
const faqs = [
  {
    question: 'Is my data safe?',
    answer: 'Yes. For client-side databases (DuckDB, BigQuery), your data never leaves your browser. For server-side databases (PostgreSQL, Snowflake), queries are proxied but results are streamed directly to you and never stored. Click on a database logo above to learn more.'
  },
  {
    question: 'Do I need to create an account?',
    answer: 'Yes, because secrets have to be stored for some databases (like PostgreSQL passwords or BigQuery refresh tokens). Creating an account also allows you to upgrade to Squill Pro when you\'re ready. You do not need an account to process CSV files and play with DuckDB.'
  },
  {
    question: 'Can I query CSV files with SQL?',
    answer: 'Yes. Drag and drop any CSV file onto the canvas and Squill will load it into DuckDB, which runs entirely in your browser via WebAssembly. You can then write SQL against it immediately — no server, no upload.'
  },
  {
    question: 'What databases does Squill support?',
    answer: 'Squill supports DuckDB (runs in your browser), PostgreSQL, BigQuery, and Snowflake. You can connect to multiple databases at the same time and switch between them freely.'
  },
  {
    question: 'Is Squill open source?',
    answer: 'Yes, Squill is fully open source under the AGPL license. You can inspect the code, contribute, or self-host it. The source code is available on GitHub.'
  },
  {
    question: 'Why 8€/month for Pro?',
    answer: 'The paid features involve compute costs: LLM tokens for fixing queries, storage costs for saving canvases, and server costs for collaboration. There are no vanity features.'
  }
]

// JSON-LD Structured Data
const organizationSchema = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: 'Squill',
  url: 'https://squill.dev',
  logo: 'https://squill.dev/og-image.png',
  sameAs: [
    'https://github.com/MaxHalford/squill'
  ]
}

const webApplicationSchema = {
  '@context': 'https://schema.org',
  '@type': 'WebApplication',
  name: 'Squill',
  url: 'https://squill.dev',
  description: 'Free, open source online SQL editor. Query CSV files with DuckDB, connect to PostgreSQL, BigQuery, and Snowflake. Infinite canvas, drag-and-drop CSV, AI query fixer. No install needed.',
  applicationCategory: 'DeveloperApplication',
  operatingSystem: 'Any',
  browserRequirements: 'Requires JavaScript, WebAssembly support',
  offers: [
    {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'EUR',
      name: 'Free'
    },
    {
      '@type': 'Offer',
      price: '8',
      priceCurrency: 'EUR',
      name: 'Pro',
      priceSpecification: {
        '@type': 'UnitPriceSpecification',
        price: '8',
        priceCurrency: 'EUR',
        billingDuration: 'P1M'
      }
    }
  ],
  featureList: [
    'Infinite canvas for SQL queries',
    'DuckDB WebAssembly support',
    'BigQuery integration',
    'PostgreSQL integration',
    'Snowflake integration',
    'Drag and drop CSV file analysis',
    'Schema explorer',
    'Go to definition (Cmd+click)',
    'Hex remover - AI SQL fixer (Pro)',
    'Ask a wizard - AI chat (Pro, coming soon)'
  ]
}

const faqSchema = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: faqs.map(faq => ({
    '@type': 'Question',
    name: faq.question,
    acceptedAnswer: {
      '@type': 'Answer',
      text: faq.answer
    }
  }))
}

// SEO Meta Tags
useHead({
  title: 'Squill - Free Online SQL Editor | DuckDB, PostgreSQL, BigQuery, Snowflake',
  meta: [
    {
      name: 'description',
      content: 'Open source SQL editor that runs in your browser. Query CSV files with DuckDB, connect to PostgreSQL, BigQuery, and Snowflake. Infinite canvas, drag-and-drop CSV, schema explorer, AI query fixer. No install needed.'
    },
    // Open Graph
    { property: 'og:title', content: 'Squill - Free Online SQL Editor' },
    { property: 'og:description', content: 'Open source SQL editor in the browser. Query CSV files with DuckDB, connect to PostgreSQL, BigQuery, and Snowflake. No install needed.' },
    { property: 'og:url', content: 'https://squill.dev/' },
    { property: 'og:type', content: 'website' },
    { property: 'og:site_name', content: 'Squill' },
    { property: 'og:locale', content: 'en_US' },
    { property: 'og:image', content: 'https://squill.dev/og-image.png' },
    { property: 'og:image:width', content: '1200' },
    { property: 'og:image:height', content: '630' },
    { property: 'og:image:alt', content: 'Squill - Free Online SQL Editor' },
    // Twitter
    { name: 'twitter:card', content: 'summary_large_image' },
    { name: 'twitter:title', content: 'Squill - Free Online SQL Editor' },
    { name: 'twitter:description', content: 'Open source SQL editor in the browser. Query CSV files with DuckDB, connect to PostgreSQL, BigQuery, and Snowflake. No install needed.' },
    { name: 'twitter:image', content: 'https://squill.dev/og-image.png' },
    { name: 'twitter:image:alt', content: 'Squill - Free Online SQL Editor' },
  ],
  link: [
    { rel: 'canonical', href: 'https://squill.dev/' }
  ],
  script: [
    {
      type: 'application/ld+json',
      innerHTML: JSON.stringify(organizationSchema)
    },
    {
      type: 'application/ld+json',
      innerHTML: JSON.stringify(webApplicationSchema)
    },
    {
      type: 'application/ld+json',
      innerHTML: JSON.stringify(faqSchema)
    }
  ]
})

const launchApp = () => {
  router.push('/app')
}

// FAQ accordion state
const openFaq = ref<number | null>(null)

const toggleFaq = (index: number) => {
  openFaq.value = openFaq.value === index ? null : index
}

// Changelog
const latestChangelog = changelog[0]
const latestChangelogDate = (() => {
  if (!latestChangelog) return ''
  const date = new Date(latestChangelog.date + 'T00:00:00')
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
})()
const latestChangelogHtml = latestChangelog ? marked(latestChangelog.content) as string : ''
</script>

<template>
  <main class="landing-page">
    <!-- Hero Section -->
    <section class="hero">
      <!-- Decorative floating windows -->
      <div class="hero-decoration deco-window deco-window-1">
        <div class="deco-window-header">
          <span>top_films</span>
        </div>
        <div class="deco-window-body">
          <code>SELECT title, director</code>
          <code>FROM films</code>
          <code>WHERE rating > 7.0</code>
          <code>ORDER BY year DESC</code>
        </div>
      </div>

      <div class="hero-decoration deco-window deco-window-2">
        <div class="deco-window-header">
          <span>results</span>
        </div>
        <div class="deco-window-body deco-table">
          <div class="deco-table-row deco-table-header">
            <span>title</span>
            <span>country</span>
            <span>year</span>
          </div>
          <div class="deco-table-row">
            <span>No Other Choice</span>
            <span>Korea</span>
            <span>2025</span>
          </div>
          <div class="deco-table-row">
            <span>The Third Man</span>
            <span>UK</span>
            <span>1949</span>
          </div>
          <div class="deco-table-row">
            <span>Priscilla</span>
            <span>Australia</span>
            <span>1994</span>
          </div>
        </div>
      </div>

      <!-- Schema tree decoration -->
      <div class="hero-decoration deco-schema">
        <div class="schema-item schema-db">
          cinema_db
        </div>
        <div class="schema-item schema-table">
          films
        </div>
        <div class="schema-item schema-table">
          directors
        </div>
        <div class="schema-item schema-table">
          awards
        </div>
      </div>

      <!-- Floating bird stickers (decorative) -->
      <img
        src="@/assets/birds/balcon.svg"
        class="hero-decoration deco-bird deco-bird-balcon"
        :class="{ 'deco-loaded': loadedBirds.balcon }"
        alt=""
        aria-hidden="true"
        @load="loadedBirds.balcon = true"
      >
      <img
        src="@/assets/birds/fromagerie0.svg"
        class="hero-decoration deco-bird deco-bird-fromagerie"
        :class="{ 'deco-loaded': loadedBirds.fromagerie }"
        alt=""
        aria-hidden="true"
        @load="loadedBirds.fromagerie = true"
      >
      <img
        src="@/assets/birds/graph.svg"
        class="hero-decoration deco-bird deco-bird-graph"
        :class="{ 'deco-loaded': loadedBirds.graph }"
        alt=""
        aria-hidden="true"
        @load="loadedBirds.graph = true"
      >
      <img
        src="@/assets/birds/select_bar.svg"
        class="hero-decoration deco-bird deco-bird-select-bar"
        :class="{ 'deco-loaded': loadedBirds.selectBar }"
        alt=""
        aria-hidden="true"
        @load="loadedBirds.selectBar = true"
      >
      <img
        src="@/assets/birds/theatre.svg"
        class="hero-decoration deco-bird deco-bird-theatre"
        :class="{ 'deco-loaded': loadedBirds.theatre }"
        alt=""
        aria-hidden="true"
        @load="loadedBirds.theatre = true"
      >
      <img
        src="@/assets/birds/where.svg"
        class="hero-decoration deco-bird deco-bird-where"
        :class="{ 'deco-loaded': loadedBirds.where }"
        alt=""
        aria-hidden="true"
        @load="loadedBirds.where = true"
      >
      <img
        src="@/assets/birds/rolling.svg"
        class="hero-decoration deco-bird deco-bird-rolling"
        :class="{ 'deco-loaded': loadedBirds.rolling }"
        alt=""
        aria-hidden="true"
        @load="loadedBirds.rolling = true"
      >
      <img
        src="@/assets/birds/music.svg"
        class="hero-decoration deco-bird deco-bird-music"
        :class="{ 'deco-loaded': loadedBirds.music }"
        alt=""
        aria-hidden="true"
        @load="loadedBirds.music = true"
      >
      <img
        src="@/assets/birds/stand.svg"
        class="hero-decoration deco-bird deco-bird-stand"
        :class="{ 'deco-loaded': loadedBirds.stand }"
        alt=""
        aria-hidden="true"
        @load="loadedBirds.stand = true"
      >

      <!-- Sticky note decoration -->
      <div class="hero-decoration deco-note">
        <span>TODO:</span>
        <span>Watch more<br>Park Chan-wook</span>
      </div>

      <!-- Main content -->
      <div class="hero-content">
        <h1 class="hero-title">
          SQUILL
        </h1>
        <p class="hero-tagline">
          Open source SQL editor in the browser
        </p>
        <button
          class="btn-primary"
          @click="launchApp"
        >
          Open editor
        </button>
      </div>

      <!-- Scroll hint -->
      <div
        class="scroll-hint"
        aria-hidden="true"
      >
        <span class="scroll-chevron" />
      </div>
    </section>

    <!-- Features Section -->
    <section class="section features">
      <h2 class="section-title">
        WHAT YOU GET
      </h2>
      <p class="features-subtitle">
        A free, open source online SQL editor. No download, no install — just open your browser and start querying DuckDB, PostgreSQL, BigQuery, and Snowflake.
      </p>
      <div class="features-grid">
        <div class="feature-card">
          <div class="feature-icon icon-canvas">
            <div class="icon-grid">
              <span /><span /><span />
              <span /><span /><span />
              <span /><span /><span />
            </div>
          </div>
          <h3>Infinite canvas</h3>
          <p>Pan, zoom, and organize your queries visually. Chain results between boxes. Think spatially about your data.</p>
        </div>

        <div class="feature-card">
          <div class="feature-icon icon-sql">
            <span class="bracket">[</span>
            <span class="cursor">_</span>
            <span class="bracket">]</span>
          </div>
          <h3>Smart SQL editor</h3>
          <p>Auto-completion that knows your schema. Syntax highlighting. Cmd+click to jump to table definitions.</p>
        </div>

        <div class="feature-card">
          <div class="feature-icon icon-db">
            <div class="db-stack">
              <span class="db-layer" />
              <span class="db-layer" />
              <span class="db-layer" />
            </div>
          </div>
          <h3>Unlimited connections</h3>
          <p>Add all the databases and write as many queries as you want. Squill is not here to limit you.</p>
        </div>

        <div class="feature-card">
          <div class="feature-icon icon-csv">
            <div class="csv-icon">
              <div class="csv-doc">
                <div class="csv-lines">
                  <span />
                  <span />
                  <span />
                </div>
              </div>
              <div class="csv-arrow" />
            </div>
          </div>
          <h3>Drag & drop CSV</h3>
          <p>Drop CSV files onto the canvas. Query them instantly with DuckDB WASM.</p>
        </div>

        <div class="feature-card">
          <div class="feature-icon icon-analytics">
            <div class="analytics-icon">
              <div
                class="analytics-bar"
                style="height: 40%"
              />
              <div
                class="analytics-bar"
                style="height: 70%"
              />
              <div
                class="analytics-bar"
                style="height: 55%"
              />
              <div
                class="analytics-bar"
                style="height: 85%"
              />
            </div>
          </div>
          <h3>Click-to-analyze</h3>
          <p>Run quick analytics on any column in just one click. Helps getting familiar with a table and its content.</p>
        </div>

        <div class="feature-card">
          <div class="feature-icon icon-pages">
            <div class="pages-stack">
              <span class="page-layer" />
              <span class="page-layer" />
              <span class="page-layer front" />
            </div>
          </div>
          <h3>Large results, no sweat</h3>
          <p>Pagination is used to handle large result sets gracefully. Don't worry about adding LIMIT to the bottom of your statements.</p>
        </div>

        <div class="feature-card">
          <div class="feature-icon icon-magnifier">
            <svg
              width="36"
              height="36"
              viewBox="0 0 36 36"
              fill="none"
            >
              <circle
                cx="14"
                cy="14"
                r="10"
                stroke="var(--surface-inverse)"
                stroke-width="3"
                fill="var(--surface-tertiary)"
              />
              <line
                x1="23"
                y1="23"
                x2="33"
                y2="33"
                stroke="var(--surface-inverse)"
                stroke-width="4"
                stroke-linecap="round"
              />
            </svg>
          </div>
          <h3>Schema explorer</h3>
          <p>Browse your database structure visually, file explorer style.</p>
        </div>

        <div class="feature-card">
          <div class="feature-icon icon-opensource">
            <div class="opensource-icon">
              &lt;/&gt;
            </div>
          </div>
          <h3>Fully open source</h3>
          <p>
            Licensed under AGPL. Inspect the code, contribute, or self-host. <a
              href="https://github.com/MaxHalford/squill"
              target="_blank"
              rel="noopener"
            >View on GitHub</a>.
          </p>
        </div>
      </div>
    </section>

    <!-- Databases Section -->
    <section class="section databases">
      <h2 class="section-title">
        SUPPORTED DATABASES
      </h2>
      <p class="databases-subtitle">
        Click on a logo to learn how each database is supported
      </p>
      <div class="databases-grid">
        <button
          v-for="engine in DATABASE_ENGINES"
          :key="engine"
          class="database-card"
          @click="openDatabaseModal(engine)"
        >
          <img
            :src="DATABASE_INFO[engine].logo"
            :alt="DATABASE_INFO[engine].name"
            class="database-logo"
          >
          <span class="database-name">{{ DATABASE_INFO[engine].name }}</span>
          <span
            class="database-badge"
            :class="DATABASE_INFO[engine].connectionType"
          >
            {{ DATABASE_INFO[engine].connectionType === 'client' ? 'Client-side' : 'Server-side' }}
          </span>
        </button>
      </div>
    </section>

    <!-- Database Detail Modal -->
    <Teleport to="body">
      <Transition name="modal">
        <div
          v-if="selectedDatabase"
          class="modal-overlay"
          @click.self="closeDatabaseModal"
        >
          <div class="database-modal">
            <button
              class="modal-close"
              aria-label="Close"
              @click="closeDatabaseModal"
            >
              ×
            </button>
            <div class="modal-header">
              <img
                :src="selectedDatabase.logo"
                :alt="selectedDatabase.name"
                class="modal-logo"
              >
              <div class="modal-title-group">
                <h3>{{ selectedDatabase.name }}</h3>
                <span
                  class="modal-badge"
                  :class="selectedDatabase.connectionType"
                >
                  {{ selectedDatabase.connectionType === 'client' ? 'Client-side' : 'Server-side' }}
                </span>
              </div>
            </div>
            <div class="modal-body">
              <p class="modal-description">
                {{ selectedDatabase.longDescription }}
              </p>
              <div class="modal-details">
                <div class="detail-row">
                  <span class="detail-label">Authentication</span>
                  <span class="detail-value">{{ selectedDatabase.authMethod }}</span>
                </div>
                <div class="detail-row">
                  <span class="detail-label">Data Privacy</span>
                  <span class="detail-value">{{ selectedDatabase.dataPrivacy }}</span>
                </div>
              </div>
            </div>
            <div class="modal-footer">
              <button
                class="btn-primary"
                @click="closeDatabaseModal"
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- Pro Feature Detail Modal -->
    <Teleport to="body">
      <Transition name="modal">
        <div
          v-if="selectedProFeature"
          class="modal-overlay"
          @click.self="closeProFeatureModal"
        >
          <div class="database-modal">
            <button
              class="modal-close"
              aria-label="Close"
              @click="closeProFeatureModal"
            >
              ×
            </button>
            <div class="modal-header">
              <div class="modal-title-group">
                <h3>{{ selectedProFeature.title }}</h3>
                <span class="modal-badge pro-modal-badge">Pro</span>
              </div>
            </div>
            <div class="modal-body">
              <p class="modal-description">
                {{ selectedProFeature.longDescription }}
              </p>
            </div>
            <div class="modal-footer">
              <button
                class="btn-primary"
                @click="closeProFeatureModal"
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- Pro Section -->
    <section class="section section-inverted pro">
      <div class="pro-container">
        <h2 class="section-title">
          SQUILL PRO
        </h2>
        <p class="pro-price">
          8€ / month / user
        </p>

        <div class="pro-features">
          <component
            :is="feature.released ? 'button' : 'div'"
            v-for="feature in proFeatures"
            :key="feature.title"
            class="pro-feature"
            :class="{ available: feature.released, 'coming-soon': !feature.released, clickable: feature.released }"
            @click="openProFeatureModal(feature)"
          >
            <span class="status-icon">{{ feature.released ? '&#10003;' : '&#9671;' }}</span>
            <div class="pro-feature-content">
              <h3>
                {{ feature.title }} <span
                  v-if="!feature.released"
                  class="badge"
                >work in progress</span>
              </h3>
              <p>{{ feature.description }}</p>
            </div>
          </component>
        </div>

        <p class="pro-philosophy">
          You're paying for compute, not vanity features.
        </p>
      </div>
    </section>

    <!-- Testimonials Section -->
    <section class="section testimonials">
      <h2 class="section-title">
        WHAT PEOPLE SAY
      </h2>
      <div class="testimonials-grid">
        <div class="testimonial-card testimonial-main">
          <blockquote>
            "It's very nice babe."
          </blockquote>
          <cite>
            <span class="author">Sarah</span>
            <span class="role">Mandatory Beta Tester</span>
          </cite>
        </div>

        <div class="testimonial-card testimonial-secondary">
          <blockquote>
            "I want more birds."
          </blockquote>
          <cite>
            <span class="author">Olivia, age 2</span>
            <span class="role">Chief Design Officer</span>
          </cite>
        </div>

        <div class="testimonial-card testimonial-placeholder">
          <div class="hatching" />
          <span>Your testimonial here...</span>
        </div>

        <div class="testimonial-card testimonial-placeholder">
          <div class="hatching" />
          <span>Your testimonial here...</span>
        </div>
      </div>
    </section>

    <!-- FAQ Section -->
    <section class="section faq">
      <h2 class="section-title">
        FREQUENTLY ASKED QUESTIONS
      </h2>
      <div class="faq-list">
        <div
          v-for="(faq, index) in faqs"
          :key="index"
          class="faq-item"
          :class="{ open: openFaq === index }"
        >
          <button
            class="faq-question"
            @click="toggleFaq(index)"
          >
            <span class="faq-toggle">{{ openFaq === index ? '−' : '+' }}</span>
            {{ faq.question }}
          </button>
          <div class="faq-answer">
            <div class="faq-answer-content">
              <p>{{ faq.answer }}</p>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- What's New Section -->
    <section
      v-if="latestChangelog"
      class="section whats-new"
    >
      <h2 class="section-title">
        WHAT'S NEW
      </h2>
      <div class="whats-new-entry">
        <time class="whats-new-date">{{ latestChangelogDate }}</time>
        <div
          class="whats-new-content markdown-content"
          v-html="latestChangelogHtml"
        />
        <router-link
          to="/changelog"
          class="whats-new-link"
        >
          View all updates →
        </router-link>
      </div>
    </section>

    <!-- Footer -->
    <footer class="landing-footer">
      <img
        src="@/assets/birds/personnage1.svg"
        class="footer-bird footer-bird-left"
        alt=""
        aria-hidden="true"
      >
      <div class="footer-content">
        <span class="footer-logo">SQUILL</span>
        <div class="footer-links">
          <a
            href="https://github.com/MaxHalford/squill"
            target="_blank"
            rel="noopener"
          >GitHub</a>
          <span class="divider">|</span>
          <router-link to="/privacy-policy">
            Privacy Policy
          </router-link>
          <span class="divider">|</span>
          <router-link to="/terms-of-service">
            Terms of Service
          </router-link>
          <span class="divider">|</span>
          <router-link to="/refund-policy">
            Refund Policy
          </router-link>
          <span class="divider">|</span>
          <router-link to="/changelog">
            Changelog
          </router-link>
        </div>
        <p class="footer-tagline">
          Made by a data scientist, for data people
        </p>
        <p class="footer-tagline">
          Funky birds drawn by Lina
        </p>
      </div>
      <img
        src="@/assets/birds/personnage2.svg"
        class="footer-bird footer-bird-right"
        alt=""
        aria-hidden="true"
      >
    </footer>
  </main>
</template>

<style scoped>
.landing-page {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  font-family: var(--font-family-ui);
  color: var(--text-primary);
  background: var(--surface-primary);
  line-height: var(--line-height-normal);
}

/* ===== HERO SECTION ===== */
.hero {
  position: relative;
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: var(--canvas-bg);
  background-image: radial-gradient(
    circle,
    var(--canvas-dot-color) var(--canvas-dot-size),
    transparent var(--canvas-dot-size)
  );
  background-size: var(--canvas-dot-spacing) var(--canvas-dot-spacing);
  overflow: hidden;
}

/* Hero decorations base */
.hero-decoration {
  position: absolute;
  pointer-events: none;
  user-select: none;
}

/* Floating window decorations */
.deco-window {
  background: var(--surface-primary);
  border: var(--border-width-thick) solid var(--border-primary);
  box-shadow: var(--shadow-md);
}

.deco-window-header {
  background: var(--surface-inverse);
  color: var(--text-inverse);
  padding: 4px 8px;
  font-family: var(--font-family-mono);
  font-size: 10px;
  font-weight: 600;
}

.deco-window-body {
  padding: 8px;
  font-family: var(--font-family-mono);
  font-size: 9px;
  line-height: 1.4;
}

.deco-window-body code {
  display: block;
  color: var(--text-primary);
}

/* Positioning for windows */
.deco-window-1 {
  top: 12%;
  left: 5%;
  width: 180px;
}

.deco-window-2 {
  top: 8%;
  right: 8%;
  width: 180px;
}

.deco-window-3 {
  bottom: 15%;
  left: 8%;
  width: 210px;
}

/* Mini table styles */
.deco-table {
  padding: 0;
}

.deco-table-row {
  display: grid;
  grid-template-columns: 90px 50px 36px;
  border-bottom: 1px solid var(--border-tertiary);
}

.deco-table-row:last-child {
  border-bottom: none;
}

.deco-table-row span {
  padding: 3px 6px;
  font-size: 8px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.deco-table-header {
  background: var(--surface-secondary);
  font-weight: 600;
}

/* Schema tree decoration */
.deco-schema {
  top: 50%;
  right: 3%;
  background: var(--surface-primary);
  border: var(--border-width-thick) solid var(--border-primary);
  box-shadow: var(--shadow-md);
  padding: 8px 12px;
  font-family: var(--font-family-mono);
  font-size: 9px;

}

.schema-item {
  padding: 2px 0;
}

.schema-db {
  font-weight: 700;
}

.schema-table {
  padding-left: 12px;
  color: var(--text-secondary);
}

.schema-table::before {
  content: "├ ";
  color: var(--text-tertiary);
}

.schema-item:last-child.schema-table::before {
  content: "└ ";
}

/* Floating bird stickers */
.deco-bird {
  height: auto;
  filter:
    /* Inner fill - smaller offsets to fill enclosed spaces */
    drop-shadow(0 0 0 white)
    /* Medium fill layer */
    drop-shadow(2px 2px 0 white)
    drop-shadow(-2px 2px 0 white)
    drop-shadow(2px -2px 0 white)
    drop-shadow(-2px -2px 0 white)
    /* Shadow */
    drop-shadow(0 4px 8px rgba(0, 0, 0, 0.15));
  opacity: 0;
}

/* Fade in animation when loaded */
@keyframes fadeIn {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

.deco-bird.deco-loaded {
  animation: fadeIn 0.5s ease-out forwards;
}

/* Position and stagger entrance animations for each bird */
.deco-bird-balcon { bottom: 3%; left: 65%; width: 180px; animation-delay: 0s; }
.deco-bird-select-bar { top: 29%; left: 2%; width: 340px; animation-delay: 0.1s; }
.deco-bird-graph { top: 50%; right: 15%; width: 210px; animation-delay: 0.2s; }
.deco-bird-fromagerie { bottom: 2%; left: 30%; width: 345px; animation-delay: 0.3s; }
.deco-bird-theatre { bottom: 5%; left: 5%; width: 220px; animation-delay: 0.4s; }
.deco-bird-where { top: 8%; right: 50%; width: 265px; animation-delay: 0.5s; }
.deco-bird-rolling { top: 20%; right: 2%; width: 340px; animation-delay: 0.6s; }
.deco-bird-music { top: 2%; right: 22%; width: 340px; animation-delay: 0.7s; }
.deco-bird-stand { bottom: 12%; right: 5%; width: 280px; animation-delay: 0.8s; }

/* Sticky note decoration */
.deco-note {
  bottom: 5%;
  right: 5%;
  background: var(--sticky-note-bg);
  border: 1px solid var(--sticky-note-border);
  padding: 8px 10px;
  font-family: var(--font-family-ui);
  font-size: 9px;
  transform: rotate(3deg);
  box-shadow: var(--shadow-sm);

}

.deco-note span {
  display: block;
  color: var(--sticky-note-text);
}

.deco-note span:first-child {
  font-weight: 600;
  margin-bottom: 2px;
}

/* Hero main content */
.hero-content {
  position: relative;
  z-index: 1;
  text-align: center;
  padding: var(--space-6);
  background: var(--canvas-bg);
  border: var(--border-width-thick) solid var(--border-primary);
  box-shadow: var(--shadow-lg);
  max-width: 500px;
}

.hero-title {
  font-family: var(--font-family-mono);
  font-size: clamp(48px, 12vw, 80px);
  font-weight: 700;
  letter-spacing: 0.15em;
  margin: 0 0 var(--space-3) 0;
  color: var(--text-primary);
}

.hero-tagline {
  font-size: clamp(16px, 2.5vw, 20px);
  margin: 0 0 var(--space-4) 0;
  color: var(--text-primary);
}

.btn-primary {
  display: inline-block;
  padding: var(--space-3) var(--space-6);
  background: var(--surface-inverse);
  color: var(--text-inverse);
  border: var(--border-width-thick) solid var(--border-primary);
  border-radius: var(--border-radius-none);
  box-shadow: var(--shadow-md);
  font-family: var(--font-family-mono);
  font-size: var(--font-size-body);
  font-weight: 600;
  text-decoration: none;
  cursor: pointer;
  transition: transform 0.1s, box-shadow 0.1s;
}

.btn-primary:hover {
  transform: translate(-2px, -2px);
  box-shadow: var(--shadow-lg);
}

.btn-primary:active {
  transform: translate(2px, 2px);
  box-shadow: var(--shadow-sm);
}

/* Scroll hint indicator */
.scroll-hint {
  position: absolute;
  bottom: 30px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 1;
  animation: bounce 1.5s ease-in-out infinite;
}

.scroll-chevron {
  display: block;
  width: 14px;
  height: 14px;
  border-right: 2px solid var(--text-primary);
  border-bottom: 2px solid var(--text-primary);
  transform: rotate(45deg);
  opacity: 0.5;
}

@keyframes bounce {
  0%, 100% { transform: translateX(-50%) translateY(0); }
  50% { transform: translateX(-50%) translateY(-8px); }
}

/* ===== SECTION COMMON ===== */
.section {
  padding: 80px var(--space-6);
  max-width: 1200px;
  margin: 0 auto;
  width: 100%;
}

.section-title {
  font-family: var(--font-family-mono);
  font-size: clamp(24px, 4vw, 32px);
  letter-spacing: 0.1em;
  text-align: center;
  margin: 0 0 48px 0;
}

/* ===== FEATURES SECTION ===== */
.features {
  background: var(--surface-secondary);
  max-width: none;
}

.features .section-title {
  max-width: 1200px;
  margin-left: auto;
  margin-right: auto;
}

.features-subtitle {
  text-align: center;
  color: var(--text-secondary);
  margin: -32px auto 48px;
  font-size: var(--font-size-body);
  max-width: 700px;
}

.features-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--space-6);
  max-width: 1200px;
  margin: 0 auto;
}

.feature-card {
  background: var(--surface-primary);
  border: var(--border-width-thick) solid var(--border-primary);
  border-radius: var(--border-radius-none);
  box-shadow: var(--shadow-md);
  padding: var(--space-6);
  transition: transform 0.15s, box-shadow 0.15s;
}

.feature-card:hover {
  transform: translate(-2px, -2px);
  box-shadow: var(--shadow-lg);
}

.feature-icon {
  width: 48px;
  height: 48px;
  margin-bottom: var(--space-4);
  display: flex;
  align-items: center;
  justify-content: center;
}

/* Grid icon */
.icon-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 3px;
  width: 36px;
  height: 36px;
}

.icon-grid span {
  background: var(--surface-inverse);
  border-radius: 0;
}

/* SQL brackets icon */
.icon-sql {
  font-family: var(--font-family-mono);
  font-size: 28px;
  font-weight: 700;
}

.icon-sql .bracket {
  color: var(--text-primary);
}

.icon-sql .cursor {
  animation: blink 1s step-end infinite;
}

@keyframes blink {
  50% { opacity: 0; }
}

/* Database icon */
.db-stack {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.db-layer {
  width: 32px;
  height: 8px;
  background: var(--surface-inverse);
  border-radius: 2px;
}

.db-layer:first-child {
  border-radius: 4px 4px 2px 2px;
}

.db-layer:last-child {
  border-radius: 2px 2px 4px 4px;
}

/* CSV drag & drop icon */
.csv-icon {
  position: relative;
  width: 36px;
  height: 36px;
}

.csv-doc {
  position: absolute;
  top: 0;
  left: 4px;
  width: 24px;
  height: 30px;
  background: var(--surface-inverse);
  border-radius: 2px;
}

.csv-lines {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px 4px;
}

.csv-lines span {
  height: 2px;
  background: var(--surface-primary);
  border-radius: 1px;
}

.csv-lines span:nth-child(1) { width: 100%; }
.csv-lines span:nth-child(2) { width: 70%; }
.csv-lines span:nth-child(3) { width: 85%; }

.csv-arrow {
  position: absolute;
  bottom: 0;
  right: 0;
  width: 0;
  height: 0;
  border-left: 6px solid transparent;
  border-right: 6px solid transparent;
  border-top: 8px solid var(--surface-inverse);
}

/* Analytics bar chart icon */
.analytics-icon {
  display: flex;
  align-items: flex-end;
  gap: 4px;
  height: 32px;
  width: 36px;
}

.analytics-bar {
  flex: 1;
  background: var(--surface-inverse);
  border-radius: 2px 2px 0 0;
}

/* Pages/pagination icon - stacked pages */
.pages-stack {
  position: relative;
  width: 32px;
  height: 36px;
}

.page-layer {
  position: absolute;
  width: 24px;
  height: 28px;
  background: var(--surface-tertiary);
  border: 2px solid var(--surface-inverse);
  border-radius: 2px;
}

.page-layer:nth-child(1) {
  top: 0;
  left: 0;
}

.page-layer:nth-child(2) {
  top: 4px;
  left: 4px;
}

.page-layer.front {
  top: 8px;
  left: 8px;
  background: var(--surface-primary);
}

/* Open source icon */
.opensource-icon {
  font-family: var(--font-family-mono);
  font-size: 24px;
  font-weight: 700;
  color: var(--text-primary);
}

/* Feature card link styling */
.feature-card a {
  color: var(--text-primary);
  text-decoration: underline;
  text-underline-offset: 2px;
}

.feature-card a:hover {
  text-decoration-thickness: 2px;
}

.feature-card h3 {
  font-family: var(--font-family-mono);
  font-size: var(--font-size-heading);
  margin: 0 0 var(--space-3) 0;
}

.feature-card p {
  margin: 0;
  color: var(--text-secondary);
  font-size: var(--font-size-body);
}

/* ===== DATABASES SECTION ===== */
.databases {
  background: var(--surface-primary);
}

.databases-subtitle {
  text-align: center;
  color: var(--text-secondary);
  margin: -32px 0 48px 0;
  font-size: var(--font-size-body);
}

.databases-grid {
  display: flex;
  justify-content: center;
  gap: var(--space-6);
  flex-wrap: wrap;
  max-width: 900px;
  margin: 0 auto;
}

.database-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-5);
  background: var(--surface-primary);
  border: var(--border-width-thick) solid var(--border-primary);
  border-radius: var(--border-radius-none);
  box-shadow: var(--shadow-md);
  cursor: pointer;
  transition: transform 0.15s, box-shadow 0.15s;
  min-width: 160px;
}

.database-card:hover {
  transform: translate(-2px, -2px);
  box-shadow: var(--shadow-lg);
}

.database-logo {
  width: 64px;
  height: 64px;
  object-fit: contain;
}

.database-name {
  font-family: var(--font-family-mono);
  font-size: var(--font-size-body);
  font-weight: 600;
  color: var(--text-primary);
}

.database-badge {
  font-size: var(--font-size-caption);
  padding: 2px 8px;
  border-radius: 2px;
  font-weight: 500;
}

.database-badge.client {
  background: var(--color-success-light, #d4edda);
  color: var(--color-success-dark, #155724);
}

.database-badge.server {
  background: var(--color-info-light, #cce5ff);
  color: var(--color-info-dark, #004085);
}

/* ===== DATABASE MODAL ===== */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: var(--space-4);
}

.database-modal {
  background: var(--surface-primary);
  border: var(--border-width-thick) solid var(--border-primary);
  box-shadow: var(--shadow-lg);
  max-width: 500px;
  width: 100%;
  position: relative;
}

.modal-close {
  position: absolute;
  top: var(--space-3);
  right: var(--space-3);
  background: none;
  border: none;
  font-size: 24px;
  cursor: pointer;
  color: var(--text-secondary);
  line-height: 1;
  padding: 0;
  width: 28px;
  height: 28px;
}

.modal-close:hover {
  color: var(--text-primary);
}

.modal-header {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-5);
  border-bottom: var(--border-width-thin) solid var(--border-primary);
}

.modal-logo {
  width: 48px;
  height: 48px;
  object-fit: contain;
}

.modal-title-group {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.modal-title-group h3 {
  margin: 0;
  font-family: var(--font-family-mono);
  font-size: var(--font-size-heading);
}

.modal-badge {
  font-size: var(--font-size-caption);
  padding: 2px 8px;
  border-radius: 2px;
  font-weight: 500;
  width: fit-content;
}

.modal-badge.client {
  background: var(--color-success-light, #d4edda);
  color: var(--color-success-dark, #155724);
}

.modal-badge.server {
  background: var(--color-info-light, #cce5ff);
  color: var(--color-info-dark, #004085);
}

.modal-body {
  padding: var(--space-5);
}

.modal-description {
  margin: 0 0 var(--space-5) 0;
  line-height: var(--line-height-relaxed);
  color: var(--text-primary);
}

.modal-details {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.detail-row {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.detail-label {
  font-family: var(--font-family-mono);
  font-size: var(--font-size-body-sm);
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.detail-value {
  color: var(--text-primary);
  font-size: var(--font-size-body);
  line-height: var(--line-height-relaxed);
}

.modal-footer {
  padding: var(--space-4) var(--space-5);
  border-top: var(--border-width-thin) solid var(--border-primary);
  display: flex;
  justify-content: flex-end;
}

/* Modal transitions */
.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.2s ease;
}

.modal-enter-active .database-modal,
.modal-leave-active .database-modal {
  transition: transform 0.2s ease;
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}

.modal-enter-from .database-modal,
.modal-leave-to .database-modal {
  transform: scale(0.95);
}

/* ===== PRO SECTION ===== */
.section-inverted {
  background: var(--surface-inverse);
  color: var(--text-inverse);
  max-width: none;
}

.pro-container {
  max-width: 800px;
  margin: 0 auto;
}

.pro .section-title {
  color: var(--text-inverse);
}

.pro-price {
  font-family: var(--font-family-mono);
  font-size: clamp(32px, 6vw, 48px);
  text-align: center;
  margin: 0 0 48px 0;
}

.pro-features {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  margin-bottom: 48px;
}

.pro-feature {
  display: flex;
  gap: var(--space-4);
  padding: var(--space-4);
  border: 1px solid rgba(255, 255, 255, 0.2);
}

.pro-feature.available {
  border-color: rgba(255, 255, 255, 0.4);
}

.pro-feature.coming-soon {
  opacity: 0.7;
}

.pro-feature.clickable {
  cursor: pointer;
  transition: transform 0.15s, box-shadow 0.15s, border-color 0.15s;
}

.pro-feature.clickable:hover {
  transform: translate(-2px, -2px);
  box-shadow: 0 4px 12px rgba(255, 255, 255, 0.1);
  border-color: rgba(255, 255, 255, 0.6);
}

button.pro-feature {
  text-align: left;
  background: none;
  font-family: inherit;
  font-size: inherit;
  color: inherit;
}

.pro-modal-badge {
  background: var(--surface-inverse);
  color: var(--text-inverse);
}

.status-icon {
  font-size: 20px;
  line-height: 1;
  flex-shrink: 0;
  width: 24px;
  text-align: center;
}

.pro-feature-content h3 {
  font-family: var(--font-family-mono);
  font-size: var(--font-size-body-lg);
  margin: 0 0 var(--space-1) 0;
}

.pro-feature-content p {
  margin: 0;
  font-size: var(--font-size-body-sm);
  opacity: 0.8;
}

.badge {
  font-size: var(--font-size-caption);
  color: rgba(255, 255, 255, 0.78);
  font-weight: 400;
}

.pro-philosophy {
  text-align: center;
  font-style: italic;
  opacity: 0.8;
  font-size: var(--font-size-lg);
  margin: 0;
}

/* ===== TESTIMONIALS SECTION ===== */
.testimonials {
  background: var(--surface-primary);
}

.testimonials-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--space-4);
}

.testimonial-card {
  background: var(--surface-primary);
  border: var(--border-width-thick) solid var(--border-primary);
  border-radius: var(--border-radius-none);
  box-shadow: var(--shadow-md);
  padding: var(--space-5);
}

.testimonial-main {
  grid-column: span 2;
  grid-row: span 2;
  display: flex;
  flex-direction: column;
  justify-content: center;
}

.testimonial-main blockquote {
  font-size: var(--font-size-body-lg);
  font-style: italic;
  margin: 0 0 var(--space-4) 0;
  line-height: var(--line-height-relaxed);
}

.testimonial-main cite {
  display: flex;
  flex-direction: column;
  font-style: normal;
}

.testimonial-main .author {
  font-weight: 600;
  font-family: var(--font-family-mono);
}

.testimonial-main .role {
  font-size: var(--font-size-body-sm);
  color: var(--text-secondary);
}

.testimonial-secondary {
  display: flex;
  flex-direction: column;
  justify-content: center;
  grid-column: span 2;
}

.testimonial-secondary blockquote {
  font-size: var(--font-size-body-lg);
  font-style: italic;
  font-family: var(--font-family-mono);
  margin: 0 0 var(--space-4) 0;
  line-height: var(--line-height-relaxed);
}

.testimonial-secondary cite {
  display: flex;
  flex-direction: column;
  font-style: normal;
}

.testimonial-secondary .author {
  font-weight: 600;
  font-family: var(--font-family-mono);
}

.testimonial-secondary .role {
  font-size: var(--font-size-body-sm);
  color: var(--text-secondary);
}

.testimonial-placeholder {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100px;
  overflow: hidden;
}

.testimonial-placeholder .hatching {
  position: absolute;
  inset: 0;
  background: repeating-linear-gradient(
    45deg,
    transparent,
    transparent 4px,
    var(--surface-tertiary) 4px,
    var(--surface-tertiary) 8px
  );
  opacity: 0.5;
}

.testimonial-placeholder span {
  position: relative;
  z-index: 1;
  font-size: var(--font-size-body-sm);
  color: var(--text-secondary);
  font-style: italic;
}

/* ===== FAQ SECTION ===== */
.faq {
  background: var(--surface-secondary);
  max-width: none;
}

.faq .section-title {
  max-width: 800px;
  margin-left: auto;
  margin-right: auto;
}

.faq-list {
  max-width: 800px;
  margin: 0 auto;
  border: var(--border-width-thick) solid var(--border-primary);
  box-shadow: var(--shadow-md);
}

.faq-item {
  background: var(--surface-primary);
  border-bottom: var(--border-width-thin) solid var(--border-primary);
}

.faq-item:last-child {
  border-bottom: none;
}

.faq-question {
  width: 100%;
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-4);
  background: none;
  border: none;
  font-family: var(--font-family-ui);
  font-size: var(--font-size-body);
  font-weight: 500;
  text-align: left;
  cursor: pointer;
  transition: background 0.1s;
  color: var(--text-primary);
}

.faq-question:hover {
  background: var(--surface-secondary);
}

.faq-toggle {
  font-family: var(--font-family-mono);
  font-size: 20px;
  font-weight: 700;
  width: 24px;
  text-align: center;
  flex-shrink: 0;
}

.faq-answer {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 0.3s ease-out;
}

.faq-item.open .faq-answer {
  grid-template-rows: 1fr;
}

.faq-answer-content {
  overflow: hidden;
  min-height: 0;
  padding: 0 var(--space-4) 0 calc(var(--space-4) + 24px + var(--space-3));
  transition: padding-bottom 0.3s ease-out;
}

.faq-item.open .faq-answer-content {
  padding-bottom: var(--space-4);
}

.faq-answer p {
  margin: 0;
  color: var(--text-secondary);
  line-height: var(--line-height-relaxed);
}

/* ===== WHAT'S NEW SECTION ===== */
.whats-new-entry {
  max-width: 600px;
  margin: 0 auto;
  background: var(--surface-primary);
  border: var(--border-width-thick) solid var(--border-primary);
  box-shadow: var(--shadow-md);
  padding: var(--space-5);
}

.whats-new-date {
  display: block;
  font-family: var(--font-family-mono);
  font-size: var(--font-size-body-sm);
  font-weight: 600;
  color: var(--text-primary);
  letter-spacing: 0.05em;
  margin-bottom: var(--space-3);
}

.whats-new-content :deep(h2) {
  font-size: var(--font-size-body-lg);
  margin-top: var(--space-4);
  margin-bottom: var(--space-2);
  color: var(--text-primary);
}

.whats-new-content :deep(h2:first-child) {
  margin-top: 0;
}

.whats-new-content :deep(p) {
  color: var(--text-secondary);
  margin-bottom: var(--space-2);
  line-height: var(--line-height-relaxed);
}

.whats-new-content :deep(p:last-child) {
  margin-bottom: 0;
}

.whats-new-content :deep(ul) {
  color: var(--text-secondary);
  padding-left: var(--space-5);
  margin-bottom: var(--space-2);
}

.whats-new-link {
  display: inline-block;
  margin-top: var(--space-4);
  padding: var(--space-2) var(--space-4);
  font-family: var(--font-family-mono);
  font-size: var(--font-size-body-sm);
  font-weight: 600;
  color: var(--text-primary);
  text-decoration: none;
  border: var(--border-width-thin) solid var(--border-primary);
  transition: all 0.15s;
}

.whats-new-link:hover {
  background: var(--surface-inverse);
  color: var(--text-inverse);
}

/* ===== FOOTER ===== */
.landing-footer {
  position: relative;
  margin-top: auto;
  background: var(--surface-inverse);
  color: var(--text-inverse);
  padding: 48px var(--space-6);
  overflow: hidden;
}

.footer-content {
  max-width: 1200px;
  margin: 0 auto;
  text-align: center;
}

.footer-logo {
  display: block;
  font-family: var(--font-family-mono);
  font-size: var(--font-size-heading);
  font-weight: 700;
  letter-spacing: 0.1em;
  margin-bottom: var(--space-4);
}

.footer-links {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: var(--space-3);
  margin-bottom: var(--space-4);
}

.footer-links a {
  color: rgba(255, 255, 255, 0.7);
  text-decoration: none;
  font-size: var(--font-size-body-sm);
  transition: color 0.1s;
}

.footer-links a:hover {
  color: var(--text-inverse);
}

.footer-links .divider {
  opacity: 0.3;
}

.footer-tagline {
  margin: 0;
  font-size: var(--font-size-body-sm);
  opacity: 0.6;
}

.footer-bird {
  position: absolute;
  bottom: 0;
  width: 180px;
  height: auto;
  filter: invert(1);
  opacity: 1;
}

.footer-bird-left {
  left: 5%;
}

.footer-bird-right {
  right: 5%;
  transform: scaleX(-1);
}

@media (max-width: 900px) {
  .footer-bird {
    display: none;
  }
}

/* ===== RESPONSIVE ===== */
@media (max-width: 900px) {
  .features-grid {
    grid-template-columns: repeat(2, 1fr);
  }

  .testimonials-grid {
    grid-template-columns: repeat(2, 1fr);
  }

  .testimonial-main {
    grid-column: span 2;
    grid-row: span 1;
  }
}

@media (max-width: 900px) {
  .deco-window-1,
  .deco-window-3,
  .deco-schema {
    display: none;
  }

  .deco-window-2 {
    top: 5%;
    right: 5%;
  }

  .deco-note {
    bottom: 10%;
    right: 3%;
  }
}

@media (max-width: 600px) {
  .section {
    padding: 60px var(--space-4);
  }

  .features-grid {
    grid-template-columns: 1fr;
  }

  .testimonials-grid {
    grid-template-columns: 1fr;
  }

  .testimonial-main {
    grid-column: span 1;
  }

  .hero-decoration,
  .scroll-hint {
    display: none;
  }

  .hero-content {
    padding: var(--space-4);
    margin: var(--space-4);
    max-width: none;
  }

  .hero-features {
    flex-direction: column;
    gap: var(--space-1);
  }

  .hero-features .separator {
    display: none;
  }

  .pro-feature {
    flex-direction: column;
    gap: var(--space-2);
  }

  .status-icon {
    display: none;
  }
}
</style>
