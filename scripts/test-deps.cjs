'use strict';

// Optional test dependencies are intentionally not bundled with the player.
// Use modules installed in this project or a user-configured test environment.
const os = require('node:os');
const path = require('node:path');

function loadTestDependency(name) {
  if (name !== 'playwright' && name !== 'sharp') {
    throw new Error('Unsupported test dependency: ' + name);
  }
  const userModules = process.env.QINGYIN_TEST_MODULES;
  const paths = [
    name,
    ...(userModules ? [path.join(userModules, name)] : []),
    path.join(os.homedir(), '.cache', 'codex-runtimes',
      'codex-primary-runtime', 'dependencies', 'node', 'node_modules', name),
  ];

  for (const candidate of paths) {
    let resolved;
    try {
      resolved = require.resolve(candidate);
    } catch (error) {
      if (error.code === 'MODULE_NOT_FOUND') continue;
      throw error;
    }
    return require(resolved);
  }

  throw new Error(
    'Test dependency ' + name + ' not found. Install it as a development ' +
    'dependency or set QINGYIN_TEST_MODULES to a local node_modules directory.'
  );
}

module.exports = { loadTestDependency };
