<template>
  <div class="app-shell">
    <div id="nav">
      <router-link to="/">Start</router-link>
      <router-link to="/map-view">Map View</router-link>
      <router-link to="/map-file-view">Map File View</router-link>
      <router-link to="/lib-view">Lib View</router-link>
      <router-link to="/gh-view">Gh View</router-link>
      <router-link to="/gfx-view">Gfx View</router-link>
      <router-link to="/jil-view">Jil View</router-link>
      <router-link to="/logging-view">Logging</router-link>
    </div>

    <router-view :fileManager="fileManager" class="app-content" />
  </div>
</template>

<script src="./app.ts"></script>

<style>
html, body {
  margin: 0;
  padding: 0;
  height: 100%;
  overflow: hidden;
  background: #0d0a05;
}

#app {
  font-family: Avenir, Helvetica, Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-align: left;
  color: #c8a96e;
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: #0d0a05;
}

#nav {
  display: flex;
  gap: 2px;
  padding: 0;
  background: #0d0a05;
  border-bottom: 2px solid #5c3d1a;
  flex-shrink: 0;
}

#nav a {
  display: inline-block;
  padding: 6px 14px;
  font-weight: bold;
  font-size: 12px;
  color: #8a7040;
  text-decoration: none;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  border-bottom: 2px solid transparent;
  transition: color 0.15s, background 0.15s;
}

#nav a:hover {
  color: #c8a96e;
  background: #1a1209;
}

#nav a.router-link-exact-active {
  color: #e8c87e;
  background: #1a1209;
  border-bottom-color: #d4a030;
}

.app-shell {
  display: flex;
  flex-direction: column;
  height: 100vh;
}

.app-content {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

/* Global dark-themed form controls */
select {
  background: #1a1209;
  color: #c8a96e;
  border: 1px solid #4a3218;
  border-radius: 3px;
  padding: 4px 8px;
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
  outline: none;
  -webkit-appearance: none;
  -moz-appearance: none;
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%238a7040'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 8px center;
  padding-right: 24px;
}

select:hover {
  border-color: #6a4a20;
  background-color: #2c1e0e;
}

select:focus {
  border-color: #d4a030;
}

select option {
  background: #1a1209;
  color: #c8a96e;
}

/* Custom checkbox */
input[type="checkbox"] {
  -webkit-appearance: none;
  -moz-appearance: none;
  appearance: none;
  width: 14px;
  height: 14px;
  background: #1a1209;
  border: 1px solid #4a3218;
  border-radius: 2px;
  cursor: pointer;
  vertical-align: middle;
  position: relative;
  flex-shrink: 0;
}

input[type="checkbox"]:hover {
  border-color: #6a4a20;
  background: #2c1e0e;
}

input[type="checkbox"]:checked {
  background: #3a2810;
  border-color: #d4a030;
}

input[type="checkbox"]:checked::after {
  content: '';
  position: absolute;
  left: 3px;
  top: 0px;
  width: 4px;
  height: 8px;
  border: solid #e8c87e;
  border-width: 0 2px 2px 0;
  transform: rotate(45deg);
}
</style>
