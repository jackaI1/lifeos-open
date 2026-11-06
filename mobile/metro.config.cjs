const {getDefaultConfig} = require('expo/metro-config');
const path = require('node:path');
const config = getDefaultConfig(__dirname);
// Share only the date/domain sources; dependencies must stay on Expo's React version.
config.watchFolders = [path.resolve(__dirname, '../src/shared'), path.resolve(__dirname, '../src/domain'), path.resolve(__dirname, '../public')];
config.resolver.disableHierarchicalLookup = true;
config.resolver.nodeModulesPaths = [path.resolve(__dirname, 'node_modules')];
config.maxWorkers = 2;
module.exports = config;
