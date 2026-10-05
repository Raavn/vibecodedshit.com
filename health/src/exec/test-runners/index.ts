import { jest } from './jest.js';
import { mocha } from './mocha.js';
import { nodeTest } from './node-test.js';
import { pytest } from './pytest.js';
import type { RunnerSpecs } from './spec.js';
import { vitest } from './vitest.js';

export const RUNNERS: RunnerSpecs = { vitest, jest, mocha, 'node-test': nodeTest, pytest };
