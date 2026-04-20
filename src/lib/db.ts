import Dexie, { type Table } from 'dexie';
import type { ProjectState } from '$lib/types';

export interface ProjectRecord {
    id: string;
    name: string;
    updatedAt: number;
    state: ProjectState;
}

export class AppDB extends Dexie {
    projects!: Table<ProjectRecord, string>;

    constructor() {
        super('WirePathDB');
        this.version(1).stores({
            projects: 'id, updatedAt' // Primary key and indexed props
        });
    }
}

export const db = new AppDB();