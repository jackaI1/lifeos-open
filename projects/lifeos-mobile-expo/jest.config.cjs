module.exports = {
  preset: 'jest-expo',
  testMatch: ['**/__tests__/**/*.test.ts?(x)'],
  collectCoverageFrom: ['src/**/*.{ts,tsx}', '!src/__tests__/**'],
  coverageThreshold: { global: { branches: 75, functions: 80, lines: 85, statements: 85 } },
  clearMocks: true,
};
