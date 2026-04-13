// src/lib/store.ts
import { writable } from 'svelte/store';
import type { ProjectState } from './types';

export const project = writable<ProjectState>({
    rawImage: null,
    image: null,
    stubs: [],
    obstructions: [],
    stage: 'SETUP'
});