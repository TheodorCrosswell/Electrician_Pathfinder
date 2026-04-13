// src/lib/types.ts
export interface Stub {
    id: string;
    x: number;
    y: number;
    type: string;
}

export interface Obstruction {
    id: string;
    x: number;
    y: number;
    w: number;
    h: number;
}

export type StageType = 'SETUP' | 'STUBS' | 'OBSTRUCTIONS' | 'RESULTS';

export interface ProjectState {
    rawImage: string | null;
    image: string | null;
    stubs: Stub[];
    obstructions: Obstruction[];
    stage: StageType;
}