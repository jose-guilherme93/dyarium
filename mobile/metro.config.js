// Configuracao do Metro.
// expo-sqlite no web carrega um modulo .wasm; sem isto o bundle web falha com
// "Unable to resolve module ./wa-sqlite/wa-sqlite.wasm". Nao afeta o Android.
const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

config.resolver.assetExts.push('wasm');

module.exports = config;
