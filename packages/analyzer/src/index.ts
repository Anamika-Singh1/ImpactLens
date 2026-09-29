/** Phase 1 contract only. No repository code is executed or analyzed yet. */
export const analyzerCapabilities = {
  implemented: false,
  plannedLanguages: ['JavaScript', 'TypeScript'],
  plannedDependencies: ['static import/export'],
  limitations: [
    'Analysis is not implemented in Phase 1.',
    'Dynamic imports, runtime dependency injection and cross-service calls are unsupported.',
    'Framework support will be limited to documented React and Express patterns.',
  ],
} as const;
