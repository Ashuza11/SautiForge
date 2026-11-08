import type { LocalServer } from './local-server';

export type SeedResult = { projectId: string; sourceId: string; created: boolean };

/** Registers the Mashi project and the Jesus Film source with local-only approved rights. */
export async function seedLocalData(server: LocalServer): Promise<SeedResult> {
  const existing = (await server.projects.list(true)).find((project) => project.languageCode === 'shr');
  if (existing) {
    const source = (await server.sources.list(existing.id, true))[0];
    if (source) return { projectId: existing.id, sourceId: source.id, created: false };
  }
  const project = existing ?? await server.projects.create({
    title: 'Mashi Community Speech Pilot',
    description: 'Local development project.',
    targetLanguage: 'Shi',
    languageCode: 'shr',
    languageVariety: 'Mashi',
    researchDomain: 'General speech',
    collectionLocation: 'South Kivu, DRC',
    protocolVersion: '2.0',
    annotationProfile: 'verbatim_transcription',
    status: 'active',
  });
  const source = await server.sources.create(project.id, {
    sourceType: 'external_url',
    title: 'Jesus Film - Invitation to Know Jesus Personally (Mashi)',
    originalUrl: 'https://www.jesusfilm.org/watch',
    creator: 'Jesus Film Project',
    sourceDate: null,
    durationMs: 401_000,
    externalReference: null,
    languageVerification: 'verified_target',
    languageVerifiedBy: 'ADMIN-01',
    languageVerificationNotes: 'Local development data.',
    speakerIdentification: 'not_assessed',
    speakerNotes: '',
  });
  await server.sources.addRightsRevision(source.id, {
    rightsHolder: 'Local development only',
    license: null,
    permissionEvidence: 'Local development data. Replace with the real rights decision in production.',
    attributionRequirements: null,
    authorizedUses: { internalProcessing: true, volunteerAccess: true, transcription: true, mlResearch: true, publicDistribution: false },
    decision: 'approved',
    changedBy: 'ADMIN-01',
    changeReason: 'Local development seed.',
  });
  return { projectId: project.id, sourceId: source.id, created: true };
}
