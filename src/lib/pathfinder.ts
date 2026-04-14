// src/lib/pathfinder.ts
import * as PF from 'pathfinding';
import type { Stub, Obstruction } from './types';

const CELL_SIZE = 10;
const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 600;

export function calculatePaths(stubs: Stub[], obstructions: Obstruction[]): number[][][] {
    if (stubs.length < 2) return [];

    const cols = Math.ceil(CANVAS_WIDTH / CELL_SIZE);
    const rows = Math.ceil(CANVAS_HEIGHT / CELL_SIZE);
    const grid = new PF.Grid(cols, rows);

    obstructions.forEach(obs => {
        const startX = Math.max(0, Math.floor(obs.x / CELL_SIZE));
        const startY = Math.max(0, Math.floor(obs.y / CELL_SIZE));
        const endX = Math.min(cols - 1, Math.ceil((obs.x + obs.w) / CELL_SIZE));
        const endY = Math.min(rows - 1, Math.ceil((obs.y + obs.h) / CELL_SIZE));

        for (let y = startY; y <= endY; y++) {
            for (let x = startX; x <= endX; x++) {
                grid.setWalkableAt(x, y, false);
            }
        }
    });

    // We allow diagonals so it CAN squeeze through if forced to, 
    // but our smoother will turn them into 90-degree lines whenever possible.
    const finder = new PF.AStarFinder({
        allowDiagonal: true,
        dontCrossCorners: true
    });

    const paths: number[][][] = [];

    // Group stubs by their run ID
    const runs = stubs.reduce((acc, stub) => {
        if (!acc[stub.runId]) acc[stub.runId] = [];
        acc[stub.runId].push(stub);
        return acc;
    }, {} as Record<string, Stub[]>);

    for (const runId in runs) {
        const runStubs = runs[runId];
        if (runStubs.length < 2) continue;

        const runType = runStubs[0].runType;

        if (runType === 'DAISY_CHAIN') {
            runStubs.sort((a, b) => a.index - b.index);
            for (let i = 0; i < runStubs.length - 1; i++) {
                route(runStubs[i], runStubs[i + 1]);
            }
        } else if (runType === 'HOME_RUN') {
            const box = runStubs.find(s => s.isBox);
            if (!box) continue; // Run requires a Box component
            for (const stub of runStubs) {
                if (stub === box) continue;
                route(stub, box);
            }
        }
    }

    function route(start: Stub, end: Stub) {
        const sx = Math.max(0, Math.min(cols - 1, Math.floor(start.x / CELL_SIZE)));
        const sy = Math.max(0, Math.min(rows - 1, Math.floor(start.y / CELL_SIZE)));
        const ex = Math.max(0, Math.min(cols - 1, Math.floor(end.x / CELL_SIZE)));
        const ey = Math.max(0, Math.min(rows - 1, Math.floor(end.y / CELL_SIZE)));

        grid.setWalkableAt(sx, sy, true);
        grid.setWalkableAt(ex, ey, true);

        const gridBackup = grid.clone(); 
        
        const rawPath = finder.findPath(sx, sy, ex, ey, gridBackup);
        
        if (rawPath.length > 0) {
            // Force the path to make strict L-shapes where space allows
            const smoothedPath = smoothPath(rawPath, gridBackup);
            
            const canvasPath = smoothedPath.map(p => [
                p[0] * CELL_SIZE + (CELL_SIZE / 2),
                p[1] * CELL_SIZE + (CELL_SIZE / 2)
            ]);
            paths.push(canvasPath);

            // Re-expand the smoothed corners back into step-by-step points so we can block them
            const fullPath = expandPath(smoothedPath);

            // Block out all uncompressed path segments except the exact start/end nodes
            // to support home-runs where multiple endpoints must converge.
            fullPath.forEach(p => {
                if ((p[0] === sx && p[1] === sy) || (p[0] === ex && p[1] === ey)) {
                    // Do nothing (Keep walkable)
                } else {
                    grid.setWalkableAt(p[0], p[1], false);
                }
            });
        }
    }

    return paths;
}


// --- Helper Functions ---

/**
 * Sweeps through an A* path and enforces 90-degree corners whenever possible, 
 * vastly reducing bends and stripping away unnecessary zigzag/diagonal movement.
 */
