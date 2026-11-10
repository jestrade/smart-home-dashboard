import { createDemoBackend } from './demoBackend';
import { createFirebaseBackend, firebaseConfig } from './firebaseBackend';

const configured = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);
const demo = import.meta.env.VITE_DEMO === 'true' || !configured;

export const backend = demo ? createDemoBackend() : createFirebaseBackend();
export type { Backend } from './backend';
