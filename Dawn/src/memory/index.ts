export { MemorySystem } from './MemorySystem.js';
export { SessionMemory, type SessionMemoryConfig } from './layers/session/SessionMemory.js';
export { PersistentMemory, type PersistentMemoryConfig, type EmbeddingResult } from './layers/persistent/PersistentMemory.js';
export { SkillMemory, type SkillPattern, type SkillMatchResult } from './layers/skill/SkillMemory.js';
export { MemoryCompressor, DEFAULT_FORGETTING_CONFIGS } from './compressor/MemoryCompressor.js';
export { ForgettingLevel, calculateImportance, applyForgetting } from './compressor/ForgettingStrategy.js';
export { HybridRetriever } from './retriever/HybridRetriever.js';
export { JsonFileStore } from './store/MemoryStore.js';

export type { StoredEntry } from './store/MemoryStore.js';
export type { IMemoryStore } from './store/MemoryStore.js';
export type { ForgettingConfig, ForgettingResult } from './compressor/ForgettingStrategy.js';
export type { RetrievalOptions, RetrievalResult } from './retriever/HybridRetriever.js';
export type { CompressedEntry, CompressAndForgetResult } from './compressor/MemoryCompressor.js';

// 向后兼容旧类型
export type { MemoryQuery, MemoryContext, SaveMemoryInput, MemorySystemConfig } from './MemorySystem.js';

