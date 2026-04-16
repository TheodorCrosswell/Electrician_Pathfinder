<script lang="ts">
    import { project } from '$lib/store';
    import Canvas from '$lib/components/Canvas.svelte';
    import type { RunType, Stub } from '$lib/types';
    
    let canvasRef: Canvas;
    let activeTool = 'stub';

    $: if ($project.currentRunId === undefined) {
        project.update(p => ({ ...p, currentRunId: 'A', currentRunType: 'DAISY_CHAIN' }));
    }

    // Determine distinct runs dynamically 
    $: runsList = getRunsList($project.stubs, $project.currentRunId, $project.currentRunType);
    
    function getRunsList(stubs: Stub[], currentId: string | undefined, currentType: RunType | undefined) {
            const runsMap: Record<string, { type: RunType; count: number }> = {};
            
            stubs.forEach(s => { 
                if (!runsMap[s.runId]) {
                    runsMap[s.runId] = { type: s.runType, count: 0 };
                }
                runsMap[s.runId].count++;
            });
            
            if (currentId && !(currentId in runsMap)) {
                runsMap[currentId] = { type: currentType || 'DAISY_CHAIN', count: 0 };
            }
            
            return Object.entries(runsMap)
                .map(([id, data]) => {
                    // If Home Run, subtract 1 to exclude the 'box' from the label count
                    let displayCount = data.count;
                    if (data.type === 'HOME_RUN' && displayCount > 0) {
                        displayCount -= 1;
                    }
                    return { id, type: data.type, count: displayCount };
                })
                .sort((a, b) => a.id.localeCompare(b.id));
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
        reader.onload = (e: ProgressEvent<FileReader>) => {
            project.update(p => ({ ...p, rawImage: e.target?.result as string }));
        };
        reader.readAsDataURL(blob);
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
            currentRunId: getNextRunId(p.stubs),
            currentRunType: 'DAISY_CHAIN'
        }));
    }

    function deleteRun(runId: string) {
        project.update(p => {
            const remainingStubs = p.stubs.filter(s => s.runId !== runId);
            const nextRunsList = getRunsList(remainingStubs, undefined, undefined).filter(r => r.id !== runId);
            
            const nextCurrentId = nextRunsList.length > 0 ? nextRunsList[0].id : 'A';
            const nextCurrentType = nextRunsList.length > 0 ? nextRunsList[0].type : 'DAISY_CHAIN';

            return {
                ...p,
                stubs: remainingStubs,
                currentRunId: nextCurrentId,
                currentRunType: nextCurrentType
            };
        });
    }

    function selectRun(runId: string, runType: RunType) {
        project.update(p => ({ ...p, currentRunId: runId, currentRunType: runType }));
    }

    function setRunType(type: RunType) {
        project.update(p => {
            const currentId = p.currentRunId || 'A';
            let currentStubs = p.stubs;

            if (type === 'DAISY_CHAIN') {
                currentStubs = currentStubs.filter(s => !(s.runId === currentId && s.isBox));
            }

            const updatedStubs = currentStubs.map(s => 
                s.runId === currentId ? { ...s, runType: type } : s
            );
            return { ...p, currentRunType: type, stubs: updatedStubs };
        });
    }
</script>

