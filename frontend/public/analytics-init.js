if (location.hostname === 'squill.dev' || location.hostname === 'www.squill.dev') {
  var s = document.createElement('script');
  s.defer = true;
  s.src = 'https://cloud.umami.is/script.js';
  s.dataset.websiteId = '74b068f5-d2b5-4b93-85b1-d5462dfbe6f3';
  document.head.appendChild(s);
}
