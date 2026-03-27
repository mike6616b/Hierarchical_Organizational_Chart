import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
  root: 'src',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'src/index.html'),
        login: resolve(__dirname, 'src/login.html'),
        forgotPassword: resolve(__dirname, 'src/forgot-password.html'),
        resetPassword: resolve(__dirname, 'src/reset-password.html'),
      },
    },
  },
  server: {
    port: 5173,
    open: true,
  },
})