<div class="app-layout">
    <!-- Top Toolbar Area -->
    <header class="top-toolbar">
        {#if $project.stage === 'SETUP'}
            <div class="toolbar-section">
                <span class="title">Setup Floorplan:</span>
                <button class="btn" on:click={loadTestImage}>Use Test Image</button>
                <label class="btn file-btn">
                    Upload Floorplan
                    <input type="file" accept="image/*" on:change={handleFileUpload} hidden />
                </label>
            </div>
            <div class="toolbar-section">
                <button class="btn primary" disabled={!$project.rawImage} on:click={() => canvasRef.flatten()}>
                    Flatten & Lock Image
                </button>
            </div>
        {:else}
            <!-- Stubs / Planning Tools -->
            <div class="toolbar-section">
                <button class="btn icon-btn tool-btn" class:active={activeTool === 'stub'} on:click={() => activeTool = 'stub'}>
                    📍 Place Stubs
                </button>

                <div class="divider"></div>

                <div class="run-controls">
                    <select class="select-sm" value={$project.currentRunId} on:change={(e) => {
                        const val = (e.currentTarget).value;
                        const run = runsList.find(r => r.id === val);
                        if (run) {
                            selectRun(run.id, run.type);
                            activeTool = 'stub';
                        }
                    }}>
                        {#each runsList as run (run.id)}
                            <option value={run.id}>
                                Run {run.id} ({run.count} {run.count === 1 ? 'stub' : 'stubs'}, {run.type === 'HOME_RUN' ? 'Home Run' : 'Daisy Chain'})
                            </option>
                        {/each}
                    </select>

                    <button class="btn text-sm" on:click={() => { handleNewRun(); activeTool = 'stub'; }}>+ New</button>

                    <div class="radio-group">
                        <label>
                            <input type="radio" name="runType" checked={$project.currentRunType === 'HOME_RUN'} on:change={() => setRunType('HOME_RUN')} /> 
                            Home Run
                        </label>
                        <label>
                            <input type="radio" name="runType" checked={$project.currentRunType !== 'HOME_RUN'} on:change={() => setRunType('DAISY_CHAIN')} /> 
                            Daisy Chain
                        </label>
                    </div>

                    <button class="btn text-sm danger" on:click={() => deleteRun($project.currentRunId || 'A')}>Delete Run</button>
                </div>
            </div>

            <!-- Visible Division -->
            <div class="divider-thick"></div>

            <!-- Obstruction Tools -->
            <div class="toolbar-section">
                <span class="title">Obstacles:</span>
                <button class="btn tool-btn" class:active={activeTool === 'rectangle'} on:click={() => activeTool = 'rectangle'}>Rectangle</button>
                <button class="btn tool-btn" class:active={activeTool === 'vh_line'} on:click={() => activeTool = 'vh_line'}>Straight H/V Line</button>
                <button class="btn tool-btn" class:active={activeTool === 'line'} on:click={() => activeTool = 'line'}>Straight Line</button>
                <button class="btn tool-btn" class:active={activeTool === 'freehand'} on:click={() => activeTool = 'freehand'}>Freehand</button>
                <button class="btn tool-btn" class:active={activeTool === 'circle'} on:click={() => activeTool = 'circle'}>Circle</button>
                <button class="btn tool-btn" class:active={activeTool === 'oval'} on:click={() => activeTool = 'oval'}>Oval</button>
            </div>
            
            <div class="spacer"></div>

            <!-- Resolution & Overlap Control -->
            <div class="toolbar-section">
                <select class="select-sm" title="Grid Resolution" value={$project.gridResolution || 10} on:change={(e) => project.update(p => ({ ...p, gridResolution: Number((e.currentTarget).value) }))}>
                    <option value={20}>Low Res Grid</option>
                    <option value={10}>Normal Res</option>
                    <option value={5}>High Res Grid</option>
                </select>

                <select class="select-sm" title="Maximum overlapping path lines allowed" value={$project.maxOverlap || 3} on:change={(e) => project.update(p => ({ ...p, maxOverlap: Number((e.currentTarget).value) }))}>
                    <option value={1}>Max Overlap: 1</option>
                    <option value={2}>Max Overlap: 2</option>
                    <option value={3}>Max Overlap: 3</option>
                    <option value={4}>Max Overlap: 4</option>
                    <option value={5}>Max Overlap: 5</option>
                </select>
            </div>
        {/if}
    </header>

    <!-- Main Canvas Area -->
    <main class="canvas-area">
        <!-- Pass the globally set maxOverlap directly into the canvas config -->
        <Canvas 
            bind:this={canvasRef} 
            {activeTool} 
            gridResolution={$project.gridResolution || 10} 
            maxOverlap={$project.maxOverlap || 3} 
        />
    </main>
</div>

<style>
    /* Global Reset overrides to allow full screen Layout */
    :global(body, html) { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; font-family: system-ui, -apple-system, sans-serif; background-color: #f3f4f6; color: #111827; }
    
    .app-layout {
        display: flex;
        flex-direction: column;
        width: 100vw;
        height: 100vh;
        overflow: hidden;
    }

    /* --- Top Toolbar Area --- */
    .top-toolbar {
        display: flex;
        align-items: center;
        gap: 1rem;
        background: #ffffff;
        border-bottom: 1px solid #d1d5db;
        padding: 0.5rem 1rem;
        height: 64px;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
        flex-shrink: 0;
        z-index: 50;
        overflow-x: auto;
        white-space: nowrap;
    }

    .toolbar-section {
        display: flex;
        align-items: center;
        gap: 0.5rem;
    }

    .spacer {
        flex-grow: 1;
    }

    .title {
        font-weight: 600;
        color: #374151;
        font-size: 0.9rem;
        margin-right: 0.25rem;
    }

    .divider {
        width: 1px;
        height: 24px;
        background: #d1d5db;
        margin: 0 0.25rem;
    }

    .divider-thick {
        width: 3px;
        height: 32px;
        background: #9ca3af;
        border-radius: 2px;
        margin: 0 0.5rem;
    }

    /* Controls & Buttons */
    .btn { 
        padding: 0.45rem 0.85rem; 
        border: 1px solid #d1d5db; 
        background: #fff; 
        border-radius: 6px; 
        cursor: pointer; 
        font-weight: 500; 
        font-size: 0.85rem;
        transition: all 0.2s; 
        display: inline-flex;
        align-items: center;
        justify-content: center;
    }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn:hover:not(:disabled) { background: #f3f4f6; }

    .primary { background: #2563eb; color: white; border: none; }
    .primary:hover:not(:disabled) { background: #1d4ed8; }

    .danger { background: #fee2e2; color: #dc2626; border: 1px solid #fca5a5; }
    .danger:hover:not(:disabled) { background: #fecaca; }

    .text-sm { font-size: 0.75rem; padding: 0.35rem 0.6rem; }
    .file-btn { margin: 0; cursor: pointer; }

    /* Tools Highlight */
    .tool-btn { color: #4b5563; }
    .tool-btn.active { background: #e0e7ff; color: #3730a3; border-color: #818cf8; box-shadow: 0 0 0 1px #818cf8; }

    .run-controls {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        background: #f9fafb;
        padding: 0.25rem 0.5rem;
        border-radius: 6px;
        border: 1px solid #e5e7eb;
    }

    .select-sm { 
        padding: 0.35rem; 
        border-radius: 4px; 
        border: 1px solid #d1d5db; 
        background: #fff; 
        font-size: 0.85rem; 
        cursor: pointer; 
        outline: none; 
        min-width: 80px;
    }
    .select-sm:focus { border-color: #3b82f6; box-shadow: 0 0 0 1px #3b82f6; }

    .radio-group {
        display: flex;
        gap: 0.75rem;
        font-size: 0.8rem;
        color: #374151;
        margin: 0 0.5rem;
        font-weight: 500;
    }
    .radio-group label { display: flex; align-items: center; gap: 0.25rem; cursor: pointer; }

    /* --- Main Canvas Area --- */
    .canvas-area {
        flex: 1;
        position: relative;
        background-color: #e5e7eb;
        display: flex;
        justify-content: center;
        align-items: center;
        overflow: auto;
        padding: 2rem;
    }
</style>