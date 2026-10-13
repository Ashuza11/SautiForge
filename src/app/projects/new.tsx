import { router } from 'expo-router';

import { useRepositories } from '@/core/database/repositories';
import type { ProjectDraft } from '@/features/projects/domain/project';
import { ProjectForm } from '@/features/projects/presentation/project-form';
import { useI18n } from '@/i18n';
import { Heading, Screen } from '@/ui/components';

export default function NewProjectScreen() {
  const { strings } = useI18n();
  const { projects } = useRepositories();
  const save = async (draft: ProjectDraft) => {
    const project = await projects.create(draft);
    await projects.setActive(project.id);
    router.replace(`/projects/${project.id}`);
  };
  return <Screen><Heading>{strings.newProject}</Heading><ProjectForm onSave={save} /></Screen>;
}
