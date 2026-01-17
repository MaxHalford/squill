import { ViteSSG } from 'vite-ssg'
import { createPinia } from 'pinia'
import './style.css'
import App from './App.vue'
import type { RouteRecordRaw } from 'vue-router'
import { vTooltip } from './directives/tooltip'

// Eagerly load landing page for fast initial render
import LandingPage from './views/LandingPage.vue'

// Lazy load other routes to reduce initial bundle size
const Home = () => import('./views/Home.vue')
const PrivacyPolicy = () => import('./views/PrivacyPolicy.vue')
const TermsOfService = () => import('./views/TermsOfService.vue')
const RefundPolicy = () => import('./views/RefundPolicy.vue')
const Workbench = () => import('./views/Workbench.vue')
const AuthCallback = () => import('./views/AuthCallback.vue')
const AccountPage = () => import('./views/AccountPage.vue')
const NotFound = () => import('./views/NotFound.vue')

const routes: RouteRecordRaw[] = [
  { path: '/', component: LandingPage },
  { path: '/app', component: Home },
  { path: '/auth/callback', component: AuthCallback },
  { path: '/account', component: AccountPage },
  { path: '/privacy-policy', component: PrivacyPolicy },
  { path: '/terms-of-service', component: TermsOfService },
  { path: '/refund-policy', component: RefundPolicy },
  { path: '/workbench', component: Workbench },
  { path: '/:pathMatch(.*)*', component: NotFound },
]

export const createApp = ViteSSG(
  App,
  {
    routes,
    base: import.meta.env.BASE_URL,
    scrollBehavior(to, _from, savedPosition) {
      // Restore scroll position when using browser back/forward
      if (savedPosition) {
        return savedPosition
      }
      // Scroll to hash anchor if present
      if (to.hash) {
        return { el: to.hash }
      }
      // Only scroll to top for policy pages, not the homepage
      const policyPages = ['/privacy-policy', '/terms-of-service', '/refund-policy']
      if (policyPages.includes(to.path)) {
        return { top: 0 }
      }
      // Don't change scroll for other navigations
      return false
    }
  },
  ({ app }) => {
    const pinia = createPinia()
    app.use(pinia)
    app.directive('tooltip', vTooltip)
  }
)
