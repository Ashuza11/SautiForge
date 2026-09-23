import { router } from 'expo-router';

import { useRepositories } from '@/core/database/repositories';
import type { ProjectDraft } from '@/features/projects/domain/project';
import { ProjectForm } from '@/features/projects/presentation/project-form';
import { Heading, Screen } from '@/ui/components';

export default function NewProjectScreen() {
  const { projects } = useRepositories();
  const save = async (draft: ProjectDraft) => {
    const project = await projects.create(draft);
    await projects.setActive(project.id);
    router.replace(`/projects/${project.id}`);
  };
  return <Screen><Heading subtitle="Create reusable research infrastructure, not a fixed study template.">New project</Heading><ProjectForm onSave={save} /></Screen>;
}
