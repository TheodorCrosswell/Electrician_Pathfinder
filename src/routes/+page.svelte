<script lang="ts">
    import { onMount, onDestroy } from 'svelte';
    import { v4 as uuidv4 } from 'uuid';
    import { project } from '$lib/store';
    import Canvas from '$lib/components/Canvas.svelte';
    import type { RunType, Stub, RunConfig, ProjectState } from '$lib/types';
    import { fly } from 'svelte/transition';
    import { db, type ProjectRecord } from '$lib/db';
    
    // -- Project Management State --
    let currentProjectId: string | null = null;
    let savedProjects: ProjectRecord[] = [];
    let saveTimeout: ReturnType<typeof setTimeout>;

    onDestroy(() => {
        clearTimeout(saveTimeout);
    });

    // -- Editor State --
    let canvasRef: Canvas;
    let activeTool = 'stub';
    let openMenu: 'runs' | 'obstacles' | 'settings' | null = null;

    onMount(() => {
        loadProjects();
    });

    async function loadProjects() {
        savedProjects = await db.projects.orderBy('updatedAt').reverse().toArray();
    }

    async function createNewProject() {
        const name = prompt("Enter project name:") || "Untitled Project";
        const newId = uuidv4();
        
        // Setup initial default empty state
        const initialState: ProjectState = {
            stage: 'SETUP',
            
            rawImage: null,
            image: null,
            stubs: [],
            obstructions: [],
            gridResolution: 10,
            currentRunId: 'A',
            currentRunType: 'DAISY_CHAIN',
            runConfigs: {}
        };
        
        await db.projects.put({
            id: newId,
            name,
            updatedAt: Date.now(),
            state: initialState
        });
        
        await loadProjects();
        openProject(newId, initialState);
    }

    function openProject(id: string, state: ProjectState) {
        project.set(state);
        currentProjectId = id;
    }

    async function deleteProject(id: string) {
        if (confirm("Are you sure you want to delete this project?")) {
            await db.projects.delete(id);
            await loadProjects();
        }
    }

    function closeProject() {
        currentProjectId = null;
        loadProjects();
    }

    function triggerAutoSave(id: string, state: ProjectState) {
        clearTimeout(saveTimeout);
        saveTimeout = setTimeout(() => {
            db.projects.update(id, {
                updatedAt: Date.now(),
                state: state
            }).then(() => {
                // Silently refresh list for correct last edited time when we return
                db.projects.orderBy('updatedAt').reverse().toArray().then(res => savedProjects = res);
            });
        }, 1000);
    }

    // Auto-save logic: Debounced save when $project changes
    $: if (currentProjectId && $project) {
        triggerAutoSave(currentProjectId, $project);
    }

    // -- Existing Logic --
    $: if ($project && $project.currentRunId === undefined) {
        project.update(p => ({ ...p, currentRunId: 'A', currentRunType: 'DAISY_CHAIN' }));
    }

    $: runsList = $project ? getRunsList($project.stubs, $project.currentRunId, $project.currentRunType, $project.runConfigs) : [];
    
    function getRunsList(stubs: Stub[], currentId: string | undefined, currentType: RunType | undefined, runConfigs: Record<string, RunConfig> | undefined) {
        const runsMap: Record<string, { type: RunType; count: number }> = {};
        const configs = runConfigs || {};
        
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
                let displayCount = data.count;
                if (data.type === 'HOME_RUN' && displayCount > 0) {
                    displayCount -= 1;
                }
                return { 
                    id, 
                    type: data.type, 
                    count: displayCount, 
                    maxOverlap: configs[id]?.maxOverlap ?? 3 
                };
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
            const nextRunsList = getRunsList(remainingStubs, undefined, undefined, p.runConfigs).filter(r => r.id !== runId);
            
            const nextCurrentId = nextRunsList.length > 0 ? nextRunsList[0].id : 'A';
            const nextCurrentType = nextRunsList.length > 0 ? nextRunsList[0].type : 'DAISY_CHAIN';

            const newRunConfigs = { ...(p.runConfigs || {}) };
            delete newRunConfigs[runId];

            return {
                ...p,
                stubs: remainingStubs,
                currentRunId: nextCurrentId,
                currentRunType: nextCurrentType,
                runConfigs: newRunConfigs
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

    function setRunMaxOverlap(runId: string, maxOverlap: number) {
        project.update(p => {
            const runConfigs = p.runConfigs || {};
            return {
                ...p,
                runConfigs: {
                    ...runConfigs,
                    [runId]: { ...(runConfigs[runId] || {}), maxOverlap }
                }
            };
        });
    }

    function toggleMenu(menu: 'runs' | 'obstacles' | 'settings') {
        openMenu = openMenu === menu ? null : menu;
    }

    const resolutions = [
        { label: "Very Low (20)", value: 20 },
        { label: "Low (10)", value: 10 },
        { label: "High (5)", value: 5 },
        { label: "Ultra (2)", value: 2 }
    ];

    const maxOverlapOptions = Array.from({ length: 20 }, (_, i) => i + 1);

</script>

{#if !currentProjectId}
    <!-- ========================== -->
    <!--     PROJECT MANAGER UI     -->
    <!-- ========================== -->
    <div class="project-manager">
        <div class="manager-header">
            <h1>WirePath Projects</h1>
            <button class="btn primary new-btn" on:click={createNewProject}>+ New Project</button>
        </div>
        
        <div class="project-grid">
            {#each savedProjects as p (p.id)}
                <div class="project-card">
                    <div class="card-info">
                        <h3>{p.name}</h3>
                        <p>Last edited: {new Date(p.updatedAt).toLocaleString()}</p>
                        <span class="badge">
                            {p.state.stubs?.length || 0} Stubs • {p.state.stage === 'SETUP' ? 'Setup' : 'Ready'}
                        </span>
                    </div>
                    <div class="card-actions">
                        <button class="btn main-action" on:click={() => openProject(p.id, p.state)}>Open</button>
                        <button class="btn danger" on:click={() => deleteProject(p.id)}>Delete</button>
                    </div>
                </div>
            {/each}
            
            {#if savedProjects.length === 0}
                <div class="empty-state">
                    <span style="font-size: 2rem;">📂</span>
                    <p>No projects found. Create one to get started!</p>
                </div>
            {/if}
        </div>
    </div>
{:else}
    <!-- ========================== -->
    <!--        APP LAYOUT UI       -->
    <!-- ========================== -->
    <div class="app-layout">
        <main class="canvas-area">
            <Canvas 
                bind:this={canvasRef} 
                {activeTool} 
                gridResolution={$project.gridResolution || 10} 
            />
        </main>

        <div class="floating-toolbar">
            {#if $project.stage === 'SETUP'}
                <div class="setup-panel">
                    <span class="title setup-title">Setup Floorplan:</span>
                    {#if $project.rawImage}
                        <span class="instruction-text">
                            Drag and resize the blue box to crop. <br/>Use the 🖐️ Pan tool to scroll.
                        </span>
                    {/if}
                    <button class="btn main-btn text-md" on:click={loadTestImage}>Use Test Image</button>
                    <label class="btn main-btn file-btn text-md">
                        Upload Floorplan
                        <input type="file" accept="image/*" on:change={handleFileUpload} hidden />
                    </label>
                    <div class="divider-horizontal"></div>
                    <button class="btn main-btn primary text-md" disabled={!$project.rawImage} on:click={() => canvasRef.flatten()}>
                        Crop & Lock Image
                    </button>
                </div>
            {:else}
                <div class="menu-container">
                    {#if openMenu === 'settings'}
                        <div class="flyout" transition:fly={{ x: 20, duration: 200 }}>
                            <span class="title">Settings:</span>
                            <select 
                                class="select-sm" 
                                title="Grid Resolution" 
                                value={$project.gridResolution || 10} 
                                on:change={(e) => project.update(p => ({ ...p, gridResolution: Number((e.currentTarget).value) }))}
                            >
                                {#each resolutions as res (res.value)}
                                    <option value={res.value}>{res.label}</option>
                                {/each}
                            </select>
                        </div>
                    {/if}
                    <button class="btn main-btn" class:active={openMenu === 'settings'} on:click={() => toggleMenu('settings')}>
                        ⚙️
                    </button>
                </div>

                <div class="menu-container">
                    {#if openMenu === 'obstacles'}
                        <div class="flyout" transition:fly={{ x: 20, duration: 200 }}>
                            <span class="title">Obstacles:</span>
                            <button class="btn tool-btn" class:active={activeTool === 'rectangle'} on:click={() => activeTool = 'rectangle'}>Rectangle</button>
                            <button class="btn tool-btn" class:active={activeTool === 'vh_line'} on:click={() => activeTool = 'vh_line'}>Straight H/V Line</button>
                            <button class="btn tool-btn" class:active={activeTool === 'line'} on:click={() => activeTool = 'line'}>Straight Line</button>
                            <button class="btn tool-btn" class:active={activeTool === 'freehand'} on:click={() => activeTool = 'freehand'}>Freehand</button>
                            <button class="btn tool-btn" class:active={activeTool === 'circle'} on:click={() => activeTool = 'circle'}>Circle</button>
                            <button class="btn tool-btn" class:active={activeTool === 'oval'} on:click={() => activeTool = 'oval'}>Oval</button>
                        </div>
                    {/if}
                    <button class="btn main-btn" class:active={openMenu === 'obstacles' || ['rectangle', 'vh_line', 'line', 'freehand', 'circle', 'oval'].includes(activeTool)} on:click={() => toggleMenu('obstacles')}>
                        🚧 
                    </button>
                </div>

                <div class="menu-container">
                    {#if openMenu === 'runs'}
                        <div class="flyout" transition:fly={{ x: 20, duration: 200 }}>
                            <span class="title">Runs:</span>
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

                            <div class="divider-horizontal"></div>

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

                            <div class="divider-horizontal"></div>
                            
                            <label class="title" style="margin-bottom:0;">
                                <select 
                                    class="select-sm" 
                                    title="Maximum overlapping path lines allowed for this run" 
                                    value={runsList.find(r => r.id === $project.currentRunId)?.maxOverlap ?? 3} 
                                    on:change={(e) => setRunMaxOverlap($project.currentRunId || 'A', Number((e.currentTarget).value))}
                                >
                                    {#each maxOverlapOptions as num (num)}
                                        <option value={num}>{num}</option>
                                    {/each}
                                </select>
                                Max Overlap:
                            </label>

                            <div class="divider-horizontal"></div>

                            <button class="btn text-sm danger" on:click={() => deleteRun($project.currentRunId || 'A')}>Delete Run</button>
                        </div>
                    {/if}
                    <button class="btn main-btn" class:active={openMenu === 'runs'} on:click={() => toggleMenu('runs')}>
                        📋
                    </button>
                </div>

                <button class="btn main-btn tool-btn" class:active={activeTool === 'stub'} on:click={() => { activeTool = 'stub'; openMenu = null; }}>
                    📍
                </button>

                <button class="btn main-btn tool-btn" class:active={activeTool === 'pan'} on:click={() => { activeTool = 'pan'; openMenu = null; }}>
                    🖐️
                </button>
            {/if}
            
            <!-- Home/Exit button -->
            <button class="btn main-btn tool-btn" title="Back to Projects (Saves automatically)" on:click={closeProject}>
                🏠
            </button>
        </div>
    </div>
{/if}

<style>
    :global(body, html) { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; font-family: system-ui, -apple-system, sans-serif; background-color: #f3f4f6; color: #111827; }
    
    /* === PROJECT MANAGER STYLES === */
    .project-manager {
        width: 100vw;
        height: 100vh;
        overflow-y: auto;
        padding: 2.5rem 5vw;
        box-sizing: border-box;
    }
    .manager-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 2.5rem;
        border-bottom: 2px solid #e5e7eb;
        padding-bottom: 1rem;
    }
    .manager-header h1 {
        margin: 0;
        font-size: 1.8rem;
        color: #1f2937;
    }
    .new-btn { font-size: 1rem; padding: 0.6rem 1.2rem; }
    
    .project-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
        gap: 1.5rem;
    }
    .project-card {
        background: #ffffff;
        border-radius: 12px;
        padding: 1.5rem;
        border: 1px solid #e5e7eb;
        box-shadow: 0 4px 6px rgba(0,0,0,0.02);
        display: flex;
        flex-direction: column;
        gap: 1.5rem;
        transition: transform 0.2s, box-shadow 0.2s;
    }
    .project-card:hover {
        transform: translateY(-2px);
        box-shadow: 0 8px 12px rgba(0,0,0,0.05);
    }
    .card-info h3 { margin: 0 0 0.5rem 0; font-size: 1.25rem; }
    .card-info p { margin: 0 0 0.75rem 0; font-size: 0.85rem; color: #6b7280; }
    .badge {
        display: inline-block;
        font-size: 0.75rem;
        background: #f3f4f6;
        color: #4b5563;
        padding: 0.2rem 0.6rem;
        border-radius: 12px;
        font-weight: 500;
    }
    .card-actions { display: flex; gap: 0.5rem; }
    .card-actions .btn { flex: 1; }
    .main-action { background: #eff6ff; color: #2563eb; border-color: #bfdbfe; }
    .main-action:hover { background: #dbeafe !important; }
    
    .empty-state {
        grid-column: 1 / -1;
        text-align: center;
        padding: 4rem 1rem;
        background: #fff;
        border-radius: 12px;
        border: 2px dashed #d1d5db;
        color: #6b7280;
    }

    /* === EXISTING CANVAS/APP STYLES === */
    .app-layout {
        position: relative;
        width: 100vw;
        height: 100vh;
        overflow: hidden;
        background-color: #f3f4f6;
    }

    .canvas-area {
        position: absolute;
        inset: 0;
        background-color: #e5e7eb;
        display: flex;
        justify-content: center;
        align-items: center;
        overflow: hidden;
        padding: 0;
        z-index: 10;
    }

    .floating-toolbar {
        position: absolute;
        bottom: 24px;
        right: 24px;
        display: flex;
        flex-direction: column-reverse; 
        gap: 12px;
        z-index: 50;
    }

    .setup-panel {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
        background: #ffffff;
        padding: 1.25rem;
        border-radius: 12px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        border: 1px solid #d1d5db;
        max-width: 250px;
    }
    .setup-title { margin-bottom: 0.25rem; font-size: 1rem; }
    .instruction-text { font-size: 0.8rem; color: #4b5563; margin-top: -0.5rem; margin-bottom: 0.25rem; line-height: 1.3; }

    .menu-container {
        position: relative;
        display: flex;
        align-items: center;
        justify-content: flex-end;
    }

    .flyout {
        position: absolute;
        right: calc(100% + 16px);
        bottom: 0; 
        background: #ffffff;
        border: 1px solid #d1d5db;
        border-radius: 8px;
        padding: 0.75rem;
        display: flex;
        flex-direction: column; 
        align-items: stretch;
        gap: 0.5rem;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
        min-width: 180px;
        max-height: 80vh; 
        overflow-y: auto; 
    }

    .title { font-weight: 600; color: #374151; font-size: 0.9rem; margin-bottom: 0.25rem; }
    .divider-horizontal { width: 100%; height: 1px; background: #d1d5db; margin: 0.25rem 0; }

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

    .main-btn {
        width: 44px;
        height: 44px;
        justify-content: center;
        padding: 0;
        font-size: 1.25rem;
        border-radius: 8px;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
    }
    .setup-panel .main-btn {
        width: auto;
        height: auto;
        padding: 0.85rem 1rem;
        font-size: 0.95rem;
    }
    .main-btn.active {
        background: #e0e7ff;
        color: #3730a3;
        border-color: #818cf8;
        box-shadow: 0 0 0 1px #818cf8, 0 2px 4px rgba(0, 0, 0, 0.05);
    }
    
    .text-md { font-size: 0.95rem !important; }

    .primary { background: #2563eb; color: white; border: none; }
    .primary:hover:not(:disabled) { background: #1d4ed8; }

    .danger { background: #fee2e2; color: #dc2626; border: 1px solid #fca5a5; }
    .danger:hover:not(:disabled) { background: #fecaca; }

    .text-sm { font-size: 0.75rem; padding: 0.35rem 0.6rem; }
    .file-btn { margin: 0; cursor: pointer; display: flex; text-align: center; justify-content: center; }

    .tool-btn { color: #4b5563; }
    .tool-btn.active { background: #e0e7ff; color: #3730a3; border-color: #818cf8; box-shadow: 0 0 0 1px #818cf8; }

    .select-sm { 
        padding: 0.45rem; 
        border-radius: 6px; 
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
        flex-direction: column; 
        gap: 0.5rem;
        font-size: 0.8rem;
        color: #374151;
        margin: 0 0.25rem;
        font-weight: 500;
    }
    .radio-group label { display: flex; align-items: center; gap: 0.4rem; cursor: pointer; margin: 0; }
</style>