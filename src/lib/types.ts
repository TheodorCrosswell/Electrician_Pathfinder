// src/lib/types.ts
export type RunType = 'DAISY_CHAIN' | 'HOME_RUN';

export interface Stub {
    id: string;
    x: number;
    y: number;
    type: string;
    runId: string;     // 'A', 'B', 'C', etc.
    runType: RunType;  // Run behavior
    index: number;     // 1, 2, 3... (0 is used for the Home Run Box)
    isBox: boolean;    // Differentiates the Box from standard stubs
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
    currentRunId?: string;
    currentRunType?: RunType;
}