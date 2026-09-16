#!/usr/bin/env node

import { Buffer } from "node:buffer";

const frame = Buffer.alloc(4);
frame.writeUInt32BE(1024, 0);
process.stdout.write(frame);
process.stdin.resume();
