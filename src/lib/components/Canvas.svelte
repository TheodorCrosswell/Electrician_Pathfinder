<script lang="ts">
    import { onMount } from 'svelte';
    import { get } from 'svelte/store';
    import Konva from 'konva';
    import type { KonvaEventObject } from 'konva/lib/Node';
    import { v4 as uuidv4 } from 'uuid';
    import { project } from '$lib/store';
    import { calculatePaths } from '$lib/pathfinder';
    import type { ProjectState, Stub } from '$lib/types';

    type ExtendedObstruction = ProjectState['obstructions'][0] & {
        shapeType?: string;
        points?: number[];
    };

    export let gridResolution: number = 10;
    // Unified tool state: 'stub', 'rectangle', 'line', 'vh_line', 'freehand', 'circle', 'oval'
    export let activeTool: string = 'stub';

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
    let previewShape: Konva.Shape | null = null;
    
    export function flatten() {
        if (rawImageNode) {
            tr.nodes([]);
            uiLayer.batchDraw();
            const dataUrl = mainLayer.toDataURL({ pixelRatio: 1 });
            rawImageNode.destroy();
            rawImageNode = null;
            // Transitioning stage out of setup turns on interactive mode
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
                bgLayer.batchDraw();
            };
        }

        const isInteractive = state.stage !== 'SETUP';

        const existingObs = mainLayer.find('.obstruction');
        existingObs.forEach(node => {
            if (!state.obstructions.find(o => o.id === node.id())) {
                if (tr.nodes().includes(node as Konva.Node)) tr.nodes([]);
                node.destroy();
            }
        });
        
        state.obstructions.forEach(obs => {
            let node = mainLayer.findOne('#' + obs.id);
            const obsExt = obs as ExtendedObstruction; 
            const type = obsExt.shapeType || 'rectangle';
            const commonProps = {
                id: obs.id, draggable: isInteractive, name: 'obstruction',
                stroke: 'red', strokeWidth: 2, strokeScaleEnabled: false
            };

            if (!node) {
                if (type === 'circle' || type === 'oval') {
                    node = new Konva.Ellipse({ ...commonProps, fill: 'rgba(239, 68, 68, 0.5)', x: obs.x + obs.w/2, y: obs.y + obs.h/2, radiusX: obs.w/2, radiusY: obs.h/2 });
                } else if (type === 'line' || type === 'vh_line' || type === 'freehand') {
                    node = new Konva.Line({ ...commonProps, x: obs.x, y: obs.y, points: obsExt.points || [], strokeWidth: 4 });
                } else {
                    node = new Konva.Rect({ ...commonProps, fill: 'rgba(239, 68, 68, 0.5)', x: obs.x, y: obs.y, width: obs.w, height: obs.h });
                }
                node.on('dragend transformend', () => updateObstruction(obs.id, node as Konva.Node));
                mainLayer.add(node as Konva.Shape);
            } else {
                if (type === 'circle' || type === 'oval') {
                    node.setAttrs({ x: obs.x + obs.w/2, y: obs.y + obs.h/2, radiusX: obs.w/2, radiusY: obs.h/2, draggable: isInteractive });
                } else if (type === 'line' || type === 'vh_line' || type === 'freehand') {
                    node.setAttrs({ x: obs.x, y: obs.y, points: obsExt.points || [], draggable: isInteractive });
                } else {
                    node.setAttrs({ x: obs.x, y: obs.y, width: obs.w, height: obs.h, draggable: isInteractive });
                }
            }
        });

        mainLayer.find('.stub').forEach(n => n.destroy());

        const existingStubs = mainLayer.find('.stub-group');
        existingStubs.forEach(node => {
            if (!state.stubs.find(s => s.id === node.id())) {
                if (tr.nodes().includes(node as Konva.Node)) tr.nodes([]);
                node.destroy();
            }
        });
        
        state.stubs.forEach(stub => {
            let group = mainLayer.findOne('#' + stub.id) as Konva.Group;
            const labelText = stub.isBox ? stub.runId : `${stub.runId}-${stub.index}`;

            if (!group) {
                group = new Konva.Group({
                    id: stub.id, x: stub.x, y: stub.y,
                    draggable: isInteractive, name: 'stub-group'
                });

                if (stub.isBox) {
                    group.add(new Konva.Rect({
                        x: -12, y: -12, width: 24, height: 24, fill: '#f59e0b', name: 'shape'
                    }));
                } else {
                    group.add(new Konva.Circle({
                        radius: 10, fill: '#3b82f6', name: 'shape'
                    }));
                }

                group.add(new Konva.Text({
                    text: labelText, x: 14, y: -14,
                    fontSize: 16, fontFamily: 'sans-serif', fontWeight: 'bold', fill: '#1f2937', name: 'label'
                }));

                group.on('dragend', () => updateStub(stub.id, group));
                mainLayer.add(group);
            } else {
                group.setAttrs({ x: stub.x, y: stub.y, draggable: isInteractive });
                const textNode = group.findOne('.label') as Konva.Text;
                if (textNode) textNode.text(labelText);
            }
        });

        if (!isInteractive) tr.nodes([]);

        // Calculate paths interactively dynamically
        pathLayer.destroyChildren();
        if (state.stage !== 'SETUP') {
            const paths = calculatePaths(state.stubs, state.obstructions, gridResolution);
            paths.forEach((p) => {
                const flatPath = p.reduce((acc, val) => acc.concat(val), []);
                const line = new Konva.Line({
                    points: flatPath, stroke: '#10b981', strokeWidth: 4, lineJoin: 'round', tension: 0
                });
                pathLayer.add(line);
            });
        }

        stage.batchDraw();
    }

    function handleStageClick(e: KonvaEventObject<MouseEvent>) {
        const state = get(project);

        let target = e.target;
        let isBg = target === stage || target.name() === 'bg' || target.name() === 'flattened';

        if (isBg) {
            tr.nodes([]); 
            
            if (activeTool === 'stub' && state.stage !== 'SETUP') {
                const pos = stage.getPointerPosition();
                if (!pos) return;
                
                project.update(p => {
                    const runId = p.currentRunId || 'A';
                    const runType = p.currentRunType || 'DAISY_CHAIN';
                    const runStubs = p.stubs.filter(s => s.runId === runId);
                    
                    let isBox = false;
                    let index: number;

                    if (runType === 'HOME_RUN') {
                        if (!runStubs.some(s => s.isBox)) {
                            isBox = true;
                            index = 0;
                        } else {
                            const stubsOnly = runStubs.filter(s => !s.isBox);
                            index = stubsOnly.length > 0 ? Math.max(...stubsOnly.map(s => s.index)) + 1 : 1;
                        }
                    } else {
                        index = runStubs.length > 0 ? Math.max(...runStubs.map(s => s.index)) + 1 : 1;
                    }

                    const newStub: Stub = {
                        id: uuidv4(), x: pos.x, y: pos.y, type: 'stub',
                        runId, runType, index, isBox
                    };

                    return { ...p, stubs: [...p.stubs, newStub] };
                });
            }
        } else {
            if (state.stage === 'SETUP' && target.name() !== 'rawImage') return;
            
            let nodeToTransform: Konva.Node = target;
            if (nodeToTransform.parent && nodeToTransform.parent.name() === 'stub-group') {
                nodeToTransform = nodeToTransform.parent;
            }

            if (nodeToTransform.name() === 'rawImage' || nodeToTransform.name() === 'obstruction') {
                tr.nodes([nodeToTransform]);
                tr.enabledAnchors(['top-left', 'top-center', 'top-right', 'middle-right', 'bottom-right', 'bottom-center', 'bottom-left', 'middle-left']);
            } else if (nodeToTransform.name() === 'stub-group') {
                tr.nodes([nodeToTransform]);
                tr.enabledAnchors([]);
                
                const stubId = nodeToTransform.id();
                const clickedStub = state.stubs.find(s => s.id === stubId);
                if (clickedStub) {
                    project.update(p => ({
                        ...p,
                        currentRunId: clickedStub.runId,
                        currentRunType: clickedStub.runType
                    }));
                }
            }
        }
    }
    
    function handleMouseDown(e: KonvaEventObject<MouseEvent>) {
        const state = get(project);
        if (state.stage === 'SETUP') return;
        if (activeTool === 'stub') return;
        if (e.target !== stage && e.target.name() !== 'bg' && e.target.name() !== 'flattened') return;

        const pos = stage.getPointerPosition();
        if (!pos) return;

        isDrawing = true;
        drawStartPos = pos;

        const commonStyle = { stroke: 'red', strokeWidth: 2, fill: 'rgba(239, 68, 68, 0.3)', dash: [5, 5] };

        if (activeTool === 'rectangle') {
            previewShape = new Konva.Rect({ x: pos.x, y: pos.y, width: 0, height: 0, ...commonStyle });
        } else if (activeTool === 'circle' || activeTool === 'oval') {
            previewShape = new Konva.Ellipse({ x: pos.x, y: pos.y, radiusX: 0, radiusY: 0, ...commonStyle });
        } else {
            previewShape = new Konva.Line({ x: 0, y: 0, points: [pos.x, pos.y, pos.x, pos.y], stroke: 'red', strokeWidth: 4, dash: [5, 5] });
        }
        
        uiLayer.add(previewShape);
    }

    function handleMouseMove() {
        if (!isDrawing || !previewShape || !drawStartPos) return;
        const pos = stage.getPointerPosition();
        if (!pos) return;

        const dx = pos.x - drawStartPos.x;
        const dy = pos.y - drawStartPos.y;

        switch (activeTool) {
            case 'rectangle':
                previewShape.setAttrs({ width: dx, height: dy });
                break;
            case 'circle': {
                const r = Math.sqrt(dx * dx + dy * dy);
                previewShape.setAttrs({ radiusX: r, radiusY: r });
                break;
            }
            case 'oval':
                previewShape.setAttrs({ radiusX: Math.abs(dx), radiusY: Math.abs(dy) });
                break;
            case 'line':
                previewShape.setAttrs({ points: [drawStartPos.x, drawStartPos.y, pos.x, pos.y] });
                break;
            case 'vh_line':
                if (Math.abs(dx) > Math.abs(dy)) {
                    previewShape.setAttrs({ points: [drawStartPos.x, drawStartPos.y, pos.x, drawStartPos.y] });
                } else {
                    previewShape.setAttrs({ points: [drawStartPos.x, drawStartPos.y, drawStartPos.x, pos.y] });
                }
                break;
            case 'freehand': {
                const pts = previewShape.getAttr('points') as number[];
                previewShape.setAttrs({ points: [...pts, pos.x, pos.y] });
                break;
            }
        }

        uiLayer.batchDraw();
    }

    function handleMouseUp() {
        if (!isDrawing || !previewShape) return;
        isDrawing = false;
        
        let x = 0, y = 0, w = 0, h = 0;
        let finalPoints: number[] = [];

        if (activeTool === 'rectangle') {
            x = previewShape.x();
            y = previewShape.y();
            w = previewShape.width();
            h = previewShape.height();
            if (w < 0) { x += w; w = Math.abs(w); }
            if (h < 0) { y += h; h = Math.abs(h); }
        } else if (activeTool === 'circle' || activeTool === 'oval') {
            const rx = previewShape.getAttr('radiusX') || 0;
            const ry = previewShape.getAttr('radiusY') || 0;
            x = previewShape.x() - rx;
            y = previewShape.y() - ry;
            w = rx * 2;
            h = ry * 2;
        } else {
            const pts = previewShape.getAttr('points') as number[];
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            for(let i = 0; i < pts.length; i += 2) {
                if (pts[i] < minX) minX = pts[i];
                if (pts[i] > maxX) maxX = pts[i];
                if (pts[i+1] < minY) minY = pts[i+1];
                if (pts[i+1] > maxY) maxY = pts[i+1];
            }
            x = minX; y = minY;
            w = maxX - minX; h = maxY - minY;
            
            // Normalize points relative to top-left coordinate (x,y)
            finalPoints = pts.map((val, i) => i % 2 === 0 ? val - x : val - y);
        }

        previewShape.destroy();
        previewShape = null;
        uiLayer.batchDraw();

        // Ensure single stray accidental clicks are ignored completely
        if (w < 5 && h < 5) return; 

        // Apply a minimum bounding box threshold so flat lines have area in pathfinding matrix
        if (w < 5) w = 5;
        if (h < 5) h = 5;

        project.update(p => ({
            ...p,
            obstructions: [...p.obstructions, { id: uuidv4(), x, y, w, h, shapeType: activeTool, points: finalPoints } as unknown as ProjectState['obstructions'][0]]
        }));
    }

    function updateObstruction(id: string, node: Konva.Node) {
        project.update(p => {
            const obs = p.obstructions.find(o => o.id === id) as ExtendedObstruction | undefined;
            if (obs) {
                const scaleX = node.scaleX();
                const scaleY = node.scaleY();
                const type = obs.shapeType || 'rectangle';

                if (type === 'circle' || type === 'oval') {
                    obs.w = obs.w * scaleX;
                    obs.h = obs.h * scaleY;
                    obs.x = node.x() - obs.w / 2;
                    obs.y = node.y() - obs.h / 2;
                } else if (type === 'line' || type === 'vh_line' || type === 'freehand') {
                    obs.x = node.x();
                    obs.y = node.y();
                    obs.w = obs.w * scaleX;
                    obs.h = obs.h * scaleY;
                    obs.points = (obs.points || []).map((val: number, i: number) => i % 2 === 0 ? val * scaleX : val * scaleY);
                } else {
                    obs.x = node.x();
                    obs.y = node.y();
                    obs.w = node.width() * scaleX;
                    obs.h = node.height() * scaleY;
                }
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
    .canvas-wrapper { width: 800px; height: 600px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1); border: 2px solid #e5e7eb; border-radius: 8px; overflow: hidden; background: #fff; margin: auto; }
</style>