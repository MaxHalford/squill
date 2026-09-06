import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { createRouter, createWebHashHistory } from 'vue-router'
import './style.css'
import App from './App.vue'
import Home from './views/Home.vue'
import { vTooltip, vTooltipOverflow } from './directives/tooltip'
import './boxes'

const router = createRouter({
  history: createWebHashHistory(`${import.meta.env.BASE_URL}app/`),
  routes: [
    { path: '/', component: Home },
    { path: '/privacy-policy', component: () => import('./views/PrivacyPolicy.vue') },
    { path: '/terms-of-service', component: () => import('./views/TermsOfService.vue') },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})

router.afterEach((to) => {
  const titles: Record<string, string> = {
    '/': 'Squill — SQL canvas',
    '/privacy-policy': 'Privacy Policy — Squill',
    '/terms-of-service': 'Terms of Service — Squill',
  }
  document.title = titles[to.path] || titles['/']
})

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.directive('tooltip', vTooltip)
app.directive('tooltip-overflow', vTooltipOverflow)
app.mount('#app')
