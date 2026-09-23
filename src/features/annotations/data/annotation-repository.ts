import type { Annotation, BusinessAnnotationPayload } from '../domain/annotation';

export interface AnnotationRepository {
  listRevisions(recordingId: string, annotationType: string): Promise<Annotation[]>;
  getCurrentBusiness(recordingId: string): Promise<Annotation | null>;
  createBusinessRevision(recordingId: string, payload: BusinessAnnotationPayload, createdBy: string | null): Promise<Annotation>;
}
