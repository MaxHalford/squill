// Clear pre-rendered landing page content on non-SSG routes to prevent flash
if (location.pathname !== '/' && !/^\/(privacy-policy|terms-of-service|refund-policy)\/?$/.test(location.pathname)) {
  document.getElementById('app').innerHTML = '';
}
