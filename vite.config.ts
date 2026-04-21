import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import path from 'node:path';

export default defineConfig({
  server: {
    host: '::',
    port: 8080,
    proxy: {
      '/api/transcribeRoundAudio': {
        target: 'https://us-central1-gen-lang-client-0815518176.cloudfunctions.net',
        changeOrigin: true,
        rewrite: () => '/transcribeRoundAudio',
      },
      '/api/getDeepgramAccessToken': {
        target: 'https://us-central1-gen-lang-client-0815518176.cloudfunctions.net',
        changeOrigin: true,
        rewrite: () => '/getDeepgramAccessToken',
      },
      '/api/fetchRouterModels': {
        target: 'https://us-central1-gen-lang-client-0815518176.cloudfunctions.net',
        changeOrigin: true,
        rewrite: () => '/fetchRouterModels',
      },
      '/api/testRouterCompletion': {
        target: 'https://us-central1-gen-lang-client-0815518176.cloudfunctions.net',
        changeOrigin: true,
        rewrite: () => '/testRouterCompletion',
      },
      '/api/fetchGoogleSttModels': {
        target: 'https://us-central1-gen-lang-client-0815518176.cloudfunctions.net',
        changeOrigin: true,
        rewrite: () => '/fetchGoogleSttModels',
      },
      '/api/testGoogleSttModels': {
        target: 'https://us-central1-gen-lang-client-0815518176.cloudfunctions.net',
        changeOrigin: true,
        rewrite: () => '/testGoogleSttModels',
      },

      '/api/analyzeTranscriptOhm': {
        target: 'https://us-central1-gen-lang-client-0815518176.cloudfunctions.net',
        changeOrigin: true,
        rewrite: () => '/analyzeTranscriptOhm',
      },
      '/api/evaluateCaptionCrewMeaning': {
        target: 'https://us-central1-gen-lang-client-0815518176.cloudfunctions.net',
        changeOrigin: true,
        rewrite: () => '/evaluateCaptionCrewMeaning',
      },
    },
  },
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});