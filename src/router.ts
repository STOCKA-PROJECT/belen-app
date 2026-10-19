import { createRouter, createWebHashHistory } from 'vue-router'

import { useAuthStore } from './stores/auth'

/**
 * Hash history: the app is served from the Capacitor local server as a static page, so there is
 * no server-side rewriting of deep links.
 */
export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', redirect: '/library' },
    { path: '/login', component: () => import('./views/LoginView.vue'), meta: { tab: 'stocka' } },
    { path: '/orgs', component: () => import('./views/OrganizationsView.vue'), meta: { tab: 'stocka', requiresAuth: true } },
    { path: '/orgs/:slug/timelines', component: () => import('./views/TimelinesView.vue'), meta: { tab: 'stocka', requiresAuth: true } },
    { path: '/library', component: () => import('./views/LibraryView.vue'), meta: { tab: 'library' } },
    { path: '/pi', component: () => import('./views/PiView.vue'), meta: { tab: 'pi' } },
    { path: '/:pathMatch(.*)*', redirect: '/library' },
  ],
})

router.beforeEach((to) => {
  if (to.meta.requiresAuth && !useAuthStore().isAuthenticated) {
    return { path: '/login', query: { redirect: to.fullPath } }
  }
  return true
})
