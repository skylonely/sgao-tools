import { cp, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = `${root}dist`;
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(`${root}src`, output, { recursive: true });
await cp(`${root}public`, output, { recursive: true });
console.log('构建完成 → dist/（纯静态资源，无需服务端运行时）');
