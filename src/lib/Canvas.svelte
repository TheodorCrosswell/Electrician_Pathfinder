<script lang="ts">
    import { onMount } from 'svelte';
    import { get } from 'svelte/store';
    import Konva from 'konva';
    import type { KonvaEventObject } from 'konva/lib/Node';
    import { v4 as uuidv4 } from 'uuid';
    import { project } from '$lib/store';
    import { calculatePaths } from '$lib/pathfinder';
    import type { ProjectState } from '$lib/types';

    let container: HTMLDivElement;
    let stage: Konva.Stage;
    let bgLayer: Konva.Layer;
    let pathLayer: Konva.Layer;
    let mainLayer: Konva.Layer;
    let uiLayer: Konva.Layer;
    let tr: Konva.Transformer;
    
    // Internal trackers
    let rawImageNode: Konva.Image | null = null;
    let isDrawing = false;
    let drawStartPos: { x: number, y: number } | null = null;
    let previewRect: Konva.Rect | null = null;
    
    export function flatten() {
        if (rawImageNode) {
            tr.nodes([]);
            uiLayer.batchDraw();
            const dataUrl = mainLayer.toDataURL(); 
            rawImageNode.destroy();
            rawImageNode = null;
            project.update(p => ({ ...p, image: dataUrl, rawImage: null, stage: 'STUBS' }));
        }
    }

    onMount(() => {
        stage = new Konva.Stage({ container, width: 800, height: 600 });
        bgLayer = new Konva.Layer();
        pathLayer = new Konva.Layer();
        mainLayer = new Konva.Layer();
        uiLayer = new Konva.Layer();

        stage.add(bgLayer, pathLayer, mainLayer, uiLayer);

        const bgRect = new Konva.Rect({ width: 800, height: 600, fill: '#f4f4f5', name: 'bg' });
        bgLayer.add(bgRect);

        tr = new Konva.Transformer();
        uiLayer.add(tr);

        stage.on('click', handleStageClick);
        stage.on('mousedown', handleMouseDown);
        stage.on('mousemove', handleMouseMove);
        stage.on('mouseup', handleMouseUp);
        window.addEventListener('keydown', handleKeyDown);

        const unsubscribe = project.subscribe(syncStateToCanvas);

        return () => {
            unsubscribe();
            window.removeEventListener('keydown', handleKeyDown);
            stage.destroy();
        };
    });

    function syncStateToCanvas(state: ProjectState) {
        if (!stage) return;

        if (state.stage === 'SETUP' && state.rawImage && !rawImageNode) {
            const img = new window.Image();
            img.src = state.rawImage;
            img.onload = () => {
                rawImageNode = new Konva.Image({ image: img, draggable: true, name: 'rawImage' });
                mainLayer.add(rawImageNode);
                tr.nodes([rawImageNode]);
                mainLayer.batchDraw();
                uiLayer.batchDraw();
            };
        } else if (state.image && bgLayer.find('.flattened').length === 0) {
            const img = new window.Image();
            img.src = state.image;
            img.onload = () => {
                const bgNode = new Konva.Image({ image: img, name: 'flattened', x: 0, y: 0, width: 800, height: 600 });
                bgLayer.add(bgNode);
                bgNode.moveToBottom();
                bgLayer.batchDraw();
            };
        }

        const isInteractive = state.stage !== 'RESULTS';

        const existingObs = mainLayer.find('.obstruction');
        existingObs.forEach(node => {
            if (!state.obstructions.find(o => o.id === node.id())) {
                if (tr.nodes().includes(node as Konva.Node)) tr.nodes([]);
                node.destroy();
            }
        });
        
        state.obstructions.forEach(obs => {
            let node = mainLayer.findOne('#' + obs.id);
            if (!node) {
                node = new Konva.Rect({
                    id: obs.id, x: obs.x, y: obs.y, width: obs.w, height: obs.h,
                    fill: 'rgba(239, 68, 68, 0.5)', stroke: 'red', strokeWidth: 2,
                    draggable: true, name: 'obstruction'
                });
                node.on('dragend transformend', () => updateObstruction(obs.id, node as Konva.Node));
                mainLayer.add(node as Konva.Shape);
            } else {
                node.setAttrs({ x: obs.x, y: obs.y, width: obs.w, height: obs.h, draggable: isInteractive });
            }
        });

        const existingStubs = mainLayer.find('.stub');
        existingStubs.forEach(node => {
            if (!state.stubs.find(s => s.id === node.id())) {
                if (tr.nodes().includes(node as Konva.Node)) tr.nodes([]);
                node.destroy();
            }
        });
        
        state.stubs.forEach(stub => {
            let node = mainLayer.findOne('#' + stub.id);
            if (!node) {
                node = new Konva.Circle({
                    id: stub.id, x: stub.x, y: stub.y, radius: 10,
                    fill: '#3b82f6', draggable: true, name: 'stub'
                });
                node.on('dragend', () => updateStub(stub.id, node as Konva.Node));
                mainLayer.add(node as Konva.Shape);
            } else {
                node.setAttrs({ x: stub.x, y: stub.y, draggable: isInteractive });
            }
        });

        if (!isInteractive) tr.nodes([]);

        pathLayer.destroyChildren();
        if (state.stage === 'RESULTS') {
            const paths = calculatePaths(state.stubs, state.obstructions);
            paths.forEach((p) => {
                const flatPath = p.reduce((acc, val) => acc.concat(val), []);
                const line = new Konva.Line({
                    points: flatPath,
                    stroke: '#10b981',
                    strokeWidth: 4,
                    lineJoin: 'round',
                    tension: 0
                });
                pathLayer.add(line);
            });
        }

        stage.batchDraw();
    }

    function handleStageClick(e: KonvaEventObject<MouseEvent>) {
        const state = get(project);
        if (state.stage === 'RESULTS') return;

        if (e.target === stage || e.target.name() === 'bg' || e.target.name() === 'flattened') {
            tr.nodes([]); 
            
            if (state.stage === 'STUBS') {
                const pos = stage.getPointerPosition();
                if (!pos) return;
                project.update(p => ({
                    ...p,
                    stubs: [...p.stubs, { id: uuidv4(), x: pos.x, y: pos.y, type: 'stub' }]
                }));
            }
        } else {
            if (e.target.name() !== 'rawImage' && state.stage !== 'OBSTRUCTIONS' && state.stage !== 'STUBS') return;
            tr.nodes([e.target]);
        }
    }
    
    function handleMouseDown(e: KonvaEventObject<MouseEvent>) {
        const state = get(project);
        if (state.stage !== 'OBSTRUCTIONS') return;
        if (e.target !== stage && e.target.name() !== 'bg' && e.target.name() !== 'flattened') return;

        const pos = stage.getPointerPosition();
        if (!pos) return;

        isDrawing = true;
        drawStartPos = pos;
        previewRect = new Konva.Rect({
            x: drawStartPos.x, y: drawStartPos.y, width: 0, height: 0,
            fill: 'rgba(239, 68, 68, 0.3)', stroke: 'red', strokeWidth: 1, dash: [5, 5]
        });
        uiLayer.add(previewRect);
    }

    function handleMouseMove() {
        if (!isDrawing || !previewRect || !drawStartPos) return;
        const pos = stage.getPointerPosition();
        if (!pos) return;

        previewRect.width(pos.x - drawStartPos.x);
        previewRect.height(pos.y - drawStartPos.y);
        uiLayer.batchDraw();
    }

    function handleMouseUp() {
        if (!isDrawing || !previewRect) return;
        isDrawing = false;
        
        let x = previewRect.x();
        let y = previewRect.y();
        let w = previewRect.width();
        let h = previewRect.height();
        
        if (w < 0) { x += w; w = Math.abs(w); }
        if (h < 0) { y += h; h = Math.abs(h); }

        previewRect.destroy();
        previewRect = null;
        uiLayer.batchDraw();

        if (w > 5 && h > 5) {
            project.update(p => ({
                ...p,
                obstructions: [...p.obstructions, { id: uuidv4(), x, y, w, h }]
            }));
        }
    }

    function updateObstruction(id: string, node: Konva.Node) {
        project.update(p => {
            const obs = p.obstructions.find(o => o.id === id);
            if (obs) {
                obs.x = node.x();
                obs.y = node.y();
                obs.w = node.width() * node.scaleX();
                obs.h = node.height() * node.scaleY();
            }
            return p;
        });
        node.scaleX(1); node.scaleY(1);
    }

    function updateStub(id: string, node: Konva.Node) {
        project.update(p => {
            const stub = p.stubs.find(s => s.id === id);
            if (stub) { stub.x = node.x(); stub.y = node.y(); }
            return p;
        });
    }

    function handleKeyDown(e: KeyboardEvent) {
        if (e.key === 'Delete' || e.key === 'Backspace') {
            const nodes = tr.nodes();
            if (nodes.length > 0) {
                const id = nodes[0].id();
                tr.nodes([]);
                project.update(p => ({
                    ...p,
                    stubs: p.stubs.filter(s => s.id !== id),
                    obstructions: p.obstructions.filter(o => o.id !== id)
                }));
            }
        }
    }
</script>

<div class="canvas-wrapper" bind:this={container}></div>

<style>
    .canvas-wrapper {
        width: 800px;
        height: 600px;
        box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
        border: 2px solid #e5e7eb;
        border-radius: 8px;
        overflow: hidden;
        background: #fff;
    }
</style>