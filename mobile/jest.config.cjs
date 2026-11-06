module.exports = {
  preset: 'jest-expo',
  transform: {'^.+\\.mjs$': ['babel-jest', {presets: ['babel-preset-expo']}]},
  testMatch: ['<rootDir>/test/**/*.test.{ts,tsx}'],
  setupFilesAfterEnv: ['<rootDir>/test/setup.ts'],
  maxWorkers: 1,
  clearMocks: true,
};
