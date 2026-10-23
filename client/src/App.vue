<template>
  <div class="app-shell">
    <header class="app-header">
      <div class="header-inner">
        <router-link to="/form" class="brand" aria-label="返回填写申请表">
          <span class="brand-mark">变</span>
          <span class="brand-copy">
            <strong>财务管理系统</strong>
            <small>CHANGE REQUEST DESK</small>
          </span>
        </router-link>

        <nav class="main-nav" aria-label="主导航">
          <router-link to="/form" class="nav-link">填写申请表</router-link>
          <router-link to="/records" class="nav-link">导出记录查询</router-link>
          <router-link to="/plans" class="nav-link">变更方案记录</router-link>
          <router-link to="/options" class="nav-link">下拉选项维护</router-link>
        </nav>

        <div class="header-meta">
          <span class="status-dot" aria-hidden="true"></span>
          本地运行
        </div>
      </div>
    </header>

    <main class="app-main">
      <router-view v-slot="{ Component }">
        <component :is="Component" :key="$route.fullPath" />
      </router-view>
    </main>

    <footer class="app-footer">
      <span>变更申请工作台 · 数据保存在本机 SQLite</span>
      <span>无需登录 · 每次导出自动留痕</span>
    </footer>
  </div>
</template>
