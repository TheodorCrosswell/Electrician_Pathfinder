<script lang="ts">
    import { project } from '$lib/store';
    import Canvas from '$lib/components/Canvas.svelte';
    import type { StageType, RunType, Stub } from '$lib/types';

    let canvasRef: Canvas;
    let obstructionTool = 'rectangle';

    $: if ($project.currentRunId === undefined) {
        project.update(p => ({ ...p, currentRunId: 'A', currentRunType: 'DAISY_CHAIN' }));
    }

    // Determine distinct runs dynamically 
    $: runsList = getRunsList($project.stubs, $project.currentRunId, $project.currentRunType);

    function getRunsList(stubs: Stub[], currentId: string | undefined, currentType: RunType | undefined) {
        const runsMap: Record<string, RunType> = {};
        stubs.forEach(s => { runsMap[s.runId] = s.runType; });
        
        if (currentId && !(currentId in runsMap)) {
            runsMap[currentId] = currentType || 'DAISY_CHAIN';
        }
        
        return Object.entries(runsMap)
            .map(([id, type]) => ({ id, type }))
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

    <div class="instructions { $project.stage === 'STUBS' ? 'stubs-active' : '' }">
        {#if $project.stage === 'SETUP'}
            <p>Upload an image, drag/resize it to fit, then click "Flatten & Lock".</p>
        {:else if $project.stage === 'STUBS'}
            <div class="stubs-layout">
                <p><strong>Click</strong> to place conduit stubs. <strong>Drag</strong> to reposition. Select and press <strong>Delete</strong> to remove.</p>
                <div class="stubs-menu-container">
                    <div class="menu-actions">
                        <button class="btn btn-sm primary" on:click={handleNewRun}>New Run</button>
                        <button class="btn btn-sm danger" on:click={() => deleteRun($project.currentRunId || 'A')}>Delete Run</button>
                    </div>
                    
                    <div class="runs-list">
                        {#each runsList as run (run.id)}
                            <!-- svelte-ignore a11y_click_events_have_key_events -->
                            <!-- svelte-ignore a11y_no_static_element_interactions -->
                            <div 
                                class="run-item" 
                                class:active={$project.currentRunId === run.id}
                                on:click={() => selectRun(run.id, run.type)}
                            >
                                <strong>Run {run.id}</strong>
                                <span class="badge {run.type === 'HOME_RUN' ? 'badge-home' : 'badge-daisy'}">
                                    {run.type === 'HOME_RUN' ? 'Home Run' : 'Daisy Chain'}
                                </span>
                            </div>
                        {/each}
                    </div>

                    <div class="run-settings">
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
                </div>
            </div>
        {:else if $project.stage === 'OBSTRUCTIONS'}
            <div class="obstructions-layout">
                <p><strong>Draw Block-Out Zones</strong>. Select your tool below to draw. <strong>Click placed obstacles</strong> to drag/resize, or press <strong>Delete</strong> to remove.</p>
                
                <div class="obstruction-tools">
                    <label class="tool-label"><input type="radio" bind:group={obstructionTool} value="rectangle" /> Rectangle</label>
                    <label class="tool-label"><input type="radio" bind:group={obstructionTool} value="vh_line" /> Straight H/V Line</label>
                    <label class="tool-label"><input type="radio" bind:group={obstructionTool} value="line" /> Straight Line</label>
                    <label class="tool-label"><input type="radio" bind:group={obstructionTool} value="freehand" /> Freehand</label>
                    <label class="tool-label"><input type="radio" bind:group={obstructionTool} value="circle" /> Circle</label>
                    <label class="tool-label"><input type="radio" bind:group={obstructionTool} value="oval" /> Oval</label>
                </div>

                <button class="btn danger" disabled={$project.obstructions.length === 0} on:click={() => project.update(p => ({...p, obstructions: []}))}>
                    Clear All Obstructions
                </button>
            </div>
        {:else if $project.stage === 'RESULTS'}
            <p>Paths calculated dynamically! Try clicking back to <em>Obstructions</em>, move a block-out, and return to see it reroute.</p>
        {/if}
    </div>

    <section class="canvas-container">
        <Canvas bind:this={canvasRef} {obstructionTool} />
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
    .btn-sm { padding: 0.25rem 0.6rem; font-size: 0.875rem; }

    .switcher { display: flex; background: #f3f4f6; border-radius: 8px; padding: 4px; gap: 4px; }
    .switcher button { border: none; background: transparent; color: #6b7280; }
    .switcher button.active { background: #fff; color: #111827; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }

    .instructions { display: flex; justify-content: space-between; align-items: center; padding: 1rem; background: #eff6ff; border-left: 4px solid #3b82f6; border-radius: 4px; margin-bottom: 2rem; min-height: 48px; }
    .instructions p { margin: 0; color: #1e3a8a; }
    .instructions.stubs-active { flex-direction: column; align-items: stretch; gap: 1rem; }

    .stubs-layout { display: flex; flex-direction: column; width: 100%; gap: 1rem; }
    .stubs-menu-container { display: flex; flex-direction: column; gap: 1rem; background: #fff; padding: 1rem; border-radius: 6px; border: 1px solid #bfdbfe; width: 100%; box-sizing: border-box; }
    .menu-actions { display: flex; gap: 0.5rem; }
    .runs-list { display: flex; flex-wrap: wrap; gap: 0.5rem; }
    .run-item { display: flex; align-items: center; gap: 0.5rem; padding: 0.5rem 0.75rem; cursor: pointer; border-radius: 6px; border: 1px solid #e5e7eb; background: #f9fafb; transition: all 0.2s; }
    .run-item:hover { background: #f3f4f6; }
    .run-item.active { background: #e0e7ff; border-color: #818cf8; color: #3730a3; box-shadow: 0 0 0 1px #818cf8; }
    
    .badge { font-size: 0.7rem; padding: 0.15rem 0.4rem; border-radius: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; }
    .badge-home { background: #dcfce7; color: #166534; }
    .badge-daisy { background: #fef9c3; color: #854d0e; }
    
    .run-settings { display: flex; gap: 1rem; border-top: 1px solid #e5e7eb; padding-top: 0.75rem; font-size: 0.9rem; color: #374151; }
    .run-settings label { display: flex; align-items: center; gap: 0.35rem; cursor: pointer; }

    /* Custom Layout specifically for Obstruction Stage Tools */
    .obstructions-layout { display: flex; flex-direction: column; gap: 1rem; width: 100%; }
    .obstructions-layout .btn.danger { align-self: flex-start; }
    .obstruction-tools { display: flex; flex-wrap: wrap; gap: 1rem; background: #fff; padding: 0.75rem 1rem; border-radius: 6px; border: 1px solid #bfdbfe; }
    .tool-label { display: flex; align-items: center; gap: 0.35rem; cursor: pointer; font-size: 0.9rem; color: #374151; font-weight: 500; }
    .tool-label input[type="radio"] { accent-color: #3b82f6; width: 1.1rem; height: 1.1rem; }

    .canvas-container { display: flex; justify-content: center; }
</style>