function smoothPath(path: number[][], grid: PF.Grid): number[][] {
    if (path.length <= 2) return path;

    const smoothed: number[][] = [path[0]];
    let currentIndex = 0;

    while (currentIndex < path.length - 1) {
        let nextIndex = currentIndex + 1;
        let bestLPath: number[][] | null = null;

        // Look as far ahead as possible to find points that can be connected with a clean L-shape.
        for (let i = path.length - 1; i > currentIndex; i--) {
            const p1 = path[currentIndex];
            const p2 = path[i];

            if (p1[0] === p2[0] && p1[1] === p2[1]) continue;

            // Try Horizontal -> Vertical L-shape
            const corner1 = [p2[0], p1[1]];
            if (isClearPath(p1, corner1, grid) && isClearPath(corner1, p2, grid)) {
                bestLPath = [ corner1, p2 ];
                nextIndex = i;
                break;
            }
            
            // Try Vertical -> Horizontal L-shape
            const corner2 = [p1[0], p2[1]];
            if (isClearPath(p1, corner2, grid) && isClearPath(corner2, p2, grid)) {
                bestLPath = [ corner2, p2 ];
                nextIndex = i;
                break;
            }
        }

        if (bestLPath) {
            const corner = bestLPath[0];
            const end = bestLPath[1];
            
            const last1 = smoothed[smoothed.length - 1];
            if (corner[0] !== last1[0] || corner[1] !== last1[1]) {
                smoothed.push(corner);
            }
            const last2 = smoothed[smoothed.length - 1];
            if (end[0] !== last2[0] || end[1] !== last2[1]) {
                smoothed.push(end);
            }
            currentIndex = nextIndex;
        } else {
            // Keep the original next step (e.g., fallback if only a tight diagonal is available)
            const nextPt = path[currentIndex + 1];
            const last = smoothed[smoothed.length - 1];
            if (nextPt[0] !== last[0] || nextPt[1] !== last[1]) {
                smoothed.push(nextPt);
            }
            currentIndex++;
        }
    }

    return compressStraightLines(smoothed);
}

/** Determines if an orthogonal straight line between two points hits any obstructions. */
function isClearPath(pA: number[], pB: number[], grid: PF.Grid): boolean {
    const x1 = pA[0], y1 = pA[1];
    const x2 = pB[0], y2 = pB[1];
    
    if (x1 !== x2 && y1 !== y2) return false;

    const dx = Math.sign(x2 - x1);
    const dy = Math.sign(y2 - y1);
    let x = x1;
    let y = y1;

    while (x !== x2 || y !== y2) {
        if (!grid.isWalkableAt(x, y)) return false;
        x += dx;
        y += dy;
    }
    return grid.isWalkableAt(x2, y2);
}

/** Takes just the corners of a path and generates every step in-between them for grid-blocking. */
function expandPath(path: number[][]): number[][] {
    const expanded: number[][] = [];
    for (let i = 0; i < path.length - 1; i++) {
        let x = path[i][0];
        let y = path[i][1];
        const nx = path[i+1][0];
        const ny = path[i+1][1];
        
        const dx = Math.sign(nx - x);
        const dy = Math.sign(ny - y);
        
        while (x !== nx || y !== ny) {
            expanded.push([x, y]);
            if (x !== nx) x += dx;
            if (y !== ny) y += dy;
        }
    }
    if (path.length > 0) expanded.push([...path[path.length - 1]]);
    
    return expanded.filter((p, i, arr) => i === 0 || p[0] !== arr[i-1][0] || p[1] !== arr[i-1][1]);
}

/** Removes all intermediate nodes on the same line to safely compress points down to corners. */
function compressStraightLines(path: number[][]): number[][] {
    if (path.length < 3) return path;
    const compressed = [path[0]];
    const p1 = path[0]; // <-- Changed from let to const
    let p2 = path[1];
    let dx = Math.sign(p2[0] - p1[0]);
    let dy = Math.sign(p2[1] - p1[1]);

    for (let i = 2; i < path.length; i++) {
        const p3 = path[i];
        const ndx = Math.sign(p3[0] - p2[0]);
        const ndy = Math.sign(p3[1] - p2[1]);

        if (dx !== ndx || dy !== ndy) {
            compressed.push(p2);
            dx = ndx;
            dy = ndy;
        }
        p2 = p3;
    }
    compressed.push(path[path.length - 1]);
    return compressed;
}