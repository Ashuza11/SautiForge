import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { validateExportDirectory } from './validate-export.mjs';

const roots = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function sampleExport() {
  const root = await mkdtemp(path.join(tmpdir(), 'sautiforge-export-'));
  roots.push(root);
  await mkdir(path.join(root, 'metadata'), { recursive: true });
  await mkdir(path.join(root, 'audio'), { recursive: true });
  const recordingId = 'de0a9676-92cc-4b18-997a-3fafce18b700';
  const files = new Map([
    ['metadata/recordings.jsonl', `${JSON.stringify({ id: recordingId, audio_path: `audio/${recordingId}.m4a` })}\n`],
    [`audio/${recordingId}.m4a`, 'audio bytes'],
  ]);
  const members = [];
  for (const [relative, content] of files) {
    await writeFile(path.join(root, relative), content);
    members.push({ path: relative, sizeBytes: Buffer.byteLength(content), sha256: createHash('sha256').update(content).digest('hex') });
  }
  const manifest = { schemaVersion: '1.0.0', exportId: '0d050af7-474d-4ac7-b1e2-f9e05ecbdc79', exportType: 'research_dataset', counts: { recordings: 1 }, files: members };
  await writeFile(path.join(root, 'manifest.json'), JSON.stringify(manifest));
  return { root, manifest, recordingId };
}

describe('portable export validator', () => {
  it('verifies hashes, sizes, counts, and audio references', async () => {
    const { root } = await sampleExport();
    await expect(validateExportDirectory(root)).resolves.toMatchObject({ files: 2, recordings: 1 });
  });

  it('detects post-transfer corruption', async () => {
    const { root, recordingId } = await sampleExport();
    await writeFile(path.join(root, 'audio', `${recordingId}.m4a`), 'changed');
    await expect(validateExportDirectory(root)).rejects.toThrow(/Size mismatch|SHA-256 mismatch/);
  });

  it('rejects missing and unsafe audio references', async () => {
    const { root, manifest, recordingId } = await sampleExport();
    const recordingsPath = path.join(root, 'metadata', 'recordings.jsonl');
    const unsafe = `${JSON.stringify({ id: recordingId, audio_path: '../private.m4a' })}\n`;
    await writeFile(recordingsPath, unsafe);
    const member = manifest.files.find((file) => file.path === 'metadata/recordings.jsonl');
    member.sizeBytes = Buffer.byteLength(unsafe);
    member.sha256 = createHash('sha256').update(unsafe).digest('hex');
    await writeFile(path.join(root, 'manifest.json'), JSON.stringify(manifest));
    await expect(validateExportDirectory(root)).rejects.toThrow(/unsafe audio_path/);
  });
});
