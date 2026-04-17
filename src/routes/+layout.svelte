<script lang="ts">
	import './layout.css';
	import { onMount } from 'svelte';

	onMount(() => {
		if ('serviceWorker' in navigator) {
		navigator.serviceWorker.register('/sw.js');
		}
	});
	let { children } = $props();
</script>

<svelte:head></svelte:head>
{@render children()}
