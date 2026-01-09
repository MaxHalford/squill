import { ViteSSG } from 'vite-ssg'
import { createPinia } from 'pinia'
import './style.css'
import App from './App.vue'
import type { RouteRecordRaw } from 'vue-router'
import LandingPage from './views/LandingPage.vue'
import Home from './views/Home.vue'
import PrivacyPolicy from './views/PrivacyPolicy.vue'
import TermsOfService from './views/TermsOfService.vue'
import Workbench from './views/Workbench.vue'
import AuthCallback from './views/AuthCallback.vue'

const routes: RouteRecordRaw[] = [
  { path: '/', component: LandingPage },
  { path: '/app', component: Home },
  { path: '/auth/callback', component: AuthCallback },
  { path: '/privacy-policy', component: PrivacyPolicy },
  { path: '/terms-of-service', component: TermsOfService },
  { path: '/workbench', component: Workbench },
]

export const createApp = ViteSSG(
  App,
  { routes, base: import.meta.env.BASE_URL },
  ({ app }) => {
    const pinia = createPinia()
    app.use(pinia)
  }
)
