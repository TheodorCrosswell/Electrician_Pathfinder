import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
	plugins: [
		sveltekit(),
		tailwindcss(),
		VitePWA({
			registerType: 'autoUpdate',
			manifest: {
				name: 'Conduit Planner CAD',
				short_name: 'Planner',
				theme_color: '#ffffff',
				display: 'standalone'
			},
			workbox: {
				globPatterns: ['**/*.{js,css,html,ico,png,svg}'] // Caches everything for offline use
			}
		})
	]
});