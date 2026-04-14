<script lang="ts">
    import { project } from '$lib/store';
    import Canvas from '$lib/components/Canvas.svelte';
    import type { StageType, RunType, Stub } from '$lib/types';

    let canvasRef: Canvas;

    $: if ($project.currentRunId === undefined) {
        project.update(p => ({ ...p, currentRunId: 'A', currentRunType: 'DAISY_CHAIN' }));
    }

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

    async function loadTestImage() {
        const response = await fetch('/test-floorplan.jpg');
        const blob = await response.blob();
        const reader = new FileReader();
        reader.onload = (e) => {
            project.update(p => ({ ...p, rawImage: e.target?.result as string }));
        };
        reader.readAsDataURL(blob);
    }

    function setStage(stage: StageType) {
        project.update(p => ({ ...p, stage }));
    }

    function getNextRunId(stubs: Stub[]) {
        if (stubs.length === 0) return 'A';
        const runs = [...new Set(stubs.map(s => s.runId))];
        const lastRun = runs.sort().pop() || 'A';
        return String.fromCharCode(lastRun.charCodeAt(0) + 1);
    }

    function handleNewRun() {
        project.update(p => ({
            ...p,
            currentRunId: getNextRunId(p.stubs)
        }));
    }

    function setRunType(type: RunType) {
        project.update(p => ({ ...p, currentRunType: type }));
    }

    function reverseCurrentRun() {
        project.update(p => {
            const runId = p.currentRunId || 'A';
            const runStubs = p.stubs.filter(s => s.runId === runId && !s.isBox);
            const currentIndices = runStubs.map(s => s.index);
            const reversedIndices = [...currentIndices].reverse();
            
            const updatedStubs = p.stubs.map(s => {
                if (s.runId === runId && !s.isBox) {
                    const idx = runStubs.findIndex(rs => rs.id === s.id);
                    return { ...s, index: reversedIndices[idx] };
                }
                return s;
            });

            return { ...p, stubs: updatedStubs };
        });
    }
</script>

<main class="app">
    <header class="header">
        <h1>Conduit Planner</h1>
        
        <div class="toolbar">
            {#if $project.stage === 'SETUP'}
                <button class="btn" on:click={loadTestImage}>Use Test Image</button>
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

    <div class="instructions">
        {#if $project.stage === 'SETUP'}
            <p>Upload an image, drag/resize it to fit, then click "Flatten & Lock".</p>
        {:else if $project.stage === 'STUBS'}
            <div class="stubs-layout">
                <div class="stubs-info">
                    <p><strong>Click</strong> to place conduit stubs. <strong>Drag</strong> to reposition. Select and press <strong>Delete</strong> to remove.</p>
                    <div class="run-controls">
                        <span class="run-badge">Run {$project.currentRunId || 'A'}</span>
                        <button class="btn btn-sm" on:click={handleNewRun}>New Run</button>
                        <div class="radio-group">
                            <label>
                                <input type="radio" name="runType" 
                                    checked={$project.currentRunType !== 'HOME_RUN'} 
                                    on:change={() => setRunType('DAISY_CHAIN')} /> 
                                Daisy Chain
                            </label>
                            <label>
                                <input type="radio" name="runType" 
                                    checked={$project.currentRunType === 'HOME_RUN'} 
                                    on:change={() => setRunType('HOME_RUN')} /> 
                                Home Run
                            </label>
                        </div>
                        {#if $project.currentRunType !== 'HOME_RUN'}
                            <button class="btn btn-sm" on:click={reverseCurrentRun}>Reverse Order</button>
                        {/if}
                    </div>
                </div>
                <button class="btn danger" disabled={$project.stubs.length === 0} on:click={() => project.update(p => ({...p, stubs: []}))}>
                    Clear All
                </button>
            </div>
        {:else if $project.stage === 'OBSTRUCTIONS'}
            <p><strong>Click & Drag</strong> to draw red block-out zones. <strong>Click</strong> to resize or drag. Press <strong>Delete</strong> to remove.</p>
            <button class="btn danger" disabled={$project.obstructions.length === 0} on:click={() => project.update(p => ({...p, obstructions: []}))}>
                Clear All
            </button>
        {:else if $project.stage === 'RESULTS'}
            <p>Paths calculated dynamically! Try clicking back to <em>Obstructions</em>, move a block-out, and return to see it reroute.</p>
        {/if}
    </div>

    <section class="canvas-container">
        <Canvas bind:this={canvasRef} />
    </section>
</main>

<style>
    :global(body) { margin: 0; font-family: system-ui, -apple-system, sans-serif; background-color: #f9fafb; color: #111827; }
    .app { max-width: 900px; margin: 0 auto; padding: 2rem; }
    .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; }
    h1 { margin: 0; font-size: 1.5rem; }
    .toolbar { display: flex; gap: 1rem; }
    
    .btn, .switcher button { padding: 0.5rem 1rem; border: 1px solid #d1d5db; background: #fff; border-radius: 6px; cursor: pointer; font-weight: 500; transition: all 0.2s; }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn:hover:not(:disabled), .switcher button:hover { background: #f3f4f6; }
    .primary { background: #2563eb; color: white; border: none; }
    .primary:hover:not(:disabled) { background: #1d4ed8; }
    .danger { background: #fee2e2; color: #dc2626; border: 1px solid #fca5a5; }
    .danger:hover:not(:disabled) { background: #fecaca; }

    .switcher { display: flex; background: #f3f4f6; border-radius: 8px; padding: 4px; gap: 4px; }
    .switcher button { border: none; background: transparent; color: #6b7280; }
    .switcher button.active { background: #fff; color: #111827; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }

    .instructions { display: flex; justify-content: space-between; align-items: center; padding: 1rem; background: #eff6ff; border-left: 4px solid #3b82f6; border-radius: 4px; margin-bottom: 2rem; min-height: 48px; }
    .instructions p { margin: 0; color: #1e3a8a; }

    .stubs-layout { display: flex; justify-content: space-between; align-items: center; width: 100%; gap: 1rem; }
    .stubs-info { display: flex; flex-direction: column; gap: 0.75rem; }
    .run-controls { display: flex; align-items: center; gap: 0.75rem; background: #fff; padding: 0.5rem; border-radius: 6px; border: 1px solid #bfdbfe; font-size: 0.9rem; }
    .run-badge { font-weight: bold; background: #e0e7ff; color: #3730a3; padding: 0.25rem 0.5rem; border-radius: 4px; }
    .radio-group { display: flex; gap: 0.75rem; border-left: 1px solid #e5e7eb; border-right: 1px solid #e5e7eb; padding: 0 0.75rem; }
    .radio-group label { display: flex; align-items: center; gap: 0.25rem; cursor: pointer; color: #374151; }
    .btn-sm { padding: 0.25rem 0.5rem; font-size: 0.875rem; }

    .canvas-container { display: flex; justify-content: center; }
</style>