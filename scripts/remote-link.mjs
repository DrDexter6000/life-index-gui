#!/usr/bin/env node

import { runRemoteLinkCommand } from './lib/remote-link.mjs';

const action = process.argv[2];
const code = await runRemoteLinkCommand(action);
process.exit(code);
