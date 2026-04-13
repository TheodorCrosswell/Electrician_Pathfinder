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

    // Step 1: Map Obstructions onto the Grid
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

    const finder = new PF.AStarFinder({
        allowDiagonal: false,
        dontCrossCorners: true
    });

    const paths: number[][][] = [];

    // Step 2 & 3: Route sequentially and block used paths
    for (let i = 0; i < stubs.length - 1; i++) {
        const start = stubs[i];
        const end = stubs[i + 1];

        const sx = Math.max(0, Math.min(cols - 1, Math.floor(start.x / CELL_SIZE)));
        const sy = Math.max(0, Math.min(rows - 1, Math.floor(start.y / CELL_SIZE)));
        const ex = Math.max(0, Math.min(cols - 1, Math.floor(end.x / CELL_SIZE)));
        const ey = Math.max(0, Math.min(rows - 1, Math.floor(end.y / CELL_SIZE)));

        grid.setWalkableAt(sx, sy, true);
        grid.setWalkableAt(ex, ey, true);

        const gridBackup = grid.clone(); 
        
        let path = finder.findPath(sx, sy, ex, ey, gridBackup);
        
        if (path.length > 0) {
            // Step 4: Compress the path
            path = PF.Util.compressPath(path);
            
            const canvasPath = path.map(p => [
                p[0] * CELL_SIZE + (CELL_SIZE / 2),
                p[1] * CELL_SIZE + (CELL_SIZE / 2)
            ]);
            paths.push(canvasPath);

            path.forEach(p => {
                grid.setWalkableAt(p[0], p[1], false);
            });
        }
    }

    return paths;
}