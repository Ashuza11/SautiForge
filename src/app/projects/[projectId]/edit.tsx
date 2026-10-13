import { useEffect, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';

import { useRepositories } from '@/core/database/repositories';
import type { Project, ProjectDraft } from '@/features/projects/domain/project';
import { ProjectForm } from '@/features/projects/presentation/project-form';
import { useI18n } from '@/i18n';
import { EmptyState, ErrorNotice, Heading, Screen } from '@/ui/components';

export default function EditProjectScreen() {
  const { strings, translateText } = useI18n();
  const params = useLocalSearchParams<{ projectId: string }>();
  const projectId = Array.isArray(params.projectId) ? params.projectId[0] : params.projectId;
  const { projects } = useRepositories();
  const [project, setProject] = useState<Project | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) return;
    projects.get(projectId).then(setProject).catch((cause: unknown) => setError(cause instanceof Error ? translateText(cause.message) : strings.projectLoadFailed));
  }, [projectId, projects, strings, translateText]);

  if (error) return <Screen><ErrorNotice message={error} /></Screen>;
  if (!project) return <Screen><EmptyState>{strings.loadingProject}</EmptyState></Screen>;

  const initial: ProjectDraft = { ...project };
  const save = async (draft: ProjectDraft) => {
    await projects.update(project.id, draft);
    router.back();
  };
  return <Screen><Heading>{strings.editProject}</Heading><ProjectForm initial={initial} onSave={save} /></Screen>;
}
