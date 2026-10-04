export function buildRemotePrompt(fictionalExamples: string[]): string {
  const examples = fictionalExamples
    .map((example) => example.replaceAll('*', '').replaceAll(/\s+/g, ' ').trim())
    .filter(Boolean);
  if (!examples.length) throw new Error('Add at least one fictional example to this scenario before sharing.');
  return [
    'Iyi njo exemple ya kuji-référer ako. Usiisome mot à mot; sema vile utaweza kuisema réellement.',
    ...examples.map((example, index) => `${index + 1}. *${example}*`),
  ].join('\n\n');
}
