(() => {
  const response = Object.fromEntries(new URLSearchParams(window.location.hash.slice(1)))
  const state = response.state

  // Remove the access token from the address bar before doing anything else.
  history.replaceState(null, '', `${location.pathname}${location.search}`)

  if (!state) {
    document.body.textContent = 'Google did not return a valid authorization response. You can close this window.'
    return
  }

  const channel = new BroadcastChannel(`squill-google-oauth-${state}`)
  channel.postMessage(response)
  document.body.textContent = 'Connected. You can close this window.'

  window.setTimeout(() => {
    channel.close()
    window.close()
  }, 100)
})()
