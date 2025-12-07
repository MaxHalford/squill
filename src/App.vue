<template>
  <div class="app">
    <nav v-if="!$route.path || $route.path === '/'">
      <h1>Prototype Pages</h1>
      <ul>
        <li><router-link to="/page1">Page 1</router-link></li>
        <li><router-link to="/page2">Page 2</router-link></li>
        <li><router-link to="/page3">Page 3</router-link></li>
      </ul>
    </nav>
    <router-view />
  </div>
</template>

<style scoped>
.app {
  padding: 2rem;
}

nav h1 {
  margin-bottom: 1rem;
}

nav ul {
  list-style: none;
  padding: 0;
}

nav li {
  margin: 0.5rem 0;
}

nav a {
  font-size: 1.2rem;
  color: #42b883;
  text-decoration: none;
}

nav a:hover {
  text-decoration: underline;
}
</style>
