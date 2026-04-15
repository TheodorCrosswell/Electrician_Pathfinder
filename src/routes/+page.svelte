<script lang="ts">
    import { project } from '$lib/store';
    import Canvas from '$lib/components/Canvas.svelte';
    import type { StageType, RunType, Stub } from '$lib/types';
    
    let canvasRef: Canvas;
    let obstructionTool = 'rectangle';
    let isSidebarOpen = true; // State to control sidebar visibility

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
        reader.onload = (e: ProgressEvent<FileReader>) => {
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

<div class="app-layout">
    <!-- Left Side: Canvas Area -->
    <main class="canvas-area">
        <button class="sidebar-toggle" class:open={isSidebarOpen} on:click={() => isSidebarOpen = !isSidebarOpen}>
            {isSidebarOpen ? '❯' : '❮ Menu'}
        </button>

        <div class="canvas-wrapper">
            <Canvas bind:this={canvasRef} {obstructionTool} gridResolution={$project.gridResolution || 10} />
        </div>
    </main>

    <!-- Right Side: Sidebar Menu -->
    <aside class="sidebar" class:hidden={!isSidebarOpen}>
        <header class="sidebar-header">
            <h1>Conduit Planner</h1>
        </header>

        <div class="sidebar-content">
            <!-- Global Settings & Stage Switcher -->
            <div class="panel">
                {#if $project.stage !== 'SETUP'}
                    <div class="res-menu">
                        <label for="resolution">Grid Resolution:</label>
                        <select id="resolution" class="select-sm" 
                            value={$project.gridResolution || 10} 
                            on:change={(e) => project.update(p => ({ ...p, gridResolution: Number((e.currentTarget).value) }))}>
                            <option value={20}>Low (20px)</option>
                            <option value={10}>Normal (10px)</option>
                            <option value={5}>High (5px)</option>
                        </select>
                    </div>
                {/if}

                {#if $project.stage !== 'SETUP'}
                    <div class="switcher">
                        <button class:active={$project.stage === 'STUBS'} on:click={() => setStage('STUBS')}>1. Mark Stubs</button>
                        <button class:active={$project.stage === 'OBSTRUCTIONS'} on:click={() => setStage('OBSTRUCTIONS')}>2. Mark Obstacles</button>
                    </div>
                {/if}
            </div>

            <!-- Stage Specific Content -->
            <div class="panel stage-panel">
                {#if $project.stage === 'SETUP'}
                    <h2>Setup</h2>
                    <p class="instruction-text">Upload an image, drag/resize it to fit, then click "Flatten & Lock".</p>
                    
                    <div class="action-stack">
                        <button class="btn" on:click={loadTestImage}>Use Test Image</button>
                        <label class="btn file-btn">
                            Upload Floorplan
                            <input type="file" accept="image/*" on:change={handleFileUpload} hidden />
                        </label>
                        <button class="btn primary" disabled={!$project.rawImage} on:click={() => canvasRef.flatten()}>
                            Flatten & Lock Image
                        </button>
                    </div>

                {:else if $project.stage === 'STUBS'}
                    <h2>Stubs</h2>
                    <p class="instruction-text"><strong>Click</strong> canvas to place stubs. <strong>Drag</strong> to reposition. Select and press <strong>Delete</strong> to remove.</p>
                    
                    <div class="stubs-menu">
                        <div class="menu-actions">
                            <button class="btn btn-sm primary" on:click={handleNewRun}>+ New Run</button>
                            <button class="btn btn-sm danger" on:click={() => deleteRun($project.currentRunId || 'A')}>Delete</button>
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
                                        {run.type === 'HOME_RUN' ? 'HR' : 'DC'}
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

                {:else if $project.stage === 'OBSTRUCTIONS'}
                    <h2>Obstructions</h2>
                    <p class="instruction-text"><strong>Draw Block-Out Zones</strong>. Select tool below. <strong>Click obstacles</strong> to edit, or press <strong>Delete</strong> to remove.</p>
                    
                    <div class="obstruction-tools">
                        <label class="tool-label"><input type="radio" bind:group={obstructionTool} value="rectangle" /> Rectangle</label>
                        <label class="tool-label"><input type="radio" bind:group={obstructionTool} value="vh_line" /> Straight H/V Line</label>
                        <label class="tool-label"><input type="radio" bind:group={obstructionTool} value="line" /> Straight Line</label>
                        <label class="tool-label"><input type="radio" bind:group={obstructionTool} value="freehand" /> Freehand</label>
                        <label class="tool-label"><input type="radio" bind:group={obstructionTool} value="circle" /> Circle</label>
                        <label class="tool-label"><input type="radio" bind:group={obstructionTool} value="oval" /> Oval</label>
                    </div>

                    <div class="action-stack" style="margin-top: 1rem;">
                        <button class="btn danger" disabled={$project.obstructions.length === 0} on:click={() => project.update(p => ({...p, obstructions: []}))}>
                            Clear All Obstructions
                        </button>
                    </div>
                {/if}
            </div>
        </div>
    </aside>
</div>

<style>
    /* Global Reset overrides to allow full screen Layout */
    :global(body, html) { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; font-family: system-ui, -apple-system, sans-serif; background-color: #111827; color: #111827; }
    
    .app-layout {
        display: flex;
        width: 100vw;
        height: 100vh;
        overflow: hidden;
    }

    /* --- Left: Canvas Area --- */
    .canvas-area {
        flex: 1;
        position: relative;
        background-color: #f3f4f6; /* slightly darker to make canvas pop */
        display: flex;
        justify-content: center;
        align-items: center;
        overflow: auto;
    }

    .canvas-wrapper {
        box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
        background: white;
    }

    .sidebar-toggle {
        position: absolute;
        top: 1rem;
        right: 1rem;
        z-index: 50;
        background: #2563eb;
        color: white;
        border: none;
        padding: 0.5rem 0.75rem;
        border-radius: 6px;
        font-weight: bold;
        cursor: pointer;
        box-shadow: 0 2px 5px rgba(0,0,0,0.2);
        transition: background 0.2s, right 0.3s;
    }

    .sidebar-toggle:hover {
        background: #1d4ed8;
    }

    /* When sidebar is open, slide button left slightly (Desktop mostly) */
    .sidebar-toggle.open {
        background: #4b5563;
    }

    /* --- Right: Sidebar Menu --- */
    .sidebar {
        width: 350px;
        flex-shrink: 0;
        background: #ffffff;
        border-left: 1px solid #d1d5db;
        display: flex;
        flex-direction: column;
        transition: transform 0.3s ease, margin-right 0.3s ease;
        box-shadow: -4px 0 15px rgba(0,0,0,0.05);
        z-index: 40;
    }

    .sidebar.hidden {
        transform: translateX(100%);
        margin-right: -350px; /* Removes sidebar from flex flow so canvas expands */
    }

    .sidebar-header {
        padding: 1.25rem 1.5rem;
        border-bottom: 1px solid #e5e7eb;
        background: #f9fafb;
    }

    .sidebar-header h1 {
        margin: 0;
        font-size: 1.25rem;
        color: #1f2937;
    }

    .sidebar-content {
        flex: 1;
        overflow-y: auto;
        padding: 1.5rem;
        display: flex;
        flex-direction: column;
        gap: 1.5rem;
    }

    .panel {
        display: flex;
        flex-direction: column;
        gap: 1rem;
    }

    .panel h2 {
        margin: 0;
        font-size: 1.1rem;
        color: #111827;
        border-bottom: 2px solid #e5e7eb;
        padding-bottom: 0.5rem;
    }

    .instruction-text {
        margin: 0;
        font-size: 0.9rem;
        color: #4b5563;
        line-height: 1.4;
    }

    /* --- Controls & Utilities --- */
    .res-menu { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.85rem; color: #4b5563; font-weight: 500; }
    .select-sm { padding: 0.4rem; border-radius: 4px; border: 1px solid #d1d5db; background: #fff; font-size: 0.9rem; cursor: pointer; outline: none; }
    .select-sm:focus { border-color: #3b82f6; box-shadow: 0 0 0 1px #3b82f6; }

    .action-stack { display: flex; flex-direction: column; gap: 0.75rem; }
    .btn { padding: 0.6rem 1rem; border: 1px solid #d1d5db; background: #fff; border-radius: 6px; cursor: pointer; font-weight: 500; transition: all 0.2s; text-align: center; }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn:hover:not(:disabled) { background: #f3f4f6; }
    .primary { background: #2563eb; color: white; border: none; }
    .primary:hover:not(:disabled) { background: #1d4ed8; }
    .danger { background: #fee2e2; color: #dc2626; border: 1px solid #fca5a5; }
    .danger:hover:not(:disabled) { background: #fecaca; }
    .btn-sm { padding: 0.4rem 0.6rem; font-size: 0.875rem; flex: 1; }
    .file-btn { display: inline-block; cursor: pointer; }

    .switcher { display: flex; flex-direction: column; background: #f3f4f6; border-radius: 8px; padding: 4px; gap: 4px; }
    .switcher button { padding: 0.6rem; border: none; background: transparent; color: #6b7280; border-radius: 6px; cursor: pointer; font-weight: 500; transition: 0.2s; }
    .switcher button.active { background: #fff; color: #111827; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .switcher button:hover:not(.active) { background: #e5e7eb; }

    .stubs-menu { display: flex; flex-direction: column; gap: 1rem; background: #f9fafb; padding: 1rem; border-radius: 6px; border: 1px solid #e5e7eb; }
    .menu-actions { display: flex; gap: 0.5rem; }
    
    .runs-list { display: flex; flex-wrap: wrap; gap: 0.5rem; }
    .run-item { display: flex; align-items: center; justify-content: space-between; width: 100%; padding: 0.5rem 0.75rem; cursor: pointer; border-radius: 6px; border: 1px solid #d1d5db; background: #fff; transition: all 0.2s; box-sizing: border-box; }
    .run-item:hover { background: #f3f4f6; }
    .run-item.active { background: #e0e7ff; border-color: #818cf8; color: #3730a3; box-shadow: 0 0 0 1px #818cf8; }
    
    .badge { font-size: 0.65rem; padding: 0.15rem 0.4rem; border-radius: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; }
    .badge-home { background: #dcfce7; color: #166534; }
    .badge-daisy { background: #fef9c3; color: #854d0e; }
    
    .run-settings { display: flex; flex-direction: column; gap: 0.5rem; border-top: 1px solid #d1d5db; padding-top: 0.75rem; font-size: 0.9rem; color: #374151; }
    .run-settings label { display: flex; align-items: center; gap: 0.35rem; cursor: pointer; }

    .obstruction-tools { display: flex; flex-direction: column; gap: 0.75rem; background: #f9fafb; padding: 1rem; border-radius: 6px; border: 1px solid #e5e7eb; }
    .tool-label { display: flex; align-items: center; gap: 0.5rem; cursor: pointer; font-size: 0.9rem; color: #374151; font-weight: 500; }
    .tool-label input[type="radio"] { accent-color: #3b82f6; width: 1.1rem; height: 1.1rem; cursor: pointer; }

    /* Mobile Responsive Mode */
    @media (max-width: 768px) {
        .sidebar {
            position: fixed;
            top: 0;
            right: 0;
            height: 100vh;
            max-width: 85vw;
            margin-right: 0; /* Override desktop removal offset */
        }
        
        .sidebar.hidden {
            transform: translateX(100%);
            margin-right: 0;
        }

        .sidebar-toggle {
            right: 1rem;
            top: 1rem;
        }

        /* Adjust button to stay visible slightly offset when sidebar is open */
        .sidebar-toggle.open {
            right: calc(85vw + 1rem); 
        }
    }
</style>