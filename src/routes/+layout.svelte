<script lang="ts">
	import './layout.css';
	import { onMount } from 'svelte';

	onMount(() => {
		if ('serviceWorker' in navigator) {
		    navigator.serviceWorker.register('/sw.js').catch(console.error);
		}
	});
	let { children } = $props();
</script>

<svelte:head>
    <link rel="manifest" href="/manifest.json" />
    <meta name="theme-color" content="#2563eb" />
</svelte:head>
{@render children()}