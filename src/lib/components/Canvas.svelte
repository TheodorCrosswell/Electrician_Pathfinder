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
    // Unified tool state: 'pan', 'stub', 'rectangle', 'line', 'vh_line', 'freehand', 'circle', 'oval'
    export let activeTool: string = 'stub';

    let container: HTMLDivElement;
    let stage: Konva.Stage;
    let bgLayer: Konva.Layer;
    let pathLayer: Konva.Layer;
    let mainLayer: Konva.Layer;
    let uiLayer: Konva.Layer;
    let tr: Konva.Transformer;
    let resizeObserver: ResizeObserver;
    
    // Internal trackers
    let rawImageNode: Konva.Image | null = null;
    let isDrawing = false;
    let drawStartPos: { x: number, y: number } | null = null;
    let previewShape: Konva.Shape | null = null;
    
    // Touch / Pan variables
    let isMultiTouch = false;
    let lastDist = 0;
    let lastCenter: { x: number, y: number } | null = null;

    // Loopable color palette
    const RUN_COLORS = [
        '#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#6366f1', '#a855f7', '#ec4899'
    ];
    
    $: if (stage) {
        stage.draggable(activeTool === 'pan');
    }

    export function flatten() {
        if (rawImageNode) {
            tr.nodes([]);
            uiLayer.batchDraw();

            const cropNode = mainLayer.findOne('.crop-rect') as Konva.Rect;

            const oldScale = stage.scaleX();
            const oldPos = stage.position();
            stage.scale({ x: 1, y: 1 });
            stage.position({ x: 0, y: 0 });
            stage.batchDraw();

            const box = cropNode ? cropNode.getClientRect() : rawImageNode.getClientRect();

            const nodeScale = rawImageNode.scaleX();
            const pixelRatio = nodeScale < 1 ? (1 / nodeScale) : 1;

            if (cropNode) cropNode.hide();

            const dataUrl = mainLayer.toDataURL({ 
                x: box.x,
                y: box.y,
                width: box.width,
                height: box.height,
                pixelRatio: pixelRatio 
            });

            stage.scale({ x: oldScale, y: oldScale });
            stage.position(oldPos);

            if (cropNode) cropNode.destroy();
            rawImageNode.destroy();
            rawImageNode = null;

            project.update(p => ({ ...p, image: dataUrl, rawImage: null, stage: 'STUBS' as ProjectState['stage'] }));
        }
    }

    onMount(() => {
        const { clientWidth, clientHeight } = container;
        stage = new Konva.Stage({ 
            container, 
            width: clientWidth || 800, 
            height: clientHeight || 600,
            draggable: activeTool === 'pan' 
        });
        
        bgLayer = new Konva.Layer();
        pathLayer = new Konva.Layer();
        mainLayer = new Konva.Layer();
        uiLayer = new Konva.Layer();

        stage.add(bgLayer, pathLayer, mainLayer, uiLayer);

        const bgRect = new Konva.Rect({ 
            width: clientWidth || 800, 
            height: clientHeight || 600, 
            fill: '#f4f4f5', 
            name: 'bg' 
        });
        bgLayer.add(bgRect);

        tr = new Konva.Transformer();
        uiLayer.add(tr);

        resizeObserver = new ResizeObserver(entries => {
            for (let entry of entries) {
                const { width, height } = entry.contentRect;
                stage.width(width);
                stage.height(height);
                
                const state = get(project);
                if ((state.stage as string) === 'SETUP') {
                    const bgNode = bgLayer.findOne('.bg') as Konva.Rect;
                    if (bgNode) {
                        bgNode.width(width);
                        bgNode.height(height);
                    }
                }
                stage.batchDraw();
            }
        });
        resizeObserver.observe(container);

        stage.on('click tap', handleStageClick);
        stage.on('mousedown touchstart', handleMouseDown);
        stage.on('mousemove touchmove', handleMouseMove);
        stage.on('mouseup touchend', handleMouseUp);
        stage.on('wheel', handleWheel);
        stage.on('touchmove', handleTouchMove);
        stage.on('touchend', handleTouchEnd);

        window.addEventListener('keydown', handleKeyDown);

        const unsubscribe = project.subscribe(syncStateToCanvas);

        return () => {
            unsubscribe();
            window.removeEventListener('keydown', handleKeyDown);
            if (resizeObserver) resizeObserver.disconnect();
            stage.destroy();
        };
    });

    function syncStateToCanvas(state: ProjectState) {
        if (!stage) return;

        if ((state.stage as string) === 'SETUP' && state.rawImage && !rawImageNode) {
            const img = new window.Image();
            img.src = state.rawImage;
            img.onload = () => {
                const padding = 40;
                const scaleX = (stage.width() - padding * 2) / img.width;
                const scaleY = (stage.height() - padding * 2) / img.height;
                let scale = Math.min(scaleX, scaleY, 1);

                const startX = (stage.width() - img.width * scale) / 2;
                const startY = (stage.height() - img.height * scale) / 2;

                rawImageNode = new Konva.Image({ 
                    image: img, 
                    draggable: false, 
                    name: 'rawImage',
                    x: startX,
                    y: startY,
                    scaleX: scale,
                    scaleY: scale
                });

                const cropRect = new Konva.Rect({
                    name: 'crop-rect',
                    x: startX,
                    y: startY,
                    width: img.width * scale,
                    height: img.height * scale,
                    stroke: '#3b82f6',
                    strokeWidth: 2,
                    dash: [6, 6],
                    draggable: true
                });

                cropRect.on('transform', () => {
                    cropRect.setAttrs({
                        width: Math.max(cropRect.width() * cropRect.scaleX(), 10),
                        height: Math.max(cropRect.height() * cropRect.scaleY(), 10),
                        scaleX: 1,
                        scaleY: 1
                    });
                });

                mainLayer.add(rawImageNode);
                mainLayer.add(cropRect);

                tr.nodes([cropRect]);
                tr.enabledAnchors(['top-left', 'top-center', 'top-right', 'middle-right', 'bottom-right', 'bottom-center', 'bottom-left', 'middle-left']);

                mainLayer.batchDraw();
                uiLayer.batchDraw();
            };
        } else if (state.image && bgLayer.find('.flattened').length === 0) {
            const img = new window.Image();
            img.src = state.image;
            img.onload = () => {
                const bgNode = new Konva.Image({ image: img, name: 'flattened', x: 0, y: 0 });
                bgLayer.add(bgNode);
                
                const bgRect = bgLayer.findOne('.bg') as Konva.Rect;
                if (bgRect) {
                    bgRect.width(img.width);
                    bgRect.height(img.height);
                    bgRect.fill('#ffffff');
                    bgRect.shadowColor('rgba(0,0,0,0.15)');
                    bgRect.shadowBlur(10);
                    bgRect.shadowOffset({ x: 0, y: 5 });
                }

                const padding = 40;
                const scaleX = (stage.width() - padding * 2) / img.width;
                const scaleY = (stage.height() - padding * 2) / img.height;
                const fitScale = Math.min(scaleX, scaleY, 1);
                
                stage.scale({ x: fitScale, y: fitScale });
                stage.position({
                    x: (stage.width() - img.width * fitScale) / 2,
                    y: (stage.height() - img.height * fitScale) / 2
                });

                bgLayer.batchDraw();
                stage.batchDraw();
            };
        }

        const isInteractive = (state.stage as string) !== 'SETUP';

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
        
        const uniqueRunIds = Array.from(new Set(state.stubs.map(s => s.runId)));

        state.stubs.forEach(stub => {
            let group = mainLayer.findOne('#' + stub.id) as Konva.Group;
            const labelText = stub.isBox ? stub.runId : `${stub.runId}-${stub.index}`;
            
            const runIndex = uniqueRunIds.indexOf(stub.runId);
            const runColor = RUN_COLORS[runIndex % RUN_COLORS.length];

            if (!group) {
                group = new Konva.Group({
                    id: stub.id, x: stub.x, y: stub.y,
                    draggable: isInteractive, name: 'stub-group'
                });

                if (stub.isBox) {
                    group.add(new Konva.Rect({
                        x: -12, y: -12, width: 24, height: 24, fill: runColor, name: 'shape'
                    }));
                } else {
                    group.add(new Konva.Circle({
                        radius: 10, fill: runColor, name: 'shape'
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
                
                const shapeNode = group.findOne('.shape') as Konva.Shape;
                if (shapeNode) shapeNode.fill(runColor);
            }
        });

        if (!isInteractive) tr.nodes([]);

        pathLayer.destroyChildren();
        if ((state.stage as string) !== 'SETUP') {
            const paths = calculatePaths(state.stubs, state.obstructions, gridResolution, state.runConfigs || {});
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

    function handleStageClick(e: KonvaEventObject<MouseEvent | TouchEvent>) {
        if (activeTool === 'pan' || isMultiTouch) return;
        const state = get(project);

        let target = e.target;
        let isBg = target === stage || target.name() === 'bg' || target.name() === 'flattened';

        if ((state.stage as string) === 'SETUP') {
            const cropNode = mainLayer.findOne('.crop-rect');
            if (cropNode) {
                tr.nodes([cropNode]);
                tr.enabledAnchors(['top-left', 'top-center', 'top-right', 'middle-right', 'bottom-right', 'bottom-center', 'bottom-left', 'middle-left']);
            }
            return;
        }

        if (isBg) {
            tr.nodes([]); 
            
            if (activeTool === 'stub' && (state.stage as string) !== 'SETUP') {
                const pos = stage.getRelativePointerPosition();
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
    
    function handleMouseDown(e: KonvaEventObject<MouseEvent | TouchEvent>) {
        if (activeTool === 'pan' || isMultiTouch) return;
        
        const evt = e.evt as TouchEvent;
        if (evt.touches && evt.touches.length > 1) return;

        const state = get(project);
        if ((state.stage as string) === 'SETUP') return;
        if (activeTool === 'stub') return;
        if (e.target !== stage && e.target.name() !== 'bg' && e.target.name() !== 'flattened') return;

        const pos = stage.getRelativePointerPosition();
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

    function handleMouseMove(e: KonvaEventObject<MouseEvent | TouchEvent>) {
        if (activeTool === 'pan' || isMultiTouch || !isDrawing || !previewShape || !drawStartPos) return;
        
        const evt = e.evt as TouchEvent;
        if (evt.touches && evt.touches.length > 1) return;

        const pos = stage.getRelativePointerPosition();
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
        if (activeTool === 'pan' || !isDrawing || !previewShape) return;
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
            
            finalPoints = pts.map((val, i) => i % 2 === 0 ? val - x : val - y);
        }

        previewShape.destroy();
        previewShape = null;
        uiLayer.batchDraw();

        if (w < 5 && h < 5) return; 
        if (w < 5) w = 5;
        if (h < 5) h = 5;

        project.update(p => ({
            ...p,
            obstructions: [...p.obstructions, { id: uuidv4(), x, y, w, h, shapeType: activeTool, points: finalPoints } as unknown as ProjectState['obstructions'][0]]
        }));
    }

    function getDistance(p1: { x: number, y: number }, p2: { x: number, y: number }) {
        return Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
    }

    function getCenter(p1: { x: number, y: number }, p2: { x: number, y: number }) {
        return { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
    }

    function handleTouchMove(e: KonvaEventObject<TouchEvent>) {
        const touch1 = e.evt.touches[0];
        const touch2 = e.evt.touches[1];

        if (touch1 && touch2) {
            e.evt.preventDefault();
            isMultiTouch = true;
            
            if (isDrawing) {
                isDrawing = false;
                if (previewShape) {
                    previewShape.destroy();
                    previewShape = null;
                    uiLayer.batchDraw();
                }
            }

            const p1 = { x: touch1.clientX, y: touch1.clientY };
            const p2 = { x: touch2.clientX, y: touch2.clientY };

            const newDist = getDistance(p1, p2);
            const newCenter = getCenter(p1, p2);

            if (!lastCenter) {
                lastCenter = newCenter;
                lastDist = newDist;
                return;
            }

            const oldScale = stage.scaleX();
            let newScale = oldScale * (newDist / lastDist);
            
            if (newScale < 0.1) newScale = 0.1;
            if (newScale > 10) newScale = 10;

            const pointTo = {
                x: (newCenter.x - stage.x()) / oldScale,
                y: (newCenter.y - stage.y()) / oldScale,
            };

            stage.scale({ x: newScale, y: newScale });

            const dx = newCenter.x - lastCenter.x;
            const dy = newCenter.y - lastCenter.y;

            const newPos = {
                x: newCenter.x - pointTo.x * newScale + dx,
                y: newCenter.y - pointTo.y * newScale + dy,
            };

            stage.position(newPos);
            stage.batchDraw();

            lastDist = newDist;
            lastCenter = newCenter;
        }
    }

    function handleTouchEnd() {
        lastDist = 0;
        lastCenter = null;
        setTimeout(() => { isMultiTouch = false; }, 50);
    }

    function handleWheel(e: KonvaEventObject<WheelEvent>) {
        e.evt.preventDefault();
        const scaleBy = 1.1;
        const oldScale = stage.scaleX();
        const pointer = stage.getPointerPosition(); 
        if (!pointer) return;

        const mousePointTo = {
            x: (pointer.x - stage.x()) / oldScale,
            y: (pointer.y - stage.y()) / oldScale,
        };

        let newScale = e.evt.deltaY < 0 ? oldScale * scaleBy : oldScale / scaleBy;
        
        if (newScale < 0.1) newScale = 0.1;
        if (newScale > 10) newScale = 10;

        stage.scale({ x: newScale, y: newScale });

        const newPos = {
            x: pointer.x - mousePointTo.x * newScale,
            y: pointer.y - mousePointTo.y * newScale,
        };
        
        stage.position(newPos);
        stage.batchDraw();
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
                const node = nodes[0];
                
                if (node.name() === 'crop-rect' || node.name() === 'rawImage') return;

                const id = node.id();
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

<div bind:this={container} class="w-full h-full"></div>