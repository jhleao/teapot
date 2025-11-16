import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: path.resolve(__dirname, './src/node/index.ts')
        }
      }
    },
    resolve: {
      alias: {
        '@shared': path.resolve(__dirname, './src/shared'),
        '@shared/types': path.resolve(__dirname, './src/shared/types/index.ts')
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: path.resolve(__dirname, './src/web-preload/index.ts')
        }
      }
    },
    resolve: {
      alias: {
        '@shared': path.resolve(__dirname, './src/shared'),
        '@shared/types': path.resolve(__dirname, './src/shared/types/index.ts')
      }
    }
  },
  renderer: {
    root: path.resolve(__dirname, './src/web'),
    plugins: [react(), tailwindcss()],
    build: {
      rollupOptions: {
        input: {
          index: path.resolve(__dirname, './src/web/index.html')
        }
      }
    },
    resolve: {
      alias: {
        '@shared': path.resolve(__dirname, './src/shared'),
        '@shared/types': path.resolve(__dirname, './src/shared/types/index.ts')
      }
    }
  }
})
