<script lang="ts">
    import { project } from '$lib/store';
    import Canvas from '$lib/Canvas.svelte';
    import type { StageType } from '$lib/types';

    let canvasRef: Canvas;

    function handleFileUpload(e: Event) {
        const target = e.target as HTMLInputElement;
        const file = target.files?.[0];
        if (!file) return;
        
        const reader = new FileReader();
        reader.onload = (event: ProgressEvent<FileReader>) => {
            const result = event.target?.result as string;
            project.update(p => ({ ...p, rawImage: result }));
        };
        reader.readAsDataURL(file);
    }

    function setStage(stage: StageType) {
        project.update(p => ({ ...p, stage }));
    }
</script>

<main class="app">
    <header class="header">
        <h1>Conduit Planner</h1>
        
        <div class="toolbar">
            {#if $project.stage === 'SETUP'}
                <label class="btn file-btn">
                    Upload Floorplan
                    <input type="file" accept="image/*" on:change={handleFileUpload} hidden />
                </label>
                <button class="btn primary" disabled={!$project.rawImage} on:click={() => canvasRef.flatten()}>
                    Flatten & Lock Image
                </button>
            {:else}
                <div class="switcher">
                    <button class:active={$project.stage === 'STUBS'} on:click={() => setStage('STUBS')}>1. Mark Stubs</button>
                    <button class:active={$project.stage === 'OBSTRUCTIONS'} on:click={() => setStage('OBSTRUCTIONS')}>2. Mark Obstructions</button>
                    <button class:active={$project.stage === 'RESULTS'} on:click={() => setStage('RESULTS')}>3. Run Pathfinder</button>
                </div>
            {/if}
        </div>
    </header>

    <!-- ... Keep existing instructions and template below ... -->
    <div class="instructions">
        {#if $project.stage === 'SETUP'}
            <p>Upload an image, drag/resize it to fit, then click "Flatten & Lock".</p>
        {:else if $project.stage === 'STUBS'}
            <p><strong>Click</strong> to place conduit stubs. <strong>Drag</strong> to reposition. Select and press <strong>Delete</strong> to remove.</p>
        {:else if $project.stage === 'OBSTRUCTIONS'}
            <p><strong>Click & Drag</strong> to draw red block-out zones. <strong>Click</strong> to resize or drag. Press <strong>Delete</strong> to remove.</p>
        {:else if $project.stage === 'RESULTS'}
            <p>Paths calculated dynamically! Try clicking back to <em>Obstructions</em>, move a block-out, and return to see it reroute.</p>
        {/if}
    </div>

    <section class="canvas-container">
        <Canvas bind:this={canvasRef} />
    </section>
</main>

<style>
    :global(body) {
        margin: 0;
        font-family: system-ui, -apple-system, sans-serif;
        background-color: #f9fafb;
        color: #111827;
    }

    .app {
        max-width: 900px;
        margin: 0 auto;
        padding: 2rem;
    }

    .header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 1rem;
    }

    h1 {
        margin: 0;
        font-size: 1.5rem;
    }

    .toolbar {
        display: flex;
        gap: 1rem;
    }

    .btn, .switcher button {
        padding: 0.5rem 1rem;
        border: 1px solid #d1d5db;
        background: #fff;
        border-radius: 6px;
        cursor: pointer;
        font-weight: 500;
        transition: all 0.2s;
    }
    
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn:hover:not(:disabled), .switcher button:hover { background: #f3f4f6; }

    .primary { background: #2563eb; color: white; border: none; }
    .primary:hover:not(:disabled) { background: #1d4ed8; }

    .switcher {
        display: flex;
        background: #f3f4f6;
        border-radius: 8px;
        padding: 4px;
        gap: 4px;
    }

    .switcher button {
        border: none;
        background: transparent;
        color: #6b7280;
    }

    .switcher button.active {
        background: #fff;
        color: #111827;
        box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }

    .instructions {
        padding: 1rem;
        background: #eff6ff;
        border-left: 4px solid #3b82f6;
        border-radius: 4px;
        margin-bottom: 2rem;
    }

    .instructions p { margin: 0; color: #1e3a8a; }

    .canvas-container {
        display: flex;
        justify-content: center;
    }
</style>