(function() {
  try {
    // Landing page is always light mode
    if (location.pathname === '/') {
      document.documentElement.classList.add('light');
      return;
    }
    var settings = JSON.parse(localStorage.getItem('squill-settings') || '{}');
    var theme = settings.themePreference || 'system';
    if (theme === 'system') {
      theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    document.documentElement.classList.add(theme);
  } catch (e) {
    document.documentElement.classList.add('light');
  }
})();
