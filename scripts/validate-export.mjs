#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

function safeMemberPath(memberPath) {
  return typeof memberPath === 'string' && memberPath.length > 0 && !path.isAbsolute(memberPath) && !memberPath.includes('..') && !memberPath.includes('\\');
}

async function sha256(filePath) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

function parseJsonLines(text, label) {
  return text.split(/\r?\n/).filter(Boolean).map((line, index) => {
    try { return JSON.parse(line); }
    catch { throw new Error(`${label} line ${index + 1} is not valid JSON.`); }
  });
}

export async function validateExportDirectory(directoryPath) {
  const root = path.resolve(directoryPath);
  const manifestPath = path.join(root, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (manifest.schemaVersion !== '1.0.0') throw new Error(`Unsupported export schema: ${String(manifest.schemaVersion)}`);
  if (!['research_dataset', 'administrative_backup'].includes(manifest.exportType)) throw new Error('Unknown export type.');
  if (!Array.isArray(manifest.files)) throw new Error('Manifest files must be an array.');

  const manifestPaths = new Set();
  for (const member of manifest.files) {
    if (!safeMemberPath(member.path)) throw new Error(`Unsafe manifest path: ${String(member.path)}`);
    if (manifestPaths.has(member.path)) throw new Error(`Duplicate manifest path: ${member.path}`);
    manifestPaths.add(member.path);
    const absolutePath = path.resolve(root, member.path);
    if (!absolutePath.startsWith(`${root}${path.sep}`)) throw new Error(`Path escapes export directory: ${member.path}`);
    const details = await stat(absolutePath);
    if (!details.isFile()) throw new Error(`Manifest member is not a file: ${member.path}`);
    if (details.size !== member.sizeBytes) throw new Error(`Size mismatch for ${member.path}: expected ${member.sizeBytes}, found ${details.size}.`);
    const digest = await sha256(absolutePath);
    if (digest !== member.sha256) throw new Error(`SHA-256 mismatch for ${member.path}.`);
  }

  let recordingCount = 0;
  if (manifest.exportType === 'research_dataset') {
    const recordingsPath = 'metadata/recordings.jsonl';
    if (!manifestPaths.has(recordingsPath)) throw new Error(`${recordingsPath} is missing from the manifest.`);
    const recordings = parseJsonLines(await readFile(path.join(root, recordingsPath), 'utf8'), recordingsPath);
    recordingCount = recordings.length;
    for (const recording of recordings) {
      if (!safeMemberPath(recording.audio_path) || !String(recording.audio_path).startsWith('audio/')) {
        throw new Error(`Recording ${String(recording.id)} has an unsafe audio_path.`);
      }
      if (!manifestPaths.has(recording.audio_path)) throw new Error(`Recording ${String(recording.id)} references missing audio: ${String(recording.audio_path)}`);
    }
    if (manifest.counts?.recordings !== recordingCount) throw new Error(`Recording count mismatch: manifest ${String(manifest.counts?.recordings)}, data ${recordingCount}.`);
  }

  return { exportId: manifest.exportId, exportType: manifest.exportType, files: manifest.files.length, recordings: recordingCount };
}

async function main() {
  const directory = process.argv[2];
  if (!directory) throw new Error('Usage: node scripts/validate-export.mjs <extracted-export-directory>');
  const result = await validateExportDirectory(directory);
  process.stdout.write(`Valid SautiForge ${result.exportType} ${result.exportId}: ${result.files} hashed file(s), ${result.recordings} recording reference(s).\n`);
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
